// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";
import {
  SQUAD_RULE_CHAIN_MODULE_ID,
  SQUAD_RULE_SOURCES,
  TIERED_SQUAD_TIME_PASSED_EVENT,
  emitSquadRuleViolation,
} from "../modules/squad-rule-chain/events.js";

const PLUGIN_ID = "plugin.fairSquadGuard";
const PAGE_ROUTE = "/plugins/fair-squad-guard";
const DEFAULT_DATA_DIR = "./data/fair-squad-guard";
const DEFAULT_RECENT_LIMIT = 300;
const DEFAULT_PLAYER_THRESHOLD = 50;
const DEFAULT_NO_CREATE_SECONDS = 20;
const DEFAULT_INFANTRY_ONLY_UNTIL_SECONDS = 50;
const DEFAULT_MAX_VIOLATIONS_BEFORE_KICK = 15;
const DEFAULT_DISBAND_COMMAND_NAME_SUFFIX = "";
const KICK_RETRY_DELAY_MS = 1000;
const KICK_RETRY_COUNT = 3;
const PHASE_POLL_INTERVAL_MS = 1000;

const DEFAULT_INFANTRY_PATTERNS = Object.freeze([
  "^squad\\s*\\d+$",
  "^\\d+$",
  "^inf(?:antry)?(?:\\s*\\d+)?$",
  "^步兵(?:\\s*\\d+)?$",
]);

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger =
    logger
    ?? core?.createLogger?.({ moduleId: PLUGIN_ID, source: PLUGIN_ID, channel: "plugin" })
    ?? core?.logger
    ?? console;

  let runtimeConfig = readConfig(config);
  const dataDir = path.resolve(process.cwd(), runtimeConfig.directory);
  const state = createInitialState();
  const unsubscribers = [];
  let serial = Promise.resolve();

  function enqueue(task) {
    const next = serial.then(task, task);
    serial = next.catch(() => { });
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
    const payload = {
      ...entry,
      persistedAt: nowIso(),
    };
    await fs.appendFile(recordsFilePath(payload.createdAt), `${JSON.stringify(payload)}\n`, "utf8");
  }

  function persistLater(entry) {
    void appendJsonl(entry).catch((error) => {
      pluginLogger?.warn?.(`[FairSquadGuard] persist failed: ${error?.message ?? error}`);
    });
  }

  async function recoverFromLogs() {
    state.recovery.lastRecoveredAt = nowIso();
    state.recovery.recoveredLineCount = 0;

    for (const filePath of recentLogFilePaths()) {
      let text = "";
      try {
        text = await fs.readFile(filePath, "utf8");
      } catch (error) {
        if (error?.code !== "ENOENT") {
          pluginLogger?.warn?.(`[FairSquadGuard] recovery read failed: ${error?.message ?? error}`);
        }
        continue;
      }

      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const entry = JSON.parse(trimmed);
          state.recovery.recoveredLineCount += 1;
          if (entry?.type === "ROUND_RESET") {
            resetSession(entry.reason ?? "recovery", { persist: false, keepLock: true });
          } else if (entry?.type === "DECISION" && entry.record) {
            rememberRecord(entry.record, { persist: false, replay: true });
            replayRecordStats(entry.record);
          } else if (entry?.type === "UNLOCK") {
            state.session.midRoundLocked = false;
            state.session.midRoundLockReason = "";
            state.session.manualUnlockAt = entry.createdAt ?? entry.persistedAt ?? nowIso();
          }
        } catch (error) {
          pluginLogger?.warn?.(`[FairSquadGuard] recovery parse failed: ${error?.message ?? error}`);
        }
      }
    }
  }

  function recentLogFilePaths(baseMs = Date.now()) {
    return [24 * 60 * 60 * 1000, 0]
      .map((offset) => recordsFilePath(new Date(baseMs - offset)))
      .filter((filePath, index, list) => list.indexOf(filePath) === index);
  }

  function getWebStatus() {
    return core?.webStatus?.getSnapshot?.() ?? {
      serverId: core?.webStatus?.serverId ?? "",
      playerCount: 0,
      logClockSeconds: 600,
      logClockHasAnchor: false,
      logClockManual: false,
    };
  }

  function getServerId(value = "") {
    return normalizeText(value || core?.webStatus?.serverId || getWebStatus().serverId || "");
  }

  function getSquadState(serverId = getServerId()) {
    return modules?.squadManagement?.getState?.(serverId) ?? null;
  }

  function getPopulation(serverId = getServerId()) {
    const squadState = getSquadState(serverId);
    const players = Array.isArray(squadState?.players) ? squadState.players : [];
    if (players.length > 0) return { count: players.length, source: "squadManagement.players" };
    const webStatus = getWebStatus();
    return {
      count: Math.max(0, Number(webStatus.playerCount ?? 0) || 0),
      source: "webStatus.playerCount",
    };
  }

  function resolveClockState() {
    const webStatus = getWebStatus();
    const seconds = Math.max(0, Math.floor(Number(webStatus.logClockSeconds ?? 600) || 0));
    const hasAnchor = Boolean(webStatus.logClockHasAnchor);
    const manual = Boolean(webStatus.logClockManual);
    const reason = normalizeText(webStatus.logClockLastResetReason);
    const trusted = hasAnchor && !manual && !state.session.midRoundLocked;
    return {
      seconds,
      hasAnchor,
      manual,
      trusted,
      reason,
      anchorLogTime: normalizeText(webStatus.logClockAnchorLogTime),
      lastResetAt: normalizeText(webStatus.logClockLastResetAt),
    };
  }

  function ensureClockSafety() {
    const clock = resolveClockState();
    if (state.session.manualUnlockAt) return clock;

    if (clock.manual) {
      lockCurrentRound("manual_log_clock");
      return { ...clock, trusted: false };
    }

    if (!clock.hasAnchor) {
      lockCurrentRound("mid_round_start_without_anchor");
      return { ...clock, trusted: false };
    }

    return clock;
  }

  function lockCurrentRound(reason) {
    if (state.session.midRoundLocked && state.session.midRoundLockReason === reason) return;
    state.session.midRoundLocked = true;
    state.session.midRoundLockReason = reason;
    state.session.midRoundLockedAt = nowIso();
    state.session.manualUnlockAt = "";
  }

  function getBroadcastSender() {
    return modules?.adminWarn?.broadcastMessage ?? modules?.adminWarn?.sendAdminBroadcast ?? null;
  }

  async function broadcastMessage(message, reason, meta = {}) {
    const sender = getBroadcastSender();
    const text = normalizeText(message);
    if (!text || typeof sender !== "function") return null;

    try {
      return await sender.call(modules.adminWarn, {
        message: text,
        reason,
        sourceModule: PLUGIN_ID,
        relatedEventId: normalizeText(meta?.relatedEventId),
        system: true,
      });
    } catch (error) {
      pluginLogger?.warn?.(`[FairSquadGuard] broadcast failed: ${error?.message ?? error}`);
      return null;
    }
  }

  function buildRoundMechanismMessage() {
    return `公平建队机制已开启：开局 ${runtimeConfig.noSquadCreationSeconds}s 禁止建队，${runtimeConfig.noSquadCreationSeconds}-${runtimeConfig.infantryOnlyUntilSeconds}s 仅允许步兵队，之后全面放开。`;
  }

  function buildInfantryOnlyMessage() {
    return `步兵队建队区间已开启：${runtimeConfig.noSquadCreationSeconds}-${runtimeConfig.infantryOnlyUntilSeconds}s 仅允许步兵队和白名单队名。`;
  }

  function buildOpenMessage() {
    return "步兵队建队已放开：现在可以创建任意队名。";
  }

  async function maybeBroadcastPhaseChange(meta = {}) {
    if (!isActive()) return;
    if (!state.session.roundAnchor) return;

    const webStatus = getWebStatus();
    const phase = resolvePhase(Number(webStatus.logClockSeconds ?? 0), runtimeConfig).phase;
    const currentPhase = state.session.lastBroadcastPhase || "";
    if (phase === currentPhase) return;

    state.session.lastBroadcastPhase = phase;

    if (phase === "infantry_only") {
      await broadcastMessage(buildInfantryOnlyMessage(), "fair_squad_guard_infantry_only_opened", meta);
    } else if (phase === "open") {
      await broadcastMessage(buildOpenMessage(), "fair_squad_guard_opened", meta);
    }
  }

  function resetSession(reason = "round_reset", options = {}) {
    state.session = {
      ...createInitialState().session,
      lastResetAt: nowIso(),
      lastResetReason: reason,
    };
    state.records = [];
    state.recordsBySlot.clear();
    state.pendingLogs.clear();
    state.seenSlots.clear();
    state.violationPlayers.clear();
    state.summary = createEmptySummary();
    state.session.lastBroadcastPhase = "";
    state.session.mechanismAnnouncementAt = "";
    if (options.keepLock) {
      state.session.midRoundLocked = true;
      state.session.midRoundLockReason = "recovery_startup";
    }
    if (options.persist !== false) {
      persistLater({ type: "ROUND_RESET", createdAt: nowIso(), reason });
    }
  }

  function handleRoundAnchor(event = {}, reason = "round_anchor") {
    return enqueue(async () => {
      resetSession(reason);
      state.session.lastBroadcastPhase = resolvePhase(Number(getWebStatus().logClockSeconds ?? 0), runtimeConfig).phase;
      state.session.roundAnchor = {
        eventName: normalizeText(event.eventName),
        reason,
        rawLog: normalizeText(event.rawLog),
        logTime: normalizeText(event.logTime),
        at: nowIso(),
      };
      state.session.mechanismAnnouncementAt = nowIso();
      await broadcastMessage(buildRoundMechanismMessage(), "fair_squad_guard_round_start", {
        relatedEventId: normalizeText(event?.eventId ?? event?.id),
      });
      pluginLogger?.info?.(`[FairSquadGuard] session reset by ${reason}`);
    });
  }

  function handleLifecycleSquadCreated(event = {}) {
    return enqueue(async () => {
      runtimeConfig = readConfig(config);
      const normalized = normalizeCreationEvent({
        ...event,
        creatorName: event.leaderName ?? event.creatorName,
        creatorSteamId: event.leaderSteamId ?? event.creatorSteamId,
        creatorEosId: event.leaderEosId ?? event.creatorEosId,
      }, "LOG");
      if (!normalized.serverId || normalized.squadId == null) return;
      if (normalized.teamId == null) {
        const pendingKey = buildPendingKey(normalized);
        state.pendingLogs.set(pendingKey, {
          ...normalized,
          pendingKey,
          createdAt: normalized.createdAt || nowIso(),
        });
        return;
      }
      await processCreation(normalized);
    });
  }

  function handleSquadsUpdated(event = {}) {
    return enqueue(async () => {
      runtimeConfig = readConfig(config);
      const serverId = getServerId(event.serverId);
      if (!serverId) return;
      const squads = Array.isArray(event.squads) ? event.squads : [];
      const population = getPopulation(serverId);
      const clock = ensureClockSafety();
      const matchId = normalizeText(event.matchId);
      const currentPresenceKeys = new Set();

      for (const squad of squads) {
        const normalized = normalizeRconSquad(squad, {
          serverId,
          matchId,
          observedAt: normalizeText(event.time) || nowIso(),
        });
        if (!normalized.serverId || normalized.teamId == null || normalized.squadId == null) continue;
        currentPresenceKeys.add(buildPresenceKey(normalized));

        const slotKey = buildSlotKey(normalized);
        const pending = findPendingLog(normalized);
        if (pending) {
          state.pendingLogs.delete(pending.pendingKey);
          await processCreation({
            ...pending,
            teamId: normalized.teamId,
            rconObservedAt: normalized.createdAt,
          });
          continue;
        }

        const existing = state.recordsBySlot.get(slotKey);
        if (existing) {
          const alreadyDisbanded = existing.actions.some((action) => action.type === "disbanded");
          if (existing.violation && existing.active !== false && !alreadyDisbanded) {
            await processCreation(normalized);
          }
        }
      }

      markCurrentSquadPresence({ serverId, matchId, currentPresenceKeys });
    });
  }

  async function processCreation(event) {
    const serverId = getServerId(event.serverId);
    const population = getPopulation(serverId);
    const clock = ensureClockSafety();
    const slotKey = buildSlotKey(event);

    if (!isActive()) {
      state.seenSlots.add(slotKey);
      return null;
    }

    if (population.count < runtimeConfig.enforcementPlayerThreshold) {
      state.seenSlots.add(slotKey);
      return null;
    }

    if (!clock.trusted && !state.session.manualUnlockAt) {
      state.seenSlots.add(slotKey);
      return null;
    }

    const candidate = state.recordsBySlot.get(slotKey);
    const existing = shouldStartNewRecordGeneration(candidate, event) ? null : candidate;
    const merged = mergeCreation(existing, event, clock, population);
    const decision = decideCreation(merged, clock);
    const record = {
      ...merged,
      id: existing?.id ?? makeRecordId(),
      createdAt: existing?.createdAt ?? nowIso(),
      updatedAt: nowIso(),
      phase: decision.phase,
      phaseLabel: decision.phaseLabel,
      approved: decision.approved,
      violation: !decision.approved,
      reasons: decision.reasons,
      clockSeconds: existing ? existing.clockSeconds : clock.seconds,
      clockTrusted: existing ? existing.clockTrusted : Boolean(clock.trusted || state.session.manualUnlockAt),
      population: existing ? existing.population : population.count,
      populationSource: existing ? existing.populationSource : population.source,
      active: existing?.active !== false,
      resolvedAt: existing?.resolvedAt ?? "",
      actions: existing?.actions ? [...existing.actions] : [],
    };

    if (!decision.approved) {
      await applyViolationActions(record);
    } else {
      if (shouldBroadcastApproved(record)) {
        const broadcastResult = await broadcastApproved(record);
        const ok = broadcastResult?.success !== false;
        record.actions.push({
          type: ok ? "broadcasted" : "broadcast_failed",
          result: summarizeActionResult(broadcastResult),
        });
        if (ok) {
          state.summary.broadcasts = (state.summary.broadcasts || 0) + 1;
        }
      }
    }

    rememberRecord(record);
    return record;
  }

  function decideCreation(record, clock) {
    const seconds = Math.max(0, Math.floor(Number(record.clockSeconds ?? clock.seconds ?? 0) || 0));
    if (seconds < runtimeConfig.noSquadCreationSeconds) {
      return {
        approved: false,
        phase: "locked",
        phaseLabel: "0-20s no creation",
        reasons: [`开局 ${runtimeConfig.noSquadCreationSeconds}秒内禁止创建任何形式的小队。`],
      };
    }

    if (seconds < runtimeConfig.infantryOnlyUntilSeconds) {
      const allowed = isAllowedInfantryName(record.squadName, runtimeConfig);
      return {
        approved: allowed,
        phase: "infantry_only",
        phaseLabel: "20-50s infantry only",
        reasons: allowed ? [] : ["当前区间仅允许步兵队创建。"],
      };
    }

    return {
      approved: true,
      phase: "open",
      phaseLabel: "open",
      reasons: [],
    };
  }

  async function applyViolationActions(record) {
    if (!record.actions.some((action) => action.type === "violation_recorded")) {
      state.summary.violations += 1;
      record.actions.push({ type: "violation_recorded" });
    }

    emitSquadRuleViolation(core, {
      serverId: record.serverId,
      matchId: record.matchId,
      teamId: record.teamId,
      squadId: record.squadId,
      squadName: record.squadName,
      squadType: "fair_squad_creation",
      leaderSteamId: record.creatorSteamId,
      leaderName: record.creatorName,
      leaderEosId: record.creatorEosId,
      source: SQUAD_RULE_SOURCES.fairSquadCreation,
      reason: record.reasons.join(" ").trim(),
      createdAt: record.createdAt,
      createdAtMs: record.createdAtMs,
      sourceEventId: record.id,
      warningMessages: record.isLogConfirmed && hasCreatorIdentity(record) ? [`违规建队拦截：${record.reasons.join(" ")}`] : [],
      broadcastMessage: shouldBroadcastViolation(record) ? buildViolationBroadcastMessage(record) : "",
      disbandReason: `公平建队守护：${record.reasons.join(" ")}`.trim(),
      removeLeaderBeforeDisband: true,
    });
    record.actions.push({ type: "violation_emitted" });
    record.active = false;
    record.resolvedAt = nowIso();
    if (record.isLogConfirmed && hasCreatorIdentity(record)) {
      state.summary.warned += 1;
      state.summary.disbanded += 1;
      if (shouldBroadcastViolation(record)) {
        state.summary.broadcasts = (state.summary.broadcasts || 0) + 1;
      }
    }

    const alreadyCounted = record.actions.some((action) => action.type === "violation_counted");
    if (!alreadyCounted && record.isLogConfirmed && hasCreatorIdentity(record)) {
      const playerState = incrementViolationCount(record);
      record.creatorViolationCount = playerState.violations;
      record.actions.push({ type: "violation_counted", count: playerState.violations });
      if (playerState.violations > runtimeConfig.maxViolationCountBeforeKick && !playerState.kicked) {
        const kickResult = await kickCreator(record);
        playerState.kicked = kickResult?.ok !== false;
        playerState.kickedAt = playerState.kicked ? nowIso() : "";
        record.actions.push({
          type: playerState.kicked ? "kicked" : "kick_failed",
          target: record.creatorName || record.creatorSteamId || record.creatorEosId,
          result: summarizeActionResult(kickResult),
        });
        if (playerState.kicked) {
          record.active = false;
          record.resolvedAt = playerState.kickedAt;
        }
        state.summary.kicked += playerState.kicked ? 1 : 0;
      }
    }
  }

  async function warnCreator(record) {
    const sender = modules?.adminWarn?.sendAdminWarn ?? modules?.adminWarn?.warnPlayer;
    if (typeof sender !== "function") return { success: false, skipped: true, skipReason: "admin_warn_unavailable" };
    const targetName = record.creatorName || record.creatorSteamId || record.creatorEosId;
    if (!targetName) return { success: false, skipped: true, skipReason: "target_missing" };
    return await sender.call(modules.adminWarn, {
      targetName,
      targetSteamId: record.creatorSteamId,
      targetEosId: record.creatorEosId,
      message: `违规建队拦截：${record.reasons.join(" ")}`,
      reason: "fair_squad_guard_violation",
      sourceModule: PLUGIN_ID,
      relatedEventId: record.id,
      system: true,
    }).catch((error) => ({ success: false, error: error?.message ?? String(error) }));
  }

  async function sendViolationWarning(record) {
    const sender = modules?.adminWarn?.sendAdminWarn ?? modules?.adminWarn?.warnPlayer;
    if (typeof sender !== "function") return { success: false, skipped: true, skipReason: "admin_warn_unavailable" };
    const targetName = record.creatorName || record.creatorSteamId || record.creatorEosId;
    if (!targetName) return { success: false, skipped: true, skipReason: "target_missing" };
    return await sender.call(modules.adminWarn, {
      targetName,
      targetSteamId: record.creatorSteamId,
      targetEosId: record.creatorEosId,
      message: `违规建队拦截：${record.reasons.join(" ")}`,
      reason: "fair_squad_guard_violation",
      sourceModule: PLUGIN_ID,
      relatedEventId: record.id,
      system: true,
    }).catch((error) => ({ success: false, error: error?.message ?? String(error) }));
  }

  function shouldBroadcastApproved(record) {
    if (!runtimeConfig.broadcastOnApproved) return false;
    return !record.actions.some((action) => action.type === "broadcasted" || action.type === "broadcast_failed");
  }

  function shouldBroadcastViolation(record) {
    if (!runtimeConfig.broadcastOnViolation) return false;
    return !record.actions.some((action) => action.type === "broadcasted_violation" || action.type === "broadcast_violation_failed");
  }

  function buildApprovedBroadcastMessage(record) {
    const creator = record.creatorName || "未知玩家";
    const squadName = record.squadName || `Squad ${record.squadId ?? "?"}`;
    const phase = record.phase;
    if (phase === "infantry_only") {
      return `${creator} 建立小队 ${squadName}，判定通过（在开局仅步兵队阶段）。`;
    } else if (phase === "open") {
      return `${creator} 建立小队 ${squadName}，判定通过（在开放建队阶段）。`;
    }
    return `${creator} 建立小队 ${squadName}，判定通过（在公平建队阶段）。`;
  }

  function buildViolationBroadcastMessage(record) {
    const creator = record.creatorName || "未知玩家";
    const squadName = record.squadName || `Squad ${record.squadId ?? "?"}`;
    const phase = record.phase;
    if (phase === "locked") {
      return `违规建队已拦截：${creator} 创建的 ${squadName} 处于开局禁止建队阶段，已按规则解散。`;
    } else if (phase === "infantry_only") {
      return `违规建队已拦截：${creator} 创建的 ${squadName} 处于开局仅步兵队阶段，已按规则解散。`;
    }
    return `违规建队已拦截：${creator} 创建的 ${squadName} 违反公平建队规则，已按规则解散。`;
  }

  async function broadcastApproved(record) {
    const sender = getBroadcastSender();
    if (typeof sender !== "function") {
      return { success: false, skipped: true, skipReason: "admin_warn_unavailable" };
    }

    const message = buildApprovedBroadcastMessage(record);
    return await sender.call(modules.adminWarn, {
      message,
      reason: "fair_squad_guard_approved_broadcast",
      sourceModule: PLUGIN_ID,
      relatedEventId: record.id,
      system: true,
    }).catch((error) => ({ success: false, error: error?.message ?? String(error) }));
  }

  async function broadcastViolation(record) {
    const sender = getBroadcastSender();
    if (typeof sender !== "function") {
      return { success: false, skipped: true, skipReason: "admin_warn_unavailable" };
    }

    const message = buildViolationBroadcastMessage(record);
    return await sender.call(modules.adminWarn, {
      message,
      reason: "fair_squad_guard_violation_broadcast",
      sourceModule: PLUGIN_ID,
      relatedEventId: record.id,
      system: true,
    }).catch((error) => ({ success: false, error: error?.message ?? String(error) }));
  }

  async function disbandSquad(record) {
    const api = modules?.squadManagement;
    const request = {
      serverId: record.serverId,
      teamId: record.teamId,
      squadId: record.squadId,
      reason: `公平建队守护：${record.reasons.join(" ")}`,
      source: PLUGIN_ID,
      system: true,
      operatorName: PLUGIN_ID,
      commandNameSuffix: runtimeConfig.disbandCommandNameSuffix,
      squadName: record.squadName,
      teamName: record.factionName,
      creatorName: record.creatorName,
      creatorSteamId: record.creatorSteamId,
      creatorEosId: record.creatorEosId,
      allowRefresh: false,
      allowUnverifiedTarget: true,
      priority: "high",
      bypassRateLimit: true,
      rconChannel: "disband",
    };
    if (typeof api?.requestDisband === "function") return await api.requestDisband(request);
    if (typeof api?.disband === "function") return await api.disband(request);
    if (typeof api?.executeAction === "function") {
      return await api.executeAction({ ...request, type: "disband_squad" });
    }
    return { ok: false, error: "squad_management_unavailable" };
  }

  async function removeCreatorFromSquad(record) {
    const api = modules?.squadManagement;
    if (!record.creatorName && !record.creatorSteamId && !record.creatorEosId) {
      return { ok: false, skipped: true, skipReason: "target_missing" };
    }

    const request = {
      serverId: record.serverId,
      name: record.creatorName,
      steamId: record.creatorSteamId,
      eosId: record.creatorEosId,
      reason: `公平建队守护：解散前移出队长 ${record.reasons.join(" ")}`.trim(),
      source: PLUGIN_ID,
      system: true,
      operatorName: PLUGIN_ID,
    };
    if (typeof api?.requestRemoveFromSquad === "function") return await api.requestRemoveFromSquad(request);
    if (typeof api?.removeFromSquad === "function") return await api.removeFromSquad(request);
    if (typeof api?.executeAction === "function") {
      return await api.executeAction({ ...request, type: "remove_from_squad" });
    }
    return { ok: false, error: "squad_management_unavailable" };
  }

  async function kickCreator(record) {
    const api = modules?.squadManagement;
    const request = {
      serverId: record.serverId,
      steamId: record.creatorSteamId,
      eosId: record.creatorEosId,
      name: record.creatorName,
      reason: `公平建队守护：本局累计违规建队超过 ${runtimeConfig.maxViolationCountBeforeKick} 次。`,
      source: PLUGIN_ID,
      system: true,
      operatorName: PLUGIN_ID,
    };
    return await executeKickBurst(record, request, api, modules);
  }

  function rememberRecord(record, options = {}) {
    const slotKey = buildSlotKey(record);
    const existingIndex = state.records.findIndex((item) => item.id === record.id || (buildSlotKey(item) === slotKey && item.active !== false));
    const normalized = cloneRecord(record);
    state.recordsBySlot.set(slotKey, normalized);
    state.seenSlots.add(slotKey);
    if (existingIndex >= 0) {
      state.records.splice(existingIndex, 1, normalized);
    } else {
      state.records.push(normalized);
      state.summary.total += 1;
    }
    state.records = state.records
      .sort((left, right) => String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)))
      .slice(0, runtimeConfig.maxRecentRecords);

    if (existingIndex < 0 && normalized.approved && !options.replay) state.summary.approved += 1;
    state.lastRecordAt = normalized.updatedAt;

    if (options.persist !== false) {
      persistLater({ type: "DECISION", createdAt: normalized.createdAt, record: normalized });
    }
  }

  function replayRecordStats(record) {
    if (record?.approved) state.summary.approved += 1;
    if (record?.violation) state.summary.violations += 1;
    const actions = Array.isArray(record?.actions) ? record.actions : [];
    if (actions.some((action) => action.type === "warned")) state.summary.warned += 1;
    if (actions.some((action) => action.type === "disbanded")) state.summary.disbanded += 1;
    if (actions.some((action) => action.type === "kicked")) state.summary.kicked += 1;
    if (actions.some((action) => action.type === "broadcasted" || action.type === "broadcasted_violation")) {
      state.summary.broadcasts = (state.summary.broadcasts || 0) + 1;
    }

    if (!record?.isLogConfirmed || !hasCreatorIdentity(record)) return;
    const countAction = [...actions].reverse().find((action) => action.type === "violation_counted");
    const count = Math.max(0, Number(countAction?.count ?? 0) || 0);
    if (count <= 0) return;

    const key = buildCreatorKey(record);
    const current = state.violationPlayers.get(key) ?? {
      key,
      name: record.creatorName,
      steamId: record.creatorSteamId,
      eosId: record.creatorEosId,
      violations: 0,
      kicked: false,
      kickedAt: "",
      lastSquadName: "",
      lastViolationAt: "",
    };
    current.violations = Math.max(current.violations, count);
    current.kicked = current.kicked || actions.some((action) => action.type === "kicked");
    current.kickedAt = current.kickedAt || (current.kicked ? record.updatedAt ?? record.createdAt ?? "" : "");
    current.lastSquadName = record.squadName || current.lastSquadName;
    current.lastViolationAt = record.updatedAt || record.createdAt || current.lastViolationAt;
    state.violationPlayers.set(key, current);
  }

  function incrementViolationCount(record) {
    const key = buildCreatorKey(record);
    const current = state.violationPlayers.get(key) ?? {
      key,
      name: record.creatorName,
      steamId: record.creatorSteamId,
      eosId: record.creatorEosId,
      violations: 0,
      kicked: false,
      kickedAt: "",
      lastSquadName: "",
      lastViolationAt: "",
    };
    current.name = record.creatorName || current.name;
    current.steamId = record.creatorSteamId || current.steamId;
    current.eosId = record.creatorEosId || current.eosId;
    current.violations += 1;
    current.lastSquadName = record.squadName;
    current.lastViolationAt = nowIso();
    state.violationPlayers.set(key, current);
    return current;
  }

  function getStatus() {
    runtimeConfig = readConfig(config);
    const serverId = getServerId();
    const population = getPopulation(serverId);
    const clock = resolveClockState();
    const phase = resolvePhase(clock.seconds, runtimeConfig);
    return {
      pluginId: PLUGIN_ID,
      enabled: Boolean(runtimeConfig.enabled),
      subscribed: isSubscribed(),
      active: isActive(),
      serverId,
      settings: publicSettings(),
      population,
      clock,
      phase,
      session: { ...state.session },
      summary: { ...state.summary },
      recentRecords: state.records.map(cloneRecord),
      currentViolatingSquads: getCurrentViolatingSquads(),
      leaderboard: getLeaderboard(),
      pendingLogCount: state.pendingLogs.size,
      seenSlotCount: state.seenSlots.size,
      recovery: { ...state.recovery },
      dataDir,
      lastRecordAt: state.lastRecordAt,
    };
  }

  function listRecords(query = {}) {
    const limit = Math.max(1, Math.min(1000, Number(query.limit ?? 300) || 300));
    const offset = Math.max(0, Number(query.offset ?? 0) || 0);
    const records = state.records.map(cloneRecord);
    return {
      total: records.length,
      limit,
      offset,
      records: records.slice(offset, offset + limit),
    };
  }

  function unlockCurrentRound(meta = {}) {
    state.session.midRoundLocked = false;
    state.session.midRoundLockReason = "";
    state.session.manualUnlockAt = nowIso();
    state.session.manualUnlockBy = normalizeText(meta.by ?? meta.actor?.username ?? meta.actor?.name);
    persistLater({
      type: "UNLOCK",
      createdAt: state.session.manualUnlockAt,
      by: state.session.manualUnlockBy,
      reason: normalizeText(meta.reason ?? "manual_unlock"),
    });
    return getStatus();
  }

  function publicSettings() {
    return {
      enforcementPlayerThreshold: runtimeConfig.enforcementPlayerThreshold,
      noSquadCreationSeconds: runtimeConfig.noSquadCreationSeconds,
      infantryOnlyUntilSeconds: runtimeConfig.infantryOnlyUntilSeconds,
      maxViolationCountBeforeKick: runtimeConfig.maxViolationCountBeforeKick,
      allowedInfantryNames: [...runtimeConfig.allowedInfantryNames],
      allowedInfantryPatterns: [...runtimeConfig.allowedInfantryPatterns],
      defaultInfantryPatterns: [...DEFAULT_INFANTRY_PATTERNS],
      maxRecentRecords: runtimeConfig.maxRecentRecords,
      disbandCommandNameSuffix: runtimeConfig.disbandCommandNameSuffix,
      broadcastOnApproved: runtimeConfig.broadcastOnApproved,
      broadcastOnViolation: runtimeConfig.broadcastOnViolation,
    };
  }

  function getCurrentViolatingSquads() {
    return state.records
      .filter((record) => record.violation && record.active !== false)
      .map(cloneRecord);
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
      const nextActive = isPresent;
      if (record.active === nextActive) continue;

      record.active = nextActive;
      record.updatedAt = updatedAt;
      if (nextActive) {
        record.resolvedAt = "";
      } else {
        record.resolvedAt = updatedAt;
      }

      const slotKey = buildSlotKey(record);
      if (state.recordsBySlot.has(slotKey)) {
        state.recordsBySlot.set(slotKey, cloneRecord(record));
      }
    }
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

  function getLeaderboard() {
    return [...state.violationPlayers.values()]
      .map((item) => ({ ...item }))
      .sort((left, right) => {
        if (right.violations !== left.violations) return right.violations - left.violations;
        return String(right.lastViolationAt).localeCompare(String(left.lastViolationAt));
      });
  }

  const api = {
    getStatus,
    getState: getStatus,
    listRecords,
    unlockCurrentRound,
    resetSession(reason = "manual_reset") {
      resetSession(reason);
      return getStatus();
    },
    async simulateCreation(event = {}) {
      return await enqueue(() => processCreation(normalizeCreationEvent(event)));
    },
    async simulateSquadsUpdated(event = {}) {
      await handleSquadsUpdated(event);
      return getStatus();
    },
  };

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "Fair Squad Guard",
      kind: "plugin",
      version: "1.0.0",
      description: "Controls early-round squad creation using log-clock windows and RCON/log squad creation detection.",
      category: "Moderation",
    },
    apiName: "fairSquadGuard",
    api,

    async init() {
      await recoverFromLogs();
    },

    async start() {
      runtimeConfig = readConfig(config);

      core?.webRegistry?.registerPage?.({
        id: "web.fairSquadGuard",
        title: "公平建队",
        group: "插件",
        route: PAGE_ROUTE,
        pageModule: "/pages/fair-squad-guard.js",
        source: PLUGIN_ID,
        description: "开局建队窗口、违规解散与建队违规排行榜。",
        required: false,
        enabled: true,
        order: 132,
        icon: "FSG",
      });

      ensureClockSafety();

      if (typeof core?.eventBus?.onModuleEvent === "function") {
        unsubscribers.push(core.eventBus.onModuleEvent(SQUAD_RULE_CHAIN_MODULE_ID, TIERED_SQUAD_TIME_PASSED_EVENT, handleLifecycleSquadCreated));
        unsubscribers.push(core.eventBus.onModuleEvent("module.matchState", "squadsUpdated", handleSquadsUpdated));
      }

      if (typeof core?.eventBus?.onCoreEvent === "function") {
        unsubscribers.push(core.eventBus.onCoreEvent("round.world_bring_up", (event) => {
          void handleRoundAnchor(event, "world_bring_up");
        }));
        unsubscribers.push(core.eventBus.onCoreEvent("On_RawLogLine", (event) => {
          const raw = normalizeText(event?.rawLog ?? event?.rawEvent?.Raw);
          if (/LogWorld:\s+SeamlessTravel to:/i.test(raw)) {
            void handleRoundAnchor(event, "seamless_travel");
          }
        }));
      }

      const phaseTimer = setInterval(() => {
        void maybeBroadcastPhaseChange();
      }, PHASE_POLL_INTERVAL_MS);
      unsubscribers.push(() => clearInterval(phaseTimer));

      pluginLogger?.info?.("[FairSquadGuard] plugin started.");
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try { unsubscribe(); } catch { }
      }
    },
  };
}

