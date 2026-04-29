import { Router } from "express";
import {
  ceoApprove,
  createCertificate,
  getCertificateFile,
  getCertificateDownloadUrl,
  generalManagerApprove,
  managerApprove,
  sendCertificate,
} from "../controllers/certificates.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const certificatesRouter = Router();

certificatesRouter.use(requireAuth);

certificatesRouter.post("/create", requireRole("investment_manager", "general_manager", "super_admin", "admin"), createCertificate);
certificatesRouter.post("/:id/manager-approve", requireRole("investment_manager", "admin"), managerApprove);
certificatesRouter.get("/:id/file", requireRole("investment_manager", "general_manager", "super_admin", "admin"), getCertificateFile);
certificatesRouter.get("/:id/download", requireRole("investment_manager", "general_manager", "super_admin", "admin"), getCertificateDownloadUrl);
certificatesRouter.post(
  "/:id/general-manager-approve",
  requireRole("general_manager", "admin"),
  generalManagerApprove,
);
certificatesRouter.post("/:id/ceo-approve", requireRole("super_admin", "admin"), ceoApprove);
certificatesRouter.post("/:id/send", requireRole("investment_manager", "general_manager", "admin"), sendCertificate);
