import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FileIOManager } from "../core/file-io-manager.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-file-io-"));
const manager = new FileIOManager({
  config: {
    appendFlushIntervalMs: 10,
    appendBatchBytes: 64,
    maxQueuedBytes: 1024 * 1024,
    statCacheMs: 250,
  },
});
await manager.start();

const logPath = path.join(root, "events", "all.jsonl");
for (let i = 0; i < 100; i += 1) {
  assert.equal(await manager.append(logPath, JSON.stringify({ seq: i }) + "\n"), true);
}
await manager.flush(logPath);

const stat = await manager.stat(logPath, { cache: false });
assert.ok(stat.size > 0);
const raw = await manager.readRange(logPath, 0, stat.size);
assert.equal(raw.toString("utf8").trim().split("\n").length, 100);

const statePath = path.join(root, "state.json");
await manager.writeJsonAtomic(statePath, { revision: 1, ok: true });
assert.deepEqual(await manager.readJson(statePath), { revision: 1, ok: true });

const diagnostics = manager.getPublicDiagnostics();
assert.equal(diagnostics.errors, 0);
assert.equal(diagnostics.queuedBytes, 0);
assert.ok(diagnostics.flushCount >= 1);

await manager.stop();
await fs.rm(root, { recursive: true, force: true });
console.log("[run-file-io-manager-tests] OK");
