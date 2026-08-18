import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clampCooldownMs,
  clampThreshold,
  cooldownKey,
  findAlertHits,
  isInCooldown,
  isValidEmail,
  parseDataUrlImage,
  parseWatchedClasses,
} from "../lib/alert-engine.js";
import { buildAlertEmail, buildTestEmail, deliverMail, smtpConfigured } from "../lib/email.js";
import { createStore } from "../lib/store.js";
import { createMonitor } from "../lib/monitor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

function writeSse(res, event) {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function createApp({ env = process.env, transport = null, dataDir, now = () => Date.now() } = {}) {
  if (!dataDir) {
    throw new Error("dataDir is required");
  }

  const app = express();
  const store = createStore(dataDir);
  const monitor = createMonitor({ now });
  const lastSent = new Map();
  const outboxDir = path.join(dataDir, "outbox");
  const fromAddress = env.ALERT_FROM || "LensAlert <alerts@localhost>";
  const defaultCooldown = clampCooldownMs(env.ALERT_COOLDOWN_MS);

  app.disable("x-powered-by");
  app.set("monitor", monitor);
  app.use(express.json({ limit: "3mb" }));
  app.use(express.static(PUBLIC_DIR));

  app.get("/api/health", (_req, res) => {
    const status = monitor.snapshot();
    res.json({
      ok: true,
      service: "lensalert",
      monitor: { live: status.session.live, source: status.session.source },
    });
  });

  app.get("/api/config", (_req, res) => {
    res.json({
      smtpConfigured: smtpConfigured(env),
      defaultTo: env.ALERT_TO || "",
      cooldownMs: defaultCooldown,
      from: fromAddress,
    });
  });

  app.get("/api/alerts", async (_req, res) => {
    try {
      res.json({ alerts: await store.list() });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/monitor/status", (_req, res) => {
    res.json(monitor.snapshot());
  });

  app.post("/api/monitor/start", (req, res) => {
    const event = monitor.start({ source: req.body?.source || "webcam" });
    res.status(201).json({ ok: true, event, ...monitor.snapshot() });
  });

  app.post("/api/monitor/stop", (_req, res) => {
    const event = monitor.stop();
    res.json({ ok: true, event, ...monitor.snapshot() });
  });

  app.post("/api/monitor/tick", (req, res) => {
    const body = req.body || {};
    const result = monitor.tick({
      source: body.source,
      detections: body.detections,
      watchedClasses: body.watchedClasses,
      threshold: body.threshold,
      fps: body.fps,
    });
    res.json({ ok: true, ...result });
  });

  app.get("/api/monitor/events", (req, res) => {
    res.status(200);
    res.set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }
    writeSse(res, { type: "hello", at: now(), ...monitor.snapshot() });
    const unsubscribe = monitor.subscribe((event) => writeSse(res, event));
    const ping = setInterval(() => {
      res.write(`event: ping\ndata: ${now()}\n\n`);
    }, 15000);
    req.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  app.post("/api/alerts/test", async (req, res) => {
    try {
      const to = String(req.body?.to || env.ALERT_TO || "").trim();
      if (!isValidEmail(to)) {
        res.status(400).json({ error: "A valid recipient email is required" });
        return;
      }
      const mail = buildTestEmail();
      const delivery = await deliverMail({
        transport,
        from: fromAddress,
        to,
        ...mail,
        outboxDir,
      });
      res.json({ ok: true, ...delivery });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/alerts", async (req, res) => {
    try {
      const body = req.body || {};
      const to = String(body.to || env.ALERT_TO || "").trim();
      if (!isValidEmail(to)) {
        res.status(400).json({ error: "A valid recipient email is required" });
        return;
      }

      const watchedClasses = parseWatchedClasses(body.watchedClasses);
      if (!watchedClasses.length) {
        res.status(400).json({ error: "At least one watched class is required" });
        return;
      }

      const threshold = clampThreshold(body.threshold);
      const hits = findAlertHits(body.detections, { watchedClasses, threshold });
      if (!hits.length) {
        res.status(422).json({
          error: "No watched class met the confidence threshold",
          threshold,
          watchedClasses,
        });
        return;
      }

      const cooldownMs = clampCooldownMs(body.cooldownMs ?? defaultCooldown);
      const currentTime = now();
      const blocked = hits.find((hit) =>
        isInCooldown(lastSent.get(cooldownKey(to, hit.className)), cooldownMs, currentTime)
      );
      if (blocked) {
        res.status(429).json({
          error: "Alert cooldown is active for this class and recipient",
          className: blocked.className,
          cooldownMs,
        });
        return;
      }

      let snapshot = null;
      if (body.snapshot) {
        snapshot = parseDataUrlImage(body.snapshot);
      }

      const timestamp = new Date(currentTime).toISOString();
      const mail = buildAlertEmail({
        hits,
        source: body.source || "unknown",
        timestamp,
        notes: body.notes,
        includeSnapshot: Boolean(snapshot),
      });
      const delivery = await deliverMail({
        transport,
        from: fromAddress,
        to,
        ...mail,
        snapshot,
        outboxDir,
      });

      for (const hit of hits) {
        lastSent.set(cooldownKey(to, hit.className), currentTime);
      }

      const record = {
        id: `${currentTime}-${Math.random().toString(36).slice(2, 8)}`,
        at: timestamp,
        to,
        source: body.source || "unknown",
        hits,
        delivery,
        subject: mail.subject,
      };
      await store.record(record);
      monitor.alert(record);
      res.status(201).json({ ok: true, alert: record });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || "Server error" });
  });

  return app;
}
