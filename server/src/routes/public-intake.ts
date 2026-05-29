import { Router } from "express";
import { submitPublicInvestorIntake } from "../controllers/public-intake.controller.js";

export const publicIntakeRouter = Router();

publicIntakeRouter.post("/investor-intake", submitPublicInvestorIntake);
