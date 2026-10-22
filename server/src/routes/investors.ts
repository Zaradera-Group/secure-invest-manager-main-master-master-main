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

investorsRouter.use(requireWorkflowAuth);

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
  "/dashboard/portfolio-summary",
  requireRole("investment_manager", "accountant", "general_manager", "admin", "super_admin"),
  getDashboardPortfolioSummary,
);

investorsRouter.get(
  "/dashboard/investment-types",
  requireRole("investment_manager", "accountant", "general_manager", "admin", "super_admin"),
  getDashboardInvestmentTypeSummary,
);

investorsRouter.get(
  "/dashboard/upcoming-maturities",
  requireRole("investment_manager", "accountant", "general_manager", "admin", "super_admin"),
  getDashboardUpcomingMaturities,
);

investorsRouter.get(
  "/maturity-alerts",
  requireRole("investment_manager", "accountant", "general_manager", "admin", "super_admin"),
  getMaturityAlerts,
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
