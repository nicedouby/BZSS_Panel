// -*- coding: utf-8 -*-

import {
  buildSquadNamePolicyWarningMessages,
  testSquadNamePolicy,
} from "../../domain/squad-name-policy/index.js";

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

    simulate(request = {}) {
      const normalized = normalizeSquadEvent({
        ...request,
        serverId: request.serverId ?? core?.webStatus?.serverId,
        source: "simulate",
      });
      const evaluation = testSquadNamePolicy(normalized.squadName, config);
      return {
        event: normalized,
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
      return rememberRecord({
        event: normalized,
        source,
        status: "allowed",
        reason: evaluation.reason,
        evaluation,
      });
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
      if (runtimeConfig.action === "disband_then_warn") {
        const removeResult = await removeCreatorFromSquad(normalized, evaluation);
        record.actions.push({
          type: removeResult?.ok === false ? "remove_failed" : "removed",
          result: summarizeResult(removeResult),
        });
        const disbandResult = await disbandSquad(normalized, evaluation);
        record.actions.push({
          type: disbandResult?.ok === false ? "disband_failed" : "disbanded",
          result: summarizeResult(disbandResult),
        });
        if (disbandResult?.ok === false) stats.disbandFailed += 1;
        else stats.disbanded += 1;
      }

      const warningResults = await warnCreator(normalized, record.warningMessages);
      for (const warningResult of warningResults) {
        record.actions.push({
          type: warningResult?.success === false ? "warn_failed" : "warned",
          result: summarizeResult(warningResult),
        });
        if (warningResult?.success === false || warningResult?.skipped) stats.warningsSkipped += 1;
        else stats.warningsSent += 1;
      }
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

  async function disbandSquad(event, evaluation) {
    const request = {
      serverId: event.serverId,
      matchId: event.matchId,
      teamId: event.teamId,
      squadId: event.squadId,
      squadName: event.squadName,
      creatorName: event.creatorName,
      creatorSteamId: event.creatorSteamId,
      creatorEosId: event.creatorEosId,
      reason: `squad_name_policy_violation: ${evaluation.reason}`,
      source: MODULE_ID,
      operatorName: MODULE_ID,
      system: true,
      allowUnverifiedTarget: true,
      allowRefresh: false,
    };
    if (typeof modules?.squadManagement?.requestDisband === "function") {
      return await modules.squadManagement.requestDisband(request);
    }
    if (typeof modules?.squadManagement?.disband === "function") {
      return await modules.squadManagement.disband(request);
    }
    if (typeof modules?.squadManagement?.executeAction === "function") {
      return await modules.squadManagement.executeAction({ ...request, type: "disband_squad" });
    }
    return { ok: false, error: "squad_management_unavailable" };
  }

  async function removeCreatorFromSquad(event, evaluation) {
    if (!event.creatorName && !event.creatorSteamId && !event.creatorEosId) {
      return { ok: false, skipped: true, skipReason: "target_missing" };
    }

    const request = {
      serverId: event.serverId,
      matchId: event.matchId,
      name: event.creatorName,
      steamId: event.creatorSteamId,
      eosId: event.creatorEosId,
      squadName: event.squadName,
      teamId: event.teamId,
      squadId: event.squadId,
      reason: `squad_name_policy_pre_disband_remove: ${evaluation.reason}`,
      source: MODULE_ID,
      operatorName: MODULE_ID,
      system: true,
    };
    if (typeof modules?.squadManagement?.requestRemoveFromSquad === "function") {
      return await modules.squadManagement.requestRemoveFromSquad(request);
    }
    if (typeof modules?.squadManagement?.removeFromSquad === "function") {
      return await modules.squadManagement.removeFromSquad(request);
    }
    if (typeof modules?.squadManagement?.executeAction === "function") {
      return await modules.squadManagement.executeAction({ ...request, type: "remove_from_squad" });
    }
    return { ok: false, error: "squad_management_unavailable" };
  }

  async function warnCreator(event, messages) {
    const sender = modules?.adminWarn?.warnPlayer ?? modules?.adminWarn?.sendAdminWarn;
    if (typeof sender !== "function") {
      return messages.map(() => ({ success: false, skipped: true, skipReason: "admin_warn_unavailable" }));
    }
    if (!event.creatorName) {
      return messages.map(() => ({ success: false, skipped: true, skipReason: "target_missing" }));
    }

    const results = [];
    const normalizedMessages = messages
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
    if (normalizedMessages.length === 0) return results;

    for (let round = 0; round < runtimeConfig.warningRepeatCount; round += 1) {
      if (round > 0) {
        await wait(runtimeConfig.warningRepeatDelayMs);
      }
      for (let index = 0; index < normalizedMessages.length; index += 1) {
        const message = normalizedMessages[index];
        const result = await sender.call(modules.adminWarn, {
          targetName: event.creatorName,
          targetSteamId: event.creatorSteamId || undefined,
          targetEosId: event.creatorEosId || undefined,
          message,
          reason: index === 0 ? "squad_name_policy_violation" : "squad_name_policy_suggestion",
          sourceModule: MODULE_ID,
          relatedEventId: event.eventId || buildDedupeKey(event),
          system: true,
        }).catch((error) => ({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }));
        results.push(result);
      }
    }
    return results;
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

function isViolation(evaluation) {
  return Boolean(evaluation?.ok) && evaluation?.valid === false;
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

export default createSquadNamePolicyGuardModule;
