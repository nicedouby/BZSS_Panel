// -*- coding: utf-8 -*-

export const SQUAD_RULE_CHAIN_MODULE_ID = "module.squadRuleChain";

export const SQUAD_NAME_RULE_PASSED_EVENT = "squadNameRulePassed";
export const TIERED_SQUAD_TIME_PASSED_EVENT = "tieredSquadTimePassed";
export const FINAL_SQUAD_RULE_PASSED_EVENT = "finalSquadRulePassed";
export const SQUAD_RULE_VIOLATION_EVENT = "squadRuleViolation";

export const SQUAD_RULE_SOURCES = Object.freeze({
  squadNameRule: "squad_name_rule",
  tieredSquadTime: "tiered_squad_time",
  fairSquadCreation: "fair_squad_creation",
});

export function emitSquadNameRulePassed(core, event = {}) {
  core?.eventBus?.emitModuleEvent?.(
    SQUAD_RULE_CHAIN_MODULE_ID,
    SQUAD_NAME_RULE_PASSED_EVENT,
    normalizeRuleChainPassEvent(event),
  );
}

export function emitTieredSquadTimePassed(core, event = {}) {
  core?.eventBus?.emitModuleEvent?.(
    SQUAD_RULE_CHAIN_MODULE_ID,
    TIERED_SQUAD_TIME_PASSED_EVENT,
    normalizeRuleChainPassEvent(event),
  );
}

export function emitFinalSquadRulePassed(core, event = {}) {
  core?.eventBus?.emitModuleEvent?.(
    SQUAD_RULE_CHAIN_MODULE_ID,
    FINAL_SQUAD_RULE_PASSED_EVENT,
    normalizeRuleChainPassEvent(event),
  );
}

export function emitSquadRuleViolation(core, event = {}) {
  core?.eventBus?.emitModuleEvent?.(
    SQUAD_RULE_CHAIN_MODULE_ID,
    SQUAD_RULE_VIOLATION_EVENT,
    normalizeSquadRuleViolationEvent(event),
  );
}

export function normalizeRuleChainPassEvent(event = {}) {
  return {
    serverId: text(event.serverId),
    matchId: text(event.matchId),
    sourceMode: normalizeSourceMode(event.sourceMode ?? event.SourceMode ?? event.rawEvent?.SourceMode),
    canTriggerActions: normalizeBoolean(event.canTriggerActions ?? event.CanTriggerActions ?? event.rawEvent?.CanTriggerActions, true),
    teamId: nullableNumber(event.teamId ?? event.teamID),
    squadId: nullableNumber(event.squadId ?? event.squadID),
    squadName: text(event.squadName),
    squadType: text(event.squadType),
    squadNature: text(event.squadNature ?? event.squadType),
    squadTypeId: text(event.squadTypeId),
    squadTypeLabel: text(event.squadTypeLabel),
    squadRuleId: text(event.squadRuleId),
    effectiveMaxPlayers: nullableNumber(event.effectiveMaxPlayers),
    maxPlayersSource: text(event.maxPlayersSource) || "none",
    assetPath: text(event.assetPath),
    classificationMetadata: cloneValue(event.classificationMetadata) ?? {},
    leaderSteamId: text(event.leaderSteamId ?? event.creatorSteamId ?? event.steamId ?? event.steamID),
    leaderName: text(event.leaderName ?? event.creatorName ?? event.playerName),
    leaderEosId: text(event.leaderEosId ?? event.creatorEosId ?? event.eosId ?? event.eosID),
    createdAt: text(event.createdAt ?? event.time) || nowIso(),
    createdAtMs: numberOrNull(event.createdAtMs ?? event.timeMs) ?? Date.now(),
    sourceEventId: text(event.sourceEventId ?? event.eventId),
  };
}

export function normalizeSquadRuleViolationEvent(event = {}) {
  return {
    serverId: text(event.serverId),
    matchId: text(event.matchId),
    sourceMode: normalizeSourceMode(event.sourceMode ?? event.SourceMode ?? event.rawEvent?.SourceMode),
    canTriggerActions: normalizeBoolean(event.canTriggerActions ?? event.CanTriggerActions ?? event.rawEvent?.CanTriggerActions, true),
    teamId: nullableNumber(event.teamId ?? event.teamID),
    squadId: nullableNumber(event.squadId ?? event.squadID),
    squadName: text(event.squadName),
    squadType: text(event.squadType),
    squadNature: text(event.squadNature ?? event.squadType),
    squadTypeId: text(event.squadTypeId),
    squadTypeLabel: text(event.squadTypeLabel),
    squadRuleId: text(event.squadRuleId),
    effectiveMaxPlayers: nullableNumber(event.effectiveMaxPlayers),
    maxPlayersSource: text(event.maxPlayersSource) || "none",
    assetPath: text(event.assetPath),
    classificationMetadata: cloneValue(event.classificationMetadata) ?? {},
    leaderSteamId: text(event.leaderSteamId ?? event.creatorSteamId ?? event.steamId ?? event.steamID),
    leaderName: text(event.leaderName ?? event.creatorName ?? event.playerName),
    leaderEosId: text(event.leaderEosId ?? event.creatorEosId ?? event.eosId ?? event.eosID),
    source: text(event.source),
    reason: text(event.reason),
    createdAt: text(event.createdAt ?? event.time) || nowIso(),
    createdAtMs: numberOrNull(event.createdAtMs ?? event.timeMs) ?? Date.now(),
    sourceEventId: text(event.sourceEventId ?? event.eventId),
    warningMessages: Array.isArray(event.warningMessages)
      ? event.warningMessages.map((item) => text(item)).filter(Boolean)
      : [],
    broadcastMessage: text(event.broadcastMessage),
    disbandReason: text(event.disbandReason),
    removeLeaderBeforeDisband: Boolean(event.removeLeaderBeforeDisband),
    metadata: cloneValue(event.metadata) ?? null,
  };
}

function text(value) {
  return String(value ?? "").trim();
}

function nullableNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeSourceMode(value) {
  const textValue = text(value).toLowerCase();
  if (textValue === "live" || textValue === "recovery" || textValue === "replay" || textValue === "backfill") {
    return textValue;
  }
  return "live";
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  const textValue = text(value).toLowerCase();
  if (textValue === "true" || textValue === "1" || textValue === "yes") return true;
  if (textValue === "false" || textValue === "0" || textValue === "no") return false;
  return fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function cloneValue(value) {
  if (value == null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}
