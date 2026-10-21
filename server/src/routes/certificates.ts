import { Router } from "express";
import {
  ceoApprove,
  createCertificate,
  getCertificateFile,
  getCertificateDownloadUrl,
  getCertificateApprovalEvents,
  getCertificateInbox,
  getLatestCertificateByInvestor,
  getPendingApprovalCount,
  listCertificates,
  generalManagerApprove,
  managerApprove,
  sendCertificate,
} from "../controllers/certificates.controller.js";
import { requireRole, requireWorkflowAuth } from "../middleware/auth.js";

export const certificatesRouter = Router();

certificatesRouter.use(requireWorkflowAuth);

certificatesRouter.get("/inbox", requireRole("investment_manager", "accountant", "general_manager", "super_admin", "admin"), getCertificateInbox);
certificatesRouter.get("/pending-approval-count", requireRole("investment_manager", "accountant", "general_manager", "super_admin", "admin"), getPendingApprovalCount);
certificatesRouter.get("/", requireRole("investment_manager", "accountant", "general_manager", "super_admin", "admin"), listCertificates);
certificatesRouter.get("/by-investor", requireRole("investment_manager", "accountant", "general_manager", "super_admin", "admin"), getLatestCertificateByInvestor);
certificatesRouter.get("/:id/approval-events", requireRole("investment_manager", "accountant", "general_manager", "super_admin", "admin"), getCertificateApprovalEvents);
certificatesRouter.post("/create", requireRole("investment_manager", "accountant", "super_admin", "admin"), createCertificate);
certificatesRouter.post("/:id/manager-approve", requireRole("investment_manager", "accountant", "admin"), managerApprove);
certificatesRouter.get("/:id/file", requireRole("investment_manager", "accountant", "general_manager", "super_admin", "admin"), getCertificateFile);
certificatesRouter.get("/:id/download", requireRole("investment_manager", "accountant", "general_manager", "super_admin", "admin"), getCertificateDownloadUrl);
certificatesRouter.post(
  "/:id/general-manager-approve",
  requireRole("general_manager", "admin"),
  generalManagerApprove,
);
certificatesRouter.post("/:id/ceo-approve", requireRole("super_admin", "admin"), ceoApprove);
certificatesRouter.post("/:id/send", requireRole("investment_manager", "accountant", "general_manager", "admin"), sendCertificate);
