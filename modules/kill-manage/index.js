// -*- coding: utf-8 -*-

import { getParam } from "../../core/event-normalizer.js";

/**
 * Module: KillManage
 *
 * 击杀/倒地/伤害归并模块。
 */
export function createKillManageModule({ core }) {
  const records = [];
  const unsubscribers = [];

  function handleCombat(event, type) {
    const record = {
      serverId: event.serverId,
      time: event.time,
      sourceEventId: event.eventId,
      type,
      victimName: getParam(event, "VictimName"),
      attackerName: getParam(event, "AttackerName"),
      damage: getParam(event, "ActualDamage") || getParam(event, "KillingDamage"),
      weapon: getParam(event, "CausedBy"),
      confidence: getParam(event, "Confidence"),
    };

    records.push(record);

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

  return {
    manifest: { id: "module.killManage", name: "Kill Manage Module", kind: "module", version: "0.1.0" },
    apiName: "killManage",
    api,

    async start() {
      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerDamaged", (e) => handleCombat(e, "damaged")));
      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerWounded", (e) => handleCombat(e, "wounded")));
      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerDied", (e) => handleCombat(e, "died")));
    },

    async stop() { for (const un of unsubscribers) un(); },
  };
}
