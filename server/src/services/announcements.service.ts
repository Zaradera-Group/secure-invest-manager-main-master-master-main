import { adminSupabase } from "../lib/supabase.js";

export type AnnouncementStatus = "info" | "urgent" | "matured";

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

    return { data: data ?? [], count: count ?? 0 };
  }

  async create(input: unknown) {
    const announcement = parseAnnouncement(input);
    const { data, error } = await adminSupabase
      .from("announcements")
      .insert(announcement)
      .select("id, title, detail, status, created_at")
      .single();

    if (error) {
      throw new Error(`Failed to create announcement: ${error.message}`);
    }

    return data;
  }

  async remove(id: string) {
    if (!id.trim()) {
      throw new AnnouncementValidationError("Announcement ID is required");
    }

    const { error } = await adminSupabase.from("announcements").delete().eq("id", id);
    if (error) {
      throw new Error(`Failed to delete announcement: ${error.message}`);
    }
  }
}
