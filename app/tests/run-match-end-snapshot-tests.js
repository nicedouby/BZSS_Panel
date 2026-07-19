import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPlugin } from "../plugins/match-end-snapshot.js";
import { generateMatchEndReportPng } from "../plugins/match-snapshot.js";

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
                  fireTeam: "B",
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
    assert.equal(item.imageAvailable, true);

    const list = await plugin.api.listSnapshots();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, item.id);
    assert.equal(list[0].imageAvailable, true);

    const snapshot = await plugin.api.readSnapshot(item.id);
    assert.equal(snapshot.snapshotType, "match-end-data");
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.server.playerCount, 1);
    assert.equal(snapshot.server.queueCount, 5);
    assert.equal(snapshot.match.map, "Tallil_Outskirts");
    assert.equal(snapshot.match.nextMap, "Fallujah");
    assert.equal(snapshot.players[0].squadInfo.name, "INF 2");
    assert.equal(snapshot.players[0].fireTeam, "B");
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

    const report = await plugin.api.readSnapshotImage(item.id);
    assert.equal(report.contentType, "image/png");
    assert.equal(report.fileName, item.id + ".png");
    assert.deepEqual([...report.content.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

    const deleted = await plugin.api.deleteSnapshot(item.id);
    assert.equal(deleted.removed, true);
    assert.equal((await plugin.api.listSnapshots()).length, 0);
  } finally {
    process.chdir(oldCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testFiftyPlayersPerTeamFitInOneImage() {
  const makeTeam = (teamID) => Array.from({ length: 50 }, (_, index) => ({
    playerID: teamID * 100 + index,
    name: `T${teamID}-P${String(index).padStart(2, "0")}`,
    teamID,
    squadID: Math.floor(index / 5) + 1,
    fireTeam: ["C", "B", "A"][index % 3],
    isCommander: index === 15,
    isLeader: index % 5 === 0,
    role: index % 5 === 0 ? "SquadLeader" : "Rifleman",
    health: 100,
    bzssCore: {
      kills: index,
      downs: index,
      deaths: 1,
      teamKills: 0,
      vehicleKills: 0,
      revives: 0,
      healPoints: 0,
      combatScore: index * 10,
      objectiveScore: index,
      teamworkScore: index,
      ping: 40,
    },
  }));
  const players = [...makeTeam(1), ...makeTeam(2)];
  const squads = [1, 2].flatMap((teamID) => Array.from({ length: 10 }, (_, index) => ({
    teamID,
    squadID: index + 1,
    squadName: index === 3 ? "Command Squad" : `Squad ${index + 1}`,
    teamName: teamID === 1 ? "USA" : "RGF",
  })));
  const image = await generateMatchEndReportPng({
    capturedAt: "2026-07-18T00:00:00.000Z",
    server: { playerCount: 100, queueCount: 0, serverName: "50v50 Test" },
    match: { map: "Tallil", layer: "Tallil_RAAS_v1", mode: "RAAS", nextMap: "Fallujah" },
    players,
    squads,
  });

  assert.equal(image.readUInt32BE(16), 1600);
  assert.equal(image.readUInt32BE(20), 2176);
}

await testIndependentMatchEndSnapshots();
await testFiftyPlayersPerTeamFitInOneImage();
console.log("match end snapshot tests passed");
