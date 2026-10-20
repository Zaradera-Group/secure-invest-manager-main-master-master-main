import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { uploadObject } from "../lib/storage.js";
import type { AuthenticatedUser } from "../types/certificates.js";

const passportSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  dataBase64: z.string().min(1),
});

const MAX_PASSPORT_BYTES = 5 * 1024 * 1024;

export class IdentityService {
  async uploadPassport(actor: AuthenticatedUser, input: unknown) {
    const file = passportSchema.parse(input);
    const bytes = Buffer.from(file.dataBase64, "base64");
    if (!bytes.length || bytes.length > MAX_PASSPORT_BYTES) {
      throw new Error("Passport image must be between 1 byte and 5 MB");
    }

    const extension = file.contentType.split("/")[1];
    const storagePath = `passports/${actor.id}/${randomUUID()}.${extension}`;
    const uploadedPath = await uploadObject({
      path: storagePath,
      bytes,
      contentType: file.contentType,
      supabaseBucket: env.INVESTOR_PASSPORT_STORAGE_BUCKET,
      upsert: false,
    });

    return { passportPhotoUrl: uploadedPath };
  }
}
