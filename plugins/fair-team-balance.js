// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const PLUGIN_ID = "plugin.fairTeamBalance";
const DEFAULT_DATA_DIR = "./data/fair-team-balance";
const DEFAULT_PUBLIC_TB_LIMIT = 5;
const DEFAULT_PERIOD_TB_LIMIT = 2;
const DEFAULT_PERIOD_SQTB_CLAIM_LIMIT = 1;
const DEFAULT_PERIOD_MS = 18 * 60 * 60 * 1000;
const DEFAULT_REQUEST_TTL_MS = 120 * 1000;
const EXPIRY_SWEEP_MS = 1000;
const PAGE_ROUTE = "/plugins/fair-team-balance";
const CLAIM_MESSAGE_PATTERN = /^认领(\d{5})$/;

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger =
    logger
    ?? core?.createLogger?.({
      moduleId: PLUGIN_ID,
      source: PLUGIN_ID,
      channel: "module",
    })
    ?? core?.logger
    ?? console;

  const runtimeConfig = readConfig(config);
  const dataDir = path.resolve(process.cwd(), runtimeConfig.directory);
  const state = createInitialState(runtimeConfig);
  const unsubscribers = [];
  let expiryTimer = null;
  let serial = Promise.resolve();

  function enqueue(task) {
    const next = Promise.resolve().then(task);
    serial = next.catch(() => {});
    return next;
  }

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false
      && core?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false;
  }

  function isActive() {
    return Boolean(state.enabled) && isSubscribed();
  }

  function getServerId(value = "") {
    return String(value || core?.webStatus?.serverId || "").trim();
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function getCurrentWebStatus() {
    return core?.webStatus?.getSnapshot?.() ?? {
      isWarmup: false,
      logClockSeconds: 0,
    };
  }

  function getCurrentMatchState(serverId = "") {
    return modules?.squadManagement?.getState?.(serverId || getServerId()) ?? null;
  }

  function getBroadcaster() {
    return modules?.adminWarn?.sendAdminBroadcast ?? modules?.adminWarn?.broadcastMessage ?? null;
  }

  function getWarner() {
    return modules?.adminWarn?.sendAdminWarn ?? modules?.adminWarn?.warnPlayer ?? null;
  }

  async function broadcastMessage(message, reason, meta = {}) {
    const broadcaster = getBroadcaster();
    const text = normalizeText(message);
    if (!text || typeof broadcaster !== "function") return null;

    try {
      return await broadcaster({
        message: text,
        reason,
        sourceModule: PLUGIN_ID,
        relatedEventId: normalizeText(meta?.relatedEventId),
        system: true,
      });
    } catch (error) {
      pluginLogger?.warn?.(`[FairTB] broadcast failed: ${error?.message ?? error}`);
      return null;
    }
  }

  async function warnPlayer(player, message, reason, meta = {}) {
    const warner = getWarner();
    const text = normalizeText(message);
    const targetName = normalizeText(player?.playerName ?? player?.name);
    if (!text || !targetName || typeof warner !== "function") return null;

    try {
      return await warner({
        targetName,
        targetSteamId: normalizeText(player?.steamId ?? player?.steamID),
        targetEosId: normalizeText(player?.eosId ?? player?.eosID),
        message: text,
        reason,
        sourceModule: PLUGIN_ID,
        relatedEventId: normalizeText(meta?.relatedEventId),
        system: true,
      });
    } catch (error) {
      pluginLogger?.warn?.(`[FairTB] warnPlayer failed: ${error?.message ?? error}`);
      return null;
    }
  }

  function buildQuotaBroadcastMessage({ playerName = "", mode = "tb" } = {}) {
    const safePlayerName = normalizeText(playerName) || "unknown";
    const actionLabel = mode === "claim_sqtb"
      ? "公平跳边认领完成"
      : mode === "admin_sqtb"
        ? "管理员协助跳边成功"
        : "公平跳边执行成功";
    return `${actionLabel}: ${safePlayerName}，公共TB剩余 ${state.round.publicTbRemaining}/${runtimeConfig.publicTbLimit}`;
  }

  function getOnlinePlayerSnapshot(serverId = "", event = {}) {
    const matchState = getCurrentMatchState(serverId);
    const players = Array.isArray(matchState?.players) ? matchState.players : [];
    if (!players.length) {
      return {
        matchState,
        player: null,
      };
    }

    const steamId = normalizeText(event?.steamId ?? event?.steamID ?? event?.steamid);
    const eosId = normalizeText(event?.eosId ?? event?.eosID ?? event?.eosid);
    const playerName = normalizeText(event?.playerName ?? event?.name ?? event?.player_name);
    const playerKey = buildPlayerKey({
      steamId,
      eosId,
      playerName,
    });

    const player = players.find((entry) => {
      if (steamId && normalizeText(entry?.steamId ?? entry?.steamID) === steamId) return true;
      if (eosId && normalizeText(entry?.eosId ?? entry?.eosID) === eosId) return true;
      if (playerName && normalizeText(entry?.name) === playerName) return true;
      return buildPlayerKey({
        steamId: entry?.steamId ?? entry?.steamID,
        eosId: entry?.eosId ?? entry?.eosID,
        playerName: entry?.name,
      }) === playerKey;
    }) ?? null;

    return {
      matchState,
      player,
    };
  }

  async function ensureDataDir() {
    await fs.mkdir(dataDir, { recursive: true });
  }

  function getDateParts(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
    const year = safeDate.getFullYear();
    const month = String(safeDate.getMonth() + 1).padStart(2, "0");
    const day = String(safeDate.getDate()).padStart(2, "0");
    return {
      date: safeDate,
      dateKey: `${year}-${month}-${day}`,
    };
  }

  function resolveLogFilePath(value = new Date()) {
    const { dateKey } = getDateParts(value);
    return path.join(dataDir, `${dateKey}.jsonl`);
  }

  async function appendLog(event) {
    const entry = {
      ...event,
      at: normalizeText(event?.at) || nowIso(),
    };
    await ensureDataDir();
    await fs.appendFile(resolveLogFilePath(entry.at), `${JSON.stringify(entry)}\n`, "utf8");
  }

  function getReplayFilePaths(baseTime = Date.now()) {
    const files = [];
    for (const offset of [24 * 60 * 60 * 1000, 0]) {
      files.push(resolveLogFilePath(new Date(baseTime - offset)));
    }
    return [...new Set(files)];
  }

  async function recoverFromLogs() {
    const startedAt = Date.now();
    const files = getReplayFilePaths(startedAt);
    const entries = [];

    for (const filePath of files) {
      try {
        const text = await fs.readFile(filePath, "utf8");
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            entries.push(JSON.parse(trimmed));
          } catch (error) {
            pluginLogger?.warn?.(`[FairTB] Failed to parse recovery line in ${filePath}: ${error?.message ?? error}`);
          }
        }
      } catch (error) {
        if (error?.code !== "ENOENT") {
          pluginLogger?.warn?.(`[FairTB] Failed to read recovery log ${filePath}: ${error?.message ?? error}`);
        }
      }
    }

    entries.sort((left, right) => {
      const leftMs = Date.parse(String(left?.at ?? left?.time ?? "")) || 0;
      const rightMs = Date.parse(String(right?.at ?? right?.time ?? "")) || 0;
      return leftMs - rightMs;
    });

    let hasRoundReset = false;
    for (const entry of entries) {
      replayLogEntry(entry, startedAt, (seenRoundReset) => {
        hasRoundReset = hasRoundReset || Boolean(seenRoundReset);
      });
    }

    if (!hasRoundReset) {
      state.round.publicTbRemaining = runtimeConfig.publicTbLimit;
      state.round.usedPlayerKeys.clear();
    }

    expireRequests({ now: startedAt, persist: false });
    state.recovery.lastRecoveredAt = nowIso();
    state.recovery.recoveredLineCount = entries.length;
  }

  function replayLogEntry(entry, baseNow = Date.now(), onRoundReset = null) {
    const type = normalizeText(entry?.type);
    const at = normalizeText(entry?.at ?? entry?.time) || new Date(baseNow).toISOString();
    const atMs = Date.parse(at) || baseNow;

    if (type === "ROUND_RESET") {
      state.round.publicTbRemaining = runtimeConfig.publicTbLimit;
      state.round.usedPlayerKeys.clear();
      state.round.lastResetAt = at;
      state.round.lastResetReason = normalizeText(entry?.reason ?? "replay");
      onRoundReset?.(true);
      return;
    }

    if (type === "PERIOD_RESET") {
      const playerKey = normalizeText(entry?.playerKey);
      if (!playerKey) return;
      state.periods.set(playerKey, {
        playerKey,
        playerName: normalizeText(entry?.playerName),
        steamId: normalizeText(entry?.steamId),
        eosId: normalizeText(entry?.eosId),
        periodStartedAt: at,
        periodStartedAtMs: atMs,
        lastActivityAt: "",
        lastActivityAtMs: 0,
        tbUsed: 0,
        sqtbClaimUsed: 0,
      });
      return;
    }

    if (type === "TB_EXECUTED") {
      const playerKey = normalizeText(entry?.playerKey);
      if (!playerKey) return;
      const period = ensurePeriod(playerKey, {
        nowMs: atMs,
        playerName: entry?.playerName,
        steamId: entry?.steamId,
        eosId: entry?.eosId,
        persistReset: false,
      });
      period.tbUsed += 1;
      period.lastActivityAt = at;
      period.lastActivityAtMs = atMs;
      state.round.publicTbRemaining = clampInteger(
        Number(entry?.roundPublicTbRemainingAfter ?? state.round.publicTbRemaining - 1),
        0,
        runtimeConfig.publicTbLimit,
      );
      state.round.usedPlayerKeys.add(playerKey);
      return;
    }

    if (type === "SQTB_CREATED") {
      const request = normalizeRecoveredRequest(entry, atMs);
      if (!request) return;
      state.requests.set(request.id, request);
      state.requestIdsByCode.set(request.code, request.id);
      state.round.usedPlayerKeys.add(request.applicant.playerKey);
      return;
    }

    if (type === "SQTB_CLAIMED") {
      const requestId = normalizeText(entry?.requestId);
      const request = requestId ? state.requests.get(requestId) : null;
      if (!request) return;
      request.status = "pending_approval";
      request.claimedAt = at;
      request.claimedAtMs = atMs;
      request.claimant = normalizeRecoveredActor(entry?.claimant ?? entry, "claimant");
      if (request.claimant?.playerKey) {
        state.round.usedPlayerKeys.add(request.claimant.playerKey);
      }
      return;
    }

    if (type === "SQTB_APPROVED") {
      const requestId = normalizeText(entry?.requestId);
      const request = requestId ? state.requests.get(requestId) : null;
      if (!request) return;
      request.status = "approved";
      request.approvedAt = at;
      request.directApproval = Boolean(entry?.directApproval);
      applyRecoveredSqtbQuotaUsage(entry, at, atMs);
      state.requests.delete(requestId);
      state.requestIdsByCode.delete(request.code);
      return;
    }

    if (type === "SQTB_REJECTED" || type === "SQTB_EXPIRED") {
      const requestId = normalizeText(entry?.requestId);
      const request = requestId ? state.requests.get(requestId) : null;
      if (!request) return;
      request.status = type === "SQTB_EXPIRED" ? "expired" : "rejected";
      request.rejectedAt = at;
      request.rejectedReason = normalizeText(entry?.reason);
      state.requests.delete(requestId);
      state.requestIdsByCode.delete(request.code);
    }
  }

  function normalizeRecoveredRequest(entry, atMs) {
    const id = normalizeText(entry?.requestId ?? entry?.id);
    const code = normalizeText(entry?.code);
    const applicant = normalizeRecoveredActor(entry?.applicant ?? entry, "applicant");
    const createdAt = normalizeText(entry?.at ?? entry?.time) || new Date(atMs).toISOString();
    const expiresAt = normalizeText(entry?.expiresAt) || new Date(atMs + runtimeConfig.requestTtlMs).toISOString();
    if (!id || !code || !applicant?.playerKey) return null;
    return {
      id,
      code,
      status: "pending_claim",
      createdAt,
      createdAtMs: atMs,
      expiresAt,
      expiresAtMs: Date.parse(expiresAt) || (atMs + runtimeConfig.requestTtlMs),
      applicant,
      claimant: null,
      claimedAt: "",
      claimedAtMs: 0,
      approvedAt: "",
      rejectedAt: "",
      rejectedReason: "",
      directApproval: false,
      serverId: normalizeText(entry?.serverId),
      sourceMessageId: normalizeText(entry?.sourceMessageId),
    };
  }

  function normalizeRecoveredActor(entry, role = "player") {
    const steamId = normalizeText(entry?.steamId ?? entry?.steamID);
    const eosId = normalizeText(entry?.eosId ?? entry?.eosID);
    const playerName = normalizeText(entry?.playerName ?? entry?.name);
    const teamId = normalizeNullableNumber(entry?.teamId ?? entry?.teamID);
    const squadId = normalizeNullableNumber(entry?.squadId ?? entry?.squadID);
    const playerKey = normalizeText(entry?.playerKey) || buildPlayerKey({ steamId, eosId, playerName });
    if (!playerKey) return null;
    return {
      role,
      playerKey,
      playerName,
      steamId,
      eosId,
      teamId,
      squadId,
    };
  }

  function applyRecoveredSqtbQuotaUsage(entry, at, atMs) {
    const applicant = normalizeRecoveredActor(entry?.applicant ?? entry, "applicant");
    if (applicant?.playerKey) {
      const applicantPeriod = ensurePeriod(applicant.playerKey, {
        nowMs: atMs,
        playerName: applicant.playerName,
        steamId: applicant.steamId,
        eosId: applicant.eosId,
        persistReset: false,
      });
      applicantPeriod.sqtbClaimUsed += 1;
      applicantPeriod.lastActivityAt = at;
      applicantPeriod.lastActivityAtMs = atMs;
    }

    const claimant = normalizeRecoveredActor(entry?.claimant ?? null, "claimant");
    if (claimant?.playerKey && !Boolean(entry?.directApproval)) {
      const claimantPeriod = ensurePeriod(claimant.playerKey, {
        nowMs: atMs,
        playerName: claimant.playerName,
        steamId: claimant.steamId,
        eosId: claimant.eosId,
        persistReset: false,
      });
      claimantPeriod.sqtbClaimUsed += 1;
      claimantPeriod.lastActivityAt = at;
      claimantPeriod.lastActivityAtMs = atMs;
    }
  }

  async function resetRound(reason = "round_world_bring_up", meta = {}) {
    return enqueue(async () => {
      state.round.publicTbRemaining = runtimeConfig.publicTbLimit;
      state.round.usedPlayerKeys.clear();
      state.round.lastResetAt = nowIso();
      state.round.lastResetReason = reason;
      state.windowState.wasOpen = false;

      await appendLog({
        type: "ROUND_RESET",
        reason,
        serverId: getServerId(meta?.serverId),
        by: normalizeText(meta?.by) || "system",
      });

      return {
        ok: true,
        publicTbRemaining: state.round.publicTbRemaining,
        lastResetAt: state.round.lastResetAt,
        lastResetReason: state.round.lastResetReason,
      };
    });
  }

  async function resetPeriodQuotas(reason = "manual_period_reset", meta = {}) {
    return enqueue(async () => {
      const resetAtMs = Date.now();
      const resetAt = new Date(resetAtMs).toISOString();
      let affectedCount = 0;

      for (const period of state.periods.values()) {
        period.periodStartedAt = resetAt;
        period.periodStartedAtMs = resetAtMs;
        period.lastActivityAt = "";
        period.lastActivityAtMs = 0;
        period.tbUsed = 0;
        period.sqtbClaimUsed = 0;
        affectedCount += 1;

        await appendLog({
          type: "PERIOD_RESET",
          reason,
          serverId: getServerId(meta?.serverId),
          by: normalizeText(meta?.by) || "system",
          playerKey: period.playerKey,
          playerName: period.playerName,
          steamId: period.steamId,
          eosId: period.eosId,
        });
      }

      return {
        ok: true,
        affectedCount,
        resetAt,
        reason,
      };
    });
  }

  function ensurePeriod(playerKey, { nowMs = Date.now(), playerName = "", steamId = "", eosId = "", persistReset = true } = {}) {
    const existing = state.periods.get(playerKey);
    if (!existing) {
      const next = {
        playerKey,
        playerName: normalizeText(playerName),
        steamId: normalizeText(steamId),
        eosId: normalizeText(eosId),
        periodStartedAt: new Date(nowMs).toISOString(),
        periodStartedAtMs: nowMs,
        lastActivityAt: "",
        lastActivityAtMs: 0,
        tbUsed: 0,
        sqtbClaimUsed: 0,
      };
      state.periods.set(playerKey, next);
      return next;
    }

    if (normalizeText(playerName)) existing.playerName = normalizeText(playerName);
    if (normalizeText(steamId)) existing.steamId = normalizeText(steamId);
    if (normalizeText(eosId)) existing.eosId = normalizeText(eosId);

    const anchorMs = Math.max(
      Number(existing.lastActivityAtMs ?? 0),
      Number(existing.periodStartedAtMs ?? 0),
    );
    if (anchorMs > 0 && nowMs - anchorMs >= runtimeConfig.periodMs) {
      existing.periodStartedAt = new Date(nowMs).toISOString();
      existing.periodStartedAtMs = nowMs;
      existing.lastActivityAt = "";
      existing.lastActivityAtMs = 0;
      existing.tbUsed = 0;
      existing.sqtbClaimUsed = 0;

      if (persistReset) {
        void appendLog({
          type: "PERIOD_RESET",
          reason: "period_timeout",
          playerKey: existing.playerKey,
          playerName: existing.playerName,
          steamId: existing.steamId,
          eosId: existing.eosId,
        }).catch((error) => {
          pluginLogger?.warn?.(`[FairTB] Failed to write PERIOD_RESET: ${error?.message ?? error}`);
        });
      }
    }

    return existing;
  }

  function consumeRoundUse(playerKey) {
    if (!playerKey) return;
    state.round.usedPlayerKeys.add(playerKey);
  }

  function hasRoundUse(playerKey) {
    if (!playerKey) return false;
    return state.round.usedPlayerKeys.has(playerKey);
  }

  function getTeamCounts(matchState) {
    const teams = Array.isArray(matchState?.teams) ? matchState.teams : [];
    const team1 = teams.find((team) => Number(team?.teamId ?? team?.teamID) === 1) ?? null;
    const team2 = teams.find((team) => Number(team?.teamId ?? team?.teamID) === 2) ?? null;

    return {
      team1: Number(team1?.playerCount ?? 0) || 0,
      team2: Number(team2?.playerCount ?? 0) || 0,
    };
  }

  function getSquadByPlayer(matchState, player) {
    if (!matchState || !player) return null;
    const teamId = Number(player?.teamId ?? player?.teamID ?? 0);
    const squadId = Number(player?.squadId ?? player?.squadID ?? 0);
    if (!teamId || !squadId) return null;
    const squads = Array.isArray(matchState?.squads) ? matchState.squads : [];
    return squads.find((entry) =>
      Number(entry?.teamId ?? entry?.teamID) === teamId
      && Number(entry?.squadId ?? entry?.squadID) === squadId,
    ) ?? null;
  }

  function validateCommonPlayerState(matchState, player) {
    if (!matchState) {
      return { ok: false, error: "MatchStateUnavailable", message: "SquadManagement 状态不可用。" };
    }
    if (!player) {
      return { ok: false, error: "PlayerNotFound", message: "当前快照中未找到玩家。" };
    }
    const teamId = Number(player?.teamId ?? player?.teamID ?? 0);
    if (teamId !== 1 && teamId !== 2) {
      return { ok: false, error: "InvalidTeam", message: "玩家必须在队伍 1 或队伍 2。" };
    }
    return { ok: true };
  }

  function validateTbBeforeSwitch({ playerKey, playerName, player, matchState, webStatus, period }) {
    const common = validateCommonPlayerState(matchState, player);
    if (!common.ok) return common;

    if (hasRoundUse(playerKey)) {
      return { ok: false, error: "RoundPlayerQuotaExhausted", message: `${playerName || "玩家"} 本回合已使用过 tb/sqtb/认领。` };
    }

    if (Boolean(webStatus?.isWarmup)) {
      const warmupDelta = calculatePostSwitchDelta(matchState, player);
      if (warmupDelta == null) {
        return { ok: false, error: "InvalidTeam", message: "无法计算热身阶段队伍分差。" };
      }
      if (warmupDelta >= 6) {
        return { ok: false, error: "WarmupDeltaExceeded", message: "热身阶段跳边会导致队伍分差达到 6 人或更多。" };
      }
      return { ok: true, mode: "warmup" };
    }

    const logClockSeconds = Number(webStatus?.logClockSeconds ?? 0);
    if (logClockSeconds < 20 || logClockSeconds > 60) {
      return { ok: false, error: "WindowClosed", message: "tb 仅在开局 20 到 60 秒之间可用。" };
    }

    const squadId = Number(player?.squadId ?? player?.squadID ?? 0);
    if (squadId > 0) {
      return { ok: false, error: "PlayerInSquad", message: "玩家必须不在小队中。" };
    }

    if (state.round.publicTbRemaining <= 0) {
      return { ok: false, error: "RoundTbQuotaExhausted", message: "本回合公共跳边额度已用尽。" };
    }

    if (Number(period?.tbUsed ?? 0) >= runtimeConfig.periodTbLimit) {
      return { ok: false, error: "PlayerTbQuotaExhausted", message: "玩家在当前周期内的跳边额度已用尽。" };
    }

    const counts = getTeamCounts(matchState);
    if (Math.abs(counts.team1 - counts.team2) >= 3) {
      return { ok: false, error: "TeamDeltaExceeded", message: "当前队伍分差已达到 3 人或更多。" };
    }

    return { ok: true, mode: "normal" };
  }

  function validateSqtbCreate({ playerKey, playerName, player, matchState, webStatus, period }) {
    const common = validateCommonPlayerState(matchState, player);
    if (!common.ok) return common;

    if (Boolean(webStatus?.isWarmup)) {
      return { ok: false, error: "WarmupSqtbDisabled", message: "暖服阶段禁用 sqtb 申请，请使用tb。" };
    }

    const squadId = Number(player?.squadId ?? player?.squadID ?? 0);
    if (squadId > 0) {
      return { ok: false, error: "PlayerInSquad", message: "小队中禁止跳边" };
    }

    if (Number(period?.sqtbClaimUsed ?? 0) >= runtimeConfig.periodSqtbClaimLimit) {
      return { ok: false, error: "PlayerSqtbQuotaExhausted", message: "玩家在当前周期内的申请/认领额度已用尽。" };
    }

    if (hasRoundUse(playerKey)) {
      return { ok: false, error: "RoundPlayerQuotaExhausted", message: `${playerName || "玩家"} 本回合已使用过 tb/sqtb/认领。` };
    }

    return { ok: true };
  }

  function validateClaim({ claimantKey, claimantName, claimantPlayer, applicantPlayerKey, matchState, period }) {
    const common = validateCommonPlayerState(matchState, claimantPlayer);
    if (!common.ok) return common;

    if (claimantKey === applicantPlayerKey) {
      return { ok: false, error: "SelfClaimForbidden", message: "申请人不能认领自己的 sqtb 申请。" };
    }

    if (Number(period?.sqtbClaimUsed ?? 0) >= runtimeConfig.periodSqtbClaimLimit) {
      return { ok: false, error: "PlayerSqtbQuotaExhausted", message: "当前周期内的申请/认领额度已用尽。" };
    }

    if (hasRoundUse(claimantKey)) {
      return { ok: false, error: "RoundPlayerQuotaExhausted", message: `${claimantName || "玩家"} 本回合已使用过 tb/sqtb/认领。` };
    }

    const squad = getSquadByPlayer(matchState, claimantPlayer);
    if (squad?.locked) {
      return { ok: false, error: "LockedSquadForbidden", message: "禁止锁队认领" };
    }

    const counts = getTeamCounts(matchState);
    if (Math.abs(counts.team1 - counts.team2) >= 3) {
      return { ok: false, error: "TeamDeltaExceeded", message: "当前队伍人数差已达到 3 人或更多。" };
    }

    return { ok: true };
  }

  function calculatePostSwitchDelta(matchState, player) {
    const teamId = Number(player?.teamId ?? player?.teamID ?? 0);
    const counts = getTeamCounts(matchState);
    if (teamId === 1) {
      return Math.abs((counts.team1 - 1) - (counts.team2 + 1));
    }
    if (teamId === 2) {
      return Math.abs((counts.team1 + 1) - (counts.team2 - 1));
    }
    return null;
  }

  function formatActor(player, fallback = {}) {
    const steamId = normalizeText(player?.steamId ?? player?.steamID ?? fallback?.steamId);
    const eosId = normalizeText(player?.eosId ?? player?.eosID ?? fallback?.eosId);
    const playerName = normalizeText(player?.name ?? player?.playerName ?? fallback?.playerName);
    return {
      playerKey: buildPlayerKey({ steamId, eosId, playerName }),
      playerName,
      steamId,
      eosId,
      teamId: normalizeNullableNumber(player?.teamId ?? player?.teamID ?? fallback?.teamId),
      squadId: normalizeNullableNumber(player?.squadId ?? player?.squadID ?? fallback?.squadId),
    };
  }

  async function handleTbMessage(event = {}) {
    const serverId = getServerId(event?.serverId);
    const { matchState, player } = getOnlinePlayerSnapshot(serverId, event);
    const actor = formatActor(player, event);
    const playerKey = actor.playerKey;
    const playerName = actor.playerName;
    const period = ensurePeriod(playerKey, {
      playerName,
      steamId: actor.steamId,
      eosId: actor.eosId,
    });
    const webStatus = getCurrentWebStatus();
    const validation = validateTbBeforeSwitch({
      playerKey,
      playerName,
      player,
      matchState,
      webStatus,
      period,
    });

    await appendLog({
      type: "TB_REQUESTED",
      serverId,
      playerKey,
      playerName,
      steamId: actor.steamId,
      eosId: actor.eosId,
      message: normalizeText(event?.message),
      mode: validation.mode ?? (Boolean(webStatus?.isWarmup) ? "warmup" : "normal"),
    });

    if (!validation.ok) {
      await appendLog({
        type: "TB_REJECTED",
        serverId,
        playerKey,
        playerName,
        steamId: actor.steamId,
        eosId: actor.eosId,
        reason: validation.error,
        message: validation.message,
      });
      await warnPlayer(actor, `公平跳边失败: ${validation.message}`, "fair_tb_rejected", {
        relatedEventId: normalizeText(event?.id ?? event?.seq),
      });
      return {
        ok: false,
        error: validation.error,
        message: validation.message,
      };
    }

    const result = await modules?.teamBalance?.forceTeamChange?.({
      steamId: actor.steamId,
      playerName,
      source: `${PLUGIN_ID}.tb`,
      reason: validation.mode === "warmup" ? "fair_tb_warmup" : "fair_tb_chat",
      operator: {
        id: PLUGIN_ID,
        name: "FairTeamBalance",
        username: "FairTeamBalance",
        role: "system",
        isSuperAdmin: true,
        permissions: ["*"],
      },
      system: true,
    });

    if (!result?.ok) {
      await appendLog({
        type: "TB_REJECTED",
        serverId,
        playerKey,
        playerName,
        steamId: actor.steamId,
        eosId: actor.eosId,
        reason: normalizeText(result?.error) || "TeamBalanceRejected",
        message: normalizeText(result?.message) || "TeamBalance rejected the switch.",
      });
      await warnPlayer(actor, `公平跳边失败: ${normalizeText(result?.message) || "跳边执行被拒绝"}`, "fair_tb_switch_rejected", {
        relatedEventId: normalizeText(event?.id ?? event?.seq),
      });
      return {
        ok: false,
        error: normalizeText(result?.error) || "TeamBalanceRejected",
        message: normalizeText(result?.message) || "TeamBalance rejected the switch.",
      };
    }

    if (validation.mode !== "warmup") {
      period.tbUsed += 1;
      period.lastActivityAt = nowIso();
      period.lastActivityAtMs = Date.now();
      state.round.publicTbRemaining = Math.max(0, state.round.publicTbRemaining - 1);
    }
    consumeRoundUse(playerKey);

    await appendLog({
      type: "TB_EXECUTED",
      serverId,
      playerKey,
      playerName,
      steamId: actor.steamId,
      eosId: actor.eosId,
      mode: validation.mode,
      roundPublicTbRemainingAfter: state.round.publicTbRemaining,
      teamBalanceResult: {
        ok: Boolean(result?.ok),
        message: normalizeText(result?.message),
        command: normalizeText(result?.command),
      },
    });

    await broadcastMessage(buildQuotaBroadcastMessage({
      playerName,
      mode: validation.mode === "warmup" ? "warmup" : "tb",
    }), validation.mode === "warmup" ? "fair_tb_warmup_broadcast" : "fair_tb_broadcast", {
      relatedEventId: normalizeText(event?.id ?? event?.seq),
    });

    return {
      ok: true,
      mode: validation.mode,
      result,
      publicTbRemaining: state.round.publicTbRemaining,
    };
  }

  function buildRequestId() {
    return `sqtb:${Date.now()}:${crypto.randomBytes(3).toString("hex")}`;
  }

  function generateRequestCode() {
    for (let index = 0; index < 10; index += 1) {
      const code = String(crypto.randomInt(0, 100000)).padStart(5, "0");
      if (!state.requestIdsByCode.has(code)) return code;
    }
    return String(crypto.randomInt(0, 100000)).padStart(5, "0");
  }

  async function handleSqtbMessage(event = {}) {
    const serverId = getServerId(event?.serverId);
    const { matchState, player } = getOnlinePlayerSnapshot(serverId, event);
    const actor = formatActor(player, event);
    const playerKey = actor.playerKey;
    const playerName = actor.playerName;
    const period = ensurePeriod(playerKey, {
      playerName,
      steamId: actor.steamId,
      eosId: actor.eosId,
    });
    const validation = validateSqtbCreate({
      playerKey,
      playerName,
      player,
      matchState,
      webStatus: getCurrentWebStatus(),
      period,
    });

    if (!validation.ok) {
      await appendLog({
        type: "SQTB_REJECTED",
        serverId,
        playerKey,
        playerName,
        steamId: actor.steamId,
        eosId: actor.eosId,
        reason: validation.error,
        message: validation.message,
      });
      await warnPlayer(actor, `公平跳边申请失败: ${validation.message}`, "fair_sqtb_rejected", {
        relatedEventId: normalizeText(event?.id ?? event?.seq),
      });
      return {
        ok: false,
        error: validation.error,
        message: validation.message,
      };
    }

    const createdAtMs = Date.now();
    const request = {
      id: buildRequestId(),
      code: generateRequestCode(),
      status: "pending_claim",
      createdAt: new Date(createdAtMs).toISOString(),
      createdAtMs,
      expiresAt: new Date(createdAtMs + runtimeConfig.requestTtlMs).toISOString(),
      expiresAtMs: createdAtMs + runtimeConfig.requestTtlMs,
      applicant: actor,
      claimant: null,
      claimedAt: "",
      claimedAtMs: 0,
      approvedAt: "",
      rejectedAt: "",
      rejectedReason: "",
      directApproval: false,
      serverId,
      sourceMessageId: normalizeText(event?.id ?? event?.seq),
    };

    state.requests.set(request.id, request);
    state.requestIdsByCode.set(request.code, request.id);
    consumeRoundUse(playerKey);

    await appendLog({
      type: "SQTB_CREATED",
      requestId: request.id,
      code: request.code,
      serverId,
      applicant: request.applicant,
      expiresAt: request.expiresAt,
      sourceMessageId: request.sourceMessageId,
    });

    await broadcastMessage(
      `${request.applicant.playerName || request.applicant.steamId || "unknown"} 发起公平跳边申请，请输入 认领${request.code} 完成认领`,
      "fair_sqtb_created",
      { relatedEventId: request.sourceMessageId },
    );

    return {
      ok: true,
      request: serializeRequest(request),
      claimMessage: `认领${request.code}`,
    };
  }

  async function handleClaimMessage(event = {}, code = "") {
    const eventActor = formatActor(null, event);
    const requestId = state.requestIdsByCode.get(code) ?? "";
    const request = requestId ? state.requests.get(requestId) : null;
    if (!request) {
      await warnPlayer(eventActor, "认领失败: 未找到对应的公平跳边申请", "fair_sqtb_claim_missing", {
        relatedEventId: normalizeText(event?.id ?? event?.seq),
      });
      return {
        ok: false,
        error: "RequestNotFound",
        message: "未找到对应的公平跳边申请。",
      };
    }

    const nowMs = Date.now();
    if (request.expiresAtMs <= nowMs) {
      await expireSingleRequest(request, { persist: true, reason: "expired_before_claim" });
      await warnPlayer(eventActor, "认领失败: 该公平跳边申请已过期", "fair_sqtb_claim_expired", {
        relatedEventId: normalizeText(event?.id ?? event?.seq),
      });
      return {
        ok: false,
        error: "RequestExpired",
        message: "公平跳边申请已过期。",
      };
    }

    const serverId = getServerId(event?.serverId || request.serverId);
    const { matchState, player } = getOnlinePlayerSnapshot(serverId, event);
    const actor = formatActor(player, event);
    const claimantKey = actor.playerKey;
    const claimantName = actor.playerName;
    const period = ensurePeriod(claimantKey, {
      playerName: claimantName,
      steamId: actor.steamId,
      eosId: actor.eosId,
    });
    const validation = validateClaim({
      claimantKey,
      claimantName,
      claimantPlayer: player,
      applicantPlayerKey: request.applicant.playerKey,
      matchState,
      period,
    });

    if (!validation.ok) {
      await warnPlayer(actor, `认领失败: ${validation.message}`, "fair_sqtb_claim_rejected", {
        relatedEventId: normalizeText(event?.id ?? event?.seq),
      });
      return {
        ok: false,
        error: validation.error,
        message: validation.message,
      };
    }

    const previousRequestState = {
      status: request.status,
      claimant: request.claimant ? { ...request.claimant } : null,
      claimedAt: request.claimedAt,
      claimedAtMs: request.claimedAtMs,
    };

    request.status = "pending_approval";
    request.claimedAt = new Date(nowMs).toISOString();
    request.claimedAtMs = nowMs;
    request.claimant = actor;
    consumeRoundUse(claimantKey);

    const approvalResult = await approveRequest({
      requestId: request.id,
      direct: false,
      actor: {
        id: claimantKey || actor.steamId || actor.playerName || "claimant",
        username: claimantName || actor.playerName || actor.steamId || "Claimant",
        name: claimantName || actor.playerName || actor.steamId || "Claimant",
        role: "player",
        isSuperAdmin: false,
        permissions: [],
      },
    });

    if (!approvalResult?.ok) {
      request.status = previousRequestState.status;
      request.claimant = previousRequestState.claimant;
      request.claimedAt = previousRequestState.claimedAt;
      request.claimedAtMs = previousRequestState.claimedAtMs;
      if (claimantKey) state.round.usedPlayerKeys.delete(claimantKey);
      await warnPlayer(actor, `认领失败: ${approvalResult?.message || "执行失败"}`, "fair_sqtb_claim_rejected", {
        relatedEventId: normalizeText(event?.id ?? event?.seq),
      });
      return approvalResult;
    }

    return {
      ok: true,
      request: approvalResult.request ?? serializeRequest(request),
      result: approvalResult.result ?? null,
    };
  }

  async function approveRequest({ requestId = "", direct = false, actor = null } = {}) {
    return enqueue(async () => {
      expireRequests();
      const request = state.requests.get(normalizeText(requestId));
      if (!request) {
        return {
          ok: false,
          error: "RequestNotFound",
          message: "未找到公平跳边申请。",
        };
      }

      if (request.status === "pending_claim" && !direct) {
        return {
          ok: false,
          error: "ClaimRequired",
          message: "申请必须先被认领才能批准。",
        };
      }

      const serverId = getServerId(request.serverId);
      const matchState = getCurrentMatchState(serverId);
      const applicantLive = findPlayerByActor(matchState, request.applicant) ?? request.applicant;
      const liveApplicantActor = formatActor(applicantLive, request.applicant);

      if (!liveApplicantActor.steamId) {
        return {
          ok: false,
          error: "ApplicantUnavailable",
          message: "申请人目前无法执行跳边。",
        };
      }

      const nowMs = Date.now();
      const applicantPeriod = ensurePeriod(liveApplicantActor.playerKey, {
        nowMs,
        playerName: liveApplicantActor.playerName,
        steamId: liveApplicantActor.steamId,
        eosId: liveApplicantActor.eosId,
      });
      if (Number(applicantPeriod.sqtbClaimUsed ?? 0) >= runtimeConfig.periodSqtbClaimLimit) {
        return {
          ok: false,
          error: "ApplicantQuotaExhausted",
          message: "申请人的申请/认领额度已用尽。",
        };
      }

      let liveClaimantActor = null;
      let claimantPeriod = null;
      if (!direct) {
        if (!request.claimant?.playerKey) {
          return {
            ok: false,
            error: "ClaimantMissing",
            message: "申请缺少认领人。",
          };
        }
        const claimantLive = findPlayerByActor(matchState, request.claimant) ?? request.claimant;
        liveClaimantActor = formatActor(claimantLive, request.claimant);
        claimantPeriod = ensurePeriod(liveClaimantActor.playerKey, {
          nowMs,
          playerName: liveClaimantActor.playerName,
          steamId: liveClaimantActor.steamId,
          eosId: liveClaimantActor.eosId,
        });
        if (Number(claimantPeriod.sqtbClaimUsed ?? 0) >= runtimeConfig.periodSqtbClaimLimit) {
          return {
            ok: false,
            error: "ClaimantQuotaExhausted",
            message: "认领人的申请/认领额度已用尽。",
          };
        }
      }

      const switchResult = await modules?.teamBalance?.forceTeamChange?.({
        steamId: liveApplicantActor.steamId,
        playerName: liveApplicantActor.playerName,
        source: `${PLUGIN_ID}.approve`,
        reason: direct ? "fair_sqtb_direct_approve" : "fair_sqtb_claim_approve",
        operator: {
          id: normalizeText(actor?.id ?? "fair-team-balance"),
          name: normalizeText(actor?.name ?? actor?.username ?? "FairTeamBalance"),
          username: normalizeText(actor?.username ?? actor?.name ?? "FairTeamBalance"),
          role: normalizeText(actor?.role ?? "system"),
          isSuperAdmin: Boolean(actor?.isSuperAdmin ?? true),
          permissions: Array.isArray(actor?.permissions) ? actor.permissions : ["*"],
        },
        system: true,
      });

      if (!switchResult?.ok) {
        return {
          ok: false,
          error: normalizeText(switchResult?.error) || "TeamBalanceRejected",
          message: normalizeText(switchResult?.message) || "TeamBalance 拒绝了 sqtb 批准。",
        };
      }

      applicantPeriod.sqtbClaimUsed += 1;
      applicantPeriod.lastActivityAt = nowIso();
      applicantPeriod.lastActivityAtMs = nowMs;

      if (!direct && claimantPeriod) {
        claimantPeriod.sqtbClaimUsed += 1;
        claimantPeriod.lastActivityAt = nowIso();
        claimantPeriod.lastActivityAtMs = nowMs;
      }

      request.status = "approved";
      request.approvedAt = nowIso();
      request.directApproval = Boolean(direct);
      request.applicant = liveApplicantActor;
      if (liveClaimantActor) request.claimant = liveClaimantActor;

      await appendLog({
        type: "SQTB_APPROVED",
        requestId: request.id,
        code: request.code,
        serverId,
        directApproval: Boolean(direct),
        applicant: request.applicant,
        claimant: request.claimant,
        approvedBy: normalizeActorForAudit(actor),
      });

      state.requests.delete(request.id);
      state.requestIdsByCode.delete(request.code);

      if (!direct && liveClaimantActor) {
        await warnPlayer(liveApplicantActor, `你的公平跳边申请已被 ${liveClaimantActor.playerName} 认领并执行成功`, "fair_sqtb_claim_success_applicant");
        await warnPlayer(liveClaimantActor, `你已成功认领并协助 ${liveApplicantActor.playerName} 完成跳边`, "fair_sqtb_claim_success_claimant");
      } else if (direct) {
        await warnPlayer(liveApplicantActor, `你的公平跳边申请已由管理员协助执行成功`, "fair_sqtb_direct_approve_success");
      }

      await broadcastMessage(buildQuotaBroadcastMessage({
        playerName: liveApplicantActor.playerName,
        mode: direct ? "admin_sqtb" : "claim_sqtb",
      }), direct ? "fair_sqtb_direct_approved_broadcast" : "fair_sqtb_approved_broadcast", {
        relatedEventId: request.id,
      });

      return {
        ok: true,
        request: serializeRequest(request),
        result: switchResult,
      };
    });
  }

  async function rejectRequest({ requestId = "", reason = "", actor = null } = {}) {
    return enqueue(async () => {
      expireRequests();
      const request = state.requests.get(normalizeText(requestId));
      if (!request) {
        return {
          ok: false,
          error: "RequestNotFound",
          message: "未找到公平跳边申请。",
        };
      }

      request.status = "rejected";
      request.rejectedAt = nowIso();
      request.rejectedReason = normalizeText(reason) || "manual_reject";

      await appendLog({
        type: "SQTB_REJECTED",
        requestId: request.id,
        code: request.code,
        serverId: getServerId(request.serverId),
        applicant: request.applicant,
        claimant: request.claimant,
        reason: request.rejectedReason,
        rejectedBy: normalizeActorForAudit(actor),
      });

      state.requests.delete(request.id);
      state.requestIdsByCode.delete(request.code);

      if (request.applicant) {
        await warnPlayer(request.applicant, `你的公平跳边申请已被拒绝: ${request.rejectedReason}`, "fair_sqtb_rejected_by_admin");
      }

      return {
        ok: true,
        request: serializeRequest(request),
      };
    });
  }

  function normalizeActorForAudit(actor = null) {
    if (!actor || typeof actor !== "object") return null;
    return {
      id: normalizeText(actor?.id),
      username: normalizeText(actor?.username),
      name: normalizeText(actor?.name),
      role: normalizeText(actor?.role),
    };
  }

  function findPlayerByActor(matchState, actor = null) {
    if (!matchState || !actor) return null;
    const players = Array.isArray(matchState?.players) ? matchState.players : [];
    const steamId = normalizeText(actor?.steamId ?? actor?.steamID);
    const eosId = normalizeText(actor?.eosId ?? actor?.eosID);
    const playerName = normalizeText(actor?.playerName ?? actor?.name);
    const playerKey = normalizeText(actor?.playerKey);

    return players.find((player) => {
      if (steamId && normalizeText(player?.steamId ?? player?.steamID) === steamId) return true;
      if (eosId && normalizeText(player?.eosId ?? player?.eosID) === eosId) return true;
      if (playerName && normalizeText(player?.name) === playerName) return true;
      return buildPlayerKey({
        steamId: player?.steamId ?? player?.steamID,
        eosId: player?.eosId ?? player?.eosID,
        playerName: player?.name,
      }) === playerKey;
    }) ?? null;
  }

  async function expireSingleRequest(request, { persist = true, reason = "expired" } = {}) {
    request.status = "expired";
    request.rejectedAt = nowIso();
    request.rejectedReason = reason;
    state.requests.delete(request.id);
    state.requestIdsByCode.delete(request.code);
    if (persist) {
      await appendLog({
        type: "SQTB_EXPIRED",
        requestId: request.id,
        code: request.code,
        serverId: request.serverId,
        applicant: request.applicant,
        claimant: request.claimant,
        reason,
      });
    }
  }

  function expireRequests({ now = Date.now(), persist = true } = {}) {
    const pending = [...state.requests.values()].filter((request) => Number(request.expiresAtMs ?? 0) <= now);
    if (!pending.length) return;

    const tasks = pending.map((request) => expireSingleRequest(request, {
      persist,
      reason: "ttl_expired",
    }));
    if (persist) {
      void Promise.all(tasks).catch((error) => {
        pluginLogger?.warn?.(`[FairTB] Failed to persist request expiry: ${error?.message ?? error}`);
      });
    }
  }

  function serializeRequest(request) {
    const nowMs = Date.now();
    return {
      id: request.id,
      code: request.code,
      status: request.status,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      ttlMsRemaining: Math.max(0, Number(request.expiresAtMs ?? 0) - nowMs),
      applicant: { ...request.applicant },
      claimant: request.claimant ? { ...request.claimant } : null,
      claimedAt: request.claimedAt,
      approvedAt: request.approvedAt,
      rejectedAt: request.rejectedAt,
      rejectedReason: request.rejectedReason,
      directApproval: Boolean(request.directApproval),
      serverId: request.serverId,
      canDirectApprove: request.status === "pending_claim",
      canApprove: request.status === "pending_approval",
    };
  }

  function listRequests() {
    expireRequests();
    return [...state.requests.values()]
      .sort((left, right) => Number(right.createdAtMs ?? 0) - Number(left.createdAtMs ?? 0))
      .map((request) => serializeRequest(request));
  }

  function serializePeriod(period) {
    const playerKey = normalizeText(period?.playerKey);
    return {
      playerKey,
      playerName: normalizeText(period?.playerName),
      steamId: normalizeText(period?.steamId),
      eosId: normalizeText(period?.eosId),
      periodStartedAt: normalizeText(period?.periodStartedAt),
      periodStartedAtMs: Number(period?.periodStartedAtMs ?? 0) || 0,
      lastActivityAt: normalizeText(period?.lastActivityAt),
      lastActivityAtMs: Number(period?.lastActivityAtMs ?? 0) || 0,
      tbUsed: Number(period?.tbUsed ?? 0) || 0,
      sqtbClaimUsed: Number(period?.sqtbClaimUsed ?? 0) || 0,
      hasRoundUse: state.round.usedPlayerKeys.has(playerKey),
    };
  }

  function listPlayerQuotas() {
    return [...state.periods.values()]
      .map((period) => serializePeriod(period))
      .sort((left, right) => {
        const leftRecentAt = Math.max(Number(left.lastActivityAtMs ?? 0), Number(left.periodStartedAtMs ?? 0));
        const rightRecentAt = Math.max(Number(right.lastActivityAtMs ?? 0), Number(right.periodStartedAtMs ?? 0));
        if (rightRecentAt !== leftRecentAt) return rightRecentAt - leftRecentAt;

        const leftUsage = Number(left.tbUsed ?? 0) + Number(left.sqtbClaimUsed ?? 0);
        const rightUsage = Number(right.tbUsed ?? 0) + Number(right.sqtbClaimUsed ?? 0);
        if (rightUsage !== leftUsage) return rightUsage - leftUsage;

        return String(left.playerName || left.steamId || left.playerKey || "").localeCompare(
          String(right.playerName || right.steamId || right.playerKey || ""),
        );
      });
  }

  function getState() {
    expireRequests();
    const webStatus = getCurrentWebStatus();
    const requests = listRequests();
    return {
      enabled: state.enabled,
      subscribed: isSubscribed(),
      active: isActive(),
      isWarmup: Boolean(webStatus?.isWarmup),
      logClockSeconds: Number(webStatus?.logClockSeconds ?? 0) || 0,
      publicTbLimit: runtimeConfig.publicTbLimit,
      publicTbRemaining: state.round.publicTbRemaining,
      periodMs: runtimeConfig.periodMs,
      periodTbLimit: runtimeConfig.periodTbLimit,
      periodSqtbClaimLimit: runtimeConfig.periodSqtbClaimLimit,
      requestTtlMs: runtimeConfig.requestTtlMs,
      playerQuotas: listPlayerQuotas(),
      roundUsedCount: state.round.usedPlayerKeys.size,
      activeRequestCount: requests.length,
      pendingClaimCount: requests.filter((request) => request.status === "pending_claim").length,
      pendingApprovalCount: requests.filter((request) => request.status === "pending_approval").length,
      lastRoundResetAt: state.round.lastResetAt,
      lastRoundResetReason: state.round.lastResetReason,
      recovery: { ...state.recovery },
    };
  }

  function handleChatMessage(event = {}) {
    return enqueue(async () => {
      if (!isActive()) {
        return { matched: false, skipped: true, reason: state.enabled ? "plugin_unsubscribed" : "plugin_disabled" };
      }

      expireRequests();
      const message = String(event?.message ?? "");
      if (message !== "tb" && message !== "sqtb" && !CLAIM_MESSAGE_PATTERN.test(message)) {
        return { matched: false };
      }

      if (message === "tb") {
        const result = await handleTbMessage(event);
        return {
          matched: true,
          trigger: "tb",
          ...result,
        };
      }

      if (message === "sqtb") {
        const result = await handleSqtbMessage(event);
        return {
          matched: true,
          trigger: "sqtb",
          ...result,
        };
      }

      const match = message.match(CLAIM_MESSAGE_PATTERN);
      const code = String(match?.[1] ?? "");
      const result = await handleClaimMessage(event, code);
      return {
        matched: true,
        trigger: "claim",
        code,
        ...result,
      };
    });
  }

  const api = {
    getState,
    listRequests,
    approveRequest,
    rejectRequest,
    resetRound,
    resetPeriodQuotas,

    async simulateChatMessage(payload = {}) {
      return handleChatMessage({
        ...payload,
        message: String(payload?.message ?? ""),
      });
    },
  };

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "公平跳边",
      kind: "plugin",
      version: "1.0.0",
      description: "聊天触发的公平跳边与 sqtb 申请插件，所有实际跳边统一经由 TeamBalance。",
      category: "Moderation",
    },
    apiName: "fairTeamBalance",
    api,

    async init() {
      await recoverFromLogs();
    },

    async start() {
      state.enabled = runtimeConfig.enabled;

      core?.webRegistry?.registerPage?.({
        id: "web.fairTeamBalance",
        title: "公平跳边",
        group: "插件",
        route: PAGE_ROUTE,
        pageModule: "/pages/fair-team-balance.js",
        source: PLUGIN_ID,
        description: "公平跳边插件状态、sqtb 申请和额度查看页面。",
        required: false,
        enabled: true,
        order: 135,
        icon: "FTB",
      });

      if (typeof modules?.chatManager?.on === "function") {
        unsubscribers.push(modules.chatManager.on("message", handleChatMessage));
      } else if (typeof core?.eventBus?.onModuleEvent === "function") {
        unsubscribers.push(core.eventBus.onModuleEvent("module.chatManager", "CHAT_RECEIVED", handleChatMessage));
      }

      if (typeof core?.eventBus?.onCoreEvent === "function") {
        unsubscribers.push(core.eventBus.onCoreEvent("round.world_bring_up", (event) => {
          void resetRound("round_world_bring_up", event);
        }));
      }

      expiryTimer = setInterval(() => {
        expireRequests();

        if (isActive()) {
          const webStatus = getCurrentWebStatus();
          const logClockSeconds = Number(webStatus?.logClockSeconds ?? 0);
          const isWarmup = Boolean(webStatus?.isWarmup);
          const isOpen = !isWarmup && logClockSeconds >= 20 && logClockSeconds <= 60;

          if (isOpen && !state.windowState.wasOpen) {
            void broadcastMessage("公平跳边窗口已打开 (20-60秒)，输入 tb 即可跳边", "fair_tb_window_opened");
            state.windowState.wasOpen = true;
          } else if (!isOpen && state.windowState.wasOpen) {
            void broadcastMessage("公平跳边窗口已关闭", "fair_tb_window_closed");
            state.windowState.wasOpen = false;
          }
        }
      }, EXPIRY_SWEEP_MS);
      if (typeof expiryTimer.unref === "function") {
        expiryTimer.unref();
      }

      pluginLogger?.info?.("[FairTB] plugin started");
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {}
      }

      if (expiryTimer) {
        clearInterval(expiryTimer);
        expiryTimer = null;
      }

      pluginLogger?.info?.("[FairTB] plugin stopped");
    },
  };
}

