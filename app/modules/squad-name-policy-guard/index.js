// -*- coding: utf-8 -*-

import {
  buildSquadNamePolicyWarningMessages,
  testSquadNamePolicy,
  classifySquadNameWithPolicy,
} from "../../domain/squad-name-policy/index.js";
import {
  SQUAD_RULE_SOURCES,
  emitSquadNameRulePassed,
  emitSquadRuleViolation,
} from "../squad-rule-chain/events.js";

const MODULE_ID = "module.squadNamePolicyGuard";
const API_NAME = "squadNamePolicyGuard";
const DEFAULT_DEDUPE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RECENT_LIMIT = 200;
const DEFAULT_WARNING_REPEAT_DELAY_MS = 2_000;
const DEFAULT_WARNING_REPEAT_COUNT = 2;

export function createSquadNamePolicyGuardModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: MODULE_ID,
    source: MODULE_ID,
    channel: "module",
  }) ?? core.logger;

  let runtimeConfig = readConfig(config);
  const unsubscribers = [];
  const recentRecords = [];
  const processedKeys = new Map();
  const stats = {
    evaluated: 0,
    violations: 0,
    disbanded: 0,
    disbandFailed: 0,
    warningsSent: 0,
    warningsSkipped: 0,
    duplicatesSkipped: 0,
    errors: 0,
  };
  let serial = Promise.resolve();

  const api = {
    getState() {
      runtimeConfig = readConfig(config);
      return {
        enabled: runtimeConfig.enabled,
        detectLogCreated: runtimeConfig.detectLogCreated,
        action: runtimeConfig.action,
        dedupeTtlMs: runtimeConfig.dedupeTtlMs,
        warningRepeatDelayMs: runtimeConfig.warningRepeatDelayMs,
        warningRepeatCount: runtimeConfig.warningRepeatCount,
        stats: { ...stats },
        recent: recentRecords.slice().reverse(),
      };
    },

    classifySquadName(squadName) {
      return classifySquadNameWithPolicy(squadName, config);
    },

    simulate(request = {}) {
      const normalized = normalizeSquadEvent({
        ...request,
        serverId: request.serverId ?? core?.webStatus?.serverId,
        source: "simulate",
      });
      const classified = classifySquadNameWithPolicy(normalized.squadName, config);
      const evaluation = classified.evaluation;
      return {
        event: normalized,
        classification: classified.classification,
        policyRevision: classified.policyRevision,
        evaluation,
        violation: isViolation(evaluation),
        warningMessages: buildWarningMessages(evaluation),
        action: runtimeConfig.action,
      };
    },

    clearRecent() {
      const cleared = recentRecords.length;
      recentRecords.splice(0);
      processedKeys.clear();
      return { ok: true, cleared };
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "Squad Name Policy Guard",
      kind: "module",
      version: "1.0.0",
      description: "Enforce squad-name policy from lifecycle squad creation events.",
    },
    apiName: API_NAME,
    api,

    async start() {
      runtimeConfig = readConfig(config);
      if (!runtimeConfig.enabled) {
        moduleLogger?.info?.("SquadNamePolicyGuard module disabled by config.");
        return;
      }

      if (runtimeConfig.detectLogCreated) {
        unsubscribers.push(core.eventBus.onModuleEvent("module.squadLifecycle", "squadCreated", (event) => {
          void enqueue(() => handleSquadCandidate(event, "LOG"));
        }));
      }

      moduleLogger?.info?.("SquadNamePolicyGuard module started.", {
        operation: "start",
        data: {
          detectLogCreated: runtimeConfig.detectLogCreated,
          action: runtimeConfig.action,
        },
      });
    },

    async stop() {
      for (const unsubscriber of unsubscribers.splice(0)) {
        try {
          unsubscriber();
        } catch {}
      }
      processedKeys.clear();
    },
  };

  function enqueue(task) {
    const next = serial.then(task, task);
    serial = next.catch(() => {});
    return next;
  }

  async function handleSquadCandidate(event = {}, source = "LOG") {
    runtimeConfig = readConfig(config);
    if (!runtimeConfig.enabled) return null;

    cleanupProcessedKeys();
    const normalized = normalizeSquadEvent({ ...event, source });
    if (!normalized.serverId || normalized.teamId == null || normalized.squadId == null || !normalized.squadName) {
      return rememberRecord({
        event: normalized,
        source,
        status: "skipped",
        reason: "missing_required_fields",
      });
    }

    const dedupeKey = buildDedupeKey(normalized);
    if (processedKeys.has(dedupeKey)) {
      stats.duplicatesSkipped += 1;
      return rememberRecord({
        event: normalized,
        source,
        status: "skipped",
        reason: "duplicate",
      });
    }
    processedKeys.set(dedupeKey, Date.now());

    stats.evaluated += 1;
    const evaluation = testSquadNamePolicy(normalized.squadName, config);
    if (!isViolation(evaluation)) {
      const allowedRecord = rememberRecord({
        event: normalized,
        source,
        status: "allowed",
        reason: evaluation.reason,
        evaluation,
      });
      emitSquadNameRulePassed(core, {
        serverId: normalized.serverId,
        matchId: normalized.matchId,
        teamId: normalized.teamId,
        squadId: normalized.squadId,
        squadName: normalized.squadName,
        ...buildClassificationEventFields(normalized.squadName, evaluation, config),
        leaderSteamId: normalized.creatorSteamId,
        leaderName: normalized.creatorName,
        leaderEosId: normalized.creatorEosId,
        createdAt: normalized.time,
        sourceEventId: normalized.eventId || buildDedupeKey(normalized),
      });
      return allowedRecord;
    }

    stats.violations += 1;
    const record = {
      event: normalized,
      source,
      status: "violation",
      reason: evaluation.reason,
      evaluation,
      warningMessages: buildWarningMessages(evaluation),
      actions: [],
    };
    rememberRecord(record);

    try {
      emitSquadRuleViolation(core, {
        serverId: normalized.serverId,
        matchId: normalized.matchId,
        teamId: normalized.teamId,
        squadId: normalized.squadId,
        squadName: normalized.squadName,
        ...buildClassificationEventFields(normalized.squadName, evaluation, config),
        leaderSteamId: normalized.creatorSteamId,
        leaderName: normalized.creatorName,
        leaderEosId: normalized.creatorEosId,
        source: SQUAD_RULE_SOURCES.squadNameRule,
        reason: evaluation.reason,
        createdAt: normalized.time,
        sourceEventId: normalized.eventId || buildDedupeKey(normalized),
        warningMessages: expandWarningMessages(record.warningMessages, runtimeConfig),
        removeLeaderBeforeDisband: runtimeConfig.action === "disband_then_warn",
      });
      record.actions.push({ type: "violation_emitted" });
      record.status = "handled";
      record.updatedAt = nowIso();
    } catch (error) {
      stats.errors += 1;
      record.status = "error";
      record.error = error instanceof Error ? error.message : String(error);
      record.updatedAt = nowIso();
      moduleLogger?.warn?.(`[SquadNamePolicyGuard] failed to handle ${normalized.squadName}: ${record.error}`);
    }

    return record;
  }
  function rememberRecord(record) {
    const now = nowIso();
    const saved = {
      id: `squadNamePolicyGuard:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      createdAt: now,
      updatedAt: now,
      ...record,
    };
    recentRecords.push(saved);
    if (recentRecords.length > runtimeConfig.recentLimit) {
      recentRecords.splice(0, recentRecords.length - runtimeConfig.recentLimit);
    }
    return saved;
  }

  function cleanupProcessedKeys() {
    const cutoff = Date.now() - runtimeConfig.dedupeTtlMs;
    for (const [key, timestamp] of processedKeys.entries()) {
      if (timestamp < cutoff) processedKeys.delete(key);
    }
  }
}

function readConfig(config) {
  const raw = config?.get?.("modules.squadNamePolicyGuard", {}) ?? {};
  return {
    enabled: raw.enabled !== false,
    detectLogCreated: raw.detectLogCreated !== false,
    action: String(raw.action ?? "disband_then_warn").trim() || "disband_then_warn",
    dedupeTtlMs: positiveNumber(raw.dedupeTtlMs, DEFAULT_DEDUPE_TTL_MS),
    recentLimit: positiveNumber(raw.recentLimit, DEFAULT_RECENT_LIMIT),
    warningRepeatDelayMs: positiveNumber(
      raw.warningRepeatDelayMs ?? raw.warningDelayMs,
      DEFAULT_WARNING_REPEAT_DELAY_MS,
    ),
    warningRepeatCount: positiveNumber(raw.warningRepeatCount, DEFAULT_WARNING_REPEAT_COUNT),
  };
}

function normalizeSquadEvent(event = {}) {
  return {
    eventId: text(event.eventId ?? event.sourceEventId),
    creationSignature: text(event.creationSignature),
    serverId: text(event.serverId),
    matchId: text(event.matchId ?? event.sessionId ?? event.sessionID),
    teamId: nullableNumber(event.teamId ?? event.teamID),
    squadId: nullableNumber(event.squadId ?? event.squadID),
    squadName: text(event.squadName ?? event.name),
    teamName: text(event.teamName ?? event.factionName),
    creatorName: text(event.creatorName ?? event.leaderName),
    creatorSteamId: text(event.creatorSteamId ?? event.creatorSteamID ?? event.steamId ?? event.steamID ?? event.leaderSteamId),
    creatorEosId: text(event.creatorEosId ?? event.creatorEOSID ?? event.eosId ?? event.eosID ?? event.leaderEosId),
    source: text(event.source),
    time: text(event.time ?? event.createdAt ?? event.observedAt) || nowIso(),
    generation: nullableNumber(event.generation ?? event.record?.generation) ?? 1,
  };
}

function buildWarningMessages(evaluation) {
  if (Array.isArray(evaluation?.warningMessages) && evaluation.warningMessages.length > 0) {
    return evaluation.warningMessages.filter((item) => String(item ?? "").trim());
  }
  return buildSquadNamePolicyWarningMessages(evaluation?.suggestions ?? []);
}

function buildClassificationEventFields(squadName, evaluation, config) {
  const classified = classifySquadNameWithPolicy(squadName, config);
  const classification = classified.classification;
  return {
    classification: cloneValue(classification),
    policyRevision: classified.policyRevision,
    squadType: text(classification?.nature) || "other",
    squadNature: text(classification?.nature) || "other",
    squadTypeId: text(classification?.typeId),
    squadTypeLabel: text(classification?.typeLabel),
    squadRuleId: text(classification?.ruleId),
    effectiveMaxPlayers: nullableNumber(classification?.effectiveMaxPlayers),
    maxPlayersSource: text(classification?.maxPlayersSource) || "none",
    assetPath: text(classification?.assetPath),
    classificationMetadata: {
      reason: text(evaluation?.reason),
      matchedKind: text(classification?.matchedKind),
      matchedValue: text(classification?.matchedValue),
      fallback: false,
    },
  };
}

function expandWarningMessages(messages = [], runtimeConfig = {}) {
  const normalized = messages
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  if (normalized.length === 0) return [];
  const count = Math.max(1, Number(runtimeConfig.warningRepeatCount ?? DEFAULT_WARNING_REPEAT_COUNT) || 1);
  const results = [];
  for (let round = 0; round < count; round += 1) {
    for (const message of normalized) results.push(message);
  }
  return results;
}

function isViolation(evaluation) {
  return evaluation?.valid === false;
}

function buildDedupeKey(event) {
  const creationSignature = text(event.creationSignature);
  const gen = event.generation ?? 1;
  if (creationSignature) {
    return `creation:${creationSignature}:${gen}`;
  }
  return [
    event.serverId,
    event.matchId,
    event.teamId,
    event.squadId,
    normalizeName(event.squadName),
    gen,
  ].map((item) => String(item ?? "")).join("|");
}

function normalizeName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function summarizeResult(result) {
  if (!result || typeof result !== "object") return result ?? null;
  return {
    ok: result.ok,
    success: result.success,
    skipped: result.skipped,
    skipReason: result.skipReason,
    error: result.error,
    errorMessage: result.errorMessage,
    message: result.message,
    command: result.command,
    commandText: result.commandText,
    rconExecuted: result.rconExecuted,
    rconResponse: result.rconResponse,
  };
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return number;
}

function nullableNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value) {
  return String(value ?? "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

export default createSquadNamePolicyGuardModule;
