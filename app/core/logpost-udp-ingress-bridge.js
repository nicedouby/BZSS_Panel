// -*- coding: utf-8 -*-

import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const WORKER_URL = new URL("../workers/logpost-udp-ingress-worker.js", import.meta.url);

/** Owns the Worker/Main boundary. Business handling remains single-threaded. */
export class LogPostUdpIngressBridge {
  constructor({ config, logger, webStatus, receiver }) {
    this.config = config ?? {};
    this.logger = logger;
    this.webStatus = webStatus;
    this.receiver = receiver;
    this.worker = null;
    this.batchQueue = [];
    this.processing = false;
    this.startPromise = null;
    this.stopPromise = null;
    this.ready = false;
    this.diagnostics = { workerStatus: "stopped" };
  }

  async start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise((resolve, reject) => {
      const worker = new Worker(fileURLToPath(WORKER_URL), { workerData: this.config });
      this.worker = worker;
      const startupTimeout = setTimeout(() => reject(new Error("LogPost UDP ingress worker startup timed out.")), 10_000);
      startupTimeout.unref?.();
      worker.on("message", (message) => this.onWorkerMessage(message, { resolve, reject, startupTimeout }));
      worker.on("error", (error) => this.onWorkerFailure(error));
      worker.on("exit", (code) => {
        if (code !== 0 && !this.stopPromise) this.onWorkerFailure(new Error(`LogPost UDP ingress worker exited with code ${code}.`));
      });
    });
    return this.startPromise;
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = new Promise((resolve) => {
      if (!this.worker) return resolve();
      const worker = this.worker;
      const timeout = setTimeout(async () => {
        await worker.terminate();
        resolve();
      }, 10_000);
      timeout.unref?.();
      const finish = () => {
        clearTimeout(timeout);
        resolve();
      };
      worker.once("exit", finish);
      worker.postMessage({ type: "shutdown" });
    });
    await this.drainMainQueue();
    this.webStatus?.set?.("udpReceiver", "stopped");
    return this.stopPromise;
  }

  getDiagnostics() {
    return { ...this.diagnostics, mainQueueDepth: this.batchQueue.length, mainProcessing: this.processing };
  }

  onWorkerMessage(message, startup) {
    if (message?.type === "ready") {
      this.ready = true;
      this.diagnostics = message.diagnostics ?? this.diagnostics;
      this.publishDiagnostics();
      this.webStatus?.set?.("udpReceiver", "listening");
      clearTimeout(startup.startupTimeout);
      startup.resolve();
      this.logger?.info?.(`LogPost UDP ingress worker listening on ${this.diagnostics.host}:${this.diagnostics.port}`, { operation: "start" });
      return;
    }
    if (message?.type === "startupError") {
      clearTimeout(startup.startupTimeout);
      startup.reject(wrapWorkerStartupError(message.error, this.config));
      return;
    }
    if (message?.type === "eventBatch") {
      this.batchQueue.push(message);
      void this.processBatches();
      return;
    }
    if (message?.type === "diagnostics" || message?.type === "shutdownComplete") {
      this.diagnostics = message.udp ?? message.diagnostics ?? this.diagnostics;
      this.publishDiagnostics();
      return;
    }
    if (message?.type === "workerError") {
      this.logger?.error?.(`LogPost UDP worker error: ${message.error?.stack || message.error?.message || "unknown error"}`, { operation: "workerError" });
    }
  }

  async processBatches() {
    if (this.processing) return;
    this.processing = true;
    try {
      const startedAt = Date.now();
      let processed = 0;
      while (this.batchQueue.length > 0) {
        const batch = this.batchQueue.shift();
        for (const envelope of batch.events ?? []) {
          this.receiver.handleParsedEvent(envelope.rawEvent, envelope);
          processed += 1;
          if (processed >= 256 || Date.now() - startedAt >= 8) {
            await new Promise((resolve) => setImmediate(resolve));
            processed = 0;
          }
        }
        this.worker?.postMessage({ type: "batchAck", batchId: batch.batchId });
      }
    } catch (error) {
      this.logger?.error?.(`LogPost UDP ingress business processing failed: ${error.stack ?? error}`, { operation: "processBatch" });
    } finally {
      this.processing = false;
      if (this.batchQueue.length > 0) void this.processBatches();
    }
  }

  async drainMainQueue() {
    while (this.processing || this.batchQueue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  publishDiagnostics() {
    this.webStatus?.set?.("logPostUdpTransport", this.getDiagnostics());
  }

  onWorkerFailure(error) {
    this.ready = false;
    this.diagnostics = { ...this.diagnostics, workerStatus: "crashed", workerError: String(error?.message ?? error) };
    this.publishDiagnostics();
    this.webStatus?.set?.("udpReceiver", "error");
    this.logger?.error?.(`LogPost UDP ingress worker crashed: ${error.stack ?? error}`, { operation: "workerCrash" });
  }
}

function wrapWorkerStartupError(error, config) {
  const detail = error?.message ?? "unknown error";
  const wrapped = new Error(`Failed to start LogPost UDP ingress worker on ${config?.host ?? "127.0.0.1"}:${config?.port ?? 6666}: ${detail}`);
  wrapped.code = error?.code;
  return wrapped;
}
