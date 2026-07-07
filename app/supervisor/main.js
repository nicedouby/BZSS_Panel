#!/usr/bin/env node
// -*- coding: utf-8 -*-

import { spawn } from "node:child_process";
import path from "node:path";

const services = new Map();
let shuttingDown = false;

function startService(name, relativeScript, restartDelayMs) {
  const scriptPath = path.resolve(process.cwd(), relativeScript);
  const child = spawn(process.execPath, [scriptPath], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });
  services.set(name, { child, relativeScript, restartDelayMs });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`[supervisor] ${name} exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    setTimeout(() => {
      if (!shuttingDown) {
        startService(name, relativeScript, restartDelayMs);
      }
    }, restartDelayMs);
  });
}

function shutdown() {
  shuttingDown = true;
  for (const { child } of services.values()) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
  setTimeout(() => process.exit(0), 1000);
}

startService("core-service", "app/core-service/main.js", 5000);
startService("web-service", "app/web-service/main.js", 1000);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
