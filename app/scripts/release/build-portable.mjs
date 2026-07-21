#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..", "..", "..");
const releaseRoot = path.join(workspaceRoot, "release", "portable");
const appRoot = path.join(releaseRoot, "app");

const rootDirectories = [
  "config",
  "data",
  "LogPost",
  "maps",
];

const rootCopies = [
  { source: "config.json", target: "config.json" },
  { source: "config.example.json", target: "config.example.json" },
  { source: "web-client/dist", target: "web-client/dist", required: true },
  { source: "web-client/public", target: "web-client/public" },
  { source: "support/runtime-assets", target: "runtime-assets" },
  { source: "support/reference-data", target: "reference-data" },
];

const appDirectories = [
  { source: "app/core", target: "app/core" },
  { source: "app/modules", target: "app/modules" },
  { source: "app/plugins", target: "app/plugins" },
  { source: "app/contracts", target: "app/contracts" },
  { source: "app/domain", target: "app/domain" },
  { source: "app/repositories", target: "app/repositories" },
  { source: "app/scripts", target: "app/scripts" },
  { source: "app/web", target: "app/web" },
  { source: "node_modules", target: "app/node_modules" },
];

const appFiles = [
  { source: "app/main.js", target: "app/main.js" },
  { source: "package-lock.json", target: "app/package-lock.json" },
];

const appCopies = [
  { source: "web-client/src/shared", target: "app/web-client/src/shared", required: true },
];

async function main() {
  await ensureRequiredSources();
  await fs.rm(releaseRoot, { recursive: true, force: true });
  await fs.mkdir(appRoot, { recursive: true });

  for (const directory of rootDirectories) {
    await copyIfExists(directory, directory);
  }

  for (const entry of rootCopies) {
    await copyIfExists(entry.source, entry.target, { required: entry.required });
  }

  for (const entry of appDirectories) {
    await copyIfExists(entry.source, entry.target);
  }

  for (const entry of appFiles) {
    await copyIfExists(entry.source, entry.target);
  }

  for (const entry of appCopies) {
    await copyIfExists(entry.source, entry.target, { required: entry.required });
  }

  await writePortableRunBat();
  await writePortableReadme();
  await writePortablePackageJson();

  console.log(`Portable release prepared at ${releaseRoot}`);
}

async function ensureRequiredSources() {
  const required = [
    "config.json",
    "app/main.js",
    "package-lock.json",
    "node_modules",
    "web-client/dist",
  ];

  for (const relativePath of required) {
    const sourcePath = path.join(workspaceRoot, relativePath);
    try {
      await fs.access(sourcePath);
    } catch {
      throw new Error(`Required release source is missing: ${relativePath}`);
    }
  }
}

async function copyIfExists(sourceRelativePath, targetRelativePath, options = {}) {
  const sourcePath = path.join(workspaceRoot, sourceRelativePath);
  const targetPath = path.join(releaseRoot, targetRelativePath);
  try {
    await fs.access(sourcePath);
  } catch {
    if (options.required) {
      throw new Error(`Required release source is missing: ${sourceRelativePath}`);
    }
    return;
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.cp(sourcePath, targetPath, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
}

function toPosixPath(value) {
  return String(value).replace(/\\/g, "/");
}

async function writePortableRunBat() {
  const filePath = path.join(releaseRoot, "run.bat");
  const content = [
    "@echo off",
    "setlocal",
    "cd /d \"%~dp0\"",
    "",
    "rem Windows logical CPU indices are zero-based.",
    "rem CPU 26 + CPU 27 = affinity mask 0x0C000000.",
    "set \"NODE_AFFINITY=C000000\"",
    "",
    "echo [BZSS] Starting Node on logical CPUs 26 and 27...",
    "start \"BZSS Panel Node\" /b /wait /affinity %NODE_AFFINITY% node app\\main.js",
    "set \"EXIT_CODE=%ERRORLEVEL%\"",
    "",
    "if not \"%EXIT_CODE%\"==\"0\" (",
    "  echo [BZSS] Node exited with code %EXIT_CODE%.",
    ")",
    "",
    "pause",
    "exit /b %EXIT_CODE%",
    "",
  ].join("\r\n");
  await fs.writeFile(filePath, content, "utf8");
}

async function writePortableReadme() {
  const filePath = path.join(releaseRoot, "README.txt");
  const content = [
    "BZSS Panel portable release",
    "",
    "Structure:",
    "- run.bat: starts the backend from the release root on logical CPUs 26 and 27",
    "- config.json, data, LogPost, maps, web-client: runtime files kept at the top level",
    "- app/: backend source code, helper scripts, and Node.js dependencies",
    "",
    "Usage:",
    "1. Edit config.json if needed.",
    "2. Double-click run.bat.",
    "",
    "Notes:",
    "- The Python LogPost child process is pinned separately to logical CPUs 24 and 25 on Windows.",
    "- This folder is generated by `npm run release:portable` from the development workspace.",
    "- The runtime still uses the release root as its working directory, so existing relative paths remain valid.",
    "",
  ].join("\r\n");
  await fs.writeFile(filePath, content, "utf8");
}

async function writePortablePackageJson() {
  const sourcePath = path.join(workspaceRoot, "package.json");
  const raw = await fs.readFile(sourcePath, "utf8");
  const pkg = JSON.parse(raw);
  const portablePkg = {
    name: pkg.name,
    version: pkg.version,
    private: true,
    description: `${pkg.description} (portable runtime)`,
    type: pkg.type,
    scripts: {
      start: "node main.js",
      "auth:user:add": "node scripts/auth-users.js add",
      "auth:user:list": "node scripts/auth-users.js list",
      "auth:user:disable": "node scripts/auth-users.js disable",
      "auth:user:enable": "node scripts/auth-users.js enable",
      "auth:user:reset-password": "node scripts/auth-users.js reset-password",
      "auth:user:delete": "node scripts/auth-users.js delete",
      "maintenance:clear-log-events": "node scripts/maintenance/clear_log_events.js",
    },
    dependencies: pkg.dependencies ?? {},
    engines: pkg.engines ?? {},
  };

  const targetPath = path.join(appRoot, "package.json");
  await fs.writeFile(targetPath, `${JSON.stringify(portablePkg, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(`[portable-release] ${error.message}`);
  process.exit(1);
});
