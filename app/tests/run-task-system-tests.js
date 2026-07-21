import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { TaskManager } from "../core/task/TaskManager.js";
import { TaskQueue } from "../core/task/TaskQueue.js";

const queue = new TaskQueue({ maxQueue: 3 });
queue.enqueue({ id: "low", priority: 1, createdAt: "2026-01-01T00:00:00.000Z" });
queue.enqueue({ id: "high", priority: 10, createdAt: "2026-01-01T00:00:01.000Z" });
assert.equal(queue.dequeue().id, "high");
assert.equal(queue.dequeue().id, "low");

const directory = path.join("data", "tasks-test");
await fs.rm(path.resolve(process.cwd(), directory), { recursive: true, force: true });
const manager = new TaskManager({
  config: { workers: 1, maxQueue: 10, taskTimeout: 10000, maxRetry: 0, directory },
  logger: { info() {}, warn() {}, error() {} },
});
await manager.start();
const created = await manager.enqueue({ type: "test.sleep", payload: { ms: 10 } });
const completed = await manager.waitForTask(created.taskId, { timeoutMs: 5000 });
assert.equal(completed.status, "done");
assert.equal(completed.progress, 100);
assert.equal(completed.result.sleptMs, 10);
await manager.stop();
await fs.rm(path.resolve(process.cwd(), directory), { recursive: true, force: true });
console.log("Task system tests passed.");
