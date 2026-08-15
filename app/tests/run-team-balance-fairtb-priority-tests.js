import assert from "node:assert/strict";

import { createTeamBalanceModule } from "../modules/team-balance/index.js";

function createHarness() {
  const dispatches = [];
  const logger = {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };

  const module = createTeamBalanceModule({
    core: {
      logger,
      createLogger() {
        return logger;
      },
      rconManager: {
        async dispatchCommand(request) {
          dispatches.push(request);
          return {
            success: true,
            message: "RCON command executed.",
            rconExecuted: true,
            rconResponse: "OK",
          };
        },
      },
      webStatus: {
        serverId: "test-server",
        getSnapshot() {
          return { serverId: "test-server" };
        },
      },
      eventBus: {},
    },
    modules: {},
    config: {
      get(path, fallback) {
        if (path === "modules.teamBalance") {
          return {
            enabled: true,
            switchPermission: "squad.switch",
          };
        }
        return fallback;
      },
    },
    logger,
  });

  return { module, dispatches };
}

async function testFairTbIsInteractivePriority() {
  const { module, dispatches } = createHarness();

  const result = await module.api.forceTeamChange({
    steamId: "76561198000000001",
    playerName: "FairTB Player",
    source: "plugin.fairTeamBalance.tb",
    reason: "fair_tb_chat",
    system: true,
  });

  assert.equal(result.ok, true);
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].priority, "interactive");
  assert.equal(dispatches[0].maxQueueWaitMs, 5000);
}

async function testFairTbApprovalIsInteractivePriority() {
  const { module, dispatches } = createHarness();

  await module.api.forceTeamChange({
    steamId: "76561198000000002",
    playerName: "SQTB Player",
    source: "plugin.fairTeamBalance.approve",
    reason: "fair_sqtb_claim_approve",
    system: true,
  });

  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].priority, "interactive");
}

async function testManualTeamBalancePriorityIsUnchanged() {
  const { module, dispatches } = createHarness();

  await module.api.forceTeamChange({
    steamId: "76561198000000003",
    playerName: "Manual Player",
    source: "web.matchStatus",
    reason: "manual_team_balance",
    system: true,
  });

  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].priority, false);
}

await testFairTbIsInteractivePriority();
await testFairTbApprovalIsInteractivePriority();
await testManualTeamBalancePriorityIsUnchanged();

console.log("team balance FairTB priority tests passed");
