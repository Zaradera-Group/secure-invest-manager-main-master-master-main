import { Router } from "express";
import { uploadInvestorPassport } from "../controllers/identity.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const identityRouter = Router();

identityRouter.use(requireAuth, requireRole("investment_manager", "accountant", "admin"));
identityRouter.post("/passport", uploadInvestorPassport);
