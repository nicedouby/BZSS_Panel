import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPlugin } from "../plugins/match-snapshot.js";

function createHarness() {
  const logs = [];
  const plugin = createPlugin({
    core: {},
    modules: {
      matchState: {
        api: {
          getOverview() {
            const players = [
              {
                playerID: 1,
                name: "Alpha",
                teamID: 1,
                squadID: 2,
                role: "Rifleman",
                isLeader: true,
                steamID: "76561198000000001",
                eosID: "eos-alpha",
              },
              {
                playerID: 2,
                name: "Bravo",
                teamID: 1,
                squadID: null,
                role: "Medic",
                isLeader: false,
                steamID: "76561198000000002",
                eosID: "eos-bravo",
              },
              {
                playerID: 3,
                name: "Charlie",
                teamID: 2,
                squadID: 1,
                role: "Crewman",
                isLeader: true,
                steamID: "76561198000000003",
                eosID: "eos-charlie",
              },
            ];
            const squads = [
              { teamID: 1, squadID: 2, squadName: "Command Squad", teamName: "49th Combined Arms Army", size: 1 },
              { teamID: 2, squadID: 1, squadName: "Command Squad", teamName: "1st Marines Regiment", size: 1 },
            ];
            return {
              status: {
                serverName: "BZSS Test",
                map: "Tallil",
                layer: "Tallil_RAAS_v1",
                gameMode: "raas",
                maxPlayers: 100,
                playerCount: 3,
                queueCount: 4,
                nextLayer: "Fallujah_RAAS_v2",
                tps: 29.8,
              },
              matchState: {
                serverId: "test-server",
                players: { list: players },
                squads: { list: squads },
              },
              players,
              squads,
            };
          },
        },
      },
      playtime: {
        api: {
          async enrichPlayers(players) {
            return players.map((player) => ({
              ...player,
              gameSeconds: player.name === "Alpha" ? 7200 : player.name === "Bravo" ? 1800 : 5400,
              steamAvatar: player.name === "Charlie" ? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=" : "",
            }));
          },
        },
      },
      combatClean: {
        api: {
          getEvents() {
            return [
              { type: "kill", attacker: { steamID: "76561198000000001" }, victim: { steamID: "76561198000000003" } },
              { type: "wound", attacker: { steamID: "76561198000000001" }, victim: { steamID: "76561198000000003" } },
              { type: "tk", attacker: { steamID: "76561198000000002" }, victim: { steamID: "76561198000000001" } },
            ];
          },
        },
      },
      bzssCoreMonitor: {
        api: {
          getPlayers() {
            return [
              {
                playerId: 1,
                playerIndex: 1,
                playerName: "Alpha",
                steamID: "76561198000000001",
                eosID: "eos-alpha",
                observedAt: "2026-06-22T00:00:00.000Z",
                stale: false,
                ping: 42,
                soldierInfo: {
                  soldierClass: "Rifleman",
                  health: 76.5,
                },
                playerScoreboard: {
                  stats: {
                    numKills: 8,
                    vehicleKills: 2,
                    numDeaths: 3,
                    numWoundeds: 11,
                    numTeamKills: 1,
                    healPoints: 450,
                    revivedPoints: 6,
                    teamworkScore: 900,
                    objectiveScore: 320,
                    combatScore: 1250,
                  },
                },
              },
            ];
          },
          getRawSnapshot() {
            return {
              updatedAt: "2026-06-22T00:00:00.000Z",
              captureZones: [
                {
                  name: "CP1",
                  position: { x: 1234, y: 5678, z: 90 },
                  raw: "CP1,Position:X=1234 Y=5678 Z=90",
                },
              ],
              fobs: [
                {
                  teamId: 1,
                  health: 1.0,
                  isBleeding: false,
                  ammo: 1000,
                  construction: 2000,
                  name: "Team1PreplacedFOBRadio",
                  position: { x: 15160, y: -2150, z: -12980 },
                  raw: "TeamID:1,Health:1.0,IsBleeding:false,Ammo:1000.0,Construction:2000.0,Position:X=15160 Y=-2150 Z=-12980",
                },
              ],
            };
          },
        },
      },
    },
    logger: {
      info(message) {
        logs.push(["info", message]);
      },
      warn(message) {
        logs.push(["warn", message]);
      },
      error(message) {
        logs.push(["error", message]);
      },
    },
  });

  return { plugin, logs };
}

