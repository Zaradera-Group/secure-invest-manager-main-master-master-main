import { Router } from "express";
import {
  confirmPublicIntakeOtp,
  requestPublicIntakeOtp,
  submitPublicInvestorIntake,
} from "../controllers/public-intake.controller.js";

export const publicIntakeRouter = Router();

publicIntakeRouter.post("/investor-intake/otp/send", requestPublicIntakeOtp);
publicIntakeRouter.post("/investor-intake/otp/verify", confirmPublicIntakeOtp);
publicIntakeRouter.post("/investor-intake", submitPublicInvestorIntake);
