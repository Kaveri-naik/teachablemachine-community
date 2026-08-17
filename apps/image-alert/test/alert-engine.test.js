import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clampCooldownMs,
  clampThreshold,
  cooldownKey,
  findAlertHits,
  isInCooldown,
  isValidEmail,
  normalizeClassName,
  parseDataUrlImage,
  parseWatchedClasses,
} from "../lib/alert-engine.js";

describe("parseWatchedClasses", () => {
  it("splits comma-separated names and drops blanks", () => {
    assert.deepEqual(parseWatchedClasses("person, car,  ,dog"), ["person", "car", "dog"]);
  });

  it("deduplicates array input", () => {
    assert.deepEqual(parseWatchedClasses(["Person", "Person", "car"]), ["Person", "car"]);
  });
});

describe("findAlertHits", () => {
  const detections = [
    { className: "person", probability: 0.91 },
    { className: "cup", probability: 0.8 },
    { className: "dog", probability: 0.4 },
  ];

  it("returns watched classes that meet the threshold, highest first", () => {
    const hits = findAlertHits(detections, {
      watchedClasses: "person, dog",
      threshold: 0.5,
    });
    assert.deepEqual(hits, [{ className: "person", probability: 0.91 }]);
  });

  it("is case-insensitive", () => {
    const hits = findAlertHits(detections, { watchedClasses: "PERSON", threshold: 0.9 });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].className, "person");
  });

  it("accepts COCO-style score fields", () => {
    const hits = findAlertHits([{ class: "car", score: 0.77 }], {
      watchedClasses: ["car"],
      threshold: 0.6,
    });
    assert.equal(hits[0].probability, 0.77);
  });

  it("returns nothing when no rule matches", () => {
    assert.deepEqual(
      findAlertHits(detections, { watchedClasses: "bicycle", threshold: 0.2 }),
      []
    );
  });
});

describe("cooldown and helpers", () => {
  it("treats missing timestamps as not in cooldown", () => {
    assert.equal(isInCooldown(null, 60_000, 1_000), false);
  });

  it("blocks repeats inside the window", () => {
    assert.equal(isInCooldown(1_000, 60_000, 30_000), true);
    assert.equal(isInCooldown(1_000, 60_000, 70_000), false);
  });

  it("clamps threshold and cooldown to safe ranges", () => {
    assert.equal(clampThreshold(2), 0.99);
    assert.equal(clampThreshold(-1), 0.05);
    assert.equal(clampCooldownMs(100), 5_000);
    assert.equal(clampCooldownMs(9_999_999), 3_600_000);
  });

  it("builds a stable cooldown key", () => {
    assert.equal(cooldownKey("Ada@Example.com", "Person"), cooldownKey("ada@example.com", " person "));
  });

  it("validates email addresses", () => {
    assert.equal(isValidEmail("ada@example.com"), true);
    assert.equal(isValidEmail("not-an-email"), false);
  });

  it("normalizes class names", () => {
    assert.equal(normalizeClassName("  Cell   Phone "), "cell phone");
  });
});

describe("parseDataUrlImage", () => {
  it("decodes a JPEG data URL", () => {
    const jpeg = parseDataUrlImage("data:image/jpeg;base64,AAAA");
    assert.equal(jpeg.mime, "image/jpeg");
    assert.equal(jpeg.extension, "jpg");
    assert.ok(jpeg.buffer.length > 0);
  });

  it("rejects non-image payloads", () => {
    assert.throws(() => parseDataUrlImage("data:text/plain;base64,QQ=="), /Snapshot must be/);
  });
});
