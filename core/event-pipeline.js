// -*- coding: utf-8 -*-

import { normalizeRawGameEvent } from "./event-normalizer.js";

/**
 * Core: EventPipeline
 *
 * 基础事件层只负责当前 raw event 的标准化与转发，不做跨事件推断。
 */
export class EventPipeline {
  constructor() {
    this.combatIdentityResolver = null;
  }

  setCombatIdentityResolver(resolver) {
    this.combatIdentityResolver = typeof resolver === "function" ? resolver : null;
  }

  processRawGameEvent(rawEvent) {
    const event = normalizeRawGameEvent(rawEvent);
    this.enrichCombatDisplayNames(event);
    return event;
  }

  enrichCombatDisplayNames(event) {
    const combat = event.normalized?.combat;
    if (!combat) return;

    applyDisplayNameFallback({
      resolver: this.combatIdentityResolver,
      event,
      combat,
      side: "attacker",
      rawName: combat.rawAttackerName,
      steam64Id: combat.attackerSteam64ID,
      eosId: combat.attackerEOSID,
      controllerId: combat.attackerControllerId,
      unknownValue: "",
    });

    applyDisplayNameFallback({
      resolver: this.combatIdentityResolver,
      event,
      combat,
      side: "victim",
      rawName: combat.rawVictimName,
      steam64Id: combat.victimCachedSteam64ID,
      eosId: combat.victimCachedEOSID,
      controllerId: "",
      unknownValue: "Unknown",
    });
  }
}

function applyDisplayNameFallback({ resolver, event, combat, side, rawName, steam64Id, eosId, controllerId, unknownValue }) {
  const resolved = resolveDisplayName({
    resolver,
    serverId: event.serverId,
    rawName,
    steam64Id,
    eosId,
    controllerId,
    unknownValue,
  });

  const sideKey = side === "attacker" ? "Attacker" : "Victim";
  combat[`${side}Name`] = resolved.name;
  combat[`${side}DisplayName`] = resolved.name;
  combat[`${side}NameSource`] = resolved.source;
  combat[`raw${sideKey}Name`] = rawName || "";
}

function resolveDisplayName({ resolver, serverId, rawName, steam64Id, eosId, controllerId, unknownValue }) {
  if (rawName) {
    return {
      name: rawName,
      source: "raw",
    };
  }

  if (typeof resolver === "function") {
    if (steam64Id) {
      const bySteam = resolver({ serverId, keyType: "steam64ID", keyValue: steam64Id });
      if (bySteam?.name) {
        return { name: bySteam.name, source: bySteam.source || "playerStateBySteam64" };
      }
    }

    if (eosId) {
      const byEos = resolver({ serverId, keyType: "eosID", keyValue: eosId });
      if (byEos?.name) {
        return { name: byEos.name, source: byEos.source || "playerStateByEOSID" };
      }
    }

    if (controllerId) {
      const byController = resolver({ serverId, keyType: "controllerID", keyValue: controllerId });
      if (byController?.name) {
        return { name: byController.name, source: byController.source || "playerStateByControllerID" };
      }
    }
  }

  if (steam64Id) {
    return { name: steam64Id, source: "steam64Fallback" };
  }

  if (eosId) {
    return { name: eosId, source: "eosFallback" };
  }

  if (controllerId) {
    return { name: controllerId, source: "controllerFallback" };
  }

  return {
    name: unknownValue,
    source: unknownValue ? "unknown" : "",
  };
}
