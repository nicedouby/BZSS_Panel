import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { EventBus } from "../core/event-bus.js";
import { EventPipeline } from "../core/event-pipeline.js";
import { LogPostFileBridge } from "../core/logpost-file-bridge.js";

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "logpost-recovery-"));
  try {
    const today = new Date();
    const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const eventsDir = path.join(root, "events", dateKey);
    const filePath = path.join(eventsDir, "all.jsonl");
    const checkpointPath = path.join(root, "consumer.json");
    const deadLetterDirectory = path.join(root, "dead-letter");
    await fsp.mkdir(eventsDir, { recursive: true });
    await fsp.writeFile(filePath, `${event(1)}\n{bad-json}\n${event(2)}\n`, "utf8");
    const emitted = [];
    const eventBus = new EventBus({ logger: silentLogger() });
    eventBus.onCoreEvent("On_RawLogLine", (value) => emitted.push(value));
    const bridge = createBridge({ root, checkpointPath, deadLetterDirectory, eventBus });
    await bridge.start();
    assert.equal(emitted.length, 1);
    assert.ok(bridge.committedOffset > 0 && bridge.committedOffset < (await fsp.stat(filePath)).size);
    await bridge.tick();
    assert.equal(emitted.length, 1);
    await bridge.tick();
    assert.equal(emitted.length, 2);
    assert.equal(bridge.getDiagnostics().deadLetterCount, 1);
    assert.equal(bridge.committedOffset, (await fsp.stat(filePath)).size);
    assert.match(await fsp.readFile(path.join(deadLetterDirectory, `${dateKey}.jsonl`), "utf8"), /bad-json/);
    await bridge.stop();

    const secondBus = new EventBus({ logger: silentLogger() });
    const restarted = [];
    secondBus.onCoreEvent("On_RawLogLine", (value) => restarted.push(value));
    const bridge2 = createBridge({ root, checkpointPath, deadLetterDirectory, eventBus: secondBus });
    await bridge2.start();
    assert.equal(restarted.length, 0);
    await fsp.appendFile(filePath, `${event(3, "中文玩家跨块测试")}\n`, "utf8");
    await bridge2.tick();
    assert.equal(restarted.length, 1);
    assert.match(restarted[0].rawLog, /中文玩家跨块测试/);
    const checkpoint = JSON.parse(await fsp.readFile(checkpointPath, "utf8"));
    assert.equal(checkpoint.schema, "logpost.consumer.v1");
    assert.equal(checkpoint.committedOffset, (await fsp.stat(filePath)).size);
    await bridge2.stop();
    console.log("[run-logpost-recovery-tests] OK");
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
}

function createBridge({ root, checkpointPath, deadLetterDirectory, eventBus }) {
  return new LogPostFileBridge({
    config: { enabled: true, workingDirectory: root, fromEnd: false, pollIntervalMs: 60_000, checkpointPath, deadLetterDirectory },
    logger: silentLogger(), eventBus, eventPipeline: new EventPipeline(),
    webStatus: { state: {}, set(key, value) { this.state[key] = value; } },
  });
}
function event(seq, raw = `line-${seq}`) { return JSON.stringify({ Version: "1", ServerID: "BZSS_Main", SessionID: "s", Seq: String(seq), Event: "On_RawLogLine", Time: new Date().toISOString(), SourceMode: "live", IsReplay: "false", CanTriggerActions: "true", Raw: raw, EventId: `recovery-${seq}` }); }
function silentLogger() { return { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } }; }

main().catch((error) => { console.error(error); process.exit(1); });
