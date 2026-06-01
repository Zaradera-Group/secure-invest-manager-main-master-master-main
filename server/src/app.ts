import cors from "cors";
import express from "express";
import { authRouter } from "./routes/auth.js";
import { certificatesRouter } from "./routes/certificates.js";
import { investorsRouter } from "./routes/investors.js";
import { publicIntakeRouter } from "./routes/public-intake.js";

export const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.use("/auth", authRouter);
app.use("/public", publicIntakeRouter);
app.use("/certificates", certificatesRouter);
app.use("/investors", investorsRouter);

app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  response.status(500).json({
    message: error.message || "Unexpected server error",
  });
});
