// -*- coding: utf-8 -*-

import { execFile, spawn } from "node:child_process";

const OUTPUT_LIMIT = 16_000;

/**
 * Small, deliberately fixed command boundary for the panel's developer tools.
 * It never accepts an executable or arguments from HTTP requests.
 */
export class DeveloperToolsService {
  constructor({ logger, projectRoot = process.cwd(), executor = execFileAsync, processSpawner = spawn } = {}) {
    this.logger = logger;
    this.projectRoot = projectRoot;
    this.executor = executor;
    this.processSpawner = processSpawner;
    this.running = null;
  }

  async getStatus() {
    const [branch, revision, remote, dirty] = await Promise.all([
      this.runGit(["branch", "--show-current"]),
      this.runGit(["rev-parse", "--short", "HEAD"]),
      this.runGit(["remote", "get-url", "origin"]),
      this.runGit(["status", "--porcelain"]),
    ]);
    return {
      ok: true,
      projectRoot: this.projectRoot,
      branch: branch.stdout.trim() || "HEAD detached",
      revision: revision.stdout.trim() || "unknown",
      remote: remote.stdout.trim() || "origin unavailable",
      dirty: Boolean(dirty.stdout.trim()),
      busy: Boolean(this.running),
      activeOperation: this.running?.operation ?? null,
      pid: process.pid,
    };
  }

  async run(operation) {
    if (this.running) {
      return { ok: false, code: "DeveloperToolBusy", message: `Operation “${this.running.operation}” is already running.` };
    }
    const task = this.runOperation(operation);
    this.running = { operation, startedAt: Date.now() };
    try {
      return await task;
    } finally {
      this.running = null;
    }
  }

  async runOperation(operation) {
    const startedAt = Date.now();
    let result;
    if (operation === "fetch") result = await this.runGit(["fetch", "--prune", "origin"]);
    else if (operation === "pull") result = await this.runGit(["pull", "--ff-only"]);
    else if (operation === "build") result = await this.runCommand("npm", ["run", "client:build"], 10 * 60_000);
    else return { ok: false, code: "UnsupportedDeveloperOperation", message: "Unsupported developer operation." };

    return {
      ok: true,
      operation,
      durationMs: Date.now() - startedAt,
      output: compactOutput(result),
    };
  }

  async scheduleRestart() {
    if (this.running) return { ok: false, code: "DeveloperToolBusy", message: "Wait for the current developer operation to finish." };
    const currentPid = process.pid;
    try {
      if (process.platform === "win32") {
        const projectRoot = this.projectRoot.replace(/'/g, "''");
        const runScript = (this.projectRoot + "\\run.bat").replace(/'/g, "''");
        const script = [
          "$ErrorActionPreference = 'SilentlyContinue'",
          "Start-Sleep -Milliseconds 500",
          `Stop-Process -Id ${currentPid} -Force`,
          // Do not race the old process. Wait until it is actually gone before
          // starting run.bat again, otherwise the old wrapper can still own the port.
          `do { Start-Sleep -Milliseconds 250; \\$old = Get-Process -Id ${currentPid} -ErrorAction SilentlyContinue } while (\\$old)`,
          "Start-Sleep -Milliseconds 1000",
          // Keep the normal Windows entry point, including its configured CPU affinity.
          `Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d', '/c', 'call', '\\'${runScript}\\'') -WorkingDirectory '\\'${projectRoot}\\' -WindowStyle Hidden`,
        ].join("; ");
        const child = this.processSpawner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        child.unref();
      } else {
        const child = this.processSpawner(process.execPath, ["app/main.js"], {
          cwd: this.projectRoot,
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        setTimeout(() => process.exit(0), 800).unref();
      }
      this.logger?.warn?.("Developer tools scheduled a panel restart.", { operation: "developerTools.restart", pid: currentPid });
      return { ok: true, operation: "restart", currentPid, message: "The running Panel process will be stopped and a new process will be started." };
    } catch (error) {
      return { ok: false, code: "RestartScheduleFailed", message: error?.message ?? "Failed to schedule restart." };
    }
  }

  runGit(args) {
    return this.runCommand("git", args, 2 * 60_000);
  }

  async runCommand(file, args, timeout) {
    try {
          const executable = process.platform === "win32" && file === "npm" ? "npm.cmd" : file;
      return await this.executor(executable, args, { cwd: this.projectRoot, timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    } catch (error) {
      const details = compactOutput(error);
      const failure = new Error(details || error?.message || "Developer command failed.");
      failure.code = error?.code ?? "DeveloperCommandFailed";
      throw failure;
    }
  }
}

function compactOutput(result = {}) {
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return output.length > OUTPUT_LIMIT ? `${output.slice(0, OUTPUT_LIMIT)}\n… output truncated` : output;
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
