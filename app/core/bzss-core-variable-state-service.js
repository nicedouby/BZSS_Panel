// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";

export const BZSS_CORE_BOOL_KEYS = [
  "LocalVOIPEnable",
  "OutputBZSSObj",
  "CheckingNoob",
];

const DEFAULT_RECONCILE_INTERVAL_MS = 3000;

export class BzssCoreVariableStateService {
  constructor({ config, logger, executor = execFileAsync } = {}) {
    this.config = config;
    this.logger = logger;
    this.executor = executor;
    this.desired = emptyValues();
    this.desiredUpdatedAt = null;
    this.desiredLoaded = false;
    this.lastActual = null;
    this.reconcilePromise = null;
    this.reconcileRequested = false;
    this.interval = null;
  }

  getPaths() {
    const configuredScriptPath = String(this.config?.get?.("bzssCore.modifyScriptPath")
      ?? this.config?.get?.("bzssCore.modifySaveGamePath")
      ?? "").trim();
    const saveGamePath = String(this.config?.get?.("bzssCore.remoteSaveGamePath")
      ?? this.config?.get?.("bzssCore.saveGamePath")
      ?? "").trim();
    const desiredStatePath = String(
      this.config?.get?.("bzssCore.desiredStatePath", "data/bzss-core/desired-state.json")
        ?? "data/bzss-core/desired-state.json",
    ).trim();

    return {
      scriptPath: configuredScriptPath
        ? (path.isAbsolute(configuredScriptPath)
          ? configuredScriptPath
          : path.resolve(process.cwd(), configuredScriptPath))
        : "",
      saveGamePath,
      desiredStatePath: path.isAbsolute(desiredStatePath)
        ? desiredStatePath
        : path.resolve(process.cwd(), desiredStatePath),
    };
  }

  getReconcileIntervalMs() {
    const configured = Number(this.config?.get?.("bzssCore.reconcileIntervalMs", DEFAULT_RECONCILE_INTERVAL_MS));
    return Number.isFinite(configured) ? Math.max(1000, Math.floor(configured)) : DEFAULT_RECONCILE_INTERVAL_MS;
  }

  async start() {
    if (this.interval) return;
    await this.ensureDesiredLoaded();
    this.interval = setInterval(() => {
      void this.reconcile();
    }, this.getReconcileIntervalMs());
    this.interval.unref?.();
    void this.reconcile();
  }

