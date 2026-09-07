// -*- coding: utf-8 -*-

import crypto from "node:crypto";

import {
  normalizeLiveCombat as normalizeLegacyLiveCombat,
  normalizeReplayRecord as normalizeLegacyReplayRecord,
} from "../kill-records/kill-record-normalizer.js";

export const COMBAT_EVENT_TYPES = Object.freeze(["damage", "wound", "death"]);

export function normalizeReplayCombatEvent(input = {}) {
  return normalizeCombatEvent(normalizeLegacyReplayRecord(input), { observedMode: "replay" });
}

export function normalizeLiveCombatEvent(input = {}) {
  const normalized = normalizeLegacyLiveCombat(input);
  return normalizeCombatEvent({
    ...normalized,
    sourceEventId: firstText(input.sourceEventId, input.raw?.sourceEventId, input.id),
    sourceFile: firstText(input.sourceFile, input.raw?.sourceFile, input.rawEvent?.SourceFile),
    sourceFileId: firstText(input.sourceFileId, input.raw?.sourceFileId, input.rawEvent?.SourceFileId, input.rawEvent?.SourceFileID),
    sourceOffset: firstOffset(input.sourceOffset, input.raw?.sourceOffset, input.rawEvent?.SourceOffset),
    rawLineHash: firstText(input.rawLineHash, input.raw?.rawLineHash, input.rawEvent?.RawLineHash),
  }, { observedMode: "live" });
}

export function normalizeCombatEvent(input = {}, { observedMode = "cache" } = {}) {
  const type = normalizeCombatType(input.type);
  const rawLog = String(input.rawLog ?? input.provenance?.rawLog ?? "").replace(/[\r\n]+$/, "");
  const rawLineHash = firstText(input.rawLineHash, input.provenance?.rawLineHash, rawLog ? hashText(rawLog) : "");
  const sourceFile = firstText(input.sourceFile, input.provenance?.sourceFile);
  const sourceFileId = firstText(input.sourceFileId, input.provenance?.sourceFileId);
  const sourceOffset = firstOffset(input.sourceOffset, input.provenance?.sourceOffset);
  const sourceEventId = firstText(input.sourceEventId, input.provenance?.sourceEventId);
  const rawActors = extractRawActors(rawLog, type);
  const attacker = normalizeActor(input.attacker, rawActors.attacker);
  const victim = normalizeActor(input.victim, rawActors.victim);
  const rawWeapon = firstText(input.rawWeapon, input.provenance?.rawWeapon, extractRawWeapon(rawLog));
  const weaponValue = input.weapon === null || input.weapon === undefined ? rawWeapon : String(input.weapon);
  const observedModes = uniqueModes([...(Array.isArray(input.observedModes) ? input.observedModes : []), observedMode]);
  const sourceMode = observedMode === "cache"
    ? (String(input.sourceMode ?? "").trim() || observedModes[0] || "replay")
    : observedMode;
  const id = buildStableCombatEventId({
    type,
    sourceFileId,
    sourceFile,
    sourceOffset,
    sourceEventId,
    rawLineHash,
    rawLog,
  });

  return {
    schema: "combat-event.v1",
    id,
    type,
    serverId: String(input.serverId ?? ""),
    time: String(input.time ?? input.occurredAt ?? new Date().toISOString()),
    logTime: String(input.logTime ?? ""),
    attacker,
    victim,
    weapon: normalizeNullableValue(weaponValue),
    weaponState: classifyValue(weaponValue),
    rawWeapon,
    damage: optionalNumber(input.damage),
    isTeamKill: Boolean(input.isTeamKill),
    relation: normalizeRelation(input.relation),
    parse: normalizeParse(input.parse),
    source: "combat-collector",
    sourceMode,
    observedModes,
    isReplay: sourceMode !== "live",
    canTriggerActions: sourceMode === "live",
    provenance: {
      sourceFile,
      sourceFileId,
      sourceOffset,
      sourceEventId,
      rawLineHash,
      rawLog,
    },
    sourceFile,
    sourceFileId,
    sourceOffset,
    sourceEventId,
    rawLineHash,
    rawLog,
  };
}

export function buildStableCombatEventId({
  type = "damage",
  sourceFileId = "",
  sourceFile = "",
  sourceOffset = null,
  sourceEventId = "",
  rawLineHash = "",
  rawLog = "",
} = {}) {
  const normalizedType = normalizeCombatType(type);
  const offset = optionalOffset(sourceOffset);
  const fileIdentity = firstText(sourceFileId, sourceFile ? hashText(sourceFile) : "");
  if (fileIdentity && offset !== null) return `combat:${normalizedType}:${fileIdentity}:${offset}`;
  if (sourceEventId) return `combat:${normalizedType}:event:${hashText(sourceEventId)}`;
  const lineIdentity = firstText(rawLineHash, rawLog ? hashText(rawLog) : "");
  if (lineIdentity) return `combat:${normalizedType}:raw:${lineIdentity}`;
  return `combat:${normalizedType}:partial:${hashText(JSON.stringify({ sourceFile, sourceOffset: offset }))}`;
}

