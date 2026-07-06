import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EventBus } from "../core/event-bus.js";
import { EventPipeline } from "../core/event-pipeline.js";
import { LogPostFileBridge } from "../core/logpost-file-bridge.js";

function createSilentLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child() { return this; },
  };
}

function createRawEvent({ seq, raw }) {
  return {
    Version: "1",
    ServerID: "BZSS_Main",
    SessionID: "session-1",
    Seq: String(seq),
    Event: "On_RawLogLine",
    Time: "2026-07-06 16:13:35.072",
    LogTime: "2026.07.06-08.13.34:803",
    SourceMode: "live",
    IsReplay: "false",
    CanTriggerActions: "true",
    Raw: raw,
    SourceSeq: String(seq),
    SourceOffset: String(seq * 100),
    RawLineHash: `hash-${seq}`,
    EventId: `event-${seq}`,
  };
}

function createStructuredEvent({ seq, eventName, raw, params = {} }) {
  const event = {
    Version: "1",
    ServerID: "BZSS_Main",
    SessionID: "session-1",
    Seq: String(seq),
    Event: eventName,
    Time: "2026-07-06 16:13:35.072",
    LogTime: "2026.07.06-08.13.34:803",
    SourceMode: "live",
    IsReplay: "false",
    CanTriggerActions: "true",
    Raw: raw,
    SourceSeq: String(seq),
    SourceOffset: String(seq * 100),
    RawLineHash: `hash-${seq}`,
    EventId: `event-${seq}`,
  };

  let index = 1;
  for (const [key, value] of Object.entries(params)) {
    event[`Param${index}_${key}`] = String(value);
    index += 1;
  }

  return event;
}

async function main() {
  await testBridgeReadsDirectEventsDirectory();
  await testBridgeReadsAllEventsFile();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "logpost-file-bridge-"));
  const logger = createSilentLogger();
  const eventBus = new EventBus({ logger });
  const eventPipeline = new EventPipeline();
  const webStatus = {
    values: {},
    set(key, value) {
      this.values[key] = value;
    },
  };

  const today = new Date();
  const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const eventsDir = path.join(tempDir, "LogPost", "events", dateKey);
  fs.mkdirSync(eventsDir, { recursive: true });
  const filePath = path.join(eventsDir, "On_RawLogLine.jsonl");
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(createRawEvent({ seq: 1, raw: "[2026.07.06-08.13.34:803][552]PIE: Error: {ID:0,Pos:145,39,-129,-100,CI{0,125,QBZ191,}}/n/" }))}\n`,
    "utf8",
  );

  const emitted = [];
  eventBus.onCoreEvent("On_RawLogLine", (event) => {
    emitted.push(event);
  });

  const bridge = new LogPostFileBridge({
    config: {
      enabled: true,
      workingDirectory: tempDir,
      pollIntervalMs: 200,
      replayRecentLines: 10,
      fromEnd: true,
    },
    logger,
    eventBus,
    eventPipeline,
    webStatus,
  });

  await bridge.start();
  assert.equal(webStatus.values.logPostFileBridge, "running");
  assert.equal(emitted.length, 1);
  assert.match(emitted[0].rawLog, /Pos:145,39,-129,-100/);
  assert.equal(emitted[0].fileBridgeReplay, true);

  fs.appendFileSync(
    filePath,
    `${JSON.stringify(createRawEvent({ seq: 2, raw: "[2026.07.06-08.13.35:660][582]PIE: PlayerScoreboard{{0,1,2,2,0,1,0,0,0,0,0,0,0,0,1,0,0,0,34}}" }))}\n`,
    "utf8",
  );

  await bridge.tick();
  assert.equal(emitted.length, 2);
  assert.match(emitted[1].rawLog, /PlayerScoreboard/);
  assert.equal(emitted[1].fileBridgeReplay, false);

  await bridge.stop();
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log("[run-logpost-file-bridge-tests] OK");
}

async function testBridgeReadsAllEventsFile() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "logpost-file-bridge-all-"));
  const logger = createSilentLogger();
  const eventBus = new EventBus({ logger });
  const eventPipeline = new EventPipeline();
  const webStatus = {
    values: {},
    set(key, value) {
      this.values[key] = value;
    },
  };

  const today = new Date();
  const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const eventsDir = path.join(tempDir, "LogPost", "events", dateKey);
  fs.mkdirSync(eventsDir, { recursive: true });
  const filePath = path.join(eventsDir, "all.jsonl");
  fs.writeFileSync(
    filePath,
    [
      JSON.stringify(createStructuredEvent({
        seq: 1,
        eventName: "On_SquadCreated",
        raw: "LogSquad: Squad created: Test Squad",
        params: {
          SquadName: "Test Squad",
          CreatorName: "Tester",
        },
      })),
      JSON.stringify(createStructuredEvent({
        seq: 2,
        eventName: "On_PlayerDied",
        raw: "LogPlayer: Died",
        params: {
          VictimName: "Player One",
          KillingDamage: "-300",
        },
      })),
      JSON.stringify(createRawEvent({
        seq: 3,
        raw: "[2026.07.06-08.13.36:660][582]PIE: PlayerScoreboard{{0,1,2,2,0,1,0,0,0,0,0,0,0,0,1,0,0,0,34}}",
      })),
    ].join("\n") + "\n",
    "utf8",
  );

  const emitted = [];
  for (const eventName of ["On_RawLogLine", "On_SquadCreated", "On_PlayerDied"]) {
    eventBus.onCoreEvent(eventName, (event) => {
      emitted.push(event);
    });
  }

  const bridge = new LogPostFileBridge({
    config: {
      enabled: true,
      workingDirectory: tempDir,
      pollIntervalMs: 200,
      replayRecentLines: 10,
      fromEnd: true,
    },
    logger,
    eventBus,
    eventPipeline,
    webStatus,
  });

  await bridge.start();
  assert.equal(webStatus.values.logPostFileBridge, "running");
  assert.equal(emitted.length, 3);
  assert.equal(emitted[0].fileBridgeReplay, true);
  assert.equal(emitted[1].fileBridgeReplay, true);
  assert.equal(emitted[2].fileBridgeReplay, true);
  await bridge.stop();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

async function testBridgeReadsDirectEventsDirectory() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "logpost-file-bridge-direct-"));
  const logger = createSilentLogger();
  const eventBus = new EventBus({ logger });
  const eventPipeline = new EventPipeline();
  const webStatus = {
    values: {},
    set(key, value) {
      this.values[key] = value;
    },
  };

  const today = new Date();
  const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const eventsDir = path.join(tempDir, "events", dateKey);
  fs.mkdirSync(eventsDir, { recursive: true });
  const filePath = path.join(eventsDir, "On_RawLogLine.jsonl");
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(createRawEvent({ seq: 1, raw: "[2026.07.06-08.13.34:803][552]PIE: Error: {ID:0,Pos:145,39,-129,-100,CI{0,125,QBZ191,}}/n/" }))}\n`,
    "utf8",
  );

  const emitted = [];
  eventBus.onCoreEvent("On_RawLogLine", (event) => {
    emitted.push(event);
  });

  const bridge = new LogPostFileBridge({
    config: {
      enabled: true,
      workingDirectory: tempDir,
      pollIntervalMs: 200,
      replayRecentLines: 10,
      fromEnd: true,
    },
    logger,
    eventBus,
    eventPipeline,
    webStatus,
  });

  await bridge.start();
  assert.equal(webStatus.values.logPostFileBridge, "running");
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].fileBridgeReplay, true);
  await bridge.stop();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
