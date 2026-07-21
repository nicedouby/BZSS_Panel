import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTacticalReplayModule } from "../modules/tactical-replay/index.js";

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
      map: "Jensens Range",
      layer: "Jensens Range AAS v1",
      mode: "AAS",
      playerCount: 1,
      tickets: { team1: 300, team2: 290 },
    },
    match: {
      roundId: "round-001",
      phase: "Playing",
      map: "Jensens Range",
      layer: "Jensens Range AAS v1",
      mode: "AAS",
      startedAt: "2026-07-21T12:00:00.000Z",
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
        combat: {
          kills: 3,
          deaths: 1,
          wounds: 2,
          woundeds: 4,
          teamKills: 0,
          revives: 1,
          healPoints: 50,
          objectiveScore: 20,
          teamworkScore: 70,
          combatScore: 120,
        },
        vehicle: { vehicleType: "", health: null, maxHealth: null },
        network: { gamePing: 42, icmpPing: 50 },
        freshness: { bzssCoreUpdatedAt: new Date().toISOString() },
      },
    ],
    assets: {
      captureZones: [
        {
          id: "zone-a",
          name: "Alpha Point",
          teamId: 1,
          captureProgress: 65,
          position: { x: 1200, y: 2200, z: 0 },
        },
      ],
      fobs: [
        {
          fobId: "fob-1",
          name: "FOB Alpha",
          teamId: 1,
          ammo: 1200,
          construction: 800,
          position: { x: 1400, y: 2400, z: 0 },
        },
      ],
      mainZones: [
        {
          id: "main-1",
          teamId: 1,
          position: { x: 500, y: 600, z: 0 },
        },
      ],
      vehicles: [{ id: "vehicle-ignored" }],
      explosions: [{ id: "explosion-ignored" }],
    },
    diagnostics: {},
    ...overrides,
  };
}

function createTacticalStateStub(initialSnapshot) {
  let latest = initialSnapshot;
  const listeners = new Set();
  return {
    api: {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async getSnapshot() {
        return latest;
      },
    },
    publish(snapshot) {
      latest = snapshot;
      for (const listener of listeners) listener(snapshot);
    },
  };
}

function createConfig(dataDirectory) {
  const values = new Map([
    ["modules.tacticalReplay.dataDirectory", dataDirectory],
    ["modules.tacticalReplay.playerIntervalMs", 50],
    ["modules.tacticalReplay.assetIntervalMs", 250],
    ["modules.tacticalReplay.flushIntervalMs", 100],
    ["modules.tacticalReplay.metaIntervalMs", 500],
    ["modules.tacticalReplay.maxBufferedBytes", 16 * 1024],
    ["modules.tacticalReplay.retentionDays", 1],
  ]);
  return {
    get(key, fallback) {
      return values.has(key) ? values.get(key) : fallback;
    },
  };
}

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
}

async function wait(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-tactical-replay-"));
  const tacticalState = createTacticalStateStub(makeSnapshot());
  const replayModule = createTacticalReplayModule({
    core: {
      createLogger: createLogger,
      logger: createLogger(),
    },
    modules: {
      tacticalState: tacticalState.api,
    },
    config: createConfig(root),
    logger: createLogger(),
  });

  try {
    await replayModule.start();
    await wait(650);

    const status = replayModule.api.getStatus();
    assert.equal(status.enabled, true);
    assert.equal(status.playerIntervalMs, 50);
    assert.equal(status.assetIntervalMs, 250);
    assert.ok(status.activeSession);

    const sessions = await replayModule.api.listSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].status, "active");
    assert.equal(sessions[0].layer, "Jensens Range AAS v1");
    assert.ok(sessions[0].frameCounts.players >= 3);
    assert.ok(sessions[0].frameCounts.assets >= 2);

    const replay = await replayModule.api.readFrames(sessions[0].id, {
      fromMs: 0,
      toMs: 1_000,
      limit: 1_000,
      includeContext: true,
    });
    const playerFrames = replay.frames.filter((frame) => frame.type === "players");
    const assetFrames = replay.frames.filter((frame) => frame.type === "assets");
    assert.ok(playerFrames.length >= 3);
    assert.ok(assetFrames.length >= 2);

    const player = playerFrames[0].players[0];
    assert.equal(player.playerName, "Alpha");
    assert.equal(player.position.x, 1000);
    assert.equal(player.position.y, 2000);
    assert.equal(player.yaw, 90);
    assert.equal(player.playerScoreboard.stats.numKills, 3);

    const assets = assetFrames[0].assets;
    assert.equal(assets.captureZones.length, 1);
    assert.equal(assets.fobs.length, 1);
    assert.equal(assets.mainZones.length, 1);
    assert.equal(Object.hasOwn(assets, "vehicles"), false);
    assert.equal(Object.hasOwn(assets, "explosions"), false);

    tacticalState.publish(makeSnapshot({
      meta: { serverId: "server-test", revision: 8, generatedAt: new Date().toISOString() },
      players: [
        {
          ...makeSnapshot().players[0],
          telemetry: {
            ...makeSnapshot().players[0].telemetry,
            position: { x: 1500, y: 2600, z: 50 },
            yaw: 135,
          },
        },
      ],
    }));
    await wait(120);

    const moved = await replayModule.api.readFrames(sessions[0].id, {
      fromMs: 0,
      toMs: 2_000,
      limit: 2_000,
    });
    const latestPlayerFrame = moved.frames.filter((frame) => frame.type === "players").at(-1);
    assert.equal(latestPlayerFrame.players[0].position.x, 1500);
    assert.equal(latestPlayerFrame.players[0].yaw, 135);

    await replayModule.stop();
    const closed = await replayModule.api.getSession(sessions[0].id);
    assert.equal(closed.status, "closed");
    assert.equal(closed.endReason, "module-stop");
    assert.ok(closed.durationMs > 0);

    const frameFile = path.join(root, sessions[0].id, "frames.jsonl");
    const frameText = await fs.readFile(frameFile, "utf8");
    assert.ok(frameText.includes('"type":"players"'));
    assert.ok(frameText.includes('"type":"assets"'));

    console.log("Tactical replay tests passed.");
  } finally {
    try {
      await replayModule.stop();
    } catch {}
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
