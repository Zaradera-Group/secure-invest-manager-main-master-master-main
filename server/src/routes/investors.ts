import { Router } from "express";
import {
  createInvestor,
  deleteInvestorCompletely,
  getInvestor,
  listInvestors,
  refreshInvestorCertificate,
  updateInvestorAndRefreshCertificate,
} from "../controllers/investors.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const investorsRouter = Router();

investorsRouter.use(requireAuth);

investorsRouter.post(
  "/",
  requireRole("investment_manager", "accountant", "general_manager", "admin", "super_admin"),
  createInvestor,
);

investorsRouter.get(
  "/",
  requireRole("investment_manager", "accountant", "general_manager", "admin", "super_admin"),
  listInvestors,
);

investorsRouter.get(
  "/:id",
  requireRole("investment_manager", "accountant", "general_manager", "admin", "super_admin"),
  getInvestor,
);

investorsRouter.post(
  "/:id/sync-certificate",
  requireRole("investment_manager", "accountant", "general_manager", "admin", "super_admin"),
  refreshInvestorCertificate,
);

investorsRouter.patch(
  "/:id",
  requireRole("investment_manager", "accountant", "general_manager", "admin", "super_admin"),
  updateInvestorAndRefreshCertificate,
);

investorsRouter.delete(
  "/:id",
  requireRole("investment_manager", "accountant", "general_manager", "admin", "super_admin"),
  deleteInvestorCompletely,
);
