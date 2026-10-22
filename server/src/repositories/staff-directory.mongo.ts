import { getMongoDb, isMongoConfigured } from "../lib/mongodb.js";

export type StaffDirectoryEntry = {
  userId: string;
  fullName: string | null;
  roles: string[];
  approvalAvailability: Record<string, boolean>;
};

type StaffDirectoryDocument = StaffDirectoryEntry & {
  mirroredAt?: string;
};

let indexesReady: Promise<void> | null = null;

async function ensureIndexes() {
  if (!isMongoConfigured()) return;

  const collection = (await getMongoDb()).collection<StaffDirectoryDocument>("staff_directory");
  await Promise.all([
    collection.createIndex({ userId: 1 }, { unique: true }),
    collection.createIndex({ roles: 1, userId: 1 }),
  ]);
}

async function getCollection() {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured");

  indexesReady ??= ensureIndexes();
  await indexesReady;
  return (await getMongoDb()).collection<StaffDirectoryDocument>("staff_directory");
}

export async function mirrorStaffDirectoryToMongo(entries: StaffDirectoryEntry[]) {
  if (!entries.length) return 0;

  const collection = await getCollection();
  const mirroredAt = new Date().toISOString();
  await collection.bulkWrite(
    entries.map((entry) => ({
      updateOne: {
        filter: { userId: entry.userId },
        update: {
          $set: { ...entry, mirroredAt },
          $setOnInsert: { insertedAt: mirroredAt },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  return entries.length;
}

export async function listStaffDirectoryFromMongo() {
  const collection = await getCollection();
  return collection.find({}, { projection: { _id: 0 } }).sort({ fullName: 1, userId: 1 }).toArray();
}

export async function getStaffDirectoryEntryFromMongo(userId: string) {
  const collection = await getCollection();
  return collection.findOne({ userId }, { projection: { _id: 0 } });
}

export async function updateApprovalAvailabilityInMongo(input: {
  userId: string;
  role: string;
  available: boolean;
}) {
  const collection = await getCollection();
  const result = await collection.updateOne(
    { userId: input.userId, roles: input.role },
    {
      $set: {
        [`approvalAvailability.${input.role}`]: input.available,
        mirroredAt: new Date().toISOString(),
      },
    },
  );

  if (result.matchedCount !== 1) {
    throw new Error("Staff directory role assignment was not found in MongoDB");
  }

  return input.available;
}

export function mirrorApprovalAvailabilityToMongoSafely(input: {
  userId: string;
  role: string;
  available: boolean;
}) {
  if (!isMongoConfigured()) return;

  void getCollection()
    .then((collection) => collection.updateOne(
      { userId: input.userId },
      {
        $set: {
          [`approvalAvailability.${input.role}`]: input.available,
          mirroredAt: new Date().toISOString(),
        },
        $addToSet: { roles: input.role },
        $setOnInsert: {
          fullName: null,
        },
      },
      { upsert: true },
    ))
    .catch((error) => {
      console.warn("[staff-directory.mongo] Failed to mirror approval availability", {
        userId: input.userId,
        role: input.role,
        reason: error instanceof Error ? error.message : String(error),
      });
    });
}
