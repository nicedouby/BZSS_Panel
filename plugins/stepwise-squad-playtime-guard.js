// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

import { classifySquadName } from "../domain/squad/squad_name_classifier.js";

const PLUGIN_ID = "plugin.stepwiseSquadPlaytimeGuard";
const CONFIG_KEY = "plugins.stepwiseSquadPlaytimeGuard";
const DEFAULT_DATA_DIR = "./data/stepwise-squad-playtime-guard";
const DEFAULT_RECENT_LIMIT = 300;
const CREATION_COOLDOWN_MS = 3000;
const DEFAULT_RULES = Object.freeze({
  infantry: Object.freeze([
    Object.freeze({ startSeconds: 0, endSeconds: 25, minHoursExclusive: 400 }),
    Object.freeze({ startSeconds: 25, endSeconds: 40, minHoursExclusive: 200 }),
  ]),
  vehicle: Object.freeze([
    Object.freeze({ startSeconds: 50, endSeconds: 60, minHoursExclusive: 800 }),
    Object.freeze({ startSeconds: 60, endSeconds: 75, minHoursExclusive: 600 }),
    Object.freeze({ startSeconds: 75, endSeconds: 90, minHoursExclusive: 400 }),
  ]),
});

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger = logger ?? core?.logger ?? console;
  let runtimeConfig = readConfig(config);
  const dataDir = path.resolve(process.cwd(), runtimeConfig.directory);
  const state = createInitialState();
  const unsubscribers = [];
  let serial = Promise.resolve();

  function enqueue(task) {
    const next = serial.then(task, task);
    serial = next.catch(() => {});
    return next;
  }

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false
      && core?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false;
  }

  function isActive() {
    return Boolean(runtimeConfig.enabled) && isSubscribed();
  }

  async function ensureDataDir() {
    await fs.mkdir(dataDir, { recursive: true });
  }

  function recordsFilePath(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    const safe = Number.isNaN(date.getTime()) ? new Date() : date;
    const yyyy = safe.getFullYear();
    const mm = String(safe.getMonth() + 1).padStart(2, "0");
    const dd = String(safe.getDate()).padStart(2, "0");
    return path.join(dataDir, `${yyyy}-${mm}-${dd}.jsonl`);
  }

  async function appendJsonl(entry) {
    await ensureDataDir();
    await fs.appendFile(
      recordsFilePath(entry.updatedAt || entry.createdAt || nowIso()),
      `${JSON.stringify({ ...entry, persistedAt: nowIso() })}\n`,
      "utf8",
    );
  }

  function persistLater(entry) {
    void appendJsonl(entry).catch((error) => {
      pluginLogger?.warn?.(`[StepwiseSquadPlaytimeGuard] persist failed: ${error?.message ?? error}`);
    });
  }

  function getServerId(value = "") {
    return normalizeText(value || core?.webStatus?.serverId || core?.webStatus?.getSnapshot?.().serverId || "");
  }

  function getWarmupState() {
    return Boolean(core?.webStatus?.getSnapshot?.()?.isWarmup);
  }

  function getClockSeconds() {
    const snapshot = core?.webStatus?.getSnapshot?.() ?? {};
    return Math.max(0, Math.floor(Number(snapshot.logClockSeconds ?? 0) || 0));
  }

  function findPendingLog(event) {
    const targetSquadId = Number(event.squadId);
    const targetName = normalizeSquadName(event.squadName);
    for (const pending of state.pendingLogs.values()) {
      if (Number(pending.squadId) !== targetSquadId) continue;
      if (targetName && normalizeSquadName(pending.squadName) !== targetName) continue;
      return pending;
    }
    return null;
  }

  function findRecordForLog(event) {
    const targetSquadId = Number(event.squadId);
    const targetName = normalizeSquadName(event.squadName);
    for (const record of state.recordsBySlot.values()) {
      if (Number(record.squadId) !== targetSquadId) continue;
      if (targetName && normalizeSquadName(record.squadName) !== targetName) continue;
      return record;
    }
    return null;
  }

  async function handleLifecycleSquadCreated(event = {}) {
    return enqueue(async () => {
      runtimeConfig = readConfig(config);
      const normalized = normalizeCreationEvent(event, "LOG");
      if (!normalized.serverId || normalized.squadId == null || normalized.teamId == null) return;
      await processCreation(normalized);
    });
  }

  async function handleSquadsUpdated(event = {}) {
    return enqueue(async () => {
      runtimeConfig = readConfig(config);
      const serverId = getServerId(event.serverId);
      if (!serverId) return;

      const matchId = normalizeText(event.matchId);
      const squads = Array.isArray(event.squads) ? event.squads : [];
      const currentPresenceKeys = new Set();

      for (const squad of squads) {
        const normalized = normalizeRconSquad(squad, {
          serverId,
          matchId,
          observedAt: normalizeText(event.time) || nowIso(),
        });
        if (!normalized.serverId || normalized.teamId == null || normalized.squadId == null) continue;
        currentPresenceKeys.add(buildPresenceKey(normalized));

        const pending = findPendingLog(normalized);
        if (pending) {
          state.pendingLogs.delete(pending.pendingKey);
          await processCreation({
            ...pending,
            matchId: normalized.matchId || pending.matchId,
            teamId: normalized.teamId,
            inferredLeader: normalized.inferredLeader,
            creationSource: "LOG",
            creationConfidence: "HIGH",
          });
          continue;
        }

        await processCreation(normalized);
      }

      markCurrentSquadPresence({ serverId, matchId, currentPresenceKeys });
    });
  }

  async function processCreation(event) {
    const normalizedEvent = normalizeCreationEvent(event, event.creationSource ?? "LOG");
    const serverId = getServerId(normalizedEvent.serverId);
    if (!serverId || normalizedEvent.squadId == null) return null;
    if (normalizedEvent.creationSource === "LOG" && normalizedEvent.teamId == null) return null;

    if (!isActive()) return null;

    const slotKey = buildSlotKey(normalizedEvent);
    const existing = state.recordsBySlot.get(slotKey) ?? findRecordForLog(normalizedEvent) ?? null;
    const merged = mergeCreation(existing, normalizedEvent, {
      warmup: getWarmupState(),
      clockSeconds: getClockSeconds(),
    });

    const playtime = await resolvePlaytime(merged);
    merged.playtime = playtime;

    const decision = decideCreation(merged, runtimeConfig);
    merged.phase = decision.phase;
    merged.phaseLabel = decision.phaseLabel;
    merged.decision = decision.status;
    merged.decisionReason = decision.reason;
    merged.approved = decision.approved;
    merged.violation = decision.violation;
    merged.updatedAt = nowIso();
    merged.active = true;
    merged.lastEvaluatedAt = merged.updatedAt;

    await applyDecision(merged, decision);
    rememberRecord(merged);
    return cloneRecord(merged);
  }

  async function resolvePlaytime(record) {
    const identity = resolveIdentity(record);
    const result = {
      known: false,
      gameSeconds: null,
      source: "",
      hoursText: "未知h",
      steamID: identity.steamID,
      eosID: identity.eosID,
      name: identity.name,
    };

    const playtimeApi = modules?.playtime;
    if (identity.steamID && typeof playtimeApi?.getBySteamID === "function") {
      try {
        const row = await playtimeApi.getBySteamID(identity.steamID);
        const seconds = nullableNumber(row?.game_seconds ?? row?.gameSeconds);
        if (seconds != null) {
          result.known = true;
          result.gameSeconds = seconds;
          result.source = "module.playtime";
          result.hoursText = formatHoursShort(seconds);
          return result;
        }
      } catch (error) {
        pluginLogger?.debug?.(`[StepwiseSquadPlaytimeGuard] playtime cache lookup failed: ${error?.message ?? error}`);
      }
    }

    const playerDatabase = modules?.playerDatabase;
    if (typeof playerDatabase?.getCachedPlayer === "function") {
      try {
        const cached = await playerDatabase.getCachedPlayer({
          steamID: identity.steamID,
          eosID: identity.eosID,
          name: identity.name,
        });
        const seconds = nullableNumber(cached?.game_seconds ?? cached?.gameSeconds);
        if (seconds != null) {
          result.known = true;
          result.gameSeconds = seconds;
          result.source = "module.playerDatabase";
          result.hoursText = formatHoursShort(seconds);
          result.steamID = normalizeText(cached?.steam_id ?? cached?.steamID) || result.steamID;
          result.eosID = normalizeText(cached?.eos_id ?? cached?.eosID) || result.eosID;
          result.name = normalizeText(cached?.current_name ?? cached?.name) || result.name;
          return result;
        }
      } catch (error) {
        pluginLogger?.debug?.(`[StepwiseSquadPlaytimeGuard] player cache lookup failed: ${error?.message ?? error}`);
      }
    }

    return result;
  }

  function decideCreation(record, currentConfig) {
    const cooldown = getCreationCooldown(record, state);
    if (cooldown.active) {
      return {
        status: "kick_cooldown",
        phase: "kick_cooldown",
        phaseLabel: "kick cooldown",
        approved: false,
        violation: true,
        reason: `Kick cooldown active for ${cooldown.remainingSeconds}s.`,
      };
    }

    if (record.isWarmup) {
      return {
        status: "warmup_skipped",
        phase: "warmup",
        phaseLabel: "warmup skipped",
        approved: true,
        violation: false,
        reason: "Warmup enabled.",
      };
    }

    if (record.squadNature !== "infantry" && record.squadNature !== "vehicle") {
      return {
        status: "skipped_other_nature",
        phase: "other",
        phaseLabel: "other nature skipped",
        approved: true,
        violation: false,
        reason: "Current squad nature is outside the stepwise rules.",
      };
    }

    const rule = findRule(record.squadNature, record.clockSeconds, currentConfig);
    if (!rule) {
      return {
        status: "open",
        phase: "open",
        phaseLabel: "open",
        approved: true,
        violation: false,
        reason: "Current time window has no playtime restriction.",
      };
    }

    if (!record.playtime?.known) {
      return {
        status: "missing_playtime",
        phase: "lookup_pending",
        phaseLabel: rule.label,
        approved: false,
        violation: true,
        reason: `Missing playtime for ${rule.label}.`,
        rule,
      };
    }

    const minSecondsExclusive = rule.minHoursExclusive * 3600;
    const approved = Number(record.playtime.gameSeconds ?? 0) > minSecondsExclusive;
    return {
      status: approved ? "approved" : "insufficient_playtime",
      phase: approved ? "approved" : "insufficient_playtime",
      phaseLabel: rule.label,
      approved,
      violation: !approved,
      reason: approved
        ? `Playtime passed ${rule.label}.`
        : `${record.squadNatureLabel} requires > ${rule.minHoursExclusive}h during ${rule.label}.`,
      rule,
    };
  }

  async function applyDecision(record, decision) {
    if (decision.approved && shouldBroadcast(record, decision)) {
      await broadcastCreation(record, decision);
    }

    if (!decision.approved && !record.actions.some((action) => action.type === "disbanded" || action.type === "disband_failed")) {
      const disbandResult = await disbandSquad(record, decision);
      record.actions.push({
        type: disbandResult?.ok === false ? "disband_failed" : "disbanded",
        result: summarizeActionResult(disbandResult),
      });
      if (disbandResult?.ok !== false) {
        record.active = false;
        record.resolvedAt = nowIso();
      }
    }

    if (!decision.approved && shouldWarn(record, decision)) {
      const warned = record.actions.some((action) => action.type === "warned" || action.type === "warn_failed");
      if (!warned) {
        const cooldown = armCreationCooldown(record, state);
        record.cooldownUntil = cooldown.untilIso;
        const warnResult = await warnCreator(record, decision);
        record.actions.push({
          type: warnResult?.success === false ? "warn_failed" : "warned",
          result: summarizeActionResult(warnResult),
          cooldownUntil: cooldown.untilIso,
        });
      }
    }

    if ((!record.playtime?.known && runtimeConfig.liveLookupWhenMissing) || (record.isWarmup && !record.playtime?.known && runtimeConfig.liveLookupWhenMissing)) {
      await triggerBackgroundLookup(record);
    }
  }

  function shouldBroadcast(record, decision) {
    if (!runtimeConfig.broadcastOnApproved) return false;
    if (decision.status === "skipped_other_nature") return false;
    return !record.actions.some((action) => action.type === "broadcasted" || action.type === "broadcast_failed");
  }

  function shouldWarn(record, decision) {
    if (decision.status === "missing_playtime") return Boolean(runtimeConfig.warnOnMissingPlaytime);
    return true;
  }

  async function broadcastCreation(record) {
    const sender = modules?.adminWarn?.broadcastMessage ?? modules?.adminWarn?.sendAdminBroadcast;
    if (typeof sender !== "function") {
      record.actions.push({
        type: "broadcast_failed",
        result: { error: "admin_warn_unavailable" },
      });
      return;
    }

    const result = await sender.call(modules.adminWarn, {
      message: `${record.creatorName || record.identityName || "未知玩家"} 建立小队 ${record.squadName || "未知小队"} 队伍性质为 ${record.squadNatureLabel || "未知"} 游戏时长 ${record.playtime?.hoursText || "未知h"}`,
      reason: "stepwise_squad_playtime_broadcast",
      sourceModule: PLUGIN_ID,
      relatedEventId: record.id,
      system: true,
    }).catch((error) => ({ success: false, error: error?.message ?? String(error) }));

    record.actions.push({
      type: result?.success === false ? "broadcast_failed" : "broadcasted",
      result: summarizeActionResult(result),
    });
  }

  async function disbandSquad(record, decision) {
    const request = {
      serverId: record.serverId,
      teamId: record.teamId,
      squadId: record.squadId,
      reason: buildDisbandReason(record, decision),
      source: PLUGIN_ID,
      system: true,
      operatorName: PLUGIN_ID,
    };
    if (typeof modules?.squadManagement?.requestDisband === "function") return await modules.squadManagement.requestDisband(request);
    if (typeof modules?.squadManagement?.disband === "function") return await modules.squadManagement.disband(request);
    if (typeof modules?.squadManagement?.executeAction === "function") {
      return await modules.squadManagement.executeAction({ ...request, type: "disband_squad" });
    }
    return { ok: false, error: "squad_management_unavailable" };
  }

  async function warnCreator(record, decision) {
    const sender = modules?.adminWarn?.sendAdminWarn ?? modules?.adminWarn?.warnPlayer;
    if (typeof sender !== "function") return { success: false, skipped: true, skipReason: "admin_warn_unavailable" };
    const identity = resolveIdentity(record);
    const targetName = identity.name;
    if (!targetName) return { success: false, skipped: true, skipReason: "target_missing" };
    return await sender.call(modules.adminWarn, {
      targetName,
      targetSteamId: identity.steamID || undefined,
      targetEosId: identity.eosID || undefined,
      message: buildWarnMessage(record, decision),
      reason: "stepwise_squad_playtime_violation",
      sourceModule: PLUGIN_ID,
      relatedEventId: record.id,
      system: true,
    }).catch((error) => ({ success: false, error: error?.message ?? String(error) }));
  }

  async function triggerBackgroundLookup(record) {
    if (record.lookupStartedAt) return;
    const steamID = normalizeText(record.playtime?.steamID || record.creatorSteamId || record.inferredLeader?.steamId);
    if (!steamID || typeof modules?.playtime?.lookupSteamID !== "function") return;

    record.lookupStartedAt = nowIso();
    record.actions.push({
      type: "lookup_started",
      steamID,
      at: record.lookupStartedAt,
    });

    void modules.playtime.lookupSteamID(steamID, {
      lastSeenName: record.creatorName || record.inferredLeader?.name || null,
    }).then((lookup) => {
      const slotKey = buildSlotKey(record);
      const current = state.recordsBySlot.get(slotKey);
      if (!current) return;
      const seconds = nullableNumber(lookup?.gameSeconds ?? lookup?.game_seconds);
      current.lookupFinishedAt = nowIso();
      current.lookupResult = {
        steamID,
        found: Boolean(lookup?.found ?? seconds != null),
        gameSeconds: seconds,
        hoursText: seconds == null ? "未知h" : formatHoursShort(seconds),
      };
      current.updatedAt = current.lookupFinishedAt;
      current.actions.push({
        type: "lookup_finished",
        steamID,
        found: current.lookupResult.found,
        gameSeconds: seconds,
      });
      rememberRecord(current);
    }).catch((error) => {
      const slotKey = buildSlotKey(record);
      const current = state.recordsBySlot.get(slotKey);
      if (!current) return;
      current.lookupFinishedAt = nowIso();
      current.lookupError = error?.message ?? String(error);
      current.updatedAt = current.lookupFinishedAt;
      current.actions.push({
        type: "lookup_failed",
        steamID,
        error: current.lookupError,
      });
      rememberRecord(current);
    });
  }

  function rememberRecord(record) {
    const slotKey = buildSlotKey(record);
    const normalized = cloneRecord(record);
    state.recordsBySlot.set(slotKey, normalized);

    const existingIndex = state.records.findIndex((item) => item.id === normalized.id || buildSlotKey(item) === slotKey);
    if (existingIndex >= 0) {
      state.records.splice(existingIndex, 1, normalized);
    } else {
      state.records.push(normalized);
    }

    state.records = state.records
      .sort((left, right) => String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)))
      .slice(0, runtimeConfig.maxRecentRecords);

    persistLater({
      type: "DECISION",
      updatedAt: normalized.updatedAt,
      record: normalized,
    });
  }

  function markCurrentSquadPresence({ serverId, matchId = "", currentPresenceKeys = new Set() } = {}) {
    const normalizedServerId = normalizeText(serverId);
    const normalizedMatchId = normalizeText(matchId);
    const updatedAt = nowIso();

    for (const record of state.records) {
      if (!record?.serverId || record.teamId == null || record.squadId == null) continue;
      if (normalizeText(record.serverId) !== normalizedServerId) continue;
      if (normalizedMatchId && normalizeText(record.matchId) && normalizeText(record.matchId) !== normalizedMatchId) continue;

      const isPresent = currentPresenceKeys.has(buildPresenceKey(record));
      if (record.active === isPresent) continue;
      record.active = isPresent;
      record.updatedAt = updatedAt;
      record.resolvedAt = isPresent ? "" : updatedAt;
      state.recordsBySlot.set(buildSlotKey(record), cloneRecord(record));
    }
  }

  function getStatus() {
    runtimeConfig = readConfig(config);
    const recentRecords = state.records.map(cloneRecord);
    return {
      pluginId: PLUGIN_ID,
      enabled: Boolean(runtimeConfig.enabled),
      subscribed: isSubscribed(),
      active: isActive(),
      settings: publicSettings(),
      recentRecords,
      pendingLogCount: state.pendingLogs.size,
      summary: buildSummary(recentRecords),
    };
  }

  function publicSettings() {
    return {
      directory: runtimeConfig.directory,
      broadcastOnApproved: runtimeConfig.broadcastOnApproved,
      warnOnMissingPlaytime: runtimeConfig.warnOnMissingPlaytime,
      liveLookupWhenMissing: runtimeConfig.liveLookupWhenMissing,
      maxRecentRecords: runtimeConfig.maxRecentRecords,
      rules: cloneValue(runtimeConfig.rules),
    };
  }

  const api = {
    getStatus,
    getState: getStatus,
    async simulateCreation(event = {}) {
      return await enqueue(() => processCreation(normalizeCreationEvent(event, event.creationSource ?? "LOG")));
    },
    async simulateSquadsUpdated(event = {}) {
      await handleSquadsUpdated(event);
      return getStatus();
    },
  };

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "Stepwise Squad Playtime Guard",
      kind: "plugin",
      version: "1.0.0",
      description: "Applies stepwise early-round squad-creation playtime requirements from log and RCON events.",
      category: "Moderation",
    },
    apiName: "stepwiseSquadPlaytimeGuard",
    api,

    async init() {
      await ensureDataDir();
    },

    async start() {
      runtimeConfig = readConfig(config);
      if (typeof core?.eventBus?.onModuleEvent === "function") {
        unsubscribers.push(core.eventBus.onModuleEvent("module.squadLifecycle", "squadCreated", (event) => {
          void handleLifecycleSquadCreated(event);
        }));
      }
      pluginLogger?.info?.("[StepwiseSquadPlaytimeGuard] plugin started.");
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try { unsubscribe(); } catch {}
      }
    },
  };
}

