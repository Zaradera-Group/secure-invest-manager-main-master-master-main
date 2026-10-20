import { env } from "../config/env.js";
import { isMongoConfigured } from "../lib/mongodb.js";
import { z } from "zod";
import { adminSupabase } from "../lib/supabase.js";
import {
  getStaffDirectoryEntryFromMongo,
  mirrorApprovalAvailabilityToMongoSafely,
} from "../repositories/staff-directory.mongo.js";
import type { AuthenticatedUser } from "../types/certificates.js";

const approvalRoles = new Set(["investment_manager", "accountant", "general_manager"]);
const updateAvailabilitySchema = z.object({
  available: z.boolean(),
});

export class ApprovalAvailabilityService {
  async get(actor: AuthenticatedUser) {
    this.assertApprovalRole(actor);

    if (env.STAFF_DIRECTORY_MONGO_READ_MODE === "mongo" && isMongoConfigured()) {
      try {
        const staffMember = await getStaffDirectoryEntryFromMongo(actor.id);
        if (staffMember) {
          return { available: staffMember.approvalAvailability[actor.role] ?? true };
        }
      } catch (error) {
        console.warn("[staff-directory.mongo] Approval availability read failed; falling back to Supabase", {
          userId: actor.id,
          role: actor.role,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const { data, error } = await adminSupabase
      .from("user_roles")
      .select("is_available_for_approvals")
      .eq("user_id", actor.id)
      .eq("role", actor.role)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch approval availability: ${error.message}`);
    }

    return { available: data?.is_available_for_approvals ?? true };
  }

  async update(actor: AuthenticatedUser, input: unknown) {
    this.assertApprovalRole(actor);
    const { available } = updateAvailabilitySchema.parse(input);

    const { data, error } = await adminSupabase
      .from("user_roles")
      .update({ is_available_for_approvals: available })
      .eq("user_id", actor.id)
      .eq("role", actor.role)
      .select("is_available_for_approvals")
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to update approval availability: ${error.message}`);
    }

    if (!data) {
      throw new Error("Approval role assignment was not found");
    }

    mirrorApprovalAvailabilityToMongoSafely({
      userId: actor.id,
      role: actor.role,
      available: data.is_available_for_approvals,
    });

    return { available: data.is_available_for_approvals };
  }

  private assertApprovalRole(actor: AuthenticatedUser) {
    if (!approvalRoles.has(actor.role)) {
      throw new Error("Forbidden for current role");
    }
  }
}
