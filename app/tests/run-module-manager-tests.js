import assert from "node:assert/strict";
import { ModuleManager } from "../core/module-manager.js";

function makeManager(configValues = {}) {
  const runtimeItems = [];
  const manager = new ModuleManager({
    core: {
      createLogger() { return { debug() {}, info() {}, warn() {}, error() {} }; },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    config: {
      get(key, fallback) {
        return Object.hasOwn(configValues, key) ? configValues[key] : fallback;
      },
    },
  });
  manager.registry.pluginSubscriptions = {
    registerRuntimeItem(item) { runtimeItems.push(item); },
  };
  return { manager, runtimeItems };
}

async function main() {
  {
    const { manager, runtimeItems } = makeManager();
    let starts = 0;
    let stops = 0;
    const disabled = {
      manifest: { id: "module.disabledByDefault", defaultEnabled: false },
      apiName: "disabledApi",
      api: {},
      async start() { starts += 1; },
      async stop() { stops += 1; },
    };
    assert.equal(await manager.activateInstance(disabled), false);
    assert.equal(starts, 0);
    assert.equal(manager.registry.disabledApi, undefined);
    assert.equal(runtimeItems.at(-1)?.status, "stopped");
    await manager.activateInstance(disabled);
    assert.equal(starts, 0);
    await manager.stopAll();
    assert.equal(stops, 0);
  }

  {
    const { manager } = makeManager({ "modules.enabled": { enabled: true } });
    let starts = 0;
    let stops = 0;
    const enabled = {
      manifest: { id: "module.enabled" },
      apiName: "enabledApi",
      api: { ok: true },
      async start() { starts += 1; },
      async stop() { stops += 1; },
    };
    await manager.activateInstance(enabled);
    await manager.activateInstance(enabled);
    assert.equal(starts, 1);
    assert.equal(manager.registry.enabledApi.ok, true);
    await manager.stopAll();
    assert.equal(stops, 1);
  }

  console.log("run-module-manager-tests: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
