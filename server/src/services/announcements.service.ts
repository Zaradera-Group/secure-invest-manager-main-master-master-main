import { env } from "../config/env.js";
import { randomUUID } from "node:crypto";
import { isMongoConfigured } from "../lib/mongodb.js";
import { adminSupabase } from "../lib/supabase.js";
import {
  deleteWorkflowRecordsFromMongo,
  deleteWorkflowRecordsFromMongoSafely,
  listWorkflowRecordsFromMongo,
  mirrorWorkflowRecordsToMongo,
  mirrorWorkflowRecordsToMongoSafely,
} from "../repositories/workflow-data.mongo.js";

export type AnnouncementStatus = "info" | "urgent" | "matured";

type AnnouncementRecord = {
  id: string;
  title: string;
  detail: string;
  status: AnnouncementStatus;
  created_at: string;
};

export class AnnouncementValidationError extends Error {}

const validStatuses = new Set<AnnouncementStatus>(["info", "urgent", "matured"]);

const parseAnnouncement = (input: unknown) => {
  if (!input || typeof input !== "object") {
    throw new AnnouncementValidationError("Announcement details are required");
  }

  const candidate = input as Record<string, unknown>;
  const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
  const detail = typeof candidate.detail === "string" ? candidate.detail.trim() : "";
  const status = candidate.status;

  if (!title || !detail) {
    throw new AnnouncementValidationError("Announcement title and details are required");
  }

  if (title.length > 200 || detail.length > 5_000) {
    throw new AnnouncementValidationError("Announcement content exceeds the permitted length");
  }

  if (typeof status !== "string" || !validStatuses.has(status as AnnouncementStatus)) {
    throw new AnnouncementValidationError("Announcement status must be info, urgent, or matured");
  }

  return { title, detail, status: status as AnnouncementStatus };
};

export class AnnouncementsService {
  async list(page: number, pageSize: number) {
    const requiresMongo = env.ANNOUNCEMENTS_DATA_SOURCE === "mongo"
      || env.ANNOUNCEMENTS_WRITE_MODE === "mongo"
      || env.ANNOUNCEMENTS_MONGO_READ_MODE === "mongo";
    if (requiresMongo && !isMongoConfigured()) {
      throw new Error("MongoDB is required for Mongo-primary announcements");
    }
    if (requiresMongo) {
      try {
        const announcements = await listWorkflowRecordsFromMongo("announcements") as unknown as AnnouncementRecord[];
        const from = page * pageSize;
        return {
          data: announcements.slice(from, from + pageSize),
          count: announcements.length,
        };
      } catch (error) {
        throw new Error(`Failed to fetch announcements from MongoDB: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await adminSupabase
      .from("announcements")
      .select("id, title, detail, status, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to fetch announcements: ${error.message}`);
    }

    return { data: (data ?? []) as AnnouncementRecord[], count: count ?? 0 };
  }

  async create(input: unknown) {
    const announcement = parseAnnouncement(input);

    const mongoPrimary = env.ANNOUNCEMENTS_DATA_SOURCE === "mongo"
      || env.ANNOUNCEMENTS_WRITE_MODE === "mongo";
    if (mongoPrimary) {
      if (!isMongoConfigured()) {
        throw new Error("MongoDB is required for Mongo-primary announcements");
      }

      const record: AnnouncementRecord = {
        id: randomUUID(),
        ...announcement,
        created_at: new Date().toISOString(),
      };
      await mirrorWorkflowRecordsToMongo({ table: "announcements", records: [record] });
      await this.mirrorAnnouncementToSupabase(record);
      return record;
    }

    const { data, error } = await adminSupabase
      .from("announcements")
      .insert(announcement)
      .select("id, title, detail, status, created_at")
      .single();

    if (error) {
      throw new Error(`Failed to create announcement: ${error.message}`);
    }

    const record = data as AnnouncementRecord;
    if (env.ANNOUNCEMENTS_WRITE_MODE === "dual") {
      if (!isMongoConfigured()) {
        throw new Error("MongoDB is required while ANNOUNCEMENTS_WRITE_MODE=dual");
      }
      await mirrorWorkflowRecordsToMongo({ table: "announcements", records: [record] });
    } else {
      mirrorWorkflowRecordsToMongoSafely({ table: "announcements", records: [record] });
    }

    return record;
  }

  async remove(id: string) {
    if (!id.trim()) {
      throw new AnnouncementValidationError("Announcement ID is required");
    }

    const mongoPrimary = env.ANNOUNCEMENTS_DATA_SOURCE === "mongo"
      || env.ANNOUNCEMENTS_WRITE_MODE === "mongo";
    if (mongoPrimary) {
      if (!isMongoConfigured()) {
        throw new Error("MongoDB is required for Mongo-primary announcements");
      }

      await deleteWorkflowRecordsFromMongo({ table: "announcements", supabaseIds: [id] });
      const { error } = await adminSupabase.from("announcements").delete().eq("id", id);
      if (error) {
        console.warn("[workflow-data.mongo] Announcement deleted in MongoDB but Supabase compatibility cleanup failed", {
          announcementId: id,
          reason: error.message,
        });
      }
      return;
    }

    const { error } = await adminSupabase.from("announcements").delete().eq("id", id);
    if (error) {
      throw new Error(`Failed to delete announcement: ${error.message}`);
    }

    if (env.ANNOUNCEMENTS_WRITE_MODE === "dual") {
      if (!isMongoConfigured()) {
        throw new Error("MongoDB is required while ANNOUNCEMENTS_WRITE_MODE=dual");
      }
      await deleteWorkflowRecordsFromMongo({ table: "announcements", supabaseIds: [id] });
    } else {
      deleteWorkflowRecordsFromMongoSafely({ table: "announcements", supabaseIds: [id] });
    }
  }

  private async mirrorAnnouncementToSupabase(record: AnnouncementRecord) {
    const { error } = await adminSupabase
      .from("announcements")
      .upsert(record, { onConflict: "id" });

    if (error) {
      console.warn("[workflow-data.mongo] Announcement written to MongoDB but Supabase compatibility mirror failed", {
        announcementId: record.id,
        reason: error.message,
      });
    }
  }
}
