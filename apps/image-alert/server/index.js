import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createTransport } from "../lib/email.js";
import { createApp } from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
dotenv.config({ path: path.join(rootDir, ".env") });

const port = Number(process.env.PORT || 3847);
const dataDir = path.join(rootDir, "data");
const transport = createTransport(process.env);
const app = createApp({ env: process.env, transport, dataDir });

app.listen(port, () => {
  const mode = process.env.SMTP_HOST ? "SMTP" : "outbox (no SMTP configured)";
  console.log(`LensAlert running at http://localhost:${port}`);
  console.log(`Email delivery: ${mode}`);
});
