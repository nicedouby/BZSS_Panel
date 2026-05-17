// -*- coding: utf-8 -*-

import { buildSquadLifecycleSlotKey } from "../squad-lifecycle/service.js";
import { normalizeSquadName } from "../squad-lifecycle/log-adapter.js";

const MODULE_ID = "module.squadManagement";
const API_NAME = "squadManagement";

const DEFAULT_ALLOWED_INFANTRY_NAMES = ["\u8499\u65b0\u961f", "\u586b\u7ebf\u961f"];
const DEFAULT_DISBAND_PERMISSION = "squad.disband";
const DEFAULT_KICK_PERMISSION = "squad.kick";
const DEFAULT_KICK_THRESHOLD = 10;
const DEFAULT_NO_BUILD_UNTIL_SECONDS = 20;
const DEFAULT_INFANTRY_ONLY_UNTIL_SECONDS = 50;
const DEFAULT_SWEEP_INTERVAL_MS = 15_000;
const DEFAULT_DEFAULT_SQUAD_NAME_PATTERN = "^Squad\\s*\\d+$";
const DEFAULT_AUTO_KICK_REASON = "SquadManagement";

const PROCESS_EVENTS = [
  "GAME_START",
  "MATCH_START",
  "ROUND_START",
  "NEW_GAME",
  "round.world_bring_up",
];

const SYSTEM_ACTOR = {
  id: "system",
  username: "squad-management",
  role: "system",
  permissions: ["*"],
};