function readConfig(config) {
  const raw = config?.get?.("plugins.fairSquadGuard", {}) ?? {};
  return {
    enabled: raw.enabled !== false,
    directory: normalizeText(raw.directory) || DEFAULT_DATA_DIR,
    enforcementPlayerThreshold: positiveInt(raw.enforcementPlayerThreshold, DEFAULT_PLAYER_THRESHOLD),
    noSquadCreationSeconds: positiveInt(raw.noSquadCreationSeconds, DEFAULT_NO_CREATE_SECONDS),
    infantryOnlyUntilSeconds: positiveInt(raw.infantryOnlyUntilSeconds, DEFAULT_INFANTRY_ONLY_UNTIL_SECONDS),
    maxViolationCountBeforeKick: positiveInt(raw.maxViolationCountBeforeKick, DEFAULT_MAX_VIOLATIONS_BEFORE_KICK),
    maxRecentRecords: positiveInt(raw.maxRecentRecords, DEFAULT_RECENT_LIMIT),
    disbandCommandNameSuffix: normalizeText(raw.disbandCommandNameSuffix ?? DEFAULT_DISBAND_COMMAND_NAME_SUFFIX),
    allowedInfantryNames: parseListText(raw.allowedInfantryNamesText ?? raw.allowedInfantryNames),
    allowedInfantryPatterns: parseListText(raw.allowedInfantryPatternsText ?? raw.allowedInfantryNamePatterns),
    broadcastOnApproved: raw.broadcastOnApproved !== false,
    broadcastOnViolation: raw.broadcastOnViolation !== false,
  };
}

