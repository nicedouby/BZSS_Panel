import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSquadManagementModule } from "../modules/squad-management/index.js";
import { createSquadDisbandModule } from "../modules/squad-disband/index.js";
import { createSquadKickModule } from "../modules/squad-kick/index.js";
import { createSquadRemoveModule } from "../modules/squad-remove/index.js";

const SERVER_ID = "BZSS_Main";
const MATCH_ID = "match-1";

function createHarness(overrides = {}) {
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), "squad-management-test-"));
  const commandCalls = {
    disband: [],
    kick: [],
    remove: [],
    dispatch: [],
    refresh: [],
  };
  const coreEvents = [];
  const moduleEvents = [];
  const coreListeners = new Map();
  const moduleListeners = new Map();

  const core = {
    eventBus: {
      onCoreEvent(name, fn) {
        const list = coreListeners.get(name) ?? [];
        list.push(fn);
        coreListeners.set(name, list);
        return () => {
          const next = (coreListeners.get(name) ?? []).filter((listener) => listener !== fn);
          coreListeners.set(name, next);
        };
      },
      onModuleEvent(module, name, fn) {
        const key = `${module}:${name}`;
        const list = moduleListeners.get(key) ?? [];
        list.push(fn);
        moduleListeners.set(key, list);
        return () => {
          const next = (moduleListeners.get(key) ?? []).filter((listener) => listener !== fn);
          moduleListeners.set(key, next);
        };
      },
      emitCoreEvent(name, payload) {
        coreEvents.push({ name, payload });
        for (const listener of coreListeners.get(name) ?? []) {
          listener(payload);
        }
      },
      emitModuleEvent(module, name, payload) {
        moduleEvents.push({ module, name, payload });
        for (const listener of moduleListeners.get(`${module}:${name}`) ?? []) {
          listener(payload);
        }
      },
    },
    createLogger() {
      return logger;
    },
    logger,
    logClock: {
      getSeconds() {
        return overrides.logClockSeconds ?? 0;
      },
    },
    rconManager: {
      async dispatchCommand({ command, reason, requestedBy, system }) {
        commandCalls.dispatch.push({ command, reason, requestedBy, system });
        return {
          success: true,
          rconExecuted: true,
          rconResponse: "OK",
        };
      },
      getStatus() {
        return { connected: true, enabled: true };
      },
    },
    squadRcon: {
      async adminDisbandSquad(teamId, squadId) {
        commandCalls.disband.push({ teamId, squadId });
        return "OK";
      },
      async kick(target, reason) {
        commandCalls.kick.push({ target, reason });
        return "OK";
      },
      async kickFromSquad(target, reason) {
        commandCalls.remove.push({ target, reason });
        return "OK";
      },
    },
    webStatus: {
      serverId: SERVER_ID,
      getSnapshot() {
        return { serverId: SERVER_ID };
      },
      patch() {},
    },
    authManager: {
      hasEverything(user) {
        return Boolean(user?.isSuperAdmin);
      },
      hasPermission(user, permission) {
        return Boolean(user?.isSuperAdmin || user?.permissions?.includes?.(permission));
      },
    },
  };

  const modules = {
    squadLifecycle: {
      getCurrentSnapshot() {
        return {
          serverId: SERVER_ID,
          matchId: MATCH_ID,
          list: [],
        };
      },
      getCurrentMatchId() {
        return MATCH_ID;
      },
    },
    matchState: {
      async refresh(type = "all") {
        commandCalls.refresh.push(type);
        if (type === "squads" || type === "all") {
          const squads = typeof overrides.refreshSquads === "function"
            ? overrides.refreshSquads()
            : overrides.refreshSquads ?? [];
          core.eventBus.emitCoreEvent("RCON_LIST_SQUADS_UPDATED", {
            serverId: SERVER_ID,
            matchId: MATCH_ID,
            squads,
            time: new Date().toISOString(),
          });
        }
        return { ok: true, type };
      },
    },
    playerState: {
      getState() {
        return { players: [] };
      },
    },
  };

  const config = {
    get(key, defaultValue) {
      if (key === "database") {
        return {
          dir: tempDbDir,
          filename: "squad-management-tests.db",
        };
      }
      if (key === "modules.squadManagement") {
        return {
          enabled: true,
          enforcementEnabled: true,
          disbandPermission: "squad.disband",
          kickPermission: "squad.kick",
          removePermission: "squad.remove",
          kickThreshold: overrides.kickThreshold ?? 10,
          noBuildUntilSeconds: overrides.noBuildUntilSeconds ?? 0,
          infantryOnlyUntilSeconds: overrides.infantryOnlyUntilSeconds ?? 0,
          allowedInfantryNames: overrides.allowedInfantryNames ?? ["INF", "Infantry"],
          defaultSquadNamePattern: overrides.defaultSquadNamePattern ?? "^Squad\\s*\\d+$",
        };
      }
      return defaultValue;
    },
  };

  const module = createSquadManagementModule({ core, modules, config, logger });
  const legacyModules = {
    squadManagement: module.api,
    squadDisband: createSquadDisbandModule({ core, modules: { squadManagement: module.api }, config, logger }),
    squadKick: createSquadKickModule({ core, modules: { squadManagement: module.api }, config, logger }),
    squadRemove: createSquadRemoveModule({ core, modules: { squadManagement: module.api }, config, logger }),
  };

  return {
    core,
    modules,
    module,
    legacyModules,
    tempDbDir,
    commandCalls,
    coreEvents,
    moduleEvents,
  };
}

