import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildAlertEmail, deliverMail, smtpConfigured } from "../lib/email.js";

describe("smtpConfigured", () => {
  it("is false when Gmail user is set without an App Password", () => {
    assert.equal(
      smtpConfigured({
        SMTP_HOST: "smtp.gmail.com",
        SMTP_USER: "kaveri.naik@gmail.com",
      }),
      false
    );
  });

  it("is true when host, user, and password are present", () => {
    assert.equal(
      smtpConfigured({
        SMTP_HOST: "smtp.gmail.com",
        SMTP_USER: "kaveri.naik@gmail.com",
        SMTP_PASS: "app-password",
      }),
      true
    );
  });
});

describe("buildAlertEmail", () => {
  it("puts the top class in the subject and body", () => {
    const mail = buildAlertEmail({
      hits: [
        { className: "person", probability: 0.92 },
        { className: "backpack", probability: 0.71 },
      ],
      source: "webcam",
      timestamp: "2026-08-17T12:00:00.000Z",
      includeSnapshot: true,
    });
    assert.match(mail.subject, /person detected \(92%\)/i);
    assert.match(mail.text, /backpack: 71%/);
    assert.match(mail.html, /cid:snapshot/);
    assert.match(mail.html, /webcam/);
  });

  it("escapes HTML in class names", () => {
    const mail = buildAlertEmail({
      hits: [{ className: "<script>x</script>", probability: 0.9 }],
      source: "upload",
    });
    assert.equal(mail.html.includes("<script>x</script>"), false);
    assert.match(mail.html, /&lt;script&gt;/);
  });
});

describe("deliverMail", () => {
  it("writes HTML to the outbox when SMTP is not configured", async () => {
    const outboxDir = await mkdtemp(path.join(os.tmpdir(), "lensalert-outbox-"));
    const result = await deliverMail({
      transport: null,
      from: "alerts@example.com",
      to: "you@example.com",
      subject: "[Image Alert] person detected (90%)",
      text: "person",
      html: "<p>person</p>",
      outboxDir,
    });
    assert.equal(result.mode, "outbox");
    const html = await readFile(result.path, "utf8");
    assert.match(html, /person/);
  });

  it("uses the nodemailer transport when provided", async () => {
    const sent = [];
    const transport = {
      async sendMail(message) {
        sent.push(message);
        return { messageId: "test-id" };
      },
    };
    const result = await deliverMail({
      transport,
      from: "alerts@example.com",
      to: "you@example.com",
      subject: "hello",
      text: "hello",
      html: "<p>hello</p>",
    });
    assert.equal(result.mode, "smtp");
    assert.equal(result.messageId, "test-id");
    assert.equal(sent[0].to, "you@example.com");
  });
});
