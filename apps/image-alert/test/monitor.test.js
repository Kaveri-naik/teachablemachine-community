import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMonitor } from "../lib/monitor.js";

describe("createMonitor", () => {
  it("emits enter then exit as a watched class appears and leaves", () => {
    let clock = 1_000;
    const published = [];
    const monitor = createMonitor({ now: () => clock });
    monitor.subscribe((event) => published.push(event.type));

    monitor.start({ source: "demo" });
    const seen = monitor.tick({
      source: "demo",
      detections: [{ className: "person", probability: 0.9 }],
      watchedClasses: ["person"],
      threshold: 0.6,
      fps: 4,
    });
    assert.deepEqual(seen.entered, ["person"]);
    assert.equal(seen.hits[0].className, "person");

    clock += 500;
    const gone = monitor.tick({
      source: "demo",
      detections: [{ className: "cup", probability: 0.99 }],
      watchedClasses: ["person"],
      threshold: 0.6,
    });
    assert.deepEqual(gone.exited, ["person"]);
    assert.deepEqual(gone.present, []);
    assert.ok(published.includes("start"));
    assert.ok(published.includes("enter"));
    assert.ok(published.includes("exit"));
  });

  it("marks the session stale after ticks stop", () => {
    let clock = 5_000;
    const monitor = createMonitor({ now: () => clock, staleMs: 1_000 });
    monitor.start({ source: "webcam" });
    monitor.tick({
      detections: [],
      watchedClasses: ["person"],
      threshold: 0.6,
    });
    clock += 2_000;
    assert.equal(monitor.snapshot().session.live, false);
  });

  it("builds a 60-second histogram of hits", () => {
    let clock = 60_000;
    const monitor = createMonitor({ now: () => clock });
    monitor.start({ source: "demo" });
    monitor.tick({
      detections: [{ className: "person", probability: 0.9 }],
      watchedClasses: ["person"],
      threshold: 0.5,
    });
    const histogram = monitor.snapshot().histogram;
    assert.equal(histogram.length, 60);
    assert.equal(histogram[59], 1);
  });
});
