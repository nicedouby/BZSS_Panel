import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPlugin } from "../plugins/match-end-snapshot.js";

function createHarness() {
  const players = [
    {
      playerID: 7,
      name: "Alpha",
      steamID: "76561198000000007",
      eosID: "eos-alpha",
      teamID: 1,
      squadID: 2,
      role: "Medic",
      isLeader: false,
    },
  ];
  const squads = [
    {
      teamID: 1,
      squadID: 2,
      teamName: "USA",
      squadName: "INF 2",
      size: 1,
      locked: false,
      creatorName: "Alpha",
    },
  ];
  const plugin = createPlugin({
    core: {},
    modules: {
      matchState: {
        api: {
          getOverview() {
            return {
              status: {
                serverId: "server-1",
                serverName: "BZSS Test",
                map: "Tallil_Outskirts",
                layer: "Tallil_Outskirts_RAAS_v1",
                nextLayer: "Fallujah_RAAS_v2",
                playerCount: 1,
                queueCount: 5,
              },
              matchState: {
                serverId: "server-1",
                players: { list: players },
                squads: { list: squads },
              },
              players,
              squads,
            };
          },
        },
      },
      bzssCoreMonitor: {
        api: {
          getState() {
            return { updatedAt: "2026-07-18T00:00:00.000Z" };
          },
          getPlayers() {
            return [
              {
                playerId: 7,
                playerIndex: 7,
                playerName: "Alpha",
                steamID: "76561198000000007",
                observedAt: "2026-07-18T00:00:00.000Z",
                stale: false,
                ping: 38,
                soldierInfo: {
                  soldierClass: "USA_Medic",
                  health: 64.5,
                },
                playerScoreboard: {
                  stats: {
                    numKills: 9,
                    numWoundeds: 12,
                    numDeaths: 4,
                    numTeamKills: 1,
                    vehicleKills: 2,
                    revivedPoints: 7,
                    healPoints: 800,
                    combatScore: 1400,
                    objectiveScore: 360,
                    teamworkScore: 950,
                  },
                },
              },
            ];
          },
        },
      },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  });
  return plugin;
}

async function testIndependentMatchEndSnapshots() {
  const oldCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-match-end-snapshot-"));
  process.chdir(tempDir);

  try {
    const plugin = createHarness();
    const item = await plugin.api.takeManualSnapshot();
    assert.ok(item);
    assert.equal(item.map, "Tallil_Outskirts");
    assert.equal(item.nextMap, "Fallujah");
    assert.equal(item.playerCount, 1);
    assert.equal(item.queueCount, 5);

    const list = await plugin.api.listSnapshots();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, item.id);

    const snapshot = await plugin.api.readSnapshot(item.id);
    assert.equal(snapshot.snapshotType, "match-end-data");
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.server.playerCount, 1);
    assert.equal(snapshot.server.queueCount, 5);
    assert.equal(snapshot.match.map, "Tallil_Outskirts");
    assert.equal(snapshot.match.nextMap, "Fallujah");
    assert.equal(snapshot.players[0].squadInfo.name, "INF 2");
    assert.equal(snapshot.players[0].role, "Medic");
    assert.equal(snapshot.players[0].health, 64.5);
    assert.deepEqual(snapshot.players[0].bzssCore, {
      available: true,
      observedAt: "2026-07-18T00:00:00.000Z",
      stale: false,
      health: 64.5,
      soldierClass: "USA_Medic",
      kills: 9,
      downs: 12,
      deaths: 4,
      teamKills: 1,
      vehicleKills: 2,
      revives: 7,
      healPoints: 800,
      combatScore: 1400,
      objectiveScore: 360,
      teamworkScore: 950,
      ping: 38,
    });

    const imageSnapshotDir = path.join(tempDir, "data", "match-snapshots");
    const endSnapshotDir = path.join(tempDir, "data", "match-end-snapshots");
    assert.equal(await fs.stat(endSnapshotDir).then((stat) => stat.isDirectory()), true);
    await assert.rejects(fs.stat(imageSnapshotDir), { code: "ENOENT" });

    const deleted = await plugin.api.deleteSnapshot(item.id);
    assert.equal(deleted.removed, true);
    assert.equal((await plugin.api.listSnapshots()).length, 0);
  } finally {
    process.chdir(oldCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

await testIndependentMatchEndSnapshots();
console.log("match end snapshot tests passed");
