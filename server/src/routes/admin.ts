import { Router } from "express";
import { getCreatorDirectory, getRecentInvestorActivity, getRoleCounts } from "../controllers/admin.controller.js";
import { createAnnouncement, deleteAnnouncement } from "../controllers/announcements.controller.js";
import { requireRole, requireWorkflowAuth } from "../middleware/auth.js";

export const adminRouter = Router();

adminRouter.use(requireWorkflowAuth, requireRole("admin", "super_admin"));
adminRouter.get("/overview/creator-directory", getCreatorDirectory);
adminRouter.get("/overview/role-counts", getRoleCounts);
adminRouter.get("/overview/investor-activity", getRecentInvestorActivity);
adminRouter.post("/announcements", createAnnouncement);
adminRouter.delete("/announcements/:id", deleteAnnouncement);
