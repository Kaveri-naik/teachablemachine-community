import { diffPresence, findAlertHits, normalizeClassName } from "./alert-engine.js";

const MAX_EVENTS = 200;
const STALE_MS = 4000;
const TICK_BROADCAST_MS = 400;

function emptySession() {
  return {
    live: false,
    source: "idle",
    startedAt: null,
    lastTickAt: null,
    frames: 0,
    fps: 0,
    present: [],
    detections: [],
    hits: [],
    watchedClasses: [],
  };
}

export function createMonitor({ now = () => Date.now(), staleMs = STALE_MS } = {}) {
  let session = emptySession();
  const events = [];
  const listeners = new Set();
  const buckets = [];
  let lastTickBroadcast = 0;

  function publish(event) {
    const payload = { id: `${event.at}-${events.length}`, ...event };
    events.push(payload);
    if (events.length > MAX_EVENTS) {
      events.shift();
    }
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch {
        listeners.delete(listener);
      }
    }
    return payload;
  }

  function recordHits(timestamp, hitCount) {
    const sec = Math.floor(timestamp / 1000);
    const last = buckets[buckets.length - 1];
    if (last && last.t === sec) {
      last.count += hitCount;
    } else {
      buckets.push({ t: sec, count: hitCount });
    }
    const cutoff = sec - 59;
    while (buckets.length && buckets[0].t < cutoff) {
      buckets.shift();
    }
  }

  function histogram(timestamp = now()) {
    const sec = Math.floor(timestamp / 1000);
    const map = new Map(buckets.map((bucket) => [bucket.t, bucket.count]));
    return Array.from({ length: 60 }, (_, index) => map.get(sec - 59 + index) || 0);
  }

  function isLive(timestamp = now()) {
    return Boolean(session.startedAt) && timestamp - (session.lastTickAt || session.startedAt) < staleMs;
  }

  function snapshot(timestamp = now()) {
    return {
      session: {
        ...session,
        live: isLive(timestamp),
        present: [...session.present],
        detections: session.detections.map((item) => ({ ...item })),
        hits: session.hits.map((item) => ({ ...item })),
      },
      events: [...events].slice(-80).reverse(),
      histogram: histogram(timestamp),
      listeners: listeners.size,
    };
  }

  return {
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start({ source = "webcam" } = {}, timestamp = now()) {
      session = {
        ...emptySession(),
        live: true,
        source,
        startedAt: timestamp,
        lastTickAt: timestamp,
      };
      return publish({ type: "start", at: timestamp, source });
    },
    stop(timestamp = now()) {
      const source = session.source;
      session = emptySession();
      return publish({ type: "stop", at: timestamp, source });
    },
    tick(payload = {}, timestamp = now()) {
      if (!session.startedAt) {
        this.start({ source: payload.source || "webcam" }, timestamp);
      }
      const watchedClasses = payload.watchedClasses || session.watchedClasses || [];
      const threshold = payload.threshold;
      const hits = findAlertHits(payload.detections || [], { watchedClasses, threshold });
      const current = [...new Set(hits.map((hit) => normalizeClassName(hit.className)))];
      const presence = diffPresence(session.present, current);
      const fps = Number(payload.fps);
      session = {
        ...session,
        live: true,
        source: payload.source || session.source,
        lastTickAt: timestamp,
        frames: session.frames + 1,
        fps: Number.isFinite(fps) ? fps : session.fps,
        present: presence.present,
        detections: (payload.detections || []).slice(0, 12),
        hits,
        watchedClasses,
      };
      recordHits(timestamp, hits.length);

      const enteredHits = hits.filter((hit) => presence.entered.includes(normalizeClassName(hit.className)));
      const result = { ...presence, hits, enteredHits, session: snapshot(timestamp).session };

      if (presence.entered.length) {
        publish({
          type: "enter",
          at: timestamp,
          classes: presence.entered,
          hits: enteredHits,
          source: session.source,
        });
      }
      if (presence.exited.length) {
        publish({
          type: "exit",
          at: timestamp,
          classes: presence.exited,
          source: session.source,
        });
      }
      if (timestamp - lastTickBroadcast >= TICK_BROADCAST_MS) {
        lastTickBroadcast = timestamp;
        publish({
          type: "tick",
          at: timestamp,
          present: presence.present,
          fps: session.fps,
          frames: session.frames,
          detections: session.detections,
          histogram: histogram(timestamp),
        });
      }
      return result;
    },
    alert(alert, timestamp = now()) {
      return publish({ type: "alert", at: timestamp, alert });
    },
  };
}