function readConfig(config) {
  const raw = config?.get?.(CONFIG_KEY, {}) ?? {};
  return {
    enabled: raw.enabled !== false,
    directory: normalizeText(raw.directory) || DEFAULT_DATA_DIR,
    broadcastOnApproved: raw.broadcastOnApproved !== false,
    warnOnMissingPlaytime: raw.warnOnMissingPlaytime !== false,
    liveLookupWhenMissing: raw.liveLookupWhenMissing !== false,
    maxRecentRecords: positiveInt(raw.maxRecentRecords, DEFAULT_RECENT_LIMIT),
    rules: normalizeRules(raw.rules),
  };
}

function normalizeRules(rules) {
  return {
    infantry: normalizeRuleList(rules?.infantry, DEFAULT_RULES.infantry),
    vehicle: normalizeRuleList(rules?.vehicle, DEFAULT_RULES.vehicle),
  };
}

function normalizeRuleList(list, fallback) {
  const source = Array.isArray(list) && list.length ? list : fallback;
  return source
    .map((item) => ({
      startSeconds: positiveInt(item?.startSeconds, 0),
      endSeconds: positiveInt(item?.endSeconds, 0),
      minHoursExclusive: positiveInt(item?.minHoursExclusive, 0),
    }))
    .filter((item) => item.endSeconds > item.startSeconds && item.minHoursExclusive > 0)
    .sort((left, right) => left.startSeconds - right.startSeconds);
}

