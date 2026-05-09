// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_RAW_LOG_FILE = "./data/kill-manage-raw.log";

/**
 * Module: KillManage
 *
 * 击杀/倒地/伤害归并模块。
 */
export function createKillManageModule({ core, modules, config, logger }) {
  const records = [];
  const unsubscribers = [];
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.killManage",
    source: "module.killManage",
    channel: "module",
  }) ?? core.logger;
  const moduleConfig = config?.get("modules.killManage", {}) ?? {};
  const rawLogFile = path.resolve(process.cwd(), moduleConfig.rawLogFile ?? DEFAULT_RAW_LOG_FILE);
  let rawLogWriteChain = Promise.resolve();

  function appendRawLog(rawLog) {
    const text = String(rawLog ?? "").trim();
    if (!text) return;

    rawLogWriteChain = rawLogWriteChain
      .then(async () => {
        await fs.mkdir(path.dirname(rawLogFile), { recursive: true });
        await fs.appendFile(rawLogFile, `${text}\n`, "utf8");
      })
      .catch((error) => {
        moduleLogger?.warn?.(`KillManage raw log write failed: ${error.message}`);
      });
  }

  function handleCombat(event, type) {
    if (!isSubscribed()) return;

    const combat = event.normalized?.combat;
    if (!combat) return;

    const record = {
      serverId: event.serverId,
      time: event.time,
      logTime: event.logTime,
      sourceEventId: event.eventId,
      type: combat.type || type,
      victimName: combat.victimName,
      attackerName: combat.attackerName,
      damage: combat.damage,
      weapon: combat.weapon,
      rawCausedBy: combat.rawCausedBy,
      causedBy: combat.causedBy,
      causedByCategory: combat.causedByCategory,
      confidence: combat.confidence,
      identityConfidence: combat.identityConfidence,
      parseConfidence: combat.parseConfidence,
      parseStatus: combat.parseStatus,
      rawLog: event.rawLog || "",
      rawEvent: event.rawEvent || null,
      normalized: event.normalized || null,
      params: event.params || null,
    };

    records.push(record);
    appendRawLog(record.rawLog);

    core.eventBus.emitModuleEvent("module.killManage", "combatResolved", {
      ...event,
      layer: "module",
      source: "module.killManage",
      eventName: "module.killManage.combatResolved",
      record,
    });
  }

  const api = {
    getRecentKills(serverId, limit = 50) {
      return records.filter((r) => r.serverId === serverId).slice(-limit).reverse();
    },
  };

  // KillManage 依赖实时战斗事件归并结果。
  // 这里同时检查 combatState 与 killManage，自身或上游任一被暂停时都停止写入新记录。
  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.("module.combatState") !== false
      && modules?.pluginSubscriptions?.isSubscribed?.("module.killManage") !== false;
  }

  return {
    manifest: { id: "module.killManage", name: "Kill Manage Module", kind: "module", version: "0.1.0", description: "击杀/击倒/伤害事件归并模块。订阅 On_PlayerDamaged、On_PlayerWounded、On_PlayerDied 三类核心事件，将原始日志中的战斗参数（武器、伤害量、攻击者/受害者身份、置信度）归并为统一的 combatRecord 结构，并以 combatResolved 模块事件向后发布。武器收集插件、击杀管理页面等均以此事件为数据入口。" },
    apiName: "killManage",
    api,

    async start() {
      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerDamaged", (e) => handleCombat(e, "damaged")));
      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerWounded", (e) => handleCombat(e, "wounded")));
      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerDied", (e) => handleCombat(e, "died")));
    },

    async stop() {
      for (const un of unsubscribers) un();
      await rawLogWriteChain;
    },
  };
}
