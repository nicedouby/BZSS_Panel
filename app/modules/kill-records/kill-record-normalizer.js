// -*- coding: utf-8 -*-

import crypto from "node:crypto";

const DEATH_MARKER = "Die(): Player:";

export function isLikelyDeathLine(line) {
  const text = String(line ?? "");
  return text.includes(DEATH_MARKER) && text.includes("KillingDamage=") && text.includes("caused by");
}

export function parseReplayKillLine(line, context = {}) {
  const rawLog = String(line ?? "").replace(/[\r\n]+$/, "");
  if (!isLikelyDeathLine(rawLog)) return null;

  const victimName = capture(rawLog, /Die\(\): Player:\s*(.*?)\s+KillingDamage=/i);
  const damage = capture(rawLog, /KillingDamage=([^\s]+)/i);
  const fromObject = capture(rawLog, /\sfrom\s+(.*?)\s*\(Online IDs:/i)
    || capture(rawLog, /\sfrom\s+(.*?)\s+caused by\s/i);
  const causedBy = capture(rawLog, /\scaused by\s+(.+?)\s*$/i);
  const eosID = capture(rawLog, /\bEOS:\s*([^\s|)]+)/i);
  const steam64ID = capture(rawLog, /\bsteam:\s*([^\s|)]+)/i);
  const controllerID = capture(rawLog, /(?:Player\s+)?Cont(?:r)?oller ID:\s*([^\s|)]+)/i)
    || (/PlayerController/i.test(fromObject) ? fromObject : "");
  const attackerName = normalizeAttackerName(fromObject);
  const attackerTeamID = parseOptionalNumber(capture(rawLog, /AttackerTeamI[Dd]\s*[:=]\s*(-?\d+)/i));
  const victimTeamID = parseOptionalNumber(capture(rawLog, /VictimTeamI[Dd]\s*[:=]\s*(-?\d+)/i));
  const relationKnown = attackerTeamID !== null && victimTeamID !== null;
  const sameTeam = relationKnown ? attackerTeamID === victimTeamID : false;
  const sourceOffset = Math.max(0, Number(context.sourceOffset) || 0);
  const sourceFileId = String(context.sourceFileId ?? "").trim();
  const sourceFile = String(context.sourceFile ?? "").trim();
  const id = buildReplayKillId({ sourceFileId, sourceFile, sourceOffset, rawLog });
  const logTime = extractLogTime(rawLog);

  return normalizeReplayRecord({
    id,
    serverId: String(context.serverId ?? ""),
    time: logTimeToIso(logTime) || String(context.time ?? new Date().toISOString()),
    logTime,
    attacker: {
      name: attackerName,
      steam64ID: normalizeOnlineId(steam64ID),
      eosID: normalizeOnlineId(eosID),
      controllerID,
      teamID: attackerTeamID,
      squadID: null,
    },
    victim: {
      name: victimName,
      steam64ID: "",
      eosID: "",
      controllerID: "",
      teamID: victimTeamID,
      squadID: null,
    },
    weapon: causedBy,
    damage: parseOptionalNumber(damage),
    isTeamKill: relationKnown && sameTeam,
    relation: {
      known: relationKnown,
      sameTeam,
      reason: relationKnown ? (sameTeam ? "same_team_id" : "different_team_id") : "team_identity_unavailable",
    },
    parse: {
      confidence: victimName && damage ? (attackerName || controllerID || steam64ID || eosID ? "High" : "Medium") : "Low",
      identityConfidence: attackerName || controllerID || steam64ID || eosID ? "Medium" : "Low",
      parseConfidence: victimName && damage ? "High" : "Low",
      status: victimName && damage ? "Full" : "Partial",
    },
    sourceFile,
    sourceFileId,
    sourceOffset,
    rawLog,
  });
}

export function normalizeReplayRecord(input = {}) {
  const relation = input.relation && typeof input.relation === "object" ? input.relation : {};
  return {
    ...input,
    id: String(input.id ?? ""),
    source: "replay",
    sourceMode: "replay",
    canTriggerActions: false,
    isReplay: true,
    serverId: String(input.serverId ?? ""),
    time: String(input.time ?? new Date().toISOString()),
    logTime: String(input.logTime ?? ""),
    attacker: normalizePlayer(input.attacker),
    victim: normalizePlayer(input.victim),
    weapon: String(input.weapon ?? ""),
    damage: parseOptionalNumber(input.damage),
    isTeamKill: Boolean(input.isTeamKill),
    relation: {
      known: Boolean(relation.known),
      sameTeam: Boolean(relation.sameTeam),
      reason: String(relation.reason ?? ""),
    },
    parse: {
      confidence: String(input.parse?.confidence ?? ""),
      identityConfidence: String(input.parse?.identityConfidence ?? ""),
      parseConfidence: String(input.parse?.parseConfidence ?? ""),
      status: String(input.parse?.status ?? ""),
    },
    sourceFile: String(input.sourceFile ?? ""),
    sourceFileId: String(input.sourceFileId ?? ""),
    sourceOffset: Math.max(0, Number(input.sourceOffset) || 0),
    rawLog: String(input.rawLog ?? ""),
  };
}

