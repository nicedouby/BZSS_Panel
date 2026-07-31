// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const MODULE_ID = "module.squadRestrictionEnforcement";
const API_NAME = "squadRestrictionEnforcement";
const TERMINAL_STATUSES = new Set(["disbanded", "resolved", "cancelled"]);
const MODES = new Set(["off", "dry_run", "warn_only", "enforce"]);
const ROUND_RESET_EVENTS = ["GAME_END", "MATCH_END", "ROUND_END", "ROUND_ENDED", "NEW_GAME", "MAP_CHANGED"];

export const DEFAULT_SQUAD_RESTRICTION_ENFORCEMENT_CONFIG = Object.freeze({
  enabled: true,
  enforcementMode: "dry_run",
  startAfterSeconds: 300,
  firstWarningDelaySeconds: 30,
  secondWarningDelaySeconds: 60,
  disbandDelaySeconds: 90,
  resolutionConfirmSeconds: 10,
  schedulerIntervalMs: 1000,
  requireTrustedRoundClock: true,
  targetCurrentLeader: true,
  refreshBeforeDisband: true,
  recordDirectory: "./data/squad-restriction-enforcement",
  maxDisbandRetries: 3,
  disbandRetryDelaySeconds: 5,
});

export function createSquadRestrictionEnforcementModule({
  core,
  modules,
  config,
  logger,
  clock = Date,
} = {}) {
  const moduleLogger = logger ?? core?.createLogger?.({
    moduleId: MODULE_ID,
    source: MODULE_ID,
    channel: "module",
  }) ?? core?.logger;

  let runtimeConfig = readConfig(config);
  let timer = null;
  let workQueue = Promise.resolve();
  let persistenceQueue = Promise.resolve();
  let snapshotReceived = false;
  let currentRoundKey = "";
  let lastMonitorAt = "";
  let lastTickAt = "";
  let lastError = "";
  let dirty = false;

  const activeCases = new Map();
  const latestSquads = new Map();
  const history = [];
  const actionRecords = [];
  const exemptions = new Map();
  const incidentCounters = new Map();
  const observedSlots = new Map();
  const unsubscribers = [];

  const api = {
    getState() {
      return buildState();
    },

    getCases({ includeHistory = false } = {}) {
      const active = [...activeCases.values()].map(withCountdown);
      return includeHistory ? { active, history: history.map(clone) } : active;
    },

    getHistory({ limit = 200 } = {}) {
      return history.slice(-positiveInteger(limit, 200)).reverse().map(clone);
    },

    getRecords({ limit = 500 } = {}) {
      return actionRecords.slice(-positiveInteger(limit, 500)).reverse().map(clone);
    },

    async tick() {
      return enqueue(() => runTick());
    },

    async ingestMonitorSnapshot(event = {}) {
      return enqueue(() => ingestMonitorSnapshot(event));
    },

    async cancelCase(caseKey, { reason = "administrator_cancelled", actor = null } = {}) {
      return enqueue(async () => {
        const item = activeCases.get(text(caseKey));
        if (!item) return { ok: false, error: "case_not_found" };
        finalizeCase(item, "cancelled", reason, { actor });
        await commitState();
        return { ok: true, case: clone(item) };
      });
    },

    async setExemption(caseKey, { seconds = 300, until = "", reason = "administrator_exemption", actor = null } = {}) {
      return enqueue(async () => {
        const item = activeCases.get(text(caseKey));
        if (!item) return { ok: false, error: "case_not_found" };
        const now = nowMs();
        const parsedUntil = Date.parse(until);
        const untilMs = Number.isFinite(parsedUntil)
          ? parsedUntil
          : now + positiveInteger(seconds, 300) * 1000;
        const exemption = {
          key: item.baseCaseKey,
          caseKey: item.caseKey,
          slotKey: item.slotKey,
          reason: text(reason) || "administrator_exemption",
          actor: clone(actor),
          createdAt: iso(now),
          until: iso(untilMs),
          untilMs,
        };
        exemptions.set(item.baseCaseKey, exemption);
        finalizeCase(item, "cancelled", "administrator_exemption", { exemption });
        await commitState();
        return { ok: true, exemption: clone(exemption) };
      });
    },

    async clearExemption(key) {
      return enqueue(async () => {
        const normalized = text(key);
        let removed = exemptions.delete(normalized);
        for (const [entryKey, value] of exemptions) {
          if (value.caseKey === normalized || value.slotKey === normalized) {
            exemptions.delete(entryKey);
            removed = true;
          }
        }
        if (removed) {
          dirty = true;
          await commitState();
        }
        return { ok: removed };
      });
    },

    reload() {
      runtimeConfig = readConfig(config);
      return clone(runtimeConfig);
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "Squad Restriction Enforcement",
      kind: "module",
      version: "1.0.0",
      description: "Progressive, clock-gated enforcement for persistent locked-squad violations.",
    },
    apiName: API_NAME,
    api,

    async start() {
      runtimeConfig = readConfig(config);
      await loadPersistedState();

      if (typeof core?.eventBus?.onModuleEvent === "function") {
        unsubscribers.push(core.eventBus.onModuleEvent(
          "module.squadRestrictionMonitor",
          "updated",
          (event = {}) => {
            void enqueue(() => ingestMonitorSnapshot(event)).catch(logFailure);
          },
        ));
      }

      if (typeof core?.eventBus?.onCoreEvent === "function") {
        for (const eventName of ROUND_RESET_EVENTS) {
          unsubscribers.push(core.eventBus.onCoreEvent(eventName, (event = {}) => {
            void enqueue(async () => {
              cancelAllActive(`round_reset:${eventName}`, { event });
              snapshotReceived = false;
              latestSquads.clear();
              currentRoundKey = "";
              await commitState();
            }).catch(logFailure);
          }));
        }
      }

      if (runtimeConfig.enabled) {
        timer = setInterval(() => {
          void enqueue(() => runTick()).catch(logFailure);
        }, runtimeConfig.schedulerIntervalMs);
        timer.unref?.();
      }

      moduleLogger?.info?.("SquadRestrictionEnforcement module started.", {
        operation: "start",
        data: {
          enforcementMode: runtimeConfig.enforcementMode,
          startAfterSeconds: runtimeConfig.startAfterSeconds,
        },
      });
    },

    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {}
      }
      await workQueue.catch(() => {});
      await persistState();
      await persistenceQueue.catch(() => {});
    },
  };

  function enqueue(operation) {
    const run = workQueue.then(operation, operation);
    workQueue = run.catch(() => {});
    return run;
  }

  async function ingestMonitorSnapshot(event = {}) {
    runtimeConfig = readConfig(config);
    const context = getRoundContext(event.serverId, event);
    syncRound(context.roundKey, "monitor_snapshot");
    latestSquads.clear();
    for (const raw of Array.isArray(event.squads) ? event.squads : []) {
      const normalized = normalizeSquad(raw, context);
      if (normalized.slotKey) latestSquads.set(normalized.slotKey, normalized);
    }
    snapshotReceived = true;
    lastMonitorAt = iso(nowMs());
    dirty = true;
    return runTick(context);
  }

  async function runTick(contextOverride = null) {
    runtimeConfig = readConfig(config);
    const now = nowMs();
    lastTickAt = iso(now);
    pruneExemptions(now);

    if (!runtimeConfig.enabled || !snapshotReceived) {
      return buildState();
    }

    const context = contextOverride ?? getRoundContext();
    syncRound(context.roundKey, "tick");
    reconcileCases(context, now);

    if (runtimeConfig.enforcementMode !== "off" && enforcementWindowOpen(context)) {
      createCasesFromLatest(context, now);
    }

    if (runtimeConfig.enforcementMode !== "off") {
      const cases = [...activeCases.values()].sort((left, right) => left.detectedAtMs - right.detectedAtMs);
      for (const item of cases) {
        if (!activeCases.has(item.caseKey)) continue;
        await advanceCase(item, context, now);
      }
    }

    await commitState();
    return buildState();
  }

  function syncRound(nextRoundKey, reason) {
    const normalized = text(nextRoundKey);
    if (!normalized) return;
    if (currentRoundKey && currentRoundKey !== normalized) {
      cancelAllActive(`round_changed:${reason}`, {
        previousRoundKey: currentRoundKey,
        nextRoundKey: normalized,
      });
      latestSquads.clear();
      observedSlots.clear();
    }
    currentRoundKey = normalized;
  }

  function reconcileCases(context, now) {
    for (const item of [...activeCases.values()]) {
      if (item.roundKey !== context.roundKey) {
        finalizeCase(item, "cancelled", "round_changed");
        continue;
      }

      const current = latestSquads.get(item.slotKey);
      if (!current) {
        finalizeCase(item, "cancelled", "squad_missing");
        continue;
      }

      if (current.identityComplete && current.identityKey !== item.identityKey) {
        finalizeCase(item, "cancelled", "squad_identity_changed");
        continue;
      }

      if (!current.restrictionEvaluated || !current.isViolation) {
        enterPendingResolution(item, now, current.restrictionEvaluated ? "compliant" : "classification_missing");
        continue;
      }

      item.lastEvaluatedAt = iso(now);
      item.lastEvaluatedAtMs = now;
      item.violationCodes = [...current.violationCodes];
      item.restrictionReasons = [...current.restrictionReasons];
      item.reason = current.restrictionReasons.join("；");
      item.ruleSnapshot = clone(current.ruleSnapshot);
      if (item.status === "pending_resolution") {
        item.status = item.statusBeforePending || deriveProgressStatus(item);
        item.statusBeforePending = "";
        item.compliantSince = "";
        item.compliantSinceMs = 0;
        item.resolutionReason = "";
        dirty = true;
      }
    }

    for (const item of [...activeCases.values()]) {
      if (
        item.status === "pending_resolution"
        && item.compliantSinceMs > 0
        && now - item.compliantSinceMs >= runtimeConfig.resolutionConfirmSeconds * 1000
      ) {
        finalizeCase(item, "resolved", "compliance_confirmed");
      }
    }
  }

  function createCasesFromLatest(context, now) {
    for (const squad of latestSquads.values()) {
      if (!squad.identityComplete || !squad.restrictionEvaluated || !squad.isViolation) continue;
      if (squad.roundKey !== context.roundKey) continue;
      if (hasActiveIdentity(squad.identityKey)) continue;
      if (findExemptionForSquad(squad, now)) continue;

      const baseCaseKey = squad.identityKey;
      const incident = (incidentCounters.get(baseCaseKey) ?? 0) + 1;
      incidentCounters.set(baseCaseKey, incident);
      const caseKey = `${baseCaseKey}:incident-${incident}`;
      const firstWarningAtMs = now + runtimeConfig.firstWarningDelaySeconds * 1000;
      const secondWarningAtMs = now + runtimeConfig.secondWarningDelaySeconds * 1000;
      const disbandAtMs = now + runtimeConfig.disbandDelaySeconds * 1000;
      const item = {
        caseKey,
        baseCaseKey,
        incident,
        identityKey: squad.identityKey,
        slotKey: squad.slotKey,
        roundKey: squad.roundKey,
        serverId: squad.serverId,
        matchId: squad.matchId,
        teamId: squad.teamId,
        squadId: squad.squadId,
        squadName: squad.squadName,
        creatorName: squad.creatorName,
        creatorSteamId: squad.creatorSteamId,
        creatorEosId: squad.creatorEosId,
        generation: squad.generation,
        status: "detected",
        statusBeforePending: "",
        enforcementMode: runtimeConfig.enforcementMode,
        violationCodes: [...squad.violationCodes],
        restrictionReasons: [...squad.restrictionReasons],
        reason: squad.restrictionReasons.join("；"),
        ruleSnapshot: clone(squad.ruleSnapshot),
        detectedAt: iso(now),
        detectedAtMs: now,
        firstWarningAt: iso(firstWarningAtMs),
        firstWarningAtMs,
        secondWarningAt: iso(secondWarningAtMs),
        secondWarningAtMs,
        disbandAt: iso(disbandAtMs),
        disbandAtMs,
        resolvedAt: "",
        resolvedAtMs: 0,
        lastEvaluatedAt: iso(now),
        lastEvaluatedAtMs: now,
        compliantSince: "",
        compliantSinceMs: 0,
        resolutionReason: "",
        warning1SentAt: "",
        warning2SentAt: "",
        disbandAttempts: 0,
        retryAction: "",
        nextRetryAt: "",
        nextRetryAtMs: 0,
        lastError: "",
        actions: [],
      };
      activeCases.set(caseKey, item);
      recordAction(item, "detected", { success: true, simulated: item.enforcementMode === "dry_run" });
      dirty = true;
    }
  }

  async function advanceCase(item, context, now) {
    if (TERMINAL_STATUSES.has(item.status) || item.status === "pending_resolution" || item.status === "disbanding") return;

    if (item.status === "error") {
      if (item.retryAction !== "disband" || now < item.nextRetryAtMs) return;
      await performDisband(item, context, now);
      return;
    }

    if (item.status === "detected" && now >= item.firstWarningAtMs) {
      await performWarning(item, 1, context, now);
      return;
    }
    if (item.status === "warning_1_sent" && now >= item.secondWarningAtMs) {
      await performWarning(item, 2, context, now);
      return;
    }
    if (item.status === "warning_2_sent" && now >= item.disbandAtMs) {
      await performDisband(item, context, now);
    }
  }

  async function performWarning(item, stage, context, now) {
    const validation = validateCase(item, context, now, { live: true });
    if (!validation.ok) return;

    if (item.enforcementMode === "dry_run") {
      recordAction(item, `warning_${stage}`, {
        success: true,
        simulated: true,
        reason: "dry_run",
      });
      markWarningSent(item, stage, now);
      return;
    }

    const leader = runtimeConfig.targetCurrentLeader
      ? resolveCurrentLeader(item)
      : normalizeLeader({
          name: item.creatorName,
          steamId: item.creatorSteamId,
          eosId: item.creatorEosId,
        });
    if (!leader) {
      item.lastError = "leader_unresolved";
      item.lastEvaluatedAt = iso(now);
      item.lastEvaluatedAtMs = now;
      dirty = true;
      return;
    }

    const sender = modules?.adminWarn?.sendAdminWarn ?? modules?.adminWarn?.warnPlayer;
    if (typeof sender !== "function") {
      failCase(item, "admin_warn_unavailable", `warning_${stage}`);
      return;
    }

    const message = stage === 1
      ? `[小队规则警告] 你的小队“${item.squadName}”当前违规：${item.reason}。请在60秒内整改，30秒后将再次检查。`
      : `[小队规则最后警告] 你的小队“${item.squadName}”仍然违规：${item.reason}。请在30秒内整改，否则该小队将被自动解散。`;
    try {
      const result = await sender.call(modules.adminWarn, {
        targetPlayerId: leader.playerId,
        targetName: leader.name,
        targetSteamId: leader.steamId,
        targetEosId: leader.eosId,
        message,
        reason: `squad_restriction_warning_${stage}`,
        sourceModule: MODULE_ID,
        relatedEventId: item.caseKey,
        system: true,
      });
      if (!result?.success) {
        failCase(item, result?.errorMessage ?? result?.skipReason ?? "admin_warn_failed", `warning_${stage}`);
        return;
      }
      recordAction(item, `warning_${stage}`, {
        success: true,
        target: leader,
        commandText: result.commandText ?? "",
      });
      markWarningSent(item, stage, now);
    } catch (error) {
      failCase(item, error?.message ?? String(error), `warning_${stage}`);
    }
  }

  function markWarningSent(item, stage, now) {
    item.status = stage === 1 ? "warning_1_sent" : "warning_2_sent";
    item.lastError = "";
    if (stage === 1) item.warning1SentAt = iso(now);
    else item.warning2SentAt = iso(now);
    dirty = true;
  }

  async function performDisband(item, context, now) {
    const initialValidation = validateCase(item, context, now);
    if (!initialValidation.ok) return;

    if (item.enforcementMode === "dry_run" || item.enforcementMode === "warn_only") {
      recordAction(item, "disband", {
        success: true,
        simulated: item.enforcementMode === "dry_run",
        skipped: item.enforcementMode === "warn_only",
        reason: item.enforcementMode,
      });
      finalizeCase(item, "resolved", `${item.enforcementMode}_complete`);
      return;
    }

    item.disbandAttempts += 1;
    if (runtimeConfig.refreshBeforeDisband && typeof modules?.matchState?.refresh === "function") {
      try {
        await modules.matchState.refresh("squads");
      } catch (error) {
        scheduleDisbandRetry(item, `refresh_failed:${error?.message ?? error}`, now);
        return;
      }
    }

    const refreshedContext = getRoundContext(item.serverId);
    const validation = validateCase(item, refreshedContext, now, { live: true });
    if (!validation.ok) return;

    const disband = modules?.squadManagement?.requestDisband;
    if (typeof disband !== "function") {
      scheduleDisbandRetry(item, "squad_management_unavailable", now);
      return;
    }

    item.status = "disbanding";
    dirty = true;
    const reason = `小队规则自动处罚：两次警告后仍未整改。违规原因：${item.reason}`;
    try {
      const result = await disband.call(modules.squadManagement, {
        serverId: item.serverId,
        teamId: item.teamId,
        squadId: item.squadId,
        squadName: item.squadName,
        reason,
        source: MODULE_ID,
        system: true,
        allowUnverifiedTarget: false,
      });
      recordAction(item, "disband", {
        success: Boolean(result?.ok),
        commandText: result?.command ?? "",
        error: result?.error ?? result?.message ?? "",
      });
      if (result?.ok) {
        finalizeCase(item, "disbanded", "disband_succeeded");
      } else {
        scheduleDisbandRetry(item, result?.error ?? result?.message ?? "disband_failed", now);
      }
    } catch (error) {
      recordAction(item, "disband", {
        success: false,
        error: error?.message ?? String(error),
      });
      scheduleDisbandRetry(item, error?.message ?? String(error), now);
    }
  }

  function scheduleDisbandRetry(item, error, now) {
    item.lastError = text(error) || "disband_failed";
    if (item.disbandAttempts >= runtimeConfig.maxDisbandRetries) {
      item.status = "error";
      item.retryAction = "";
      item.nextRetryAt = "";
      item.nextRetryAtMs = 0;
      moveToHistory(item);
      dirty = true;
      return;
    }
    item.status = "error";
    item.retryAction = "disband";
    item.nextRetryAtMs = now + runtimeConfig.disbandRetryDelaySeconds * 1000;
    item.nextRetryAt = iso(item.nextRetryAtMs);
    dirty = true;
  }

  function validateCase(item, context, now, { live = false } = {}) {
    if (!context.roundKey || context.roundKey !== item.roundKey) {
      finalizeCase(item, "cancelled", "round_changed");
      return { ok: false, reason: "round_changed" };
    }
    if (!clockTrusted(context)) {
      item.lastError = "round_clock_untrusted";
      dirty = true;
      return { ok: false, reason: "round_clock_untrusted" };
    }
    if (findExemptionForCase(item, now)) {
      finalizeCase(item, "cancelled", "administrator_exemption");
      return { ok: false, reason: "administrator_exemption" };
    }

    const current = live ? getLiveSquad(item, context) : latestSquads.get(item.slotKey);
    if (!current) {
      finalizeCase(item, "cancelled", "squad_missing");
      return { ok: false, reason: "squad_missing" };
    }
    if (!current.identityComplete) {
      item.lastError = "identity_unresolved";
      dirty = true;
      return { ok: false, reason: "identity_unresolved" };
    }
    if (current.identityKey !== item.identityKey) {
      finalizeCase(item, "cancelled", "squad_identity_changed");
      return { ok: false, reason: "squad_identity_changed" };
    }
    if (!current.restrictionEvaluated || !current.isViolation) {
      enterPendingResolution(item, now, current.restrictionEvaluated ? "compliant" : "classification_missing");
      return { ok: false, reason: "violation_cleared" };
    }

    item.lastEvaluatedAt = iso(now);
    item.lastEvaluatedAtMs = now;
    item.violationCodes = [...current.violationCodes];
    item.restrictionReasons = [...current.restrictionReasons];
    item.reason = current.restrictionReasons.join("；");
    item.ruleSnapshot = clone(current.ruleSnapshot);
    item.lastError = "";
    dirty = true;
    return { ok: true, current };
  }

  function getLiveSquad(item, context) {
    const managementSquad = modules?.squadManagement?.getSquad?.(item.serverId, item.teamId, item.squadId);
    if (managementSquad) return normalizeSquad(managementSquad, context);

    const matchState = modules?.matchState?.getState?.();
    const raw = matchState?.squads?.list?.find((squad) => (
      number(squad?.teamID ?? squad?.teamId) === item.teamId
      && number(squad?.squadID ?? squad?.squadId) === item.squadId
    ));
    return raw ? normalizeSquad(raw, context) : null;
  }

  function enterPendingResolution(item, now, reason) {
    if (item.status !== "pending_resolution") {
      item.statusBeforePending = item.status;
      item.status = "pending_resolution";
      item.compliantSince = iso(now);
      item.compliantSinceMs = now;
    }
    item.resolutionReason = reason;
    item.lastEvaluatedAt = iso(now);
    item.lastEvaluatedAtMs = now;
    dirty = true;
  }

  function failCase(item, error, action) {
    item.status = "error";
    item.lastError = text(error) || "action_failed";
    item.retryAction = "";
    recordAction(item, action, { success: false, error: item.lastError });
    moveToHistory(item);
    dirty = true;
  }

  function finalizeCase(item, status, reason, details = {}) {
    item.status = status;
    item.resolutionReason = text(reason);
    item.resolvedAtMs = nowMs();
    item.resolvedAt = iso(item.resolvedAtMs);
    item.retryAction = "";
    item.nextRetryAt = "";
    item.nextRetryAtMs = 0;
    if (Object.keys(details).length > 0) item.resolutionDetails = clone(details);
    recordAction(item, status, { success: status !== "error", reason });
    moveToHistory(item);
    dirty = true;
  }

  function moveToHistory(item) {
    activeCases.delete(item.caseKey);
    if (!history.some((entry) => entry.caseKey === item.caseKey && entry.status === item.status)) {
      history.push(clone(item));
      if (history.length > 1000) history.splice(0, history.length - 1000);
    }
  }

  function cancelAllActive(reason, details = {}) {
    for (const item of [...activeCases.values()]) {
      finalizeCase(item, "cancelled", reason, details);
    }
  }

  function recordAction(item, action, details = {}) {
    const record = {
      id: `${item.caseKey}:${action}:${nowMs()}:${actionRecords.length + 1}`,
      caseKey: item.caseKey,
      roundKey: item.roundKey,
      serverId: item.serverId,
      teamId: item.teamId,
      squadId: item.squadId,
      squadName: item.squadName,
      action,
      time: iso(nowMs()),
      ...clone(details),
    };
    item.actions.push(record);
    actionRecords.push(record);
    if (actionRecords.length > 2000) actionRecords.splice(0, actionRecords.length - 2000);
    dirty = true;
    return record;
  }

  function normalizeSquad(raw = {}, context) {
    const teamId = number(raw?.teamId ?? raw?.teamID);
    const squadId = number(raw?.squadId ?? raw?.squadID);
    const managementState = getManagementState(context.serverId);
    const managementSquad = managementState?.squads?.find((squad) => (
      number(squad?.teamId ?? squad?.teamID) === teamId
      && number(squad?.squadId ?? squad?.squadID) === squadId
    )) ?? managementState?.snapshotOnlySquads?.find((squad) => (
      number(squad?.teamId ?? squad?.teamID) === teamId
      && number(squad?.squadId ?? squad?.squadID) === squadId
    )) ?? null;

    const merged = {
      ...(managementSquad ?? {}),
      ...raw,
      teamId,
      teamID: teamId,
      squadId,
      squadID: squadId,
      squadName: text(raw?.squadName ?? raw?.name ?? managementSquad?.squadName),
      size: number(raw?.playerCount ?? raw?.size ?? raw?.memberCount ?? managementSquad?.size) ?? 0,
      squadRestriction: raw?.squadRestriction ?? raw?.restriction ?? managementSquad?.squadRestriction,
    };
    const evaluated = typeof modules?.squadRestrictionMonitor?.evaluateSquad === "function"
      ? modules.squadRestrictionMonitor.evaluateSquad(merged)
      : merged;
    const restriction = evaluated?.squadRestriction ?? raw?.restriction ?? {};
    const creatorName = text(evaluated?.creatorName || managementSquad?.creatorName);
    const creatorSteamId = text(
      evaluated?.creatorSteamId
      || evaluated?.creatorSteamID
      || managementSquad?.creatorSteamId,
    );
    const creatorEosId = text(
      evaluated?.creatorEosId
      || evaluated?.creatorEOSID
      || managementSquad?.creatorEosId,
    );
    const creatorFingerprint = creatorSteamId
      ? `steam-${creatorSteamId}`
      : creatorEosId
        ? `eos-${creatorEosId}`
        : creatorName
          ? `name-${creatorName.toLocaleLowerCase()}`
          : "";
    const roundKey = context.roundKey;
    const slotKey = roundKey && teamId != null && squadId != null ? `${roundKey}:${teamId}:${squadId}` : "";
    const generation = resolveGeneration(slotKey, {
      supplied: evaluated?.generation || managementSquad?.generation,
      fingerprint: [
        creatorFingerprint,
        text(evaluated?.createdAt ?? managementSquad?.createdAt),
        text(evaluated?.lifecycleKey ?? managementSquad?.lifecycleKey),
      ].join("|"),
    });
    const identityComplete = Boolean(roundKey && slotKey && creatorFingerprint && generation);
    const identityKey = identityComplete
      ? `${slotKey}:${creatorFingerprint}:generation-${generation}`
      : "";
    const violations = Array.isArray(restriction?.violations) ? restriction.violations : [];
    const violationCodes = Array.isArray(restriction?.violationCodes)
      ? restriction.violationCodes.map(text).filter(Boolean)
      : violations.map((item) => text(item?.code)).filter(Boolean);
    const restrictionReasons = Array.isArray(restriction?.reasons)
      ? restriction.reasons.map(text).filter(Boolean)
      : violations.map((item) => text(item?.message)).filter(Boolean);

    return {
      raw: evaluated,
      serverId: context.serverId,
      matchId: text(evaluated?.matchId ?? managementState?.matchId ?? context.matchId),
      roundKey,
      slotKey,
      identityKey,
      identityComplete,
      teamId,
      squadId,
      squadName: text(evaluated?.squadName ?? evaluated?.name),
      creatorName,
      creatorSteamId,
      creatorEosId,
      generation,
      restrictionEvaluated: Boolean(restriction?.evaluated),
      isViolation: Boolean(restriction?.isViolation),
      violationCodes,
      restrictionReasons,
      ruleSnapshot: clone(restriction?.ruleSnapshot ?? raw?.ruleSnapshot ?? null),
    };
  }

  function resolveGeneration(slotKey, { supplied, fingerprint }) {
    const suppliedText = text(supplied);
    if (suppliedText) return suppliedText;
    if (!slotKey) return "";
    const previous = observedSlots.get(slotKey);
    if (!previous) {
      observedSlots.set(slotKey, { fingerprint, generation: 1 });
      return "1";
    }
    if (fingerprint && previous.fingerprint && fingerprint !== previous.fingerprint) {
      previous.fingerprint = fingerprint;
      previous.generation += 1;
    } else if (fingerprint && !previous.fingerprint) {
      previous.fingerprint = fingerprint;
    }
    return String(previous.generation);
  }

  function getRoundContext(serverIdInput = "", event = {}) {
    const status = core?.webStatus?.getSnapshot?.() ?? core?.webStatus ?? {};
    const serverId = text(
      serverIdInput
      || event?.serverId
      || status?.serverId
      || core?.webStatus?.serverId,
    );
    const managementState = getManagementState(serverId);
    const matchState = modules?.matchState?.getState?.() ?? {};
    const matchId = text(
      event?.matchId
      ?? managementState?.matchId
      ?? managementState?.currentMatchId
      ?? matchState?.round?.current?.sessionId
      ?? matchState?.round?.current?.matchId,
    );
    const roundKey = text(managementState?.roundKey)
      || (serverId && matchId ? `${serverId}:${matchId}` : "");
    const polling = status?.rconPolling ?? matchState?.rconPolling ?? {};
    const logClockSeconds = numeric(
      status?.logClockSeconds
      ?? polling?.logClockSeconds
      ?? managementState?.logClockSeconds
      ?? 0,
      0,
    );
    const logClockHasAnchor = Boolean(
      status?.logClockHasAnchor
      ?? polling?.logClockHasAnchor
      ?? managementState?.logClockHasAnchor
      ?? false,
    );
    const logClockManual = Boolean(
      status?.logClockManual
      ?? polling?.logClockManual
      ?? managementState?.logClockManual
      ?? false,
    );
    return {
      serverId,
      matchId,
      roundKey,
      logClockSeconds,
      logClockHasAnchor,
      logClockManual,
    };
  }

  function getManagementState(serverId) {
    try {
      return modules?.squadManagement?.getState?.(serverId) ?? null;
    } catch {
      return null;
    }
  }

  function resolveCurrentLeader(item) {
    const matchState = modules?.matchState?.getState?.() ?? {};
    const players = Array.isArray(matchState?.players?.list)
      ? matchState.players.list
      : Array.isArray(matchState?.players)
        ? matchState.players
        : [];
    const matchesSquad = (player) => (
      number(player?.teamID ?? player?.teamId) === item.teamId
      && number(player?.squadID ?? player?.squadId) === item.squadId
    );
    let leader = players.find((player) => matchesSquad(player) && Boolean(player?.isLeader));
    const managementSquad = modules?.squadManagement?.getSquad?.(item.serverId, item.teamId, item.squadId);
    if (!leader && managementSquad?.leaderName) {
      leader = players.find((player) => matchesSquad(player) && text(player?.name) === text(managementSquad.leaderName));
    }
    if (leader) return normalizeLeader(leader);

    const fallbackName = text(managementSquad?.leaderName ?? item.creatorName);
    if (!fallbackName) return null;
    return {
      playerId: "",
      name: fallbackName,
      steamId: text(managementSquad?.leaderSteamId ?? item.creatorSteamId),
      eosId: text(managementSquad?.leaderEosId ?? item.creatorEosId),
    };
  }

  function normalizeLeader(player = {}) {
    return {
      playerId: text(player?.playerID ?? player?.playerId),
      name: text(player?.name ?? player?.playerName),
      steamId: text(player?.steamID ?? player?.steamId),
      eosId: text(player?.eosID ?? player?.eosId),
    };
  }

  function hasActiveIdentity(identityKey) {
    return [...activeCases.values()].some((item) => item.identityKey === identityKey);
  }

  function deriveProgressStatus(item) {
    if (item.warning2SentAt) return "warning_2_sent";
    if (item.warning1SentAt) return "warning_1_sent";
    return "detected";
  }

  function clockTrusted(context) {
    if (!runtimeConfig.requireTrustedRoundClock) return true;
    return context.logClockHasAnchor === true && context.logClockManual !== true;
  }

  function enforcementWindowOpen(context) {
    return Boolean(
      context.roundKey
      && clockTrusted(context)
      && context.logClockSeconds >= runtimeConfig.startAfterSeconds,
    );
  }

  function findExemptionForCase(item, now) {
    return [item.caseKey, item.baseCaseKey, item.slotKey]
      .map((key) => exemptions.get(key))
      .find((entry) => entry && entry.untilMs > now) ?? null;
  }

  function findExemptionForSquad(squad, now) {
    return [squad.identityKey, squad.slotKey]
      .map((key) => exemptions.get(key))
      .find((entry) => entry && entry.untilMs > now) ?? null;
  }

  function pruneExemptions(now) {
    for (const [key, entry] of exemptions) {
      if (entry.untilMs <= now) {
        exemptions.delete(key);
        dirty = true;
      }
    }
  }

  function withCountdown(item) {
    const now = nowMs();
    let nextActionAtMs = 0;
    if (item.status === "detected") nextActionAtMs = item.firstWarningAtMs;
    if (item.status === "warning_1_sent") nextActionAtMs = item.secondWarningAtMs;
    if (item.status === "warning_2_sent") nextActionAtMs = item.disbandAtMs;
    if (item.status === "error" && item.retryAction === "disband") nextActionAtMs = item.nextRetryAtMs;
    if (item.status === "pending_resolution") {
      nextActionAtMs = item.compliantSinceMs + runtimeConfig.resolutionConfirmSeconds * 1000;
    }
    return {
      ...clone(item),
      nextActionAt: nextActionAtMs ? iso(nextActionAtMs) : "",
      remainingSeconds: nextActionAtMs ? Math.max(0, Math.ceil((nextActionAtMs - now) / 1000)) : null,
    };
  }

  function buildState() {
    const context = getRoundContext();
    return {
      enabled: runtimeConfig.enabled,
      enforcementMode: runtimeConfig.enforcementMode,
      currentRoundKey,
      clockTrusted: clockTrusted(context),
      enforcementWindowOpen: enforcementWindowOpen(context),
      logClockSeconds: context.logClockSeconds,
      snapshotReceived,
      lastMonitorAt,
      lastTickAt,
      lastError,
      activeCaseCount: activeCases.size,
      historyCount: history.length,
      recordCount: actionRecords.length,
      activeCases: [...activeCases.values()].map(withCountdown),
      history: history.slice(-200).reverse().map(clone),
      records: actionRecords.slice(-500).reverse().map(clone),
      exemptions: [...exemptions.values()].map(clone),
      config: clone(runtimeConfig),
    };
  }

  async function commitState() {
    if (!dirty) return;
    dirty = false;
    emitUpdated();
    await persistState();
  }

  function emitUpdated() {
    core?.eventBus?.emitModuleEvent?.(MODULE_ID, "updated", {
      eventName: `${MODULE_ID}.updated`,
      source: MODULE_ID,
      ...buildState(),
    });
  }

  async function loadPersistedState() {
    if (!runtimeConfig.recordDirectory) return;
    const filePath = path.join(runtimeConfig.recordDirectory, "state.json");
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
      for (const item of Array.isArray(parsed?.activeCases) ? parsed.activeCases : []) {
        if (!item?.caseKey) continue;
        activeCases.set(item.caseKey, item);
        incidentCounters.set(item.baseCaseKey, Math.max(incidentCounters.get(item.baseCaseKey) ?? 0, number(item.incident) ?? 0));
      }
      for (const item of Array.isArray(parsed?.history) ? parsed.history : []) {
        if (!item?.caseKey) continue;
        history.push(item);
        incidentCounters.set(item.baseCaseKey, Math.max(incidentCounters.get(item.baseCaseKey) ?? 0, number(item.incident) ?? 0));
      }
      actionRecords.push(...(Array.isArray(parsed?.records) ? parsed.records : []));
      for (const entry of Array.isArray(parsed?.exemptions) ? parsed.exemptions : []) {
        if (entry?.key) exemptions.set(entry.key, entry);
      }
      currentRoundKey = text(parsed?.currentRoundKey);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        lastError = `state_load_failed:${error?.message ?? error}`;
        moduleLogger?.warn?.(`[SquadRestrictionEnforcement] ${lastError}`);
      }
    }
  }

  async function persistState() {
    if (!runtimeConfig.recordDirectory) return;
    const payload = JSON.stringify({
      version: 1,
      currentRoundKey,
      savedAt: iso(nowMs()),
      activeCases: [...activeCases.values()],
      history,
      records: actionRecords,
      exemptions: [...exemptions.values()],
    }, null, 2);
    const directory = runtimeConfig.recordDirectory;
    const target = path.join(directory, "state.json");
    const temporary = `${target}.${process.pid}.tmp`;
    persistenceQueue = persistenceQueue.then(async () => {
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(temporary, payload, "utf8");
      await fs.rename(temporary, target);
    }).catch((error) => {
      lastError = `state_persist_failed:${error?.message ?? error}`;
      moduleLogger?.warn?.(`[SquadRestrictionEnforcement] ${lastError}`);
    });
    await persistenceQueue;
  }

  function logFailure(error) {
    lastError = error?.message ?? String(error);
    moduleLogger?.warn?.(`[SquadRestrictionEnforcement] ${lastError}`);
  }

  function nowMs() {
    if (typeof clock?.now === "function") return Number(clock.now());
    return Date.now();
  }
}

