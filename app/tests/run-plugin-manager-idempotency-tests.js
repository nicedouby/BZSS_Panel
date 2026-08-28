import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PluginManager } from "../core/plugin-manager.js";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-plugin-manager-"));
const pluginPath = path.join(directory, "idempotent-plugin.js");
await fs.writeFile(pluginPath, `
  export function createPlugin() {
    return {
      manifest: { id: "plugin.idempotentTest", name: "test" },
      async start() { globalThis.__bzssPluginStartCount = (globalThis.__bzssPluginStartCount || 0) + 1; },
      async stop() {},
    };
  }
`, "utf8");

const logger = {
  child() { return this; },
  debug() {},
  info() {},
  warn() {},
  error() {},
};
const manager = new PluginManager({
  core: { createLogger() { return logger; } },
  modules: {},
  logger,
  config: { get(_key, fallback) { return fallback; } },
});

try {
  const [first, second, third] = await Promise.all([
    manager.loadPlugin(pluginPath),
    manager.loadPlugin(pluginPath),
    manager.loadPlugin(pluginPath),
  ]);
  assert.equal(first, second);
  assert.equal(second, third);
  assert.equal(manager.getInstances().length, 1);
  assert.equal(globalThis.__bzssPluginStartCount, 1);
  await manager.stopAll();
  assert.equal(manager.getInstances().length, 0);
} finally {
  delete globalThis.__bzssPluginStartCount;
  await fs.rm(directory, { recursive: true, force: true });
}

console.log("plugin manager idempotency tests passed");
