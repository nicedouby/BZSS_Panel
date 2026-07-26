import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createTacticalFeedWriterModule } from "../modules/tactical-feed-writer-native/index.js";
import { createTacticalReplayPlayerModule } from "../modules/tactical-replay-player-native/index.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makePlayer(id, name, x = 100) {
  return {
    identity: {
      key: `steam:${id}`,
      name,
      steamID: id,
      eosID: `eos-${id}`,
      playerID: Number(id.slice(-2)),
    },
    presence: { state: "online", online: true },
    match: { teamId: 1, squadId: 2, isLeader: false, role: "Rifleman" },
    telemetry: { position: { x, y: 200, z: 3 }, yaw: 90, health: 100 },
    combat: { kills: 0, wounds: 0, deaths: 0 },
    network: { gamePing: 42 },
    vehicle: {},
  };
}

function makeSnapshot({ players, phase = "playing", playerCount = 100, layer = "Test Layer AAS v1" }) {
  return {
    meta: { generatedAt: new Date().toISOString(), revision: 1 },
    server: {
      serverId: "test-server",
      map: "Test Map",
      layer,
      mode: "AAS",
      playerCount,
    },
    match: { phase, state: phase },
    teams: [{ teamId: 1, playerCount: players.length }],
    players,
    assets: {
      captureZones: [{ id: "zone-a", name: "A", position: { x: 10, y: 20, z: 0 } }],
      mainZones: [],
      fobs: [],
      vehicles: [],
    },
  };
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tactical-native-"));
  let snapshotListener = null;
  let currentSnapshot = makeSnapshot({
    players: [
      makePlayer("76561198000000001", "Alpha", 100),
      makePlayer("76561198000000002", "Bravo", 200),
    ],
  });
  const round = {
    current: {
      dedupeKey: "test-server:round-1",
      layerName: "Test Layer AAS v1",
      mapName: "Test Map",
    },
  };
  const rconPlayers = [
    { steamID: "76561198000000001", name: "Alpha" },
    { steamID: "76561198000000002", name: "Bravo" },
    { steamID: "76561198000000003", name: "Charlie" },
  ];

  const modules = {
    tacticalState: {
      async getSnapshot() { return currentSnapshot; },
      subscribe(listener) {
        snapshotListener = listener;
        return () => { snapshotListener = null; };
      },
    },
    matchState: {
      getState() { return { round, serverStatus: currentSnapshot.server, match: currentSnapshot.match }; },
    },
    playerState: {
      getOnlinePlayers() { return rconPlayers; },
    },
    matchPlayerPresence: {
      getPlayers() { return []; },
    },
  };
  const core = {
    eventBus: { emitModuleEvent() {} },
    webStatus: {
      serverId: "test-server",
      getSnapshot() { return { serverId: "test-server" }; },
    },
  };
  const config = {
    get(key) {
      if (key === "modules.tacticalFeedWriter") {
        return {
          rootDir: root,
          playerSampleMs: 5,
          segmentDurationMs: 50,
          endGraceMs: 10,
          metadataFlushMs: 5,
        };
      }
      return {};
    },
  };

  const writer = createTacticalFeedWriterModule({ core, modules, config, logger: console });
  await writer.start();
  await sleep(30);

  currentSnapshot = makeSnapshot({
    players: [
      makePlayer("76561198000000001", "Alpha", 800),
      makePlayer("76561198000000002", "Bravo", 900),
      makePlayer("76561198000000003", "Charlie", 1000),
    ],
  });
  snapshotListener?.(currentSnapshot);
  await sleep(30);

  currentSnapshot = makeSnapshot({ players: [], phase: "postmatch", playerCount: 0 });
  snapshotListener?.(currentSnapshot);
  await sleep(40);

  assert.equal(writer.api.getDiagnostics().recording, false, "postmatch must close the session after the grace period");
  const entries = await readdir(root);
  assert.equal(entries.length, 1);
  assert.ok(!entries[0].endsWith(".open"), "closed native sessions must be finalized");

  const sessionDirectory = path.join(root, entries[0]);
  const metadata = JSON.parse(await readFile(path.join(sessionDirectory, "session.json"), "utf8"));
  assert.equal(metadata.format, "native-jsonl-v1");
  assert.equal(metadata.compression, "none");
  assert.equal(metadata.dictionary, false);
  assert.equal(metadata.playerCount, 3, "the archive count must use the whole-round unique roster");
  assert.equal(metadata.peakPlayerCount, 100, "the peak count must preserve the authoritative server player count");

  const segmentNames = (await readdir(path.join(sessionDirectory, "segments"))).filter((name) => name.endsWith("native.jsonl"));
  assert.ok(segmentNames.length > 0);
  const firstLine = (await readFile(path.join(sessionDirectory, "segments", segmentNames[0]), "utf8"))
    .split(/\r?\n/)
    .find(Boolean);
  const nativeRecord = JSON.parse(firstLine);
  assert.equal(nativeRecord.type, "snapshot");
  assert.ok(Array.isArray(nativeRecord.snapshot.players));
  assert.equal(Object.hasOwn(nativeRecord, "dictionary"), false);
  assert.equal(Object.hasOwn(nativeRecord, "changes"), false);

  const reader = createTacticalReplayPlayerModule({ core, modules, config, logger: console });
  await reader.start();
  const sessions = await reader.api.listSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].format, "native-jsonl-v1");
  assert.equal(sessions[0].playerCount, 3);
  assert.equal(sessions[0].peakPlayerCount, 100);

  const replay = await reader.api.readState(sessions[0].id, { atMs: sessions[0].durationMs });
  assert.equal(replay.diagnostics.native, true);
  assert.equal(replay.state.players.length, 3, "the terminal frame must retain the last populated native snapshot");
  assert.equal(replay.state.players[2].identity.name, "Charlie");
  assert.deepEqual(replay.state.players[0].telemetry.position, { x: 800, y: 200, z: 3 });

  await reader.stop();
  await writer.stop();
  await rm(root, { recursive: true, force: true });
  console.log("run-tactical-replay-native-tests: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
