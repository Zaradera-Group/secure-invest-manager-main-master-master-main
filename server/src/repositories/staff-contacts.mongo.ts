import { getMongoDb, isMongoConfigured } from "../lib/mongodb.js";

export type StaffContact = {
  userId: string;
  email: string | null;
  phone: string | null;
  roles: string[];
  isActive: boolean;
  mirroredAt?: string;
};

let indexesReady: Promise<void> | null = null;

async function getCollection() {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured");

  indexesReady ??= (async () => {
    const collection = (await getMongoDb()).collection<StaffContact>("staff_contacts");
    await Promise.all([
      collection.createIndex({ userId: 1 }, { unique: true }),
      collection.createIndex({ roles: 1, isActive: 1 }),
    ]);
  })();
  await indexesReady;
  return (await getMongoDb()).collection<StaffContact>("staff_contacts");
}

export async function mirrorStaffContactsToMongo(contacts: StaffContact[]) {
  if (!contacts.length) return 0;

  const collection = await getCollection();
  const mirroredAt = new Date().toISOString();
  await collection.bulkWrite(
    contacts.map((contact) => ({
      updateOne: {
        filter: { userId: contact.userId },
        update: {
          $set: { ...contact, mirroredAt },
          $setOnInsert: { insertedAt: mirroredAt },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return contacts.length;
}

export async function getStaffContactFromMongo(userId: string) {
  return (await getCollection()).findOne({ userId }, { projection: { _id: 0 } });
}

export async function listActiveStaffContactsByRoles(roles: string[]) {
  return (await getCollection())
    .find({ isActive: true, roles: { $in: roles } }, { projection: { _id: 0 } })
    .toArray();
}