function findRule(nature, seconds, runtimeConfig) {
  const list = Array.isArray(runtimeConfig?.rules?.[nature]) ? runtimeConfig.rules[nature] : [];
  const safeSeconds = Math.max(0, Math.floor(Number(seconds ?? 0) || 0));
  const matched = list.find((item) => safeSeconds >= item.startSeconds && safeSeconds < item.endSeconds);
  if (!matched) return null;
  return {
    ...matched,
    label: `${matched.startSeconds}-${matched.endSeconds}s`,
  };
}

function normalizeCreationEvent(event = {}, fallbackSource = "LOG") {
  const creationSource = normalizeText(event.creationSource ?? fallbackSource) || fallbackSource;
  const classification = classifySquadName(normalizeText(event.squadName));
  return {
    id: normalizeText(event.id) || `sspg:${Date.now()}:${Math.random().toString(16).slice(2)}`,
    serverId: normalizeText(event.serverId),
    matchId: normalizeText(event.matchId),
    teamId: nullableNumber(event.teamId ?? event.teamID),
    squadId: nullableNumber(event.squadId ?? event.squadID),
    squadName: normalizeText(event.squadName),
    creatorName: normalizeText(event.creatorName ?? event.playerName),
    creatorSteamId: normalizeText(event.creatorSteamId ?? event.creatorSteamID ?? event.steamId ?? event.steamID),
    creatorEosId: normalizeText(event.creatorEosId ?? event.creatorEOSID ?? event.eosId ?? event.eosID),
    inferredLeader: normalizeIdentity(event.inferredLeader ?? {
      name: event.leaderName,
      steamId: event.leaderSteamId,
      eosId: event.leaderEosId,
    }),
    createdAt: normalizeText(event.createdAt ?? event.time) || nowIso(),
    updatedAt: normalizeText(event.updatedAt ?? event.time) || nowIso(),
    createdAtMs: Number(event.createdAtMs ?? event.timeMs ?? Date.parse(event.createdAt ?? event.time)) || Date.now(),
    creationSource,
    creationConfidence: normalizeText(event.creationConfidence ?? (creationSource === "LOG" ? "HIGH" : "MEDIUM")),
    isLogConfirmed: creationSource === "LOG" || creationSource === "RCON_PROMOTED_TO_LOG",
    squadNature: classification.nature,
    squadNatureLabel: classification.label,
    squadVehicleClass: classification.vehicleClass,
    squadVehicleClassLabel: classification.vehicleClassLabel,
    clockSeconds: positiveInt(event.clockSeconds, 0),
    isWarmup: Boolean(event.isWarmup),
    playtime: cloneValue(event.playtime) ?? null,
    actions: Array.isArray(event.actions) ? event.actions.map((action) => ({ ...action })) : [],
    active: event.active !== false,
    resolvedAt: normalizeText(event.resolvedAt),
  };
}

