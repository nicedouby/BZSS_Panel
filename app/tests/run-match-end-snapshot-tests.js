import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { createPlugin } from "../plugins/match-end-snapshot.js";
import { FIRETEAM_COLORS, resolvePlayerFireTeam } from "../plugins/match-end-snapshot-fireteam.js";
import {
  buildMatchEndOverviewModel,
  generateMatchEndSnapshotBundle,
} from "../plugins/match-end-snapshot-pages.js";

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
  return { plugin, emitted };
}

async function testSingleOverviewSnapshot() {
  const oldCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-match-end-overview-"));
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
    assert.equal(item.pageCount, 1);

    const snapshot = await plugin.api.readSnapshot(item.id);
    assert.equal(snapshot.snapshotType, "match-end-data");
    assert.equal(snapshot.schemaVersion, 2);
    assert.equal(snapshot.players[0].squadInfo.name, "INF 2");
    assert.equal(snapshot.players[0].fireTeam, "B");
    assert.equal(snapshot.players[0].health, 64.5);
    assert.equal(snapshot.players[0].bzssCore.kills, 9);
    assert.equal(snapshot.players[0].bzssCore.ping, 38);

    const manifest = await plugin.api.readSnapshotManifest(item.id);
    assert.equal(manifest.pageCount, 1);
    assert.equal(manifest.pages[0].type, "match-status-scoreboard");

    const image = await plugin.api.readSnapshotImage(item.id);
    assert.equal(image.fileName, item.id + ".png");
    assert.equal(image.content.readUInt32BE(16), 1600);
    assert.equal(image.content.readUInt32BE(20), 900);

    const overviewPage = await plugin.api.readSnapshotPage(item.id, "match-status-scoreboard");
    assert.equal(overviewPage.type, "match-status-scoreboard");
    assert.equal(overviewPage.content.readUInt32BE(16), 1600);
    assert.equal(overviewPage.content.readUInt32BE(20), 900);

    const combined = await plugin.api.readSnapshotImage(item.id, { combined: true });
    assert.equal(combined.content.readUInt32BE(16), 1600);
    assert.equal(combined.content.readUInt32BE(20), 900);

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].name, "match.snapshot.ready");
    assert.equal(emitted[0].payload.pageCount, 1);

    const dir = path.join(tempDir, "data", "match-end-snapshots");
    const names = await fs.readdir(dir);
    assert.equal(names.some((name) => name.endsWith("-00-scoreboard.png")), true);
    assert.equal(names.some((name) => name.endsWith("-combined.png")), true);
    assert.equal(names.some((name) => name.endsWith("-manifest.json")), true);

    const deleted = await plugin.api.deleteSnapshot(item.id);
    assert.equal(deleted.removed, true);
    assert.equal((await fs.readdir(dir)).length, 0);
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
    fireTeam: ["A", "B", "C"][index % 3],
    isCommander: index === 0,
    isLeader: index % 5 === 0,
    role: index % 5 === 0 ? "SquadLeader" : "Rifleman",
    health: 100 - (index % 4) * 12,
    bzssCore: {
      ping: 35 + (index % 8) * 5,
      kills: index,
      deaths: 1,
      downs: index + 1,
    },
  }));
}

