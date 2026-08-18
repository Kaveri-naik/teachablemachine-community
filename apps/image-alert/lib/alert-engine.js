/**
 * Pure helpers for matching detections to alert rules.
 * Shared by the API and unit tests so the UI and server agree on behavior.
 */

export function normalizeClassName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function parseWatchedClasses(input) {
  if (Array.isArray(input)) {
    return [...new Set(input.map((item) => String(item).trim()).filter(Boolean))];
  }
  return [
    ...new Set(
      String(input || "")
        .split(/[,;\n]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

export function clampThreshold(value, fallback = 0.6) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(0.99, Math.max(0.05, number));
}

export function clampCooldownMs(value, fallback = 60_000) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(3_600_000, Math.max(5_000, Math.round(number)));
}

export function findAlertHits(detections, { watchedClasses, threshold }) {
  if (!Array.isArray(detections)) {
    return [];
  }
  const watched = new Set(parseWatchedClasses(watchedClasses).map(normalizeClassName));
  const minScore = clampThreshold(threshold);
  return detections
    .map((detection) => ({
      className: String(detection?.className || detection?.class || "").trim(),
      probability: Number(detection?.probability ?? detection?.score ?? 0),
    }))
    .filter(
      (detection) =>
        detection.className &&
        watched.has(normalizeClassName(detection.className)) &&
        Number.isFinite(detection.probability) &&
        detection.probability >= minScore
    )
    .sort((a, b) => b.probability - a.probability);
}

export function isInCooldown(lastAlertAt, cooldownMs, now = Date.now()) {
  if (!lastAlertAt) {
    return false;
  }
  const last = typeof lastAlertAt === "string" ? Date.parse(lastAlertAt) : Number(lastAlertAt);
  if (!Number.isFinite(last)) {
    return false;
  }
  return now - last < clampCooldownMs(cooldownMs);
}

export function cooldownKey(recipient, className) {
  return `${normalizeClassName(recipient)}::${normalizeClassName(className)}`;
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

export function diffPresence(previousClasses, currentClasses) {
  const previous = new Set((previousClasses || []).map(normalizeClassName).filter(Boolean));
  const current = new Set((currentClasses || []).map(normalizeClassName).filter(Boolean));
  return {
    entered: [...current].filter((name) => !previous.has(name)),
    exited: [...previous].filter((name) => !current.has(name)),
    present: [...current],
  };
}

export function parseDataUrlImage(dataUrl, { maxBytes = 2_000_000 } = {}) {
  if (!dataUrl) {
    return null;
  }
  const match = String(dataUrl).match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    throw new Error("Snapshot must be a JPEG, PNG, or WebP data URL");
  }
  const mime = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!buffer.length) {
    throw new Error("Snapshot is empty");
  }
  if (buffer.length > maxBytes) {
    throw new Error("Snapshot is too large (max 2MB)");
  }
  const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return { mime, buffer, extension };
}
