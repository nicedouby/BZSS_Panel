// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const TOTAL_FIELDS = ["totalSteps", "totalDistanceMeters"];

export function createStepStorage({ dataDir, logger }) {
  const filePath = path.resolve(process.cwd(), dataDir, "stats.json");
  const backupPath = `${filePath}.bak`;
  let data = createEmptyData();
  let dirty = false;
  let mutationRevision = 0;
  let flushQueue = Promise.resolve(false);
  let tempSequence = 0;

  async function init() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const primary = await readStatsFile(filePath, "stats");
    if (primary) {
      data = normalizeData(primary);
      return;
    }

    const backup = await readStatsFile(backupPath, "backup");
    if (backup) {
      data = normalizeData(backup);
      markDirty();
      logger?.warn?.("[StepCounter] restored statistics from backup; primary file will be repaired.");
    }
  }

  async function readStatsFile(targetPath, label) {
    try {
      const parsed = JSON.parse(await fs.readFile(targetPath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
        || !parsed.players || typeof parsed.players !== "object" || Array.isArray(parsed.players)) {
        throw new Error("invalid statistics structure");
      }
      return parsed;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        logger?.warn?.(`[StepCounter] unable to read ${label}: ${error.message}`);
      }
      return null;
    }
  }

  function getData() {
    return structuredClone(data);
  }

  function getPlayer(steamID) {
    return data.players[String(steamID)] ?? null;
  }

  function getActiveRoundKey() {
    return String(data.activeRoundKey ?? "");
  }

  function setActiveRoundKey(roundKey) {
    const normalized = String(roundKey ?? "").trim();
    if (normalized === getActiveRoundKey()) return false;
    data.activeRoundKey = normalized;
    markDirty();
    return true;
  }

  function upsert(steamID, patch) {
    const key = String(steamID);
    const current = data.players[key] ?? createEmptyPlayer(key);
    const safePatch = { ...patch };

    // Lifetime totals must never move backwards because of a stale snapshot,
    // reload, or delayed write. Current-match counters are intentionally
    // allowed to reset only when a confirmed roundUpdated event is received.
    for (const field of TOTAL_FIELDS) {
      if (!(field in safePatch)) continue;
      const currentValue = finiteNonNegative(current[field]);
      const nextValue = finiteNonNegative(safePatch[field]);
      safePatch[field] = Math.max(currentValue, nextValue);
    }

    data.players[key] = { ...current, ...safePatch, steamID: key };
    markDirty();
    return data.players[key];
  }

  function markDirty() {
    mutationRevision += 1;
    dirty = true;
  }

  async function flush(force = false) {
    const run = flushQueue
      .catch(() => false)
      .then(() => flushOnce(force));
    flushQueue = run.catch(() => false);
    return run;
  }

  async function flushOnce(force) {
    if (!dirty && !force) return false;

    const writeRevision = mutationRevision;
    const updatedAt = new Date().toISOString();
    const snapshot = { ...structuredClone(data), version: 2, updatedAt };
    const contents = JSON.stringify(snapshot, null, 2);
    const token = `${process.pid}.${++tempSequence}`;
    const tempPath = `${filePath}.${token}.tmp`;
    const backupTempPath = `${backupPath}.${token}.tmp`;

    await fs.writeFile(tempPath, contents, "utf8");
    await fs.rename(tempPath, filePath);

    // Keep a second complete generation. If the primary file is ever damaged
    // externally, init() restores this copy instead of starting from zero.
    try {
      await fs.writeFile(backupTempPath, contents, "utf8");
      await fs.rename(backupTempPath, backupPath);
    } catch (error) {
      await fs.unlink(backupTempPath).catch(() => {});
      logger?.warn?.(`[StepCounter] unable to update backup: ${error.message}`);
    }

    data.updatedAt = updatedAt;
    dirty = mutationRevision !== writeRevision;
    return true;
  }

  return {
    init,
    getData,
    getPlayer,
    getActiveRoundKey,
    setActiveRoundKey,
    upsert,
    flush,
    get filePath() { return filePath; },
  };
}

function createEmptyData() {
  return { version: 2, updatedAt: null, activeRoundKey: "", players: {} };
}

function createEmptyPlayer(steamID) {
  return {
    steamID,
    playerName: "",
    totalSteps: 0,
    totalDistanceMeters: 0,
    matchSteps: 0,
    matchDistanceMeters: 0,
    matches: 0,
    lastSeenAt: null,
  };
}

function normalizeData(value) {
  return {
    version: 2,
    updatedAt: value.updatedAt ?? null,
    activeRoundKey: String(value.activeRoundKey ?? ""),
    players: value.players,
  };
}

function finiteNonNegative(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}