export function normalizeLiveKill(record = {}) {
  const attacker = record.attacker ?? {};
  const victim = record.victim ?? {};
  const sourceEventId = String(record.raw?.sourceEventId ?? record.sourceEventId ?? record.id ?? "");
  const sourceOffset = Math.max(0, Number(record.sourceOffset ?? record.raw?.sourceOffset) || 0);
  const sourceFileId = String(record.sourceFileId ?? record.raw?.sourceFileId ?? "");
  return {
    id: sourceEventId ? `live:${sourceEventId}` : `live:${hashText(JSON.stringify(record))}`,
    source: "live",
    sourceMode: "live",
    canTriggerActions: true,
    isReplay: false,
    serverId: String(record.serverId ?? ""),
    time: String(record.time ?? new Date().toISOString()),
    logTime: String(record.logTime ?? record.logTimeText ?? ""),
    attacker: normalizePlayer({
      ...attacker,
      name: attacker.name ?? record.attackerName,
      steam64ID: attacker.steam64ID ?? record.attackerSteam64ID,
      eosID: attacker.eosID ?? record.attackerEOSID,
      controllerID: attacker.controllerID ?? record.attackerControllerID,
      teamID: attacker.teamID ?? record.attackerTeamID,
      squadID: attacker.squadID ?? record.attackerSquadID,
    }),
    victim: normalizePlayer({
      ...victim,
      name: victim.name ?? record.victimName,
      steam64ID: victim.steam64ID ?? record.victimSteam64ID,
      eosID: victim.eosID ?? record.victimEOSID,
      controllerID: victim.controllerID ?? record.victimControllerID,
      teamID: victim.teamID ?? record.victimTeamID,
      squadID: victim.squadID ?? record.victimSquadID,
    }),
    weapon: String(record.weaponName ?? record.weapon?.displayName ?? record.weapon?.cleaned ?? record.weapon ?? ""),
    damage: parseOptionalNumber(record.damage),
    isTeamKill: Boolean(record.isTeamKill ?? record.relation?.sameTeam),
    relation: {
      known: Boolean(record.relation?.known),
      sameTeam: Boolean(record.relation?.sameTeam),
      reason: String(record.relation?.reason ?? record.teamKillReason ?? ""),
    },
    parse: {
      confidence: String(record.confidence ?? record.parse?.confidence ?? ""),
      identityConfidence: String(record.identityConfidence ?? record.parse?.identityConfidence ?? ""),
      parseConfidence: String(record.parseConfidence ?? record.parse?.parseConfidence ?? ""),
      status: String(record.parseStatus ?? record.parse?.status ?? ""),
    },
    sourceFile: String(record.sourceFile ?? ""),
    sourceFileId,
    sourceOffset,
    rawLog: String(record.rawLog ?? record.raw?.rawLog ?? ""),
  };
}

export function buildReplayKillId({ sourceFileId = "", sourceFile = "", sourceOffset = 0, rawLog = "" } = {}) {
  const identity = String(sourceFileId || hashText(String(sourceFile || "unknown-source")));
  if (Number.isFinite(Number(sourceOffset))) return `kill:${identity}:${Math.max(0, Number(sourceOffset) || 0)}`;
  return `kill:${hashText(String(rawLog ?? ""))}`;
}

function normalizePlayer(value = {}) {
  return {
    name: String(value?.name ?? value?.displayName ?? ""),
    steam64ID: String(value?.steam64ID ?? value?.steamID ?? ""),
    eosID: String(value?.eosID ?? value?.EOSID ?? ""),
    controllerID: String(value?.controllerID ?? ""),
    teamID: parseOptionalNumber(value?.teamID),
    squadID: parseOptionalNumber(value?.squadID),
  };
}

function normalizeAttackerName(value) {
  const text = String(value ?? "").trim();
  if (!text || /^nullptr$/i.test(text) || /PlayerController/i.test(text) || /^BP_/i.test(text)) return "";
  return text;
}

function normalizeOnlineId(value) {
  const text = String(value ?? "").trim();
  return /^(?:invalid|none|nullptr)$/i.test(text) ? "" : text;
}

function parseOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function capture(text, expression) {
  return String(text ?? "").match(expression)?.[1]?.trim() ?? "";
}

function extractLogTime(line) {
  return capture(line, /^\[([^\]]+)\]/);
}

function logTimeToIso(value) {
  const match = String(value ?? "").match(/^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})$/);
  if (!match) return "";
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${match[7]}Z`;
}

function hashText(value) {
  return crypto.createHash("sha1").update(String(value ?? ""), "utf8").digest("hex");
}