async function testCaptureWritesImageAndFiles() {
  const oldCwd = process.cwd();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-match-snapshot-"));
  process.chdir(tempDir);

  try {
    const { plugin } = createHarness();
    const item = await plugin.api.takeManualSnapshot({ includeSteamID: false, includeEOSID: false });

    assert.ok(item);
    assert.equal(item.artifacts.length, 4);
    assert.ok(item.files.json.endsWith(".json"));
    assert.ok(item.files.image.endsWith(".png"));
    assert.ok(item.files.csv.endsWith(".csv"));
    assert.ok(item.files.markdown.endsWith(".md"));

    const image = await plugin.api.readSnapshotArtifact(item.id, "image");
    assert.equal(image.contentType, "image/png");
    assert.equal(image.content[0], 0x89);
    assert.equal(image.content.subarray(1, 4).toString("ascii"), "PNG");

    const csv = await plugin.api.readSnapshotArtifact(item.id, "csv");
    const csvText = csv.content.toString("utf8");
    assert.equal(csv.contentType, "text/csv; charset=utf-8");
    assert.match(csvText, /capturedAt,teamID/);
    assert.doesNotMatch(csvText, /steamID/);
    assert.doesNotMatch(csvText, /eosID/);
    assert.match(csvText, /kwd,tk,duration/);
    assert.match(csvText, /SL Alpha,Rifle,1\/1\/1,0,2h 0m/);
    assert.match(csvText, /Bravo,Medic,0\/0\/0,1,30m/);
    assert.match(csvText, /Bravo/);

    const json = JSON.parse((await plugin.api.readSnapshotArtifact(item.id, "json")).content.toString("utf8"));
    assert.equal(json.summary.playerCount, 3);
    assert.equal(json.summary.squadCount, 2);
    assert.equal(json.schemaVersion, 6);
    assert.equal(json.server.playerCount, 3);
    assert.equal(json.server.queueCount, 4);
    assert.equal(json.match.playerCount, 3);
    assert.equal(json.match.nextMap, "Fallujah");
    assert.equal(json.match.nextLayer, "Fallujah_RAAS_v2");
    assert.equal(json.match.maxPlayers, 100);
    assert.equal(json.match.rconTime, null);
    assert.equal(json.teams[0].unassignedPlayers[0].name, "Bravo");
    assert.equal(json.renderOptions.includeSteamID, false);
    assert.equal(json.renderOptions.includeEOSID, false);
    assert.equal(json.teams[0].factionCode, "RGF");
    assert.equal(json.teams[0].flagAssetPath, "/assets/faction-assets/RGF.PNG");
    assert.equal(json.teams[1].factionCode, "USMC");
    assert.equal(json.teams[1].flagAssetPath, "/assets/faction-assets/USMC.PNG");
    assert.equal(json.teams[1].commanderName, "Charlie");
    assert.equal(json.teams[1].commanderPlayer.gameSeconds, 5400);
    assert.equal(json.teams[1].commanderPlayer.steamAvatar, "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=");
    assert.equal(json.teams[0].squads[0].members[0].combatStats.kills, 1);
    assert.equal(json.teams[0].squads[0].members[0].combatStats.wounds, 1);
    assert.equal(json.teams[0].squads[0].members[0].combatStats.deaths, 1);
    assert.equal(json.teams[0].squads[0].members[0].gameSeconds, 7200);
    assert.deepEqual(json.teams[0].squads[0].members[0].squadInfo, {
      teamID: 1,
      squadID: 2,
      name: "Command Squad",
      size: 1,
      locked: false,
    });
    assert.equal(json.teams[0].squads[0].members[0].health, 76.5);
    assert.deepEqual(json.teams[0].squads[0].members[0].bzssCore, {
      available: true,
      observedAt: "2026-06-22T00:00:00.000Z",
      stale: false,
      health: 76.5,
      soldierClass: "Rifleman",
      kills: 8,
      downs: 11,
      deaths: 3,
      teamKills: 1,
      vehicleKills: 2,
      revives: 6,
      healPoints: 450,
      combatScore: 1250,
      objectiveScore: 320,
      teamworkScore: 900,
      ping: 42,
    });
    assert.equal(json.teams[0].unassignedPlayers[0].bzssCore, null);
    assert.equal(json.captureZones.length, 1);
    assert.equal(json.captureZones[0].name, "CP1");
    assert.equal(json.fobs.length, 1);
    assert.equal(json.fobs[0].name, "Team1PreplacedFOBRadio");
    assert.equal(json.source.bzssCoreUpdatedAt, "2026-06-22T00:00:00.000Z");

    const imageBuffer = (await plugin.api.readSnapshotArtifact(item.id, "image")).content;
    assert.equal(imageBuffer[0], 0x89);
    assert.equal(imageBuffer.subarray(1, 4).toString("ascii"), "PNG");

    const markdown = await plugin.api.readSnapshotArtifact(item.id, "markdown");
    const markdownText = markdown.content.toString("utf8");
    assert.match(markdownText, /对局状态玩家列表快照/);
    assert.match(markdownText, /SL Alpha/);
    assert.match(markdownText, /\| KWD \| TK \| 时长 \|/);
    assert.doesNotMatch(markdownText, /### Squad /);
    assert.doesNotMatch(markdownText, /\| SteamID \|/);
    assert.doesNotMatch(markdownText, /\| EOSID \|/);

    const list = await plugin.api.listSnapshots();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, item.id);
    assert.equal(list[0].artifacts.length, 4);

    const deleted = await plugin.api.deleteSnapshot(item.id);
    assert.equal(deleted.id, item.id);
    assert.equal(deleted.removed, true);

    const missing = await plugin.api.listSnapshots();
    assert.equal(missing.length, 0);
  } finally {
    process.chdir(oldCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

await testCaptureWritesImageAndFiles();

console.log("match snapshot tests passed");
