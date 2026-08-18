import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_ALERTS = 100;

export function createStore(dataDir) {
  const alertsPath = path.join(dataDir, "alerts.json");
  let cache = null;

  async function load() {
    if (cache) {
      return cache;
    }
    try {
      const raw = await readFile(alertsPath, "utf8");
      cache = JSON.parse(raw);
      if (!Array.isArray(cache)) {
        cache = [];
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      cache = [];
    }
    return cache;
  }

  async function persist(alerts) {
    await mkdir(dataDir, { recursive: true });
    await writeFile(alertsPath, JSON.stringify(alerts, null, 2));
    cache = alerts;
  }

  return {
    async list() {
      const alerts = await load();
      return [...alerts].reverse();
    },
    async record(entry) {
      const alerts = await load();
      alerts.push(entry);
      const trimmed = alerts.slice(-MAX_ALERTS);
      await persist(trimmed);
      return entry;
    },
  };
}
