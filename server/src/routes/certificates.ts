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

const certificateReadRoles = ["investment_manager", "accountant", "general_manager", "super_admin", "admin", "software_engineer"] as const;

certificatesRouter.get("/inbox", requireRole(...certificateReadRoles), getCertificateInbox);
certificatesRouter.get("/pending-approval-count", requireRole(...certificateReadRoles), getPendingApprovalCount);
certificatesRouter.get("/", requireRole(...certificateReadRoles), listCertificates);
certificatesRouter.get("/by-investor", requireRole(...certificateReadRoles), getLatestCertificateByInvestor);
certificatesRouter.get("/:id/approval-events", requireRole(...certificateReadRoles), getCertificateApprovalEvents);
certificatesRouter.post("/create", requireRole("investment_manager", "accountant", "super_admin", "admin"), createCertificate);
certificatesRouter.post("/:id/manager-approve", requireRole("investment_manager", "accountant", "admin"), managerApprove);
certificatesRouter.get("/:id/file", requireRole(...certificateReadRoles), getCertificateFile);
certificatesRouter.get("/:id/download", requireRole(...certificateReadRoles), getCertificateDownloadUrl);
certificatesRouter.post(
  "/:id/general-manager-approve",
  requireRole("general_manager", "admin"),
  generalManagerApprove,
);
certificatesRouter.post("/:id/ceo-approve", requireRole("super_admin", "admin"), ceoApprove);
certificatesRouter.post("/:id/send", requireRole("investment_manager", "accountant", "general_manager", "admin"), sendCertificate);
