import assert from "node:assert/strict";

import { createKillManageModule } from "../modules/kill-manage/index.js";

function createHarness(overrides = {}) {
  const commands = [];
  const registeredPages = [];
  const players = overrides.players ?? [
    { serverId: "server-1", playerID: 17, name: "Player One", steamID: "76561198000000001", eosID: "eos-player-one" },
    { serverId: "server-1", playerID: 21, name: "A", steamID: "steam-a", eosID: "eos-a" },
    { serverId: "server-1", playerID: 22, name: "B", steamID: "steam-b", eosID: "eos-b" },
    { serverId: "server-1", playerID: 23, name: "C", steamID: "steam-c", eosID: "eos-c" },
  ];
  const core = {
    rconManager: {
      async dispatchCommand(request) {
        commands.push(request);
        return overrides.dispatchResult ?? {
          success: true,
          message: "OK",
        };
      },
    },
    webRegistry: {
      registerPage(page) {
        registeredPages.push(page);
      },
    },
    createLogger() {
      return logger;
    },
    logger,
  };
  const modules = {
    playerState: {
      findPlayer(serverId, identity = {}) {
        const serverPlayers = players.filter((player) => String(player.serverId) === String(serverId));
        if (identity.steamID) {
          const bySteam = serverPlayers.find((player) => String(player.steamID) === String(identity.steamID));
          if (bySteam) return { ...bySteam };
        }
        if (identity.eosID) {
          const byEos = serverPlayers.find((player) => String(player.eosID) === String(identity.eosID));
          if (byEos) return { ...byEos };
        }
        if (identity.name) {
          const byName = serverPlayers.find((player) => String(player.name) === String(identity.name));
          if (byName) return { ...byName };
        }
        return null;
      },
      getState() {
        const byServer = {};
        for (const player of players) {
          const serverId = String(player.serverId);
          byServer[serverId] ??= { serverId, players: [] };
          byServer[serverId].players.push({ ...player });
        }
        return { byServer };
      },
    },
  };
  const config = {
    get(path, defaultValue) {
      if (path === "modules.killManage") {
        return {
          enabled: overrides.enabled ?? true,
          maxRecords: 2,
        };
      }
      return defaultValue;
    },
  };
  const module = createKillManageModule({ core, modules, config, logger });
  return { module, commands, registeredPages };
}

const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

async function testKillPlayerUsesExplicitListPlayersId() {
  const harness = createHarness();

  const result = await harness.module.api.killPlayer({
    targetPlayerId: 45,
    targetName: "Player One",
    targetSteamId: "76561198000000001",
    reason: "test",
    system: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.targetPlayerId, "45");
  assert.equal(result.targetResolution, "explicit_list_players_id");
  assert.equal(result.command, "AdminKill 45");
  assert.equal(harness.commands.length, 1);
  assert.equal(harness.commands[0].command, "AdminKill 45");
  assert.equal(harness.commands[0].requestedBy, "module.killManage");
  assert.equal(harness.commands[0].priority, "high");
}

async function testKillPlayerResolvesListPlayersIdFromCurrentPlayerState() {
  const harness = createHarness();

  const result = await harness.module.api.killPlayer({
    serverId: "server-1",
    targetName: "Player One",
    targetSteamId: "76561198000000001",
    targetEosId: "eos-player-one",
    reason: "test",
  });

  assert.equal(result.success, true);
  assert.equal(result.targetPlayerId, "17");
  assert.equal(result.targetResolution, "player_state_list_players_snapshot");
  assert.equal(result.command, "AdminKill 17");
  assert.notEqual(result.command, 'AdminKill "Player One"');
  assert.equal(result.command.includes("76561198000000001"), false);
  assert.equal(result.command.includes("eos-player-one"), false);
}

async function testSteamIdIsLookupOnlyNeverCommandTarget() {
  const harness = createHarness();

  const result = await harness.module.api.killPlayer({
    targetSteamId: "steam-b",
  });

  assert.equal(result.success, true);
  assert.equal(result.targetPlayerId, "22");
  assert.equal(result.command, "AdminKill 22");
  assert.equal(result.command.includes("steam-b"), false);
}

async function testMissingListPlayersIdIsStoredAndSkipped() {
  const harness = createHarness();

  const result = await harness.module.api.killPlayer({ targetName: "Not Online" });

  assert.equal(result.success, false);
  assert.equal(result.skipped, true);
  assert.equal(result.error, "MissingListPlayersPlayerId");
  assert.equal(result.skipReason, "missing_list_players_player_id");
  assert.equal(result.command, "");
  assert.equal(harness.commands.length, 0);
  assert.equal(harness.module.api.getRecentKills("", 10).length, 1);
}

async function testStoreHonorsMaxRecords() {
  const harness = createHarness();

  await harness.module.api.killPlayer({ targetPlayerId: 21, targetName: "A", system: true });
  await harness.module.api.killPlayer({ targetPlayerId: 22, targetName: "B", system: true });
  await harness.module.api.killPlayer({ targetPlayerId: 23, targetName: "C", system: true });

  const records = harness.module.api.getRecentKills("", 10);
  assert.equal(records.length, 2);
  assert.equal(records[0].targetName, "C");
  assert.equal(records[0].targetPlayerId, "23");
  assert.equal(records[1].targetName, "B");
  assert.equal(records[1].targetPlayerId, "22");
}

async function testStartRegistersHiddenPage() {
  const harness = createHarness();

  await harness.module.start();

  assert.equal(harness.registeredPages.length, 1);
  assert.equal(harness.registeredPages[0].id, "web.killManage");
}

await testKillPlayerUsesExplicitListPlayersId();
await testKillPlayerResolvesListPlayersIdFromCurrentPlayerState();
await testSteamIdIsLookupOnlyNeverCommandTarget();
await testMissingListPlayersIdIsStoredAndSkipped();
await testStoreHonorsMaxRecords();
await testStartRegistersHiddenPage();

console.log("kill manage tests passed");
