import { Router } from "express";
import { getIntakeRequest, listIntakeRequests, removeIntakeRequest, updateIntakeRequest } from "../controllers/intake.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const intakeRouter = Router();

intakeRouter.use(requireAuth, requireRole("investment_manager", "accountant", "general_manager", "admin", "super_admin"));
intakeRouter.get("/requests", listIntakeRequests);
intakeRouter.get("/requests/:id", getIntakeRequest);
intakeRouter.patch("/requests/:id", updateIntakeRequest);
intakeRouter.delete("/requests/:id", removeIntakeRequest);
