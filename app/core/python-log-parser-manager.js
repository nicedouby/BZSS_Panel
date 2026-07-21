// -*- coding: utf-8 -*-

import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DIAGNOSTIC_PREFIX = "[BZSS_DIAG] ";
const DEFAULT_WINDOWS_PROCESSOR_AFFINITY_CPUS = [24, 25];

/**
 * Core: PythonLogParserManager
 *
 * 由 JS 程序自动启动 Python 日志解析器。
 */
export class PythonLogParserManager {
  constructor({ config, logger, webStatus }) {
    this.config = config ?? {};
    this.logger = logger;
    this.webStatus = webStatus;
    this.child = null;
    this.stopping = false;
    this.stdoutBuffer = "";
    this.diagnostics = null;
    this.pipeOutput = this.config.pipeOutput ?? true;
    this.killDuplicates = this.config.killDuplicates ?? true;
    this.processorAffinityCpus = normalizeProcessorAffinityCpus(
      this.config.processorAffinityCpus,
      DEFAULT_WINDOWS_PROCESSOR_AFFINITY_CPUS,
    );
  }

  async start() {
    this.stopping = false;

    if (!this.config.enabled || !this.config.autoStart) {
      this.webStatus.set("pythonLogParser", "disabled");
      this.logger.info("Python LogParser auto start disabled.");
      return;
    }

    const pythonExecutable = this.config.pythonExecutable ?? "python";
    const workingDirectory = path.resolve(process.cwd(), String(this.config.workingDirectory ?? ".").trim());
    const scriptPath = String(this.config.scriptPath ?? "./main.py").trim();
    const configPath = String(this.config.configPath ?? "./config.json").trim();
    const scriptAbsolutePath = path.resolve(workingDirectory, scriptPath);
    const configAbsolutePath = path.resolve(workingDirectory, configPath);

    if (this.killDuplicates) {
      await this.terminateDuplicateParsers({
        pythonExecutable,
        scriptPath: scriptAbsolutePath,
        configPath: configAbsolutePath,
      });
    }

    this.webStatus.set("pythonLogParser", "starting");
    this.logger.info(`Starting Python LogParser: ${pythonExecutable} ${scriptPath} ${configPath}`);
    this.logger.info(`Python cwd: ${workingDirectory}`);
    this.stdoutBuffer = "";
    this.diagnostics = null;
    this.pipeOutput = this.config.pipeOutput ?? true;

    this.child = spawn(pythonExecutable, [scriptAbsolutePath, configAbsolutePath], {
      cwd: workingDirectory,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
      },
    });

    this.webStatus.set("pythonLogParser", "running");

    // Always drain both pipes. Leaving a piped child stdout/stderr unread will
    // eventually fill the OS pipe buffer and suspend the Python parser.
    this.child.stdout.on("data", (data) => {
      this.consumeStdout(data);
    });

    this.child.stderr.on("data", (data) => {
      const text = data.toString("utf8").trimEnd();
      if (text && this.pipeOutput) this.logger.warn(`[PY] ${text}`);
    });

    this.child.on("exit", (code, signal) => {
      this.flushStdoutBuffer();
      this.logger.warn(`Python LogParser exited. code=${code} signal=${signal}`);
      this.webStatus.set("pythonLogParser", "stopped");
      this.webStatus.set("logPostPythonDiagnostics", {
        ...(this.diagnostics ?? {}),
        processStatus: "stopped",
        exitedAt: new Date().toISOString(),
        exitCode: code,
        exitSignal: signal,
        processorAffinityCpus: [...this.processorAffinityCpus],
      });
      this.child = null;

      if (!this.stopping && this.config.restartOnExit) {
        setTimeout(() => {
          this.start().catch((error) => {
            this.logger.error(`Failed to restart Python LogParser: ${error.stack ?? error}`);
          });
        }, 2000);
      }
    });

    this.child.on("error", (error) => {
      this.webStatus.set("pythonLogParser", "error");
      this.logger.error(`Python LogParser spawn failed: ${error.stack ?? error}`);
    });

