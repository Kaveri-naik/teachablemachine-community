import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createTransport, smtpConfigured } from "../lib/email.js";
import { createApp } from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
dotenv.config({ path: path.join(rootDir, ".env") });

if (process.env.GMAIL_APP_PASSWORD && !process.env.SMTP_PASS) {
  process.env.SMTP_PASS = process.env.GMAIL_APP_PASSWORD;
}
process.env.ALERT_TO ||= "kaveri.naik@gmail.com";
process.env.ALERT_FROM ||= "LensAlert <kaveri.naik@gmail.com>";
process.env.SMTP_USER ||= "kaveri.naik@gmail.com";
if (process.env.SMTP_PASS && !process.env.SMTP_HOST) {
  process.env.SMTP_HOST = "smtp.gmail.com";
}

const port = Number(process.env.PORT || 3847);
const dataDir = path.join(rootDir, "data");
const transport = createTransport(process.env);
const app = createApp({ env: process.env, transport, dataDir });

app.listen(port, () => {
  const mode = smtpConfigured(process.env) ? "SMTP (Gmail)" : "outbox (Gmail App Password not set)";
  console.log(`LensAlert running at http://localhost:${port}`);
  console.log(`Email delivery: ${mode}`);
});
