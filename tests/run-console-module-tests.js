import assert from "node:assert/strict";

import { createConsoleModule } from "../modules/console/index.js";

function createHarness() {
  const coreListeners = new Set();
  const nativeListeners = new Set();

  const core = {
    eventBus: {
      onCoreEvent(eventName, handler) {
        assert.equal(eventName, "*");
        coreListeners.add(handler);
        return () => coreListeners.delete(handler);
      },
    },
    rconManager: {
      onNativeLog(handler) {
        nativeListeners.add(handler);
        return () => nativeListeners.delete(handler);
      },
      async dispatchCommand({ command }) {
        if (command === "FailCommand") {
          return {
            success: false,
            message: "RCON queue is full.",
            rconResponse: "",
          };
        }

        return {
          success: true,
          message: "RCON command executed.",
          rconResponse: "OK",
        };
      },
    },
  };

  const config = {
    get(path, defaultValue) {
      if (path === "modules.console.maxLines") return 200;
      return defaultValue;
    },
  };

  return {
    module: createConsoleModule({ core, config }),
    emitCoreEvent(event) {
      for (const handler of coreListeners) handler(event);
    },
    emitNativeLog(line) {
      for (const handler of nativeListeners) handler(line);
    },
  };
}

async function testDispatcherViewReceivesCoreEvents() {
  const harness = createHarness();
  await harness.module.start();

  harness.emitCoreEvent({
    eventId: "evt-1",
    eventName: "CHAT_MESSAGE",
    serverId: "BZSS_Main",
    source: "core.rconManager",
    time: "2026-05-08T10:00:00.000Z",
    payload: {
      channel: "ChatAll",
      name: "Alice",
      message: "Hello",
    },
  });

  const lines = harness.module.api.getLines({ channel: "dispatcher" });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].eventName, "CHAT_MESSAGE");
  assert.match(lines[0].message, /CHAT_MESSAGE/);
  assert.match(lines[0].message, /Alice/);
}

async function testNativeViewReceivesRconLogs() {
  const harness = createHarness();
  await harness.module.start();

  harness.emitNativeLog({
    level: "push",
    message: "[ChatAll] [Online IDs: EOS: 123 steam: 456] Alice : hello",
    time: "2026-05-08T10:00:01.000Z",
    kind: "push",
  });

  const lines = harness.module.api.getLines({ channel: "rcon-native" });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, "push");
  assert.match(lines[0].message, /Alice/);
}

async function testFailedManualCommandIsWrittenToNativeView() {
  const harness = createHarness();
  await harness.module.start();

  const result = await harness.module.api.executeRconCommand("FailCommand", {
    requestedBy: "test.console",
  });

  assert.equal(result.success, false);

  const lines = harness.module.api.getLines({ channel: "rcon-native" });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, "error");
  assert.equal(lines[0].command, "FailCommand");
  assert.equal(lines[0].message, "RCON queue is full.");
}

await testDispatcherViewReceivesCoreEvents();
await testNativeViewReceivesRconLogs();
await testFailedManualCommandIsWrittenToNativeView();

console.log("console module tests passed");
