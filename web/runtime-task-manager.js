// -*- coding: utf-8 -*-

class RuntimeTaskManager {
  constructor() {
    this.tasks = new Map();
    this.dedupeInFlight = new Set();
    this.visibilityListenerBound = false;
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
  }

  registerTask(config) {
    if (!config || !config.id || typeof config.run !== "function") {
      throw new Error("RuntimeTaskManager.registerTask requires id and run");
    }

    const existing = this.tasks.get(config.id);
    const task = {
      id: String(config.id),
      intervalMs: normalizeInterval(config.intervalMs, 1000),
      backgroundIntervalMs: normalizeInterval(config.backgroundIntervalMs, 5000),
      visibleOnly: Boolean(config.visibleOnly),
      dedupeKey: String(config.dedupeKey || config.id),
      scope: String(config.scope || "global"),
      inFlight: existing?.inFlight ?? false,
      enabled: true,
      timerId: existing?.timerId ?? null,
      controller: existing?.controller ?? null,
      run: config.run,
    };

    if (existing?.timerId) {
      window.clearTimeout(existing.timerId);
      task.timerId = null;
    }

    this.tasks.set(task.id, task);
    this.ensureVisibilityListener();
    this.schedule(task, 0);

    return task;
  }

  stopTask(id, { abort = true } = {}) {
    const task = this.tasks.get(id);
    if (!task) return;

    task.enabled = false;
    if (task.timerId) {
      window.clearTimeout(task.timerId);
      task.timerId = null;
    }

    if (abort && task.controller) {
      task.controller.abort();
      task.controller = null;
    }

    task.inFlight = false;
    this.dedupeInFlight.delete(task.dedupeKey);
  }

  removeTask(id, options = {}) {
    this.stopTask(id, options);
    this.tasks.delete(id);
    this.maybeRemoveVisibilityListener();
  }

  removeTasksByScope(scope, options = {}) {
    const ids = [];
    for (const task of this.tasks.values()) {
      if (task.scope === scope) ids.push(task.id);
    }

    for (const id of ids) {
      this.removeTask(id, options);
    }
  }

  handleVisibilityChange() {
    for (const task of this.tasks.values()) {
      if (!task.enabled) continue;
      this.schedule(task, 0);
    }
  }

  ensureVisibilityListener() {
    if (this.visibilityListenerBound) return;
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.visibilityListenerBound = true;
  }

  maybeRemoveVisibilityListener() {
    if (!this.visibilityListenerBound) return;
    if (this.tasks.size > 0) return;
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.visibilityListenerBound = false;
  }

  schedule(task, delayMs = null) {
    if (!task.enabled) return;

    if (task.timerId) {
      window.clearTimeout(task.timerId);
      task.timerId = null;
    }

    const interval = delayMs == null
      ? (document.hidden ? task.backgroundIntervalMs : task.intervalMs)
      : delayMs;

    task.timerId = window.setTimeout(() => {
      this.tick(task.id).catch(() => {});
    }, Math.max(0, interval));
  }

  async tick(taskId) {
    const task = this.tasks.get(taskId);
    if (!task || !task.enabled) return;

    if (task.visibleOnly && document.hidden) {
      this.schedule(task);
      return;
    }

    if (task.inFlight || this.dedupeInFlight.has(task.dedupeKey)) {
      this.schedule(task);
      return;
    }

    task.inFlight = true;
    this.dedupeInFlight.add(task.dedupeKey);

    const controller = new AbortController();
    task.controller = controller;

    try {
      await task.run({
        signal: controller.signal,
        hidden: document.hidden,
        inFlight: task.inFlight,
        task,
      });
    } finally {
      const latest = this.tasks.get(taskId);
      if (latest) {
        latest.inFlight = false;
        if (latest.controller === controller) latest.controller = null;
      }
      this.dedupeInFlight.delete(task.dedupeKey);

      if (latest?.enabled) {
        this.schedule(latest);
      }
    }
  }
}

function normalizeInterval(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

let runtimeTaskManager = null;

export function getRuntimeTaskManager() {
  if (!runtimeTaskManager) {
    runtimeTaskManager = new RuntimeTaskManager();
  }
  return runtimeTaskManager;
}
