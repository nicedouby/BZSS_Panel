// -*- coding: utf-8 -*-

/**
 * TK apology guard
 *
 * Deliberately consumes only the remote TEAM_KILL core event.  Log derived
 * combat events are not subscribed to here, so one kill can never create two
 * apology cases through the log pipeline.
 */
const PLUGIN_ID = "plugin.team-kill-duration-warning";
const CONFIG_KEY = "plugins.teamKillApology";
const PAGE_ROUTE = "/tk-apology";
const DEFAULT_DEADLINE_SECONDS = 600;
const DEFAULT_REMINDER_SECONDS = 60;
const MAX_HISTORY = 300;
const APOLOGY_WORDS = [
  "sorry", "sry", "sor", "sory", "apologize", "apologies", "my bad",
  "抱歉", "对不起", "不好意思", "不好意思啊", "dbq", "抱一丝", "歉意",
];

export function createPlugin(context = {}) {
  const { core = {}, modules = {}, config = null, logger = console } = context;
  const unsubscribers = [];
  const pendingByPlayer = new Map();
  const tkCountByPlayer = new Map();
  const handledEventIds = new Map();
  const history = [];
  const chatHistory = [];
  let timer = null;
  let runtimeConfig = readConfig(config);
  let serial = Promise.resolve();

  const state = {
    lastResetAt: new Date().toISOString(),
    lastResetReason: "startup",
    lastError: "",
    totalTeamKills: 0,
    totalApologies: 0,
    totalHandled: 0,
    totalBroadcasts: 0,
    totalWarnings: 0,
  };

  function enqueue(task) {
    const next = serial.then(task, task);
    serial = next.catch(() => {});
    return next;
  }

  function isSubscribed() {
    const check = core?.pluginSubscriptions?.isSubscribed;
    return typeof check !== "function" || check(PLUGIN_ID) !== false;
  }

  function isActive() {
    return runtimeConfig.enabled && isSubscribed();
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeText(value, fallback = "") {
    // NFKC accepts full-width Latin input such as ＳＯＲＲＹ while retaining
    // normal player names and identifiers for matching.
    const text = String(value ?? "").normalize("NFKC").trim();
    return text || fallback;
  }

  function normalizeName(value) {
    return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
  }

  // Apology matching is deliberately case-insensitive: sorry, SORRY and
  // SoRrY must all normalize to the same text before keyword matching.
  function normalizeApologyText(value) {
    return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
  }

  function normalizeIdentity(value) {
    return normalizeText(value);
  }

  function identityKey(identity = {}) {
    const steamId = normalizeIdentity(identity.steamId ?? identity.steamID ?? identity.steam64ID);
    if (steamId) return `steam:${steamId}`;
    const eosId = normalizeIdentity(identity.eosId ?? identity.eosID);
    if (eosId) return `eos:${eosId}`;
    const name = normalizeName(identity.name ?? identity.playerName);
    return name ? `name:${name}` : "";
  }

  function resolveRecord(event = {}) {
    return event?.record ?? event?.payload?.record ?? event?.payload ?? event?.data?.record ?? event?.data ?? event ?? {};
  }

  function resolveIdentity(record = {}, side = "attacker") {
    const nested = record?.[side] && typeof record[side] === "object" ? record[side] : {};
    const prefix = side === "attacker" ? "attacker" : "victim";
    return {
      name: normalizeText(record?.[`${prefix}Name`] ?? record?.[side === "attacker" ? "killerName" : "victim"] ?? nested.name ?? nested.playerName),
      steamId: normalizeIdentity(record?.[`${prefix}Steam64ID`] ?? record?.[`${prefix}SteamId`] ?? record?.[`${prefix}SteamID`] ?? nested.steamId ?? nested.steamID ?? nested.steam64ID),
      eosId: normalizeIdentity(record?.[`${prefix}EOSID`] ?? record?.[`${prefix}EosID`] ?? nested.eosId ?? nested.eosID),
      playerId: normalizeIdentity(record?.[`${prefix}PlayerID`] ?? record?.[`${prefix}PlayerId`] ?? nested.playerId ?? nested.playerID),
    };
  }

  function resolveLivePlayer(serverId, identity) {
    const playerState = modules?.playerState;
    const live = identity.steamId && playerState?.getPlayerBySteamID?.(serverId, identity.steamId)
      || identity.eosId && playerState?.getPlayerByEOSID?.(serverId, identity.eosId)
      || identity.playerId && playerState?.getPlayerByControllerID?.(serverId, identity.playerId)
      || identity.name && playerState?.getPlayerByName?.(serverId, identity.name)
      || null;
    if (!live) return identity;
    return {
      name: normalizeText(live.name, identity.name),
      steamId: normalizeIdentity(live.steamId ?? live.steamID ?? live.steam64ID ?? identity.steamId),
      eosId: normalizeIdentity(live.eosId ?? live.eosID ?? identity.eosId),
      playerId: normalizeIdentity(live.playerId ?? live.playerID ?? live.controllerID ?? identity.playerId),
      playerKey: normalizeIdentity(live.playerKey),
    };
  }

  function buildEventId(event, record) {
    return normalizeText(event?.eventId ?? record?.sourceEventId ?? record?.id)
      || [record?.time ?? event?.time, record?.attackerSteam64ID ?? record?.attackerName, record?.victimSteam64ID ?? record?.victimName].map(normalizeText).join("|");
  }

  function alreadyHandled(eventId) {
    const now = Date.now();
    for (const [key, time] of handledEventIds) {
      if (now - time > 15 * 60_000) handledEventIds.delete(key);
    }
    if (!eventId || handledEventIds.has(eventId)) return true;
    handledEventIds.set(eventId, now);
    return false;
  }

  function pushHistory(entry = {}) {
    history.push({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, at: nowIso(), ...entry });
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  }

  function pushChatHistory(entry = {}) {
    chatHistory.push({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, at: nowIso(), ...entry });
    if (chatHistory.length > MAX_HISTORY) chatHistory.splice(0, chatHistory.length - MAX_HISTORY);
  }

  async function warnPlayer(target, message, reason, relatedEventId) {
    const sender = modules?.adminWarn?.sendAdminWarn ?? modules?.adminWarn?.warnPlayer;
    if (typeof sender !== "function") throw new Error("adminWarn API unavailable");
    const result = await sender.call(modules.adminWarn, {
      targetName: target.name,
      targetSteamId: target.steamId || undefined,
      targetEosId: target.eosId || undefined,
      message,
      reason,
      sourceModule: PLUGIN_ID,
      relatedEventId,
      system: true,
    });
    if (result?.success) state.totalWarnings += 1;
    return result;
  }

  async function broadcast(message, reason, relatedEventId) {
    const sender = modules?.adminWarn?.sendAdminBroadcast ?? modules?.adminWarn?.broadcastMessage;
    if (typeof sender !== "function") throw new Error("adminWarn broadcast API unavailable");
    const result = await sender.call(modules.adminWarn, {
      message,
      reason,
      sourceModule: PLUGIN_ID,
      relatedEventId,
      system: true,
    });
    if (result?.success) state.totalBroadcasts += 1;
    return result;
  }

  function remainingSeconds(caseItem, now = Date.now()) {
    return Math.max(0, Math.ceil((caseItem.deadlineAtMs - now) / 1000));
  }

  function makeInitialWarning(caseItem) {
    return `[TK处理] 你击杀了队友 ${caseItem.victim.name || "未知玩家"}，请在 ${runtimeConfig.deadlineSeconds} 秒内输入 Sorry 道歉。`;
  }

  function makeReminder(caseItem, remaining) {
    return `[TK处理] 你仍未输入 Sorry，请在 ${remaining} 秒内完成道歉，否则将被处理。`;
  }

  function makeBroadcast(caseItem, tkCount) {
    return `[TK] ${caseItem.attacker.name || "未知玩家"} 攻击了队友 ${caseItem.victim.name || "未知玩家"}，本局已 TK ${tkCount} 名队友。`;
  }

  function makeFinalWarning() {
    return "[TK处理] 你未在规定时间内完成道歉，现已开始执行处理。";
  }

  function makeTimeoutBroadcast(caseItem) {
    return `[TK] ${caseItem.attacker.name || "未知玩家"} 未在规定时间内完成道歉，现已执行处理。`;
  }

  async function handleTeamKill(event = {}) {
    // This check is intentionally strict: this plugin does not consume
    // combat-state, combat-clean, or any log parser event.
    if (String(event?.eventName ?? "TEAM_KILL").toUpperCase() !== "TEAM_KILL") return null;
    const record = resolveRecord(event);
    const eventId = buildEventId(event, record);
    if (alreadyHandled(eventId)) return null;
    if (!isActive()) return null;

    const serverId = normalizeText(record?.serverId ?? event?.serverId ?? core?.webStatus?.serverId);
    const attacker = resolveLivePlayer(serverId, resolveIdentity(record, "attacker"));
    const victim = resolveLivePlayer(serverId, resolveIdentity(record, "victim"));
    const playerKey = identityKey(attacker);
    if (!playerKey || !attacker.name) {
      pushHistory({ kind: "team_kill", eventId, success: false, skipped: true, reason: "attacker_identity_missing", serverId, attacker, victim });
      return null;
    }

    const now = Date.now();
    const tkCount = (tkCountByPlayer.get(playerKey)?.count ?? 0) + 1;
    tkCountByPlayer.set(playerKey, { count: tkCount, attacker: { ...attacker }, updatedAt: nowIso() });
    state.totalTeamKills += 1;

    const previous = pendingByPlayer.get(playerKey);
    const caseItem = {
      id: eventId || `tk:${now}:${Math.random().toString(16).slice(2)}`,
      eventId,
      serverId,
      attacker,
      victim,
      tkCount,
      createdAt: nowIso(),
      createdAtMs: now,
      deadlineAtMs: now + runtimeConfig.deadlineSeconds * 1000,
      deadlineAt: new Date(now + runtimeConfig.deadlineSeconds * 1000).toISOString(),
      lastReminderAtMs: now,
      reminderCount: 0,
      status: "pending",
      source: "remote_TEAM_KILL",
    };
    pendingByPlayer.set(playerKey, caseItem);

    await enqueue(async () => {
      try {
        await broadcast(makeBroadcast(caseItem, tkCount), "tk_apology_broadcast", caseItem.id);
        await warnPlayer(attacker, makeInitialWarning(caseItem), "tk_apology_initial", caseItem.id);
        pushHistory({ kind: "team_kill", success: true, serverId, eventId: caseItem.id, attacker, victim, tkCount, replacedPending: Boolean(previous) });
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : String(error);
        pushHistory({ kind: "team_kill", success: false, serverId, eventId: caseItem.id, attacker, victim, tkCount, error: state.lastError });
        logger?.warn?.(`[TKApology] initial notification failed: ${state.lastError}`);
      }
    });
    return caseItem;
  }

  function isApology(message) {
    const normalized = normalizeApologyText(message);
    return normalized && APOLOGY_WORDS.some((word) => normalized.includes(normalizeApologyText(word)));
  }

  function resolveChatIdentity(event = {}) {
    const record = event?.record ?? event?.payload ?? event?.data ?? event;
    return {
      name: normalizeText(record?.playerName ?? record?.player_name ?? record?.name),
      steamId: normalizeIdentity(record?.steamId ?? record?.steamID ?? record?.steamid ?? record?.steam64Id ?? record?.steam64ID ?? record?.steam),
      eosId: normalizeIdentity(record?.eosId ?? record?.eosID ?? record?.eosid ?? record?.eos),
      playerId: normalizeIdentity(record?.playerId ?? record?.playerID ?? record?.controllerId ?? record?.controllerID ?? record?.id),
      playerKey: normalizeIdentity(record?.playerKey),
    };
  }

  function sameIdentity(left = {}, right = {}) {
    const same = (a, b) => {
      const leftValue = normalizeIdentity(a).toLowerCase();
      const rightValue = normalizeIdentity(b).toLowerCase();
      return Boolean(leftValue && rightValue && leftValue === rightValue);
    };
    return same(left.steamId, right.steamId)
      || same(left.eosId, right.eosId)
      || same(left.playerId, right.playerId)
      || same(left.playerKey, right.playerKey)
      || (normalizeName(left.name) && normalizeName(left.name) === normalizeName(right.name));
  }

  function findPendingCase(identity, serverId) {
    // Chat can arrive with only an EOSID while TEAM_KILL used SteamID, or
    // with a renamed display name. Resolve against live player state first.
    const liveIdentity = resolveLivePlayer(serverId, identity);
    for (const candidate of [liveIdentity, identity]) {
      const directKey = identityKey(candidate);
      const directCase = directKey ? pendingByPlayer.get(directKey) : null;
      if (directCase) return { playerKey: directKey, caseItem: directCase };
    }
    for (const [key, item] of pendingByPlayer) {
      if (sameIdentity(item.attacker, liveIdentity) || sameIdentity(item.attacker, identity)) {
        return { playerKey: key, caseItem: item };
      }
    }
    return { playerKey: "", caseItem: null };
  }

  async function handleChat(event = {}) {
    const record = event?.record ?? event?.payload ?? event?.data ?? event;
    const message = normalizeText(record?.message ?? record?.text ?? record?.msg ?? record?.content);
    if (!isActive()) return null;
    const identity = resolveChatIdentity(event);
    const serverId = normalizeText(record?.serverId ?? event?.serverId ?? core?.webStatus?.serverId);
    const apology = Boolean(isApology(message));
    const { playerKey, caseItem } = findPendingCase(identity, serverId);
    const chatEntry = {
      serverId,
      channel: normalizeText(record?.channel ?? record?.chatChannel, "unknown"),
      playerName: identity.name,
      steamId: identity.steamId,
      eosId: identity.eosId,
      playerId: identity.playerId,
      message,
      apology,
      matched: Boolean(caseItem && playerKey && remainingSeconds(caseItem) > 0),
      caseId: caseItem?.id ?? "",
      tkVictim: caseItem?.victim?.name ?? "",
    };
    pushChatHistory(chatEntry);
    if (!apology) return null;
    if (!caseItem || !playerKey) {
      pushHistory({ kind: "chat_unmatched", success: false, serverId, player: identity, message, reason: "no_pending_case" });
      return null;
    }
    if (remainingSeconds(caseItem) <= 0) {
      pushHistory({ kind: "chat_unmatched", success: false, serverId, player: identity, message, reason: "case_expired", eventId: caseItem.id });
      return null;
    }

    pendingByPlayer.delete(playerKey);
    state.totalApologies += 1;
    await enqueue(async () => {
      try {
        await warnPlayer(caseItem.attacker, `[TK处理] 已收到你的道歉。`, "tk_apology_received", caseItem.id);
        pushHistory({ kind: "apology", success: true, eventId: caseItem.id, attacker: caseItem.attacker, victim: caseItem.victim, message, tkCount: caseItem.tkCount });
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : String(error);
        pushHistory({ kind: "apology", success: false, eventId: caseItem.id, attacker: caseItem.attacker, victim: caseItem.victim, message, error: state.lastError });
      }
    });
    return caseItem;
  }

  async function executeHandling(caseItem) {
    const request = {
      serverId: caseItem.serverId,
      name: caseItem.attacker.name,
      steamId: caseItem.attacker.steamId,
      eosId: caseItem.attacker.eosId,
      playerId: caseItem.attacker.playerId,
      playerKey: caseItem.attacker.playerKey,
      reason: "TK apology timeout",
      source: PLUGIN_ID,
      system: true,
    };
    const action = runtimeConfig.timeoutAction;
    if (action === "remove_from_squad") {
      const result = await modules?.squadManagement?.executeAction?.({ ...request, type: "remove_from_squad" });
      if (!result) throw new Error("squadManagement API unavailable");
      return result;
    }
    if (action === "kick_player") {
      const result = await modules?.squadManagement?.executeAction?.({ ...request, type: "kick_player" });
      if (!result) throw new Error("squadManagement API unavailable");
      return result;
    }
    if (action === "kill_player") {
      // AdminSlay is name-based on Squad RCON; do not pass a controller id
      // here because it is not a stable RCON player identifier.
      const target = request.name || request.playerId;
      if (!target || typeof core?.rconManager?.dispatchCommand !== "function") {
        throw new Error("RCON kill command unavailable");
      }
      return await core.rconManager.dispatchCommand({
        command: `AdminSlay ${escapeRconArgument(target)}`,
        requestedBy: PLUGIN_ID,
        reason: "tk_apology_timeout",
        sourceEventId: caseItem.id,
        priority: "high",
        system: true,
      });
    }
    throw new Error(`Unsupported timeout action: ${action}`);
  }

  async function tick() {
    if (!isActive()) return;
    const now = Date.now();
    for (const [playerKey, caseItem] of [...pendingByPlayer]) {
      const remaining = remainingSeconds(caseItem, now);
      if (remaining <= 0) {
        pendingByPlayer.delete(playerKey);
        await enqueue(async () => {
          try {
            // Warn first without revealing the configured action. Notification
            // failures must not prevent the timeout action from being applied.
            const notifications = await Promise.allSettled([
              warnPlayer(caseItem.attacker, makeFinalWarning(), "tk_apology_timeout_warning", caseItem.id),
              broadcast(makeTimeoutBroadcast(caseItem), "tk_apology_timeout_broadcast", caseItem.id),
            ]);
            const result = await executeHandling(caseItem);
            state.totalHandled += 1;
            pushHistory({
              kind: "timeout_handled",
              success: Boolean(result?.ok ?? result?.success),
              eventId: caseItem.id,
              attacker: caseItem.attacker,
              victim: caseItem.victim,
              action: runtimeConfig.timeoutAction,
              notifications: notifications.map((entry) => entry.status),
              result,
            });
          } catch (error) {
            state.lastError = error instanceof Error ? error.message : String(error);
            pushHistory({ kind: "timeout_handled", success: false, eventId: caseItem.id, attacker: caseItem.attacker, victim: caseItem.victim, action: runtimeConfig.timeoutAction, error: state.lastError });
            logger?.warn?.(`[TKApology] timeout handling failed: ${state.lastError}`);
          }
        });
        continue;
      }
      if (now - caseItem.lastReminderAtMs < runtimeConfig.reminderSeconds * 1000) continue;
      caseItem.lastReminderAtMs = now;
      caseItem.reminderCount += 1;
      await enqueue(async () => {
        try {
          await warnPlayer(caseItem.attacker, makeReminder(caseItem, remaining), "tk_apology_reminder", caseItem.id);
          pushHistory({ kind: "reminder", success: true, eventId: caseItem.id, attacker: caseItem.attacker, victim: caseItem.victim, remaining });
        } catch (error) {
          state.lastError = error instanceof Error ? error.message : String(error);
          pushHistory({ kind: "reminder", success: false, eventId: caseItem.id, attacker: caseItem.attacker, victim: caseItem.victim, remaining, error: state.lastError });
        }
      });
    }
  }

  function resetMatch(reason = "match_reset") {
    const pendingCount = pendingByPlayer.size;
    pendingByPlayer.clear();
    tkCountByPlayer.clear();
    handledEventIds.clear();
    state.totalTeamKills = 0;
    state.totalApologies = 0;
    state.totalHandled = 0;
    state.totalBroadcasts = 0;
    state.totalWarnings = 0;
    state.lastError = "";
    chatHistory.length = 0;
    state.lastResetAt = nowIso();
    state.lastResetReason = reason;
    pushHistory({ kind: "match_reset", success: true, reason, pendingCount });
    return getState();
  }

  function updateConfig(patch = {}) {
    runtimeConfig = { ...runtimeConfig, ...normalizeConfig(patch, runtimeConfig) };
    config?.set?.(CONFIG_KEY, { ...runtimeConfig });
    void config?.save?.().catch(() => {});
    return getState();
  }

  function setEnabled(enabled) {
    return updateConfig({ enabled: Boolean(enabled) });
  }

  function getState() {
    const now = Date.now();
    const pending = [...pendingByPlayer.values()]
      .map((item) => ({ ...item, remainingSeconds: remainingSeconds(item, now) }))
      .sort((a, b) => a.deadlineAtMs - b.deadlineAtMs);
    const players = [...tkCountByPlayer.entries()]
      .map(([key, item]) => ({ key, ...item }))
      .sort((a, b) => b.count - a.count || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return {
      enabled: runtimeConfig.enabled,
      subscribed: isSubscribed(),
      active: isActive(),
      config: { ...runtimeConfig, apologyWords: [...APOLOGY_WORDS] },
      summary: {
        pending: pending.length,
        totalTeamKills: state.totalTeamKills,
        totalApologies: state.totalApologies,
        totalHandled: state.totalHandled,
        totalBroadcasts: state.totalBroadcasts,
        totalWarnings: state.totalWarnings,
      },
      pending,
      players,
      history: [...history].reverse(),
      chats: [...chatHistory].reverse(),
      lastError: state.lastError,
      lastResetAt: state.lastResetAt,
      lastResetReason: state.lastResetReason,
    };
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "TK 道歉处理",
      kind: "plugin",
      version: "2.0.0",
      category: "Moderation",
      description: "仅订阅远端 TEAM_KILL 事件，要求 TK 玩家在时限内通过聊天道歉。",
    },
    apiName: "teamKillApology",
    api: { getState, resetMatch, updateConfig, setEnabled, handleTeamKill, handleChat, tick },

    async start() {
      runtimeConfig = readConfig(config);
      core?.webRegistry?.registerPage?.({
        id: "web.teamKillApology",
        title: "TK 道歉处理",
        group: "战斗",
        route: PAGE_ROUTE,
        pageModule: "/pages/tk-apology.js",
        source: PLUGIN_ID,
        description: "远端 TK 事件的道歉、倒计时与处理状态。",
        required: false,
        enabled: true,
        order: 34,
        icon: "TK",
      });
      if (typeof core?.eventBus?.onCoreEvent === "function") {
        unsubscribers.push(core.eventBus.onCoreEvent("TEAM_KILL", (event) => { void handleTeamKill(event); }));
        unsubscribers.push(core.eventBus.onCoreEvent("round.world_bring_up", () => resetMatch("round_world_bring_up")));
      }
      if (typeof core?.eventBus?.onModuleEvent === "function") {
        unsubscribers.push(core.eventBus.onModuleEvent("module.chatManager", "CHAT_RECEIVED", (event) => { void handleChat(event); }));
        unsubscribers.push(core.eventBus.onModuleEvent("module.matchState", "matchChanged", () => resetMatch("match_changed")));
      }
      timer = setInterval(() => { void tick(); }, 1_000);
      timer.unref?.();
      logger?.info?.("[TKApology] plugin started; listening only to remote TEAM_KILL.");
    },

    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      for (const unsubscribe of unsubscribers.splice(0)) {
        try { unsubscribe?.(); } catch {}
      }
      pendingByPlayer.clear();
      tkCountByPlayer.clear();
      handledEventIds.clear();
    },
  };
}

