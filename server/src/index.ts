import "./types/express.js";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { startBirthdaySmsJob } from "./jobs/birthday-sms.job.js";

app.listen(env.PORT, () => {
  console.log(`Certificate workflow API listening on port ${env.PORT}`);
  startBirthdaySmsJob();
});