function normalizeRconSquad(squad = {}, context = {}) {
  return normalizeCreationEvent({
    serverId: squad.serverId ?? context.serverId,
    matchId: squad.matchId ?? context.matchId,
    teamId: squad.teamId ?? squad.teamID,
    squadId: squad.squadId ?? squad.squadID,
    squadName: squad.squadName ?? squad.name,
    leaderName: squad.leaderName,
    leaderSteamId: squad.leaderSteamId,
    leaderEosId: squad.leaderEosId,
    createdAt: squad.createdAt ?? context.observedAt,
    updatedAt: squad.updatedAt ?? context.observedAt,
    creationSource: "RCON_SNAPSHOT",
    creationConfidence: "MEDIUM",
  }, "RCON_SNAPSHOT");
}

function mergeCreation(existing, event, context) {
  const sourceWasRcon = existing?.creationSource === "RCON_SNAPSHOT" && event.creationSource === "LOG";
  return {
    ...(existing ?? {}),
    ...event,
    id: existing?.id ?? event.id,
    creatorName: event.creatorName || existing?.creatorName || "",
    creatorSteamId: event.creatorSteamId || existing?.creatorSteamId || "",
    creatorEosId: event.creatorEosId || existing?.creatorEosId || "",
    inferredLeader: event.inferredLeader?.name || event.inferredLeader?.steamId || event.inferredLeader?.eosId
      ? event.inferredLeader
      : (existing?.inferredLeader ?? normalizeIdentity({})),
    creationSource: sourceWasRcon ? "RCON_PROMOTED_TO_LOG" : event.creationSource,
    creationConfidence: event.creationSource === "LOG" ? "HIGH" : event.creationConfidence,
    isLogConfirmed: Boolean(event.creationSource === "LOG" || existing?.isLogConfirmed),
    isWarmup: Boolean(context.warmup),
    clockSeconds: Math.max(0, Math.floor(Number(context.clockSeconds ?? 0) || 0)),
    actions: Array.isArray(existing?.actions) ? existing.actions.map((action) => ({ ...action })) : [],
    playtime: cloneValue(existing?.playtime) ?? null,
    lookupStartedAt: normalizeText(existing?.lookupStartedAt),
    lookupFinishedAt: normalizeText(existing?.lookupFinishedAt),
    lookupResult: cloneValue(existing?.lookupResult) ?? null,
    lookupError: normalizeText(existing?.lookupError),
  };
}

