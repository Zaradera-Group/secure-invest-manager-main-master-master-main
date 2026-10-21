import type { AppRole } from "../types/certificates.js";
import { getMongoDb, isMongoConfigured } from "../lib/mongodb.js";

export type StaffAccount = {
  auth0Subject: string;
  email: string;
  role: AppRole;
  allowedAuthUserId: string;
  legacyUserId: string;
  fullName: string | null;
  isActive: boolean;
  provisionedAt: string;
  lastVerifiedAt: string;
  lastReconciledAt?: string;
};

let indexesReady: Promise<void> | null = null;

async function getCollection() {
  if (!isMongoConfigured()) throw new Error("MongoDB is not configured");

  indexesReady ??= (async () => {
    const collection = (await getMongoDb()).collection<StaffAccount>("staff_accounts");
    await Promise.all([
      collection.createIndex({ auth0Subject: 1 }, { unique: true }),
      collection.createIndex({ email: 1 }, { unique: true }),
      collection.createIndex({ legacyUserId: 1 }, { unique: true }),
      collection.createIndex({ isActive: 1, role: 1 }),
    ]);
  })();
  await indexesReady;
  return (await getMongoDb()).collection<StaffAccount>("staff_accounts");
}

export async function getStaffAccountByEmail(email: string) {
  return (await getCollection()).findOne({ email });
}

export async function getStaffAccountByAuth0Subject(auth0Subject: string) {
  return (await getCollection()).findOne({ auth0Subject });
}

export async function listStaffAccounts() {
  return (await getCollection()).find({}).toArray();
}

export async function updateStaffAccountReconciliation(input: {
  auth0Subject: string;
  isActive: boolean;
}) {
  const now = new Date().toISOString();
  await (await getCollection()).updateOne(
    { auth0Subject: input.auth0Subject },
    { $set: { isActive: input.isActive, lastReconciledAt: now } },
  );
}

export async function upsertStaffAccount(account: Omit<StaffAccount, "provisionedAt" | "lastVerifiedAt">) {
  const collection = await getCollection();
  const now = new Date().toISOString();
  await collection.updateOne(
    { auth0Subject: account.auth0Subject },
    {
      $set: { ...account, lastVerifiedAt: now },
      $setOnInsert: { provisionedAt: now },
    },
    { upsert: true },
  );

  return collection.findOne({ auth0Subject: account.auth0Subject });
}
