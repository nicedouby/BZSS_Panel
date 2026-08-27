// -*- coding: utf-8 -*-

import dgram from "node:dgram";

export function createPlugin({ core, modules }) {
  const unsubscribers = [];
  let socket = null;
  let runtimeConfig = null;
  let droppedOversizeCount = 0;

  function readConfig() {
    const cfg = core.config?.get("plugins.udpCombatLogForwarder", {}) ?? {};
    const host = String(cfg.host ?? "127.0.0.1").trim() || "127.0.0.1";
    const port = Number(cfg.port ?? 7001);
    const family = String(cfg.family ?? "udp4").toLowerCase() === "udp6" ? "udp6" : "udp4";
    const maxMessageBytes = Number(cfg.maxMessageBytes ?? 8192);

    return {
      enabled: cfg.enabled !== false,
      host,
      port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 7001,
      family,
      maxMessageBytes: Number.isInteger(maxMessageBytes) && maxMessageBytes > 0 ? maxMessageBytes : 8192,
      includeRawEvent: cfg.includeRawEvent === true,
      includeNormalized: cfg.includeNormalized !== false,
      includeParams: cfg.includeParams === true,
    };
  }

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.("plugin.udpCombatLogForwarder") !== false
      && core.pluginSubscriptions?.isSubscribed?.("plugin.udpCombatLogForwarder") !== false;
  }

  function sanitizePayload(payload) {
    return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
  }

  function buildPayload(event) {
    const record = event?.record;
    if (!record) return null;

    const payload = {
      schema: "bzss.combat.log.v1",
      source: "plugin.udpCombatLogForwarder",
      eventName: event.eventName ?? "module.killManage.combatResolved",
      sentAt: new Date().toISOString(),
      serverId: record.serverId ?? event.serverId ?? null,
      time: record.time ?? event.time ?? null,
      logTime: record.logTime ?? event.logTime ?? null,
      sourceEventId: record.sourceEventId ?? record.provenance?.sourceEventId ?? event.eventId ?? null,
      sourceMode: record.sourceMode ?? null,
      observedModes: Array.isArray(record.observedModes) ? record.observedModes : [],
      isReplay: Boolean(record.isReplay),
      type: record.type ?? null,
      isFriendlyFire: Boolean(record.isFriendlyFire),
      isTeamKill: Boolean(record.isTeamKill ?? record.tk),
      isTeamKillDown: Boolean(record.isTeamKillDown ?? record.tkDown),
      friendlyFireType: record.friendlyFireType ?? null,
      friendlyFireLabel: record.friendlyFireLabel ?? null,
      friendlyFireReason: record.friendlyFireReason ?? null,
      teamKillReason: record.teamKillReason ?? null,
      attackerTeamID: record.attackerTeamID ?? record.attacker?.teamID ?? null,
      victimTeamID: record.victimTeamID ?? record.victim?.teamID ?? null,
      attackerName: record.attackerName ?? record.attacker?.name ?? null,
      victimName: record.victimName ?? record.victim?.name ?? null,
      attackerSteam64ID: record.attackerSteam64ID ?? record.attacker?.steam64ID ?? null,
      attackerEOSID: record.attackerEOSID ?? record.attacker?.eosID ?? null,
      attackerControllerID: record.attackerControllerID ?? record.attacker?.controllerID ?? null,
      victimSteam64ID: record.victimSteam64ID ?? record.victim?.steam64ID ?? null,
      victimEOSID: record.victimEOSID ?? record.victim?.eosID ?? null,
      damage: record.damage ?? null,
      weapon: record.weapon ?? null,
      rawCausedBy: record.rawCausedBy ?? null,
      causedBy: record.causedBy ?? record.weapon ?? null,
      causedByCategory: record.causedByCategory ?? null,
      confidence: record.confidence ?? record.parse?.confidence ?? null,
      identityConfidence: record.identityConfidence ?? record.parse?.identityConfidence ?? null,
      parseConfidence: record.parseConfidence ?? record.parse?.parseConfidence ?? null,
      parseStatus: record.parseStatus ?? record.parse?.status ?? null,
      rawLog: record.rawLog ?? record.provenance?.rawLog ?? "",
      rawEvent: runtimeConfig?.includeRawEvent ? (record.rawEvent ?? event.rawEvent ?? null) : undefined,
      normalized: runtimeConfig?.includeNormalized ? (record.normalized ?? event.normalized ?? record) : undefined,
      params: runtimeConfig?.includeParams ? (record.params ?? event.params ?? null) : undefined,
    };

    return sanitizePayload(payload);
  }

  function sendPayload(payload) {
    if (!socket || !runtimeConfig?.enabled) return;

    const message = Buffer.from(JSON.stringify(payload), "utf8");
    if (message.length > runtimeConfig.maxMessageBytes) {
      droppedOversizeCount += 1;
      if (droppedOversizeCount <= 5 || droppedOversizeCount % 100 === 0) {
        core.logger.warn(
          `[UdpCombatLogForwarder] message too large (${message.length} bytes > ${runtimeConfig.maxMessageBytes}), dropped`,
          {
            operation: "udpSend",
            data: {
              host: runtimeConfig.host,
              port: runtimeConfig.port,
              droppedOversizeCount,
            },
          }
        );
      }
      return;
    }

    socket.send(message, runtimeConfig.port, runtimeConfig.host, (error) => {
      if (error) {
        core.logger.warn(`[UdpCombatLogForwarder] udp send failed: ${error.message}`, {
          operation: "udpSend",
          data: {
            host: runtimeConfig.host,
            port: runtimeConfig.port,
          },
        });
      }
    });
  }

  function handleCombatEvent(event) {
    if (!runtimeConfig?.enabled || !isSubscribed()) return;

    const payload = buildPayload(event);
    if (!payload) return;
    sendPayload(payload);
  }

  const api = {
    getStatus() {
      return {
        enabled: Boolean(runtimeConfig?.enabled),
        host: runtimeConfig?.host ?? null,
        port: runtimeConfig?.port ?? null,
        family: runtimeConfig?.family ?? null,
        maxMessageBytes: runtimeConfig?.maxMessageBytes ?? null,
        droppedOversizeCount,
      };
    },
  };

  return {
    manifest: {
      id: "plugin.udpCombatLogForwarder",
      name: "UDP Combat Log Forwarder",
      kind: "plugin",
      version: "0.2.0",
      description: "订阅战斗信息收集器的实时 combatEvent，并将每条伤害、击倒、死亡记录通过 UDP 转发；日志溯源不会进入实时通道。",
    },
    apiName: "udpCombatLogForwarder",
    api,

    async start() {
      runtimeConfig = readConfig();
      if (!runtimeConfig.enabled) {
        core.logger.info("[UdpCombatLogForwarder] disabled by config");
        return;
      }

      socket = dgram.createSocket(runtimeConfig.family);
      socket.on("error", (error) => {
        core.logger.warn(`[UdpCombatLogForwarder] socket error: ${error.message}`, {
          operation: "socketError",
          data: {
            host: runtimeConfig.host,
            port: runtimeConfig.port,
          },
        });
      });

      unsubscribers.push(
        core.eventBus.onModuleEvent("module.combatCollector", "combatEvent", (event) => {
          handleCombatEvent(event);
        })
      );

      core.logger.info(
        `[UdpCombatLogForwarder] forwarding combat logs to ${runtimeConfig.host}:${runtimeConfig.port}/${runtimeConfig.family}`
      );
    },

    async stop() {
      for (const unsubscriber of unsubscribers.splice(0)) {
        unsubscriber();
      }

      if (socket) {
        await new Promise((resolve) => {
          socket.close(() => resolve());
        });
        socket = null;
      }

      runtimeConfig = null;
      core.logger.info("[UdpCombatLogForwarder] stopped");
    },
  };
}
