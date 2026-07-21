import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import { TaskQueue } from "./TaskQueue.js";
import { TaskStorage } from "./TaskStorage.js";
import { TaskWorker } from "./TaskWorker.js";
import { TaskStatus, DEFAULT_TASK_CONFIG } from "./TaskTypes.js";

export class TaskManager extends EventEmitter {
  constructor({ config = {}, logger = console } = {}) {
    super();
    this.config = { ...DEFAULT_TASK_CONFIG, ...(config ?? {}) };
    this.logger = logger;
    this.storage = new TaskStorage({ directory: this.config.directory ?? "data/tasks", logger });
    this.queue = new TaskQueue({ maxQueue: this.config.maxQueue });
    this.tasks = new Map();
    this.workers = [];
    this.started = false;
    this.stopping = false;
  }

  async start() {
    if (this.started) return;
    await this.storage.init();
    for (const task of await this.storage.list()) {
      if (task.status === TaskStatus.RUNNING) {
        task.status = TaskStatus.QUEUED;
        task.startedAt = null;
        task.workerId = null;
        task.recoveredAt = new Date().toISOString();
      }
      this.tasks.set(task.id, task);
      if (task.status === TaskStatus.QUEUED) this.queue.enqueue(task);
    }
    this.started = true;
    this.stopping = false;
    const count = Math.max(1, Math.min(32, Number(this.config.workers) || 4));
    for (let index = 0; index < count; index += 1) {
      this.workers.push(new TaskWorker({
        id: index + 1,
        taskTimeout: Number(this.config.taskTimeout) || 600000,
        logger: this.logger,
        onMessage: (worker, message) => this.handleWorkerMessage(worker, message),
        onExit: (worker, code) => this.handleWorkerExit(worker, code),
      }));
    }
    this.pump();
    this.logger.info?.("[TaskManager] started with " + count + " workers.");
  }

  async stop() {
    this.stopping = true;
    for (const worker of this.workers.splice(0)) await worker.stop();
    this.started = false;
  }

  async enqueue(input = {}) {
    if (!this.started) throw new Error("TaskManager has not started.");
    const now = new Date().toISOString();
    const task = {
      id: String(input.id || "task_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex")),
      type: String(input.type || ""),
      priority: clampPriority(input.priority),
      status: TaskStatus.QUEUED,
      payload: input.payload ?? {},
      progress: 0,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
      retryCount: 0,
      maxRetry: Number.isFinite(Number(input.maxRetry))
        ? Math.max(0, Number(input.maxRetry))
        : Number(this.config.maxRetry),
      workerId: null,
    };
    if (!task.type) throw new Error("Task type is required.");
    this.queue.enqueue(task);
    this.tasks.set(task.id, task);
    await this.storage.save(task);
    this.emit("queued", this.publicTask(task));
    this.pump();
    return { taskId: task.id, task: this.publicTask(task) };
  }

  get(id) {
    const task = this.tasks.get(String(id));
    return task ? this.publicTask(task) : null;
  }

  list({ limit = 200 } = {}) {
    return [...this.tasks.values()]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, Math.max(1, Number(limit) || 200))
      .map((task) => this.publicTask(task));
  }

  getDiagnostics() {
    const counts = { queued: 0, running: 0, done: 0, failed: 0 };
    for (const task of this.tasks.values()) if (counts[task.status] != null) counts[task.status] += 1;
    return {
      workers: this.workers.length,
      idleWorkers: this.workers.filter((worker) => !worker.task).length,
      queueSize: this.queue.size,
      counts,
    };
  }

  pump() {
    if (!this.started || this.stopping) return;
    for (const worker of this.workers) {
      if (worker.task) continue;
      const task = this.queue.dequeue();
      if (!task) break;
      this.runOnWorker(worker, task).catch((error) => this.failTask(worker, task, error));
    }
  }

  async runOnWorker(worker, task) {
    task.status = TaskStatus.RUNNING;
    task.startedAt = new Date().toISOString();
    task.workerId = worker.id;
    await this.storage.save(task);
    worker.run(task);
    this.emit("running", this.publicTask(task));
  }

  async handleWorkerMessage(worker, message) {
    const task = this.tasks.get(String(message.taskId ?? worker.task?.id));
    if (!task) return;
    if (message.event === "progress") {
      task.progress = Math.max(0, Math.min(100, Number(message.progress) || 0));
      await this.storage.save(task);
      this.emit("progress", this.publicTask(task));
      return;
    }
    worker.clearTimeout();
    worker.task = null;
    if (message.event === "done") {
      task.status = TaskStatus.DONE;
      task.progress = 100;
      task.result = message.result ?? null;
      task.finishedAt = new Date().toISOString();
      task.error = null;
      await this.storage.save(task);
      this.emit("done", this.publicTask(task));
    } else {
      await this.failTask(worker, task, deserializeError(message.error || message));
    }
    this.pump();
  }

  async failTask(worker, task, error) {
    worker.clearTimeout();
    worker.task = null;
    task.error = { name: error?.name, message: error?.message, stack: error?.stack, code: error?.code };
    if (task.retryCount < task.maxRetry && !this.stopping) {
      task.retryCount += 1;
      task.status = TaskStatus.QUEUED;
      task.startedAt = null;
      task.workerId = null;
      await this.storage.save(task);
      this.queue.enqueue(task);
      this.emit("retry", this.publicTask(task));
    } else {
      task.status = TaskStatus.FAILED;
      task.finishedAt = new Date().toISOString();
      await this.storage.save(task);
      this.emit("failed", this.publicTask(task));
    }
    this.pump();
  }

  async handleWorkerExit(worker, code) {
    const task = worker.task;
    worker.task = null;
    if (task && this.tasks.get(task.id)?.status === TaskStatus.RUNNING) {
      await this.failTask(worker, task, new Error("Worker exited with code " + code));
    }
    if (this.started && !this.stopping) {
      worker.start();
      this.pump();
    }
  }

  publicTask(task) {
    return { ...task, payload: undefined };
  }
}

function clampPriority(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(10, Math.round(n))) : 5;
}

function deserializeError(error) {
  const result = new Error(error?.message || "Task failed.");
  Object.assign(result, error);
  return result;
}
