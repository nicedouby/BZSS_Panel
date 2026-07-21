import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class TaskWorker {
  constructor({ id, taskTimeout = 600000, onMessage, onExit, logger = console } = {}) {
    this.id = id;
    this.taskTimeout = taskTimeout;
    this.onMessage = onMessage;
    this.onExit = onExit;
    this.logger = logger;
    this.worker = null;
    this.task = null;
    this.timer = null;
    this.callbackChain = Promise.resolve();
  }

  start() {
    if (this.worker) return;
    const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../workers/worker-thread.js");
    this.worker = new Worker(workerPath, { workerData: { workerId: this.id } });
    this.worker.on("message", (message) => this.dispatchMessage(message));
    this.worker.on("error", (error) => this.dispatchMessage({ event: "error", error: serializeError(error) }));
    this.worker.on("exit", (code) => {
      this.clearTimeout();
      this.worker = null;
      this.dispatchExit(code);
    });
  }

  run(task) {
    this.start();
    this.task = task;
    this.timer = setTimeout(() => {
      this.logger.error?.("[TaskWorker] timeout: " + task.id);
      this.worker?.terminate();
      this.dispatchMessage({ event: "timeout", taskId: task.id });
    }, this.taskTimeout);
    this.worker.postMessage({ event: "run", task });
  }

  dispatchMessage(message) {
    const taskId = String(message?.taskId ?? this.task?.id ?? "unknown");
    const operation = this.callbackChain.then(() => this.onMessage?.(this, message));
    this.callbackChain = operation.catch((error) => {
      this.logger.error?.(
        "[TaskWorker] message handler failed for " + taskId + ": " + (error?.stack || error),
      );
    });
    return operation;
  }

  dispatchExit(code) {
    const operation = this.callbackChain.then(() => this.onExit?.(this, code));
    this.callbackChain = operation.catch((error) => {
      this.logger.error?.(
        "[TaskWorker] exit handler failed for worker " + this.id + ": " + (error?.stack || error),
      );
    });
    return operation;
  }

  clearTimeout() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  stop() {
    this.clearTimeout();
    return this.worker?.terminate();
  }
}

function serializeError(error) {
  return { name: error?.name, message: error?.message, stack: error?.stack, code: error?.code };
}
