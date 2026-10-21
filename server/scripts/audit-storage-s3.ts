import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../src/config/env.js";
import { adminSupabase } from "../src/lib/supabase.js";

type StorageEntry = { name: string; id?: string | null; metadata?: { size?: number | string | null } | null };
type SourceObject = { bucket: string; path: string; size: number };
const pageSize = 100;

function required(name: string, value?: string) {
  if (!value) throw new Error(`${name} is required for the S3 storage audit`);
  return value;
}

const bucket = required("S3_BUCKET", env.S3_BUCKET);
const prefix = env.S3_PREFIX?.replace(/^\/+|\/+$/g, "");
const client = new S3Client({
  region: required("S3_REGION", env.S3_REGION),
  credentials: {
    accessKeyId: required("S3_ACCESS_KEY_ID", env.S3_ACCESS_KEY_ID),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY", env.S3_SECRET_ACCESS_KEY),
  },
});

const targetKey = (path: string) => prefix ? `${prefix}/${path.replace(/^\/+/, "")}` : path.replace(/^\/+/, "");

async function listObjects(sourceBucket: string, path = "", result: SourceObject[] = []) {
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await adminSupabase.storage.from(sourceBucket).list(path, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`Failed to list ${sourceBucket}: ${error.message}`);
    for (const entry of (data ?? []) as StorageEntry[]) {
      const nestedPath = path ? `${path}/${entry.name}` : entry.name;
      if (entry.id) result.push({ bucket: sourceBucket, path: nestedPath, size: Number(entry.metadata?.size ?? 0) || 0 });
      else await listObjects(sourceBucket, nestedPath, result);
    }
    if ((data ?? []).length < pageSize) return result;
  }
}

async function main() {
  const sourceBuckets = [...new Set([env.CERTIFICATE_STORAGE_BUCKET, env.INVESTOR_PASSPORT_STORAGE_BUCKET])];
  const objects = (await Promise.all(sourceBuckets.map((sourceBucket) => listObjects(sourceBucket)))).flat();
  const summary = { sourceObjects: objects.length, verified: 0, missing: 0, sizeMismatch: 0, errors: 0 };
  const missing: string[] = [];
  const mismatches: string[] = [];

  for (const object of objects) {
    const key = targetKey(object.path);
    try {
      const target = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      const targetSize = target.ContentLength ?? 0;
      if (targetSize !== object.size) {
        summary.sizeMismatch += 1;
        mismatches.push(`${object.bucket}/${object.path} => ${key} (${object.size} -> ${targetSize})`);
      } else summary.verified += 1;
    } catch (error) {
      if (error instanceof Error && ["NotFound", "NoSuchKey", "404"].includes(error.name)) {
        summary.missing += 1;
        missing.push(`${object.bucket}/${object.path} => ${key}`);
      } else {
        summary.errors += 1;
        console.error("[storage-s3.audit] Failed to inspect object", { key, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  console.log("[storage-s3.audit] Summary", { bucket, prefix: prefix || null, ...summary });
  if (missing.length) console.log("[storage-s3.audit] Missing objects", missing.slice(0, 50));
  if (mismatches.length) console.log("[storage-s3.audit] Size mismatches", mismatches.slice(0, 50));
  if (summary.missing || summary.sizeMismatch || summary.errors) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[storage-s3.audit] Failed", error);
  process.exitCode = 1;
});
