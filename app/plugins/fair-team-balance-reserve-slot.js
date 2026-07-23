// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const PLUGIN_ID = "plugin.fairTeamBalanceReserveSlot";
const PARENT_PLUGIN_ID = "plugin.fairTeamBalance";
const TRIGGER_PATTERN = /^YLW\s*TB$/i;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DATA_DIR = "./data/fair-team-balance";
const DEFAULT_MIN_RESERVE_DAYS = 15;
const DEFAULT_MAX_PROJECTED_TEAM_DELTA = 8;
const DEFAULT_VARIANCE_DAYS = 3;
const EVENT_DEDUPE_TTL_MS = 2 * 60 * 1000;

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger = logger
    ?? core?.createLogger?.({ moduleId: PLUGIN_ID, source: PLUGIN_ID, channel: "module" })
    ?? core?.logger
    ?? console;
  const runtimeConfig = readConfig(config);
  const dataDir = path.resolve(process.cwd(), runtimeConfig.directory);
  const unsubscribers = [];
  const recentEventIds = new Map();
  let serial = Promise.resolve();

  function enqueue(task) {
    const next = serial.then(() => task(), () => task());
    serial = next.catch(() => {});
    return next;
  }

  function isSubscribed(pluginId) {
    return modules?.pluginSubscriptions?.isSubscribed?.(pluginId) !== false
      && core?.pluginSubscriptions?.isSubscribed?.(pluginId) !== false;
  }

  function isActive() {
    return runtimeConfig.enabled
      && isSubscribed(PLUGIN_ID)
      && isSubscribed(PARENT_PLUGIN_ID);
  }

  function getServerId(event = {}) {
    return normalizeText(event?.serverId ?? core?.webStatus?.serverId);
  }

  function getMatchState(serverId = "") {
    return modules?.squadManagement?.getState?.(serverId) ?? null;
  }

  function findOnlinePlayer(matchState, event = {}) {
    const players = Array.isArray(matchState?.players) ? matchState.players : [];
    const steamId = normalizeText(event?.steamId ?? event?.steamID ?? event?.steamid);
    const eosId = normalizeText(event?.eosId ?? event?.eosID ?? event?.eosid);
    const playerName = normalizeText(event?.playerName ?? event?.name ?? event?.player_name);
    return players.find((player) => {
      if (steamId && normalizeText(player?.steamId ?? player?.steamID) === steamId) return true;
      if (eosId && normalizeText(player?.eosId ?? player?.eosID) === eosId) return true;
      return Boolean(playerName && normalizeText(player?.name ?? player?.playerName) === playerName);
    }) ?? null;
  }

  function buildActor(player, event = {}) {
    return {
      playerName: normalizeText(player?.name ?? player?.playerName ?? event?.playerName ?? event?.name),
      steamId: normalizeText(player?.steamId ?? player?.steamID ?? event?.steamId ?? event?.steamID),
      eosId: normalizeText(player?.eosId ?? player?.eosID ?? event?.eosId ?? event?.eosID),
      teamId: Number(player?.teamId ?? player?.teamID ?? event?.teamId ?? event?.teamID ?? 0),
    };
  }

  async function warnPlayer(actor, message, reason, event = {}) {
    const warn = modules?.adminWarn?.sendAdminWarn ?? modules?.adminWarn?.warnPlayer;
    if (typeof warn !== "function" || !actor?.playerName) return;
    try {
      await warn({
        targetName: actor.playerName,
        targetSteamId: actor.steamId,
        targetEosId: actor.eosId,
        message,
        reason,
        sourceModule: PLUGIN_ID,
        relatedEventId: normalizeText(event?.id ?? event?.seq),
        system: true,
      });
    } catch (error) {
      pluginLogger?.warn?.(`[ReserveSlotTB] warn failed: ${error?.message ?? error}`);
    }
  }

  async function broadcast(message, reason, event = {}) {
    const send = modules?.adminWarn?.sendAdminBroadcast ?? modules?.adminWarn?.broadcastMessage;
    if (typeof send !== "function") return;
    try {
      await send({
        message,
        reason,
        sourceModule: PLUGIN_ID,
        relatedEventId: normalizeText(event?.id ?? event?.seq),
        system: true,
      });
    } catch (error) {
      pluginLogger?.warn?.(`[ReserveSlotTB] broadcast failed: ${error?.message ?? error}`);
    }
  }

  async function appendAudit(entry = {}) {
    try {
      const now = new Date();
      await fs.mkdir(dataDir, { recursive: true });
      const dateKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
      await fs.appendFile(
        path.join(dataDir, `reserve-slot-${dateKey}.jsonl`),
        `${JSON.stringify({ at: now.toISOString(), type: "RESERVE_SLOT_TB", ...entry })}\n`,
        "utf8",
      );
    } catch (error) {
      pluginLogger?.warn?.(`[ReserveSlotTB] audit write failed: ${error?.message ?? error}`);
    }
  }

  function isDuplicateEvent(event = {}) {
    const now = Date.now();
    for (const [eventId, seenAt] of recentEventIds) {
      if (now - seenAt > EVENT_DEDUPE_TTL_MS) recentEventIds.delete(eventId);
    }
    const eventId = normalizeText(event?.id ?? event?.seq);
    if (!eventId) return false;
    if (recentEventIds.has(eventId)) return true;
    recentEventIds.set(eventId, now);
    return false;
  }

  async function reject(actor, event, error, message, extra = {}) {
    await appendAudit({
      status: "rejected",
      error,
      message,
      playerName: actor?.playerName,
      steamId: actor?.steamId,
      eosId: actor?.eosId,
      teamId: actor?.teamId,
      sourceMessageId: normalizeText(event?.id ?? event?.seq),
      ...extra,
    });
    await warnPlayer(actor, `预留位跳边失败: ${message}`, "reserve_slot_tb_rejected", event);
    return { ok: false, error, message };
  }

  async function handleReserveSlotTb(event = {}) {
    const serverId = getServerId(event);
    const matchState = getMatchState(serverId);
    const player = findOnlinePlayer(matchState, event);
    const actor = buildActor(player, event);

    if (!matchState || !player) return reject(actor, event, "PlayerUnavailable", "未找到当前在线玩家状态。");
    if (!actor.steamId) return reject(actor, event, "SteamIdMissing", "玩家 SteamID 无效，无法读取预留位。");
    if (actor.teamId !== 1 && actor.teamId !== 2) return reject(actor, event, "InvalidTeam", "玩家必须位于队伍 1 或队伍 2。");
    if (typeof modules?.reserveSlots?.getState !== "function" || typeof modules?.reserveSlots?.upsertMember !== "function") {
      return reject(actor, event, "ReserveSlotsUnavailable", "预留位模块当前不可用。");
    }
    if (typeof modules?.teamBalance?.forceTeamChange !== "function") {
      return reject(actor, event, "TeamBalanceUnavailable", "队伍平衡模块当前不可用。");
    }

    const teamCheck = calculateProjectedTeamDelta(matchState?.players, actor.teamId);
    if (!teamCheck.ok) return reject(actor, event, teamCheck.error, teamCheck.message, teamCheck);
    if (teamCheck.projectedDelta > runtimeConfig.maxProjectedTeamDelta) {
      return reject(
        actor,
        event,
        "ProjectedTeamDeltaExceeded",
        `跳边后双方人数差将为 ${teamCheck.projectedDelta}，超过允许的 ${runtimeConfig.maxProjectedTeamDelta} 人。`,
        teamCheck,
      );
    }

    let reserveState;
    try {
      reserveState = await modules.reserveSlots.getState();
    } catch (error) {
      return reject(actor, event, "ReserveStateReadFailed", "读取预留位数据失败。", {
        detail: normalizeText(error?.message),
      });
    }

    const reserveMember = (Array.isArray(reserveState?.members) ? reserveState.members : [])
      .find((member) => normalizeText(member?.steamId ?? member?.steamID) === actor.steamId) ?? null;
    if (!reserveMember) return reject(actor, event, "ReserveSlotNotFound", "未找到该玩家的有效预留位。");

    const oldExpireAt = normalizeText(reserveMember?.expireAt);
    const oldExpireMs = parseReserveExpireAt(oldExpireAt);
    if (!oldExpireMs) return reject(actor, event, "InvalidReserveExpireAt", "预留位到期时间无效。");

    const nowMs = Date.now();
    const remainingDaysBefore = calculateRemainingReserveDays(oldExpireMs, nowMs);
    if (remainingDaysBefore < runtimeConfig.minReserveDays) {
      return reject(
        actor,
        event,
        "ReserveDaysInsufficient",
        `预留位至少需要 ${runtimeConfig.minReserveDays} 天，当前仅剩 ${remainingDaysBefore} 天。`,
        { remainingDaysBefore, oldExpireAt },
      );
    }

    const costDays = calculateReserveSlotSwitchCost(remainingDaysBefore, {
      varianceDays: runtimeConfig.varianceDays,
    });
    const newExpireMs = oldExpireMs - costDays * DAY_MS;
    const newExpireAt = formatReserveExpireAt(newExpireMs);
    const remainingDaysAfter = calculateRemainingReserveDays(newExpireMs, nowMs);
    const deductionInput = buildReserveMemberUpdate(reserveMember, actor.steamId, newExpireAt);
    const refundInput = buildReserveMemberUpdate(reserveMember, actor.steamId, oldExpireAt);

    try {
      await modules.reserveSlots.upsertMember(deductionInput);
    } catch (error) {
      return reject(actor, event, "ReserveDeductionFailed", "预留位日期扣除失败，未执行跳边。", {
        remainingDaysBefore,
        costDays,
        oldExpireAt,
        newExpireAt,
        detail: normalizeText(error?.message),
      });
    }

    let switchResult;
    try {
      switchResult = await modules.teamBalance.forceTeamChange({
        steamId: actor.steamId,
        playerName: actor.playerName,
        source: `${PLUGIN_ID}.ylw_tb`,
        reason: "reserve_slot_tb_chat",
        operator: {
          id: PLUGIN_ID,
          name: "FairTeamBalanceReserveSlot",
          username: "FairTeamBalanceReserveSlot",
          role: "system",
          isSuperAdmin: true,
          permissions: ["*"],
        },
        system: true,
      });
    } catch (error) {
      switchResult = {
        ok: false,
        error: "TeamSwitchException",
        message: normalizeText(error?.message) || "跳边执行异常。",
      };
    }

    if (!switchResult?.ok) {
      let refundOk = false;
      let refundError = "";
      try {
        await modules.reserveSlots.upsertMember(refundInput);
        refundOk = true;
      } catch (error) {
        refundError = normalizeText(error?.message);
      }

      const failureMessage = normalizeText(switchResult?.message) || "队伍切换被拒绝。";
      await appendAudit({
        status: "switch_failed",
        error: normalizeText(switchResult?.error) || "TeamBalanceRejected",
        message: failureMessage,
        playerName: actor.playerName,
        steamId: actor.steamId,
        eosId: actor.eosId,
        sourceMessageId: normalizeText(event?.id ?? event?.seq),
        remainingDaysBefore,
        costDays,
        oldExpireAt,
        newExpireAt,
        refundOk,
        refundError,
        ...teamCheck,
      });

      if (!refundOk) {
        pluginLogger?.error?.(`[ReserveSlotTB] CRITICAL refund failed steamId=${actor.steamId} oldExpireAt=${oldExpireAt} error=${refundError}`);
        await warnPlayer(
          actor,
          `预留位跳边失败且日期自动返还异常，请联系管理员。原到期时间: ${oldExpireAt}`,
          "reserve_slot_tb_refund_failed",
          event,
        );
        return { ok: false, error: "ReserveRefundFailed", message: failureMessage, refundOk: false };
      }

      await warnPlayer(actor, `预留位跳边失败: ${failureMessage}，已返还 ${costDays} 天。`, "reserve_slot_tb_switch_rejected", event);
      return {
        ok: false,
        error: normalizeText(switchResult?.error) || "TeamBalanceRejected",
        message: failureMessage,
        refundOk: true,
      };
    }

    await appendAudit({
      status: "executed",
      playerName: actor.playerName,
      steamId: actor.steamId,
      eosId: actor.eosId,
      sourceMessageId: normalizeText(event?.id ?? event?.seq),
      remainingDaysBefore,
      remainingDaysAfter,
      costDays,
      oldExpireAt,
      newExpireAt,
      teamBalanceResult: {
        ok: true,
        message: normalizeText(switchResult?.message),
        command: normalizeText(switchResult?.command),
      },
      ...teamCheck,
    });

    await warnPlayer(actor, `预留位跳边成功: 本次扣除 ${costDays} 天，剩余约 ${remainingDaysAfter} 天。`, "reserve_slot_tb_success", event);
    await broadcast(
      `预留位跳边成功: ${actor.playerName || actor.steamId}，扣除 ${costDays} 天，剩余约 ${remainingDaysAfter} 天。`,
      "reserve_slot_tb_broadcast",
      event,
    );

    return {
      ok: true,
      trigger: "YLW TB",
      costDays,
      remainingDaysBefore,
      remainingDaysAfter,
      oldExpireAt,
      newExpireAt,
      projectedTeamDelta: teamCheck.projectedDelta,
      result: switchResult,
    };
  }

  function handleChatMessage(event = {}) {
    return enqueue(async () => {
      const message = normalizeTriggerMessage(event?.message);
      if (!TRIGGER_PATTERN.test(message)) return { matched: false };
      if (!isActive()) return { matched: true, skipped: true, reason: "plugin_disabled_or_unsubscribed" };
      if (isDuplicateEvent(event)) return { matched: true, skipped: true, reason: "duplicate_event" };
      const result = await handleReserveSlotTb(event);
      return { matched: true, trigger: "reserve_slot_tb", ...result };
    });
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "公平跳边·预留位通道",
      kind: "plugin",
      version: "1.0.0",
      description: "公平跳边的 YLW TB 专用通道；不消耗普通 TB 额度，以预留位日期作为代价。",
      category: "Moderation",
    },

    async start() {
      if (typeof modules?.chatManager?.on === "function") {
        unsubscribers.push(modules.chatManager.on("message", handleChatMessage));
      } else if (typeof core?.eventBus?.onModuleEvent === "function") {
        unsubscribers.push(core.eventBus.onModuleEvent("module.chatManager", "CHAT_RECEIVED", handleChatMessage));
      }
      pluginLogger?.info?.(`[ReserveSlotTB] started trigger=YLW TB minDays=${runtimeConfig.minReserveDays} maxProjectedDelta=${runtimeConfig.maxProjectedTeamDelta}`);
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {}
      }
      recentEventIds.clear();
      pluginLogger?.info?.("[ReserveSlotTB] stopped");
    },
  };
}

