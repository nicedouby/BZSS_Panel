// -*- coding: utf-8 -*-

import path from "node:path";
import { execFile } from "node:child_process";

export const BZSS_CORE_BOOL_KEYS = [
  "LocalVOIPEnable",
  "OutputBZSSObj",
  "CheckingNoob",
];

export class BzssCoreVariableStateService {
  constructor({ config, logger, executor = execFileAsync } = {}) {
    this.config = config;
    this.logger = logger;
    this.executor = executor;
    this.reconcilePromise = null;
  }

  getPaths() {
    const scriptPath = String(this.config?.get?.("bzssCore.modifyScriptPath")
      ?? this.config?.get?.("bzssCore.modifySaveGamePath")
      ?? "").trim();
    const saveGamePath = String(this.config?.get?.("bzssCore.remoteSaveGamePath")
      ?? this.config?.get?.("bzssCore.saveGamePath")
      ?? "").trim();

    return {
      scriptPath: path.isAbsolute(scriptPath) ? scriptPath : path.resolve(process.cwd(), scriptPath),
      saveGamePath,
    };
  }

  async read() {
    const { scriptPath, saveGamePath } = this.getPaths();
    if (!scriptPath || !saveGamePath) {
      return {
        online: false,
        variables: Object.fromEntries(BZSS_CORE_BOOL_KEYS.map((key) => [key, null])),
        error: "BZSS-Core SaveGame path is not configured.",
        updatedAt: Date.now(),
      };
    }

    try {
      const output = await this.executor("python", [
        scriptPath,
        saveGamePath,
        "--read-core-bools",
      ], {
        cwd: path.dirname(scriptPath),
        timeout: Math.max(1000, Number(this.config?.get?.("bzssCore.timeoutMs", 15000)) || 15000),
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });

      const payload = parseJsonOutput(output.stdout);
      return normalizeSnapshot(payload);
    } catch (error) {
      this.logger?.warn?.(`[BZSS Core] 读取 SaveGame 失败: ${error?.message ?? error}`, {
        operation: "bzssCoreVariableState.read",
      });
      return {
        online: false,
        variables: Object.fromEntries(BZSS_CORE_BOOL_KEYS.map((key) => [key, null])),
        error: error?.message ?? "Failed to read BZSS-Core SaveGame.",
        updatedAt: Date.now(),
      };
    }
  }

  async write(key, value) {
    if (!BZSS_CORE_BOOL_KEYS.includes(key)) {
      throw new Error(`Unsupported BZSS-Core Bool variable: ${key}`);
    }

    if (typeof value !== "boolean") {
      throw new Error(`BZSS-Core Bool value must be boolean: ${key}`);
    }

    const run = async () => {
      const { scriptPath, saveGamePath } = this.getPaths();
      if (!scriptPath || !saveGamePath) {
        throw new Error("BZSS-Core SaveGame path is not configured.");
      }

      const output = await this.executor("python", [
        scriptPath,
        saveGamePath,
        "--set-core-bool",
        key,
        value ? "1" : "0",
      ], {
        cwd: path.dirname(scriptPath),
        timeout: Math.max(1000, Number(this.config?.get?.("bzssCore.timeoutMs", 15000)) || 15000),
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });

      return normalizeSnapshot(parseJsonOutput(output.stdout));
    };

    // Serialize writes so two UI clicks cannot overwrite each other's SAV.
    const previous = this.reconcilePromise ?? Promise.resolve();
    const current = previous.catch(() => {}).then(run);
    this.reconcilePromise = current.finally(() => {
      if (this.reconcilePromise === current) this.reconcilePromise = null;
    });
    return current;
  }
}

function parseJsonOutput(stdout) {
  const lines = String(stdout ?? "").trim().split(/\r?\n/).filter(Boolean);
  const line = [...lines].reverse().find((item) => item.trim().startsWith("{"));
  if (!line) throw new Error("ModifySaveGame.py did not return a JSON snapshot.");
  return JSON.parse(line);
}

function normalizeSnapshot(payload = {}) {
  const variables = Object.fromEntries(
    BZSS_CORE_BOOL_KEYS.map((key) => [
      key,
      typeof payload?.variables?.[key] === "boolean" ? payload.variables[key] : null,
    ]),
  );

  return {
    online: payload?.online === true,
    variables,
    error: payload?.error ? String(payload.error) : null,
    updatedAt: Number(payload?.updatedAt) || Date.now(),
  };
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