function makePayload(team1Count, team2Count) {
  const players = [...makeTeam(1, team1Count), ...makeTeam(2, team2Count)];
  const squads = [1, 2].flatMap((teamID) => Array.from({ length: 10 }, (_, index) => ({
    teamID,
    squadID: index + 1,
    squadName: index === 0 ? "Command Squad" : `Squad ${index + 1}`,
    teamName: teamID === 1 ? "USA" : "RGF",
    locked: index % 2 === 0,
  })));
  return {
    capturedAt: "2026-07-18T00:00:00.000Z",
    trigger: { winner: "Team 1" },
    server: { playerCount: players.length, queueCount: 0, serverName: "Overview Test" },
    match: {
      map: "Tallil",
      layer: "Tallil_RAAS_v1",
      mode: "RAAS",
      nextMap: "Fallujah",
      nextLayer: "Fallujah_RAAS_v2",
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

async function testHundredPlayersStayInOneImage() {
  const payload = makePayload(50, 50);
  const model = buildMatchEndOverviewModel(payload);
  assert.equal(model.teams.length, 2);
  assert.equal(model.teams[0].playerCount, 50);
  assert.equal(model.teams[1].playerCount, 50);
  assert.equal(model.teams[0].lanes.length, 2);
  assert.equal(model.teams[1].lanes.length, 2);
  assert.ok(model.teams[0].rowHeight >= 13);
  assert.ok(model.teams[1].rowHeight >= 13);

  const bundle = await generateMatchEndSnapshotBundle(payload, { snapshotId: "hundred-player-overview" });
  assert.equal(bundle.pages.length, 1);
  assert.equal(bundle.pages[0].type, "match-status-scoreboard");
  assert.equal(bundle.pages[0].playerCount, 100);
  assert.equal(bundle.pages[0].buffer.readUInt32BE(16), 1600);
  assert.equal(bundle.pages[0].buffer.readUInt32BE(20), 900);
  assert.equal(bundle.combinedBuffer.readUInt32BE(16), 1600);
  assert.equal(bundle.combinedBuffer.readUInt32BE(20), 900);
}

function readPngPixel(buffer, x, y) {
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  assert.ok(x >= 0 && x < width && y >= 0 && y < height);
  let offset = 8;
  const parts = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") parts.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
    if (type === "IEND") break;
  }
  const data = zlib.inflateSync(Buffer.concat(parts));
  const stride = width * 4;
  const rows = Buffer.alloc(stride * height);
  let cursor = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = data[cursor++];
    const source = data.subarray(cursor, cursor + stride);
    const target = rows.subarray(row * stride, (row + 1) * stride);
    for (let index = 0; index < stride; index += 1) {
      const left = index >= 4 ? target[index - 4] : 0;
      const up = row > 0 ? rows[(row - 1) * stride + index] : 0;
      const upperLeft = row > 0 && index >= 4 ? rows[(row - 1) * stride + index - 4] : 0;
      if (filter === 0) target[index] = source[index];
      else if (filter === 1) target[index] = (source[index] + left) & 255;
      else if (filter === 2) target[index] = (source[index] + up) & 255;
      else if (filter === 3) target[index] = (source[index] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const p = left + up - upperLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upperLeft);
        target[index] = (source[index] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft)) & 255;
      } else throw new Error("Unsupported PNG filter " + filter);
    }
    cursor += stride;
  }
  const index = (y * width + x) * 4;
  return [rows[index], rows[index + 1], rows[index + 2], rows[index + 3]];
}

async function testFireteamAccentPixels() {
  const bundle = await generateMatchEndSnapshotBundle(makePayload(3, 0), { snapshotId: "fireteam-pixels" });
  // Team 1 first lane: rows A/B/C have an unmasked 7px fireteam bar on the far left.
  const samples = [[37, 262], [37, 278], [37, 294]];
  const expected = [[53, 208, 127], [167, 139, 250], [34, 211, 238]];
  samples.forEach(([x, y], index) => {
    const [red, green, blue] = readPngPixel(bundle.combinedBuffer, x, y);
    const [wantRed, wantGreen, wantBlue] = expected[index];
    assert.ok(Math.abs(red - wantRed) <= 8 && Math.abs(green - wantGreen) <= 8 && Math.abs(blue - wantBlue) <= 8,
      "fireteam accent pixel " + index + " was " + [red, green, blue].join(","));
  });
}

function testSourceAwareFireteamResolution() {
  assert.equal(resolvePlayerFireTeam({ fireTeam: "A" }).fireTeam, "A");
  assert.equal(resolvePlayerFireTeam({ fireTeam: "BRAVO" }).fireTeam, "B");
  assert.equal(resolvePlayerFireTeam({ fireTeamID: 1 }).fireTeam, "A");
  assert.equal(resolvePlayerFireTeam({ fireTeamID: 2 }).fireTeam, "B");
  assert.equal(resolvePlayerFireTeam({ fireTeamID: 3 }).fireTeam, "C");
  assert.equal(resolvePlayerFireTeam({ ftIndex: 0 }).fireTeam, "A");
  assert.equal(resolvePlayerFireTeam({ ftIndex: 1 }).fireTeam, "B");
  assert.equal(resolvePlayerFireTeam({ ftIndex: 2 }).fireTeam, "C");
  const explicit = resolvePlayerFireTeam({ fireTeam: "C", fireTeamID: 1, ftIndex: 1 });
  assert.equal(explicit.fireTeam, "C");
  assert.equal(explicit.fireTeamSource, "player.fireTeam");
  assert.equal(FIRETEAM_COLORS.A, "#35D07F");
  assert.equal(FIRETEAM_COLORS.B, "#A78BFA");
  assert.equal(FIRETEAM_COLORS.C, "#22D3EE");
}

testSourceAwareFireteamResolution();
await testFireteamAccentPixels();
await testSingleOverviewSnapshot();
await testHundredPlayersStayInOneImage();
console.log("match end snapshot overview tests passed");
