import { env } from "../config/env.js";
import { isMongoConfigured } from "../lib/mongodb.js";
import { z } from "zod";
import { adminSupabase } from "../lib/supabase.js";
import {
  getStaffDirectoryEntryFromMongo,
  mirrorApprovalAvailabilityToMongoSafely,
  updateApprovalAvailabilityInMongo,
} from "../repositories/staff-directory.mongo.js";
import type { AuthenticatedUser } from "../types/certificates.js";

const approvalRoles = new Set(["investment_manager", "accountant", "general_manager"]);
const updateAvailabilitySchema = z.object({
  available: z.boolean(),
});

export class ApprovalAvailabilityService {
  async get(actor: AuthenticatedUser) {
    this.assertApprovalRole(actor);

    const requiresMongo = env.STAFF_DIRECTORY_MONGO_READ_MODE === "mongo";
    if (requiresMongo && !isMongoConfigured()) {
      throw new Error("MongoDB is required for Mongo-primary approval availability reads");
    }

    if (requiresMongo) {
      try {
        const staffMember = await getStaffDirectoryEntryFromMongo(actor.id);
        if (staffMember) {
          return { available: staffMember.approvalAvailability[actor.role] ?? true };
        }
      } catch (error) {
        throw new Error(`Failed to fetch approval availability from MongoDB: ${error instanceof Error ? error.message : String(error)}`);
      }

      return { available: false };
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

    if (env.STAFF_DIRECTORY_MONGO_WRITE_MODE === "mongo") {
      if (!isMongoConfigured()) {
        throw new Error("MongoDB is required while STAFF_DIRECTORY_MONGO_WRITE_MODE=mongo");
      }

      try {
        return {
          available: await updateApprovalAvailabilityInMongo({
            userId: actor.id,
            role: actor.role,
            available,
          }),
        };
      } catch (error) {
        throw new Error(`Failed to update approval availability in MongoDB: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

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

    if (env.STAFF_DIRECTORY_MONGO_WRITE_MODE === "dual") {
      if (!isMongoConfigured()) {
        throw new Error("MongoDB is required while STAFF_DIRECTORY_MONGO_WRITE_MODE=dual");
      }

      try {
        await updateApprovalAvailabilityInMongo({
          userId: actor.id,
          role: actor.role,
          available: data.is_available_for_approvals,
        });
      } catch (error) {
        throw new Error(`Failed to mirror approval availability to MongoDB: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (env.STAFF_DIRECTORY_MONGO_WRITE_MODE === "supabase") {
      mirrorApprovalAvailabilityToMongoSafely({
        userId: actor.id,
        role: actor.role,
        available: data.is_available_for_approvals,
      });
    }

    return { available: data.is_available_for_approvals };
  }

  private assertApprovalRole(actor: AuthenticatedUser) {
    if (!approvalRoles.has(actor.role)) {
      throw new Error("Forbidden for current role");
    }
  }
}
