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
const BLACK_EDGE_ASSET_KEY = "blackEdgeSwitchCount";
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
  const processingRequestIds = new Set();

  function enqueue(task) {
    const next = serial.then(() => task(), () => task());
    serial = next.catch(() => {});
    return next;
  }

  function isRequestProcessing(requestId = "") {
    return processingRequestIds.has(normalizeText(requestId));
  }

  function beginRequestProcessing(requestId = "") {
    const key = normalizeText(requestId);
    if (!key || processingRequestIds.has(key)) return false;
    processingRequestIds.add(key);
    return true;
  }

  function endRequestProcessing(requestId = "") {
    const key = normalizeText(requestId);
    if (!key) return;
    processingRequestIds.delete(key);
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

  function shouldBroadcastApproved() {
    return runtimeConfig.broadcastOnApproved !== false;
  }

  function shouldBroadcastViolation() {
    return runtimeConfig.broadcastOnViolation !== false;
  }

  async function broadcastApprovedMessage(message, reason, meta = {}) {
    if (!shouldBroadcastApproved()) return null;
    return broadcastMessage(message, reason, meta);
  }

  async function broadcastViolationMessage(message, reason, meta = {}) {
    if (!shouldBroadcastViolation()) return null;
    return broadcastMessage(message, reason, meta);
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
        : mode === "warmup_tb"
          ? "暖服模式公平跳边执行成功"
          : mode === "black_edge_tb"
            ? "成功为暖服黑奴"
          : mode === "green_balance_tb"
            ? "绿色平衡跳边通道执行成功"
            : "公平跳边执行成功";
    if (mode === "warmup_tb") {
      return `${actionLabel}: ${safePlayerName}`;
    }
    if (mode === "black_edge_tb") {
      return `成功为暖服黑奴 ${safePlayerName} 完成黑奴跳边`;
    }
    return `${actionLabel}: ${safePlayerName}，公共TB剩余 ${state.round.publicTbRemaining}/${runtimeConfig.publicTbLimit}`;
  }

  function consumesTbQuotaMode(mode = "") {
    const normalizedMode = normalizeText(mode);
    return normalizedMode === "tb";
  }

  function buildViolationBroadcastMessage({ playerName = "", actionLabel = "公平跳边", reason = "" } = {}) {
    const safePlayerName = normalizeText(playerName) || "unknown";
    const safeReason = normalizeText(reason) || "已被规则拦截";
    return `${actionLabel}已被拦截: ${safePlayerName}，原因: ${safeReason}`;
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
      if (consumesTbQuotaMode(entry?.mode)) {
        period.tbUsed += 1;
        state.round.publicTbRemaining = clampInteger(
          Number(entry?.roundPublicTbRemainingAfter ?? state.round.publicTbRemaining - 1),
          0,
          runtimeConfig.publicTbLimit,
        );
        state.round.usedPlayerKeys.add(playerKey);
      }
      period.lastActivityAt = at;
      period.lastActivityAtMs = atMs;
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

    if (type === "SQTB_CLAIM_REJECTED" || type === "SQTB_APPROVAL_REJECTED") {
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
      releaseRoundUse(request.applicant?.playerKey);
      releaseRoundUse(request.claimant?.playerKey);
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
        await resetPeriodEntry(period, {
          resetAt,
          resetAtMs,
          persistLog: true,
          reason,
          meta,
        });
        affectedCount += 1;
      }

      state.round.publicTbRemaining = runtimeConfig.publicTbLimit;
      state.round.usedPlayerKeys.clear();
      state.round.lastResetAt = resetAt;
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
        affectedCount,
        resetAt,
        reason,
        publicTbRemaining: state.round.publicTbRemaining,
        roundUsedCount: state.round.usedPlayerKeys.size,
      };
    });
  }

  async function resetPlayerQuota({ playerKey = "", reason = "manual_player_reset", meta = {} } = {}) {
    return enqueue(async () => {
      const key = normalizeText(playerKey);
      const period = key ? state.periods.get(key) : null;
      if (!period) {
        return {
          ok: false,
          error: "PlayerNotFound",
          message: "未找到对应玩家配额。",
        };
      }

      const resetAtMs = Date.now();
      const resetAt = new Date(resetAtMs).toISOString();
      await resetPeriodEntry(period, {
        resetAt,
        resetAtMs,
        persistLog: true,
        reason,
        meta,
      });
      releaseRoundUse(key);

      return {
        ok: true,
        playerKey: key,
        resetAt,
        reason,
      };
    });
  }

  async function resetPeriodEntry(period, { resetAt, resetAtMs, persistLog = true, reason = "manual_period_reset", meta = {} } = {}) {
    if (!period) return;
    period.periodStartedAt = resetAt;
    period.periodStartedAtMs = resetAtMs;
    period.lastActivityAt = "";
    period.lastActivityAtMs = 0;
    period.tbUsed = 0;
    period.sqtbClaimUsed = 0;
    releaseRoundUse(period.playerKey);

    if (persistLog) {
      try {
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
      } catch (error) {
        pluginLogger?.warn?.(`[FairTB] Failed to write PERIOD_RESET: ${error?.message ?? error}`);
      }
    }
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

  function releaseRoundUse(playerKey) {
    if (!playerKey) return;
    state.round.usedPlayerKeys.delete(playerKey);
  }

  function getTeamCounts(matchState) {
    const players = Array.isArray(matchState?.players) ? matchState.players : [];
    if (players.length) {
      let team1 = 0;
      let team2 = 0;

      for (const player of players) {
        const teamId = Number(player?.teamId ?? player?.teamID ?? 0);
        if (teamId === 1) team1 += 1;
        if (teamId === 2) team2 += 1;
      }

      return { team1, team2 };
    }

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

  function getPlayerTeamId(player) {
    return Number(player?.teamId ?? player?.teamID ?? 0) || 0;
  }

  function isWithinTbWindow(logClockSeconds = 0) {
    const seconds = Number(logClockSeconds ?? 0);
    return seconds >= 20 && seconds <= 120;
  }

  function getSwitchEligibility(matchState, player) {
    const teamId = getPlayerTeamId(player);
    if (teamId !== 1 && teamId !== 2) {
      return {
        ok: false,
        error: "InvalidTeam",
        message: "玩家必须在队伍 1 或队伍 2。",
      };
    }

    const counts = getTeamCounts(matchState);
    const ownCount = teamId === 1 ? counts.team1 : counts.team2;
    const otherCount = teamId === 1 ? counts.team2 : counts.team1;
    const beforeDelta = Math.abs(ownCount - otherCount);
    const ownAfter = ownCount - 1;
    const otherAfter = otherCount + 1;
    const afterDelta = Math.abs(ownAfter - otherAfter);
    const improvesBalance = afterDelta < beforeDelta;
    const withinDeltaLimit = afterDelta < 3;
    const deltaRelief = beforeDelta >= 3 && improvesBalance;

    if (!withinDeltaLimit && !deltaRelief) {
      const countsMessage = `当前人数: 1队 ${counts.team1}，2队 ${counts.team2}。`;
      return {
        ok: false,
        error: "TeamDeltaNotAllowed",
        message: `执行后双方人数差距不能大于等于 3，除非执行后可以让差距变少。${countsMessage}`,
      };
    }

    return {
      ok: true,
      teamId,
      ownCount,
      otherCount,
      ownAfter,
      otherAfter,
      beforeDelta,
      afterDelta,
      improvesBalance,
      withinDeltaLimit,
      deltaRelief,
    };
  }

  function isGreenBalanceSwitch(sideCheck) {
    if (!sideCheck?.ok) return false;
    return (Number(sideCheck.ownCount ?? 0) - 1) > (Number(sideCheck.otherCount ?? 0) + 1);
  }

  function validateDirectSwitch({ playerKey, playerName, player, matchState, webStatus, period, action }) {
    const common = validateCommonPlayerState(matchState, player);
    if (!common.ok) return common;

    if (action === "sqtb" && Boolean(webStatus?.isWarmup)) {
      return {
        ok: false,
        error: "WarmupSqtbDisabled",
        message: "暖服阶段禁用 sqtb 申请，请使用tb。",
      };
    }

    if (hasRoundUse(playerKey)) {
      return {
        ok: false,
        error: "RoundPlayerQuotaExhausted",
        message: `${playerName || "玩家"} 本回合已使用过 tb/sqtb/认领。`,
      };
    }

    if (action === "tb") {
      if (state.round.publicTbRemaining <= 0) {
        return {
          ok: false,
          error: "RoundTbQuotaExhausted",
          message: "本回合公共跳边额度已用尽。",
        };
      }

      const sideCheck = getSwitchEligibility(matchState, player);
      if (!sideCheck.ok) return sideCheck;

      const logClockSeconds = Number(webStatus?.logClockSeconds ?? 0);
      if (!Boolean(webStatus?.isWarmup) && !isWithinTbWindow(logClockSeconds)) {
        return { ok: false, error: "WindowClosed", message: "tb 仅在开局 20 到 120 秒之间可用。" };
      }

      const squadId = Number(player?.squadId ?? player?.squadID ?? 0);
      if (squadId > 0) {
        return {
          ok: false,
          error: "PlayerInSquad",
          message: "玩家必须不在小队中。",
        };
      }

      if (Number(period?.tbUsed ?? 0) >= runtimeConfig.periodTbLimit) {
        return {
          ok: false,
          error: "PlayerTbQuotaExhausted",
          message: "玩家在当前周期内的跳边额度已用尽。",
        };
      }
    }

    if (action === "sqtb" && Number(period?.sqtbClaimUsed ?? 0) >= runtimeConfig.periodSqtbClaimLimit) {
      return {
        ok: false,
        error: "PlayerSqtbQuotaExhausted",
        message: "玩家在当前周期内的 sqtb 额度已用尽。",
      };
    }

    const squadId = Number(player?.squadId ?? player?.squadID ?? 0);
    if (squadId > 0) {
      return {
        ok: false,
        error: "PlayerInSquad",
        message: "玩家必须不在小队中。",
      };
    }

    const sideCheck = getSwitchEligibility(matchState, player);
    if (!sideCheck.ok) return sideCheck;

    return {
      ok: true,
      mode: action === "tb" && Boolean(webStatus?.isWarmup) ? "warmup" : "normal",
      sideCheck,
    };
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

    const logClockSeconds = Number(webStatus?.logClockSeconds ?? 0);
    if (!Boolean(webStatus?.isWarmup) && !isWithinTbWindow(logClockSeconds)) {
      return { ok: false, error: "WindowClosed", message: "tb 仅在开局 20 到 120 秒之间可用。" };
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

    const sideCheck = getSwitchEligibility(matchState, player);
    if (!sideCheck.ok) {
      return {
        ok: false,
        error: sideCheck.error === "TeamDeltaNotAllowed" ? "TeamDeltaExceeded" : sideCheck.error,
        message: sideCheck.message,
      };
    }

    return { ok: true, mode: Boolean(webStatus?.isWarmup) ? "warmup" : "normal", sideCheck };
  }

  async function validateBlackEdgeSwitch({ player, matchState, webStatus, actor }) {
    const common = validateCommonPlayerState(matchState, player);
    if (!common.ok) return common;

    const logClockSeconds = Number(webStatus?.logClockSeconds ?? 0);
    if (!isWithinTbWindow(logClockSeconds)) {
      return { ok: false, error: "WindowClosed", message: "黑奴跳边仅在开局 20 到 120 秒之间可用。" };
    }

    const sideCheck = getSwitchEligibility(matchState, player);
    if (!sideCheck.ok) return sideCheck;

    const steamIds = [normalizeText(actor?.steamId)].filter(Boolean);
    const playerRows = steamIds.length
      ? (await modules?.playerDatabase?.listPlayersBySteamIDs?.(steamIds) ?? [])
      : [];
    const playerRow = Array.isArray(playerRows) ? playerRows[0] : null;
    const assetCount = Math.max(0, Number(
      playerRow?.blackEdgeSwitchCount
      ?? playerRow?.assets?.[BLACK_EDGE_ASSET_KEY]
      ?? playerRow?.assetsJson?.[BLACK_EDGE_ASSET_KEY]
      ?? 0,
    ) || 0);

    if (assetCount < 1) {
      return {
        ok: false,
        error: "BlackEdgeQuotaExhausted",
        message: "黑奴跳边额度不足。",
      };
    }

    return {
      ok: true,
      mode: "black_edge",
      sideCheck,
      assetCount,
    };
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

    const applicantPlayer = findPlayerByActor(matchState, { playerKey: applicantPlayerKey });
    if (!applicantPlayer) {
      return { ok: false, error: "ApplicantUnavailable", message: "Applicant is unavailable for switch." };
    }

    const sideCheck = getSwitchEligibility(matchState, applicantPlayer);
    if (!sideCheck.ok) {
      return {
        ok: false,
        error: sideCheck.error === "TeamDeltaNotAllowed" ? "TeamDeltaExceeded" : sideCheck.error,
        message: sideCheck.message,
      };
    }

    return { ok: true };
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
    const isWarmupTb = validation.mode === "warmup";

    await appendLog({
      type: "TB_REQUESTED",
      serverId,
      playerKey,
      playerName,
      steamId: actor.steamId,
      eosId: actor.eosId,
      message: normalizeText(event?.message),
      mode: isWarmupTb ? "warmup" : "normal",
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
      await broadcastViolationMessage(buildViolationBroadcastMessage({
        playerName,
        actionLabel: "公平跳边",
        reason: validation.message,
      }), "fair_tb_rejected_broadcast", {
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
      reason: "fair_tb_chat",
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

    if (!isWarmupTb) {
      period.tbUsed += 1;
      state.round.publicTbRemaining = Math.max(0, state.round.publicTbRemaining - 1);
      consumeRoundUse(playerKey);
    }

    period.lastActivityAt = nowIso();
    period.lastActivityAtMs = Date.now();

    await appendLog({
      type: "TB_EXECUTED",
      serverId,
      playerKey,
      playerName,
      steamId: actor.steamId,
      eosId: actor.eosId,
      mode: isWarmupTb ? "warmup_tb" : validation.mode,
      roundPublicTbRemainingAfter: state.round.publicTbRemaining,
      teamBalanceResult: {
        ok: Boolean(result?.ok),
        message: normalizeText(result?.message),
        command: normalizeText(result?.command),
      },
    });

    await broadcastMessage(buildQuotaBroadcastMessage({
      playerName,
      mode: isWarmupTb ? "warmup_tb" : "tb",
    }), "fair_tb_broadcast", {
      relatedEventId: normalizeText(event?.id ?? event?.seq),
    });

    await warnPlayer(actor, isWarmupTb
      ? "公平跳边提醒: 已在暖服模式执行完成"
      : `公平跳边提醒: 已在非暖服模式执行完成，公共TB剩余 ${state.round.publicTbRemaining}/${runtimeConfig.publicTbLimit}`, "fair_tb_success_warning", {
      relatedEventId: normalizeText(event?.id ?? event?.seq),
    });

    return {
      ok: true,
      mode: isWarmupTb ? "warmup" : "normal",
      result,
      publicTbRemaining: state.round.publicTbRemaining,
    };
  }

  async function executeDirectSwitch(event = {}, action = "tb") {
    const serverId = getServerId(event?.serverId);
    const { matchState, player } = getOnlinePlayerSnapshot(serverId, event);
    const actor = formatActor(player, event);
    const playerKey = actor.playerKey;
    const playerName = actor.playerName;
    const nowMs = Date.now();
    const period = ensurePeriod(playerKey, {
      nowMs,
      playerName,
      steamId: actor.steamId,
      eosId: actor.eosId,
    });
    const webStatus = getCurrentWebStatus();
    const validation = validateDirectSwitch({
      playerKey,
      playerName,
      player,
      matchState,
      webStatus,
      period,
      action,
    });
    const sourceMessageId = normalizeText(event?.id ?? event?.seq);
    const requestedType = action === "sqtb" ? "SQTB_REQUESTED" : "TB_REQUESTED";
    const rejectedType = action === "sqtb" ? "SQTB_REJECTED" : "TB_REJECTED";
    const executedType = action === "sqtb" ? "SQTB_EXECUTED" : "TB_EXECUTED";
    const successReason = action === "sqtb" ? "fair_sqtb_chat" : "fair_tb_chat";
    const failureReason = action === "sqtb" ? "fair_sqtb_rejected" : "fair_tb_rejected";

    await appendLog({
      type: requestedType,
      serverId,
      playerKey,
      playerName,
      steamId: actor.steamId,
      eosId: actor.eosId,
      message: normalizeText(event?.message),
      mode: action,
      sourceMessageId,
    });

    if (!validation.ok) {
      await appendLog({
        type: rejectedType,
        serverId,
        playerKey,
        playerName,
        steamId: actor.steamId,
        eosId: actor.eosId,
        reason: validation.error,
        message: validation.message,
      });
      await warnPlayer(actor, `公平跳边失败: ${validation.message}`, failureReason, {
        relatedEventId: sourceMessageId,
      });
      await broadcastViolationMessage(buildViolationBroadcastMessage({
        playerName,
        actionLabel: action === "sqtb" ? "公平跳边申请" : "公平跳边",
        reason: validation.message,
      }), action === "sqtb" ? "fair_sqtb_rejected_broadcast" : "fair_tb_rejected_broadcast", {
        relatedEventId: sourceMessageId,
      });
      return {
        ok: false,
        error: validation.error,
        message: validation.message,
      };
    }

    const switchResult = await modules?.teamBalance?.forceTeamChange?.({
      steamId: actor.steamId,
      playerName,
      source: `${PLUGIN_ID}.${action}`,
      reason: successReason,
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

    if (!switchResult?.ok) {
      await appendLog({
        type: rejectedType,
        serverId,
        playerKey,
        playerName,
        steamId: actor.steamId,
        eosId: actor.eosId,
        reason: normalizeText(switchResult?.error) || "TeamBalanceRejected",
        message: normalizeText(switchResult?.message) || "TeamBalance rejected the switch.",
      });
      await warnPlayer(actor, `公平跳边失败: ${normalizeText(switchResult?.message) || "跳边执行被拒绝"}`, action === "sqtb" ? "fair_sqtb_switch_rejected" : "fair_tb_switch_rejected", {
        relatedEventId: sourceMessageId,
      });
      await broadcastViolationMessage(buildViolationBroadcastMessage({
        playerName,
        actionLabel: "公平跳边",
        reason: normalizeText(switchResult?.message) || "跳边执行被拒绝",
      }), action === "sqtb" ? "fair_sqtb_switch_rejected_broadcast" : "fair_tb_switch_rejected_broadcast", {
        relatedEventId: sourceMessageId,
      });
      return {
        ok: false,
        error: normalizeText(switchResult?.error) || "TeamBalanceRejected",
        message: normalizeText(switchResult?.message) || "TeamBalance rejected the switch.",
      };
    }

    if (action === "tb") {
      if (!Boolean(validation.mode === "warmup")) {
        if (consumesTbQuotaMode(validation.mode)) {
          period.tbUsed += 1;
        }
        state.round.publicTbRemaining = Math.max(0, state.round.publicTbRemaining - 1);
        consumeRoundUse(playerKey);
      }
    } else {
      period.sqtbClaimUsed += 1;
      consumeRoundUse(playerKey);
    }

    period.lastActivityAt = nowIso();
    period.lastActivityAtMs = nowMs;

    await appendLog({
      type: executedType,
      serverId,
      playerKey,
      playerName,
      steamId: actor.steamId,
      eosId: actor.eosId,
      mode: action === "tb" && Boolean(validation.mode === "warmup")
        ? "warmup_tb"
        : action,
      roundPublicTbRemainingAfter: state.round.publicTbRemaining,
      teamBalanceResult: {
        ok: Boolean(switchResult?.ok),
        message: normalizeText(switchResult?.message),
        command: normalizeText(switchResult?.command),
      },
    });

    if (action === "tb") {
      await broadcastApprovedMessage(buildQuotaBroadcastMessage({
        playerName,
        mode: Boolean(validation.mode === "warmup")
          ? "warmup_tb"
          : "tb",
      }), "fair_tb_broadcast", {
        relatedEventId: sourceMessageId,
      });
      await warnPlayer(actor, Boolean(validation.mode === "warmup")
        ? "公平跳边提醒: 已在暖服模式执行完成"
        : `公平跳边提醒: 已在非暖服模式执行完成，公共TB剩余 ${state.round.publicTbRemaining}/${runtimeConfig.publicTbLimit}`, "fair_tb_success_warning", {
        relatedEventId: sourceMessageId,
      });
      return {
        ok: true,
        mode: Boolean(validation.mode === "warmup") ? "warmup" : validation.mode,
        result: switchResult,
        publicTbRemaining: state.round.publicTbRemaining,
      };
    }

    await broadcastApprovedMessage(`公平跳边 SQTB 执行成功: ${playerName || "unknown"}`, "fair_sqtb_broadcast", {
      relatedEventId: sourceMessageId,
    });
    await warnPlayer(actor, "公平跳边提醒: SQTB 已在人数差允许时执行完成", "fair_sqtb_success_warning", {
      relatedEventId: sourceMessageId,
    });

    return {
      ok: true,
      mode: "direct",
      result: switchResult,
    };
  }

  async function handleDirectTbMessage(event = {}) {
    return executeDirectSwitch(event, "tb");
  }

  async function handleDirectSqtbMessage(event = {}) {
    return handleSqtbMessage(event);
  }

  async function handleBlackEdgeSwitchMessage(event = {}) {
    const serverId = getServerId(event?.serverId);
    const { matchState, player } = getOnlinePlayerSnapshot(serverId, event);
    const actor = formatActor(player, event);
    const playerName = actor.playerName;
    const sourceMessageId = normalizeText(event?.id ?? event?.seq);
    const webStatus = getCurrentWebStatus();
    const validation = await validateBlackEdgeSwitch({
      player,
      matchState,
      webStatus,
      actor,
    });

    await appendLog({
      type: "TB_REQUESTED",
      serverId,
      playerKey: actor.playerKey,
      playerName,
      steamId: actor.steamId,
      eosId: actor.eosId,
      message: normalizeText(event?.message),
      mode: "black_edge",
      sourceMessageId,
    });

    if (!validation.ok) {
      await appendLog({
        type: "TB_REJECTED",
        serverId,
        playerKey: actor.playerKey,
        playerName,
        steamId: actor.steamId,
        eosId: actor.eosId,
        reason: validation.error,
        message: validation.message,
      });
      await warnPlayer(actor, `黑奴跳边失败: ${validation.message}`, "black_edge_tb_rejected", {
        relatedEventId: sourceMessageId,
      });
      await broadcastViolationMessage(buildViolationBroadcastMessage({
        playerName,
        actionLabel: "黑奴跳边",
        reason: validation.message,
      }), "black_edge_tb_rejected_broadcast", {
        relatedEventId: sourceMessageId,
      });
      return {
        ok: false,
        error: validation.error,
        message: validation.message,
      };
    }

    const consumeResult = await modules?.playerDatabase?.consumeAssetByIdentity?.({
      name: actor.playerName,
      steamID: actor.steamId,
      eosID: actor.eosId,
    }, BLACK_EDGE_ASSET_KEY, 1);

    if (!consumeResult?.ok) {
      const message = normalizeText(consumeResult?.message) || "黑奴跳边额度不足。";
      await appendLog({
        type: "TB_REJECTED",
        serverId,
        playerKey: actor.playerKey,
        playerName,
        steamId: actor.steamId,
        eosId: actor.eosId,
        reason: normalizeText(consumeResult?.error) || "BlackEdgeQuotaExhausted",
        message,
      });
      await warnPlayer(actor, `黑奴跳边失败: ${message}`, "black_edge_tb_rejected", {
        relatedEventId: sourceMessageId,
      });
      return {
        ok: false,
        error: normalizeText(consumeResult?.error) || "BlackEdgeQuotaExhausted",
        message,
      };
    }

    const switchResult = await modules?.teamBalance?.forceTeamChange?.({
      steamId: actor.steamId,
      playerName,
      source: `${PLUGIN_ID}.black_edge`,
      reason: "black_edge_tb_chat",
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

    if (!switchResult?.ok) {
      await modules?.playerDatabase?.addAssetByIdentity?.({
        name: actor.playerName,
        steamID: actor.steamId,
        eosID: actor.eosId,
      }, BLACK_EDGE_ASSET_KEY, 1);

      await appendLog({
        type: "TB_REJECTED",
        serverId,
        playerKey: actor.playerKey,
        playerName,
        steamId: actor.steamId,
        eosId: actor.eosId,
        reason: normalizeText(switchResult?.error) || "TeamBalanceRejected",
        message: normalizeText(switchResult?.message) || "TeamBalance rejected the switch.",
      });
      await warnPlayer(actor, `黑奴跳边失败: ${normalizeText(switchResult?.message) || "跳边执行被拒绝"}`, "black_edge_tb_switch_rejected", {
        relatedEventId: sourceMessageId,
      });
      return {
        ok: false,
        error: normalizeText(switchResult?.error) || "TeamBalanceRejected",
        message: normalizeText(switchResult?.message) || "TeamBalance rejected the switch.",
      };
    }

    await appendLog({
      type: "TB_EXECUTED",
      serverId,
      playerKey: actor.playerKey,
      playerName,
      steamId: actor.steamId,
      eosId: actor.eosId,
      mode: "black_edge_tb",
      roundPublicTbRemainingAfter: state.round.publicTbRemaining,
      teamBalanceResult: {
        ok: Boolean(switchResult?.ok),
        message: normalizeText(switchResult?.message),
        command: normalizeText(switchResult?.command),
      },
    });

    await broadcastApprovedMessage(buildQuotaBroadcastMessage({
      playerName,
      mode: "black_edge_tb",
    }), "black_edge_tb_broadcast", {
      relatedEventId: sourceMessageId,
    });
    await warnPlayer(actor, `成功为暖服黑奴 ${playerName || "unknown"} 完成黑奴跳边`, "black_edge_tb_success_warning", {
      relatedEventId: sourceMessageId,
    });

    return {
      ok: true,
      mode: "black_edge",
      result: switchResult,
      remaining: Math.max(0, Number(consumeResult?.remaining ?? 0) || 0),
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

  async function createSqtbRequest({ serverId, actor, sourceMessageId }) {
    return createSqtbRequest({
      serverId,
      actor,
      sourceMessageId: normalizeText(event?.id ?? event?.seq),
    });

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
      sourceMessageId,
    };

    state.requests.set(request.id, request);
    state.requestIdsByCode.set(request.code, request.id);
    consumeRoundUse(actor.playerKey);

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
      await broadcastViolationMessage(buildViolationBroadcastMessage({
        playerName,
        actionLabel: "公平跳边申请",
        reason: validation.message,
      }), "fair_sqtb_rejected_broadcast", {
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
      await broadcastViolationMessage(buildViolationBroadcastMessage({
        playerName: eventActor.playerName,
        actionLabel: "公平跳边认领",
        reason: "未找到对应的公平跳边申请",
      }), "fair_sqtb_claim_missing_broadcast", {
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
      await broadcastViolationMessage(buildViolationBroadcastMessage({
        playerName: eventActor.playerName,
        actionLabel: "公平跳边认领",
        reason: "该公平跳边申请已过期",
      }), "fair_sqtb_claim_expired_broadcast", {
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
      await appendLog({
        type: "SQTB_CLAIM_REJECTED",
        requestId: request.id,
        code: request.code,
        serverId,
        applicant: request.applicant,
        claimant: actor,
        reason: validation.error,
        message: validation.message,
      });
      await warnPlayer(actor, `认领失败: ${validation.message}`, "fair_sqtb_claim_rejected", {
        relatedEventId: normalizeText(event?.id ?? event?.seq),
      });
      await broadcastViolationMessage(buildViolationBroadcastMessage({
        playerName: claimantName,
        actionLabel: "公平跳边认领",
        reason: validation.message,
      }), "fair_sqtb_claim_rejected_broadcast", {
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

    await appendLog({
      type: "SQTB_CLAIMED",
      requestId: request.id,
      code: request.code,
      serverId,
      applicant: request.applicant,
      claimant: request.claimant,
    });

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
      await appendLog({
        type: "SQTB_CLAIM_REJECTED",
        requestId: request.id,
        code: request.code,
        serverId,
        applicant: request.applicant,
        claimant: actor,
        reason: normalizeText(approvalResult?.error) || "ClaimApprovalRejected",
        message: normalizeText(approvalResult?.message) || "claim approval rejected",
      });
      request.status = previousRequestState.status;
      request.claimant = previousRequestState.claimant;
      request.claimedAt = previousRequestState.claimedAt;
      request.claimedAtMs = previousRequestState.claimedAtMs;
      if (claimantKey) state.round.usedPlayerKeys.delete(claimantKey);
      await warnPlayer(actor, `认领失败: ${approvalResult?.message || "执行失败"}`, "fair_sqtb_claim_rejected", {
        relatedEventId: normalizeText(event?.id ?? event?.seq),
      });
      await broadcastViolationMessage(buildViolationBroadcastMessage({
        playerName: claimantName,
        actionLabel: "公平跳边认领",
        reason: approvalResult?.message || "执行失败",
      }), "fair_sqtb_claim_approval_rejected_broadcast", {
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

  async function appendApprovalRejectedLog(request, {
    actor = null,
    applicant = null,
    claimant = null,
    direct = false,
    serverId = "",
    reason = "",
    message = "",
  } = {}) {
    await appendLog({
      type: "SQTB_APPROVAL_REJECTED",
      requestId: request?.id,
      code: request?.code,
      serverId: getServerId(serverId || request?.serverId),
      directApproval: Boolean(direct),
      applicant: applicant ?? request?.applicant ?? null,
      claimant: claimant ?? request?.claimant ?? null,
      approvedBy: normalizeActorForAudit(actor),
      reason: normalizeText(reason),
      message: normalizeText(message),
    });
  }

  async function approveRequest({ requestId = "", direct = false, actor = null } = {}) {
    expireRequests();
    const requestKey = normalizeText(requestId);
    const request = state.requests.get(requestKey);
    if (!request) {
      return {
        ok: false,
        error: "RequestNotFound",
        message: "未找到公平跳边申请。",
      };
    }
    if (!beginRequestProcessing(requestKey)) {
      return {
        ok: false,
        error: "RequestProcessing",
        message: "该请求正在处理中，请稍后重试。",
      };
    }

    try {
      if (request.status === "pending_claim" && !direct) {
        await appendApprovalRejectedLog(request, {
          actor,
          direct,
          reason: "ClaimRequired",
          message: "claim required before approval",
        });
        return {
          ok: false,
          error: "ClaimRequired",
          message: "申请必须先被认领才能批准。",
        };
      }

      const webStatus = getCurrentWebStatus();
      if (Boolean(webStatus?.isWarmup)) {
        await appendApprovalRejectedLog(request, {
          actor,
          direct,
          reason: "WarmupModeDisabled",
          message: "approval rejected during warmup",
        });
        return {
          ok: false,
          error: "WarmupModeDisabled",
          message: "暖服模式下已关闭公平跳边，请切换到非暖服模式后再处理请求。",
        };
      }

      const serverId = getServerId(request.serverId);
      const matchState = getCurrentMatchState(serverId);
      const applicantLive = findPlayerByActor(matchState, request.applicant) ?? request.applicant;
      const liveApplicantActor = formatActor(applicantLive, request.applicant);

      if (!liveApplicantActor.steamId) {
        await appendApprovalRejectedLog(request, {
          actor,
          applicant: liveApplicantActor,
          direct,
          serverId,
          reason: "ApplicantUnavailable",
          message: "applicant unavailable",
        });
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
        await appendApprovalRejectedLog(request, {
          actor,
          applicant: liveApplicantActor,
          direct,
          serverId,
          reason: "ApplicantQuotaExhausted",
          message: "applicant quota exhausted",
        });
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
          await appendApprovalRejectedLog(request, {
            actor,
            applicant: liveApplicantActor,
            claimant: request.claimant,
            direct,
            serverId,
            reason: "ClaimantMissing",
            message: "claimant missing",
          });
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
          await appendApprovalRejectedLog(request, {
            actor,
            applicant: liveApplicantActor,
            claimant: liveClaimantActor,
            direct,
            serverId,
            reason: "ClaimantQuotaExhausted",
            message: "claimant quota exhausted",
          });
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
        await appendApprovalRejectedLog(request, {
          actor,
          applicant: liveApplicantActor,
          claimant: liveClaimantActor ?? request.claimant,
          direct,
          serverId,
          reason: normalizeText(switchResult?.error) || "TeamBalanceRejected",
          message: normalizeText(switchResult?.message) || "TeamBalance rejected sqtb approval",
        });
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

      await broadcastApprovedMessage(buildQuotaBroadcastMessage({
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
    } finally {
      endRequestProcessing(requestKey);
    }
  }

  async function rejectRequest({ requestId = "", reason = "", actor = null } = {}) {
    expireRequests();
    const requestKey = normalizeText(requestId);
    const request = state.requests.get(requestKey);
    if (!request) {
      return {
        ok: false,
        error: "RequestNotFound",
        message: "未找到公平跳边申请。",
      };
    }
    if (!beginRequestProcessing(requestKey)) {
      return {
        ok: false,
        error: "RequestProcessing",
        message: "该请求正在处理中，请稍后重试。",
      };
    }

    try {
      request.status = "rejected";
      request.rejectedAt = nowIso();
      request.rejectedReason = normalizeText(reason) || "manual_reject";
      releaseRoundUse(request.applicant?.playerKey);
      releaseRoundUse(request.claimant?.playerKey);

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
    } finally {
      endRequestProcessing(requestKey);
    }
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
    endRequestProcessing(request.id);
    releaseRoundUse(request.applicant?.playerKey);
    releaseRoundUse(request.claimant?.playerKey);
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

  async function clearHistory() {
    return enqueue(async () => {
      let clearedCount = 0;
      try {
        const files = await fs.readdir(dataDir, { withFileTypes: true });
        for (const entry of files) {
          if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
          await fs.unlink(path.join(dataDir, entry.name));
          clearedCount += 1;
        }
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }

      state.recovery.lastRecoveredAt = nowIso();
      state.recovery.recoveredLineCount = 0;

      return {
        ok: true,
        clearedCount,
      };
    });
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
      processing: isRequestProcessing(request.id),
      canDirectApprove: request.status === "pending_claim" && !isRequestProcessing(request.id),
      canApprove: request.status === "pending_approval" && !isRequestProcessing(request.id),
    };
  }

  function listRequests() {
    expireRequests();
    return [...state.requests.values()]
      .sort((left, right) => Number(right.createdAtMs ?? 0) - Number(left.createdAtMs ?? 0))
      .map((request) => serializeRequest(request));
  }

  async function listHistory({ limit = 100 } = {}) {
    const files = getReplayFilePaths(Date.now());
    const entries = [];
    const types = [
      "TB_REQUESTED",
      "TB_EXECUTED",
      "TB_REJECTED",
      "SQTB_CREATED",
      "SQTB_CLAIMED",
      "SQTB_CLAIM_REJECTED",
      "SQTB_APPROVAL_REJECTED",
      "SQTB_APPROVED",
      "SQTB_REJECTED",
      "SQTB_EXPIRED",
    ];

    for (const filePath of files) {
      try {
        const text = await fs.readFile(filePath, "utf8");
        const lines = text.split(/\r?\n/);
        // Process lines from bottom to top to get recent entries first
        for (let i = lines.length - 1; i >= 0; i--) {
          const trimmed = lines[i].trim();
          if (!trimmed) continue;
          try {
            const entry = JSON.parse(trimmed);
            if (types.includes(entry.type)) {
              entries.push(entry);
              if (entries.length >= limit) break;
            }
          } catch {}
        }
      } catch (error) {
        if (error.code !== "ENOENT") {
          pluginLogger?.warn?.(`[FairTB] Failed to read history log ${filePath}: ${error.message}`);
        }
      }
      if (entries.length >= limit) break;
    }

    return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
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
      broadcastOnApproved: runtimeConfig.broadcastOnApproved,
      broadcastOnViolation: runtimeConfig.broadcastOnViolation,
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
      const message = String(event?.message ?? "").trim();
      const lowerMessage = message.toLowerCase();
      const isTb = lowerMessage === "tb" || message === "公平跳边" || message === "跳边";
      const isSqtb = lowerMessage === "sqtb" || message === "申请跳边";
      const isBlackEdge = message === "黑奴跳边";

      if (!isTb && !isSqtb && !isBlackEdge && !CLAIM_MESSAGE_PATTERN.test(message)) {
        return { matched: false };
      }

      if (isBlackEdge) {
        const result = await handleBlackEdgeSwitchMessage(event);
        return {
          matched: true,
          trigger: "black_edge",
          ...result,
        };
      }

      if (isTb) {
        const result = await handleDirectTbMessage(event);
        return {
          matched: true,
          trigger: "tb",
          ...result,
        };
      }

      if (isSqtb) {
        const result = await handleDirectSqtbMessage(event);
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
    listHistory,
    approveRequest,
    rejectRequest,
    resetRound,
    resetPeriodQuotas,
    resetPlayerQuota,
    clearHistory,

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
    broadcastOnApproved: pluginConfig.broadcastOnApproved !== false,
    broadcastOnViolation: pluginConfig.broadcastOnViolation !== false,
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
