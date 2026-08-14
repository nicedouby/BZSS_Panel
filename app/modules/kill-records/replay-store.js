// -*- coding: utf-8 -*-

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import crypto from "node:crypto";

import { normalizeReplayRecord } from "./kill-record-normalizer.js";

export class ReplayKillStore {
  constructor({ directory, logger = null } = {}) {
    this.directory = path.resolve(directory ?? "./data/kill-records/BZSS_Main");
    this.dataPath = path.join(this.directory, "replay.jsonl");
    this.statePath = path.join(this.directory, "replay-state.json");
    this.logger = logger;
    this.records = [];
    this.ids = new Set();
    this.state = {};
    this.writeQueue = Promise.resolve();
  }

  async load() {
    await fsp.mkdir(this.directory, { recursive: true });
    this.records.splice(0);
    this.ids.clear();
    if (fs.existsSync(this.dataPath)) {
      const input = fs.createReadStream(this.dataPath, { encoding: "utf8" });
      const lines = readline.createInterface({ input, crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line.trim()) continue;
        try {
          const record = normalizeReplayRecord(JSON.parse(line));
          if (!record.id || this.ids.has(record.id)) continue;
          this.ids.add(record.id);
          this.records.push(record);
        } catch (error) {
          this.logger?.warn?.(`Kill replay store ignored invalid row: ${error?.message ?? error}`);
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

  has(id) {
    return this.ids.has(String(id ?? ""));
  }

  async insert(record) {
    return this.insertBatch([record]);
  }

  async insertBatch(records = []) {
    const inserted = [];
    let duplicates = 0;
    for (const input of records) {
      const record = normalizeReplayRecord(input);
      if (!record.id || this.ids.has(record.id)) {
        duplicates += 1;
        continue;
      }
      this.ids.add(record.id);
      this.records.push(record);
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

  query({ serverId = "", search = "", type = "all", offset = 0, limit = 200 } = {}) {
    const query = String(search ?? "").trim().toLowerCase();
    let result = this.records;
    if (serverId) result = result.filter((record) => String(record.serverId ?? "") === String(serverId));
    if (type === "tk") result = result.filter((record) => record.type === "kill" && record.isTeamKill);
    else if (type === "kill") result = result.filter((record) => record.type === "kill" && !record.isTeamKill);
    else if (type === "damage" || type === "wound") result = result.filter((record) => record.type === type);
    if (query) result = result.filter((record) => matchesSearch(record, query));
    const start = Math.max(0, Number(offset) || 0);
    const size = Math.max(1, Math.min(1000, Number(limit) || 200));
    return {
      total: result.length,
      records: result.slice().sort(sortNewestFirst).slice(start, start + size).map(clone),
    };
  }

  getAll() {
    return this.records.map(clone);
  }

  getStats() {
    return {
      count: this.records.length,
      damage: this.records.filter((record) => record.type === "damage").length,
      wound: this.records.filter((record) => record.type === "wound").length,
      kill: this.records.filter((record) => record.type === "kill").length,
      teamKills: this.records.filter((record) => record.isTeamKill).length,
      state: clone(this.state),
    };
  }

  async saveState(patch = {}) {
    this.state = { ...this.state, ...patch, schema: "kill-replay-state.v1" };
    await writeJsonAtomic(this.statePath, this.state);
    return clone(this.state);
  }

  async clear() {
    const cleared = this.records.length;
    this.records.splice(0);
    this.ids.clear();
    this.state = {};
    await this.writeQueue;
    await fsp.mkdir(this.directory, { recursive: true });
    await fsp.writeFile(this.dataPath, "", "utf8");
    await writeJsonAtomic(this.statePath, { schema: "kill-replay-state.v1", completed: false, clearedAt: new Date().toISOString() });
    return cleared;
  }

  async flush() {
    await this.writeQueue;
  }
}

export async function writeJsonAtomic(filePath, value) {
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
  return [record.attacker?.name, record.attacker?.steam64ID, record.attacker?.eosID,
    record.victim?.name, record.victim?.steam64ID, record.victim?.eosID, record.weapon, record.rawLog]
    .some((value) => String(value ?? "").toLowerCase().includes(query));
}

function sortNewestFirst(a, b) {
  return Date.parse(b.time) - Date.parse(a.time) || Number(b.sourceOffset) - Number(a.sourceOffset);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
