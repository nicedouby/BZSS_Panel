import assert from "node:assert/strict";

import { createPlugin as createKxrDoubleSwitchPlugin } from "../plugins/kxr-double-switch.js";

function createHarness() {
  const subscribedTypes = [];
  const forceCalls = [];

  const plugin = createKxrDoubleSwitchPlugin({
    core: {
      logger: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } },
    },
    modules: {
      chatManager: {
        on(type) {
          subscribedTypes.push(type);
          return () => {};
        },
      },
      teamBalance: {
        async forceTeamChange(payload) {
          forceCalls.push(payload);
          return {
            ok: true,
            message: "Team switch requested.",
            command: `AdminForceTeamChange "${payload.steamId}"`,
          };
        },
      },
    },
    config: {
      get(pathText, defaultValue) {
        if (pathText === "plugins.kxrDoubleSwitch") {
          return {
            enabled: true,
            historyLimit: 20,
          };
        }
        return defaultValue;
      },
    },
  });

  return {
    plugin,
    subscribedTypes,
    forceCalls,
  };
}

async function testChatTriggerExecutesTwoSwitches() {
  const harness = createHarness();
  await harness.plugin.start();

  assert.deepEqual(harness.subscribedTypes, ["message"]);

  const result = await harness.plugin.api.simulateChatMessage({
    id: "evt-1",
    message: "kxr",
    steamID: "76561198000000001",
    playerName: "Tester",
  });

  assert.equal(result.matched, true);
  assert.equal(result.trigger, "kxr");
  assert.equal(result.result?.ok, true);
  assert.equal(harness.forceCalls.length, 2);
  assert.equal(harness.forceCalls[0].steamId, "76561198000000001");
  assert.equal(harness.forceCalls[1].steamId, "76561198000000001");
  assert.equal(harness.forceCalls[0].reason, "kxr_double_switch_1");
  assert.equal(harness.forceCalls[1].reason, "kxr_double_switch_2");
  assert.equal(harness.forceCalls[0].system, true);
  assert.equal(harness.forceCalls[1].system, true);

  const state = harness.plugin.api.getState();
  assert.equal(state.triggerCount, 1);
  assert.equal(state.successCount, 1);
  assert.equal(state.history[0].kind, "switch");
  assert.equal(state.history[1].kind, "trigger");

  await harness.plugin.stop();
}

async function testNonMatchingChatDoesNothing() {
  const harness = createHarness();
  await harness.plugin.start();

  const result = await harness.plugin.api.simulateChatMessage({
    id: "evt-2",
    message: "hello",
    steamID: "76561198000000002",
    playerName: "Other",
  });

  assert.equal(result.matched, false);
  assert.equal(harness.forceCalls.length, 0);

  await harness.plugin.stop();
}

await testChatTriggerExecutesTwoSwitches();
await testNonMatchingChatDoesNothing();

console.log("kxr double switch tests passed");
