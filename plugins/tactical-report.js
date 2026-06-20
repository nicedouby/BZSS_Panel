// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const PLUGIN_ID = "plugin.tacticalReport";
const CONFIG_KEY = "plugins.tacticalReport";
const DEFAULT_DATA_FILE = "data/tactical-report-user-codes.json";
const DEFAULT_TRIGGER = "ZSBD";
const DEFAULT_PLAYER_COOLDOWN_SECONDS = 10;
const DEFAULT_HELP_GLOBAL_COOLDOWN_SECONDS = 30;
const DEFAULT_MAX_MESSAGE_LENGTH = 120;
const DEFAULT_RECENT_LIMIT = 500;

const DEFAULT_CODES = Object.freeze({
  "/0": "请注意地图标点",
  "/1": "发现敌方步兵",
  "/2": "发现敌方轻型载具",
  "/3": "发现敌方重型载具",
  "/4": "发现敌方坦克",
  "/5": "发现敌方 FOB / HAB",
  "/6": "我方需要支援",
  "/7": "敌方正在绕后",
  "/8": "敌方正在进攻我方点位",
  "/9": "请注意地图标点",
});

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

  let runtimeConfig = readConfig(config);
  const unsubscribers = [];
  const handledEventIds = new Set();
  const state = {
    enabled: runtimeConfig.enabled,
    triggerText: runtimeConfig.triggerText,
    triggerCount: 0,
    reportCount: 0,
    helpCount: 0,
    setCount: 0,
    rejectedCount: 0,
    lastError: "",
    lastReportAt: "",
    lastHelpAt: "",
    history: [],
    recentRecords: [],
    userCodes: {},
    helpCooldownUntilMs: 0,
    playerCooldowns: new Map(),
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function nowMs() {
    return Date.now();
  }

  function normalizeText(value) {
    return String(value ?? "").trim();
  }

  function normalizeMessage(value) {
    return normalizeText(value).replace(/\r\n?/g, "\n");
  }

  function normalizeCodeKey(value) {
    const text = normalizeText(value).toLowerCase();
    if (/^\/\d+$/.test(text)) return text;
    return text;
  }

  function normalizeSteamId(value) {
    return normalizeText(value);
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

  function pushHistory(entry) {
    const record = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: nowIso(),
      ...entry,
    };
    state.history.push(record);
    state.recentRecords.push(record);
    if (state.history.length > DEFAULT_RECENT_LIMIT) {
      state.history.splice(0, state.history.length - DEFAULT_RECENT_LIMIT);
    }
    if (state.recentRecords.length > DEFAULT_RECENT_LIMIT) {
      state.recentRecords.splice(0, state.recentRecords.length - DEFAULT_RECENT_LIMIT);
    }
  }

  function isHandled(event = {}) {
    const key = normalizeText(event?.id ?? event?.eventId ?? event?.seq ?? event?.time);
    if (!key) return false;
    if (handledEventIds.has(key)) return true;
    handledEventIds.add(key);
    if (handledEventIds.size > 200) handledEventIds.clear();
    return false;
  }

  function getConfig() {
    return cloneValue(runtimeConfig);
  }

  function getServerId(event = {}) {
    return normalizeText(event?.serverId ?? event?.payload?.serverId ?? core?.webStatus?.serverId ?? "");
  }

  function getPlayerList(serverId) {
    return modules?.playerState?.getPlayerList?.(serverId) ?? [];
  }

  function getPlayerBySteamId(serverId, steamId) {
    return modules?.playerState?.getPlayerBySteamID?.(serverId, steamId)
      ?? modules?.playerState?.findPlayer?.(serverId, { steamId })
      ?? getPlayerList(serverId).find((player) => normalizeSteamId(player?.steamID ?? player?.steamId) === normalizeSteamId(steamId))
      ?? null;
  }

  function getPlayerTeamId(player = {}) {
    const teamId = Number(player?.teamID ?? player?.teamId ?? player?.team);
    return Number.isFinite(teamId) && teamId > 0 ? teamId : null;
  }

  function getPlayerName(player = {}) {
    return normalizeText(player?.name ?? player?.playerName ?? "");
  }

  function getPlayerEosId(player = {}) {
    return normalizeText(player?.eosID ?? player?.eosId ?? "");
  }

  function getPlayerSteamId(player = {}) {
    return normalizeSteamId(player?.steamID ?? player?.steamId ?? player?.steamid ?? "");
  }

  function getWarnApi() {
    return modules?.adminWarn?.warnPlayer ?? modules?.adminWarn?.sendAdminWarn ?? null;
  }

  function getBroadcastApi() {
    return modules?.adminWarn?.broadcastMessage ?? modules?.adminWarn?.sendAdminBroadcast ?? null;
  }

  function getPlayerCooldownKey(steamId) {
    return `player:${normalizeSteamId(steamId)}`;
  }

  function getPlayerCooldownRemaining(steamId) {
    const until = Number(state.playerCooldowns.get(getPlayerCooldownKey(steamId)) ?? 0);
    if (!until || until <= nowMs()) return 0;
    return Math.max(1, Math.ceil((until - nowMs()) / 1000));
  }

  function setPlayerCooldown(steamId, seconds) {
    state.playerCooldowns.set(getPlayerCooldownKey(steamId), nowMs() + Math.max(0, seconds) * 1000);
  }

  function getHelpCooldownRemaining() {
    if (state.helpCooldownUntilMs <= nowMs()) return 0;
    return Math.max(1, Math.ceil((state.helpCooldownUntilMs - nowMs()) / 1000));
  }

  function setHelpCooldown(seconds) {
    state.helpCooldownUntilMs = nowMs() + Math.max(0, seconds) * 1000;
  }

  function sanitizeReportMessage(text) {
    return normalizeMessage(text)
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, runtimeConfig.maxMessageLength);
  }

  function sanitizeHelpTitle(text) {
    return normalizeText(text).replace(/\s+/g, " ");
  }

  function renderReportMessage(text) {
    const chunks = splitLongMessage(text, runtimeConfig.maxMessageLength);
    return [
      "[BZSS 战术报点 ]",
      ...chunks,
      "zsbd /help可获取战术报点使用指南。",
    ].join("\n");
  }

  function renderHelpMessage() {
    const lines = ["战术报点使用指南："];
    lines.push("zsbd 内容 发送战术报点。");
    lines.push("zsbd /0-/9 使用预设快捷报点。");
    lines.push("zsbd /set /10 内容 设置个人快捷报点。");
    lines.push("zsbd /help 查看当前说明。");
    lines.push("");
    lines.push("预设快捷报点：");
    for (const code of Object.keys(runtimeConfig.defaultCodes).sort(codeSort)) {
      lines.push(`${code} ${runtimeConfig.defaultCodes[code]}`);
    }
    return lines.join("\n");
  }

  function splitLongMessage(text, limit) {
    const input = sanitizeReportMessage(text);
    if (!input) return [];

    const segments = [];
    let remaining = input;
    const maxLen = Math.max(10, Number(limit) || DEFAULT_MAX_MESSAGE_LENGTH);

    while (remaining.length > maxLen) {
      let breakIndex = remaining.lastIndexOf(" ", maxLen);
      if (breakIndex < Math.max(10, Math.floor(maxLen * 0.5))) {
        breakIndex = maxLen;
      }
      const piece = remaining.slice(0, breakIndex).trim();
      if (piece) segments.push(piece);
      remaining = remaining.slice(breakIndex).trim();
    }
    if (remaining) segments.push(remaining);
    return segments;
  }

  function parseMessage(messageText) {
    const original = normalizeText(messageText);
    if (!original) return null;
    if (!original.toLowerCase().startsWith(runtimeConfig.triggerText.toLowerCase())) return null;
    const rest = original.slice(runtimeConfig.triggerText.length).trim();
    if (!rest) return { kind: "help", args: "" };
    if (rest.toLowerCase().startsWith("/help")) return { kind: "help", args: rest.slice(5).trim() };
    if (rest.toLowerCase().startsWith("/set")) return { kind: "set", args: rest.slice(4).trim() };
    return { kind: "report", args: rest };
  }

  function parseSetArgs(args) {
    const text = normalizeText(args);
    const space = text.indexOf(" ");
    if (space < 0) return { code: normalizeCodeKey(text), message: "" };
    return {
      code: normalizeCodeKey(text.slice(0, space)),
      message: text.slice(space + 1).trim(),
    };
  }

  function resolveShortcutMessage(context, code) {
    const normalized = normalizeCodeKey(code);
    if (/^\/[0-9]$/.test(normalized)) return runtimeConfig.defaultCodes[normalized] ?? "";
    if (/^\/\d+$/.test(normalized)) return state.userCodes[context.steamId]?.[normalized] ?? "";
    return "";
  }

  function buildContext(event = {}) {
    const serverId = getServerId(event);
    const steamId = normalizeSteamId(event?.steamId ?? event?.steamID ?? event?.steamid ?? event?.payload?.steamId ?? event?.payload?.steamID ?? event?.payload?.steamid);
    const playerName = normalizeText(event?.playerName ?? event?.name ?? event?.payload?.playerName ?? event?.payload?.name);
    const player = steamId ? getPlayerBySteamId(serverId, steamId) : null;
    return {
      serverId,
      steamId,
      playerName: playerName || getPlayerName(player ?? {}),
      player,
      teamId: getPlayerTeamId(player ?? {}),
      eosId: getPlayerEosId(player ?? {}),
      channel: normalizeText(event?.channel ?? event?.chatChannel ?? event?.payload?.channel ?? event?.payload?.chatChannel),
    };
  }

  function getTeamPlayers(serverId, teamId) {
    return getPlayerList(serverId).filter((player) => getPlayerTeamId(player) === teamId);
  }

  async function notifySender(context, message, reason) {
    const warnApi = getWarnApi();
    if (typeof warnApi !== "function") return { success: false, skipped: true, message: "warn api unavailable" };
    return await warnApi.call(modules.adminWarn, {
      sourceModule: PLUGIN_ID,
      reason,
      targetName: context.playerName || context.steamId || "player",
      targetSteamId: context.steamId || undefined,
      targetEosId: context.eosId || undefined,
      message,
      system: true,
    });
  }

  async function sendReport(context, text, sourceCode) {
    const message = sanitizeReportMessage(text);
    if (!message) {
      return { ok: false, error: "EmptyMessage", message: "战术报点内容不能为空。" };
    }
    if (!context.steamId) {
      return { ok: false, error: "MissingSteamId", message: "无法识别 SteamID，无法发送战术报点。" };
    }
    if (!context.teamId) {
      return { ok: false, error: "MissingTeam", message: "无法识别阵营，无法发送战术报点。" };
    }

    const cooldown = getPlayerCooldownRemaining(context.steamId);
    if (cooldown > 0) {
      const text = `战术报点冷却中，请等待 ${cooldown} 秒。`;
      pushHistory({
        kind: "report_rejected",
        steamId: context.steamId,
        playerName: context.playerName,
        teamId: context.teamId,
        sourceCode,
        reason: "player_cooldown",
        remainingSeconds: cooldown,
        message: text,
      });
      state.rejectedCount += 1;
      state.lastError = text;
      await notifySender(context, text, "tactical_report_cooldown");
      return { ok: false, error: "Cooldown", message: text };
    }

    const targets = getTeamPlayers(context.serverId, context.teamId)
      .filter((player) => getPlayerSteamId(player) !== context.steamId);
    const reportText = renderReportMessage(message);
    const warnApi = getWarnApi();

    const tasks = targets.map((player) => {
      if (typeof warnApi !== "function") {
        return Promise.resolve({ success: false, error: "warn_api_unavailable" });
      }
      return warnApi.call(modules.adminWarn, {
        sourceModule: PLUGIN_ID,
        reason: "tactical_report",
        targetName: getPlayerName(player) || "player",
        targetSteamId: getPlayerSteamId(player) || undefined,
        targetEosId: getPlayerEosId(player) || undefined,
        message: reportText,
        system: true,
      }).catch((error) => ({
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    });

    const results = await Promise.allSettled(tasks);
    const failures = [];
    for (const result of results) {
      if (result.status === "rejected") {
        failures.push(String(result.reason?.message ?? result.reason ?? "unknown"));
      } else if (result.value?.success === false || result.value?.ok === false) {
        failures.push(String(result.value?.errorMessage ?? result.value?.message ?? "unknown"));
      }
    }

    state.reportCount += 1;
    state.lastReportAt = nowIso();
    state.lastError = failures[0] ?? "";
    setPlayerCooldown(context.steamId, runtimeConfig.playerCooldownSeconds);

    pushHistory({
      kind: "report",
      steamId: context.steamId,
      playerName: context.playerName,
      teamId: context.teamId,
      sourceCode,
      reportText: message,
      targetCount: targets.length,
      failureCount: failures.length,
      channel: context.channel,
    });

    await notifySender(context, "已经触发。", "tactical_report_sent");

    return {
      ok: true,
      message: reportText,
      targetCount: targets.length,
      failures,
    };
  }

  async function handleMessage(event = {}) {
    if (!runtimeConfig.enabled) return { matched: false, skipped: true, reason: "plugin_disabled" };
    if (isHandled(event)) return { matched: false, deduped: true };

    const context = buildContext(event);
    const messageText = event?.message ?? event?.payload?.message ?? "";
    const parsed = parseMessage(messageText);
    if (!parsed) return { matched: false };

    state.triggerCount += 1;
    state.lastError = "";

    if (parsed.kind === "help") {
      const cooldown = getHelpCooldownRemaining();
      if (cooldown > 0) {
        const text = `战术报点帮助冷却中，请等待 ${cooldown} 秒。`;
        state.rejectedCount += 1;
        state.lastError = text;
        pushHistory({
          kind: "help_rejected",
          steamId: context.steamId,
          playerName: context.playerName,
          remainingSeconds: cooldown,
          message: text,
        });
        await notifySender(context, text, "tactical_report_help_cooldown");
        return { matched: true, kind: "help", ok: false, message: text };
      }

      const broadcastApi = getBroadcastApi();
      const helpText = renderHelpMessage();
      if (typeof broadcastApi === "function") {
        await broadcastApi.call(modules.adminWarn, {
          sourceModule: PLUGIN_ID,
          reason: "tactical_report_help",
          message: helpText,
          system: true,
        });
      }

      state.helpCount += 1;
      state.lastHelpAt = nowIso();
      setHelpCooldown(runtimeConfig.helpGlobalCooldownSeconds);
      pushHistory({
        kind: "help",
        steamId: context.steamId,
        playerName: context.playerName,
        message: helpText,
      });
      await notifySender(context, "已经触发。", "tactical_report_help_sent");
      return { matched: true, kind: "help", ok: true, message: helpText };
    }

    if (parsed.kind === "set") {
      const { code, message } = parseSetArgs(parsed.args);
      if (!context.steamId) {
        return { matched: true, kind: "set", ok: false, message: "无法识别 SteamID，无法保存快捷码。" };
      }
      if (!/^\/\d+$/.test(code)) {
        return { matched: true, kind: "set", ok: false, message: "请输入 ZSBD /set /10 内容 这样的格式。" };
      }
      const cleanMessage = sanitizeReportMessage(message);
      if (!cleanMessage) {
        return { matched: true, kind: "set", ok: false, message: "快捷码内容不能为空。" };
      }

      if (!state.userCodes[context.steamId]) state.userCodes[context.steamId] = {};
      state.userCodes[context.steamId][code] = cleanMessage;
      state.setCount += 1;
      pushHistory({
        kind: "set",
        steamId: context.steamId,
        playerName: context.playerName,
        code,
        message: cleanMessage,
      });
      await persistUserCodes();
      await notifySender(context, `已保存快捷报点 ${code}。`, "tactical_report_set_saved");
      return { matched: true, kind: "set", ok: true, code, message: cleanMessage };
    }

    const [codeToken, ...rest] = parsed.args.split(/\s+/);
    const code = normalizeCodeKey(codeToken);
    let reportText = rest.join(" ").trim();

    if (/^\/\d+$/.test(code)) {
      reportText = reportText || resolveShortcutMessage(context, code);
      if (!reportText) {
        if (Number(code.slice(1)) >= 10) {
          const text = `请先使用 ZSBD /set ${code} 内容。`;
          state.rejectedCount += 1;
          state.lastError = text;
          pushHistory({
            kind: "report_rejected",
            steamId: context.steamId,
            playerName: context.playerName,
            sourceCode: code,
            reason: "personal_code_missing",
            message: text,
          });
          await notifySender(context, text, "tactical_report_missing_code");
          return { matched: true, kind: "report", ok: false, message: text };
        }
        reportText = runtimeConfig.defaultCodes[code] ?? DEFAULT_CODES[code] ?? "";
      }
    } else {
      reportText = parsed.args.trim();
    }

    const result = await sendReport(context, reportText, code || "content");
    return {
      matched: true,
      kind: "report",
      ok: Boolean(result.ok),
      message: result.message ?? "",
      result,
    };
  }

  async function persistUserCodes() {
    const filePath = path.resolve(process.cwd(), runtimeConfig.dataFile);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(state.userCodes, null, 2)}\n`, "utf8");
  }

  async function loadUserCodes() {
    const filePath = path.resolve(process.cwd(), runtimeConfig.dataFile);
    try {
      const text = await fs.readFile(filePath, "utf8");
      state.userCodes = normalizeUserCodes(JSON.parse(text));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        pluginLogger?.warn?.(`[TacticalReport] failed to load user codes: ${error?.message ?? error}`);
      }
      state.userCodes = {};
    }
  }

  function normalizeUserCodes(raw) {
    const output = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return output;
    for (const [steamId, codes] of Object.entries(raw)) {
      const sid = normalizeSteamId(steamId);
      if (!sid || !codes || typeof codes !== "object" || Array.isArray(codes)) continue;
      output[sid] = {};
      for (const [code, message] of Object.entries(codes)) {
        const normalizedCode = normalizeCodeKey(code);
        if (!/^\/\d+$/.test(normalizedCode)) continue;
        const cleanMessage = sanitizeReportMessage(message);
        if (!cleanMessage) continue;
        output[sid][normalizedCode] = cleanMessage;
      }
    }
    return output;
  }

  function normalizeDefaultCodes(raw) {
    const output = { ...DEFAULT_CODES };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return output;
    for (const [code, message] of Object.entries(raw)) {
      const normalizedCode = normalizeCodeKey(code);
      if (!/^\/\d+$/.test(normalizedCode)) continue;
      const cleanMessage = sanitizeReportMessage(message);
      if (!cleanMessage) continue;
      output[normalizedCode] = cleanMessage;
    }
    return output;
  }

  function readConfig(configRef) {
    const raw = configRef?.get?.(CONFIG_KEY, {}) ?? {};
    return {
      enabled: raw.enabled !== false,
      triggerText: normalizeText(raw.trigger ?? DEFAULT_TRIGGER) || DEFAULT_TRIGGER,
      playerCooldownSeconds: Math.max(0, Number(raw.playerCooldownSeconds ?? DEFAULT_PLAYER_COOLDOWN_SECONDS) || DEFAULT_PLAYER_COOLDOWN_SECONDS),
      helpGlobalCooldownSeconds: Math.max(0, Number(raw.helpGlobalCooldownSeconds ?? DEFAULT_HELP_GLOBAL_COOLDOWN_SECONDS) || DEFAULT_HELP_GLOBAL_COOLDOWN_SECONDS),
      maxMessageLength: Math.max(20, Number(raw.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH) || DEFAULT_MAX_MESSAGE_LENGTH),
      dataFile: normalizeText(raw.dataFile ?? DEFAULT_DATA_FILE) || DEFAULT_DATA_FILE,
      defaultCodes: normalizeDefaultCodes(raw.defaultCodes),
    };
  }

  function updateConfig(nextConfig = {}) {
    const merged = {
      ...runtimeConfig,
      ...nextConfig,
      defaultCodes: nextConfig?.defaultCodes ?? runtimeConfig.defaultCodes,
    };
    runtimeConfig = normalizeRuntimeConfig(merged);
    state.enabled = runtimeConfig.enabled;
    return getState();
  }

  function clearHistory() {
    state.history = [];
    state.recentRecords = [];
    return getState();
  }

  function getState() {
    return {
      enabled: state.enabled,
      triggerText: state.triggerText,
      triggerCount: state.triggerCount,
      reportCount: state.reportCount,
      helpCount: state.helpCount,
      setCount: state.setCount,
      rejectedCount: state.rejectedCount,
      lastError: state.lastError,
      lastReportAt: state.lastReportAt,
      lastHelpAt: state.lastHelpAt,
      config: getConfig(),
      userCodes: cloneValue(state.userCodes),
      history: [...state.history].reverse(),
      recentRecords: [...state.recentRecords].reverse(),
    };
  }

  function codeSort(left, right) {
    return Number(left.slice(1)) - Number(right.slice(1));
  }

  function normalizeRuntimeConfig(raw = {}) {
    return {
      enabled: raw.enabled !== false,
      triggerText: normalizeText(raw.triggerText ?? raw.trigger ?? DEFAULT_TRIGGER) || DEFAULT_TRIGGER,
      playerCooldownSeconds: Math.max(0, Number(raw.playerCooldownSeconds ?? DEFAULT_PLAYER_COOLDOWN_SECONDS) || DEFAULT_PLAYER_COOLDOWN_SECONDS),
      helpGlobalCooldownSeconds: Math.max(0, Number(raw.helpGlobalCooldownSeconds ?? DEFAULT_HELP_GLOBAL_COOLDOWN_SECONDS) || DEFAULT_HELP_GLOBAL_COOLDOWN_SECONDS),
      maxMessageLength: Math.max(20, Number(raw.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH) || DEFAULT_MAX_MESSAGE_LENGTH),
      dataFile: normalizeText(raw.dataFile ?? DEFAULT_DATA_FILE) || DEFAULT_DATA_FILE,
      defaultCodes: normalizeDefaultCodes(raw.defaultCodes),
    };
  }

  function normalizeDefaultCodes(raw) {
    const output = { ...DEFAULT_CODES };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return output;
    for (const [code, message] of Object.entries(raw)) {
      const normalizedCode = normalizeCodeKey(code);
      if (!/^\/\d+$/.test(normalizedCode)) continue;
      const cleanMessage = sanitizeReportMessage(message);
      if (!cleanMessage) continue;
      output[normalizedCode] = cleanMessage;
    }
    return output;
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "战术报点",
      kind: "plugin",
      version: "1.0.0",
      description: "Intercepts ZSBD chat commands and forwards tactical reports to the sender's current team.",
      category: "Moderation",
    },
    apiName: "tacticalReport",
    api: {
      getState,
      getConfig,
      updateConfig,
      clearHistory,
      async reloadUserCodes() {
        await loadUserCodes();
        return getState();
      },
      async simulateChatMessage(payload = {}) {
        return await handleMessage({
          ...payload,
          message: String(payload?.message ?? ""),
        });
      },
    },

    async init() {
      await loadUserCodes();
    },

    async start() {
      runtimeConfig = readConfig(config);
      state.enabled = runtimeConfig.enabled;
      state.triggerText = runtimeConfig.triggerText;

      if (typeof modules?.chatManager?.on === "function") {
        unsubscribers.push(modules.chatManager.on("message", (event) => {
          void handleMessage(event);
        }));
      } else if (typeof core?.eventBus?.onModuleEvent === "function") {
        unsubscribers.push(core.eventBus.onModuleEvent("module.chatManager", "CHAT_MESSAGE", (event) => {
          void handleMessage({
            ...event,
            message: event?.payload?.message ?? event?.message ?? "",
            playerName: event?.payload?.name ?? event?.payload?.playerName ?? event?.name ?? "",
            steamId: event?.payload?.steamid ?? event?.payload?.steamId ?? event?.steamId ?? "",
            channel: event?.payload?.channel ?? event?.channel ?? "",
          });
        }));
      }

      core?.webRegistry?.registerPage?.({
        id: "web.tacticalReport",
        title: "战术报点",
        group: "插件",
        route: "/plugins/tactical-report",
        pageModule: "/pages/tactical-report.js",
        source: PLUGIN_ID,
        description: "查看战术报点触发记录、个人快捷指令，并编辑 zsbd /0-/9 预设内容。",
        required: false,
        enabled: true,
        order: 140,
        icon: "TR",
      });

      pluginLogger?.info?.("[TacticalReport] plugin started.");
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {}
      }
      pluginLogger?.info?.("[TacticalReport] plugin stopped.");
    },
  };
}

export default { createPlugin };
