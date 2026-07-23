import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTacticalFeedWriterModule, TacticalReplayRecord } from "../modules/tactical-feed-writer/index.js";
import { createTacticalReplayPlayerModule } from "../modules/tactical-replay-player/index.js";

function createEventBus() { return { emitModuleEvent() {} }; }
function snapshot({ x = 100, y = 200, health = 100, map = "Jensens Range" } = {}) { return { server: { serverId: "test", map, layer: "Jensens Range AAS", mode: "AAS" }, match: { state: "Playing" }, teams: [], players: [{ identity: { key: "steam:1", name: "Alpha", steamID: "76561198000000001", playerID: 1 }, presence: { state: "online" }, match: { teamId: 1, squadId: 2, isLeader: true, role: "Rifleman" }, telemetry: { position: { x, y, z: 3 }, yaw: 90, health, fireTeamIndex: 0 }, combat: { kills: 0, wounds: 0, deaths: 0 }, network: { gamePing: 42 }, vehicle: {} }], assets: { captureZones: [{ name: "A", position: { x: 10, y: 20, z: 0 } }], fobs: [], mainZones: [], vehicles: [] } }; }

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tactical-feed-"));
  let onSnapshot = null;
  const feed = createTacticalFeedWriterModule({ core: { eventBus: createEventBus(), webStatus: { serverId: "test" } }, modules: { tacticalState: { async getSnapshot() { return snapshot(); }, subscribe(listener) { onSnapshot = listener; return () => { onSnapshot = null; }; } } }, config: { get() { return { rootDir: root, playerSampleMs: 1, statsSampleMs: 1, networkSampleMs: 1, sceneSampleMs: 1, heartbeatMs: 1, segmentDurationMs: 1 }; } }, logger: console });
  await feed.start();
  await new Promise((resolve) => setTimeout(resolve, 75));
  onSnapshot?.(snapshot({ x: 800, y: 900 }));
  await new Promise((resolve) => setTimeout(resolve, 75));
  await feed.api.setRecordingEnabled(false);
  assert.equal(feed.api.getDiagnostics().recordingEnabled, false);
  assert.equal(feed.api.getDiagnostics().recording, false);
  assert.equal(feed.api.getDiagnostics().lastFinalization?.directoryRenamed, true);
  const entries = await readdir(root);
  assert.equal(entries.length, 1);
  assert.match(entries[0], /^[A-Za-z0-9._-]+$/);
  await stat(path.join(root, entries[0], "session.json"));
  const segments = await readdir(path.join(root, entries[0], "segments"));
  assert.ok(segments.some((name) => name.endsWith(".rps")));
  const data = await readFile(path.join(root, entries[0], "segments", segments.find((name) => name.endsWith(".rps"))));
  assert.equal(data.readUInt32LE(0), 0x50525a42);
  assert.equal(data.readUInt8(5), TacticalReplayRecord.SESSION_BEGIN);
  assert.ok(data.length > 24);
  const replay = createTacticalReplayPlayerModule({
    config: { get() { return { rootDir: root }; } },
    logger: console,
  });
  await replay.start();
  const sessions = await replay.api.listSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].status, "closed");
  assert.equal(sessions[0].isPlayable, true);
  assert.equal(sessions[0].map, "Jensens Range");
  assert.equal(sessions[0].layer, "Jensens Range AAS");
  const replayState = await replay.api.readState(sessions[0].id, { atMs: 60_000 });
  assert.equal(replayState.session.status, "closed");
  assert.equal(replayState.state.session.map, "Jensens Range");
  assert.ok(replayState.diagnostics.segments >= 1);
  assert.equal(replayState.state.players.length, 1);
  assert.equal(replayState.state.players[0].identity.name, "Alpha");
  assert.deepEqual(replayState.state.players[0].telemetry.position, { x: 800, y: 900, z: 3 });
  const earlyReplayState = await replay.api.readState(sessions[0].id, { atMs: 50 });
  assert.deepEqual(earlyReplayState.state.players[0].telemetry.position, { x: 100, y: 200, z: 3 });
  assert.ok(replayState.resolvedAtMs > earlyReplayState.resolvedAtMs, "later replay requests must apply later recorded state");
  const cachedForwardReplayState = await replay.api.readState(sessions[0].id, { atMs: 60_000 });
  assert.deepEqual(cachedForwardReplayState.state.players[0].telemetry.position, { x: 800, y: 900, z: 3 }, "forward reads must continue from the cached cursor");

  // A damaged manual/archive directory must not hide the healthy session.
  const brokenDirectory = path.join(root, "broken_archive");
  await mkdir(brokenDirectory);
  await writeFile(path.join(brokenDirectory, "session.json"), "{invalid json", "utf8");
  const sessionsWithBrokenArchive = await replay.api.listSessions();
  assert.equal(sessionsWithBrokenArchive.length, 2);
  assert.ok(sessionsWithBrokenArchive.some((item) => item.isPlayable === true));
  assert.ok(sessionsWithBrokenArchive.some((item) => item.status === "unreadable"));
  await replay.stop();
  await feed.stop();
  await rm(root, { recursive: true, force: true });
  console.log("run-tactical-feed-writer-tests: ok");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
