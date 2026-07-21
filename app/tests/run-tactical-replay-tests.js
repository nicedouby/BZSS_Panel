import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTacticalReplayStore } from "../modules/tactical-replay/store.js";

function makeSnapshot(overrides = {}) {
  return {
    meta: {
      serverId: "server-test",
      revision: 7,
      generatedAt: new Date().toISOString(),
    },
    server: {
      serverId: "server-test",
      name: "Replay Test Server",
      map: "Gorodok",
      layer: "Gorodok_Invasion_v4",
      mode: "Invasion",
      playerCount: 1,
      tickets: { team1: 300, team2: 290 },
    },
    match: {
      phase: "Playing",
      map: "Gorodok",
      layer: "Gorodok_Invasion_v4",
      mode: "Invasion",
    },
    teams: [
      { teamId: 1, teamName: "United States Army", playerCount: 1 },
      { teamId: 2, teamName: "Russian Ground Forces", playerCount: 0 },
    ],
    players: [
      {
        identity: {
          key: "player:11",
          playerID: 11,
          name: "Alpha",
          steamID: "76561198000000001",
          eosID: null,
        },
        presence: { online: true, state: "online" },
        match: {
          teamId: 1,
          teamName: "United States Army",
          squadId: 2,
          squadName: "Squad 2",
          isLeader: true,
          role: "SquadLeader",
        },
        telemetry: {
          position: { x: 1000, y: 2000, z: 50 },
          rotation: { x: 0, y: 0, z: 90 },
          yaw: 90,
          health: 87,
          soldierClass: "Rifleman",
          weaponClass: "M4",
          fireTeamIndex: 0,
          fireTeamPosition: 1,
          hasTelemetry: true,
          hasPosition: true,
        },
        combat: { kills: 3, deaths: 1 },
        vehicle: { vehicleType: "", health: null, maxHealth: null },
        network: { gamePing: 42, icmpPing: 50 },
        profile: { playtimeHours: 12.5 },
        link: { confidence: "exact", method: "steam" },
        freshness: { bzssCoreUpdatedAt: new Date().toISOString() },
        raw: { rcon: { name: "Alpha", playerID: 11, teamID: 1, squadID: 2 } },
      },
    ],
    assets: {
      captureZones: [{ id: "zone-a", name: "Alpha Point", teamId: 1, position: { x: 1200, y: 2200, z: 0 } }],
      fobs: [{ fobId: "fob-1", name: "FOB Alpha", teamId: 1, ammo: 1200, construction: 800, position: { x: 1400, y: 2400, z: 0 } }],
      mainZones: [{ id: "main-1", teamId: 1, position: { x: 500, y: 600, z: 0 } }],
      vehicles: [{ id: "vehicle-not-recorded" }],
      explosions: [{ id: "explosion-not-recorded" }],
    },
    diagnostics: { sourceErrors: [] },
    ...overrides,
  };
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-tactical-replay-v2-"));
  const store = createTacticalReplayStore({
    dataDirectory: root,
    playerIntervalMs: 333,
    assetIntervalMs: 5_000,
    chunkDurationMs: 2_000,
    flushIntervalMs: 100,
    retentionDays: 1,
    logger: { info() {}, warn() {}, error() {} },
  });
  const round = {
    serverId: "server-test",
    map: "Gorodok",
    layer: "Gorodok_Invasion_v4",
    mode: "Invasion",
    token: "stable-world-bring-up-token",
    key: "server-test|stable-world-bring-up-token",
    startedAt: "2026-07-21T12:00:00.000Z",
    closed: false,
  };

  try {
    await store.start();
    const initial = makeSnapshot();
    await store.ingestAssetSample({ round, snapshot: initial });
    await store.ingestPlayerSample({ round, snapshot: initial });
    await store.ingestPlayerSample({
      round,
      snapshot: makeSnapshot({
        meta: { ...initial.meta, revision: 8 },
        match: { ...initial.match, transientId: `refresh-${Date.now()}` },
        players: [{
          ...initial.players[0],
          telemetry: {
            ...initial.players[0].telemetry,
            position: { x: 1500, y: 2600, z: 50 },
            yaw: 135,
          },
        }],
      }),
    });

    const activeList = await store.listSessions();
    assert.equal(activeList.sessions.length, 1, "stable round token must produce one session");
    assert.equal(activeList.sessions[0].schemaVersion, 2);
    assert.equal(activeList.sessions[0].status, "active");
    assert.equal(activeList.sessions[0].storage.format, "jsonl-chunks");
    assert.equal(activeList.sessions[0].storage.timelineFile, "timeline.json");

    const sessionId = activeList.sessions[0].id;
    const window = await store.readWindow(sessionId, {
      fromMs: 0,
      durationMs: 2_000,
      includeContext: true,
    });
    const playerFrames = window.frames.filter((frame) => frame.type === "players");
    const assetFrames = window.frames.filter((frame) => frame.type === "assets");
    assert.equal(playerFrames.length, 2);
    assert.equal(assetFrames.length, 1);
    assert.equal(playerFrames[0].players[0].identity.name, "Alpha");
    assert.equal(playerFrames[0].players[0].telemetry.position.x, 1000);
    assert.equal(playerFrames[1].players[0].telemetry.position.x, 1500);
    assert.equal(playerFrames[1].players[0].telemetry.yaw, 135);
    assert.equal(playerFrames[0].players[0].raw.rcon.playerID, 11, "canonical tactical player data must be retained");
    assert.equal(assetFrames[0].assets.captureZones.length, 1);
    assert.equal(assetFrames[0].assets.fobs.length, 1);
    assert.equal(assetFrames[0].assets.mainZones.length, 1);
    assert.equal(Object.hasOwn(assetFrames[0].assets, "vehicles"), false);
    assert.equal(Object.hasOwn(assetFrames[0].assets, "explosions"), false);
    assert.ok(window.storage.scannedChunks <= 2);

    const timeline = JSON.parse(await fs.readFile(path.join(root, sessionId, "timeline.json"), "utf8"));
    assert.equal(timeline.schemaVersion, 2);
    assert.equal(timeline.sessionId, sessionId);
    assert.equal(timeline.chunks.length, 1);
    const chunkFile = path.join(root, sessionId, "chunks", timeline.chunks[0].file);
    const chunkText = await fs.readFile(chunkFile, "utf8");
    assert.ok(chunkText.includes('"type":"players"'));
    assert.ok(chunkText.includes('"type":"assets"'));

    const legacyDirectory = path.join(root, "legacy_30_second_fragment");
    await fs.mkdir(legacyDirectory, { recursive: true });
    await fs.writeFile(path.join(legacyDirectory, "meta.json"), JSON.stringify({
      schemaVersion: 1,
      id: "legacy_30_second_fragment",
      status: "closed",
      startedAt: "2026-07-21T10:00:00.000Z",
      durationMs: 30_000,
    }), "utf8");
    const filtered = await store.listSessions();
    assert.equal(filtered.sessions.length, 1);
    assert.equal(filtered.hiddenLegacySessions, 1);

    await store.ingestPlayerSample({
      round: { ...round, closed: true },
      snapshot: makeSnapshot({ match: { ...initial.match, phase: "WaitingPostMatch" } }),
    });
    const closed = await store.getSession(sessionId);
    assert.equal(closed.status, "closed");
    assert.equal(closed.endReason, "round-ended");

    console.log("Tactical replay v2 tests passed.");
  } finally {
    try { await store.stop(); } catch {}
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