function readConfig(config) {
  const raw = config?.get?.("modules.squadRestrictionEnforcement", {}) ?? {};
  const mode = text(raw.enforcementMode || DEFAULT_SQUAD_RESTRICTION_ENFORCEMENT_CONFIG.enforcementMode);
  const recordDirectory = raw.recordDirectory === false
    ? ""
    : path.resolve(process.cwd(), text(raw.recordDirectory || DEFAULT_SQUAD_RESTRICTION_ENFORCEMENT_CONFIG.recordDirectory));
  return {
    enabled: raw.enabled !== false,
    enforcementMode: MODES.has(mode) ? mode : "dry_run",
    startAfterSeconds: nonNegativeInteger(raw.startAfterSeconds, 300),
    firstWarningDelaySeconds: nonNegativeInteger(raw.firstWarningDelaySeconds, 30),
    secondWarningDelaySeconds: nonNegativeInteger(raw.secondWarningDelaySeconds, 60),
    disbandDelaySeconds: nonNegativeInteger(raw.disbandDelaySeconds, 90),
    resolutionConfirmSeconds: nonNegativeInteger(raw.resolutionConfirmSeconds, 10),
    schedulerIntervalMs: Math.max(100, positiveInteger(raw.schedulerIntervalMs, 1000)),
    requireTrustedRoundClock: raw.requireTrustedRoundClock !== false,
    targetCurrentLeader: raw.targetCurrentLeader !== false,
    refreshBeforeDisband: raw.refreshBeforeDisband !== false,
    recordDirectory,
    maxDisbandRetries: positiveInteger(raw.maxDisbandRetries, 3),
    disbandRetryDelaySeconds: nonNegativeInteger(raw.disbandRetryDelaySeconds, 5),
  };
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function numeric(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function number(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value) {
  return String(value ?? "").trim();
}

function iso(value) {
  return new Date(Number(value)).toISOString();
}

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}
