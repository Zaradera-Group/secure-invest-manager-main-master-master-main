import { Router } from "express";
import { deleteInvestorCompletely, refreshInvestorCertificate } from "../controllers/investors.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const investorsRouter = Router();

investorsRouter.use(requireAuth);

investorsRouter.post(
  "/:id/sync-certificate",
  requireRole("investment_manager", "general_manager", "admin", "super_admin"),
  refreshInvestorCertificate,
);

investorsRouter.delete(
  "/:id",
  requireRole("investment_manager", "general_manager", "admin", "super_admin"),
  deleteInvestorCompletely,
);
