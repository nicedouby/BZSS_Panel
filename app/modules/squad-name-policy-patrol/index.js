// -*- coding: utf-8 -*-

import { testSquadNamePolicy } from "../../domain/squad-name-policy/index.js";

const MODULE_ID = "module.squadNamePolicyPatrol";
const API_NAME = "squadNamePolicyPatrol";
const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_DEDUPE_TTL_MS = 60 * 1000;
const DEFAULT_RECENT_LIMIT = 200;

export function createSquadNamePolicyPatrolModule({ core, config, logger }) {
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
    allowed: 0,
    duplicatesSkipped: 0,
    errors: 0,
  };
  let serial = Promise.resolve();
  let lastPatrolAt = 0;

  const api = {
    getState() {
      runtimeConfig = readConfig(config);
      return {
        enabled: runtimeConfig.enabled,
        intervalMs: runtimeConfig.intervalMs,
        dedupeTtlMs: runtimeConfig.dedupeTtlMs,
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
      const violation = isPatrolViolation(evaluation);
      return {
        event: normalized,
        evaluation,
        violation,
        disposition: violation ? "flag_only" : "allow",
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
      name: "Squad Name Policy Patrol",
      kind: "module",
      version: "1.0.0",
      description: "RCON snapshot patrol that recognizes non-compliant squad names without taking disband actions.",
    },
    apiName: API_NAME,
    api,

    async start() {
      runtimeConfig = readConfig(config);
      if (!runtimeConfig.enabled) {
        moduleLogger?.info?.("SquadNamePolicyPatrol module disabled by config.");
        return;
      }

      unsubscribers.push(core.eventBus.onModuleEvent("module.matchState", "squadsUpdated", (event) => {
        void enqueue(() => handleSquadsUpdated(event));
      }));

      moduleLogger?.info?.("SquadNamePolicyPatrol module started.", {
        operation: "start",
        data: {
          intervalMs: runtimeConfig.intervalMs,
          dedupeTtlMs: runtimeConfig.dedupeTtlMs,
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

  async function handleSquadsUpdated(event = {}) {
    runtimeConfig = readConfig(config);
    if (!runtimeConfig.enabled) return;

    const now = Date.now();
    if (now - lastPatrolAt < runtimeConfig.intervalMs) return;
    lastPatrolAt = now;

    const squads = Array.isArray(event.squads) ? event.squads : [];
    for (const squad of squads) {
      await inspectSquadCandidate({
        ...squad,
        serverId: event.serverId,
        matchId: event.matchId ?? event.sessionId ?? event.sessionID,
        time: event.time,
      }, "RCON_PATROL");
    }
  }

  async function inspectSquadCandidate(event = {}, source = "RCON_PATROL") {
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

    try {
      stats.evaluated += 1;
      const evaluation = testSquadNamePolicy(normalized.squadName, config);
      const violation = isPatrolViolation(evaluation);
      if (violation) stats.violations += 1;
      else stats.allowed += 1;

      return rememberRecord({
        event: normalized,
        source,
        status: violation ? "violation" : "allowed",
        reason: evaluation.reason,
        evaluation,
        violation,
        disposition: violation ? "flag_only" : "allow",
      });
    } catch (error) {
      stats.errors += 1;
      return rememberRecord({
        event: normalized,
        source,
        status: "error",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function rememberRecord(record) {
    const now = nowIso();
    const saved = {
      id: `squadNamePolicyPatrol:${Date.now()}:${Math.random().toString(16).slice(2)}`,
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
  const raw = config?.get?.("modules.squadNamePolicyPatrol", {}) ?? {};
  return {
    enabled: Boolean(raw.enabled ?? false),
    intervalMs: positiveNumber(raw.intervalMs, DEFAULT_INTERVAL_MS),
    dedupeTtlMs: positiveNumber(raw.dedupeTtlMs, DEFAULT_DEDUPE_TTL_MS),
    recentLimit: positiveNumber(raw.recentLimit, DEFAULT_RECENT_LIMIT),
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
    source: text(event.source),
    time: text(event.time ?? event.createdAt ?? event.observedAt) || nowIso(),
  };
}

function isPatrolViolation(evaluation) {
  return Boolean(evaluation?.ok) && evaluation?.valid === false;
}

function buildDedupeKey(event) {
  const creationSignature = text(event.creationSignature);
  if (creationSignature) return `creation:${creationSignature}`;
  return [
    event.serverId,
    event.matchId,
    event.teamId,
    event.squadId,
    normalizeName(event.squadName),
  ].map((item) => String(item ?? "")).join("|");
}

function normalizeName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
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

export default createSquadNamePolicyPatrolModule;