function createInitialState() {
  return {
    session: {
      midRoundLocked: false,
      midRoundLockReason: "",
      midRoundLockedAt: "",
      manualUnlockAt: "",
      manualUnlockBy: "",
      lastResetAt: "",
      lastResetReason: "",
      roundAnchor: null,
      lastBroadcastPhase: "",
      mechanismAnnouncementAt: "",
    },
    summary: createEmptySummary(),
    records: [],
    recordsBySlot: new Map(),
    pendingLogs: new Map(),
    seenSlots: new Set(),
    violationPlayers: new Map(),
    recovery: {
      lastRecoveredAt: "",
      recoveredLineCount: 0,
    },
    lastRecordAt: "",
  };
}

function createEmptySummary() {
  return {
    total: 0,
    approved: 0,
    violations: 0,
    warned: 0,
    disbanded: 0,
    kicked: 0,
    broadcasts: 0,
  };
}

function normalizeCreationEvent(event = {}) {
  return {
    serverId: normalizeText(event.serverId),
    matchId: normalizeText(event.matchId),
    teamId: nullableNumber(event.teamId ?? event.teamID),
    squadId: nullableNumber(event.squadId ?? event.squadID),
    squadName: normalizeText(event.squadName),
    factionName: normalizeText(event.factionName ?? event.teamName),
    creatorName: normalizeText(event.creatorName ?? event.playerName),
    creatorSteamId: normalizeText(event.creatorSteamId ?? event.creatorSteamID ?? event.steamId ?? event.steamID),
    creatorEosId: normalizeText(event.creatorEosId ?? event.creatorEOSID ?? event.eosId ?? event.eosID),
    rawLog: normalizeText(event.rawLog ?? event.raw),
    createdAt: normalizeText(event.createdAt ?? event.time) || nowIso(),
    createdAtMs: Number(event.createdAtMs ?? event.timeMs ?? Date.parse(event.createdAt ?? event.time)) || Date.now(),
    sourceEventId: normalizeText(event.sourceEventId ?? event.eventId),
    creationSource: "LOG",
    creationConfidence: "HIGH",
    isLogConfirmed: true,
  };
}

