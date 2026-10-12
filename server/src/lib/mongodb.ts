import { MongoClient, type Db } from "mongodb";
import { env } from "../config/env.js";

let client: MongoClient | null = null;
let connecting: Promise<MongoClient> | null = null;

export function isMongoConfigured() {
  return Boolean(env.MONGODB_URI && env.MONGODB_DB_NAME);
}

export async function getMongoClient() {
  if (!env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not configured");
  }

  if (client) {
    return client;
  }

  connecting ??= MongoClient.connect(env.MONGODB_URI, {
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 10000,
  });

  client = await connecting;
  return client;
}

export async function getMongoDb(): Promise<Db> {
  if (!env.MONGODB_DB_NAME) {
    throw new Error("MONGODB_DB_NAME is not configured");
  }

  const mongoClient = await getMongoClient();
  return mongoClient.db(env.MONGODB_DB_NAME);
}

export async function checkMongoHealth() {
  const db = await getMongoDb();
  await db.command({ ping: 1 });

  return {
    database: db.databaseName,
    status: "ok",
  };
}
