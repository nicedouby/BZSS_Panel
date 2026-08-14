// -*- coding: utf-8 -*-

import crypto from "node:crypto";

export function dedupeKillRecords(records = []) {
  const byKey = new Map();
  for (const record of records) {
    const keys = dedupeKeys(record);
    const existingKey = keys.find((key) => byKey.has(key));
    if (existingKey) {
      const existing = byKey.get(existingKey);
      if (existing?.source === "replay" && record?.source === "live") {
        for (const key of dedupeKeys(existing)) byKey.delete(key);
        for (const key of keys) byKey.set(key, record);
      }
      continue;
    }
    for (const key of keys) byKey.set(key, record);
  }
  return [...new Set(byKey.values())];
}

export function dedupeKeys(record = {}) {
  const keys = [];
  const id = String(record.id ?? "").trim();
  if (id) keys.push(`id:${id.replace(/^(?:live|kill):/, "")}`);
  const offset = Number(record.sourceOffset);
  if (Number.isFinite(offset) && offset >= 0) {
    keys.push(`offset:${String(record.sourceFileId ?? record.sourceFile ?? "")}:${offset}`);
  }
  const rawLog = String(record.rawLog ?? "").trim();
  if (rawLog) keys.push(`raw:${crypto.createHash("sha1").update(rawLog).digest("hex")}`);
  const logTime = String(record.logTime ?? "").trim();
  const victim = identityKey(record.victim);
  const attacker = identityKey(record.attacker);
  if (logTime && victim) {
    keys.push(`semantic:${logTime}:${attacker}:${victim}:${String(record.weapon ?? "").trim().toLowerCase()}`);
  }
  if (!keys.length) keys.push(`fallback:${crypto.createHash("sha1").update(JSON.stringify(record)).digest("hex")}`);
  return keys;
}

function identityKey(player = {}) {
  return String(player?.steam64ID ?? player?.eosID ?? player?.controllerID ?? player?.name ?? "").trim().toLowerCase();
}
