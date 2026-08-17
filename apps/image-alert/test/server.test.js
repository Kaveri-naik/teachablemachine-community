import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../server/app.js";

function tinyJpegDataUrl() {
  // 1x1 JPEG
  return "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAD/2wAAAAD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAG/AP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z";
}

describe("LensAlert API", () => {
  let app;
  let dataDir;
  let sent;
  let clock;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "lensalert-data-"));
    sent = [];
    clock = 1_000_000;
    const transport = {
      async sendMail(message) {
        sent.push(message);
        return { messageId: `id-${sent.length}` };
      },
    };
    app = createApp({
      env: {
        ALERT_FROM: "LensAlert <alerts@example.com>",
        ALERT_TO: "default@example.com",
        SMTP_HOST: "smtp.example.com",
        ALERT_COOLDOWN_MS: "60000",
      },
      transport,
      dataDir,
      now: () => clock,
    });
  });

  it("reports health and public config", async () => {
    const health = await request(app).get("/api/health").expect(200);
    assert.equal(health.body.ok, true);
    const config = await request(app).get("/api/config").expect(200);
    assert.equal(config.body.smtpConfigured, true);
    assert.equal(config.body.defaultTo, "default@example.com");
  });

  it("rejects alerts without a valid recipient", async () => {
    const response = await request(app)
      .post("/api/alerts")
      .send({
        to: "nope",
        detections: [{ className: "person", probability: 0.9 }],
        watchedClasses: ["person"],
      })
      .expect(400);
    assert.match(response.body.error, /valid recipient/i);
  });

  it("rejects detections that miss the watched class or threshold", async () => {
    const response = await request(app)
      .post("/api/alerts")
      .send({
        to: "you@example.com",
        detections: [{ className: "cup", probability: 0.99 }],
        watchedClasses: ["person"],
        threshold: 0.6,
      })
      .expect(422);
    assert.match(response.body.error, /No watched class/i);
    assert.equal(sent.length, 0);
  });

  it("sends an email and records the alert when a rule matches", async () => {
    const response = await request(app)
      .post("/api/alerts")
      .send({
        to: "you@example.com",
        detections: [
          { className: "person", probability: 0.93 },
          { className: "chair", probability: 0.2 },
        ],
        watchedClasses: ["person"],
        threshold: 0.6,
        source: "webcam",
        snapshot: tinyJpegDataUrl(),
      })
      .expect(201);

    assert.equal(response.body.ok, true);
    assert.equal(response.body.alert.delivery.mode, "smtp");
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /person detected \(93%\)/i);
    assert.equal(sent[0].attachments[0].filename, "detection.jpg");

    const log = await request(app).get("/api/alerts").expect(200);
    assert.equal(log.body.alerts.length, 1);
    assert.equal(log.body.alerts[0].to, "you@example.com");
  });

  it("enforces cooldown for the same class and recipient", async () => {
    const payload = {
      to: "you@example.com",
      detections: [{ className: "person", probability: 0.9 }],
      watchedClasses: ["person"],
      cooldownMs: 60_000,
    };
    await request(app).post("/api/alerts").send(payload).expect(201);
    const blocked = await request(app).post("/api/alerts").send(payload).expect(429);
    assert.match(blocked.body.error, /cooldown/i);

    clock += 61_000;
    await request(app).post("/api/alerts").send(payload).expect(201);
    assert.equal(sent.length, 2);
  });

  it("sends a test email", async () => {
    const response = await request(app)
      .post("/api/alerts/test")
      .send({ to: "you@example.com" })
      .expect(200);
    assert.equal(response.body.ok, true);
    assert.match(sent[0].subject, /Test message/);
  });

  it("writes to the outbox when SMTP is not configured", async () => {
    const localDir = await mkdtemp(path.join(os.tmpdir(), "lensalert-outbox-app-"));
    const localApp = createApp({
      env: { ALERT_FROM: "alerts@localhost" },
      transport: null,
      dataDir: localDir,
    });
    const response = await request(localApp)
      .post("/api/alerts")
      .send({
        to: "you@example.com",
        detections: [{ className: "dog", probability: 0.88 }],
        watchedClasses: "dog",
      })
      .expect(201);
    assert.equal(response.body.alert.delivery.mode, "outbox");
    const files = await readdir(path.join(localDir, "outbox"));
    assert.ok(files.some((name) => name.endsWith(".html")));
  });
});
