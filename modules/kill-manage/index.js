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

  function resolvePlayer(serverId, identity = {}) {
    const playerState = modules?.playerState;
    if (!playerState) return null;

    return playerState.getPlayerBySteamID?.(serverId, identity.steamID || identity.steam64ID || "")
      ?? playerState.getPlayerByEOSID?.(serverId, identity.eosID || "")
      ?? playerState.getPlayerByControllerID?.(serverId, identity.controllerID || "")
      ?? playerState.getPlayerByName?.(serverId, identity.name || "")
      ?? null;
  }

  function sameKnownTeam(left, right) {
    if (left == null || right == null) return false;
    const leftText = String(left).trim();
    const rightText = String(right).trim();
    return leftText !== "" && rightText !== "" && leftText === rightText;
  }

  function getFriendlyFireKind(type) {
    const normalized = String(type ?? "").toLowerCase();
    if (normalized === "damaged" || normalized === "damage") {
      return { type: "team_damage", label: "友军伤害", tag: "friendly_damage", isTeamKill: false };
    }
    if (normalized === "wounded" || normalized === "wound") {
      return { type: "team_wound", label: "TK击倒", tag: "tk_down", isTeamKill: false, isTeamKillDown: true };
    }
    return { type: "team_kill", label: "友军击杀", tag: "friendly_kill", isTeamKill: true, isTeamKillDown: false };
  }

  function addTeamKillMetadata(record, { forced = false, reason = "" } = {}) {
    const attacker = resolvePlayer(record.serverId, {
      name: record.attackerName,
      steamID: record.attackerSteam64ID,
      eosID: record.attackerEOSID,
      controllerID: record.attackerControllerID,
    });
    const victim = resolvePlayer(record.serverId, {
      name: record.victimName,
      steamID: record.victimSteam64ID,
      eosID: record.victimEOSID,
      controllerID: record.victimControllerID,
    });

    const attackerTeamID = record.attackerTeamID ?? attacker?.teamID ?? "";
    const victimTeamID = record.victimTeamID ?? victim?.teamID ?? "";
    const isFriendlyFire = Boolean(forced || sameKnownTeam(attackerTeamID, victimTeamID));
    const friendlyFireKind = getFriendlyFireKind(record.type);
    const isTeamKill = Boolean(isFriendlyFire && friendlyFireKind.isTeamKill);
    const isTeamKillDown = Boolean(isFriendlyFire && friendlyFireKind.isTeamKillDown);

    record.attackerTeamID = attackerTeamID;
    record.victimTeamID = victimTeamID;
    record.isFriendlyFire = isFriendlyFire;
    record.isTeamKill = isTeamKill;
    record.isTeamKillDown = isTeamKillDown;
    record.tkDown = isTeamKillDown;
    record.tk = isTeamKill;
    record.friendlyFireType = isFriendlyFire ? friendlyFireKind.type : "";
    record.friendlyFireLabel = isFriendlyFire ? friendlyFireKind.label : "";
    record.teamKillReason = isTeamKill ? (reason || "same_team") : "";
    record.friendlyFireReason = isFriendlyFire ? (reason || "same_team") : "";
    record.severity = isFriendlyFire ? "danger" : (record.severity ?? "");
    record.tags = [...new Set([
      ...(record.tags ?? []),
      ...(isFriendlyFire ? ["friendly_fire", friendlyFireKind.tag] : []),
      ...(isTeamKill ? ["tk"] : []),
      ...(isTeamKillDown ? ["tk_down"] : []),
    ])];

    return record;
  }

  function publishRecord(sourceEvent, record) {
    records.push(record);
    appendRawLog(record.rawLog);

    const eventPayload = {
      ...sourceEvent,
      layer: "module",
      source: "module.killManage",
      eventName: "module.killManage.combatResolved",
      record,
    };

    core.eventBus.emitModuleEvent("module.killManage", "combatResolved", eventPayload);

    if (record.isFriendlyFire) {
      moduleLogger?.warn?.(
        () => `${record.friendlyFireLabel || "友军事故"} ${record.attackerName || "unknown"} -> ${record.victimName || "unknown"}`,
        {
          operation: "friendlyFireResolved",
          eventName: "module.killManage.friendlyFireResolved",
          tags: record.tags,
          data: {
            attackerName: record.attackerName,
            victimName: record.victimName,
            attackerTeamID: record.attackerTeamID,
            victimTeamID: record.victimTeamID,
            friendlyFireType: record.friendlyFireType,
            reason: record.friendlyFireReason,
          },
        },
      );

      core.eventBus.emitModuleEvent("module.killManage", "friendlyFireResolved", {
        ...eventPayload,
        eventName: "module.killManage.friendlyFireResolved",
      });
    }

    if (record.isTeamKill) {
      core.eventBus.emitModuleEvent("module.killManage", "teamKillResolved", {
        ...eventPayload,
        eventName: "module.killManage.teamKillResolved",
      });
    }
  }

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
      attackerEOSID: combat.attackerEOSID,
      attackerSteam64ID: combat.attackerSteam64ID,
      attackerControllerID: combat.attackerControllerId ?? combat.attackerControllerID,
      victimEOSID: combat.victimCachedEOSID ?? combat.victimEOSID,
      victimSteam64ID: combat.victimCachedSteam64ID ?? combat.victimSteam64ID,
      attackerTeamID: combat.attackerTeamID,
      victimTeamID: combat.victimTeamID,
      confidence: combat.confidence,
      identityConfidence: combat.identityConfidence,
      parseConfidence: combat.parseConfidence,
      parseStatus: combat.parseStatus,
      rawLog: event.rawLog || "",
      rawEvent: event.rawEvent || null,
      normalized: event.normalized || null,
      params: event.params || null,
    };

    publishRecord(event, addTeamKillMetadata(record));
  }

  function handleTeamKill(event) {
    if (!isSubscribed()) return;

    const payload = event?.payload ?? {};
    const attackerName = String(payload.killerName ?? payload.tk1 ?? "").trim();
    const victimName = String(payload.victimName ?? payload.tk2 ?? "").trim();
    const rawLog = String(payload.sourceRaw ?? payload.rawLine ?? event.rawLog ?? "");
    const record = addTeamKillMetadata({
      serverId: event.serverId,
      time: event.time,
      logTime: event.logTime,
      sourceEventId: event.eventId,
      type: "tk",
      victimName,
      attackerName,
      damage: null,
      weapon: "",
      rawCausedBy: "",
      causedBy: "RCON_TEAM_KILL",
      causedByCategory: "rcon",
      confidence: "High",
      identityConfidence: "Medium",
      parseConfidence: "High",
      parseStatus: "Full",
      rawLog,
      rawEvent: event.rawEvent || null,
      normalized: event.normalized || null,
      params: event.params || null,
    }, { forced: true, reason: "rcon_team_kill" });

    publishRecord(event, record);
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
      unsubscribers.push(core.eventBus.onCoreEvent("TEAM_KILL", (e) => handleTeamKill(e)));
    },

    async stop() {
      for (const un of unsubscribers) un();
      await rawLogWriteChain;
    },
  };
}