function readConfig(config) {
  return normalizeConfig(config?.get?.(CONFIG_KEY, {}) ?? {}, {
    enabled: true,
    deadlineSeconds: DEFAULT_DEADLINE_SECONDS,
    reminderSeconds: DEFAULT_REMINDER_SECONDS,
    timeoutAction: "remove_from_squad",
  });
}

function normalizeConfig(raw = {}, fallback = {}) {
  const deadlineSeconds = positiveInteger(raw.deadlineSeconds, fallback.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS, 30, 3600);
  const reminderSeconds = positiveInteger(raw.reminderSeconds, fallback.reminderSeconds ?? DEFAULT_REMINDER_SECONDS, 10, deadlineSeconds);
  const action = String(raw.timeoutAction ?? fallback.timeoutAction ?? "remove_from_squad").trim();
  return {
    enabled: raw.enabled === undefined ? Boolean(fallback.enabled ?? true) : Boolean(raw.enabled),
    deadlineSeconds,
    reminderSeconds,
    timeoutAction: ["remove_from_squad", "kill_player", "kick_player"].includes(action) ? action : "remove_from_squad",
  };
}

function positiveInteger(value, fallback, min, max) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function escapeRconArgument(value) {
  return `"${String(value ?? "").replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

export default createPlugin;
