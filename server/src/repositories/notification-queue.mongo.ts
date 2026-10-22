import { randomUUID } from "node:crypto";
import { getMongoDb, isMongoConfigured } from "../lib/mongodb.js";
import { adminSupabase } from "../lib/supabase.js";

const queueStatuses = ["pending", "processing", "completed", "failed", "cancelled"] as const;
export type NotificationQueueStatus = (typeof queueStatuses)[number];

type SupabaseNotificationJob = Record<string, unknown> & {
  id: string;
  status: NotificationQueueStatus;
  scheduled_for: string;
  locked_at?: string | null;
};

type MirroredNotificationQueueJob = {
  supabaseJobId: string;
  status: NotificationQueueStatus;
  scheduledAt: string;
  lockedAt: string | null;
  rawSupabaseRecord: SupabaseNotificationJob;
  reconciliationRunId: string;
};

export type MirroredNotificationQueueJobRecord = Pick<MirroredNotificationQueueJob, "supabaseJobId" | "status" | "scheduledAt" | "lockedAt" | "rawSupabaseRecord">;

export type NotificationQueueSnapshot = {
  observedAt: string;
  statusCounts: Record<NotificationQueueStatus, number>;
  duePending: number;
  staleProcessing: number;
};

const collectionName = "notification_queue_jobs";
let indexesReady: Promise<void> | null = null;

async function getCollection() {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured");

  indexesReady ??= (async () => {
    const collection = (await getMongoDb()).collection<MirroredNotificationQueueJob>(collectionName);
    await Promise.all([
      collection.createIndex({ supabaseJobId: 1 }, { unique: true }),
      collection.createIndex({ status: 1, scheduledAt: 1 }),
      collection.createIndex({ status: 1, lockedAt: 1 }),
    ]);
  })();
  await indexesReady;
  return (await getMongoDb()).collection<MirroredNotificationQueueJob>(collectionName);
}

function toMirroredJob(record: SupabaseNotificationJob, reconciliationRunId: string): MirroredNotificationQueueJob {
  return {
    supabaseJobId: record.id,
    status: record.status,
    scheduledAt: record.scheduled_for,
    lockedAt: record.locked_at ?? null,
    rawSupabaseRecord: record,
    reconciliationRunId,
  };
}

export async function reconcileNotificationQueueToMongo(pageSize = 250) {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured");

  const collection = await getCollection();
  const reconciliationRunId = randomUUID();
  let from = 0;
  let mirrored = 0;

  while (true) {
    const { data, error } = await adminSupabase
      .from("notification_jobs")
      .select("*")
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to reconcile notification queue: ${error.message}`);
    if (!data?.length) break;

    const mirroredAt = new Date().toISOString();
    const records = data as SupabaseNotificationJob[];
    await collection.bulkWrite(records.map((record) => ({
      updateOne: {
        filter: { supabaseJobId: record.id },
        update: {
          $set: { ...toMirroredJob(record, reconciliationRunId), mirroredAt },
          $setOnInsert: { insertedAt: mirroredAt },
        },
        upsert: true,
      },
    })), { ordered: false });

    mirrored += records.length;
    if (records.length < pageSize) break;
    from += pageSize;
  }

  await collection.deleteMany({ reconciliationRunId: { $ne: reconciliationRunId } });
  return mirrored;
}

export async function getNotificationQueueSnapshotFromMongo(now = new Date()): Promise<NotificationQueueSnapshot> {
  const collection = await getCollection();
  const observedAt = now.toISOString();
  const staleBefore = new Date(now.getTime() - 15 * 60 * 1000).toISOString();

  const statusEntries = await Promise.all(queueStatuses.map(async (status) => [
    status,
    await collection.countDocuments({ status }),
  ] as const));
  const [duePending, staleProcessing] = await Promise.all([
    collection.countDocuments({ status: "pending", scheduledAt: { $lte: observedAt } }),
    collection.countDocuments({ status: "processing", lockedAt: { $ne: null, $lte: staleBefore } }),
  ]);

  return {
    observedAt,
    statusCounts: Object.fromEntries(statusEntries) as Record<NotificationQueueStatus, number>,
    duePending,
    staleProcessing,
  };
}

export async function listActiveNotificationQueueJobsFromMongo(limit = 500): Promise<MirroredNotificationQueueJobRecord[]> {
  const collection = await getCollection();
  return collection
    .find(
      { status: { $in: ["pending", "processing", "failed"] } },
      { projection: { supabaseJobId: 1, status: 1, scheduledAt: 1, lockedAt: 1, rawSupabaseRecord: 1 } },
    )
    .sort({ scheduledAt: 1, supabaseJobId: 1 })
    .limit(limit)
    .toArray();
}
