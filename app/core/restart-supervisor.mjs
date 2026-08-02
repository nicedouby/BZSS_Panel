// -*- coding: utf-8 -*-

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const payload = JSON.parse(process.argv[2] ?? "{}");
const projectRoot = path.resolve(String(payload.projectRoot ?? process.cwd()));
const currentPid = Number(payload.currentPid);

if (!Number.isInteger(currentPid) || currentPid <= 0) {
  process.exitCode = 2;
  console.error("[developer-restart] Invalid current PID.");
  process.exit();
}

await delay(700);

if (process.platform === "win32") {
  await terminateWindowsProcess(currentPid);
  await waitForWindowsProcessExit(currentPid, 20_000);
  await delay(1_000);
  await startWindowsProject(projectRoot);
} else {
  await terminatePosixProcess(currentPid);
  await delay(1_000);
  await startPosixProject(projectRoot);
}

function terminateWindowsProcess(pid) {
  return execFileAsync("taskkill.exe", ["/PID", String(pid), "/F"]);
}

async function waitForWindowsProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await execFileAsync("tasklist.exe", ["/FI", `PID eq ${pid}`], true);
    const stillRunning = String(result.stdout ?? "").includes(String(pid));
    if (!stillRunning) return;
    await delay(250);
  }
  throw new Error(`Panel process ${pid} did not exit before timeout.`);
}

async function startWindowsProject(root) {
  const runScript = path.join(root, "run.bat");
  if (fs.existsSync(runScript)) {
    const child = spawn("cmd.exe", ["/d", "/c", "call", runScript], {
      cwd: root,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
    return;
  }

  const npm = process.env.ComSpec ? "npm.cmd" : "npm";
  const child = spawn(npm, ["start"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
}

async function terminatePosixProcess(pid) {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function startPosixProject(root) {
  const child = spawn(process.execPath, ["app/main.js"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function execFileAsync(file, args, ignoreError = false) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error && !ignoreError) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
