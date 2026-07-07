import assert from "node:assert/strict";

import { startWebRuntime } from "../shared/bootstrap.js";

async function main() {
  const calls = [];
  const fakeCoreClient = {
    async getPlugins() {
      calls.push("getPlugins");
      return [{ id: "group-report", state: "core" }];
    },
    async getPluginSubscriptionsState() {
      calls.push("getPluginSubscriptionsState");
      return { ok: true, items: [{ id: "group-report", subscribed: true }] };
    },
    async getGroupReportSnapshot() {
      calls.push("getGroupReportSnapshot");
      return { ok: true, data: { plugin: "group-report", groups: [] } };
    },
    async getUdpEventForwarderState() {
      calls.push("getUdpEventForwarderState");
      return { status: { active: true }, items: [] };
    },
  };

  const runtime = await startWebRuntime({
    coreClient: fakeCoreClient,
    modules: {},
    webConfig: {
      enabled: false,
    },
  });

  try {
    const server = runtime.webServer;
    const plugins = await server.coreClient.getPlugins();
    const subs = await server.coreClient.getPluginSubscriptionsState();
    const snapshot = await server.coreClient.getGroupReportSnapshot();
    const udp = await server.coreClient.getUdpEventForwarderState({});

    assert.equal(Array.isArray(plugins), true);
    assert.equal(subs.items[0].subscribed, true);
    assert.equal(snapshot.data.plugin, "group-report");
    assert.equal(udp.status.active, true);
    assert.deepEqual(calls, [
      "getPlugins",
      "getPluginSubscriptionsState",
      "getGroupReportSnapshot",
      "getUdpEventForwarderState",
    ]);
  } finally {
    await runtime.shutdown();
  }

  console.log("run-split-plugin-routes-tests: ok");
}

main();