  async stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    await this.reconcilePromise?.catch(() => {});
  }

  async read() {
    await this.ensureDesiredLoaded();
    const actual = await this.readActual();
    return this.buildSnapshot(actual);
  }

  async write(key, value) {
    return this.setDesired(key, value);
  }

  async setDesired(key, value) {
    if (!BZSS_CORE_BOOL_KEYS.includes(key)) {
      throw new Error(`Unsupported BZSS-Core Bool variable: ${key}`);
    }
    if (typeof value !== "boolean") {
      throw new Error(`BZSS-Core Bool value must be boolean: ${key}`);
    }

    await this.ensureDesiredLoaded();
    this.desired = { ...this.desired, [key]: value };
    this.desiredUpdatedAt = Date.now();
    await this.persistDesired();
    return this.reconcile();
  }

  async reconcile() {
    if (this.reconcilePromise) {
      this.reconcileRequested = true;
      return this.reconcilePromise;
    }

    const current = this.runReconcile();
    const queueTail = current.then(() => undefined, () => undefined);
    this.reconcilePromise = current;
    void queueTail.then(() => {
      if (this.reconcilePromise !== current) return;
      this.reconcilePromise = null;
      if (this.reconcileRequested) {
        this.reconcileRequested = false;
        void this.reconcile();
      }
    });
    return current;
  }

  async runReconcile() {
    await this.ensureDesiredLoaded();
    let actual = await this.readActual();
    if (!actual.online) return this.buildSnapshot(actual);

    // First successful observation becomes the persistent baseline. From then
    // on desired state is authoritative and never overwritten by the SAV.
    if (BZSS_CORE_BOOL_KEYS.some((key) => this.desired[key] === null)) {
      let changed = false;
      const next = { ...this.desired };
      for (const key of BZSS_CORE_BOOL_KEYS) {
        if (next[key] === null && typeof actual.variables[key] === "boolean") {
          next[key] = actual.variables[key];
          changed = true;
        }
      }
      if (changed) {
        this.desired = next;
        this.desiredUpdatedAt = Date.now();
        await this.persistDesired();
      }
    }

    const updates = BZSS_CORE_BOOL_KEYS
      .filter((key) => typeof this.desired[key] === "boolean" && actual.variables[key] !== this.desired[key])
      .map((key) => [key, this.desired[key]]);

    if (!updates.length) return this.buildSnapshot(actual);

    try {
      actual = await this.writeActual(Object.fromEntries(updates));
    } catch (error) {
      actual = offlineSnapshot(error?.message ?? "Failed to reconcile BZSS-Core SaveGame.");
    }

    return this.buildSnapshot(actual);
  }

  async ensureDesiredLoaded() {
    if (this.desiredLoaded) return;
    this.desiredLoaded = true;

    const { desiredStatePath } = this.getPaths();
    try {
      const raw = await fs.readFile(desiredStatePath, "utf8");
      const parsed = JSON.parse(raw);
      this.desired = normalizeValues(parsed?.values ?? parsed?.desired ?? parsed);
      this.desiredUpdatedAt = Number(parsed?.updatedAt) || null;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        this.logger?.warn?.(`[BZSS Core] 读取本地目标配置失败: ${error?.message ?? error}`, {
          operation: "bzssCoreVariableState.loadDesired",
        });
      }
    }
  }

  async persistDesired() {
    const { desiredStatePath } = this.getPaths();
    const directory = path.dirname(desiredStatePath);
    const tempPath = `${desiredStatePath}.${process.pid}.${Date.now()}.tmp`;
    const document = {
      version: 1,
      values: this.desired,
      updatedAt: this.desiredUpdatedAt ?? Date.now(),
    };

    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, desiredStatePath);
  }

  async readActual() {
    const { scriptPath, saveGamePath } = this.getPaths();
    if (!scriptPath || !saveGamePath) {
      const snapshot = offlineSnapshot("BZSS-Core SaveGame path is not configured.");
      this.lastActual = snapshot;
      return snapshot;
    }

    try {
      const payload = await this.runPython([scriptPath, saveGamePath, "--read-core-bools"]);
      const snapshot = normalizeActual(payload);
      this.lastActual = snapshot;
      return snapshot;
    } catch (error) {
      const snapshot = offlineSnapshot(error?.message ?? "Failed to read BZSS-Core SaveGame.");
      this.lastActual = snapshot;
      this.logger?.warn?.(`[BZSS Core] 读取 SaveGame 失败: ${snapshot.error}`, {
        operation: "bzssCoreVariableState.read",
      });
      return snapshot;
    }
  }

  async writeActual(updates) {
    const { scriptPath, saveGamePath } = this.getPaths();
    if (!scriptPath || !saveGamePath) {
      throw new Error("BZSS-Core SaveGame path is not configured.");
    }

    const assignments = BZSS_CORE_BOOL_KEYS
      .filter((key) => typeof updates[key] === "boolean")
      .map((key) => `${key}=${updates[key] ? "1" : "0"}`);
    if (!assignments.length) return this.readActual();

    const payload = await this.runPython([
      scriptPath,
      saveGamePath,
      "--set-core-bools",
      ...assignments,
    ]);
    const snapshot = normalizeActual(payload);
    this.lastActual = snapshot;
    return snapshot;
  }

  async runPython(args) {
    const scriptPath = args[0];
    const output = await this.executor("python", args, {
      cwd: path.dirname(scriptPath),
      timeout: Math.max(1000, Number(this.config?.get?.("bzssCore.timeoutMs", 15000)) || 15000),
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return parseJsonOutput(output.stdout);
  }

  buildSnapshot(actual) {
    const variables = actual?.online ? actual.variables : emptyValues();
    const status = Object.fromEntries(BZSS_CORE_BOOL_KEYS.map((key) => {
      const desired = this.desired[key];
      const current = variables[key];
      const value = actual?.error
        ? "error"
        : desired === null || current === null
          ? "unknown"
          : desired === current
            ? "synced"
            : "drifted";
      return [key, value];
    }));

    return {
      online: actual?.online === true,
      variables,
      desired: this.desired,
      status,
      error: actual?.error ?? null,
      updatedAt: actual?.updatedAt ?? Date.now(),
      desiredUpdatedAt: this.desiredUpdatedAt,
    };
  }
}

function emptyValues() {
  return Object.fromEntries(BZSS_CORE_BOOL_KEYS.map((key) => [key, null]));
}

function normalizeValues(values = {}) {
  return Object.fromEntries(BZSS_CORE_BOOL_KEYS.map((key) => [
    key,
    typeof values?.[key] === "boolean" ? values[key] : null,
  ]));
}

function normalizeActual(payload = {}) {
  return {
    online: payload?.online === true,
    variables: normalizeValues(payload?.variables),
    error: payload?.error ? String(payload.error) : null,
    updatedAt: Number(payload?.updatedAt) || Date.now(),
  };
}

function offlineSnapshot(error) {
  return {
    online: false,
    variables: emptyValues(),
    error: String(error ?? "BZSS-Core SaveGame is unavailable."),
    updatedAt: Date.now(),
  };
}

function parseJsonOutput(stdout) {
  const lines = String(stdout ?? "").trim().split(/\r?\n/).filter(Boolean);
  const line = [...lines].reverse().find((item) => item.trim().startsWith("{"));
  if (!line) throw new Error("ModifySaveGame.py did not return a JSON snapshot.");
  return JSON.parse(line);
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}
