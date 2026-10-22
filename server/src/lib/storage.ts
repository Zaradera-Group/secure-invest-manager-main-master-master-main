import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";
import { adminSupabase } from "./supabase.js";

type UploadObjectArgs = {
  path: string;
  bytes: Uint8Array | Buffer;
  contentType: string;
  supabaseBucket?: string;
  upsert?: boolean;
};

const s3Client = env.STORAGE_PROVIDER === "s3"
  ? new S3Client({
      region: requireS3Config("S3_REGION", env.S3_REGION),
      credentials: {
        accessKeyId: requireS3Config("S3_ACCESS_KEY_ID", env.S3_ACCESS_KEY_ID),
        secretAccessKey: requireS3Config("S3_SECRET_ACCESS_KEY", env.S3_SECRET_ACCESS_KEY),
      },
    })
  : null;

function requireS3Config(name: string, value?: string) {
  if (!value) {
    throw new Error(`${name} is required when STORAGE_PROVIDER=s3`);
  }

  return value;
}

function getS3Bucket() {
  return requireS3Config("S3_BUCKET", env.S3_BUCKET);
}

export function isS3StorageEnabled() {
  return env.STORAGE_PROVIDER === "s3";
}

export function resolveStoragePath(path: string) {
  const normalizedPath = normalizeStoragePath(path);

  if (!isS3StorageEnabled() || !env.S3_PREFIX) {
    return normalizedPath;
  }

  return normalizedPath.startsWith(`${env.S3_PREFIX}/`)
    ? normalizedPath
    : `${env.S3_PREFIX}/${normalizedPath}`;
}

export async function uploadObject({ path, bytes, contentType, supabaseBucket, upsert = true }: UploadObjectArgs) {
  const storagePath = resolveStoragePath(path);

  if (s3Client) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: getS3Bucket(),
        Key: storagePath,
        Body: Buffer.from(bytes),
        ContentType: contentType,
      }),
    );

    return storagePath;
  }

  const { error } = await adminSupabase.storage
    .from(supabaseBucket ?? env.CERTIFICATE_STORAGE_BUCKET)
    .upload(storagePath, bytes, {
      contentType,
      upsert,
    });

  if (error) {
    throw new Error(`Failed to upload storage object: ${error.message}`);
  }

  return storagePath;
}

export async function createSignedObjectUrl(
  path: string,
  expiresInSeconds = env.S3_SIGNED_URL_EXPIRES_SECONDS,
  supabaseBucket = env.CERTIFICATE_STORAGE_BUCKET,
) {
  const storagePath = resolveStoragePath(path);

  if (s3Client) {
    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: getS3Bucket(), Key: storagePath }));
      return getSignedUrl(
        s3Client,
        new GetObjectCommand({
          Bucket: getS3Bucket(),
          Key: storagePath,
        }),
        { expiresIn: expiresInSeconds },
      );
    } catch (error) {
      if (!shouldUseSupabaseReadFallback(error)) throw error;
      return createSupabaseSignedObjectUrl(normalizeStoragePath(path), expiresInSeconds, supabaseBucket);
    }
  }

  return createSupabaseSignedObjectUrl(storagePath, expiresInSeconds, supabaseBucket);
}

async function createSupabaseSignedObjectUrl(path: string, expiresInSeconds: number, bucket: string) {
  const { data, error } = await adminSupabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to create signed storage url: ${error?.message ?? "Unknown error"}`);
  }

  return data.signedUrl;
}

export async function downloadObject(path: string, supabaseBucket = env.CERTIFICATE_STORAGE_BUCKET) {
  const storagePath = resolveStoragePath(path);

  if (s3Client) {
    try {
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: getS3Bucket(),
          Key: storagePath,
        }),
      );

      if (!response.Body) throw new Error("S3 object had no response body");
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      if (!shouldUseSupabaseReadFallback(error)) throw error;
      return downloadSupabaseObject(normalizeStoragePath(path), supabaseBucket);
    }
  }

  return downloadSupabaseObject(storagePath, supabaseBucket);
}

async function downloadSupabaseObject(path: string, bucket: string) {
  const { data, error } = await adminSupabase.storage
    .from(bucket)
    .download(path);

  if (error || !data) {
    throw new Error(`Failed to download storage object: ${error?.message ?? "Unknown error"}`);
  }

  return Buffer.from(await data.arrayBuffer());
}

function shouldUseSupabaseReadFallback(error: unknown) {
  if (!env.STORAGE_S3_READ_FALLBACK_TO_SUPABASE) return false;
  if (!error || typeof error !== "object") return false;

  const candidate = error as { name?: unknown; Code?: unknown; code?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.name === "NoSuchKey"
    || candidate.Code === "NoSuchKey"
    || candidate.code === "NoSuchKey"
    || candidate.$metadata?.httpStatusCode === 404;
}

export async function deleteObject(path: string, supabaseBucket = env.CERTIFICATE_STORAGE_BUCKET) {
  const storagePath = resolveStoragePath(path);

  if (s3Client) {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: getS3Bucket(),
        Key: storagePath,
      }),
    );
    return;
  }

  const { error } = await adminSupabase.storage
    .from(supabaseBucket)
    .remove([storagePath]);

  if (error) {
    throw new Error(`Failed to delete storage object: ${error.message}`);
  }
}

function normalizeStoragePath(path: string) {
  return path.trim().replace(/^\/+/, "");
}
