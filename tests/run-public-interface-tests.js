import assert from "node:assert/strict";

import createPublicInterfaceModule from "../modules/public-interface/index.js";

function createConfig(publicInterfaceConfig) {
  return {
    get(key, fallback) {
      if (key === "modules.publicInterface") {
        return publicInterfaceConfig;
      }
      return fallback;
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

function createModule({
  publicInterfaceConfig = {},
  webStatusSnapshot = {},
  matchStateSnapshot = null,
  rconStatus = null,
  tacticalPlayers = [],
} = {}) {
  const core = {
    webStatus: {
      getSnapshot() {
        return { ...webStatusSnapshot };
      },
      ...webStatusSnapshot,
    },
    rconManager: rconStatus == null
      ? null
      : {
          getStatus() {
            return { ...rconStatus };
          },
        },
  };

  const modules = {
    matchState: matchStateSnapshot == null
      ? null
      : {
          getState() {
            return clone(matchStateSnapshot);
          },
          getOverview() {
            return { matchState: clone(matchStateSnapshot) };
          },
        },
    bzssCoreMonitor: {
      getPlayers() {
        return tacticalPlayers.map((item) => ({ ...item }));
      },
    },
  };

  return createPublicInterfaceModule({
    config: createConfig(publicInterfaceConfig),
    logger: createLogger(),
    core,
    modules,
  });
}

function createJsonRecorder() {
  const state = {
    status: null,
    payload: null,
  };

  return {
    state,
    json(status, payload) {
      state.status = status;
      state.payload = payload;
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function testServerSnapshotIncludesSummary() {
  const module = createModule({
    publicInterfaceConfig: {
      enabled: true,
      allowAnonymous: false,
      tokens: [
        {
          token: "token-1",
          scopes: ["server:read", "players:read", "squads:read", "match:read", "tactical:read", "ws:read"],
        },
      ],
    },
    webStatusSnapshot: {
      serverId: "BZSS_Test",
      serverName: "Test Server",
      playerCount: null,
      queueCount: null,
      tps: null,
      tpsStatus: "unknown",
      playtime: null,
      updatedAt: "2026-06-23T05:10:00.000Z",
    },
    matchStateSnapshot: {
      updatedAt: "2026-06-23T05:12:00.000Z",
      serverStatus: {
        map: "Narva",
        layer: "Narva RAAS v1",
        playerCount: 48,
        queueCount: 6,
        playtime: 1234,
        tps: 29,
        tpsStatus: "good",
      },
      match: {
        map: "Narva",
        layer: "Narva RAAS v1",
        playtime: 1234,
      },
      players: {
        count: 48,
        list: Array.from({ length: 48 }, (_, index) => ({ playerID: String(index + 1), name: `Player ${index + 1}` })),
      },
      squads: { count: 3, list: [] },
    },
    rconStatus: {
      lastPlayersRefresh: "2026-06-23T05:11:00.000Z",
      lastSquadsRefresh: "2026-06-23T05:11:30.000Z",
    },
  });

  const summary = module.api.getPublicServerSummary();
  assert.equal(summary.serverId, "BZSS_Test");
  assert.equal(summary.serverName, "Test Server");
  assert.equal(summary.playerCount, 48);
  assert.equal(summary.queueCount, 6);
  assert.equal(summary.currentMap, "Narva");
  assert.equal(summary.currentLayer, "Narva RAAS v1");
  assert.equal(summary.tps, 29);
  assert.equal(summary.tpsStatus, "good");
  assert.equal(summary.rconTime, 1234);
  assert.equal(summary.updatedAt, "2026-06-23T05:12:00.000Z");

  const serverRecorder = createJsonRecorder();
  await module.api.handleHttp({
    url: new URL("http://127.0.0.1/api/public/v1/server"),
    req: { headers: { authorization: "Bearer token-1" } },
    json: serverRecorder.json,
    ip: "127.0.0.1",
  });

  assert.equal(serverRecorder.state.status, 200);
  assert.equal(serverRecorder.state.payload.data.summary.currentMap, "Narva");
  assert.equal(serverRecorder.state.payload.data.summary.rconTime, 1234);

  const allRecorder = createJsonRecorder();
  await module.api.handleHttp({
    url: new URL("http://127.0.0.1/api/public/v1/all"),
    req: { headers: { authorization: "Bearer token-1" } },
    json: allRecorder.json,
    ip: "127.0.0.1",
  });

  assert.equal(allRecorder.state.status, 200);
  assert.equal(allRecorder.state.payload.data.server.summary.playerCount, 48);
  assert.equal(allRecorder.state.payload.data.server.summary.currentLayer, "Narva RAAS v1");
}

async function testSummaryFallsBackWhenSnapshotsAreMissing() {
  const module = createModule({
    publicInterfaceConfig: {
      enabled: true,
      allowAnonymous: false,
      tokens: [
        {
          token: "token-2",
          scopes: ["server:read", "ws:read"],
        },
      ],
    },
    webStatusSnapshot: {
      serverId: "BZSS_Fallback",
      serverName: "Fallback Server",
      playerCount: 7,
      queueCount: 2,
      tps: 26,
      tpsStatus: "warning",
      playtime: 88,
      map: "Yehorivka",
      layer: "Yehorivka_RAAS_v1",
      updatedAt: "2026-06-23T06:00:00.000Z",
    },
    matchStateSnapshot: null,
    rconStatus: null,
  });

  const summary = module.api.getPublicServerSummary();
  assert.equal(summary.serverId, "BZSS_Fallback");
  assert.equal(summary.serverName, "Fallback Server");
  assert.equal(summary.playerCount, 7);
  assert.equal(summary.queueCount, 2);
  assert.equal(summary.currentMap, "Yehorivka");
  assert.equal(summary.currentLayer, "Yehorivka_RAAS_v1");
  assert.equal(summary.tps, 26);
  assert.equal(summary.tpsStatus, "warning");
  assert.equal(summary.rconTime, 88);
  assert.equal(summary.updatedAt, "2026-06-23T06:00:00.000Z");

  const recorder = createJsonRecorder();
  await module.api.handleHttp({
    url: new URL("http://127.0.0.1/api/public/v1/server"),
    req: { headers: { authorization: "Bearer token-2" } },
    json: recorder.json,
    ip: "127.0.0.1",
  });

  assert.equal(recorder.state.status, 200);
  assert.equal(recorder.state.payload.data.summary.currentMap, "Yehorivka");
  assert.equal(recorder.state.payload.data.summary.rconTime, 88);
}

await testServerSnapshotIncludesSummary();
await testSummaryFallsBackWhenSnapshotsAreMissing();

console.log("public interface tests passed");
