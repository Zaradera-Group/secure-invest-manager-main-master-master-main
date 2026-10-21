import { adminSupabase } from "../src/lib/supabase.js";
import { env } from "../src/config/env.js";

type StorageEntry = {
  name: string;
  id?: string | null;
  metadata?: { size?: number | string | null; mimetype?: string | null } | null;
};

type StorageInventory = {
  bucket: string;
  objects: number;
  bytes: number;
  contentTypes: Record<string, number>;
};

const pageSize = 100;

async function listDirectory(bucket: string, path: string, inventory: StorageInventory): Promise<void> {
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await adminSupabase.storage
      .from(bucket)
      .list(path, { limit: pageSize, offset, sortBy: { column: "name", order: "asc" } });

    if (error) throw new Error(`Failed to list storage bucket ${bucket}: ${error.message}`);
    const entries = (data ?? []) as StorageEntry[];

    for (const entry of entries) {
      const nestedPath = path ? `${path}/${entry.name}` : entry.name;
      if (entry.id) {
        inventory.objects += 1;
        inventory.bytes += Number(entry.metadata?.size ?? 0) || 0;
        const contentType = entry.metadata?.mimetype || "unknown";
        inventory.contentTypes[contentType] = (inventory.contentTypes[contentType] ?? 0) + 1;
      } else {
        await listDirectory(bucket, nestedPath, inventory);
      }
    }

    if (entries.length < pageSize) return;
  }
}

async function auditBucket(bucket: string) {
  const inventory: StorageInventory = {
    bucket,
    objects: 0,
    bytes: 0,
    contentTypes: {},
  };

  await listDirectory(bucket, "", inventory);
  console.log("[supabase-storage.audit]", inventory);
}

async function main() {
  const buckets = [...new Set([env.CERTIFICATE_STORAGE_BUCKET, env.INVESTOR_PASSPORT_STORAGE_BUCKET])];
  await Promise.all(buckets.map(auditBucket));
}

main().catch((error) => {
  console.error("[supabase-storage.audit] Failed", error);
  process.exitCode = 1;
});
