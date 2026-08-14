import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { EventBus } from "../core/event-bus.js";
import { EventPipeline } from "../core/event-pipeline.js";
import { LogPostFileBridge } from "../core/logpost-file-bridge.js";

const TOTAL_LINES = 60_000;

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "logpost-throughput-"));
  try {
    const now = new Date();
    const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const directory = path.join(root, "events", dateKey);
    const sourcePath = path.join(directory, "all.jsonl");
    await fsp.mkdir(directory, { recursive: true });
    const rows = new Array(TOTAL_LINES);
    for (let index = 0; index < TOTAL_LINES; index += 1) rows[index] = makeEvent(index + 1);
    await fsp.writeFile(sourcePath, `${rows.join("\n")}\n`, "utf8");
    const logger = { debug() {}, info() {}, warn() {}, error() {} };
    const bus = new EventBus({ logger, maxRecentCoreEventIds: TOTAL_LINES + 100 });
    let received = 0;
    bus.onCoreEvent("On_RawLogLine", () => { received += 1; });
    const bridge = new LogPostFileBridge({
      config: {
        enabled: true, workingDirectory: root, fromEnd: false,
        checkpointPath: path.join(root, "checkpoint.json"),
        deadLetterDirectory: path.join(root, "dead-letter"),
        pollIntervalMs: 60_000,
      },
      logger,
      eventBus: bus,
      eventPipeline: new EventPipeline(),
      webStatus: { state: {}, set(key, value) { this.state[key] = value; } },
    });
    const startedAt = performance.now();
    await bridge.start();
    const fileSize = (await fsp.stat(sourcePath)).size;
    while (bridge.committedOffset < fileSize) await bridge.tick();
    const durationMs = performance.now() - startedAt;
    const diagnostics = bridge.getDiagnostics();
    assert.equal(received, TOTAL_LINES);
    assert.equal(diagnostics.linesProcessed, TOTAL_LINES);
    assert.equal(diagnostics.deadLetterCount, 0);
    assert.equal(diagnostics.sourceGapCount, 0);
    assert.equal(diagnostics.backlogBytes, 0);
    await bridge.stop();
    console.log(`[run-logpost-throughput-tests] OK ${TOTAL_LINES} lines in ${durationMs.toFixed(0)}ms`);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
}

function makeEvent(seq) {
  return JSON.stringify({
    Version: "1", ServerID: "BZSS_Main", SessionID: "throughput", Seq: String(seq),
    Event: "On_RawLogLine", Time: "2026-08-14 07:00:00.000", SourceMode: "live",
    IsReplay: "false", CanTriggerActions: "true", Raw: `stress-line-${seq}`,
    SourceSeq: String(seq), SourceOffset: String(seq * 128), RawLineHash: `hash-${seq}`,
    EventId: `throughput-${seq}`,
  });
}

main().catch((error) => { console.error(error); process.exit(1); });