const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  module() {},
};

function sleep(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedSquads(harness, squads) {
  harness.core.eventBus.emitCoreEvent("RCON_LIST_SQUADS_UPDATED", {
    serverId: SERVER_ID,
    matchId: MATCH_ID,
    squads,
    time: new Date().toISOString(),
  });
  await sleep();
}

async function seedPlayers(harness, players) {
  harness.core.eventBus.emitCoreEvent("RCON_LIST_PLAYERS_UPDATED", {
    serverId: SERVER_ID,
    players,
    time: new Date().toISOString(),
  });
  await sleep();
}

function latestModuleEvent(harness, name) {
  return [...harness.moduleEvents].reverse().find((event) => event.module === "module.squadManagement" && event.name === name) ?? null;
}

async function testExecuteActionDisband() {
  const harness = createHarness();
  await harness.module.init();
  await harness.module.start();
  await seedSquads(harness, [
    { teamId: 1, squadId: 2, squadName: "Squad 2", teamName: "Alpha" },
  ]);

  const result = await harness.module.api.executeAction({
    type: "disband_squad",
    serverId: SERVER_ID,
    teamId: 1,
    squadId: 2,
    reason: "test",
    system: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.type, "disband_squad");
  assert.equal(result.action, "disband");
  assert.equal(result.command, "AdminDisbandSquad 1 2");
  assert.equal(harness.commandCalls.disband.length, 1);
  assert.deepEqual(harness.commandCalls.disband[0], { teamId: 1, squadId: 2 });

  const records = await harness.module.api.getRecords({ kind: "disband", limit: 10 });
  assert.equal(records.records.some((record) => record.kind === "disband"), true);
  assert.equal(Boolean(latestModuleEvent(harness, "actionExecuted")), true);
  assert.equal(Boolean(latestModuleEvent(harness, "squadDisbanded")), true);

  await harness.module.stop();
  fs.rmSync(harness.tempDbDir, { recursive: true, force: true });
}

async function testExecuteActionKick() {
  const harness = createHarness();
  await harness.module.init();
  await harness.module.start();
  await seedPlayers(harness, [
    { name: "KickTarget", steamId: "76561198000000011", eosId: "eos-11" },
  ]);

  const result = await harness.module.api.executeAction({
    type: "kick_player",
    serverId: SERVER_ID,
    steamId: "76561198000000011",
    reason: "test",
    system: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.type, "kick_player");
  assert.equal(result.action, "kick");
  assert.equal(result.command, 'AdminKick "76561198000000011" test');
  assert.equal(harness.commandCalls.kick.length, 1);
  assert.deepEqual(harness.commandCalls.kick[0], {
    target: "76561198000000011",
    reason: "test",
  });
  assert.equal(Boolean(latestModuleEvent(harness, "playerKicked")), true);

  await harness.module.stop();
  fs.rmSync(harness.tempDbDir, { recursive: true, force: true });
}

async function testExecuteActionRemoveFromSquad() {
  const harness = createHarness();
  await harness.module.init();
  await harness.module.start();
  await seedPlayers(harness, [
    { name: "RemoveTarget", steamId: "76561198000000031" },
  ]);

  const result = await harness.module.api.executeAction({
    type: "remove_from_squad",
    serverId: SERVER_ID,
    steamId: "76561198000000031",
    reason: "test",
    system: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.type, "remove_from_squad");
  assert.equal(result.action, "remove");
  assert.equal(result.command, 'AdminKickFromSquad "76561198000000031" test');
  assert.equal(harness.commandCalls.remove.length, 1);
  assert.deepEqual(harness.commandCalls.remove[0], {
    target: "76561198000000031",
    reason: "test",
  });
  assert.equal(Boolean(latestModuleEvent(harness, "playerRemovedFromSquad")), true);

  await harness.module.stop();
  fs.rmSync(harness.tempDbDir, { recursive: true, force: true });
}

async function testLegacyCompatibility() {
  const harness = createHarness();
  await harness.module.init();
  await harness.module.start();
  await seedSquads(harness, [
    { teamId: 1, squadId: 2, squadName: "Squad 2" },
  ]);
  await seedPlayers(harness, [
    { name: "LegacyKick", steamId: "76561198000000021" },
    { name: "LegacyRemove", steamId: "76561198000000022" },
  ]);

  const disband = await harness.module.api.disband({
    serverId: SERVER_ID,
    teamId: 1,
    squadId: 2,
    reason: "legacy",
    source: "test.legacy",
    system: true,
  });
  const legacyDisband = await harness.legacyModules.squadDisband.api.disbandSquad({
    serverId: SERVER_ID,
    teamId: 1,
    squadId: 2,
    reason: "legacy wrapper",
    system: true,
  });
  const kick = await harness.module.api.kick({
    serverId: SERVER_ID,
    steamId: "76561198000000021",
    reason: "legacy kick",
    system: true,
  });
  const legacyKick = await harness.legacyModules.squadKick.api.kickPlayer({
    serverId: SERVER_ID,
    steamId: "76561198000000021",
    reason: "legacy wrapper",
    system: true,
  });
  const remove = await harness.module.api.requestRemoveFromSquad({
    serverId: SERVER_ID,
    steamId: "76561198000000022",
    reason: "legacy remove",
    system: true,
  });
  const legacyRemove = await harness.legacyModules.squadRemove.api.removePlayerFromSquad({
    serverId: SERVER_ID,
    steamId: "76561198000000022",
    reason: "legacy wrapper",
    system: true,
  });

  assert.equal(disband.ok, true);
  assert.equal(legacyDisband.ok, true);
  assert.equal(kick.ok, true);
  assert.equal(legacyKick.ok, true);
  assert.equal(remove.ok, true);
  assert.equal(legacyRemove.ok, true);
  assert.equal(harness.commandCalls.disband.length >= 2, true);
  assert.equal(harness.commandCalls.kick.length >= 2, true);
  assert.equal(harness.commandCalls.remove.length >= 2, true);

  await harness.module.stop();
  fs.rmSync(harness.tempDbDir, { recursive: true, force: true });
}

async function testDisbandRefreshRetry() {
  let refreshed = false;
  const harness = createHarness({
    refreshSquads: () => {
      refreshed = true;
      return [
        { teamId: 1, squadId: 7, squadName: "Squad 7", teamName: "Alpha" },
      ];
    },
  });
  await harness.module.init();
  await harness.module.start();

  const result = await harness.module.api.executeAction({
    type: "disband_squad",
    serverId: SERVER_ID,
    teamId: 1,
    squadId: 7,
    reason: "refresh-test",
    system: true,
  });

  assert.equal(refreshed, true);
  assert.equal(result.ok, true);
  assert.equal(harness.commandCalls.disband.length, 1);
  assert.equal(harness.commandCalls.refresh.includes("squads"), true);

  await harness.module.stop();
  fs.rmSync(harness.tempDbDir, { recursive: true, force: true });
}

async function main() {
  await testExecuteActionDisband();
  await testExecuteActionKick();
  await testExecuteActionRemoveFromSquad();
  await testLegacyCompatibility();
  await testDisbandRefreshRetry();
  console.log("Passed: squad management gateway tests");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