function resolveIdentity(record = {}) {
  const creator = normalizeIdentity({
    name: record.creatorName,
    steamId: record.creatorSteamId,
    eosId: record.creatorEosId,
  });
  if (creator.name || creator.steamID || creator.eosID) {
    return creator;
  }
  return normalizeIdentity(record.inferredLeader);
}

function normalizeIdentity(value = {}) {
  return {
    name: normalizeText(value?.name),
    steamID: normalizeText(value?.steamId ?? value?.steamID),
    eosID: normalizeText(value?.eosId ?? value?.eosID),
  };
}

function buildDisbandReason(record, decision) {
  if (decision.status === "missing_playtime") {
    return `Stepwise guard: playtime missing during ${decision.rule?.label ?? "restricted window"}`;
  }
  return `Stepwise guard: ${record.squadNatureLabel || "当前"} ${decision.rule?.label ?? "window"} requires > ${decision.rule?.minHoursExclusive ?? 0}h`;
}

function buildWarnMessage(record, decision) {
  if (decision.status === "missing_playtime") {
    return "已处理你建立的小队，正在查询你的游戏时长。接下来三秒你将无法建队。";
  }
  return `${record.squadNatureLabel || "当前队伍"} 在 ${decision.rule?.label ?? "限制窗口"} 需要大于 ${decision.rule?.minHoursExclusive ?? 0}h，你当前为 ${record.playtime?.hoursText || "未知h"}。接下来三秒你将无法建队。`;
}

