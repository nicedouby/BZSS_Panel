import crypto from "node:crypto";

export const COMBAT_WS_VERSION = 1;
export const COMBAT_KIND = Object.freeze({ damage: "dmg", wound: "down", death: "kill", revive: "rev", tk: "tk" });

export function protocolId() {
  return crypto.randomBytes(12).toString("base64url");
}

function text(value) {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result && !/^(?:null|nullptr|none|invalid)$/i.test(result) ? result : null;
}

function actor(value, fallbackName = null) {
  if (!value && !text(fallbackName)) return null;
  const result = {
    n: text(value?.name ?? value?.playerName ?? fallbackName),
    s: text(value?.steam64ID ?? value?.steamID ?? value?.steam),
    e: text(value?.eosID ?? value?.EOSID ?? value?.eos),
  };
  return Object.values(result).some(Boolean) ? result : null;
}

function timestamp(value) {
  if (Number.isFinite(Number(value))) return Math.trunc(Number(value));
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function isReplayEvent(input = {}) {
  const record = input?.record ?? input;
  return input?.isReplay === true || record?.isReplay === true
    || String(input?.sourceMode ?? record?.sourceMode ?? "").toLowerCase() === "replay"
    || input?.canTriggerActions === false || record?.canTriggerActions === false;
}

export function compactCombatEvent(input = {}, forcedKind = null) {
  const record = input?.record ?? input;
  const rawKind = String(forcedKind ?? record?.type ?? input?.type ?? "").toLowerCase();
  const kind = COMBAT_KIND[rawKind] ?? (Object.values(COMBAT_KIND).includes(rawKind) ? rawKind : null);
  if (!kind) return null;
  const weapon = record?.weapon?.displayName ?? record?.weapon?.name ?? record?.weapon ?? record?.rawWeapon ?? null;
  const damage = record?.damage ?? record?.actualDamage ?? null;
  return {
    i: protocolId(),
    k: kind,
    ts: timestamp(record?.time ?? input?.time ?? record?.occurredAt),
    a: actor(record?.attacker, record?.attackerName ?? record?.killerName ?? input?.killerName ?? input?.tk1),
    v: actor(record?.victim, record?.victimName ?? input?.victimName ?? input?.tk2),
    d: Number.isFinite(Number(damage)) ? Number(damage) : null,
    w: text(weapon),
  };
}

export function createCombatPacket({ matchId, serverId, events, now = Date.now(), packetId = protocolId() }) {
  return { t: "cb", v: COMBAT_WS_VERSION, pid: packetId, mid: String(matchId), sid: String(serverId ?? ""), ts: timestamp(now), e: events };
}

export function createMatchFinishedPacket({ matchId, serverId, data, now = Date.now(), packetId = protocolId() }) {
  return { t: "mf", v: COMBAT_WS_VERSION, pid: packetId, mid: String(matchId), sid: String(serverId ?? ""), ts: timestamp(now), data: data ?? null };
}
