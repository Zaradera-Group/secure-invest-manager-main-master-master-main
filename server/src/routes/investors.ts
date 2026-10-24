import { Router } from "express";
import {
  createInvestor,
  deleteInvestorCompletely,
  getDashboardInvestmentTypeSummary,
  getDashboardPortfolioSummary,
  getDashboardUpcomingMaturities,
  getInvestor,
  getMaturityAlerts,
  listInvestors,
  refreshInvestorCertificate,
  updateInvestorAndRefreshCertificate,
} from "../controllers/investors.controller.js";
import { requireRole, requireWorkflowAuth } from "../middleware/auth.js";

export const investorsRouter = Router();

const investorReadRoles = [
  "investment_manager",
  "accountant",
  "general_manager",
  "admin",
  "super_admin",
  "software_engineer",
] as const;

investorsRouter.use(requireWorkflowAuth);

investorsRouter.post(
  "/",
  requireRole("investment_manager", "accountant", "general_manager", "admin", "super_admin"),
  createInvestor,
);

investorsRouter.get(
  "/",
  requireRole(...investorReadRoles),
  listInvestors,
);

investorsRouter.get(
  "/dashboard/portfolio-summary",
  requireRole(...investorReadRoles),
  getDashboardPortfolioSummary,
);

investorsRouter.get(
  "/dashboard/investment-types",
  requireRole(...investorReadRoles),
  getDashboardInvestmentTypeSummary,
);

investorsRouter.get(
  "/dashboard/upcoming-maturities",
  requireRole(...investorReadRoles),
  getDashboardUpcomingMaturities,
);

investorsRouter.get(
  "/maturity-alerts",
  requireRole(...investorReadRoles),
  getMaturityAlerts,
);

investorsRouter.get(
  "/:id",
  requireRole(...investorReadRoles),
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
