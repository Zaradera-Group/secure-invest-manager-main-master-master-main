import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../src/config/env.js";
import { adminSupabase } from "../src/lib/supabase.js";

type StorageEntry = {
  name: string;
  id?: string | null;
  metadata?: { mimetype?: string | null } | null;
};

type SourceObject = {
  bucket: string;
  path: string;
  contentType: string;
};

type TransferSummary = {
  sourceBucket: string;
  discovered: number;
  copied: number;
  skipped: number;
  dryRun: number;
};

const pageSize = 100;
const execute = process.env.STORAGE_TRANSFER_EXECUTE === "true";
const sourceSelection = process.env.STORAGE_TRANSFER_SOURCE_BUCKET?.trim();

function requireConfig(name: string, value?: string) {
  if (!value) throw new Error(`${name} is required for S3 storage transfer`);
  return value;
}

const targetBucket = requireConfig("S3_BUCKET", env.S3_BUCKET);
const s3Prefix = env.S3_PREFIX?.replace(/^\/+|\/+$/g, "");
const s3Client = new S3Client({
  region: requireConfig("S3_REGION", env.S3_REGION),
  credentials: {
    accessKeyId: requireConfig("S3_ACCESS_KEY_ID", env.S3_ACCESS_KEY_ID),
    secretAccessKey: requireConfig("S3_SECRET_ACCESS_KEY", env.S3_SECRET_ACCESS_KEY),
  },
});

function getTargetKey(path: string) {
  const normalizedPath = path.trim().replace(/^\/+/, "");
  return s3Prefix ? `${s3Prefix}/${normalizedPath}` : normalizedPath;
}

function getSourceBuckets() {
  const configuredBuckets = [...new Set([env.CERTIFICATE_STORAGE_BUCKET, env.INVESTOR_PASSPORT_STORAGE_BUCKET])];
  if (!sourceSelection || sourceSelection === "all") return configuredBuckets;
  if (!configuredBuckets.includes(sourceSelection)) {
    throw new Error(`STORAGE_TRANSFER_SOURCE_BUCKET must be one of: all, ${configuredBuckets.join(", ")}`);
  }
  return [sourceSelection];
}

async function* listObjects(bucket: string, path = ""): AsyncGenerator<SourceObject> {
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await adminSupabase.storage
      .from(bucket)
      .list(path, { limit: pageSize, offset, sortBy: { column: "name", order: "asc" } });

    if (error) throw new Error(`Failed to list storage bucket ${bucket}: ${error.message}`);
    const entries = (data ?? []) as StorageEntry[];

    for (const entry of entries) {
      const nestedPath = path ? `${path}/${entry.name}` : entry.name;
      if (entry.id) {
        yield { bucket, path: nestedPath, contentType: entry.metadata?.mimetype || "application/octet-stream" };
      } else {
        yield* listObjects(bucket, nestedPath);
      }
    }

    if (entries.length < pageSize) return;
  }
}

async function getExistingTargetSize(key: string) {
  try {
    const object = await s3Client.send(new HeadObjectCommand({ Bucket: targetBucket, Key: key }));
    return object.ContentLength ?? 0;
  } catch (error) {
    if (error instanceof Error && ["NotFound", "NoSuchKey", "404"].includes(error.name)) return null;
    throw error;
  }
}

async function transferBucket(sourceBucket: string): Promise<TransferSummary> {
  const summary: TransferSummary = { sourceBucket, discovered: 0, copied: 0, skipped: 0, dryRun: 0 };

  for await (const object of listObjects(sourceBucket)) {
    summary.discovered += 1;
    const targetKey = getTargetKey(object.path);

    if (!execute) {
      summary.dryRun += 1;
      continue;
    }

    const { data, error } = await adminSupabase.storage.from(sourceBucket).download(object.path);
    if (error || !data) throw new Error(`Failed to download ${sourceBucket}/${object.path}: ${error?.message ?? "Unknown error"}`);

    const bytes = Buffer.from(await data.arrayBuffer());
    const existingSize = await getExistingTargetSize(targetKey);
    if (existingSize !== null) {
      if (existingSize !== bytes.length) {
        throw new Error(`Refusing to overwrite ${targetKey}: existing S3 size ${existingSize} differs from source size ${bytes.length}`);
      }
      summary.skipped += 1;
      continue;
    }

    await s3Client.send(new PutObjectCommand({
      Bucket: targetBucket,
      Key: targetKey,
      Body: bytes,
      ContentType: object.contentType,
    }));

    const copiedSize = await getExistingTargetSize(targetKey);
    if (copiedSize !== bytes.length) {
      throw new Error(`S3 verification failed for ${targetKey}: expected ${bytes.length} bytes, received ${copiedSize ?? 0}`);
    }
    summary.copied += 1;
  }

  return summary;
}

async function main() {
  if (!execute) {
    console.log("[storage-transfer] Dry run only. Set STORAGE_TRANSFER_EXECUTE=true to copy objects.");
  }

  for (const sourceBucket of getSourceBuckets()) {
    console.log("[storage-transfer] Starting", { sourceBucket, targetBucket, prefix: s3Prefix || null, execute });
    console.log("[storage-transfer] Complete", await transferBucket(sourceBucket));
  }
}

main().catch((error) => {
  console.error("[storage-transfer] Failed", error);
  process.exitCode = 1;
});