export function normalizeTriggerMessage(value) {
  return String(value ?? "")
    .replace(/[\u3000\u00a0]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function calculateProjectedTeamDelta(players = [], sourceTeamId = 0) {
  const source = Number(sourceTeamId);
  if (source !== 1 && source !== 2) {
    return {
      ok: false,
      error: "InvalidTeam",
      message: "玩家必须位于队伍 1 或队伍 2。",
      team1Count: 0,
      team2Count: 0,
      projectedTeam1Count: 0,
      projectedTeam2Count: 0,
      projectedDelta: Number.POSITIVE_INFINITY,
    };
  }

  let team1Count = 0;
  let team2Count = 0;
  for (const player of Array.isArray(players) ? players : []) {
    const teamId = Number(player?.teamId ?? player?.teamID ?? 0);
    if (teamId === 1) team1Count += 1;
    if (teamId === 2) team2Count += 1;
  }

  const projectedTeam1Count = team1Count + (source === 1 ? -1 : 1);
  const projectedTeam2Count = team2Count + (source === 2 ? -1 : 1);
  return {
    ok: true,
    team1Count,
    team2Count,
    currentDelta: Math.abs(team1Count - team2Count),
    projectedTeam1Count,
    projectedTeam2Count,
    projectedDelta: Math.abs(projectedTeam1Count - projectedTeam2Count),
  };
}

export function calculateReserveSlotSwitchCost(remainingDays, options = {}) {
  const days = Math.max(0, Math.floor(Number(remainingDays) || 0));
  const varianceDays = clampInteger(options.varianceDays, 0, 30, DEFAULT_VARIANCE_DAYS);
  const random = typeof options.random === "function" ? options.random : Math.random;

  let baseDays = 5;
  if (days > 90) baseDays = Math.max(1, Math.round(days / 10));
  else if (days >= 90) baseDays = 20;
  else if (days >= 60) baseDays = 15;
  else if (days > 30) baseDays = 10;

  const randomValue = Math.min(0.999999999, Math.max(0, Number(random()) || 0));
  const offset = varianceDays > 0
    ? Math.floor(randomValue * (varianceDays * 2 + 1)) - varianceDays
    : 0;
  return Math.max(1, Math.min(days, baseDays + offset));
}

export function parseReserveExpireAt(value) {
  const text = normalizeText(value);
  if (!text) return 0;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? text.replace(" ", "T")
    : text;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatReserveExpireAt(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function calculateRemainingReserveDays(expireAtOrMs, nowMs = Date.now()) {
  const expireMs = typeof expireAtOrMs === "number" ? expireAtOrMs : parseReserveExpireAt(expireAtOrMs);
  if (!expireMs) return 0;
  return Math.max(0, Math.floor((expireMs - Number(nowMs || Date.now())) / DAY_MS));
}

export function buildReserveMemberUpdate(member = {}, steamId = "", expireAt = "") {
  const reasons = Array.isArray(member?.reasons)
    ? member.reasons.map(normalizeText).filter(Boolean)
    : [];
  return {
    steamId: normalizeText(steamId ?? member?.steamId ?? member?.steamID),
    group: normalizeText(member?.group) || "BZSSVIP",
    name: normalizeText(member?.name),
    reason: normalizeText(member?.remark) || reasons.join("，"),
    expireAt: normalizeText(expireAt),
  };
}

function readConfig(config) {
  const pluginConfig = config?.get?.("plugins.fairTeamBalanceReserveSlot", {}) ?? {};
  return {
    enabled: pluginConfig.enabled !== false,
    directory: normalizeText(pluginConfig.directory) || DEFAULT_DATA_DIR,
    minReserveDays: clampInteger(pluginConfig.minReserveDays, 1, 36500, DEFAULT_MIN_RESERVE_DAYS),
    maxProjectedTeamDelta: clampInteger(pluginConfig.maxProjectedTeamDelta, 0, 100, DEFAULT_MAX_PROJECTED_TEAM_DELTA),
    varianceDays: clampInteger(pluginConfig.varianceDays, 0, 30, DEFAULT_VARIANCE_DAYS),
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

function pad2(value) {
  return String(value).padStart(2, "0");
}

export default { createPlugin };
