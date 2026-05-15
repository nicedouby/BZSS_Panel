import assert from "node:assert/strict";

import { createTeamBalanceModule } from "../modules/team-balance/index.js";

function createModule(overrides = {}) {
  const commands = [];
  const module = createTeamBalanceModule({
    core: {
      rconManager: {
        async dispatchCommand({ command }) {
          commands.push(command);
          return {
            success: true,
            message: "RCON command executed.",
            rconExecuted: true,
            rconResponse: "OK",
          };
        },
      },
      authManager: {
        hasPermission() {
          return true;
        },
      },
      eventBus: {
        emitModuleEvent() {},
      },
      webStatus: {
        serverId: "BZSS_Main",
      },
      ...overrides.core,
    },
    modules: {
      audit: {
        async record() {
          return null;
        },
      },
      ...overrides.modules,
    },
    config: {
      get(path, fallbackValue) {
        if (path === "modules.teamBalance") {
          return {
            enabled: true,
            permission: "tb",
            commandTemplate: 'AdminForceTeamChange "{name}"',
            historyLimit: 200,
            ...(overrides.moduleConfig ?? {}),
          };
        }
        return fallbackValue;
      },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
      ...overrides.logger,
    },
  });

  return {
    api: module.api,
    commands,
  };
}

async function testBalanceOnlyAssignsContainerTargetsWithoutExecutingRcon() {
  const { api, commands } = createModule();
  api.setContainers([
    {
      id: "A",
      name: "A",
      players: [
        { playerID: 1, name: "P1", teamID: 1, online: true, steamID: "steam-1" },
        { playerID: 2, name: "P2", teamID: 1, online: true, steamID: "steam-2" },
        { playerID: 3, name: "P3", teamID: 1, online: true, steamID: "steam-3" },
      ],
    },
    {
      id: "B",
      name: "B",
      players: [
        { playerID: 4, name: "P4", teamID: 2, online: true, steamID: "steam-4" },
        { playerID: 5, name: "P5", teamID: 2, online: true, steamID: "steam-5" },
      ],
    },
  ]);

  const plan = api.balanceOnly();
  const state = api.getState();

  assert.equal(plan.containers.length, 2);
  assert.equal(state.containers.every((container) => container.targetTeam === 1 || container.targetTeam === 2), true);
  assert.equal(commands.length, 0);
}

async function testExecutePlanOnlySwitchesOnlinePlayersNeedingChange() {
  const { api, commands } = createModule();
  api.setContainers([
    {
      id: "A",
      name: "Alpha",
      targetTeam: 2,
      players: [
        { playerID: 1, name: "NeedSwitch", teamID: 1, online: true, steamID: "steam-1" },
        { playerID: 2, name: "AlreadyThere", teamID: 2, online: true, steamID: "steam-2" },
        { playerID: 3, name: "Offline", teamID: 1, online: false, steamID: "steam-3" },
        { playerID: 4, name: "NoTeam", teamID: 0, online: true, steamID: "steam-4" },
      ],
    },
  ]);

  const result = await api.executePlan(null, {
    actor: {
      username: "admin",
    },
  });

  assert.equal(commands.length, 1);
  assert.match(commands[0], /AdminForceTeamChange "steam-1"/);
  assert.equal(result.totalPlayers, 4);
  assert.equal(result.switched, 1);
  assert.equal(result.skipped, 3);
  assert.equal(result.failed, 0);
}

async function testBalanceSingleContainerCanForceSpecificTargetTeam() {
  const { api } = createModule();
  api.setContainers([
    {
      id: "A",
      name: "Alpha",
      players: [
        { playerID: 1, name: "P1", teamID: 1, online: true, steamID: "steam-1" },
      ],
    },
  ]);

  const result = api.balanceSingleContainer("A", 2);
  assert.equal(result.container.targetTeam, 2);
  assert.equal(result.plan.mode, "singleContainer");
  assert.equal(result.plan.containers[0].targetTeam, 2);
}

await testBalanceOnlyAssignsContainerTargetsWithoutExecutingRcon();
await testExecutePlanOnlySwitchesOnlinePlayersNeedingChange();
await testBalanceSingleContainerCanForceSpecificTargetTeam();

console.log("team balance tests passed");
