import assert from "node:assert/strict";

import {
  createPlugin,
  DEFAULT_MESSAGES,
  randomBetweenSeconds,
} from "../plugins/chat-interaction-help-broadcast.js";

function createHarness({ failLine = 0 } = {}) {
  const broadcasts = [];
  const coreHandlers = new Map();
  const configStore = new Map([
    ["plugins.chat-interaction-help-broadcast", {
      enabled: true,
      minIntervalSeconds: 300,
      maxIntervalSeconds: 600,
    }],
  ]);

  const plugin = createPlugin({
    core: {
      pluginSubscriptions: { isSubscribed: () => true },
      eventBus: {
        onCoreEvent(name, handler) {
          coreHandlers.set(name, handler);
          return () => coreHandlers.delete(name);
        },
      },
    },
    modules: {
      pluginSubscriptions: { isSubscribed: () => true },
      adminWarn: {
        async sendAdminBroadcast(request) {
          broadcasts.push(request);
          if (failLine > 0 && broadcasts.length === failLine) {
            throw new Error(`line_${failLine}_failed`);
          }
          return { success: true };
        },
      },
    },
    config: {
      get(key, fallback) {
        return configStore.has(key) ? configStore.get(key) : fallback;
      },
    },
    logger: { info() {}, warn() {} },
  });

  return { plugin, broadcasts, coreHandlers };
}

assert.equal(randomBetweenSeconds(300, 600, () => 0), 300);
assert.equal(randomBetweenSeconds(300, 600, () => 0.999999), 600);
assert.equal(randomBetweenSeconds(600, 300, () => 0), 300);

const harness = createHarness();
await harness.plugin.start();

let state = harness.plugin.api.getState();
assert.equal(state.timerActive, true);
assert.equal(state.nextDelaySeconds >= 300 && state.nextDelaySeconds <= 600, true);
assert.equal(harness.coreHandlers.has("PLUGIN_SUBSCRIPTIONS_UPDATED"), true);

const firstRun = await harness.plugin.api.runNow();
assert.equal(firstRun.ok, true);
assert.equal(firstRun.lineCount, DEFAULT_MESSAGES.length);
assert.equal(firstRun.failedCount, 0);
assert.deepEqual(
  harness.broadcasts.map((entry) => entry.message),
  [...DEFAULT_MESSAGES],
);
assert.equal(
  harness.broadcasts.every((entry) => !/[\r\n]/.test(entry.message)),
  true,
);
assert.equal(
  new Set(harness.broadcasts.map((entry) => entry.relatedEventId)).size,
  1,
);

state = harness.plugin.api.getState();
assert.equal(state.cycleCount, 1);
assert.equal(state.lineBroadcastCount, DEFAULT_MESSAGES.length);
assert.equal(state.failedLineCount, 0);
assert.equal(state.timerActive, true);
assert.equal(state.nextDelaySeconds >= 300 && state.nextDelaySeconds <= 600, true);

await harness.plugin.stop();
assert.equal(harness.plugin.api.getState().timerActive, false);
assert.equal(harness.coreHandlers.size, 0);

const partialFailure = createHarness({ failLine: 3 });
await partialFailure.plugin.start();
const partialResult = await partialFailure.plugin.api.runNow();
assert.equal(partialResult.ok, false);
assert.equal(partialResult.lineCount, DEFAULT_MESSAGES.length);
assert.equal(partialResult.failedCount, 1);
assert.equal(partialFailure.broadcasts.length, DEFAULT_MESSAGES.length);
assert.equal(partialFailure.plugin.api.getState().failedLineCount, 1);
assert.equal(partialFailure.plugin.api.getState().lineBroadcastCount, DEFAULT_MESSAGES.length - 1);
await partialFailure.plugin.stop();

console.log("chat interaction help broadcast tests passed");
