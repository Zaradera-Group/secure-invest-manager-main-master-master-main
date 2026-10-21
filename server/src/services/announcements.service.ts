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
    const requiresMongo = env.ANNOUNCEMENTS_DATA_SOURCE === "mongo";
    if ((requiresMongo || env.ANNOUNCEMENTS_MONGO_READ_MODE === "mongo") && isMongoConfigured()) {
      try {
        const announcements = await listWorkflowRecordsFromMongo("announcements") as unknown as AnnouncementRecord[];
        const from = page * pageSize;
        return {
          data: announcements.slice(from, from + pageSize),
          count: announcements.length,
        };
      } catch (error) {
        console.warn("[workflow-data.mongo] MongoDB announcement read failed; falling back to Supabase", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (requiresMongo) {
      throw new Error("MongoDB is required when ANNOUNCEMENTS_DATA_SOURCE=mongo");
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

    if (env.ANNOUNCEMENTS_DATA_SOURCE === "mongo") {
      if (!isMongoConfigured()) {
        throw new Error("MongoDB is required when ANNOUNCEMENTS_DATA_SOURCE=mongo");
      }

      const record: AnnouncementRecord = {
        id: randomUUID(),
        ...announcement,
        created_at: new Date().toISOString(),
      };
      await mirrorWorkflowRecordsToMongo({ table: "announcements", records: [record] });
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
    mirrorWorkflowRecordsToMongoSafely({
      table: "announcements",
      records: [record],
    });

    return record;
  }

  async remove(id: string) {
    if (!id.trim()) {
      throw new AnnouncementValidationError("Announcement ID is required");
    }

    if (env.ANNOUNCEMENTS_DATA_SOURCE === "mongo") {
      if (!isMongoConfigured()) {
        throw new Error("MongoDB is required when ANNOUNCEMENTS_DATA_SOURCE=mongo");
      }

      await deleteWorkflowRecordsFromMongo({ table: "announcements", supabaseIds: [id] });
      return;
    }

    const { error } = await adminSupabase.from("announcements").delete().eq("id", id);
    if (error) {
      throw new Error(`Failed to delete announcement: ${error.message}`);
    }

    deleteWorkflowRecordsFromMongoSafely({
      table: "announcements",
      supabaseIds: [id],
    });
  }
}