    void this.applyProcessorAffinity(this.child.pid);
  }

  async applyProcessorAffinity(pid) {
    if (process.platform !== "win32" || !this.processorAffinityCpus.length) return false;
    if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;

    try {
      const affinityMask = buildProcessorAffinityMask(this.processorAffinityCpus);
      const command = [
        `$process = Get-Process -Id ${Number(pid)} -ErrorAction Stop;`,
        `$process.ProcessorAffinity = [IntPtr]([Int64]${affinityMask});`,
      ].join(" ");
      await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
      ], {
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 256 * 1024,
      });
      this.logger.info(`Python LogParser affinity set. pid=${pid} cpus=${this.processorAffinityCpus.join(",")}`);
      return true;
    } catch (error) {
      this.logger.warn(`Unable to set Python LogParser affinity pid=${pid} cpus=${this.processorAffinityCpus.join(",")}: ${error.message}`);
      return false;
    }
  }

  async terminateDuplicateParsers({ pythonExecutable, scriptPath, configPath }) {
    const candidates = await this.listPythonProcesses();
    const expectedScript = normalizeProcessText(scriptPath);
    const expectedConfig = normalizeProcessText(configPath);
    const scriptName = normalizeProcessText(path.basename(scriptPath));
    const configName = normalizeProcessText(path.basename(configPath));
    const currentChildPid = this.child?.pid ?? null;

    for (const processInfo of candidates) {
      const pid = Number(processInfo.pid);
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || pid === currentChildPid) continue;

      const commandLine = normalizeProcessText(processInfo.commandLine);
      const executableName = normalizeProcessText(processInfo.name || pythonExecutable);
      const matchesScript = commandLine.includes(expectedScript) || commandLine.includes(scriptName);
      const matchesConfig = commandLine.includes(expectedConfig) || commandLine.includes(configName);
      if (!matchesScript || !matchesConfig) continue;

      this.logger.warn(`Stopping duplicate LogPost process pid=${pid}: ${processInfo.commandLine || executableName}`);
      await this.terminateProcess(pid);
    }
  }

  async listPythonProcesses() {
    if (process.platform === "win32") {
      try {
        const { stdout } = await execFileAsync("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          "Get-CimInstance Win32_Process | Where-Object { @('python.exe','pythonw.exe') -contains $_.Name.ToLower() } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress",
        ], { windowsHide: true, maxBuffer: 1024 * 1024 });
        const parsed = JSON.parse(String(stdout || "null"));
        return Array.isArray(parsed) ? parsed.map(normalizeProcessInfo) : parsed ? [normalizeProcessInfo(parsed)] : [];
      } catch (error) {
        this.logger.warn(`Unable to inspect existing Python processes: ${error.message}`);
        return [];
      }
    }

    try {
      const { stdout } = await execFileAsync("ps", ["-eo", "pid=,comm=,args="], { maxBuffer: 1024 * 1024 });
      return String(stdout || "").split(/\r?\n/u).map((line) => {
        const match = line.trim().match(/^(\d+)\s+(\S+)\s*(.*)$/u);
        return match ? normalizeProcessInfo({ pid: match[1], name: match[2], commandLine: match[3] }) : null;
      }).filter(Boolean);
    } catch (error) {
      this.logger.warn(`Unable to inspect existing Python processes: ${error.message}`);
      return [];
    }
  }

  async terminateProcess(pid) {
    try {
      if (process.platform === "win32") {
        await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
      } else {
        process.kill(pid, "SIGTERM");
      }
    } catch (error) {
      this.logger.warn(`Unable to stop duplicate LogPost process pid=${pid}: ${error.message}`);
    }
  }

  consumeStdout(data) {
    this.stdoutBuffer += data.toString("utf8");
    const lines = this.stdoutBuffer.split(/\r?\n/u);
    this.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      this.consumeStdoutLine(line);
    }
    // Bound an unterminated third-party line so a broken producer cannot grow memory forever.
    if (this.stdoutBuffer.length > 1024 * 1024) {
      this.logger.warn("Python stdout contained an oversized unterminated line; truncating buffer.");
      this.stdoutBuffer = this.stdoutBuffer.slice(-64 * 1024);
    }
  }

  consumeStdoutLine(line) {
    const text = String(line ?? "").trimEnd();
    if (!text) return;
    if (text.startsWith(DIAGNOSTIC_PREFIX)) {
      try {
        const payload = JSON.parse(text.slice(DIAGNOSTIC_PREFIX.length));
        this.diagnostics = {
          ...payload,
          receivedAt: new Date().toISOString(),
          processStatus: "running",
          processorAffinityCpus: [...this.processorAffinityCpus],
        };
        this.webStatus.set("logPostPythonDiagnostics", this.diagnostics);
      } catch (error) {
        this.logger.warn(`Invalid Python LogPost diagnostic payload: ${error.message}`);
      }
      return;
    }
    if (this.pipeOutput) this.logger.info(`[PY] ${text}`);
  }

  flushStdoutBuffer() {
    const text = this.stdoutBuffer;
    this.stdoutBuffer = "";
    if (text) this.consumeStdoutLine(text);
  }

  getDiagnostics() {
    return this.diagnostics
      ? { ...this.diagnostics, processorAffinityCpus: [...this.processorAffinityCpus] }
      : null;
  }

  async stop() {
    this.stopping = true;

    if (!this.child) return;

    this.logger.info("Stopping Python LogParser...");
    const child = this.child;

    await new Promise((resolve) => {
      child.once("exit", resolve);
      child.kill("SIGTERM");

      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        resolve();
      }, 3000);
    });

    this.child = null;
  }

  async restart() {
    this.logger.info("Restarting Python LogParser...");
    await this.stop();
    this.stopping = false;
    await this.start();
  }
}

function normalizeProcessorAffinityCpus(value, fallback = []) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,;]+/u)
      : [];
  const cpus = [...new Set(source
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 0 && item < 64))];
  if (cpus.length > 0) return cpus;
  return [...fallback];
}

function buildProcessorAffinityMask(cpus) {
  let mask = 0n;
  for (const cpu of cpus) {
    mask |= 1n << BigInt(cpu);
  }
  if (mask <= 0n) throw new Error("processor affinity mask is empty");
  return mask.toString(10);
}

function normalizeProcessText(value) {
  return String(value ?? "").replaceAll("\\", "/").replaceAll('"', "").trim().toLowerCase();
}

function normalizeProcessInfo(value = {}) {
  return {
    pid: value.ProcessId ?? value.pid,
    name: value.Name ?? value.name ?? "",
    commandLine: value.CommandLine ?? value.commandLine ?? "",
  };
}
