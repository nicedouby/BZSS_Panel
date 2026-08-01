// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

export function createStepStorage({ dataDir, logger }) {
  const filePath = path.resolve(process.cwd(), dataDir, "stats.json");
  let data = { version: 1, updatedAt: null, players: {} };
  let dirty = false;

  async function init() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (parsed && typeof parsed === "object" && parsed.players && typeof parsed.players === "object") {
        data = { version: 1, updatedAt: parsed.updatedAt ?? null, players: parsed.players };
      }
    } catch (error) {
      if (error?.code !== "ENOENT") logger?.warn?.(`[StepCounter] unable to read stats: ${error.message}`);
    }
  }

  function getData() {
    return structuredClone(data);
  }

  function getPlayer(steamID) {
    return data.players[String(steamID)] ?? null;
  }

  function upsert(steamID, patch) {
    const key = String(steamID);
    const current = data.players[key] ?? {
      steamID: key, playerName: "", totalSteps: 0, totalDistanceMeters: 0,
      matchSteps: 0, matchDistanceMeters: 0, matches: 0, lastSeenAt: null,
    };
    data.players[key] = { ...current, ...patch };
    dirty = true;
    return data.players[key];
  }

  async function flush(force = false) {
    if (!dirty && !force) return false;
    data.updatedAt = new Date().toISOString();
    const tempPath = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tempPath, filePath);
    dirty = false;
    return true;
  }

  return { init, getData, getPlayer, upsert, flush, get filePath() { return filePath; } };
}
