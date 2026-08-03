// -*- coding: utf-8 -*-

import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
      nodePath: process.execPath,
      workingDirectory: process.cwd(),
      entrypoint: process.argv[1] ?? null,
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
    else if (operation === "build") result = await this.runShellCommand("npm run client:build", 10 * 60_000);
    else return { ok: false, code: "UnsupportedDeveloperOperation", message: "Unsupported developer operation." };

    return {
      ok: true,
      operation,
      durationMs: Date.now() - startedAt,
      output: compactOutput(result),
    };
  }

  async scheduleRestart() {
    if (this.running) {
      return { ok: false, code: "DeveloperToolBusy", message: "Wait for the current developer operation to finish." };
    }

    const currentPid = process.pid;
    const supervisorPath = fileURLToPath(new URL("./restart-supervisor.mjs", import.meta.url));
    const payload = JSON.stringify({
      currentPid,
      projectRoot: this.projectRoot,
    });

    try {
      // Use a standalone Node supervisor instead of passing a large PowerShell
      // command through spawn(). This avoids Windows EINVAL argument parsing and
      // lets the supervisor survive termination of this Panel process.
      const child = await spawnDetachedAndWait(this.processSpawner, process.execPath, [supervisorPath, payload], {
        cwd: this.projectRoot,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });

      this.logger?.warn?.("Developer tools scheduled a panel restart.", {
        operation: "developerTools.restart",
        pid: currentPid,
        supervisorPid: child.pid ?? null,
      });
      return {
        ok: true,
        operation: "restart",
        currentPid,
        supervisorPid: child.pid ?? null,
        workingDirectory: this.projectRoot,
        message: "A standalone supervisor will stop this process and start the Panel again from the detected project directory.",
      };
    } catch (error) {
      return {
        ok: false,
        code: "RestartScheduleFailed",
        message: error?.message ?? "Failed to schedule restart.",
      };
    }
  }

  runGit(args) {
    return this.runCommand("git", args, 2 * 60_000);
  }

  runShellCommand(command, timeout) {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === "win32";
      const shellFile = isWindows ? (process.env.ComSpec || "cmd.exe") : "/bin/sh";
      const shellArgs = isWindows
        ? ["/d", "/s", "/c", command]
        : ["-lc", command];

      let stdout = "";
      let stderr = "";
      let settled = false;
      const child = this.processSpawner(shellFile, shellArgs, {
        cwd: this.projectRoot,
        windowsHide: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };

      const timer = setTimeout(() => {
        child.kill();
        const error = new Error(
          `Shell command timed out after ${timeout} ms.\n${stdout}\n${stderr}`.trim(),
        );
        error.code = "ETIMEDOUT";
        finish(reject, error);
      }, timeout);

      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.once("error", (error) => {
        clearTimeout(timer);
        error.stdout = stdout;
        error.stderr = stderr;
        finish(reject, error);
      });

      child.once("close", (code, signal) => {
        clearTimeout(timer);
        const result = { stdout, stderr };
        if (code === 0) {
          finish(resolve, result);
          return;
        }

        const error = new Error(
          compactOutput(result) ||
            `Shell command failed with exit code ${code ?? "unknown"}${signal ? ` (signal ${signal})` : ""}.`,
        );
        error.code = code ?? 1;
        error.stdout = stdout;
        error.stderr = stderr;
        finish(reject, error);
      });
    });
  }

  async runCommand(file, args, timeout) {
    try {
      const executable = process.platform === "win32" && file === "npm" ? "npm.cmd" : file;
      return await this.executor(executable, args, {
        cwd: this.projectRoot,
        timeout,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
      });
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

function spawnDetachedAndWait(processSpawner, file, args, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = processSpawner(file, args, options);
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    const onError = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const onSpawn = () => {
      if (settled) return;
      settled = true;
      child.removeListener?.("error", onError);
      child.unref?.();
      resolve(child);
    };

    child.once?.("error", onError);
    child.once?.("spawn", onSpawn);
    if (!child.once) {
      settled = true;
      reject(new Error("Restart supervisor did not return a ChildProcess."));
    }
  });
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
