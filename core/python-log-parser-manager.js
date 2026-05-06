// -*- coding: utf-8 -*-

import path from "node:path";
import { spawn } from "node:child_process";

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
  }

  async start() {
    if (!this.config.enabled || !this.config.autoStart) {
      this.webStatus.set("pythonLogParser", "disabled");
      this.logger.info("Python LogParser auto start disabled.");
      return;
    }

    const pythonExecutable = this.config.pythonExecutable ?? "python";
    const workingDirectory = path.resolve(process.cwd(), this.config.workingDirectory ?? ".");
    const scriptPath = this.config.scriptPath ?? "./main.py";
    const configPath = this.config.configPath ?? "./config.json";

    this.webStatus.set("pythonLogParser", "starting");
    this.logger.info(`Starting Python LogParser: ${pythonExecutable} ${scriptPath} ${configPath}`);
    this.logger.info(`Python cwd: ${workingDirectory}`);

    this.child = spawn(pythonExecutable, [scriptPath, configPath], {
      cwd: workingDirectory,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false,
    });

    this.webStatus.set("pythonLogParser", "running");

    if (this.config.pipeOutput ?? true) {
      this.child.stdout.on("data", (data) => {
        const text = data.toString("utf8").trimEnd();
        if (text) this.logger.info(`[PY] ${text}`);
      });

      this.child.stderr.on("data", (data) => {
        const text = data.toString("utf8").trimEnd();
        if (text) this.logger.warn(`[PY] ${text}`);
      });
    }

    this.child.on("exit", (code, signal) => {
      this.logger.warn(`Python LogParser exited. code=${code} signal=${signal}`);
      this.webStatus.set("pythonLogParser", "stopped");
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
}
