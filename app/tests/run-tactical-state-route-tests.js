import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { handleTacticalStateRoutes } from "../modules/tactical-state/routes.js";

async function main() {
  const req = new EventEmitter();
  req.method = "GET";
  req.socket = { setTimeout() {}, setKeepAlive() {} };

  const res = new EventEmitter();
  const writes = [];
  let blockNext = false;
  res.writableEnded = false;
  res.writeHead = () => {};
  res.write = (text) => {
    writes.push(String(text));
    if (blockNext) {
      blockNext = false;
      return false;
    }
    return true;
  };

  let streamListener = null;
  let unsubscribed = false;
  let latestRevision = 10;
  const tacticalState = {
    async getPlayers() {
      return [{
        identity: { name: "Health Test", playerID: 7, steamID: "76561190000000000" },
        telemetry: { health: 0.75, stale: false, observedAt: "2026-07-15T00:00:00.000Z" },
      }];
    },
    async getStreamSnapshot() {
      const envelope = {
        ok: true,
        type: "tactical-state.snapshot",
        snapshot: { meta: { revision: latestRevision }, players: [] },
      };
      return { envelope, serialized: JSON.stringify(envelope) };
    },
    subscribeStream(listener) {
      streamListener = listener;
      return () => { unsubscribed = true; };
    },
  };

  const replaySession = {
    id: "20260721T120000Z_test_abcdef",
    status: "closed",
    map: "Jensens Range",
    layer: "Jensens Range AAS v1",
    durationMs: 10_000,
    frameCounts: { players: 30, assets: 2 },
  };
  const tacticalReplay = {
    getStatus() {
      return { enabled: true, activeSession: null };
    },
    async listSessions({ limit }) {
      assert.equal(limit, 25);
      return [replaySession];
    },
    async getSession(sessionId) {
      return sessionId === replaySession.id ? replaySession : null;
    },
    async readFrames(sessionId, options) {
      assert.equal(sessionId, replaySession.id);
      assert.deepEqual(options.types, "players,assets");
      assert.equal(options.fromMs, 2_000);
      assert.equal(options.toMs, 5_000);
      assert.equal(options.includeContext, true);
      return {
        session: replaySession,
        fromMs: options.fromMs,
        toMs: options.toMs,
        frames: [
          { type: "assets", seq: 1, t: 0, assets: { captureZones: [], fobs: [], mainZones: [] } },
          { type: "players", seq: 2, t: 2_000, players: [] },
        ],
        hasMore: false,
        nextFromMs: null,
      };
    },
  };

  let healthResponse = null;
  const healthHandled = await handleTacticalStateRoutes({
    modules: { tacticalState, tacticalReplay },
    url: new URL("http://localhost/api/tactical-state/player-health"),
    req,
    res,
    user: null,
    json(_status, payload) { healthResponse = payload; },
  });
  assert.equal(healthHandled, true);
  assert.equal(healthResponse?.players?.[0]?.name, "Health Test");
  assert.equal(healthResponse?.players?.[0]?.health, 0.75);

  let replayListResponse = null;
  const replayListHandled = await handleTacticalStateRoutes({
    modules: { tacticalState, tacticalReplay },
    url: new URL("http://localhost/api/tactical-state/replays?limit=25"),
    req,
    res,
    user: null,
    json(status, payload) { replayListResponse = { status, payload }; },
  });
  assert.equal(replayListHandled, true);
  assert.equal(replayListResponse.status, 200);
  assert.equal(replayListResponse.payload.sessions[0].id, replaySession.id);

  let replayFramesResponse = null;
  const replayFramesHandled = await handleTacticalStateRoutes({
    modules: { tacticalState, tacticalReplay },
    url: new URL(`http://localhost/api/tactical-state/replays/${replaySession.id}/frames?from=2000&to=5000&types=players,assets&context=1`),
    req,
    res,
    user: null,
    json(status, payload) { replayFramesResponse = { status, payload }; },
  });
  assert.equal(replayFramesHandled, true);
  assert.equal(replayFramesResponse.status, 200);
  assert.equal(replayFramesResponse.payload.frames.length, 2);
  assert.equal(replayFramesResponse.payload.frames[0].type, "assets");

  const handled = await handleTacticalStateRoutes({
    modules: { tacticalState, tacticalReplay },
    url: new URL("http://localhost/api/tactical-state/stream"),
    req,
    res,
    user: null,
    json() {},
  });
  assert.equal(handled, true);
  assert.match(writes[0], /tactical-state\.snapshot/);

  blockNext = true;
  streamListener({ serialized: JSON.stringify({ type: "tactical-state.delta", revision: 11 }) });
  latestRevision = 12;
  streamListener({ serialized: JSON.stringify({ type: "tactical-state.delta", revision: 12 }) });
  res.emit("drain");
  await new Promise((resolve) => setTimeout(resolve, 10));

  const last = writes.at(-1);
  assert.match(last, /tactical-state\.snapshot/);
  assert.match(last, /"revision":12/);
  assert.doesNotMatch(last, /tactical-state\.delta/);

  req.emit("close");
  assert.equal(unsubscribed, true);
  console.log("run-tactical-state-route-tests: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
