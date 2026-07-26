// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

import { classifySquadNameWithPolicy } from "../domain/squad-name-policy/index.js";
import {
  SQUAD_NAME_RULE_PASSED_EVENT,
  SQUAD_RULE_CHAIN_MODULE_ID,
  SQUAD_RULE_SOURCES,
  emitSquadRuleViolation,
  emitTieredSquadTimePassed,
} from "../modules/squad-rule-chain/events.js";

const PLUGIN_ID = "plugin.stepwiseSquadPlaytimeGuard";
const CONFIG_KEY = "plugins.stepwiseSquadPlaytimeGuard";
const DEFAULT_DATA_DIR = "./data/stepwise-squad-playtime-guard";
const DEFAULT_RECENT_LIMIT = 300;
const DEFAULT_RECENT_LOG_LIMIT = 200;
const RULE_REMINDER_SECONDS = 10;
const DEFAULT_RULES = Object.freeze({
  infantry: Object.freeze([
    Object.freeze({ startSeconds: 0, endSeconds: 30, minHoursExclusive: 800 }),
    Object.freeze({ startSeconds: 30, endSeconds: 50, minHoursExclusive: 600 }),
    Object.freeze({ startSeconds: 50, endSeconds: 100, minHoursExclusive: 400 }),
  ]),
  vehicle: Object.freeze([
    Object.freeze({ startSeconds: 0, endSeconds: 60, minHoursExclusive: 1200 }),
    Object.freeze({ startSeconds: 60, endSeconds: 90, minHoursExclusive: 800 }),
    Object.freeze({ startSeconds: 90, endSeconds: 120, minHoursExclusive: 400 }),
  ]),
});

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger = logger ?? core?.logger ?? console;
  let runtimeConfig = readConfig(config);
  const dataDir = path.resolve(process.cwd(), runtimeConfig.directory);
  const state = createInitialState();
  const unsubscribers = [];
  let serial = Promise.resolve();
  let ruleReminderTimer = null;

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

  function getClockContext() {
    const snapshot = core?.webStatus?.getSnapshot?.() ?? {};
    return {
      clockSeconds: Math.max(0, Math.floor(Number(snapshot.logClockSeconds ?? 0) || 0)),
      anchorLogTime: normalizeText(snapshot.logClockAnchorLogTime ?? snapshot.logClockLastResetAt ?? ""),
      hasAnchor: Boolean(snapshot.logClockHasAnchor),
      manual: Boolean(snapshot.logClockManual),
      trusted: Boolean(snapshot.logClockHasAnchor) && !Boolean(snapshot.logClockManual),
    };
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
    if (!isLiveActionEvent(event)) {
      return;
    }
    return enqueue(async () => {
      runtimeConfig = readConfig(config);
      const normalized = normalizeCreationEvent({
        ...event,
        creatorName: event.leaderName ?? event.creatorName,
        creatorSteamId: event.leaderSteamId ?? event.creatorSteamId,
        creatorEosId: event.leaderEosId ?? event.creatorEosId,
      }, "LOG", modules, config);
      const clockContext = getClockContext();
      const loggedEvent = {
        ...normalized,
        clockSeconds: clockContext.clockSeconds,
        clockAnchorLogTime: clockContext.anchorLogTime,
        clockHasAnchor: clockContext.hasAnchor,
        isWarmup: getWarmupState(),
      };
      if (!normalized.serverId || normalized.squadId == null || normalized.teamId == null) {
        loggedEvent.playtime = await resolvePlaytime(loggedEvent);
        rememberCreationLog(state, buildCreationLogEntry(loggedEvent, {
          stage: "dropped",
          message: `Lifecycle squadCreated event ignored because required fields were incomplete: ${describeMissingLifecycleFields(normalized).join(", ") || "unknown"}.`,
          dropReason: "missing_required_fields",
        }));
        return;
      }
      rememberCreationLog(state, buildCreationLogEntry(loggedEvent, {
        stage: "received",
        message: "Lifecycle squadCreated event received. Decision still uses the current log clock.",
      }));
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
      const clockContext = getClockContext();
      const isWarmup = getWarmupState();

      for (const squad of squads) {
        const normalized = normalizeRconSquad(squad, {
          serverId,
          matchId,
          observedAt: normalizeText(event.time) || nowIso(),
        }, modules, config);
        if (!normalized.serverId || normalized.teamId == null || normalized.squadId == null) continue;
        rememberCreationLog(state, buildCreationLogEntry({
          ...normalized,
          clockSeconds: clockContext.clockSeconds,
          clockAnchorLogTime: clockContext.anchorLogTime,
          clockHasAnchor: clockContext.hasAnchor,
          isWarmup,
        }, {
          stage: "observed",
          message: "Squad seen in RCON squad snapshot. Decision still uses the current log clock.",
        }));
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
    const normalizedEvent = normalizeCreationEvent(event, event.creationSource ?? "LOG", modules, config);
    const serverId = getServerId(normalizedEvent.serverId);
    if (!serverId || normalizedEvent.squadId == null) return null;
    if (normalizedEvent.creationSource === "LOG" && normalizedEvent.teamId == null) return null;

    if (!isActive()) return null;

    const slotKey = buildSlotKey(normalizedEvent);
    const candidate = state.recordsBySlot.get(slotKey) ?? findRecordForLog(normalizedEvent) ?? null;
    const existing = shouldStartNewRecordGeneration(candidate, normalizedEvent) ? null : candidate;
    const clockContext = getClockContext();
    if (!getWarmupState() && !clockContext.trusted && clockContext.clockSeconds <= 0) {
      rememberCreationLog(state, buildCreationLogEntry({
        ...normalizedEvent,
        clockSeconds: clockContext.clockSeconds,
        clockAnchorLogTime: clockContext.anchorLogTime,
        clockHasAnchor: clockContext.hasAnchor,
        clockManual: clockContext.manual,
      }, {
        stage: "dropped",
        message: "Creation ignored because the current log clock is not trusted yet.",
        dropReason: clockContext.manual ? "untrusted_manual_log_clock" : "untrusted_log_clock_without_anchor",
      }));
      return null;
    }
    const merged = mergeCreation(existing, normalizedEvent, {
      warmup: getWarmupState(),
      clockSeconds: clockContext.clockSeconds,
      clockAnchorLogTime: clockContext.anchorLogTime,
      clockHasAnchor: clockContext.hasAnchor,
      clockManual: clockContext.manual,
      clockTrusted: clockContext.trusted,
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

    await maybeBroadcastRuleReminder(merged);
    await applyDecision(merged, decision);
    rememberRecord(merged);
    rememberCreationLog(state, buildCreationLogEntry(merged, {
      stage: "evaluated",
      message: decision.reason,
      decision,
    }));
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
    if (record.isWarmup) {
      return {
        status: "warmup_skipped",
        phase: "warmup",
        phaseLabel: "warmup skipped",
        approved: true,
        violation: false,
        reason: "暖机阶段已跳过。",
      };
    }

    if (!record.classification?.source) {
      return {
        status: "classification_missing",
        phase: "classification_missing",
        phaseLabel: "classification missing",
        approved: true,
        violation: false,
        reason: "未取得队名规范分类，已跳过阶梯建队自动处理。",
      };
    }

    if (record.squadNature !== "infantry" && record.squadNature !== "vehicle") {
      return {
        status: "skipped_other_nature",
        phase: "other",
        phaseLabel: "other nature skipped",
        approved: true,
        violation: false,
        reason: "当前小队类型不在阶梯规则限制内。",
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
        reason: "当前时间段无建队时长限制。",
      };
    }

    if (!record.playtime?.known) {
      return {
        status: "missing_playtime",
        phase: "lookup_pending",
        phaseLabel: rule.label,
        approved: false,
        violation: true,
        reason: `缺少 ${rule.label} 区间的游戏时长。`,
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
        ? `时长满足 ${rule.label} 区间要求。`
        : `${record.squadNatureLabel || "当前队伍"} 在 ${rule.label} 区间需要大于 ${rule.minHoursExclusive}h。`,
      rule,
    };
  }

  async function applyDecision(record, decision) {
    if (!decision.approved) {
      const violationEvent = {
        serverId: record.serverId,
        matchId: record.matchId,
        teamId: record.teamId,
        squadId: record.squadId,
        squadName: record.squadName,
        ...buildClassificationFields(record),
        leaderSteamId: record.creatorSteamId || record.inferredLeader?.steamId,
        leaderName: record.creatorName || record.inferredLeader?.name,
        leaderEosId: record.creatorEosId || record.inferredLeader?.eosId,
        sourceMode: record.sourceMode,
        source: SQUAD_RULE_SOURCES.tieredSquadTime,
        reason: decision.reason,
        createdAt: record.createdAt,
        createdAtMs: record.createdAtMs,
        sourceEventId: record.id,
        warningMessages: shouldWarn(record, decision) ? [buildWarnMessage(record, decision)] : [],
        broadcastMessage: shouldBroadcastViolation(record, decision) ? buildViolationBroadcastMessage(record, decision) : "",
        disbandReason: buildDisbandReason(record, decision),
      });
      const ruleChain = modules?.squadRuleChain?.api ?? modules?.squadRuleChain;
      if (typeof ruleChain?.submitViolation === "function") {
        const actionRecord = await ruleChain.submitViolation(violationEvent);
        record.actions.push(...cloneValue(actionRecord?.actions ?? []));
        record.ruleChainStatus = actionRecord?.status ?? "unknown";
        record.enforcement = cloneValue(actionRecord?.enforcement ?? null);
      } else {
        emitSquadRuleViolation(core, violationEvent);
        record.actions.push({ type: "violation_queued", reason: "rule_chain_direct_api_unavailable" });
      }
      record.active = false;
      record.resolvedAt = nowIso();
    }

    if (decision.approved) {
      emitTieredSquadTimePassed(core, {
        serverId: record.serverId,
        matchId: record.matchId,
        teamId: record.teamId,
        squadId: record.squadId,
        squadName: record.squadName,
        ...buildClassificationFields(record),
        leaderSteamId: record.creatorSteamId || record.inferredLeader?.steamId,
        leaderName: record.creatorName || record.inferredLeader?.name,
        leaderEosId: record.creatorEosId || record.inferredLeader?.eosId,
        sourceMode: record.sourceMode,
        createdAt: record.createdAt,
        createdAtMs: record.createdAtMs,
        sourceEventId: record.id,
        playtime: cloneValue(record.playtime) ?? null,
      });
      record.actions.push({ type: "tiered_pass_emitted" });
    }

    if ((!record.playtime?.known && runtimeConfig.liveLookupWhenMissing) || (record.isWarmup && !record.playtime?.known && runtimeConfig.liveLookupWhenMissing)) {
      await triggerBackgroundLookup(record);
    }
  }

  function shouldBroadcastViolation(record, decision) {
    if (!runtimeConfig.broadcastOnViolation) return false;
    if (decision.approved) return false;
    if (decision.status === "kick_cooldown") return false;
    return !record.actions.some((action) => action.type === "broadcasted_violation" || action.type === "broadcast_violation_failed");
  }

  function shouldWarn(record, decision) {
    if (decision.status === "missing_playtime") return Boolean(runtimeConfig.warnOnMissingPlaytime);
    return true;
  }

  async function broadcastViolation(record, decision) {
    const adminWarn = getAdminWarnApi();
    const sender = adminWarn?.broadcastMessage ?? adminWarn?.sendAdminBroadcast;
    if (typeof sender !== "function") {
      record.actions.push({
        type: "broadcast_violation_failed",
        result: { error: "admin_warn_unavailable" },
      });
      return;
    }

    const result = await sender.call(adminWarn, {
      message: buildViolationBroadcastMessage(record, decision),
      reason: "stepwise_squad_playtime_violation_broadcast",
      sourceModule: PLUGIN_ID,
      relatedEventId: record.id,
      system: true,
    }).catch((error) => ({ success: false, error: error?.message ?? String(error) }));

    record.actions.push({
      type: result?.success === false ? "broadcast_violation_failed" : "broadcasted_violation",
      result: summarizeActionResult(result),
    });
  }

  async function maybeBroadcastRuleReminder(record = null) {
    const snapshot = core?.webStatus?.getSnapshot?.() ?? {};
    const reminderClockSeconds = positiveInt(record?.clockSeconds ?? snapshot.logClockSeconds, 0);
    if (reminderClockSeconds < RULE_REMINDER_SECONDS) return;

    const hasAnchor = record?.clockHasAnchor != null
      ? Boolean(record.clockHasAnchor)
      : Boolean(snapshot.logClockHasAnchor);
    if (!hasAnchor) return;

    const matchKey = buildRuleReminderKey({
      serverId: record?.serverId ?? snapshot.serverId ?? core?.webStatus?.serverId ?? "",
      anchorLogTime: record?.clockAnchorLogTime ?? snapshot.logClockAnchorLogTime ?? snapshot.logClockLastResetAt ?? "",
      matchId: record?.matchId ?? "",
    });
    if (state.ruleReminderBroadcastKeys.has(matchKey)) return;

    const adminWarn = getAdminWarnApi();
    const sender = adminWarn?.broadcastMessage ?? adminWarn?.sendAdminBroadcast;
    if (typeof sender !== "function") return;

    const result = await sender.call(adminWarn, {
      message: buildRuleReminderMessage(runtimeConfig?.rules),
      reason: "stepwise_squad_playtime_rule_reminder",
      sourceModule: PLUGIN_ID,
      relatedEventId: record?.id ?? `rule-reminder:${matchKey}`,
      system: true,
    }).catch((error) => ({ success: false, error: error?.message ?? String(error) }));

    if (record && Array.isArray(record.actions)) {
      record.actions.push({
        type: result?.success === false ? "rule_reminder_broadcast_failed" : "rule_reminder_broadcasted",
        result: summarizeActionResult(result),
      });
    }

    if (result?.success !== false) {
      state.ruleReminderBroadcastKeys.add(matchKey);
    }
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
      recentLogs: state.recentLogs.map(cloneValue),
      pendingLogCount: state.pendingLogs.size,
      summary: buildSummary(recentRecords),
    };
  }

  function publicSettings() {
    return {
      directory: runtimeConfig.directory,
      broadcastOnApproved: runtimeConfig.broadcastOnApproved,
      broadcastOnViolation: runtimeConfig.broadcastOnViolation,
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
      return await enqueue(() => processCreation(normalizeCreationEvent(event, event.creationSource ?? "LOG", modules, config)));
    },
    async simulateSquadsUpdated(event = {}) {
      await handleSquadsUpdated(event);
      return getStatus();
    },
    _state: state,
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
      core?.webRegistry?.registerPage?.({
        id: "web.stepwiseSquadPlaytimeGuard",
        title: "阶梯式建队时长（已合并至建队规则链）",
        group: "插件",
        route: "/plugins/stepwise-squad-playtime-guard",
        source: PLUGIN_ID,
        description: "兼容旧地址；主入口已合并至 /squad-rule-chain 建队规则链。",
        required: false,
        enabled: true,
        order: 136,
        icon: "SSP",
        hiddenFromSidebar: true,
      });
      if (typeof core?.eventBus?.onModuleEvent === "function") {
        unsubscribers.push(core.eventBus.onModuleEvent(SQUAD_RULE_CHAIN_MODULE_ID, SQUAD_NAME_RULE_PASSED_EVENT, (event) => {
          void handleLifecycleSquadCreated(event);
        }));
      }
      if (!ruleReminderTimer) {
        ruleReminderTimer = setInterval(() => {
          void enqueue(() => maybeBroadcastRuleReminder()).catch((error) => {
            pluginLogger?.warn?.(`[StepwiseSquadPlaytimeGuard] reminder check failed: ${error?.message ?? error}`);
          });
        }, 1000);
      }
      void enqueue(() => maybeBroadcastRuleReminder()).catch((error) => {
        pluginLogger?.warn?.(`[StepwiseSquadPlaytimeGuard] initial reminder check failed: ${error?.message ?? error}`);
      });
      pluginLogger?.info?.("[StepwiseSquadPlaytimeGuard] plugin started.");
    },

    async stop() {
      if (ruleReminderTimer) {
        clearInterval(ruleReminderTimer);
        ruleReminderTimer = null;
      }
      for (const unsubscribe of unsubscribers.splice(0)) {
        try { unsubscribe(); } catch {}
      }
    },
  };
}

function getAdminWarnApi() {
  return modules?.adminWarn?.api ?? modules?.adminWarn ?? null;
}

function readConfig(config) {
  const raw = config?.get?.(CONFIG_KEY, {}) ?? {};
  return {
    enabled: raw.enabled !== false,
    directory: normalizeText(raw.directory) || DEFAULT_DATA_DIR,
    broadcastOnApproved: raw.broadcastOnApproved === true,
    broadcastOnViolation: raw.broadcastOnViolation !== false,
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

function normalizeCreationEvent(event = {}, fallbackSource = "LOG", modules = null, config = null) {
  const creationSource = normalizeText(event.creationSource ?? fallbackSource) || fallbackSource;
  const classified = event.classification?.source
    ? { classification: cloneValue(event.classification), policyRevision: event.classification.policyRevision }
    : resolvePolicyClassification(event.squadName, modules, config);
  const classification = classified?.classification ?? null;
  const squadNature = normalizeText(classification?.nature);
  const squadNatureLabel = normalizeText(classification?.natureLabel ?? classification?.typeLabel);
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
    sourceMode: normalizeSourceMode(event.sourceMode ?? (creationSource === "LOG" ? "live" : creationSource === "RCON_SNAPSHOT" ? "backfill" : "recovery")),
    isLogConfirmed: creationSource === "LOG" || creationSource === "RCON_PROMOTED_TO_LOG",
    classification,
    policyRevision: nullableNumber(classified?.policyRevision ?? classification?.policyRevision),
    squadNature,
    squadNatureLabel,
    squadTypeId: normalizeText(classification?.typeId),
    squadTypeLabel: normalizeText(classification?.typeLabel) || squadNatureLabel,
    squadRuleId: normalizeText(classification?.ruleId),
    effectiveMaxPlayers: nullableNumber(classification?.effectiveMaxPlayers),
    maxPlayersSource: normalizeText(classification?.maxPlayersSource) || "none",
    assetPath: normalizeText(classification?.assetPath),
    classificationMetadata: cloneValue(event.classificationMetadata) ?? {},
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

function buildClassificationFields(record = {}) {
  return {
    classification: cloneValue(record.classification) ?? null,
    policyRevision: nullableNumber(record.policyRevision ?? record.classification?.policyRevision),
    squadType: normalizeText(record.classification?.nature ?? record.squadNature) || "other",
    squadNature: normalizeText(record.classification?.nature ?? record.squadNature) || "other",
    squadTypeId: normalizeText(record.classification?.typeId ?? record.squadTypeId),
    squadTypeLabel: normalizeText(record.classification?.typeLabel ?? record.squadTypeLabel ?? record.squadNatureLabel),
    squadRuleId: normalizeText(record.classification?.ruleId ?? record.squadRuleId),
    effectiveMaxPlayers: nullableNumber(record.classification?.effectiveMaxPlayers ?? record.effectiveMaxPlayers),
    maxPlayersSource: normalizeText(record.classification?.maxPlayersSource ?? record.maxPlayersSource) || "none",
    assetPath: normalizeText(record.classification?.assetPath ?? record.assetPath),
    classificationMetadata: cloneValue(record.classificationMetadata) ?? {},
  };
}

function resolvePolicyClassification(squadName, modules, config) {
  try {
    const api = modules?.squadNamePolicyGuard?.classifySquadName
      ? modules.squadNamePolicyGuard
      : modules?.squadNamePolicyGuard?.api;
    if (typeof api?.classifySquadName === "function") {
      return api.classifySquadName(squadName);
    }
    return classifySquadNameWithPolicy(squadName, config);
  } catch {
    return null;
  }
}

function normalizeRconSquad(squad = {}, context = {}, modules = null, config = null) {
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
  }, "RCON_SNAPSHOT", modules, config);
}

function mergeCreation(existing, event, context) {
  const sourceWasRcon = existing?.creationSource === "RCON_SNAPSHOT" && event.creationSource === "LOG";
  return {
    ...(existing ?? {}),
    ...event,
    id: existing?.id ?? event.id,
    createdAt: existing?.createdAt ?? event.createdAt ?? nowIso(),
    createdAtMs: existing?.createdAtMs ?? event.createdAtMs ?? Date.now(),
    creatorName: event.creatorName || existing?.creatorName || "",
    creatorSteamId: event.creatorSteamId || existing?.creatorSteamId || "",
    creatorEosId: event.creatorEosId || existing?.creatorEosId || "",
    inferredLeader: event.inferredLeader?.name || event.inferredLeader?.steamId || event.inferredLeader?.eosId
      ? event.inferredLeader
      : (existing?.inferredLeader ?? normalizeIdentity({})),
    creationSource: sourceWasRcon ? "RCON_PROMOTED_TO_LOG" : event.creationSource,
    creationConfidence: event.creationSource === "LOG" ? "HIGH" : event.creationConfidence,
    isLogConfirmed: Boolean(event.creationSource === "LOG" || existing?.isLogConfirmed),
    isWarmup: existing ? existing.isWarmup : Boolean(context.warmup),
    clockSeconds: existing ? existing.clockSeconds : Math.max(0, Math.floor(Number(context.clockSeconds ?? 0) || 0)),
    clockAnchorLogTime: existing ? existing.clockAnchorLogTime : context.clockAnchorLogTime,
    clockHasAnchor: existing ? existing.clockHasAnchor : Boolean(context.clockHasAnchor),
    clockManual: existing ? existing.clockManual : Boolean(context.clockManual),
    clockTrusted: existing ? existing.clockTrusted : Boolean(context.clockTrusted),
    actions: Array.isArray(existing?.actions) ? existing.actions.map((action) => ({ ...action })) : [],
    playtime: cloneValue(existing?.playtime) ?? null,
    lookupStartedAt: normalizeText(existing?.lookupStartedAt),
    lookupFinishedAt: normalizeText(existing?.lookupFinishedAt),
    lookupResult: cloneValue(existing?.lookupResult) ?? null,
    lookupError: normalizeText(existing?.lookupError),
  };
}

function shouldStartNewRecordGeneration(existing, event) {
  if (!existing) return false;
  const existingCreatedAtMs = Number(existing.createdAtMs ?? Date.parse(existing.createdAt ?? "")) || 0;
  const nextCreatedAtMs = Number(event.createdAtMs ?? Date.parse(event.createdAt ?? "")) || 0;
  if (event.isLogConfirmed && nextCreatedAtMs > existingCreatedAtMs) {
    return true;
  }
  if (existing.active) return false;
  return nextCreatedAtMs > existingCreatedAtMs;
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

function normalizeSourceMode(value) {
  const textValue = normalizeText(value).toLowerCase();
  if (textValue === "live" || textValue === "recovery" || textValue === "replay" || textValue === "backfill") {
    return textValue;
  }
  return "live";
}

function buildDisbandReason(record, decision) {
  if (decision.status === "missing_playtime") {
    return `阶梯时长守护：在 ${decision.rule?.label ?? "限制窗口"} 缺少游戏时长数据。`;
  }
  return `阶梯时长守护：${record.squadNatureLabel || "当前队伍"} 在 ${decision.rule?.label ?? "限制窗口"} 需要游戏时长大于 ${decision.rule?.minHoursExclusive ?? 0}h。`;
}

function buildWarnMessage(record, decision) {
  if (decision.status === "missing_playtime") {
    return "已处理你建立的小队，正在查询你的游戏时长。";
  }
  return `${record.squadNatureLabel || "当前队伍"} 在 ${decision.rule?.label ?? "限制窗口"} 需要大于 ${decision.rule?.minHoursExclusive ?? 0}h，你当前为 ${record.playtime?.hoursText || "未知h"}。`;
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
    if (record.actions?.some((action) => action.type === "broadcasted" || action.type === "broadcasted_violation")) summary.broadcasts += 1;
    if (record.actions?.some((action) => action.type === "disbanded")) summary.disbands += 1;
    if (record.actions?.some((action) => action.type === "warned")) summary.warns += 1;
    if (record.actions?.some((action) => action.type === "lookup_started") && !record.actions?.some((action) => action.type === "lookup_finished" || action.type === "lookup_failed")) {
      summary.pendingLookups += 1;
    }
  }
  return summary;
}

function buildCreationLogEntry(record = {}, options = {}) {
  const decision = options.decision ?? null;
  const identity = resolveIdentity(record);
  return {
    id: `${normalizeText(record.id) || "sspg"}:${normalizeText(options.stage) || "event"}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
    at: normalizeText(options.at ?? record.updatedAt ?? record.createdAt) || nowIso(),
    stage: normalizeText(options.stage) || "event",
    source: normalizeText(record.creationSource) || "UNKNOWN",
    message: normalizeText(options.message),
    dropReason: normalizeText(options.dropReason),
    serverId: normalizeText(record.serverId),
    matchId: normalizeText(record.matchId),
    teamId: nullableNumber(record.teamId),
    squadId: nullableNumber(record.squadId),
    squadName: normalizeText(record.squadName),
    squadNature: normalizeText(record.squadNature),
    squadNatureLabel: normalizeText(record.squadNatureLabel),
    creatorName: normalizeText(record.creatorName) || identity.name,
    creatorSteamId: normalizeText(record.creatorSteamId) || identity.steamID,
    creatorEosId: normalizeText(record.creatorEosId) || identity.eosID,
    leaderName: normalizeText(record.inferredLeader?.name),
    clockSeconds: positiveInt(record.clockSeconds, 0),
    isWarmup: Boolean(record.isWarmup),
    creationConfidence: normalizeText(record.creationConfidence),
    decision: normalizeText(decision?.status ?? record.decision),
    approved: decision ? Boolean(decision.approved) : Boolean(record.approved),
    violation: decision ? Boolean(decision.violation) : Boolean(record.violation),
    decisionReason: normalizeText(decision?.reason ?? record.decisionReason),
    ruleLabel: normalizeText(decision?.rule?.label),
    ruleMinHoursExclusive: nullableNumber(decision?.rule?.minHoursExclusive),
    playtimeKnown: Boolean(record.playtime?.known),
    playtimeHoursText: normalizeText(record.playtime?.hoursText),
    playtimeSource: normalizeText(record.playtime?.source),
  };
}

function rememberCreationLog(stateRef, entry) {
  const dedupeKey = [
    normalizeText(entry.stage),
    normalizeText(entry.source),
    normalizeText(entry.serverId),
    normalizeText(entry.matchId),
    entry.teamId == null ? "" : String(entry.teamId),
    entry.squadId == null ? "" : String(entry.squadId),
    normalizeSquadName(entry.squadName),
    normalizeText(entry.creatorName),
    normalizeText(entry.message),
    normalizeText(entry.at),
  ].join("|");
  if (stateRef?.recentLogs?.some((item) => item?.dedupeKey === dedupeKey)) {
    return;
  }
  stateRef?.recentLogs?.unshift(cloneValue({ ...entry, dedupeKey }));
  if ((stateRef?.recentLogs?.length ?? 0) > DEFAULT_RECENT_LOG_LIMIT) {
    stateRef.recentLogs.length = DEFAULT_RECENT_LOG_LIMIT;
  }
}

function describeMissingLifecycleFields(event = {}) {
  const missing = [];
  if (!normalizeText(event.serverId)) missing.push("serverId");
  if (event.squadId == null) missing.push("squadId");
  if (event.teamId == null) missing.push("teamId");
  return missing;
}

function createInitialState() {
  return {
    records: [],
    recentLogs: [],
    recordsBySlot: new Map(),
    pendingLogs: new Map(),
    ruleReminderBroadcastKeys: new Set(),
  };
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

function isLiveActionEvent(event = {}) {
  const sourceMode = normalizeSourceMode(event.sourceMode ?? event.SourceMode ?? event.rawEvent?.SourceMode);
  const canTriggerActions = event.canTriggerActions ?? event.CanTriggerActions ?? event.rawEvent?.CanTriggerActions;
  const triggerAllowed = canTriggerActions == null || canTriggerActions === true || String(canTriggerActions).toLowerCase() === "true";
  return sourceMode === "live" && triggerAllowed;
}

function buildRuleReminderKey(record) {
  return [
    normalizeText(record.serverId),
    normalizeText(record.anchorLogTime) || normalizeText(record.matchId) || "no-match",
    String(RULE_REMINDER_SECONDS),
  ].join("|");
}

function buildRuleReminderMessage(rules = {}) {
  const infantryRules = Array.isArray(rules?.infantry) && rules.infantry.length ? rules.infantry : DEFAULT_RULES.infantry;
  const infantryText = infantryRules.map((rule) => `${rule.startSeconds}-${rule.endSeconds}秒 > ${rule.minHoursExclusive}h`).join("，");
  const lastInfantry = infantryRules[infantryRules.length - 1];
  const infantryEnd = lastInfantry ? lastInfantry.endSeconds : 40;

  const vehicleRules = Array.isArray(rules?.vehicle) && rules.vehicle.length ? rules.vehicle : DEFAULT_RULES.vehicle;
  const vehicleText = vehicleRules.map((rule) => `${rule.startSeconds}-${rule.endSeconds}秒 > ${rule.minHoursExclusive}h`).join("，");
  const lastVehicle = vehicleRules[vehicleRules.length - 1];
  const vehicleEnd = lastVehicle ? lastVehicle.endSeconds : 90;

  return `本服设有阶梯式建队时长检测，步兵队 ${infantryText}，${infantryEnd}秒后放开；载具队 ${vehicleText}，${vehicleEnd}秒后放开。`;
}

function buildViolationBroadcastMessage(record, decision) {
  const nature = record.squadNatureLabel || "当前";
  const squadName = record.squadName || "未知小队";
  const creator = record.creatorName || record.identityName || record.inferredLeader?.name || "未知玩家";
  const ruleLabel = decision.rule?.label ?? "限制窗口";
  const hoursText = record.playtime?.hoursText || "未知h";
  if (decision.status === "missing_playtime") {
    return `违规建队已拦截：${creator} 创建的 ${squadName} 在 ${nature} ${ruleLabel} 未查到游戏时长，已按规则解散。`;
  }
  return `违规建队已拦截：${creator} 创建的 ${squadName} 在 ${nature} ${ruleLabel} 仅有 ${hoursText}，已按规则解散。`;
}
