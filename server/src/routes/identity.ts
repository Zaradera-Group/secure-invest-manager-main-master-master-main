import { Router } from "express";
import { uploadInvestorPassport } from "../controllers/identity.controller.js";
import { requireRole, requireWorkflowAuth } from "../middleware/auth.js";

export const identityRouter = Router();

identityRouter.use(requireWorkflowAuth, requireRole("investment_manager", "accountant", "admin"));
identityRouter.post("/passport", uploadInvestorPassport);
