// -*- coding: utf-8 -*-

const COMBAT_EVENT_TYPE_BY_NAME = {
  On_PlayerDamaged: "damaged",
  On_PlayerWounded: "wounded",
  On_PlayerDied: "died",
};

const CONFIDENCE_RANK = {
  Low: 0,
  MediumLow: 1,
  Medium: 2,
  High: 3,
};

const CONFIDENCE_FROM_PARSE_STATUS = {
  Full: "High",
  Partial: "Medium",
  Failed: "Low",
};

/**
 * Core: EventNormalizer
 *
 * 把 Python RawGameEvent 转成 JS 内部 NormalizedEvent，
 * 并在这里做统一字段标准化，避免下游模块自行拼语义。
 */
export function normalizeRawGameEvent(rawEvent) {
  const serverId = String(rawEvent.ServerID ?? "");
  const sessionId = String(rawEvent.SessionID ?? "");
  const seq = String(rawEvent.Seq ?? "");
  const eventName = String(rawEvent.Event ?? "UnknownEvent");
  const params = extractParams(rawEvent);
  const paramMap = Object.fromEntries(params.map((param) => [param.name, param.value]));

  const event = {
    eventId: `${serverId}:${sessionId}:${seq}`,
    eventName,
    layer: "core",
    source: "python-log-parser",

    serverId,
    sessionId,
    seq,

    time: String(rawEvent.Time ?? new Date().toISOString()),
    logTime: String(rawEvent.LogTime ?? ""),

    params,
    paramMap,

    rawEvent,
    rawLog: String(rawEvent.Raw ?? ""),
    normalized: null,
  };

  event.normalized = buildNormalizedPayload(event);
  return event;
}

function extractParams(rawEvent) {
  const params = [];

  for (const [key, value] of Object.entries(rawEvent)) {
    const match = key.match(/^Param(\d+)_(.+)$/);
    if (!match) continue;

    params.push({
      index: Number(match[1]),
      name: match[2],
      value: String(value ?? ""),
    });
  }

  params.sort((a, b) => a.index - b.index);
  return params;
}

function buildNormalizedPayload(event) {
  if (COMBAT_EVENT_TYPE_BY_NAME[event.eventName]) {
    return {
      category: "combat",
      combat: normalizeCombatPayload(event),
    };
  }

  if (event.eventName === "On_ServerTickRateUpdated") {
    return {
      category: "server_status",
      serverTickRate: normalizeServerTickRatePayload(event),
    };
  }

  return null;
}

function normalizeCombatPayload(event) {
  const parseStatus = getParam(event, "ParseStatus", "Failed");
  const identityConfidence = getParam(event, "IdentityConfidence")
    || getParam(event, "Confidence", "Low");
  const parseConfidence = getParam(event, "ParseConfidence")
    || confidenceFromParseStatus(parseStatus);
  const causedBy = getParam(event, "CausedBy");
  const directWeapon = getParam(event, "Weapon") || causedBy;

  return {
    type: COMBAT_EVENT_TYPE_BY_NAME[event.eventName],
    rawVictimName: getParam(event, "VictimName"),
    victimName: getParam(event, "VictimName"),
    victimDisplayName: getParam(event, "VictimName"),
    victimNameSource: getParam(event, "VictimName") ? "raw" : "",
    rawAttackerName: getParam(event, "AttackerName"),
    attackerName: getParam(event, "AttackerName"),
    attackerDisplayName: getParam(event, "AttackerName"),
    attackerNameSource: getParam(event, "AttackerName") ? "raw" : "",
    attackerControllerId: getParam(event, "AttackerControllerID"),
    attackerEOSID: getParam(event, "AttackerEOSID"),
    attackerSteam64ID: getParam(event, "AttackerSteam64ID"),
    victimCachedEOSID: getParam(event, "VictimCachedEOSID"),
    victimCachedSteam64ID: getParam(event, "VictimCachedSteam64ID"),
    attackerTeamID: getParam(event, "AttackerTeamID") || getParam(event, "AttackerTeamId") || getParam(event, "AttackerTeam"),
    victimTeamID: getParam(event, "VictimTeamID") || getParam(event, "VictimTeamId") || getParam(event, "VictimTeam"),
    fromObject: getParam(event, "FromObject"),
    damage: getParam(event, "ActualDamage") || getParam(event, "KillingDamage"),
    rawCausedBy: causedBy,
    causedBy,
    causedByCategory: classifyCausedBy(causedBy),
    weapon: directWeapon,
    parseStatus,
    parseConfidence,
    identityConfidence,
    confidence: lowestConfidence(identityConfidence, parseConfidence),
    identitySource: getParam(event, "IdentitySource"),
  };
}

function normalizeServerTickRatePayload(event) {
  const rawTickRate = getParam(event, "TickRate");
  const tps = Number.parseFloat(rawTickRate);
  return {
    type: "server_tick_rate_updated",
    tps: Number.isFinite(tps) ? tps : null,
    unit: getParam(event, "Unit", "TPS"),
    status: getParam(event, "Status", "unknown") || "unknown",
    expected: parseNullableNumber(getParam(event, "Expected")),
    warningBelow: parseNullableNumber(getParam(event, "WarningBelow")),
    criticalBelow: parseNullableNumber(getParam(event, "CriticalBelow")),
    time: event.time,
    logTime: event.logTime,
    rawLog: event.rawLog,
  };
}

function confidenceFromParseStatus(parseStatus) {
  return CONFIDENCE_FROM_PARSE_STATUS[parseStatus] ?? "Low";
}

function lowestConfidence(left, right) {
  const leftRank = CONFIDENCE_RANK[left] ?? 0;
  const rightRank = CONFIDENCE_RANK[right] ?? 0;
  const targetRank = Math.min(leftRank, rightRank);

  for (const [label, rank] of Object.entries(CONFIDENCE_RANK)) {
    if (rank === targetRank) return label;
  }

  return "Low";
}

function parseNullableNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function classifyCausedBy(value) {
  const text = String(value ?? "").trim();
  if (!text) return "unknown";
  if (/^BP_Soldier_/i.test(text)) return "pawn";
  if (/^BP_PlayerController_/i.test(text)) return "controller";
  if (/^BP_/i.test(text)) return "object";
  return "unknown";
}

export function getParam(event, name, defaultValue = "") {
  const value = event.paramMap?.[name];
  return value == null ? defaultValue : value;
}
