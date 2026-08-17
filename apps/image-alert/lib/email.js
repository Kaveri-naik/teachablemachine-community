import nodemailer from "nodemailer";

export function createTransport(env = process.env) {
  if (!env.SMTP_HOST) {
    return null;
  }
  const port = Number(env.SMTP_PORT || 587);
  const auth =
    env.SMTP_USER || env.SMTP_PASS
      ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
      : undefined;
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE === "true" || port === 465,
    auth,
  });
}

export function smtpConfigured(env = process.env) {
  return Boolean(env.SMTP_HOST);
}

export function buildAlertEmail({ hits, source, timestamp, notes, includeSnapshot }) {
  const top = hits[0];
  const percent = Math.round(top.probability * 100);
  const when = new Date(timestamp || Date.now()).toUTCString();
  const subject = `[Image Alert] ${top.className} detected (${percent}%)`;
  const hitLines = hits
    .map((hit) => `• ${hit.className}: ${Math.round(hit.probability * 100)}%`)
    .join("\n");
  const text = [
    "LensAlert detected a watched class.",
    "",
    `Top match: ${top.className} (${percent}%)`,
    `Source: ${source || "unknown"}`,
    `Time (UTC): ${when}`,
    "",
    "Detections:",
    hitLines,
    notes ? `\nNotes:\n${notes}` : "",
    includeSnapshot ? "\nA snapshot of the frame is attached." : "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const rows = hits
    .map(
      (hit) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #e6e1d6;">${escapeHtml(
          hit.className
        )}</td><td style="padding:8px 12px;border-bottom:1px solid #e6e1d6;text-align:right;font-variant-numeric:tabular-nums;">${Math.round(
          hit.probability * 100
        )}%</td></tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;background:#f4f0e8;font-family:Georgia, 'Times New Roman', serif;color:#1c1914;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f0e8;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#fffaf2;border:1px solid #d9d0c0;max-width:560px;">
          <tr>
            <td style="background:#1c1914;color:#f4e7c3;padding:18px 24px;letter-spacing:0.14em;text-transform:uppercase;font-size:12px;font-family:Arial, sans-serif;">
              LensAlert
            </td>
          </tr>
          <tr>
            <td style="padding:24px;">
              <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#8a7a5a;font-family:Arial, sans-serif;">Watched class detected</p>
              <h1 style="margin:0 0 16px;font-size:28px;font-weight:normal;">${escapeHtml(
                top.className
              )} <span style="color:#b42318;">${percent}%</span></h1>
              <p style="margin:0 0 18px;line-height:1.5;">Source: ${escapeHtml(
                source || "unknown"
              )}<br>Time (UTC): ${escapeHtml(when)}</p>
              <table width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e6e1d6;border-radius:4px;">
                <tr style="background:#f7f1e4;font-family:Arial, sans-serif;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#6b5e48;">
                  <th align="left" style="padding:8px 12px;">Class</th>
                  <th align="right" style="padding:8px 12px;">Confidence</th>
                </tr>
                ${rows}
              </table>
              ${
                includeSnapshot
                  ? '<p style="margin:18px 0 0;"><img src="cid:snapshot" alt="Detection snapshot" style="max-width:100%;border:1px solid #d9d0c0;" /></p>'
                  : ""
              }
              ${
                notes
                  ? `<p style="margin:18px 0 0;color:#5c5346;">${escapeHtml(notes)}</p>`
                  : ""
              }
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

export function buildTestEmail() {
  return {
    subject: "[Image Alert] Test message",
    text: "LensAlert can reach this inbox. You can now enable live image alerts.",
    html: `<p>LensAlert can reach this inbox. You can now enable live image alerts.</p>`,
  };
}

export async function deliverMail({ transport, from, to, subject, text, html, snapshot, outboxDir }) {
  const message = {
    from,
    to,
    subject,
    text,
    html,
    attachments: snapshot
      ? [
          {
            filename: `detection.${snapshot.extension}`,
            content: snapshot.buffer,
            contentType: snapshot.mime,
            cid: "snapshot",
          },
        ]
      : [],
  };

  if (transport) {
    const info = await transport.sendMail(message);
    return { mode: "smtp", messageId: info.messageId };
  }

  if (!outboxDir) {
    throw new Error("No SMTP transport and no outbox directory configured");
  }
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await fs.mkdir(outboxDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeClass = subject.replace(/[^\w.-]+/g, "_").slice(0, 80);
  const htmlPath = path.join(outboxDir, `${stamp}-${safeClass}.html`);
  await fs.writeFile(htmlPath, html, "utf8");
  if (snapshot) {
    const imagePath = path.join(outboxDir, `${stamp}-snapshot.${snapshot.extension}`);
    await fs.writeFile(imagePath, snapshot.buffer);
  }
  return { mode: "outbox", path: htmlPath };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