function buildSlotKey(event) {
  return [
    normalizeText(event.serverId),
    normalizeText(event.matchId),
    event.teamId == null ? "" : String(event.teamId),
    event.squadId == null ? "" : String(event.squadId),
    normalizeSquadName(event.squadName),
  ].join("|");
}

function buildPresenceKey(event) {
  return [
    normalizeText(event.serverId),
    normalizeText(event.matchId),
    event.teamId == null ? "" : String(event.teamId),
    event.squadId == null ? "" : String(event.squadId),
  ].join("|");
}

function buildPendingKey(event) {
  return [
    normalizeText(event.serverId),
    normalizeText(event.matchId),
    event.squadId == null ? "" : String(event.squadId),
    normalizeSquadName(event.squadName),
    normalizeText(event.creatorSteamId || event.creatorEosId || event.creatorName),
  ].join("|");
}

function buildSummary(records) {
  const summary = {
    total: records.length,
    approved: 0,
    violations: 0,
    broadcasts: 0,
    disbands: 0,
    warns: 0,
    pendingLookups: 0,
  };
  for (const record of records) {
    if (record.approved) summary.approved += 1;
    if (record.violation) summary.violations += 1;
    if (record.actions?.some((action) => action.type === "broadcasted")) summary.broadcasts += 1;
    if (record.actions?.some((action) => action.type === "disbanded")) summary.disbands += 1;
    if (record.actions?.some((action) => action.type === "warned")) summary.warns += 1;
    if (record.actions?.some((action) => action.type === "lookup_started") && !record.actions?.some((action) => action.type === "lookup_finished" || action.type === "lookup_failed")) {
      summary.pendingLookups += 1;
    }
  }
  return summary;
}

