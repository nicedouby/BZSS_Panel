// -*- coding: utf-8 -*-

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import crypto from "node:crypto";

import {
  combatIdentityKeys,
  normalizeCombatEvent,
  normalizeCombatType,
} from "./combat-event-normalizer.js";

export class CombatEventStore {
  constructor({ directory, logger = null, maxInMemoryRecords = 10_000 } = {}) {
    this.directory = path.resolve(directory ?? "./data/combat-events/BZSS_Main");
    this.dataPath = path.join(this.directory, "combat-events.jsonl");
    this.statePath = path.join(this.directory, "collector-state.json");
    this.logger = logger;
    this.maxInMemoryRecords = Math.max(500, Number(maxInMemoryRecords) || 10_000);
    this.records = [];
    this.identityIndex = new Map();
    this.durableIdentityKeys = new Set();
    this.totals = createEmptyTotals();
    this.state = {};
    this.writeQueue = Promise.resolve();
  }

  async load() {
    await fsp.mkdir(this.directory, { recursive: true });
    const cacheHandle = await fsp.open(this.dataPath, "a");
    await cacheHandle.close();
    this.records.splice(0);
    this.identityIndex.clear();
    this.durableIdentityKeys.clear();
    this.totals = createEmptyTotals();
    if (fs.existsSync(this.dataPath)) {
      const input = fs.createReadStream(this.dataPath, { encoding: "utf8" });
      const lines = readline.createInterface({ input, crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line.trim()) continue;
        try {
          this.registerRecord(normalizeCombatEvent(JSON.parse(line), { observedMode: "cache" }));
        } catch (error) {
          this.logger?.warn?.(`战斗缓存忽略损坏记录: ${error?.message ?? error}`);
        }
      }
      this.trimRecentRecords();
    }
    try {
      this.state = JSON.parse(await fsp.readFile(this.statePath, "utf8"));
    } catch {
      this.state = {};
    }
    return this.getStats();
  }

  findDuplicate(record) {
    for (const key of combatIdentityKeys(record)) {
      const recentRecord = this.identityIndex.get(key);
      if (recentRecord) return { record: recentRecord, recent: true };
    }
    for (const key of durableKeys(record)) {
      if (this.durableIdentityKeys.has(key)) return { record: null, recent: false };
    }
    return null;
  }

  async insert(input, options = {}) {
    return this.insertBatch([input], options);
  }

  async insertBatch(inputs = [], { observedMode = "replay" } = {}) {
    const inserted = [];
    let duplicates = 0;
    for (const input of inputs) {
      const record = normalizeCombatEvent(input, { observedMode });
      const duplicate = this.findDuplicate(record);
      if (duplicate) {
        duplicates += 1;
        if (duplicate.record) {
          mergeObservation(duplicate.record, record);
          for (const key of combatIdentityKeys(record)) this.identityIndex.set(key, duplicate.record);
        }
        for (const key of durableKeys(record)) this.durableIdentityKeys.add(key);
        continue;
      }
      this.registerRecord(record);
      inserted.push(record);
    }
    this.trimRecentRecords();
    if (inserted.length) {
      const payload = inserted.map((record) => `${JSON.stringify(record)}\n`).join("");
      this.writeQueue = this.writeQueue.then(async () => {
        await fsp.mkdir(this.directory, { recursive: true });
        await fsp.appendFile(this.dataPath, payload, "utf8");
      });
      await this.writeQueue;
    }
    return { inserted: inserted.length, duplicates };
  }

  registerRecord(record) {
    if (this.findDuplicate(record)) return false;
    this.records.push(record);
    for (const key of combatIdentityKeys(record)) this.identityIndex.set(key, record);
    for (const key of durableKeys(record)) this.durableIdentityKeys.add(key);
    updateTotals(this.totals, record, 1);
    return true;
  }

  trimRecentRecords() {
    const overflow = this.records.length - this.maxInMemoryRecords;
    if (overflow <= 0) return;
    const removed = this.records.splice(0, overflow);
    for (const record of removed) {
      for (const key of combatIdentityKeys(record)) {
        if (this.identityIndex.get(key) === record) this.identityIndex.delete(key);
      }
    }
  }

  query(filter = {}) {
    return queryRecords(this.records, filter);
  }

