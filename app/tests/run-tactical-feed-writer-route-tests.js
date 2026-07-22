import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { handleTacticalFeedWriterRoutes } from "../modules/tactical-feed-writer/routes.js";

async function main() {
  const req = new EventEmitter();
  req.method = "GET";
  const calls = [];
  const api = {
    getDiagnostics: () => ({ recordingEnabled: true, recording: true, activeSession: "test-session" }),
    async setRecordingEnabled(enabled) { calls.push(enabled); return enabled; },
  };
  const core = { authManager: { hasEverything: () => true } };
  let response = null;
  const json = (status, payload) => { response = { status, payload }; };

  assert.equal(await handleTacticalFeedWriterRoutes({ core, modules: { tacticalFeedWriter: api }, url: new URL("http://localhost/api/tactical-feed-writer/status"), req, user: {}, readJsonBody: async () => ({}), json }), true);
  assert.equal(response.status, 200);
  assert.equal(response.payload.recording, true);

  req.method = "POST";
  assert.equal(await handleTacticalFeedWriterRoutes({ core, modules: { tacticalFeedWriter: api }, url: new URL("http://localhost/api/tactical-feed-writer/recording"), req, user: {}, readJsonBody: async () => ({ enabled: false }), json }), true);
  assert.deepEqual(calls, [false]);
  assert.equal(response.payload.recordingEnabled, true);

  const denied = await handleTacticalFeedWriterRoutes({ core: { authManager: { hasEverything: () => false } }, modules: { tacticalFeedWriter: api }, url: new URL("http://localhost/api/tactical-feed-writer/recording"), req, user: {}, readJsonBody: async () => ({ enabled: true }), json });
  assert.equal(denied, true);
  assert.equal(response.status, 403);
  console.log("run-tactical-feed-writer-route-tests: ok");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