export function combatIdentityKeys(record = {}) {
  const type = normalizeCombatType(record.type);
  const sourceFileId = firstText(record.sourceFileId, record.provenance?.sourceFileId);
  const sourceFile = firstText(record.sourceFile, record.provenance?.sourceFile);
  const sourceOffset = firstOffset(record.sourceOffset, record.provenance?.sourceOffset);
  const sourceEventId = firstText(record.sourceEventId, record.provenance?.sourceEventId);
  const rawLineHash = firstText(record.rawLineHash, record.provenance?.rawLineHash,
    record.rawLog || record.provenance?.rawLog ? hashText(record.rawLog ?? record.provenance?.rawLog) : "");
  const keys = [`id:${String(record.id ?? "")}`];
  if (sourceFileId && sourceOffset !== null) keys.push(`position:${type}:${sourceFileId}:${sourceOffset}`);
  if (sourceFile && sourceOffset !== null) keys.push(`path-position:${type}:${hashText(sourceFile)}:${sourceOffset}`);
  if (rawLineHash && sourceOffset !== null) keys.push(`offset-raw:${type}:${sourceOffset}:${rawLineHash}`);
  if (sourceEventId) keys.push(`event:${type}:${sourceEventId}`);
  if (rawLineHash && sourceOffset === null && !sourceEventId) keys.push(`raw-fallback:${type}:${rawLineHash}`);
  return keys.filter((key) => !key.endsWith(":"));
}

export function normalizeCombatType(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (["damaged", "damage"].includes(text)) return "damage";
  if (["wounded", "wound", "knockdown", "down"].includes(text)) return "wound";
  if (["kill", "killed", "death", "died", "dead", "tk"].includes(text)) return "death";
  return "damage";
}

function normalizeActor(value = {}, rawValue = "") {
  const rawName = firstText(value?.rawName, rawValue, value?.name);
  return {
    name: normalizeNullableValue(value?.name),
    rawName,
    nameState: classifyValue(rawName),
    steam64ID: normalizeNullableValue(value?.steam64ID ?? value?.steamID),
    eosID: normalizeNullableValue(value?.eosID ?? value?.EOSID),
    controllerID: normalizeNullableValue(value?.controllerID),
    teamID: optionalNumber(value?.teamID),
    squadID: optionalNumber(value?.squadID),
  };
}

function normalizeNullableValue(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text && !/^(?:nullptr|null|none|invalid)$/i.test(text) ? text : null;
}

function classifyValue(value) {
  if (value === null || value === undefined || String(value).trim() === "") return "missing";
  return /^(?:nullptr|null|none|invalid)$/i.test(String(value).trim()) ? "nullptr" : "present";
}

function extractRawActors(rawLog, type) {
  const victimExpression = type === "damage"
    ? /Player:\s*(.*?)\s+ActualDamage=/i
    : /(?:Wound|Die)\(\): Player:\s*(.*?)\s+KillingDamage=/i;
  return {
    victim: capture(rawLog, victimExpression),
    attacker: capture(rawLog, /\sfrom\s+(.*?)\s*(?:\(Online IDs:|caused by)/i),
  };
}

function extractRawWeapon(rawLog) {
  return capture(rawLog, /\scaused by\s+(.+?)\s*$/i);
}

function normalizeRelation(value = {}) {
  return {
    known: Boolean(value?.known),
    sameTeam: Boolean(value?.sameTeam),
    reason: String(value?.reason ?? ""),
  };
}

function normalizeParse(value = {}) {
  return {
    confidence: String(value?.confidence ?? ""),
    identityConfidence: String(value?.identityConfidence ?? ""),
    parseConfidence: String(value?.parseConfidence ?? ""),
    status: String(value?.status ?? ""),
  };
}

function uniqueModes(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter((value) => value === "live" || value === "replay"))];
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalOffset(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function firstOffset(...values) {
  for (const value of values) {
    const offset = optionalOffset(value);
    if (offset !== null) return offset;
  }
  return null;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function capture(text, expression) {
  return String(text ?? "").match(expression)?.[1]?.trim() ?? "";
}

function hashText(value) {
  return crypto.createHash("sha1").update(String(value ?? ""), "utf8").digest("hex");
}
