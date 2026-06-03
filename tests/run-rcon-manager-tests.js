import assert from "node:assert/strict";

import { RconManager } from "../core/rcon-manager.js";
import { createTeamBalanceService } from "../modules/team-balance/service.js";
import { resolveRconPermission } from "../web-client/src/shared/rcon-permissions.js";

function createHarness() {
  const executedCommands = [];
  const statusUpdates = [];

  const manager = new RconManager({
    config: {
      enabled: true,
      rateLimit: {
        minIntervalMs: 0,
        priorityMinIntervalMs: 0,
        maxQueueSize: 10,
      },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
    eventBus: {
      emitCoreEvent() {},
    },
    webStatus: {
      serverId: "BZSS_Main",
      set(key, value) {
        statusUpdates.push({ key, value });
      },
    },
  });

  manager.squadRcon = {
    connected: true,
    loggedIn: true,
    async connect() {
      this.connected = true;
      this.loggedIn = true;
    },
    async execute(command) {
      executedCommands.push(command);
      return "OK";
    },
  };

  return { manager, executedCommands, statusUpdates };
}

async function testResolveRconPermissionAliases() {
  assert.equal(resolveRconPermission("tb"), "rcon.tb");
  assert.equal(resolveRconPermission("AdminBroadcast Hello"), "rcon.broadcast");
  assert.equal(resolveRconPermission("AdminForceAllVehicleAvailability 1"), "rcon.tank_battle");
  assert.equal(resolveRconPermission("ListPlayers"), "rcon.read");
}

async function generateForceTeamChangeCommand() {
  const executedCommands = [];
  const service = createTeamBalanceService({
    core: {
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      rcon: {
        async execute(command) {
          executedCommands.push(command);
          return "OK";
        },
      },
    },
    config: {
      get() {
        return {
          enabled: true,
          switchPermission: "squad.switch",
        };
      },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
  });

  const result = await service.api.forceTeamChange({
    steamId: "76561198377609640",
    playerName: "PlayerName",
    source: "test",
    reason: "test",
    operator: {
      isSuperAdmin: true,
      permissions: ["*"],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(executedCommands.length, 1);
  return executedCommands[0];
}

async function testDispatchCommandRejectsMissingPermission() {
  const { manager, executedCommands } = createHarness();
  const result = await manager.dispatchCommand({
    command: "AdminBroadcast Hello",
    actor: {
      username: "viewer",
      permissions: ["rcon.warn"],
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.code, "Forbidden");
  assert.equal(result.requiredPermission, "rcon.broadcast");
  assert.equal(executedCommands.length, 0);
}

async function testDispatchCommandAllowsMatchingPermission() {
  const { manager, executedCommands } = createHarness();
  const command = await generateForceTeamChangeCommand();
  const result = await manager.dispatchCommand({
    command,
    actor: {
      username: "operator",
      permissions: ["rcon.tb"],
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.rconExecuted, true);
  assert.equal(result.rconResponse, "OK");
  assert.deepEqual(executedCommands, [command]);
}

async function testDispatchCommandAllowsSystemBypass() {
  const { manager, executedCommands } = createHarness();
  const result = await manager.dispatchCommand({
    command: "ListPlayers",
    system: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.rconExecuted, true);
  assert.deepEqual(executedCommands, ["ListPlayers"]);
}

await testResolveRconPermissionAliases();
await testDispatchCommandRejectsMissingPermission();
await testDispatchCommandAllowsMatchingPermission();
await testDispatchCommandAllowsSystemBypass();

console.log("rcon manager tests passed");
