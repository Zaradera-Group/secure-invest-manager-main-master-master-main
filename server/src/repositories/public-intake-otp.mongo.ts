import { randomUUID } from "node:crypto";
import { getMongoDb, isMongoConfigured } from "../lib/mongodb.js";

export type PublicIntakeOtpRecord = {
  id: string;
  phone: string;
  email: string | null;
  code_hash: string;
  attempt_count: number;
  max_attempts: number;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

type StoredOtpRecord = Omit<PublicIntakeOtpRecord, "expires_at" | "consumed_at" | "created_at"> & {
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
};

let indexesReady: Promise<void> | null = null;

async function ensureIndexes() {
  if (!isMongoConfigured()) return;

  const collection = (await getMongoDb()).collection<StoredOtpRecord>("public_intake_otp_codes");
  await Promise.all([
    collection.createIndex({ id: 1 }, { unique: true }),
    collection.createIndex({ phone: 1, consumedAt: 1, createdAt: -1 }),
    collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}

async function getCollection() {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured");

  indexesReady ??= ensureIndexes();
  await indexesReady;
  return (await getMongoDb()).collection<StoredOtpRecord>("public_intake_otp_codes");
}

export async function createPublicIntakeOtpInMongo(input: {
  phone: string;
  email: string | null;
  codeHash: string;
  maxAttempts: number;
  expiresAt: string;
}) {
  const collection = await getCollection();
  const now = new Date();
  await collection.updateMany(
    { phone: input.phone, consumedAt: null },
    { $set: { consumedAt: now } },
  );

  const record: StoredOtpRecord = {
    id: randomUUID(),
    phone: input.phone,
    email: input.email,
    code_hash: input.codeHash,
    attempt_count: 0,
    max_attempts: input.maxAttempts,
    expiresAt: new Date(input.expiresAt),
    consumedAt: null,
    createdAt: now,
  };
  await collection.insertOne(record);
  return toPublicOtpRecord(record);
}

export async function getLatestActivePublicIntakeOtpFromMongo(phone: string) {
  const record = await (await getCollection()).findOne(
    { phone, consumedAt: null },
    { sort: { createdAt: -1 } },
  );
  return record ? toPublicOtpRecord(record) : null;
}

export async function incrementPublicIntakeOtpAttemptInMongo(record: PublicIntakeOtpRecord) {
  const result = await (await getCollection()).updateOne(
    {
      id: record.id,
      consumedAt: null,
      attempt_count: record.attempt_count,
      expiresAt: { $gt: new Date() },
    },
    { $inc: { attempt_count: 1 } },
  );
  return result.modifiedCount === 1;
}

export async function consumePublicIntakeOtpInMongo(record: PublicIntakeOtpRecord) {
  const consumedAt = new Date();
  const result = await (await getCollection()).updateOne(
    {
      id: record.id,
      consumedAt: null,
      attempt_count: record.attempt_count,
      expiresAt: { $gt: consumedAt },
    },
    { $set: { consumedAt } },
  );
  return result.modifiedCount === 1;
}

function toPublicOtpRecord(record: StoredOtpRecord): PublicIntakeOtpRecord {
  return {
    id: record.id,
    phone: record.phone,
    email: record.email,
    code_hash: record.code_hash,
    attempt_count: record.attempt_count,
    max_attempts: record.max_attempts,
    expires_at: record.expiresAt.toISOString(),
    consumed_at: record.consumedAt?.toISOString() ?? null,
    created_at: record.createdAt.toISOString(),
  };
}