function createInitialState() {
  return {
    records: [],
    recordsBySlot: new Map(),
    pendingLogs: new Map(),
    creationCooldowns: new Map(),
  };
}

function nowMs() {
  return Date.now();
}

function getCreationCooldown(record, stateRef) {
  const key = buildCreatorCooldownKey(record);
  const untilMs = Number(stateRef?.creationCooldowns?.get(key) ?? 0);
  if (untilMs <= nowMs()) {
    stateRef?.creationCooldowns?.delete(key);
    return { active: false, untilMs: 0, untilIso: "", remainingSeconds: 0 };
  }
  return {
    active: true,
    untilMs,
    untilIso: new Date(untilMs).toISOString(),
    remainingSeconds: Math.max(1, Math.ceil((untilMs - nowMs()) / 1000)),
  };
}

function armCreationCooldown(record, stateRef) {
  const key = buildCreatorCooldownKey(record);
  const untilMs = nowMs() + CREATION_COOLDOWN_MS;
  stateRef?.creationCooldowns?.set(key, untilMs);
  return {
    key,
    untilMs,
    untilIso: new Date(untilMs).toISOString(),
  };
}

function buildCreatorCooldownKey(record) {
  if (record.creatorSteamId) return `steam:${record.creatorSteamId}`;
  if (record.creatorEosId) return `eos:${record.creatorEosId}`;
  if (record.creatorName) return `name:${normalizeSquadName(record.creatorName)}`;
  if (record.inferredLeader?.steamId) return `steam:${record.inferredLeader.steamId}`;
  if (record.inferredLeader?.eosId) return `eos:${record.inferredLeader.eosId}`;
  if (record.inferredLeader?.name) return `name:${normalizeSquadName(record.inferredLeader.name)}`;
  return "unknown";
}

function summarizeActionResult(result) {
  if (!result || typeof result !== "object") return { ok: false };
  return {
    ok: Boolean(result.ok ?? result.success),
    success: Boolean(result.success ?? result.ok),
    error: normalizeText(result.error ?? result.errorMessage),
    skipped: Boolean(result.skipped),
    command: normalizeText(result.command ?? result.commandText),
  };
}

function cloneRecord(record) {
  return cloneValue(record);
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

function formatHoursShort(gameSeconds) {
  const seconds = Math.max(0, Math.floor(Number(gameSeconds) || 0));
  if (!seconds) return "0h";
  const hours = seconds / 3600;
  return `${Number(hours.toFixed(1))}h`;
}

function normalizeSquadName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function positiveInt(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function nullableNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nowIso() {
  return new Date().toISOString();
}
