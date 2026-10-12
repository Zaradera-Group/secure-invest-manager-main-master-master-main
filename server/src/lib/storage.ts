import {
  DeleteObjectCommand,
  GetObjectCommand,
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

export async function uploadObject({ path, bytes, contentType }: UploadObjectArgs) {
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
    .from(env.CERTIFICATE_STORAGE_BUCKET)
    .upload(storagePath, bytes, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload storage object: ${error.message}`);
  }

  return storagePath;
}

export async function createSignedObjectUrl(path: string, expiresInSeconds = env.S3_SIGNED_URL_EXPIRES_SECONDS) {
  const storagePath = resolveStoragePath(path);

  if (s3Client) {
    return getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: getS3Bucket(),
        Key: storagePath,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  const { data, error } = await adminSupabase.storage
    .from(env.CERTIFICATE_STORAGE_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to create signed storage url: ${error?.message ?? "Unknown error"}`);
  }

  return data.signedUrl;
}

export async function downloadObject(path: string) {
  const storagePath = resolveStoragePath(path);

  if (s3Client) {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: getS3Bucket(),
        Key: storagePath,
      }),
    );

    if (!response.Body) {
      throw new Error("S3 object had no response body");
    }

    return Buffer.from(await response.Body.transformToByteArray());
  }

  const { data, error } = await adminSupabase.storage
    .from(env.CERTIFICATE_STORAGE_BUCKET)
    .download(storagePath);

  if (error || !data) {
    throw new Error(`Failed to download storage object: ${error?.message ?? "Unknown error"}`);
  }

  return Buffer.from(await data.arrayBuffer());
}

export async function deleteObject(path: string) {
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
    .from(env.CERTIFICATE_STORAGE_BUCKET)
    .remove([storagePath]);

  if (error) {
    throw new Error(`Failed to delete storage object: ${error.message}`);
  }
}

function normalizeStoragePath(path: string) {
  return path.trim().replace(/^\/+/, "");
}
