import assert from "node:assert/strict";
import { createPlugin, __test } from "../plugins/squad-members-playtime-warning.js";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function testPaginationPreservesCompleteRows() {
  const lines = Array.from(
    { length: 9 },
    (_, index) => `B组重型反坦克兵 玩家名称很长${index} ${(index + 1) * 100}h`,
  );
  const messages = __test.paginateWarningLines(lines, 100);
  assert.ok(messages.length > 1);
  assert.ok(messages.every((message) => message.length <= 100));
  assert.ok(messages.every((message) => !message.includes("\n")));

  const decoded = messages.flatMap((message) => (
    message.replace(/^\[\d+\/\d+\] /, "").split("\\n")
  ));
  assert.deepEqual(decoded, lines);
}

async function testSquadRosterOnlyTargetsLeader() {
  const warnings = [];
  const clock = { seconds: 299 };
  const players = Array.from({ length: 9 }, (_, index) => ({
    playerID: index + 1,
    name: index === 0 ? "Leader" : `Member-${index}`,
    steamID: `${1000 + index}`,
    eosID: `eos-${index}`,
    teamID: 1,
    squadID: 1,
    isLeader: index === 0,
    roleName: index === 0 ? "SquadLeader" : "Rifleman",
  }));

  const core = {
    webStatus: {
      serverId: "test-server",
      getSnapshot() {
        return {
          serverId: "test-server",
          logClockSeconds: clock.seconds,
          logClockAnchorLogTime: "round-a",
        };
      },
    },
    pluginSubscriptions: { isSubscribed() { return true; } },
    logger: { info() {}, warn() {}, debug() {} },
  };
  const modules = {
    playerState: { getPlayerList() { return players; } },
    playtime: {
      async getBySteamID() {
        return { game_seconds: 1234 * 3600 };
      },
    },
    adminWarn: {
      async warnPlayer(request) {
        warnings.push({ ...request });
        return { success: true };
      },
    },
  };
  const configValue = {
    enabled: true,
    firstWarningSeconds: 300,
    leaderWarningSeconds: 999,
    pollIntervalMs: 250,
    maxWarningChars: 100,
    splitWarningDelayMs: 0,
  };
  const config = {
    get(key, fallback) {
      return key === "plugins.squad-members-playtime-warning" ? configValue : fallback;
    },
  };

  const plugin = createPlugin({ core, modules, config });
  await plugin.start();
  await wait(280);
  clock.seconds = 300;
  await wait(400);
  await plugin.stop();

  assert.ok(warnings.length > 1, "nine-player roster should be split into multiple warnings");
  assert.ok(warnings.every((warning) => warning.targetName === "Leader"));
  assert.ok(warnings.every((warning) => warning.message.length <= 100));
  assert.ok(warnings.every((warning) => !warning.message.includes("\n")));
}

try {
  testPaginationPreservesCompleteRows();
  await testSquadRosterOnlyTargetsLeader();
  console.log("Squad members playtime warning tests passed successfully!");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
