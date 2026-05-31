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

  function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function sameTextId(left, right) {
    const a = String(left ?? "").trim();
    const b = String(right ?? "").trim();
    return Boolean(a && b && a === b);
  }

  function isSameCombatIdentity(record) {
    return sameTextId(record.attackerSteam64ID, record.victimSteam64ID)
      || sameTextId(record.attackerEOSID, record.victimEOSID)
      || sameTextId(record.attackerControllerID, record.victimControllerID)
      || sameTextId(record.attackerName, record.victimName);
  }

  function pushEventFlag(flags, flag) {
    if (!flag?.key) return;
    if (flags.some((item) => item.key === flag.key)) return;
    flags.push(flag);
  }

  function buildCombatEventFlags(record) {
    const flags = [];
    const type = String(record?.type ?? "").trim().toLowerCase();
    const damage = toFiniteNumber(record?.damage);

    if (type === "revive") {
      return flags;
    }

    if ((type === "died" || type === "death") && damage !== null && Math.abs(damage) === 300) {
      pushEventFlag(flags, {
        key: "give_up",
        label: "放弃",
        level: "neutral",
        reason: "died_damage_300",
      });
      if (isSameCombatIdentity(record)) {
        return flags;
      }
    }

    if (record?.isFriendlyFire) {
      pushEventFlag(flags, {
        key: "friendly_fire",
        label: "友伤",
        level: record?.isTeamKill || record?.isTeamKillDown ? "danger" : "warning",
        reason: record?.friendlyFireReason || "same_team",
      });
    }

    if (record?.isTeamKillDown) {
      pushEventFlag(flags, {
        key: "tk_down",
        label: "TK击倒",
        level: "warning",
        reason: record?.friendlyFireReason || "same_team",
      });
    }

    if (isSameCombatIdentity(record)) {
      pushEventFlag(flags, {
        key: "self_damage",
        label: "自伤",
        level: "warning",
        reason: "same_attacker_victim",
      });
    }

    return flags;
  }

  function applyCombatEventFlags(record) {
    const flags = buildCombatEventFlags(record);
    record.eventFlags = flags;
    record.eventFlagLabels = flags.map((flag) => flag.label);
    record.tags = [...new Set([
      ...(record.tags ?? []),
      ...flags.map((flag) => `event:${flag.key}`),
    ])];
    return record;
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
    if (String(record?.type ?? "").trim().toLowerCase() === "revive") {
      record.attackerTeamID = attackerTeamID;
      record.victimTeamID = victimTeamID;
      record.isFriendlyFire = false;
      record.isTeamKill = false;
      record.isTeamKillDown = false;
      record.tkDown = false;
      record.tk = false;
      record.friendlyFireType = "";
      record.friendlyFireLabel = "";
      record.teamKillReason = "";
      record.friendlyFireReason = "";
      record.severity = record.severity ?? "";
      record.tags = [...new Set([...(record.tags ?? [])])];
      return record;
    }
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
      victimControllerID: combat.victimControllerId ?? combat.victimControllerID,
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

    const withTeamKillMetadata = addTeamKillMetadata(record);
    publishRecord(event, applyCombatEventFlags(withTeamKillMetadata));
  }

  function handleRevive(event) {
    if (!isSubscribed()) return;

    const combat = event.normalized?.combat;
    if (!combat) return;

    const record = {
      serverId: event.serverId,
      time: event.time,
      logTime: event.logTime,
      sourceEventId: event.eventId,
      type: combat.type || "revive",
      victimName: combat.victimName,
      attackerName: combat.attackerName,
      damage: null,
      weapon: "",
      rawCausedBy: "",
      causedBy: "REVIVE",
      causedByCategory: "revive",
      attackerEOSID: combat.attackerEOSID,
      attackerSteam64ID: combat.attackerSteam64ID,
      attackerControllerID: combat.attackerControllerId ?? combat.attackerControllerID,
      victimEOSID: combat.victimCachedEOSID ?? combat.victimEOSID,
      victimSteam64ID: combat.victimCachedSteam64ID ?? combat.victimSteam64ID,
      victimControllerID: combat.victimControllerId ?? combat.victimControllerID,
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

    const withTeamKillMetadata = addTeamKillMetadata(record);
    publishRecord(event, applyCombatEventFlags(withTeamKillMetadata));
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

    publishRecord(event, applyCombatEventFlags(record));
  }

  const api = {
    getRecentKills(serverId, limit = 50) {
      return records.filter((r) => r.serverId === serverId).slice(-limit).reverse();
    },
  };

  // KillManage only depends on its own subscription state.
  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.("module.killManage") !== false;
  }

  return {
    manifest: { id: "module.killManage", name: "Kill Manage Module", kind: "module", version: "0.1.0", hidden: true, deprecated: true, description: "Deprecated compatibility module. Keeps the legacy combat ingestion contract available for old imports while Combat Manager becomes the visible entry." },
    apiName: "killManage",
    api,

    async start() {
      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerDamaged", (e) => handleCombat(e, "damaged")));
      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerWounded", (e) => handleCombat(e, "wounded")));
      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerDied", (e) => handleCombat(e, "died")));
      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerRevived", (e) => handleRevive(e)));
      unsubscribers.push(core.eventBus.onCoreEvent("TEAM_KILL", (e) => handleTeamKill(e)));
    },

    async stop() {
      for (const un of unsubscribers) un();
      await rawLogWriteChain;
    },
  };
}