export function createSquadManagementModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: MODULE_ID,
    source: MODULE_ID,
    channel: "module",
  }) ?? core.logger;

  const moduleConfig = config.get("modules.squadManagement", {});
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const disbandPermission = String(moduleConfig.disbandPermission ?? DEFAULT_DISBAND_PERMISSION).trim() || DEFAULT_DISBAND_PERMISSION;
  const kickPermission = String(moduleConfig.kickPermission ?? DEFAULT_KICK_PERMISSION).trim() || DEFAULT_KICK_PERMISSION;
  const kickThreshold = normalizePositiveInteger(moduleConfig.kickThreshold, DEFAULT_KICK_THRESHOLD);
  const noBuildUntilSeconds = normalizePositiveInteger(moduleConfig.noBuildUntilSeconds, DEFAULT_NO_BUILD_UNTIL_SECONDS);
  const infantryOnlyUntilSeconds = Math.max(
    noBuildUntilSeconds,
    normalizePositiveInteger(moduleConfig.infantryOnlyUntilSeconds, DEFAULT_INFANTRY_ONLY_UNTIL_SECONDS),
  );
  const sweepIntervalMs = normalizePositiveInteger(moduleConfig.sweepIntervalMs, DEFAULT_SWEEP_INTERVAL_MS);
  const allowedInfantryNames = normalizeStringSet(moduleConfig.allowedInfantryNames, DEFAULT_ALLOWED_INFANTRY_NAMES);
  const defaultSquadNamePattern = safeRegex(moduleConfig.defaultSquadNamePattern ?? DEFAULT_DEFAULT_SQUAD_NAME_PATTERN, "i")
    ?? safeRegex(DEFAULT_DEFAULT_SQUAD_NAME_PATTERN, "i");

  const creatorStats = new Map();
  const seenCreationKeys = new Set();
  const disbandedSquadKeys = new Set();
  const recentActions = [];
  const unsubscribers = [];
  const runtime = {
    roundKey: "",
    bootstrappedRoundKey: "",
    lastBootstrapAt: "",
    lastSweepAt: "",
    lastSweepReason: "",
    lastStateUpdatedAt: "",
    lastResetAt: "",
    lastResetReason: "",
  };
  let sweepTimer = null;

  const api = {
    getState() {
      return buildStateSnapshot();
    },

    getCurrent() {
      return buildStateSnapshot();
    },

    getStatus() {
      const snapshot = buildStateSnapshot();
      return {
        enabled,
        disbandPermission,
        kickPermission,
        kickThreshold,
        window: snapshot.window,
        currentSquads: snapshot.summary.currentSquads,
        currentViolations: snapshot.summary.violations,
        trackedCreators: snapshot.summary.creators,
      };
    },

    async refresh() {
      await reconcile({
        reason: "manual-refresh",
        enforce: true,
      });
      return buildStateSnapshot();
    },

    async disband(request = {}) {
      return executeDisband({
        ...request,
        system: false,
        source: "manual",
      });
    },

    async kick(request = {}) {
      return executeKick({
        ...request,
        system: false,
        source: "manual",
      });
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "Squad Management Module",
      kind: "module",
      version: "0.1.0",
      description: "Track squad creation abuse, enforce no-build and infantry-only windows, and route all disband / kick actions through one module.",
    },
    apiName: API_NAME,
    api,

    async start() {
      if (!enabled) {
        moduleLogger.info("SquadManagement module disabled by config.", { operation: "start" });
        return;
      }

      if (!core.eventBus?.onCoreEvent) {
        moduleLogger.warn("SquadManagement module started without event bus support.", { operation: "start" });
        return;
      }

      for (const eventName of PROCESS_EVENTS) {
        unsubscribers.push(core.eventBus.onCoreEvent(eventName, () => {
          void reconcile({
            reason: eventName,
            enforce: true,
          });
        }));
      }

      unsubscribers.push(core.eventBus.onModuleEvent("module.squadLifecycle", "squadCreated", (event) => {
        void handleSquadCreated(event);
      }));

      unsubscribers.push(core.eventBus.onModuleEvent("module.matchState", "squadsUpdated", () => {
        void reconcile({
          reason: "matchState.squadsUpdated",
          enforce: true,
        });
      }));

      sweepTimer = setInterval(() => {
        void reconcile({
          reason: "interval",
          enforce: true,
        });
      }, sweepIntervalMs);
      sweepTimer.unref?.();

      await reconcile({
        reason: "start",
        enforce: true,
      });

      moduleLogger.info("SquadManagement module started.", {
        operation: "start",
        data: {
          disbandPermission,
          kickPermission,
          kickThreshold,
          noBuildUntilSeconds,
          infantryOnlyUntilSeconds,
          sweepIntervalMs,
        },
      });
    },

    async stop() {
      for (const unsubscriber of unsubscribers.splice(0)) {
        try {
          unsubscriber();
        } catch {}
      }

      if (sweepTimer) {
        clearInterval(sweepTimer);
        sweepTimer = null;
      }
    },
  };

  async function handleSquadCreated(event) {
    const clock = getClockContext();
    if (!clock.active) return;

    const record = normalizeCreationRecord(event, clock);
    if (!record) return;

    const registered = registerCreationRecord(record, {
      clock,
      source: "event",
      enforce: true,
    });
    if (!registered) return;
  }

  async function reconcile({ reason = "reconcile", enforce = true } = {}) {
    if (!enabled) return buildStateSnapshot();

    const clock = getClockContext();
    const previousRoundKey = runtime.roundKey;
    stateFromClock(clock);

    if (!clock.active) {
      runtime.roundKey = "";
      runtime.bootstrappedRoundKey = "";
      runtime.lastStateUpdatedAt = new Date().toISOString();
      return buildStateSnapshot();
    }

    if (previousRoundKey !== clock.roundKey) {
      resetRoundMemory(clock, "round-change");
      bootstrapRound(clock);
      runtime.bootstrappedRoundKey = clock.roundKey;
    }

    runtime.lastSweepAt = new Date().toISOString();
    runtime.lastSweepReason = reason;
    runtime.lastStateUpdatedAt = runtime.lastSweepAt;

    if (enforce && !clock.isWarmup) {
      await enforceCurrentViolations(clock, reason);
    }

    return buildStateSnapshot();
  }

  function stateFromClock(clock) {
    runtime.roundKey = clock.roundKey;
    runtime.lastStateUpdatedAt = new Date().toISOString();
  }

  function resetRoundMemory(clock, reason) {
    creatorStats.clear();
    seenCreationKeys.clear();
    disbandedSquadKeys.clear();
    recentActions.length = 0;
    runtime.roundKey = clock.roundKey;
    runtime.lastResetAt = new Date().toISOString();
    runtime.lastResetReason = reason;
    runtime.lastStateUpdatedAt = runtime.lastResetAt;
  }

  function bootstrapRound(clock) {
    const records = getRelevantLifecycleRecords(clock)
      .map((record) => normalizeLifecycleRecord(record, clock))
      .filter(Boolean)
      .sort((left, right) => Number(left.createdAtMs ?? 0) - Number(right.createdAtMs ?? 0));

    for (const record of records) {
      registerCreationRecord(record, {
        clock,
        source: "bootstrap",
        enforce: true,
      });
    }

    runtime.lastBootstrapAt = new Date().toISOString();
    runtime.lastStateUpdatedAt = runtime.lastBootstrapAt;
  }

  async function enforceCurrentViolations(clock, reason) {
    const squads = getCurrentSquads(clock);

    for (const squad of squads) {
      const evaluation = evaluateViolation(squad, clock);
      if (!evaluation) continue;
      await maybeDisbandViolation(squad, clock, reason, evaluation);
    }

    for (const [creatorKey, stats] of creatorStats.entries()) {
      if (stats.count <= kickThreshold) continue;
      if (stats.lastKickAttemptedCount >= stats.count) continue;
      await maybeKickCreator(creatorKey, clock, {
        source: reason,
      });
    }
  }

  async function maybeDisbandViolation(squadLike, clock, source, precomputed = null) {
    const evaluation = precomputed ?? evaluateViolation(squadLike, clock);
    if (!evaluation) return null;

    const squad = normalizeCurrentSquad(squadLike, clock);
    const squadKey = buildDisbandKey(squad, clock);
    if (squadKey && disbandedSquadKeys.has(squadKey)) {
      return null;
    }

    if (squad.teamId == null || squad.squadId == null) {
      addRecentAction({
        action: "auto-disband-skipped",
        source,
        ok: false,
        message: "Missing teamId or squadId.",
        target: squad,
      });
      return null;
    }

    const result = await executeDisband({
      actor: SYSTEM_ACTOR,
      system: true,
      source,
      squad,
      reason: evaluation.type,
    });

    if (result.ok && squadKey) {
      disbandedSquadKeys.add(squadKey);
    }

    return result;
  }

  async function maybeKickCreator(creatorKey, clock, { source = "unknown", creation = null } = {}) {
    const stats = creatorStats.get(String(creatorKey ?? "").trim());
    if (!stats) return null;
    if (stats.count <= kickThreshold) return null;
    if (stats.lastKickAttemptedCount >= stats.count) return null;

    const result = await executeKick({
      actor: SYSTEM_ACTOR,
      system: true,
      source,
      anyId: stats.anyId,
      reason: `${DEFAULT_AUTO_KICK_REASON}_count=${stats.count}`,
      creatorKey,
      creatorName: stats.creatorName,
      steamId: stats.steamId,
      eosId: stats.eosId,
      count: stats.count,
      creation,
    });

    stats.lastKickAttemptedCount = stats.count;
    stats.lastKickAt = result.time;
    stats.lastKickResult = result.ok ? "success" : "failed";
    stats.lastKickMessage = result.message ?? "";
    stats.lastActionAt = result.time;
    return result;
  }

  function registerCreationRecord(input, { clock = getClockContext(), source = "event", enforce = true } = {}) {
    if (!enabled || !clock.active) return null;

    const record = normalizeCreationRecord(input, clock);
    if (!record) return null;

    const dedupeKeys = buildCreationDedupeKeys(record);
    if (dedupeKeys.some((key) => seenCreationKeys.has(key))) {
      return null;
    }

    for (const key of dedupeKeys) {
      seenCreationKeys.add(key);
    }

    const stats = ensureCreatorStats(record.creatorKey, record);
    stats.count += 1;
    stats.lastSeenAtMs = record.createdAtMs;
    stats.lastSeenAt = iso(record.createdAtMs);
    stats.creatorName = record.creatorName || stats.creatorName;
    stats.steamId = record.creatorSteamId || stats.steamId;
    stats.eosId = record.creatorEosId || stats.eosId;
    stats.anyId = record.anyId || stats.anyId;
    stats.latestSquadName = record.squadName || stats.latestSquadName;
    stats.latestCreationSignature = record.creationSignature || stats.latestCreationSignature;
    stats.lastActionAt = new Date().toISOString();
    runtime.lastStateUpdatedAt = stats.lastActionAt;

    if (enforce) {
      void maybeDisbandViolation(record, clock, source);
      void maybeKickCreator(record.creatorKey, clock, { source, creation: record });
    }

    return record;
  }

  async function executeDisband({ actor = SYSTEM_ACTOR, squad = null, teamId = null, squadId = null, reason = "", source = "manual", system = false } = {}) {
    const clock = getClockContext();
    const targetTeamId = normalizeNullableNumber(teamId ?? squad?.teamId ?? squad?.teamID);
    const targetSquadId = normalizeNullableNumber(squadId ?? squad?.squadId ?? squad?.squadID);

    const baseEvent = {
      ok: false,
      action: system ? "auto-disband" : "manual-disband",
      source,
      system,
      target: {
        teamId: targetTeamId,
        squadId: targetSquadId,
        squadName: String(squad?.squadName ?? squad?.name ?? "").trim(),
        creatorName: String(squad?.creatorName ?? squad?.leaderName ?? "").trim(),
        creatorKey: String(squad?.creatorKey ?? "").trim(),
        creationSignature: String(squad?.creationSignature ?? "").trim(),
      },
      reason: String(reason ?? ""),
      time: new Date().toISOString(),
    };

    if (!targetTeamId || !targetSquadId) {
      const result = {
        ...baseEvent,
        error: "InvalidTarget",
        message: "Team ID and squad ID are required.",
      };
      addRecentAction(result);
      await recordAudit({
        actor,
        action: result.action,
        result: "invalid",
        reason: result.message,
        target: result.target,
        source,
        system,
      });
      return result;
    }

    if (!system && !hasPermission(actor, disbandPermission)) {
      const result = {
        ...baseEvent,
        error: "Forbidden",
        message: `Permission '${disbandPermission}' is required.`,
      };
      addRecentAction(result);
      await recordAudit({
        actor,
        action: result.action,
        result: "forbidden",
        reason: "missing-permission",
        requiredPermission: disbandPermission,
        target: result.target,
        source,
        system,
      });
      return result;
    }

    if (!core.rconManager?.dispatchCommand) {
      const result = {
        ...baseEvent,
        error: "RconUnavailable",
        message: "RCON manager is unavailable.",
      };
      addRecentAction(result);
      await recordAudit({
        actor,
        action: result.action,
        result: "rcon-unavailable",
        reason: "rcon-manager-missing",
        target: result.target,
        source,
        system,
      });
      return result;
    }

    const command = `AdminDisbandSquad ${targetTeamId} ${targetSquadId}`;
    const rconResult = await core.rconManager.dispatchCommand({
      command,
      requestedBy: `${MODULE_ID}:${actor?.username || actor?.id || "system"}`,
      reason: String(reason ?? DEFAULT_AUTO_KICK_REASON),
    });

    const ok = Boolean(rconResult?.success);
    const result = {
      ...baseEvent,
      ok,
      command,
      message: rconResult?.message ?? "",
      rconExecuted: Boolean(rconResult?.rconExecuted),
      rconResponse: String(rconResult?.rconResponse ?? ""),
    };

    if (ok) {
      const resolvedSquad = squad
        ? normalizeCurrentSquad(squad, clock)
        : {
            serverId: clock.serverId,
            matchId: clock.currentMatchId,
            teamId: targetTeamId,
            squadId: targetSquadId,
            squadName: "",
            creatorName: "",
            creatorSteamId: "",
            creatorEosId: "",
            anyId: "",
            creationSignature: "",
          };
      const squadKey = buildDisbandKey(resolvedSquad, clock);
      if (squadKey) disbandedSquadKeys.add(squadKey);
    }

    addRecentAction(result);
    await recordAudit({
      actor,
      action: result.action,
      result: ok ? "success" : "failed",
      reason: result.message || result.reason,
      target: result.target,
      command,
      rcon: {
        ok,
        message: result.message,
        response: result.rconResponse,
      },
      source,
      system,
    });

    return result;
  }

  async function executeKick({ actor = SYSTEM_ACTOR, anyId = "", reason = DEFAULT_AUTO_KICK_REASON, source = "manual", system = false, creatorKey = "", creatorName = "", steamId = "", eosId = "", count = 0, creation = null } = {}) {
    const targetId = String(anyId ?? steamId ?? eosId ?? creatorName ?? "").trim();

    const baseEvent = {
      ok: false,
      action: system ? "auto-kick" : "manual-kick",
      source,
      system,
      target: {
        anyId: targetId,
        creatorKey: String(creatorKey ?? "").trim(),
        creatorName: String(creatorName ?? "").trim(),
        steamId: String(steamId ?? "").trim(),
        eosId: String(eosId ?? "").trim(),
        count: Number(count ?? 0),
      },
      reason: String(reason ?? DEFAULT_AUTO_KICK_REASON),
      time: new Date().toISOString(),
    };

    if (!targetId) {
      const result = {
        ...baseEvent,
        error: "InvalidTarget",
        message: "A kick target is required.",
      };
      addRecentAction(result);
      await recordAudit({
        actor,
        action: result.action,
        result: "invalid",
        reason: result.message,
        target: result.target,
        source,
        system,
      });
      return result;
    }

    if (!system && !hasPermission(actor, kickPermission)) {
      const result = {
        ...baseEvent,
        error: "Forbidden",
        message: `Permission '${kickPermission}' is required.`,
      };
      addRecentAction(result);
      await recordAudit({
        actor,
        action: result.action,
        result: "forbidden",
        reason: "missing-permission",
        requiredPermission: kickPermission,
        target: result.target,
        source,
        system,
      });
      return result;
    }

    if (!core.rconManager?.dispatchCommand) {
      const result = {
        ...baseEvent,
        error: "RconUnavailable",
        message: "RCON manager is unavailable.",
      };
      addRecentAction(result);
      await recordAudit({
        actor,
        action: result.action,
        result: "rcon-unavailable",
        reason: "rcon-manager-missing",
        target: result.target,
        source,
        system,
      });
      return result;
    }

    const command = `AdminKick ${quoteRconString(targetId)} ${quoteRconString(String(reason ?? DEFAULT_AUTO_KICK_REASON))}`;
    const rconResult = await core.rconManager.dispatchCommand({
      command,
      requestedBy: `${MODULE_ID}:${actor?.username || actor?.id || "system"}`,
      reason: String(reason ?? DEFAULT_AUTO_KICK_REASON),
    });

    const ok = Boolean(rconResult?.success);
    const result = {
      ...baseEvent,
      ok,
      command,
      message: rconResult?.message ?? "",
      rconExecuted: Boolean(rconResult?.rconExecuted),
      rconResponse: String(rconResult?.rconResponse ?? ""),
    };

    const stats = creatorKey ? creatorStats.get(String(creatorKey).trim()) : null;
    if (stats) {
      stats.lastKickAttemptedCount = Math.max(stats.lastKickAttemptedCount ?? 0, Number(count ?? stats.count ?? 0));
      stats.lastKickAt = result.time;
      stats.lastKickResult = result.ok ? "success" : "failed";
      stats.lastKickMessage = result.message ?? "";
      stats.lastActionAt = result.time;
    }

    addRecentAction(result);
    await recordAudit({
      actor,
      action: result.action,
      result: ok ? "success" : "failed",
      reason: result.message || result.reason,
      target: result.target,
      command,
      rcon: {
        ok,
        message: result.message,
        response: result.rconResponse,
      },
      source,
      system,
      creationSignature: String(creation?.creationSignature ?? ""),
    });

    return result;
  }

  function getCurrentSquads(clock) {
    const serverId = clock.serverId;
    const matchStateSquads = modules.matchState?.getState?.()?.squads?.list;
    const fallbackSquads = modules.matchState?.getOverview?.()?.squads;
    const squadStateSquads = modules.squadState?.getSquads?.(serverId);

    const rawSquads = Array.isArray(matchStateSquads) && matchStateSquads.length > 0
      ? matchStateSquads
      : Array.isArray(fallbackSquads) && fallbackSquads.length > 0
        ? fallbackSquads
        : Array.isArray(squadStateSquads)
          ? squadStateSquads
          : [];

    const lifecycleSnapshot = modules.squadLifecycle?.getCurrent?.(serverId) ?? null;
    const lifecycleRecords = Array.isArray(lifecycleSnapshot?.list) ? lifecycleSnapshot.list : [];
    const bySlotKey = new Map(lifecycleRecords.map((record) => [record.slotKey, record]));
    const bySlot = new Map(
      lifecycleRecords.map((record) => [
        `${String(record.teamId ?? "")}:${String(record.squadId ?? "")}`,
        record,
      ]),
    );

    return rawSquads
      .map((raw) => {
        const normalized = normalizeCurrentSquad(raw, clock);
        const slotKey = buildSquadLifecycleSlotKey(
          serverId,
          lifecycleSnapshot?.matchId ?? clock.currentMatchId ?? "",
          normalized.teamId,
          normalized.squadId,
        );
        const record = bySlotKey.get(slotKey) ?? bySlot.get(`${String(normalized.teamId ?? "")}:${String(normalized.squadId ?? "")}`) ?? null;
        return enrichSquad(normalized, record, clock);
      })
      .filter((squad) => squad.teamId != null || squad.squadId != null);
  }

  function normalizeCurrentSquad(squad, clock = getClockContext()) {
    const teamId = normalizeNullableNumber(squad?.teamID ?? squad?.teamId ?? squad?.team);
    const squadId = normalizeNullableNumber(squad?.squadID ?? squad?.squadId ?? squad?.id);
    const squadName = String(squad?.squadName ?? squad?.name ?? "").trim();
    const creatorName = String(squad?.creatorName ?? squad?.leaderName ?? "").trim();
    const creatorSteamId = String(squad?.creatorSteamID ?? squad?.creatorSteamId ?? squad?.leaderSteamID ?? squad?.steamID ?? "").trim();
    const creatorEosId = String(squad?.creatorEOSID ?? squad?.creatorEosId ?? squad?.leaderEOSID ?? squad?.eosID ?? "").trim();
    return {
      serverId: clock.serverId,
      matchId: String(squad?.matchId ?? clock.currentMatchId ?? "").trim(),
      teamId,
      squadId,
      squadName,
      creatorName,
      creatorSteamId,
      creatorEosId,
      anyId: String(squad?.anyId ?? creatorSteamId ?? creatorEosId ?? creatorName ?? "").trim(),
      teamName: String(squad?.teamName ?? squad?.factionName ?? "").trim(),
      raw: String(squad?.raw ?? ""),
    };
  }

  function enrichSquad(squad, record, clock) {
    const createdAtMs = Number.isFinite(Number(record?.createdAtMs))
      ? Number(record.createdAtMs)
      : Number.isFinite(Number(squad.createdAtMs))
        ? Number(squad.createdAtMs)
        : 0;
    const creationSignature = String(record?.creationSignature ?? buildCreationSignature({
      serverId: squad.serverId,
      matchId: record?.matchId ?? squad.matchId ?? clock.currentMatchId ?? "",
      squadId: squad.squadId,
      squadName: squad.squadName,
      creatorName: squad.creatorName,
      creatorSteamId: squad.creatorSteamId,
      creatorEosId: squad.creatorEosId,
      createdAtMs,
    })).trim();
    const creatorKey = String(record?.creatorKey ?? buildCreatorKey(squad)).trim();
    const createdSeconds = Number.isFinite(createdAtMs) && createdAtMs > 0 && clock.roundStartedAtMs > 0
      ? Math.max(0, Math.floor((createdAtMs - clock.roundStartedAtMs) / 1000))
      : null;
    const violation = evaluateViolation({
      createdSeconds,
      squadName: squad.squadName,
      allowedInfantry: isAllowedInfantrySquadName(squad.squadName),
    }, clock);
    const disbandKey = buildDisbandKey({
      ...squad,
      creationSignature,
    }, clock);

    return {
      ...squad,
      matchId: String(record?.matchId ?? squad.matchId ?? clock.currentMatchId ?? "").trim(),
      recordKey: String(record?.key ?? "").trim(),
      creationSource: String(record?.creationSource ?? "").trim(),
      creationConfidence: String(record?.creationConfidence ?? "").trim(),
      createdAtMs,
      createdAt: iso(createdAtMs),
      createdSeconds,
      creationSignature,
      creatorKey,
      allowedInfantry: isAllowedInfantrySquadName(squad.squadName),
      violationType: violation?.type ?? "",
      violationReason: violation?.reason ?? "",
      shouldDisband: Boolean(violation),
      currentCreatorCount: getCreatorCount(creatorKey),
      disbanded: Boolean(disbandKey && disbandedSquadKeys.has(disbandKey)),
    };
  }

  function evaluateViolation(squadLike, clock = getClockContext()) {
    const squad = normalizeCurrentSquad(squadLike, clock);
    if (!clock.active || clock.isWarmup) return null;

    if (squad.createdSeconds == null) {
      if (clock.logClockSeconds < noBuildUntilSeconds) {
        return { type: "no-build", reason: "no-build-window" };
      }
      if (clock.logClockSeconds < infantryOnlyUntilSeconds && !isAllowedInfantrySquadName(squad.squadName)) {
        return { type: "infantry-only", reason: "infantry-only-window" };
      }
      return null;
    }

    if (squad.createdSeconds < noBuildUntilSeconds) {
      return { type: "no-build", reason: "no-build-window" };
    }
    if (squad.createdSeconds < infantryOnlyUntilSeconds && !isAllowedInfantrySquadName(squad.squadName)) {
      return { type: "infantry-only", reason: "infantry-only-window" };
    }
    return null;
  }

  function buildStateSnapshot() {
    const clock = getClockContext();
    const squads = getCurrentSquads(clock);
    const creators = [...creatorStats.entries()]
      .map(([creatorKey, stats]) => ({
        creatorKey,
        count: stats.count,
        creatorName: stats.creatorName,
        steamId: stats.steamId,
        eosId: stats.eosId,
        anyId: stats.anyId,
        firstSeenAtMs: stats.firstSeenAtMs,
        firstSeenAt: iso(stats.firstSeenAtMs),
        lastSeenAtMs: stats.lastSeenAtMs,
        lastSeenAt: iso(stats.lastSeenAtMs),
        lastKickAt: stats.lastKickAt ?? "",
        lastKickResult: stats.lastKickResult ?? "",
        lastKickAttemptedCount: Number(stats.lastKickAttemptedCount ?? 0),
        latestSquadName: stats.latestSquadName ?? "",
        lastActionAt: stats.lastActionAt ?? "",
      }))
      .sort((left, right) => {
        const diff = Number(right.count ?? 0) - Number(left.count ?? 0);
        if (diff !== 0) return diff;
        return String(left.creatorName ?? "").localeCompare(String(right.creatorName ?? ""), "zh-CN");
      });

    const violations = squads.filter((squad) => Boolean(squad.shouldDisband));

    return {
      serverId: clock.serverId,
      roundKey: runtime.roundKey,
      roundStartedAtMs: clock.roundStartedAtMs,
      roundStartedAt: iso(clock.roundStartedAtMs),
      logClockSeconds: clock.logClockSeconds,
      logClockHasAnchor: clock.logClockHasAnchor,
      logClockManual: clock.logClockManual,
      logClockLastResetAt: clock.logClockLastResetAt,
      logClockLastResetReason: clock.logClockLastResetReason,
      isWarmup: clock.isWarmup,
      window: clock.window,
      enforcementEnabled: enabled,
      disbandPermission,
      kickPermission,
      kickThreshold,
      noBuildUntilSeconds,
      infantryOnlyUntilSeconds,
      allowedInfantryNames: [...allowedInfantryNames],
      defaultSquadNamePattern: defaultSquadNamePattern?.source ?? DEFAULT_DEFAULT_SQUAD_NAME_PATTERN,
      currentMatchId: clock.currentMatchId ?? "",
      squads,
      violations,
      creators,
      summary: {
        currentSquads: squads.length,
        violations: violations.length,
        creators: creators.length,
        trackedCreations: [...creatorStats.values()].reduce((sum, stats) => sum + Number(stats.count ?? 0), 0),
      },
      lastBootstrapAt: runtime.lastBootstrapAt,
      lastSweepAt: runtime.lastSweepAt,
      lastSweepReason: runtime.lastSweepReason,
      lastStateUpdatedAt: runtime.lastStateUpdatedAt,
      lastResetAt: runtime.lastResetAt,
      lastResetReason: runtime.lastResetReason,
      recentActions: [...recentActions],
    };
  }

  function getRelevantLifecycleRecords(clock) {
    const records = modules.squadLifecycle?.getAllRecords?.() ?? [];
    const currentMatchId = getCurrentMatchId(clock.serverId);

    return records.filter((record) => {
      if (String(record?.serverId ?? "").trim() !== clock.serverId) return false;
      if (currentMatchId) {
        return String(record?.matchId ?? "").trim() === currentMatchId;
      }

      const createdAtMs = Number(record?.createdAtMs ?? 0);
      return Number.isFinite(createdAtMs) && createdAtMs >= clock.roundStartedAtMs;
    });
  }

  function getCurrentMatchId(serverId) {
    return String(
      modules.squadLifecycle?.getCurrentMatchId?.(serverId)
      ?? modules.squadLifecycle?.getCurrent?.(serverId)?.matchId
      ?? "",
    ).trim();
  }

  function getClockContext() {
    const snapshot = core.webStatus?.getSnapshot?.() ?? {};
    const serverId = String(snapshot.serverId ?? core.webStatus?.serverId ?? "").trim();
    const logClockSeconds = Number(snapshot.logClockSeconds ?? 0);
    const logClockHasAnchor = Boolean(snapshot.logClockHasAnchor);
    const logClockManual = Boolean(snapshot.logClockManual);
    const active = logClockHasAnchor || logClockManual;
    const logClockLastResetAt = String(snapshot.logClockLastResetAt ?? "");
    const logClockLastResetReason = String(snapshot.logClockLastResetReason ?? "");
    const isWarmup = Boolean(snapshot.isWarmup);
    const roundStartedAtMs = parseTimestamp(logClockLastResetAt);
    const currentMatchId = getCurrentMatchId(serverId);

    return {
      serverId,
      currentMatchId,
      active,
      roundKey: active ? `${serverId}:${logClockLastResetAt}:${logClockLastResetReason}` : "",
      roundStartedAtMs: Number.isFinite(roundStartedAtMs) ? roundStartedAtMs : 0,
      logClockSeconds,
      logClockHasAnchor,
      logClockManual,
      logClockLastResetAt,
      logClockLastResetReason,
      isWarmup,
      window: determineWindow({
        logClockSeconds,
        active,
        isWarmup,
      }),
    };
  }

  function determineWindow({ logClockSeconds, active, isWarmup }) {
    if (isWarmup) return "warmup";
    if (!active) return "waiting";
    if (Number(logClockSeconds ?? 0) < noBuildUntilSeconds) return "no-build";
    if (Number(logClockSeconds ?? 0) < infantryOnlyUntilSeconds) return "infantry-only";
    return "open";
  }

  function buildCreationDedupeKeys(record) {
    return [
      record.creationSignature ? `sig:${record.creationSignature}` : "",
      record.recordKey ? `record:${record.recordKey}` : "",
      record.sourceEventId ? `source:${record.sourceEventId}` : "",
    ].filter(Boolean);
  }

  function normalizeCreationRecord(input, clock) {
    if (!input || typeof input !== "object") return null;

    const serverId = String(input.serverId ?? clock.serverId ?? core.webStatus?.serverId ?? "").trim();
    if (!serverId) return null;

    const squadId = normalizeNullableNumber(input.squadId ?? input.squadID ?? input.squad);
    if (squadId == null) return null;

    const teamId = normalizeNullableNumber(input.teamId ?? input.teamID ?? input.team);
    const squadName = String(input.squadName ?? input.name ?? "").trim();
    const creatorName = String(input.creatorName ?? input.playerName ?? input.leaderName ?? "").trim();
    const creatorSteamId = String(input.creatorSteamId ?? input.creatorSteamID ?? input.steamID ?? input.leaderSteamID ?? "").trim();
    const creatorEosId = String(input.creatorEosId ?? input.creatorEOSID ?? input.eosID ?? input.leaderEOSID ?? "").trim();
    const anyId = String(input.anyId ?? creatorSteamId ?? creatorEosId ?? creatorName ?? "").trim();
    const matchId = String(input.matchId ?? clock.currentMatchId ?? "").trim();
    const createdAtMs = Number.isFinite(Number(input.createdAtMs))
      ? Number(input.createdAtMs)
      : Number.isFinite(Number(input.createdAt))
        ? Number(input.createdAt)
        : parseTimestamp(input.eventTime ?? input.time ?? input.createdAt ?? new Date().toISOString());
    const sourceEventId = String(input.sourceEventId ?? input.eventId ?? input.sourceId ?? "").trim();
    const creationSource = String(input.creationSource ?? input.source ?? "LOG").trim() || "LOG";
    const creationConfidence = String(input.creationConfidence ?? "HIGH").trim() || "HIGH";
    const creatorKey = buildCreatorKey({
      creatorSteamId,
      creatorEosId,
      creatorName,
    });
    const creationSignature = String(input.creationSignature ?? buildCreationSignature({
      serverId,
      matchId,
      squadId,
      squadName,
      creatorName,
      creatorSteamId,
      creatorEosId,
      createdAtMs,
    })).trim();

    return {
      serverId,
      matchId,
      teamId,
      squadId,
      squadName,
      creatorName,
      creatorSteamId,
      creatorEosId,
      anyId,
      createdAtMs,
      createdAt: iso(createdAtMs),
      sourceEventId,
      creationSource,
      creationConfidence,
      creatorKey,
      creationSignature,
      recordKey: String(input.recordKey ?? input.key ?? "").trim(),
    };
  }

  function normalizeLifecycleRecord(record, clock) {
    if (!record || typeof record !== "object") return null;

    const createdAtMs = Number.isFinite(Number(record.createdAtMs)) ? Number(record.createdAtMs) : parseTimestamp(record.createdAt ?? new Date().toISOString());
    const creatorSteamId = String(record.creatorSteamId ?? "").trim();
    const creatorEosId = String(record.creatorEosId ?? "").trim();
    const creatorName = String(record.creatorName ?? "").trim();
    const creatorKey = String(record.creatorKey ?? buildCreatorKey({ creatorSteamId, creatorEosId, creatorName })).trim();
    const squadId = normalizeNullableNumber(record.squadId ?? record.squadID);
    const teamId = normalizeNullableNumber(record.teamId ?? record.teamID);
    const squadName = String(record.squadName ?? record.name ?? "").trim();
    const matchId = String(record.matchId ?? clock.currentMatchId ?? "").trim();

    return {
      serverId: String(record.serverId ?? clock.serverId ?? "").trim(),
      matchId,
      teamId,
      squadId,
      squadName,
      creatorName,
      creatorSteamId,
      creatorEosId,
      anyId: String(record.anyId ?? creatorSteamId ?? creatorEosId ?? creatorName ?? "").trim(),
      createdAtMs,
      createdAt: iso(createdAtMs),
      sourceEventId: String(record.sourceEventId ?? "").trim(),
      creationSource: String(record.creationSource ?? "LOG").trim() || "LOG",
      creationConfidence: String(record.creationConfidence ?? "HIGH").trim() || "HIGH",
      creatorKey,
      creationSignature: String(record.creationSignature ?? buildCreationSignature({
        serverId: record.serverId ?? clock.serverId ?? "",
        matchId,
        squadId,
        squadName,
        creatorName,
        creatorSteamId,
        creatorEosId,
        createdAtMs,
      })).trim(),
      recordKey: String(record.key ?? "").trim(),
    };
  }

  function buildCreationSignature(source = {}) {
    const creatorKey = buildCreatorKey(source);
    const createdAtMs = Number.isFinite(Number(source.createdAtMs)) ? Number(source.createdAtMs) : Date.now();
    const bucket = Math.floor(createdAtMs / 10_000);
    return [
      String(source.serverId ?? "").trim(),
      String(source.matchId ?? "").trim(),
      String(source.squadId ?? "").trim(),
      normalizeSquadName(source.squadName),
      creatorKey,
      String(bucket),
    ].join(":");
  }

  function buildCreatorKey(source = {}) {
    const steamId = String(source.creatorSteamId ?? source.creatorSteamID ?? "").trim();
    const eosId = String(source.creatorEosId ?? source.creatorEOSID ?? "").trim();
    const name = normalizeSquadName(source.creatorName);
    if (steamId) return `steam:${steamId}`;
    if (eosId) return `eos:${eosId}`;
    if (name) return `name:${name}`;
    return "";
  }

  function buildDisbandKey(squad, clock) {
    if (!squad) return "";
    return [
      String(squad.serverId ?? clock.serverId ?? "").trim(),
      String(squad.matchId ?? clock.currentMatchId ?? "").trim(),
      String(squad.teamId ?? "").trim(),
      String(squad.squadId ?? "").trim(),
      String(squad.creationSignature ?? "").trim(),
    ].join(":");
  }

  function isAllowedInfantrySquadName(name) {
    const raw = String(name ?? "").trim();
    if (!raw) return false;
    if (defaultSquadNamePattern?.test(raw)) return true;
    const normalized = normalizeSquadName(raw);
    return allowedInfantryNames.has(raw) || allowedInfantryNames.has(normalized);
  }

  function normalizeStringSet(value, fallbackValues = []) {
    const items = Array.isArray(value) ? value : fallbackValues;
    return new Set(
      items
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
        .concat(items.map((item) => normalizeSquadName(item)).filter(Boolean)),
    );
  }

  function normalizePositiveInteger(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return Math.max(1, Number(fallback) || 1);
    return Math.max(1, Math.floor(number));
  }

  function normalizeNullableNumber(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.floor(number) : null;
  }

  function safeRegex(pattern, flags = "") {
    const text = String(pattern ?? "").trim();
    if (!text) return null;
    try {
      return new RegExp(text, flags);
    } catch {
      return null;
    }
  }

  function parseTimestamp(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value) return Date.now();
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  function iso(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return "";
    return new Date(number).toISOString();
  }

  function quoteRconString(value) {
    return `"${String(value ?? "").replace(/"/g, '\\"')}"`;
  }

  function cloneValue(value) {
    if (value == null || typeof value !== "object") return value;
    if (typeof structuredClone === "function") {
      try {
        return structuredClone(value);
      } catch {}
    }
    return JSON.parse(JSON.stringify(value));
  }

  async function recordAudit(payload) {
    try {
      return await modules.audit?.record?.({
        moduleId: MODULE_ID,
        time: new Date().toISOString(),
        actorId: payload.actor?.id ?? "system",
        actorName: payload.actor?.username ?? "system",
        actorRole: payload.actor?.role ?? "system",
        action: payload.action,
        result: payload.result,
        serverId: payload.target?.serverId ?? core.webStatus?.serverId ?? "",
        data: payload,
      });
    } catch (error) {
      moduleLogger.warn(`[SquadManagement] audit record failed: ${error?.message ?? error}`);
      return null;
    }
  }

  function hasPermission(actor, permission) {
    if (!actor) return false;
    if (core.authManager?.hasEverything?.(actor)) return true;
    if (typeof core.authManager?.hasPermission === "function") {
      return Boolean(core.authManager.hasPermission(actor, permission));
    }
    const permissions = Array.isArray(actor.permissions) ? actor.permissions : [];
    return permissions.includes("*") || permissions.includes(permission);
  }

  function addRecentAction(action) {
    recentActions.push({
      time: String(action?.time ?? new Date().toISOString()),
      action: String(action?.action ?? "").trim(),
      source: String(action?.source ?? "").trim(),
      ok: Boolean(action?.ok),
      error: String(action?.error ?? "").trim(),
      message: String(action?.message ?? "").trim(),
      reason: String(action?.reason ?? "").trim(),
      command: String(action?.command ?? "").trim(),
      system: Boolean(action?.system),
      target: cloneValue(action?.target ?? null),
    });

    while (recentActions.length > 50) {
      recentActions.shift();
    }
  }

  function ensureCreatorStats(creatorKey, record) {
    const key = String(creatorKey ?? "").trim();
    if (!key) {
      throw new Error("Creator key is required.");
    }

    const existing = creatorStats.get(key);
    if (existing) return existing;

    const createdAtMs = Number(record?.createdAtMs ?? Date.now());
    const entry = {
      count: 0,
      creatorName: String(record?.creatorName ?? "").trim(),
      steamId: String(record?.creatorSteamId ?? "").trim(),
      eosId: String(record?.creatorEosId ?? "").trim(),
      anyId: String(record?.anyId ?? record?.creatorSteamId ?? record?.creatorEosId ?? record?.creatorName ?? "").trim(),
      firstSeenAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
      lastSeenAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
      lastSeenAt: iso(createdAtMs),
      lastKickAt: "",
      lastKickResult: "",
      lastKickAttemptedCount: 0,
      lastKickMessage: "",
      latestSquadName: String(record?.squadName ?? "").trim(),
      latestCreationSignature: String(record?.creationSignature ?? "").trim(),
      lastActionAt: new Date().toISOString(),
    };
    creatorStats.set(key, entry);
    return entry;
  }

  function getCreatorCount(creatorKey) {
    return Number(creatorStats.get(String(creatorKey ?? "").trim())?.count ?? 0);
  }

  function getCurrentMatchId(serverId) {
    return String(
      modules.squadLifecycle?.getCurrentMatchId?.(serverId)
      ?? modules.squadLifecycle?.getCurrent?.(serverId)?.matchId
      ?? "",
    ).trim();
  }
}