function normalizeRconSquad(squad = {}, context = {}) {
  return {
    serverId: normalizeText(squad.serverId ?? context.serverId),
    matchId: normalizeText(squad.matchId ?? context.matchId),
    teamId: nullableNumber(squad.teamId ?? squad.teamID),
    squadId: nullableNumber(squad.squadId ?? squad.squadID),
    squadName: normalizeText(squad.squadName ?? squad.name),
    factionName: normalizeText(squad.teamName ?? squad.factionName),
    creatorName: "",
    creatorSteamId: "",
    creatorEosId: "",
    rawLog: normalizeText(squad.raw),
    createdAt: normalizeText(squad.createdAt ?? context.observedAt) || nowIso(),
    createdAtMs: Number(squad.createdAtMs ?? Date.parse(squad.createdAt ?? context.observedAt)) || Date.now(),
    sourceEventId: normalizeText(squad.recordKey ?? squad.lifecycleKey),
  };
}

function mergeCreation(existing, event, clock, population) {
  return {
    ...(existing ?? {}),
    ...event,
    id: existing?.id ?? event.id ?? makeRecordId(),
    createdAt: existing?.createdAt ?? event.createdAt ?? nowIso(),
    createdAtMs: existing?.createdAtMs ?? event.createdAtMs ?? Date.now(),
    creatorName: event.creatorName || existing?.creatorName || "",
    creatorSteamId: event.creatorSteamId || existing?.creatorSteamId || "",
    creatorEosId: event.creatorEosId || existing?.creatorEosId || "",
    creationSource: "LOG",
    creationConfidence: "HIGH",
    isLogConfirmed: true,
    clockSeconds: existing ? existing.clockSeconds : clock.seconds,
    population: existing ? existing.population : population.count,
  };
}

