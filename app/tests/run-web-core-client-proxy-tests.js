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
    async proxyApi({ path, search = "", method = "GET", body = undefined }) {
      coreClientCalls.push({ path, search, method, body });
      if (`${path}${search}` === "/internal/plugins") {
        return [{ id: "group-report", active: true }];
      }
      if (`${path}${search}` === "/internal/plugin-subscriptions/state") {
        return { ok: true, items: [{ id: "group-report", subscribed: true }] };
      }
      if (`${path}${search}` === "/internal/plugins/group-report/snapshot?limit=200&type=all") {
        return { ok: true, data: { plugin: "group-report", groups: [{ id: "g1" }] } };
      }
      if (`${path}${search}` === "/internal/plugins/udp-event-forwarder/state") {
        return { status: { active: true }, items: [{ id: 1 }] };
      }
      if (`${path}${search}` === "/internal/match/snapshot") {
        return { ok: true, source: "core-client", match: { id: "m1" } };
      }
      if (`${path}${search}` === "/internal/jobs/playtime-refresh-online") {
        return { ok: true, jobId: "job-1" };
      }
      throw new Error(`Unexpected proxyApi call: ${method} ${path}${search}`);
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

  const groupSnapshot = await request(splitServer, { url: "/api/plugins/group-report/snapshot?limit=200&type=all" });
  assert.equal(groupSnapshot.status, 200);
  assert.equal(JSON.parse(groupSnapshot.body).data.plugin, "group-report");

  const udp = await request(splitServer, { url: "/api/plugins/udp-event-forwarder/state" });
  assert.equal(udp.status, 200);
  assert.equal(JSON.parse(udp.body).status.active, true);

  const matchSnapshot = await request(splitServer, { url: "/api/match/snapshot" });
  assert.equal(matchSnapshot.status, 200);
  assert.equal(JSON.parse(matchSnapshot.body).source, "core-client");

  const playtimeJob = await request(splitServer, {
    method: "POST",
    url: "/api/jobs/playtime-refresh-online",
    body: { serverId: "s1", force: true },
  });
  assert.equal(playtimeJob.status, 200);
  assert.equal(JSON.parse(playtimeJob.body).jobId, "job-1");

  const logClock = await request(splitServer, { method: "POST", url: "/api/log-clock/set", body: { seconds: 12 } });
  assert.equal(logClock.status, 200);
  assert.equal(JSON.parse(logClock.body).logClockSeconds, 12);

  assert.deepEqual(coreClientCalls.slice(0, 6), [
    { path: "/internal/plugins", search: "", method: "GET", body: undefined },
    { path: "/internal/plugin-subscriptions/state", search: "", method: "GET", body: undefined },
    { path: "/internal/plugins/group-report/snapshot", search: "?limit=200&type=all", method: "GET", body: undefined },
    { path: "/internal/plugins/udp-event-forwarder/state", search: "", method: "GET", body: undefined },
    { path: "/internal/match/snapshot", search: "", method: "GET", body: undefined },
    { path: "/internal/jobs/playtime-refresh-online", search: "", method: "POST", body: { serverId: "s1", force: true } },
  ]);

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
