// -*- coding: utf-8 -*-

import { getParam } from "../core/event-normalizer.js";

/**
 * 公平建队插件 (Fair Squad Building Plugin)
 * 
 * 功能逻辑：
 * 1. 0-20秒：禁止任何建队。
 * 2. 20-50秒：仅允许步兵队（默认名 Squad X 或白名单名）。
 * 3. 50秒后：全开放。
 * 
 * 安全机制：
 * - 仅在 On_SquadCreated 事件触发时检查，不回溯存量小队。
 * - 只有日志时间在 0-590秒 范围内才生效。如果日志时间是默认的 10分钟（600秒），认为不是刚开局，不执行逻辑。
 */

const PLUGIN_ID = "fair-squad-building";
const DEFAULT_WHITELIST = ["INF", "Infantry", "步兵", "萌新", "NEWBIE"];

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger = logger ?? core.createLogger?.({
    moduleId: PLUGIN_ID,
    source: PLUGIN_ID,
    channel: "plugin",
  }) ?? core.logger;

  // 获取配置
  const getPluginConfig = () => {
    const raw = config?.get?.(`plugins.${PLUGIN_ID}`, {});
    return {
      enabled: raw.enabled ?? true,
      phase1Seconds: raw.phase1Seconds ?? 20,
      phase2Seconds: raw.phase2Seconds ?? 50,
      infantryWhitelist: Array.isArray(raw.infantryWhitelist) ? raw.infantryWhitelist : DEFAULT_WHITELIST
    };
  };
  
  const isEnabled = () => Boolean(getPluginConfig().enabled);
  const getPhase1Seconds = () => Number(getPluginConfig().phase1Seconds);
  const getPhase2Seconds = () => Number(getPluginConfig().phase2Seconds);
  const getWhitelist = () => getPluginConfig().infantryWhitelist;

  /**
   * 检查是否是步兵队
   */
  function isInfantrySquad(squadName) {
    if (!squadName) return false;
    const name = String(squadName).trim();
    
    // 默认名检查: Squad 1, Squad 2...
    if (/^Squad\s*\d+$/i.test(name)) return true;
    
    // 白名单检查
    const whitelist = getWhitelist();
    const lowerName = name.toLowerCase();
    return whitelist.some(item => lowerName.includes(String(item).toLowerCase()));
  }

  /**
   * 处理建队事件
   */
  async function handleSquadCreated(event) {
    const currentConfig = getPluginConfig();
    if (!currentConfig.enabled) return;

    // 获取日志时间（秒）
    const logSeconds = core.webStatus?.logClock?.getSeconds?.() ?? 600;

    // 安全机制：如果日志时间大于 590秒（默认 600秒），认为不是刚切图/开局，忽略。
    if (logSeconds > 590) return;

    const squadName = getParam(event, "SquadName") || event.squadName;
    const teamId = getParam(event, "TeamID") || event.teamId;
    const squadId = getParam(event, "SquadID") || event.squadId;
    const creatorName = getParam(event, "PlayerName") || event.playerName || event.creatorName;
    const steamId = getParam(event, "Steam64ID") || event.steamID || event.creatorSteamId;
    const eosId = getParam(event, "EOSID") || event.eosID || event.creatorEosId;

    if (teamId == null || squadId == null) return;

    let shouldDisband = false;
    let reason = "";

    if (logSeconds < currentConfig.phase1Seconds) {
      // 阶段1：禁止所有建队
      shouldDisband = true;
      reason = `[公平建队] 开局 ${currentConfig.phase1Seconds} 秒内禁止建队，请稍后再试。当前：${logSeconds}s`;
    } else if (logSeconds < currentConfig.phase2Seconds) {
      // 阶段2：仅限步兵队
      if (!isInfantrySquad(squadName)) {
        shouldDisband = true;
        reason = `[公平建队] 开局 ${currentConfig.phase2Seconds} 秒内仅限步兵队（Squad X / 白名单），非步兵队请在 ${currentConfig.phase2Seconds}s 后创建。`;
      }
    }

    if (shouldDisband) {
      pluginLogger.info(`[FairSquadBuilding] Disbanding Squad ${squadId} on Team ${teamId} created by ${creatorName}. Reason: ${reason}`);

      // 1. 发送警告给建队玩家
      if (modules.adminWarn?.warnPlayer) {
        await modules.adminWarn.warnPlayer({
          targetName: creatorName,
          targetSteamId: steamId,
          targetEosId: eosId,
          message: reason,
          sourceModule: PLUGIN_ID,
          reason: "fair_squad_violation",
        });
      }

      // 2. 解散小队
      if (modules.squadManagement?.disband) {
        await modules.squadManagement.disband({
          serverId: core.webStatus?.serverId,
          teamId,
          squadId,
          reason,
          source: PLUGIN_ID,
          system: true,
        });
      }
    }
  }

  const api = {
    getStatus: () => {
      const currentConfig = getPluginConfig();
      return {
        enabled: currentConfig.enabled,
        logSeconds: core.webStatus?.logClock?.getSeconds?.() ?? 600,
        config: currentConfig,
      };
    },
    updateConfig: async (newConfig) => {
      const current = config?.get?.(`plugins.${PLUGIN_ID}`, {});
      const merged = { ...current, ...newConfig };
      config.set(`plugins.${PLUGIN_ID}`, merged);
      await config.save();
      return { ok: true, config: merged };
    }
  };

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "公平建队",
      kind: "plugin",
      version: "1.0.0",
      description: "开局阶段限制建队：0-20s禁建，20-50s仅限步兵，50s后全开放。通过日志时间锚定，安全且公平。",
    },
    apiName: "fairSquadBuilding",
    api,

    async start() {
      // 订阅建队事件
      if (core.eventBus?.onCoreEvent) {
        core.eventBus.onCoreEvent("On_SquadCreated", handleSquadCreated);
      }
      
      // 注册 Web 页面
      core.webRegistry?.registerPage?.({
        id: `web.${PLUGIN_ID}`,
        title: "公平建队",
        group: "插件",
        route: `/plugins/${PLUGIN_ID}`,
        pageModule: `/pages/${PLUGIN_ID}.js`,
        source: PLUGIN_ID,
        description: "设置开局建队限制规则，保障步兵和载具队公平竞争。",
        required: false,
        enabled: true,
        order: 600,
        icon: "FS",
      });

      pluginLogger.info("[FairSquadBuilding] Plugin started.");
    },

    async stop() {
      pluginLogger.info("[FairSquadBuilding] Plugin stopped.");
    }
  };
}
