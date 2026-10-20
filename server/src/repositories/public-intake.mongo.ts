import { env } from "../config/env.js";
import { getMongoDb, isMongoConfigured } from "../lib/mongodb.js";

type PublicIntakeMirrorInput = {
  requestId: string;
  intakeRecord: Record<string, unknown>;
  requestRecord: Record<string, unknown>;
  submittedAt: string;
};

type MirroredPublicIntakeDocument = {
  supabaseRequestId: string;
  rawSupabaseRecord?: Record<string, unknown>;
};

let indexesReady: Promise<void> | null = null;

async function ensurePublicIntakeIndexes() {
  if (!isMongoConfigured()) {
    return;
  }

  const db = await getMongoDb();
  const collection = db.collection("public_intake_requests");

  await Promise.all([
    collection.createIndex({ supabaseRequestId: 1 }, { unique: true }),
    collection.createIndex({ email: 1, submittedAt: -1 }),
    collection.createIndex({ status: 1, submittedAt: -1 }),
    collection.createIndex({ assignedUserId: 1, submittedAt: -1 }),
  ]);
}

export async function mirrorPublicIntakeRequestToMongo(input: PublicIntakeMirrorInput) {
  if (!env.PUBLIC_INTAKE_MONGO_MIRROR_ENABLED || !isMongoConfigured()) {
    return;
  }

  indexesReady ??= ensurePublicIntakeIndexes();
  await indexesReady;

  const db = await getMongoDb();
  const collection = db.collection("public_intake_requests");

  await collection.updateOne(
    { supabaseRequestId: input.requestId },
    {
      $set: {
        supabaseRequestId: input.requestId,
        submittedByName: input.intakeRecord.submitted_by_name ?? null,
        email: input.intakeRecord.email ?? null,
        phone: input.intakeRecord.phone ?? null,
        status: input.intakeRecord.status ?? null,
        assignedUserId: input.intakeRecord.assigned_user_id ?? null,
        assignedEmail: input.intakeRecord.assigned_email ?? null,
        submittedAt: input.submittedAt,
        source: "public_intake",
        rawIntake: input.intakeRecord,
        rawSupabaseRecord: input.requestRecord,
        mirroredAt: new Date().toISOString(),
      },
      $setOnInsert: {
        createdAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  );
}

export function mirrorPublicIntakeRequestToMongoSafely(input: PublicIntakeMirrorInput) {
  void mirrorPublicIntakeRequestToMongo(input).catch((error) => {
    console.warn("[public-intake.mongo] Failed to mirror intake request", {
      requestId: input.requestId,
      reason: error instanceof Error ? error.message : String(error),
    });
  });
}

export function deletePublicIntakeRequestFromMongoSafely(requestId: string) {
  if (!env.PUBLIC_INTAKE_MONGO_MIRROR_ENABLED || !isMongoConfigured()) return;

  void getMongoDb()
    .then((db) => db.collection("public_intake_requests").deleteOne({ supabaseRequestId: requestId }))
    .catch((error) => {
      console.warn("[public-intake.mongo] Failed to remove mirrored intake request", {
        requestId,
        reason: error instanceof Error ? error.message : String(error),
      });
    });
}

export async function listPublicIntakeRequestsFromMongo() {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured");
  }

  indexesReady ??= ensurePublicIntakeIndexes();
  await indexesReady;

  const db = await getMongoDb();
  const records = await db.collection<MirroredPublicIntakeDocument>("public_intake_requests")
    .find({}, { projection: { rawSupabaseRecord: 1, supabaseRequestId: 1 } })
    .sort({ submittedAt: -1 })
    .toArray();

  return records.flatMap((record) => record.rawSupabaseRecord ? [record.rawSupabaseRecord] : []);
}

export async function getPublicIntakeRequestFromMongo(requestId: string) {
  if (!isMongoConfigured()) {
    throw new Error("MongoDB is not configured");
  }

  indexesReady ??= ensurePublicIntakeIndexes();
  await indexesReady;

  const db = await getMongoDb();
  const record = await db.collection<MirroredPublicIntakeDocument>("public_intake_requests")
    .findOne({ supabaseRequestId: requestId }, { projection: { rawSupabaseRecord: 1 } });

  return record?.rawSupabaseRecord ?? null;
}
