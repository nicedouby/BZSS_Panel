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
  constructor({ directory, logger = null } = {}) {
    this.directory = path.resolve(directory ?? "./data/combat-events/BZSS_Main");
    this.dataPath = path.join(this.directory, "combat-events.jsonl");
    this.statePath = path.join(this.directory, "collector-state.json");
    this.logger = logger;
    this.records = [];
    this.identityIndex = new Map();
    this.state = {};
    this.writeQueue = Promise.resolve();
  }

  async load() {
    await fsp.mkdir(this.directory, { recursive: true });
    const cacheHandle = await fsp.open(this.dataPath, "a");
    await cacheHandle.close();
    this.records.splice(0);
    this.identityIndex.clear();
    if (fs.existsSync(this.dataPath)) {
      const input = fs.createReadStream(this.dataPath, { encoding: "utf8" });
      const lines = readline.createInterface({ input, crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line.trim()) continue;
        try {
          this.insertInMemory(normalizeCombatEvent(JSON.parse(line), { observedMode: "cache" }));
        } catch (error) {
          this.logger?.warn?.(`战斗缓存忽略损坏记录: ${error?.message ?? error}`);
        }
      }
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
      const index = this.identityIndex.get(key);
      if (index !== undefined) return { index, record: this.records[index] };
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
        mergeObservation(duplicate.record, record);
        for (const key of combatIdentityKeys(record)) this.identityIndex.set(key, duplicate.index);
        continue;
      }
      this.insertInMemory(record);
      inserted.push(record);
    }
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

  insertInMemory(record) {
    if (this.findDuplicate(record)) return false;
    const index = this.records.length;
    this.records.push(record);
    for (const key of combatIdentityKeys(record)) this.identityIndex.set(key, index);
    return true;
  }

  query({ serverId = "", search = "", type = "all", sourceMode = "all", offset = 0, limit = 300 } = {}) {
    const normalizedType = type === "all" ? "all" : normalizeCombatType(type);
    const query = String(search ?? "").trim().toLowerCase();
    let result = this.records;
    if (serverId) result = result.filter((record) => record.serverId === String(serverId));
    if (normalizedType !== "all") result = result.filter((record) => record.type === normalizedType);
    if (sourceMode !== "all") result = result.filter((record) => record.observedModes.includes(String(sourceMode)));
    if (query) result = result.filter((record) => matchesSearch(record, query));
    const start = Math.max(0, Number(offset) || 0);
    const size = Math.max(1, Math.min(5000, Number(limit) || 300));
    const sorted = result.slice().sort(sortNewestFirst);
    return { total: sorted.length, records: sorted.slice(start, start + size).map(clone) };
  }

  getAll() {
    return this.records.map(clone);
  }

  getStats() {
    return {
      count: this.records.length,
      damage: this.records.filter((record) => record.type === "damage").length,
      wound: this.records.filter((record) => record.type === "wound").length,
      death: this.records.filter((record) => record.type === "death").length,
      nullptrActors: this.records.filter((record) => record.attacker?.nameState === "nullptr" || record.victim?.nameState === "nullptr").length,
      nullptrWeapons: this.records.filter((record) => record.weaponState === "nullptr").length,
      state: clone(this.state),
    };
  }

  async saveState(patch = {}) {
    this.state = { ...this.state, ...patch, schema: "combat-collector-state.v1" };
    await writeJsonAtomic(this.statePath, this.state);
    return clone(this.state);
  }

  async clear() {
    const cleared = this.records.length;
    this.records.splice(0);
    this.identityIndex.clear();
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