function shouldStartNewRecordGeneration(existing, event) {
  if (!existing || existing.active !== false) return false;
  const existingCreatedAtMs = Number(existing.createdAtMs ?? Date.parse(existing.createdAt ?? "")) || 0;
  const nextCreatedAtMs = Number(event.createdAtMs ?? Date.parse(event.createdAt ?? "")) || 0;
  return nextCreatedAtMs > existingCreatedAtMs;
}

function isAllowedInfantryName(squadName, runtimeConfig) {
  const normalized = normalizeSquadName(squadName);
  if (!normalized) return false;
  const allowedNames = Array.isArray(runtimeConfig?.allowedInfantryNames) ? runtimeConfig.allowedInfantryNames : [];
  const allowedPatterns = Array.isArray(runtimeConfig?.allowedInfantryPatterns) ? runtimeConfig.allowedInfantryPatterns : [];
  return allowedNames.some((name) => normalizeSquadName(name) === normalized)
    || [...DEFAULT_INFANTRY_PATTERNS, ...allowedPatterns].some((pattern) => safeTest(pattern, squadName));
}

function parseListText(value) {
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
  return String(value ?? "")
    .split(/\r?\n|,/)
    .map(normalizeText)
    .filter(Boolean);
}

function resolvePhase(seconds, runtimeConfig = {}) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds ?? 0) || 0));
  const noCreate = positiveInt(runtimeConfig.noSquadCreationSeconds, DEFAULT_NO_CREATE_SECONDS);
  const infantryUntil = positiveInt(runtimeConfig.infantryOnlyUntilSeconds, DEFAULT_INFANTRY_ONLY_UNTIL_SECONDS);
  if (safeSeconds < noCreate) return { phase: "locked", label: `${noCreate}s no creation` };
  if (safeSeconds < infantryUntil) return { phase: "infantry_only", label: `${noCreate}-${infantryUntil}s infantry only` };
  return { phase: "open", label: "open" };
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

