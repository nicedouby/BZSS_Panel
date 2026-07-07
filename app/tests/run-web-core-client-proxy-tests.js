import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { WebServer } from "../core/web-server.js";

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
    },
  };
}

function createServer({ coreClient = null, modules = {} } = {}) {
  return new WebServer({
    config: { enabled: false },
    logger: { info() {}, warn() {}, error() {} },
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "admin", role: "SuperAdmin", isSuperAdmin: true };
        },
        hasEverything() {
          return true;
        },
        hasPermission() {
          return true;
        },
      },
      pluginManager: { instances: [] },
      webStatus: {
        setLogClockSeconds(seconds) { return Number(seconds); },
        resetLogClock() { return 0; },
      },
    },
    modules,
    coreClient,
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
  const coreClientCalls = [];
  const fakeCoreClient = {
    async getPlugins() {
      coreClientCalls.push("getPlugins");
      return [{ id: "group-report", active: true }];
    },
    async getPluginSubscriptionsState() {
      coreClientCalls.push("getPluginSubscriptionsState");
      return { ok: true, items: [{ id: "group-report", subscribed: true }] };
    },
    async getGroupReportSnapshot() {
      coreClientCalls.push("getGroupReportSnapshot");
      return { ok: true, data: { plugin: "group-report", groups: [{ id: "g1" }] } };
    },
    async getUdpEventForwarderState() {
      coreClientCalls.push("getUdpEventForwarderState");
      return { status: { active: true }, items: [{ id: 1 }] };
    },
    async setLogClockSeconds(body) {
      coreClientCalls.push(["setLogClockSeconds", body.seconds]);
      return { ok: true, logClockSeconds: body.seconds };
    },
  };

  const splitServer = createServer({ coreClient: fakeCoreClient, modules: {} });

  const plugins = await request(splitServer, { url: "/api/plugins" });
  assert.equal(plugins.status, 200);
  assert.equal(JSON.parse(plugins.body)[0].active, true);

  const subs = await request(splitServer, { url: "/api/plugin-subscriptions/state" });
  assert.equal(subs.status, 200);
  assert.equal(JSON.parse(subs.body).items[0].subscribed, true);

  const groupSnapshot = await request(splitServer, { url: "/api/plugins/group-report/snapshot" });
  assert.equal(groupSnapshot.status, 200);
  assert.equal(JSON.parse(groupSnapshot.body).data.plugin, "group-report");

  const udp = await request(splitServer, { url: "/api/plugins/udp-event-forwarder/state" });
  assert.equal(udp.status, 200);
  assert.equal(JSON.parse(udp.body).status.active, true);

  const logClock = await request(splitServer, { method: "POST", url: "/api/log-clock/set", body: { seconds: 12 } });
  assert.equal(logClock.status, 200);
  assert.equal(JSON.parse(logClock.body).logClockSeconds, 12);

  assert.equal(coreClientCalls.length >= 5, true);

  const legacyServer = createServer({
    modules: {
      pluginSubscriptions: {
        getState() {
          return { ok: true, items: [{ id: "legacy", subscribed: false }] };
        },
      },
    },
  });
  const legacySubs = await request(legacyServer, { url: "/api/plugin-subscriptions/state" });
  assert.equal(legacySubs.status, 200);
  assert.equal(JSON.parse(legacySubs.body).items[0].id, "legacy");

  console.log("run-web-core-client-proxy-tests: ok");
}

main();
