import assert from "node:assert/strict";

import { createConsoleModule } from "../modules/console/index.js";

function createHarness() {
  const coreListeners = new Set();
  const nativeListeners = new Set();
  const loggerListeners = new Set();
  const logger = {
    subscribe(listener) {
      loggerListeners.add(listener);
      return () => loggerListeners.delete(listener);
    },
    debug() {},
    info() {},
    warn() {},
    error() {},
  };

  const core = {
    logger,
    createLogger() {
      return logger;
    },
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
    emitLoggerEntry(entry) {
      for (const handler of loggerListeners) handler(entry);
    },
  };
}

async function testModuleStreamReceivesLoggerEntries() {
  const harness = createHarness();
  await harness.module.start();

  harness.emitLoggerEntry({
    stream: "app",
    channel: "module",
    level: "info",
    time: "2026-05-08T10:00:00.000Z",
    message: "module ready",
    scope: "module.test",
    source: "module.test",
    moduleId: "module.test",
    eventName: "TEST_EVENT",
    operation: "start",
    label: "INFO",
    tags: [],
    data: { players: 2 },
  });

  const lines = harness.module.api.getLines({ stream: "modules" });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].eventName, "TEST_EVENT");
  assert.match(lines[0].message, /module ready/);
}

async function testRawLogStreamReceivesLogPostRawEvents() {
  const harness = createHarness();
  await harness.module.start();

  harness.emitCoreEvent({
    eventId: "raw-1",
    eventName: "On_RawLogLine",
    serverId: "BZSS_Main",
    source: "python-log-parser",
    time: "2026-05-08T10:00:02.000Z",
    logTime: "2026.05.08-10.00.02:000",
    rawLog: "[2026.05.08-10.00.02:000][1]LogSquadTrace: raw hello",
    rawEvent: {
      Raw: "[2026.05.08-10.00.02:000][1]LogSquadTrace: raw hello",
      RawTruncated: "false",
    },
    paramMap: {
      Source: "Squad.log",
      Channel: "LogSquadTrace",
    },
    params: [],
  });

  const lines = harness.module.api.getLines({ stream: "raw-log" });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].rawChannel, "LogSquadTrace");
  assert.match(lines[0].message, /raw hello/);
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

  const lines = harness.module.api.getLines({ stream: "rcon-native" });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, "push");
  assert.match(lines[0].message, /Alice/);
}

async function testNativeTeamKillLineIsMarked() {
  const harness = createHarness();
  await harness.module.start();

  harness.emitNativeLog({
    level: "push",
    message: "[ChatAdmin] ASQKillDeathRuleset : Player Donald·DoubyBear Team Killed Player Braovo",
    time: "2026-05-08T10:00:01.000Z",
    kind: "push",
    isTeamKill: true,
    tags: ["tk"],
  });

  const lines = harness.module.api.getLines({ stream: "rcon-native" });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].isTeamKill, true);
  assert.deepEqual(lines[0].tags, ["tk"]);
}

async function testFailedManualCommandIsWrittenToNativeView() {
  const harness = createHarness();
  await harness.module.start();

  const result = await harness.module.api.executeRconCommand("FailCommand", {
    requestedBy: "test.console",
  });

  assert.equal(result.success, false);

  const lines = harness.module.api.getLines({ stream: "rcon-native" });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, "error");
  assert.equal(lines[0].command, "FailCommand");
  assert.equal(lines[0].message, "RCON queue is full.");
}

await testModuleStreamReceivesLoggerEntries();
await testRawLogStreamReceivesLogPostRawEvents();
await testNativeViewReceivesRconLogs();
await testNativeTeamKillLineIsMarked();
await testFailedManualCommandIsWrittenToNativeView();

console.log("console module tests passed");
