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
                isLeader: false,
                steamID: "76561198000000003",
                eosID: "eos-charlie",
              },
            ];
            const squads = [
              { teamID: 1, squadID: 2, squadName: "INF", teamName: "Team 1", size: 1 },
              { teamID: 2, squadID: 1, squadName: "Armor", teamName: "Team 2", size: 1 },
            ];
            return {
              status: {
                serverName: "BZSS Test",
                map: "Tallil",
                layer: "Tallil_RAAS_v1",
                gameMode: "raas",
                maxPlayers: 100,
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
    assert.equal(json.teams[0].unassignedPlayers[0].name, "Bravo");
    assert.equal(json.renderOptions.includeSteamID, false);
    assert.equal(json.renderOptions.includeEOSID, false);
    assert.equal(json.teams[0].squads[0].members[0].combatStats.kills, 1);
    assert.equal(json.teams[0].squads[0].members[0].combatStats.wounds, 1);
    assert.equal(json.teams[0].squads[0].members[0].combatStats.deaths, 1);
    assert.equal(json.teams[0].squads[0].members[0].gameSeconds, 7200);

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
