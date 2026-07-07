import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { CoreControlServer } from "../shared/core-control-server.js";

function createRecorder() {
  const state = {
    status: null,
    headers: null,
    body: "",
  };
  return {
    state,
    res: {
      writeHead(status, headers) {
        state.status = status;
        state.headers = headers;
      },
      end(body = "") {
        state.body = Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? "");
      },
      write(chunk) {
        state.body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk ?? "");
      },
    },
  };
}

function createServer() {
  const groupReportApi = {
    getSnapshot() {
      return { plugin: "group-report", groups: [{ id: "g1", members: [{ playerKey: "eos:1" }] }] };
    },
    getGroups() {
      return [{ id: "g1", name: "Alpha" }];
    },
  };

  return new CoreControlServer({
    config: { enabled: true, token: "" },
    logger: { info() {}, warn() {}, error() {} },
    core: {
      runtimeState: {
        getAll() { return { revisions: {} }; },
        getServer() { return {}; },
        getPlayers() { return { active: [] }; },
        getSquads() { return { list: [] }; },
      },
      pluginSubscriptions: {
        getState() {
          return { ok: true, items: [{ id: "group-report", subscribed: true }] };
        },
      },
      pluginManager: {
        instances: [
          { manifest: { id: "group-report" }, api: groupReportApi },
        ],
      },
      authManager: {
        getUserFromRequest() { return null; },
        hasEverything() { return false; },
        hasPermission() { return false; },
      },
      webStatus: {
        setLogClockSeconds(seconds) { return Number(seconds); },
        resetLogClock() { return 0; },
      },
      console: { getRecent() { return []; } },
      rconManager: { getStatus() { return {}; } },
    },
    modules: {
      pluginSubscriptions: {
        getState() {
          return { ok: true, items: [{ id: "group-report", subscribed: true }] };
        },
      },
      tacticalMapReplay: {
        async listSegments() {
          return { ok: true, items: [{ id: "seg-1" }] };
        },
      },
      remoteTelemetry: {
        getState() {
          return { connected: true };
        },
      },
      chatManager: {
        getHistory() {
          return [{ id: "chat-1" }];
        },
        getStats() {
          return [{ minute: "10:00", count: 1 }];
        },
        getSpammers() {
          return [];
        },
        getPlayerFrequencies() {
          return [];
        },
      },
    },
  });
}

async function request(server, { method = "GET", url = "/", body = null } = {}) {
  const req = body == null ? Readable.from([]) : Readable.from([JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  req.headers = { host: "localhost" };
  req.socket = {};
  const recorder = createRecorder();
  await server.handleRequest(req, recorder.res);
  return recorder.state;
}

async function main() {
  const server = createServer();

  const plugins = await request(server, { url: "/internal/plugins" });
  assert.equal(plugins.status, 200);
  assert.equal(JSON.parse(plugins.body).some((item) => item.id === "group-report"), true);

  const subscriptions = await request(server, { url: "/internal/plugin-subscriptions/state" });
  assert.equal(subscriptions.status, 200);
  assert.equal(JSON.parse(subscriptions.body).items[0].subscribed, true);

  const snapshot = await request(server, { url: "/internal/plugins/group-report/snapshot" });
  assert.equal(snapshot.status, 200);
  assert.equal(JSON.parse(snapshot.body).data.plugin, "group-report");

  const telemetry = await request(server, { url: "/internal/remote-telemetry/state" });
  assert.equal(telemetry.status, 200);
  assert.equal(JSON.parse(telemetry.body).remoteTelemetry.connected, true);

  const logClock = await request(server, { method: "POST", url: "/internal/log-clock/set", body: { seconds: 33 } });
  assert.equal(logClock.status, 200);
  assert.equal(JSON.parse(logClock.body).logClockSeconds, 33);

  console.log("run-core-control-plugin-routes-tests: ok");
}

main();