function createInitialState(runtimeConfig) {
  return {
    enabled: runtimeConfig.enabled,
    periods: new Map(),
    requests: new Map(),
    requestIdsByCode: new Map(),
    round: {
      publicTbRemaining: runtimeConfig.publicTbLimit,
      usedPlayerKeys: new Set(),
      lastResetAt: "",
      lastResetReason: "",
    },
    recovery: {
      lastRecoveredAt: "",
      recoveredLineCount: 0,
    },
    windowState: {
      wasOpen: false,
    },
  };
}

function readConfig(config) {
  const pluginConfig = config?.get?.("plugins.fairTeamBalance", {}) ?? {};
  return {
    enabled: pluginConfig.enabled !== false,
    directory: normalizeText(pluginConfig.directory) || DEFAULT_DATA_DIR,
    publicTbLimit: clampInteger(pluginConfig.publicTbLimit, 0, 999, DEFAULT_PUBLIC_TB_LIMIT),
    periodTbLimit: clampInteger(pluginConfig.periodTbLimit, 0, 999, DEFAULT_PERIOD_TB_LIMIT),
    periodSqtbClaimLimit: clampInteger(pluginConfig.periodSqtbClaimLimit, 0, 999, DEFAULT_PERIOD_SQTB_CLAIM_LIMIT),
    periodMs: clampInteger(pluginConfig.periodMs, 60 * 1000, 7 * 24 * 60 * 60 * 1000, DEFAULT_PERIOD_MS),
    requestTtlMs: clampInteger(pluginConfig.requestTtlMs, 100, 60 * 60 * 1000, DEFAULT_REQUEST_TTL_MS),
  };
}

function clampInteger(value, min, max, fallback = min) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeNullableNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function buildPlayerKey({ steamId = "", eosId = "", playerName = "" } = {}) {
  const normalizedSteamId = normalizeText(steamId);
  const normalizedEosId = normalizeText(eosId);
  const normalizedPlayerName = normalizeText(playerName);
  if (normalizedSteamId) return `steam:${normalizedSteamId}`;
  if (normalizedEosId) return `eos:${normalizedEosId}`;
  if (normalizedPlayerName) return `name:${normalizedPlayerName}`;
  return "";
}

export default { createPlugin };
