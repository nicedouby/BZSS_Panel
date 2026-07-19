import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPlugin } from "../plugins/match-end-snapshot.js";
import { generateMatchEndSnapshotBundle } from "../plugins/match-end-snapshot-pages.js";

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
  const emitted = [];
  const plugin = createPlugin({
    core: {
      eventBus: {
        emitCoreEvent(name, payload) {
          emitted.push({ name, payload });
        },
      },
    },
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
                    dataLives: 1,
                    numKills: 9,
                    vehicleKills: 2,
                    numDeaths: 4,
                    numWoundeds: 12,
                    numWounds: 20,
                    numTeamKills: 1,
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
  return { plugin, emitted };
}

async function testIndependentMatchEndSnapshots() {
  const oldCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-match-end-snapshot-"));
  process.chdir(tempDir);

  try {
    const { plugin, emitted } = createHarness();
    const item = await plugin.api.takeManualSnapshot();
    assert.ok(item);
    assert.equal(item.map, "Tallil_Outskirts");
    assert.equal(item.nextMap, "Fallujah");
    assert.equal(item.playerCount, 1);
    assert.equal(item.queueCount, 5);
    assert.equal(item.imageAvailable, true);
    assert.equal(item.pageCount, 3);

    const list = await plugin.api.listSnapshots();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, item.id);
    assert.equal(list[0].imageAvailable, true);
    assert.equal(list[0].pageCount, 3);

    const snapshot = await plugin.api.readSnapshot(item.id);
    assert.equal(snapshot.snapshotType, "match-end-data");
    assert.equal(snapshot.schemaVersion, 2);
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
      dataLives: 1,
      kills: 9,
      vehicleKills: 2,
      deaths: 4,
      downs: 12,
      wounds: 20,
      teamKills: 1,
      revives: 7,
      healPoints: 800,
      combatScore: 1400,
      objectiveScore: 360,
      teamworkScore: 950,
      ping: 38,
    });

    const manifest = await plugin.api.readSnapshotManifest(item.id);
    assert.equal(manifest.pageCount, 3);
    assert.equal(manifest.pages[0].type, "cover");
    assert.equal(manifest.pages[1].teamId, 1);
    assert.equal(manifest.pages[2].teamId, 2);

    const cover = await plugin.api.readSnapshotImage(item.id);
    assert.equal(cover.contentType, "image/png");
    assert.equal(cover.fileName, item.id + ".png");
    assert.equal(cover.content.readUInt32BE(16), 1600);
    assert.equal(cover.content.readUInt32BE(20), 900);

    const teamPage = await plugin.api.readSnapshotPage(item.id, "team1");
    assert.equal(teamPage.teamId, 1);
    assert.equal(teamPage.content.readUInt32BE(16), 1600);
    assert.equal(teamPage.content.readUInt32BE(20), 900);

    const combined = await plugin.api.readSnapshotImage(item.id, { combined: true });
    assert.equal(combined.fileName, item.id + "-combined.png");
    assert.equal(combined.content.readUInt32BE(16), 1600);
    assert.equal(combined.content.readUInt32BE(20), 2700);

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].name, "match.snapshot.ready");
    assert.equal(emitted[0].payload.snapshotId, item.id);
    assert.equal(emitted[0].payload.pageCount, 3);

    const endSnapshotDir = path.join(tempDir, "data", "match-end-snapshots");
    const files = await fs.readdir(endSnapshotDir);
    assert.equal(files.some((name) => name.endsWith("-00-cover.png")), true);
    assert.equal(files.some((name) => name.includes("-team1")), true);
    assert.equal(files.some((name) => name.includes("-team2")), true);
    assert.equal(files.some((name) => name.endsWith("-manifest.json")), true);
    assert.equal(files.some((name) => name.endsWith("-combined.png")), true);

    const deleted = await plugin.api.deleteSnapshot(item.id);
    assert.equal(deleted.removed, true);
    assert.equal((await plugin.api.listSnapshots()).length, 0);
    assert.equal((await fs.readdir(endSnapshotDir)).length, 0);
  } finally {
    process.chdir(oldCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function makeTeam(teamID, count) {
  return Array.from({ length: count }, (_, index) => ({
    playerID: teamID * 1000 + index,
    name: `T${teamID}-P${String(index).padStart(2, "0")}`,
    teamID,
    squadID: Math.floor(index / 5) + 1,
    fireTeam: ["C", "B", "A"][index % 3],
    isCommander: index === 0,
    isLeader: index % 5 === 0,
    role: index % 5 === 0 ? "SquadLeader" : "Rifleman",
    health: 100,
    bzssCore: {
      kills: index,
      downs: index + 1,
      deaths: 1,
      teamKills: 0,
      vehicleKills: index % 3,
      revives: 1,
      healPoints: 100,
      combatScore: index * 10,
      objectiveScore: index,
      teamworkScore: index,
      ping: 40,
    },
  }));
}

function makePayload(team1Count, team2Count) {
  const players = [...makeTeam(1, team1Count), ...makeTeam(2, team2Count)];
  const squads = [1, 2].flatMap((teamID) => Array.from({ length: 11 }, (_, index) => ({
    teamID,
    squadID: index + 1,
    squadName: index === 0 ? "Command Squad" : `Squad ${index + 1}`,
    teamName: teamID === 1 ? "USA" : "RGF",
  })));
  return {
    capturedAt: "2026-07-18T00:00:00.000Z",
    trigger: { winner: "Team 1" },
    server: { playerCount: players.length, queueCount: 0, serverName: "Paged Snapshot Test" },
    match: {
      map: "Tallil",
      layer: "Tallil_RAAS_v1",
      mode: "RAAS",
      nextMap: "Fallujah",
      playtime: 3600,
    },
    summary: {
      recordedPlayerCount: players.length,
      squadCount: squads.length,
      bzssCorePlayerCount: players.length,
    },
    players,
    squads,
  };
}

async function testFiftyPlayersPerTeamCreateThreePages() {
  const bundle = await generateMatchEndSnapshotBundle(makePayload(50, 50), {
    snapshotId: "fifty-v-fifty",
  });
  assert.equal(bundle.pages.length, 3);
  assert.equal(bundle.pages[0].type, "cover");
  assert.equal(bundle.pages[1].teamId, 1);
  assert.equal(bundle.pages[1].playerCount, 50);
  assert.equal(bundle.pages[2].teamId, 2);
  assert.equal(bundle.pages[2].playerCount, 50);
  for (const page of bundle.pages) {
    assert.equal(page.buffer.readUInt32BE(16), 1600);
    assert.equal(page.buffer.readUInt32BE(20), 900);
  }
  assert.equal(bundle.combinedBuffer.readUInt32BE(16), 1600);
  assert.equal(bundle.combinedBuffer.readUInt32BE(20), 2700);
}

async function testOverflowAddsAnotherTeamPage() {
  const bundle = await generateMatchEndSnapshotBundle(makePayload(51, 50), {
    snapshotId: "overflow",
  });
  assert.equal(bundle.pages.length, 4);
  assert.equal(bundle.pages[1].teamId, 1);
  assert.equal(bundle.pages[1].playerCount, 50);
  assert.equal(bundle.pages[2].teamId, 1);
  assert.equal(bundle.pages[2].playerCount, 1);
  assert.equal(bundle.pages[3].teamId, 2);
  assert.equal(bundle.pages[3].playerCount, 50);
  assert.equal(bundle.combinedBuffer.readUInt32BE(20), 3600);
}

await testIndependentMatchEndSnapshots();
await testFiftyPlayersPerTeamCreateThreePages();
await testOverflowAddsAnotherTeamPage();
console.log("match end snapshot tests passed");