  async queryDisk(filter = {}) {
    await this.writeQueue;
    const start = Math.max(0, Math.min(100_000, Number(filter.offset) || 0));
    const size = Math.max(1, Math.min(5000, Number(filter.limit) || 300));
    const keep = start + size;
    let total = 0;
    let window = [];

    if (!fs.existsSync(this.dataPath)) return { total: 0, records: [] };
    const input = fs.createReadStream(this.dataPath, { encoding: "utf8" });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (!recordMatches(record, filter)) continue;
        total += 1;
        window.push(record);
        if (window.length > Math.max(keep * 2, 1000)) {
          window.sort(sortNewestFirst);
          window.length = keep;
        }
      } catch {
        // Damaged cache lines are ignored consistently with startup loading.
      }
    }
    window.sort(sortNewestFirst);
    return { total, records: window.slice(start, start + size).map(clone) };
  }

  getAll() {
    return this.records.map(clone);
  }

  getStats() {
    return {
      ...this.totals,
      retained: this.records.length,
      maxInMemoryRecords: this.maxInMemoryRecords,
      state: clone(this.state),
    };
  }

  async saveState(patch = {}) {
    this.state = { ...this.state, ...patch, schema: "combat-collector-state.v1" };
    await writeJsonAtomic(this.statePath, this.state);
    return clone(this.state);
  }

  async clear() {
    const cleared = this.totals.count;
    this.records.splice(0);
    this.identityIndex.clear();
    this.durableIdentityKeys.clear();
    this.totals = createEmptyTotals();
    this.state = {};
    await this.writeQueue;
    await fsp.mkdir(this.directory, { recursive: true });
    await fsp.writeFile(this.dataPath, "", "utf8");
    await writeJsonAtomic(this.statePath, {
      schema: "combat-collector-state.v1",
      completed: false,
      clearedAt: new Date().toISOString(),
    });
    return cleared;
  }

  async flush() {
    await this.writeQueue;
  }
}

function createEmptyTotals() {
  return { count: 0, damage: 0, wound: 0, death: 0, nullptrActors: 0, nullptrWeapons: 0 };
}

function updateTotals(totals, record, direction) {
  const delta = direction >= 0 ? 1 : -1;
  totals.count = Math.max(0, totals.count + delta);
  if (record.type === "damage") totals.damage = Math.max(0, totals.damage + delta);
  if (record.type === "wound") totals.wound = Math.max(0, totals.wound + delta);
  if (record.type === "death") totals.death = Math.max(0, totals.death + delta);
  if (record.attacker?.nameState === "nullptr" || record.victim?.nameState === "nullptr") {
    totals.nullptrActors = Math.max(0, totals.nullptrActors + delta);
  }
  if (record.weaponState === "nullptr") totals.nullptrWeapons = Math.max(0, totals.nullptrWeapons + delta);
}

function durableKeys(record) {
  const keys = combatIdentityKeys(record);
  const preferred = keys.find((key) => /^(?:position|offset-raw|event|raw-fallback):/.test(key));
  const key = preferred ?? keys[0];
  if (!key) return [];
  // Keep one fixed-size token per on-disk record. Recent records retain their
  // full flexible keys, while historical replay dedupe stays memory-bounded.
  return [crypto.createHash("sha1").update(key).digest("base64url").slice(0, 12)];
}

function queryRecords(records, filter = {}) {
  const start = Math.max(0, Number(filter.offset) || 0);
  const size = Math.max(1, Math.min(5000, Number(filter.limit) || 300));
  const result = records.filter((record) => recordMatches(record, filter)).slice().sort(sortNewestFirst);
  return { total: result.length, records: result.slice(start, start + size).map(clone) };
}

function recordMatches(record, { serverId = "", search = "", type = "all", sourceMode = "all" } = {}) {
  const normalizedType = type === "all" ? "all" : normalizeCombatType(type);
  const query = String(search ?? "").trim().toLowerCase();
  if (serverId && record.serverId !== String(serverId)) return false;
  if (normalizedType !== "all" && record.type !== normalizedType) return false;
  if (sourceMode !== "all" && !(record.observedModes ?? []).includes(String(sourceMode))) return false;
  return !query || matchesSearch(record, query);
}

function mergeObservation(target, incoming) {
  target.observedModes = [...new Set([...(target.observedModes ?? []), ...(incoming.observedModes ?? [])])];
}

async function writeJsonAtomic(filePath, value) {
  const target = path.resolve(filePath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fsp.rename(temporary, target);
  } finally {
    await fsp.unlink(temporary).catch(() => {});
  }
}

function matchesSearch(record, query) {
  return [
    record.attacker, record.victim, record.weapon, record.rawWeapon,
    record.provenance, record.id, record.type,
  ].some((value) => JSON.stringify(value ?? "").toLowerCase().includes(query));
}

function sortNewestFirst(a, b) {
  return Date.parse(b.time) - Date.parse(a.time)
    || Number(b.sourceOffset ?? -1) - Number(a.sourceOffset ?? -1);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
