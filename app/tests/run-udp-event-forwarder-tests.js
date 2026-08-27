import assert from "node:assert/strict";

import { createPlugin as createUdpEventForwarderPlugin } from "../plugins/udp_event_forwarder.js";

function createHarness({ pluginConfig } = {}) {
  const listeners = new Map();
  const core = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    config: {
      get(pathText, defaultValue) {
        if (pathText === "plugins.udpEventForwarder") {
          return pluginConfig ?? {
            enabled: true,
            host: "127.0.0.1",
            port: 41234,
            sendCombatEvents: true,
            sendMapChanged: false,
            sendStatus: false,
            sendHeartbeat: false,
            logSuccess: false,
            logFailure: false,
          };
        }
        return defaultValue;
      },
    },
    pluginSubscriptions: { isSubscribed() { return true; } },
    eventBus: {
      onModuleEvent(moduleId, eventName, handler) {
        const key = `${moduleId}:${eventName}`;
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(handler);
        return () => listeners.get(key)?.delete(handler);
      },
    },
  };

  const plugin = createUdpEventForwarderPlugin({
    core,
    modules: {
      pluginSubscriptions: { isSubscribed() { return true; } },
      combatClean: {
        getState() {
          return { events: [], count: 0, stats: {}, lastUpdatedAt: "" };
        },
      },
      matchState: {
        getState() {
          return {
            serverId: "BZSS_Main",
            players: {
              count: 0,
              max: 0,
            },
            match: {},
            serverStatus: {},
          };
        },
      },
      roundState: {
        getState() {
          return { current: null };
        },
      },
    },
  });

  return { plugin, listeners };
}

async function testProcessedReviveIsForwarded() {
  const { plugin, listeners } = createHarness();
  await plugin.start();

  const handler = [...(listeners.get("module.combatClean:reviveResolved") ?? [])][0];
  assert.ok(handler, "reviveResolved handler should be registered");

  handler({
    eventId: "clean:revive:1",
    eventName: "module.combatClean.reviveResolved",
    layer: "module",
    source: "module.combatClean",
    serverId: "BZSS_Main",
    time: "2026-05-15T08:44:22.528Z",
    record: {
      id: "revive:1",
      serverId: "BZSS_Main",
      time: "2026-05-15T08:44:22.528Z",
      logTime: "2026.05.15-08.44.22:528",
      type: "revive",
      eventName: "BZSS_REVIVE",
      attacker: { name: "Medic" },
      victim: { name: "Victim" },
      attackerName: "Medic",
      victimName: "Victim",
      damage: null,
      weapon: { displayName: "Unknown" },
      relation: {
        attackerTeamID: 1,
        victimTeamID: 1,
        sameTeam: true,
        isFriendlyFire: false,
        friendlyFireType: "",
        teamSource: "raw",
      },
      displayText: "Medic revived Victim",
      raw: {
        sourceModule: "module.killManage",
        sourceEventId: "raw:revive:1",
        rawLog: "raw revive",
      },
    },
  });

  const logs = plugin.api.getLogs({ type: "combat.revive", limit: 10 });
  assert.equal(logs.total, 1);
  assert.equal(logs.logs.length, 1);
  assert.equal(logs.logs[0].type, "combat.revive");
  assert.equal(logs.logs[0].payload.combatType, "revive");
  assert.equal(logs.logs[0].payload.eventName, "BZSS_REVIVE");
  assert.equal(logs.logs[0].source.eventBusEvent, "module.combatClean.reviveResolved");

  await plugin.stop();
}

async function testCollectorForwardsEveryRecordIncludingNullFields() {
  const { plugin, listeners } = createHarness({
    pluginConfig: {
      enabled: true,
      host: "127.0.0.1",
      port: 41234,
      sendCombatEvents: true,
      sendMapChanged: false,
      sendStatus: false,
      sendHeartbeat: false,
      includeRawLog: true,
      maxPacketBytes: 8192,
      logSuccess: false,
      logFailure: false,
    },
  });
  await plugin.start();

  const handler = [...(listeners.get("module.combatCollector:combatEvent") ?? [])][0];
  assert.ok(handler, "combatCollector combatEvent handler should be registered");

  for (const type of ["damage", "wound", "death"]) {
    handler({
      eventName: "module.combatCollector.combatEvent",
      serverId: "BZSS_Main",
      time: "2026-08-27T08:00:00.000Z",
      record: {
        schema: "combat-event.v1",
        id: `collector:${type}:nullptr`,
        type,
        serverId: "BZSS_Main",
        time: "2026-08-27T08:00:00.000Z",
        logTime: "2026.08.27-08.00.00:000",
        attacker: {
          name: null,
          nameState: "nullptr",
          steam64ID: null,
          eosID: null,
          controllerID: null,
          teamID: null,
        },
        victim: {
          name: null,
          nameState: "nullptr",
          steam64ID: null,
          eosID: null,
          controllerID: null,
          teamID: null,
        },
        weapon: null,
        weaponState: "nullptr",
        rawWeapon: "nullptr",
        damage: null,
        relation: { known: false, sameTeam: false, reason: "" },
        source: "combat-collector",
        sourceMode: "live",
        observedModes: ["live"],
        isReplay: false,
        provenance: {
          sourceEventId: `source:${type}:nullptr`,
          rawLog: `raw ${type} nullptr`,
        },
      },
    });
  }

  const logs = plugin.api.getLogs({ limit: 10 });
  assert.equal(logs.total, 3);
  assert.deepEqual(
    logs.logs.map((entry) => entry.type).sort(),
    ["combat.damage", "combat.kill", "combat.wound"],
  );
  for (const entry of logs.logs) {
    assert.equal(entry.accepted, true, `${entry.type} must enter the UDP queue`);
    assert.equal(entry.payload.attackerName, null);
    assert.equal(entry.payload.victimName, null);
    assert.deepEqual(Object.keys(entry.payload).sort(), [
      "attacker", "attackerName", "combatType", "damage", "displayText",
      "eventName", "logTime", "raw", "relation", "time", "victim",
      "victimName", "weapon",
    ]);
    assert.equal(entry.source.eventBusEvent, "module.combatCollector.combatEvent");
  }
  assert.equal(plugin.api.getStatus().sender.oversized, 0);

  await plugin.stop();
}

await testProcessedReviveIsForwarded();
await testCollectorForwardsEveryRecordIncludingNullFields();

console.log("udp event forwarder tests passed");
