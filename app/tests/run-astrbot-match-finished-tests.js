import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { WebServer } from "../core/web-server.js";
import { createAstrbotBridgeModule } from "../modules/astrbot-bridge/index.js";

function createConfig(state) {
  return {
    get(pathText, fallback) {
      let current = state;
      for (const part of String(pathText ?? "").split(".").filter(Boolean)) {
        if (!current || typeof current !== "object" || !(part in current)) return fallback;
        current = current[part];
      }
      return current;
    },
  };
}

function createRecorder() {
  const state = { status: 0, headers: {}, body: "" };
  return {
    state,
    res: {
      writeHead(status, headers = {}) {
        state.status = status;
        state.headers = headers;
      },
      end(body = "") {
        state.body = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
      },
    },
  };
}

function createJsonRequest(url, body, authorization = "") {
  const req = Readable.from([JSON.stringify(body ?? {})]);
  req.method = "POST";
  req.url = url;
  req.headers = {
    host: "localhost",
    "content-type": "application/json",
    ...(authorization ? { authorization } : {}),
  };
  req.socket = { remoteAddress: "127.0.0.1" };
  return req;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const handlers = [];
  const snapshots = new Map([
    ["snapshot-current", {
      roundKey: "BZSS_Main:round-1",
      capturedAt: "2026-07-31T08:00:01.000Z",
      server: { serverId: "BZSS_Main", serverName: "BZSS Main Server", playerCount: 96 },
      match: { map: "Yehorivka", layer: "Yehorivka_RAAS_v2", mode: "RAAS" },
      trigger: { winner: "Team 1" },
      summary: { recordedPlayerCount: 96 },
    }],
    ["snapshot-old", {
      roundKey: "BZSS_Main:old-round",
      capturedAt: "2026-07-30T08:00:01.000Z",
      server: { serverId: "BZSS_Main", serverName: "BZSS Main Server", playerCount: 80 },
      match: { map: "Tallil", layer: "Tallil_RAAS_v1", mode: "RAAS" },
      trigger: { winner: "Team 2" },
      summary: { recordedPlayerCount: 80 },
    }],
  ]);
  let snapshotCreateCount = 0;
  let rconCount = 0;
  const configState = {
    modules: {
      astrbotBridge: {
        enabled: true,
        apiToken: "astrbot-secret",
        websocket: { enabled: true, path: "/ws/astrbot", heartbeatIntervalMs: 30_000 },
        matchFinished: {
          enabled: true,
          snapshotWaitMs: 20,
          dedupeTtlMs: 100,
          dedupeMax: 2,
          allowTextFallback: false,
        },
        deliveryAck: { enabled: true, maxRecent: 2 },
      },
    },
  };
  const config = createConfig(configState);
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const core = {
    config,
    logger,
    createLogger() {
      return logger;
    },
    eventBus: {
      onCoreEvent(name, handler) {
        if (name === "*") handlers.push(handler);
        return () => {};
      },
    },
    webStatus: {
      getSnapshot() {
        return {
          serverId: "BZSS_Main",
          serverName: "BZSS Main Server",
          playerCount: 96,
          maxPlayers: 100,
          queueCount: 0,
          map: "Yehorivka",
          layer: "Yehorivka_RAAS_v2",
          mode: "RAAS",
          playtime: 3600,
        };
      },
      getWarmupState() {
        return { isWarmup: false };
      },
    },
    rconManager: {
      async execute() {
        rconCount += 1;
      },
    },
  };
  const modules = {
    matchEndSnapshot: {
      async listSnapshots() {
        return [
          { id: "snapshot-current", capturedAt: "2026-07-31T08:00:01.000Z" },
          { id: "snapshot-old", capturedAt: "2026-07-30T08:00:01.000Z" },
        ];
      },
      async readSnapshot(id) {
        const snapshot = snapshots.get(id);
        if (!snapshot) throw new Error("snapshot not found");
        return structuredClone(snapshot);
      },
      async readSnapshotImage() {
        return { content: Buffer.from("png") };
      },
      async takeManualSnapshot() {
        snapshotCreateCount += 1;
      },
    },
  };
  const bridgeModule = createAstrbotBridgeModule({ core, modules, config, logger });
  await bridgeModule.init();
  await bridgeModule.start();
  assert.equal(handlers.length, 1);
  const bridge = bridgeModule.api;

  const simulatedOne = await bridge.dispatchMatchFinished({
    simulated: true,
    useLatestSnapshot: true,
    winner: "测试阵营",
    source: "panel.manual-test",
  });
  const simulatedTwo = await bridge.dispatchMatchFinished({
    simulated: true,
    useLatestSnapshot: true,
    winner: "测试阵营",
    source: "panel.manual-test",
  });
  assert.equal(simulatedOne.event.type, "match.finished");
  assert.equal(simulatedOne.event.version, 1);
  assert.ok(simulatedOne.event.eventId.startsWith("test_match_finished:BZSS_Main:"));
  assert.notEqual(simulatedOne.event.eventId, simulatedTwo.event.eventId);
  assert.equal(simulatedOne.event.data.simulated, true);
  assert.equal(simulatedOne.event.data.snapshotId, "snapshot-current");
  assert.equal(simulatedOne.websocketClients, 0);
  assert.deepEqual(bridge.getState().metrics.recentEvents[1], simulatedOne.event);

  handlers[0]({
    eventName: "round.match_winner",
    roundKey: "BZSS_Main:round-1",
    serverId: "BZSS_Main",
    time: "2026-07-31T08:00:00.000Z",
    normalized: { roundMatchWinner: { winner: "Team 1" } },
  });
  handlers[0]({
    eventName: "match.snapshot.ready",
    roundKey: "BZSS_Main:round-1",
    snapshotId: "snapshot-current",
    serverId: "BZSS_Main",
  });
  await wait(5);
  const realEvents = bridge.getState().metrics.recentEvents.filter(
    (event) => event.type === "match.finished" && event.data?.simulated === false,
  );
  assert.equal(realEvents.length, 1);
  assert.equal(realEvents[0].eventId, "match_finished:BZSS_Main:BZSS_Main:round-1");
  assert.equal(realEvents[0].data.serverName, "BZSS Main Server");
  assert.equal(realEvents[0].data.roundKey, "BZSS_Main:round-1");
  assert.equal(realEvents[0].data.map, "Yehorivka");
  assert.equal(realEvents[0].data.layer, "Yehorivka_RAAS_v2");
  assert.equal(realEvents[0].data.mode, "RAAS");
  assert.equal(realEvents[0].data.snapshotReady, true);
  assert.equal(realEvents[0].data.snapshotId, "snapshot-current");
  assert.equal(realEvents[0].data.source, "match.snapshot.ready");

  handlers[0]({
    eventName: "match.snapshot.ready",
    roundKey: "BZSS_Main:round-1",
    snapshotId: "snapshot-current",
  });
  await wait(5);
  assert.equal(
    bridge.getState().metrics.recentEvents.filter(
      (event) => event.type === "match.finished" && event.data?.roundKey === "BZSS_Main:round-1",
    ).length,
    1,
  );

  handlers[0]({
    eventName: "round.match_winner",
    roundKey: "BZSS_Main:round-timeout",
    serverId: "BZSS_Main",
    normalized: { roundMatchWinner: { winner: "Team 2" } },
  });
  await wait(35);
  const timeoutEvent = bridge.getState().metrics.recentEvents.find(
    (event) => event.type === "match.finished" && event.data?.roundKey === "BZSS_Main:round-timeout",
  );
  assert.equal(timeoutEvent, undefined);

  const authManager = {
    getUserFromRequest(req) {
      if (req.headers.authorization === "super") {
        return { username: "root", role: "SuperAdmin", isSuperAdmin: true };
      }
      if (req.headers.authorization === "admin") {
        return { username: "admin", role: "Admin", isSuperAdmin: false };
      }
      return null;
    },
    hasEverything(user) {
      return user?.isSuperAdmin === true;
    },
  };
  const audits = [];
  const server = new WebServer({
    config: { enabled: false, host: "127.0.0.1", port: 8899, staticDirectory: "./web-client/dist" },
    logger,
    core: {
      ...core,
      authManager,
      auditManager: {
        async execute(context, executor) {
          audits.push(context);
          return executor({ requestId: "audit-test" });
        },
      },
      pluginManager: { instances: [] },
    },
    modules: { astrbotBridge: bridge },
  });

  const unauthenticated = createRecorder();
  await server.handleRequest(
    createJsonRequest("/api/astrbot/panel-test/match-finished", { useLatestSnapshot: true }),
    unauthenticated.res,
  );
  assert.equal(unauthenticated.state.status, 401);

  const forbidden = createRecorder();
  await server.handleRequest(
    createJsonRequest("/api/astrbot/panel-test/match-finished", { useLatestSnapshot: true }, "admin"),
    forbidden.res,
  );
  assert.equal(forbidden.state.status, 403);

  const panelTest = createRecorder();
  await server.handleRequest(
    createJsonRequest("/api/astrbot/panel-test/match-finished", {
      useCurrentServer: true,
      useLatestSnapshot: true,
      winner: "测试阵营",
    }, "super"),
    panelTest.res,
  );
  assert.equal(panelTest.state.status, 200);
  const panelTestBody = JSON.parse(panelTest.state.body);
  assert.equal(panelTestBody.event.data.simulated, true);
  assert.equal(panelTestBody.event.data.source, "panel.manual-test");
  assert.equal(panelTestBody.websocketClients, 0);
  assert.equal(panelTestBody.warning, "No AstrBot WebSocket client is connected.");
  assert.equal(audits.at(-1)?.action, "astrbot.match_finished.test");
  assert.equal(snapshotCreateCount, 0);
  assert.equal(rconCount, 0);

  const wrongAckToken = createRecorder();
  await server.handleRequest(
    createJsonRequest("/api/astrbot/event-ack", { eventId: panelTestBody.event.eventId }),
    wrongAckToken.res,
  );
  assert.equal(wrongAckToken.state.status, 401);

  for (let index = 0; index < 3; index += 1) {
    const ackRecorder = createRecorder();
    await server.handleRequest(
      createJsonRequest("/api/astrbot/event-ack", {
        eventId: index === 2 ? panelTestBody.event.eventId : `event-${index}`,
        eventType: "match.finished",
        received: true,
        delivered: index === 2,
        successCount: index === 2 ? 1 : 0,
        failureCount: index === 2 ? 0 : 1,
        targets: [{ target: `aiocqhttp:GroupMessage:${index}`, ok: index === 2, error: null }],
        error: null,
      }, "Bearer astrbot-secret"),
      ackRecorder.res,
    );
    assert.equal(ackRecorder.state.status, 200);
  }
  const delivery = bridge.getState().delivery;
  assert.equal(delivery.ackReceived, 3);
  assert.equal(delivery.recentAcks.length, 2);
  assert.equal(delivery.lastDeliveredEventId, panelTestBody.event.eventId);

  const tooManyTargets = createRecorder();
  await server.handleRequest(
    createJsonRequest("/api/astrbot/event-ack", {
      eventId: "oversized",
      targets: Array.from({ length: 21 }, (_, index) => ({ target: String(index), ok: true })),
    }, "Bearer astrbot-secret"),
    tooManyTargets.res,
  );
  assert.equal(tooManyTargets.state.status, 400);

  await wait(110);
  await bridge.dispatchMatchFinished({ simulated: true, winner: "TTL cleanup" });
  assert.ok(bridge.getState().matchFinished.dedupeSize <= 2);

  await bridgeModule.stop();
  console.log("astrbot match.finished tests passed");
}

await main();
