#!/usr/bin/env node
// -*- coding: utf-8 -*-

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const DEFAULT_CONFIG_PATH = "./config.json";

main().catch((error) => {
  console.error("[clear-log-events] ERROR:", error?.stack || error?.message || error);
  process.exit(1);
});

async function main() {
  const configPath = resolveConfigPath(process.argv.slice(2));
  const config = readConfig(configPath);
  const dbFile = resolveDbFile(config);

  ensureServiceStopped();
  ensureDatabaseExists(dbFile);

  const db = await open({
    filename: dbFile,
    driver: sqlite3.Database,
  });

  try {
    await db.exec("PRAGMA foreign_keys = ON;");

    const journalModeRow = await db.get("PRAGMA journal_mode;");
    const isWal = String(journalModeRow?.journal_mode ?? "").toLowerCase() === "wal";

    const beforeCount = await getLogEventCount(db);
    console.log(`[clear-log-events] log_events rows before cleanup: ${beforeCount}`);

    if (isWal) {
      await db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    }

    await db.exec("BEGIN IMMEDIATE;");
    try {
      await db.exec("DELETE FROM log_events;");
      await db.exec("DELETE FROM sqlite_sequence WHERE name = 'log_events';");
      await db.exec("COMMIT;");
    } catch (error) {
      await db.exec("ROLLBACK;");
      throw error;
    }

    if (isWal) {
      await db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    }

    await db.exec("VACUUM;");

    if (isWal) {
      await db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    }

    const afterCount = await getLogEventCount(db);
    const dbSize = fs.statSync(dbFile).size;
    console.log(`[clear-log-events] log_events rows after cleanup: ${afterCount}`);
    console.log(`[clear-log-events] database file size: ${formatBytes(dbSize)} (${dbSize} bytes)`);
  } finally {
    await db.close();
  }
}

function resolveConfigPath(argv) {
  const args = [...argv];
  for (let i = 0; i < args.length; i += 1) {
    const current = args[i];
    if (current === "--config" && args[i + 1]) {
      return path.resolve(process.cwd(), args[i + 1]);
    }
    if (current.startsWith("--config=")) {
      return path.resolve(process.cwd(), current.slice("--config=".length));
    }
  }

  const envPath = String(process.env.BZSS_CONFIG_PATH || "").trim();
  if (envPath) {
    return path.resolve(process.cwd(), envPath);
  }

  return path.resolve(process.cwd(), DEFAULT_CONFIG_PATH);
}

function readConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse config file ${configPath}: ${error.message}`);
  }
}

function resolveDbFile(config) {
  const dbConfig = config?.database ?? {};
  const dbDir = path.resolve(process.cwd(), String(dbConfig.dir ?? "./data"));
  const dbFile = path.resolve(dbDir, String(dbConfig.filename ?? "micepanel.db"));
  return dbFile;
}

function ensureServiceStopped() {
  const command = [
    "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match 'main\\.js' } | ForEach-Object {",
    '    Write-Output ($_.ProcessId.ToString() + "`t" + ($_.CommandLine -replace "\\r?\\n", " "))',
    "}",
  ].join(" ");

  let output = "";
  try {
    output = execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    throw new Error(`Failed to inspect running processes: ${error.message}`);
  }

  if (output) {
    throw new Error(
      "BZSS Panel service is still running. Stop the app first, then rerun this script.\n" +
        output
          .split(/\r?\n/)
          .map((line) => `  ${line}`)
          .join("\n"),
    );
  }
}

function ensureDatabaseExists(dbFile) {
  if (!fs.existsSync(dbFile)) {
    throw new Error(`Database file not found: ${dbFile}`);
  }
}

async function getLogEventCount(db) {
  const row = await db.get("SELECT COUNT(*) AS count FROM log_events;");
  return Number(row?.count ?? 0);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}
