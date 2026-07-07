import assert from "node:assert/strict";

import { PluginManager } from "../core/plugin-manager.js";
import { WebServer } from "../core/web-server.js";

async function main() {
  const manager = new PluginManager({
    core: {
      eventBus: {},
      pluginSubscriptions: {},
      webRegistry: {},
      webStatus: {},
      createLogger() {
        return { info() {}, warn() {}, error() {}, debug() {} };
      },
    },
    modules: {},
    logger: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } },
    config: { get() { return {}; } },
  });

  const resolved = await manager.resolvePluginPath("./plugins/group-report.js");
  assert.equal(resolved.endsWith("app\\plugins\\group-report.js"), true);

  await assert.rejects(
    () => manager.resolvePluginPath("./plugins/not-found.js"),
    /Plugin path not found/,
  );

  const server = new WebServer({
    config: { enabled: false },
    logger: { info() {}, warn() {}, error() {} },
    core: {
      pluginManager: {
        instances: [
          { manifest: { id: "group-report" }, api: { id: "group-report" } },
          { manifest: { id: "udp_event_forwarder" }, api: { id: "udp_event_forwarder" } },
          { manifest: { id: "plugin.weaponCollector" }, apiName: "weaponCollector", api: { id: "weaponCollector" } },
        ],
      },
      authManager: {},
    },
    modules: {},
  });

  assert.equal(server.getPluginApi("group-report")?.id, "group-report");
  assert.equal(server.getPluginApi("plugin.group-report")?.id, "group-report");
  assert.equal(server.getPluginApi("udp-event-forwarder")?.id, "udp_event_forwarder");
  assert.equal(server.getPluginApi("plugin.udp_event_forwarder")?.id, "udp_event_forwarder");
  assert.equal(server.getPluginApi("plugin.weaponCollector")?.id, "weaponCollector");

  console.log("run-plugin-manager-path-compat-tests: ok");
}

main();