function buildCreatorKey(record) {
  if (record.creatorSteamId) return `steam:${record.creatorSteamId}`;
  if (record.creatorEosId) return `eos:${record.creatorEosId}`;
  if (record.creatorName) return `name:${normalizeSquadName(record.creatorName)}`;
  return "unknown";
}

function hasCreatorIdentity(record) {
  return Boolean(record.creatorName || record.creatorSteamId || record.creatorEosId);
}

function safeTest(pattern, value) {
  try {
    return new RegExp(pattern, "i").test(String(value ?? ""));
  } catch {
    return false;
  }
}

function summarizeActionResult(result) {
  if (!result || typeof result !== "object") return result ?? null;
  return {
    ok: result.ok ?? result.success ?? null,
    skipped: result.skipped ?? false,
    error: result.error ?? result.errorMessage ?? result.skipReason ?? "",
    message: result.message ?? "",
    command: result.command ?? result.commandText ?? "",
  };
}

function cloneRecord(record) {
  return JSON.parse(JSON.stringify(record));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeKickBurst(record, request, api, modulesRef) {
  if (!api) return { ok: false, error: "squad_management_unavailable", attempts: [] };
  const attempts = [];
  for (let index = 0; index < KICK_RETRY_COUNT; index += 1) {
    await showKickNotice(record, index + 1, modulesRef);
    const result = await executeSingleKick(api, request);
    attempts.push({
      attempt: index + 1,
      ok: result?.ok !== false,
      error: result?.error ?? "",
      message: result?.message ?? "",
    });
    if (result?.ok !== false) {
      // Successful kick; stop further attempts to avoid duplicate kicks
      break;
    }
    if (index < KICK_RETRY_COUNT - 1) {
      await sleep(KICK_RETRY_DELAY_MS);
    }
  }
  const success = attempts.some((item) => item.ok);
  return {
    ok: success,
    error: success ? "" : (attempts[attempts.length - 1]?.error ?? "kick_failed"),
    message: success ? "Kick burst executed." : (attempts[attempts.length - 1]?.message ?? ""),
    attempts,
  };
}

async function executeSingleKick(api, request) {
  if (typeof api?.requestKick === "function") return await api.requestKick(request);
  if (typeof api?.kick === "function") return await api.kick(request);
  if (typeof api?.executeAction === "function") {
    return await api.executeAction({ ...request, type: "kick_player" });
  }
  return { ok: false, error: "squad_management_unavailable" };
}

async function showKickNotice(record, attempt, modulesRef) {
  const sender = modulesRef?.adminWarn?.sendAdminWarn ?? modulesRef?.adminWarn?.warnPlayer;
  if (typeof sender !== "function") return { success: false, skipped: true, skipReason: "admin_warn_unavailable" };
  const targetName = record.creatorName || record.creatorSteamId || record.creatorEosId;
  if (!targetName) return { success: false, skipped: true, skipReason: "target_missing" };
  return await sender.call(modulesRef.adminWarn, {
    targetName,
    targetSteamId: record.creatorSteamId,
    targetEosId: record.creatorEosId,
    message: "kick",
    reason: `fair_squad_guard_kick_attempt_${attempt}`,
    sourceModule: PLUGIN_ID,
    relatedEventId: record.id,
    system: true,
  }).catch((error) => ({ success: false, error: error?.message ?? String(error) }));
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeSquadName(value) {
  return normalizeText(value).replace(/\s+/g, " ").toLowerCase();
}

function nullableNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveInt(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function nowIso() {
  return new Date().toISOString();
}

function makeRecordId() {
  return `fair-squad-guard:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

export default { createPlugin };
