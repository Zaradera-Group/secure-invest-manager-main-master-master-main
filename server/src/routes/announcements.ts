import { Router } from "express";
import { listAnnouncements } from "../controllers/announcements.controller.js";

export const announcementsRouter = Router();

announcementsRouter.get("/", listAnnouncements);
