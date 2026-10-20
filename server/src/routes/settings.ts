import { Router } from "express";
import {
  getApprovalAvailability,
  updateApprovalAvailability,
} from "../controllers/approval-availability.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const settingsRouter = Router();

settingsRouter.use(requireAuth, requireRole("investment_manager", "accountant", "general_manager"));
settingsRouter.get("/approval-availability", getApprovalAvailability);
settingsRouter.patch("/approval-availability", updateApprovalAvailability);
