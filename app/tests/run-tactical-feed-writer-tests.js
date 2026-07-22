import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTacticalFeedWriterModule, TacticalReplayRecord } from "../modules/tactical-feed-writer/index.js";

function createEventBus() { return { emitModuleEvent() {} }; }
function snapshot({ x = 100, y = 200, health = 100, map = "Jensens Range" } = {}) { return { server: { serverId: "test", map, layer: "Jensens Range AAS", mode: "AAS" }, match: { state: "Playing" }, teams: [], players: [{ identity: { key: "steam:1", name: "Alpha", steamID: "76561198000000001", playerID: 1 }, presence: { state: "online" }, match: { teamId: 1, squadId: 2, isLeader: true, role: "Rifleman" }, telemetry: { position: { x, y, z: 3 }, yaw: 90, health, fireTeamIndex: 0 }, combat: { kills: 0, wounds: 0, deaths: 0 }, network: { gamePing: 42 }, vehicle: {} }], assets: { captureZones: [{ name: "A", position: { x: 10, y: 20, z: 0 } }], fobs: [], mainZones: [], vehicles: [] } }; }

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tactical-feed-"));
  const feed = createTacticalFeedWriterModule({ core: { eventBus: createEventBus(), webStatus: { serverId: "test" } }, modules: { tacticalState: { async getSnapshot() { return snapshot(); }, subscribe() { return () => {}; } } }, config: { get() { return { rootDir: root, playerSampleMs: 1, statsSampleMs: 1, networkSampleMs: 1, sceneSampleMs: 1, heartbeatMs: 1, segmentDurationMs: 1 }; } }, logger: console });
  await feed.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await feed.api.forceEnd("test");
  const entries = await readdir(root);
  assert.equal(entries.length, 1);
  const segments = await readdir(path.join(root, entries[0], "segments"));
  assert.ok(segments.some((name) => name.endsWith(".rps")));
  const data = await readFile(path.join(root, entries[0], "segments", segments.find((name) => name.endsWith(".rps"))));
  assert.equal(data.readUInt32LE(0), 0x50525a42);
  assert.equal(data.readUInt8(5), TacticalReplayRecord.SESSION_BEGIN);
  assert.ok(data.length > 24);
  await feed.stop();
  await rm(root, { recursive: true, force: true });
  console.log("run-tactical-feed-writer-tests: ok");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
