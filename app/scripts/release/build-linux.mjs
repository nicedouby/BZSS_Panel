#!/usr/bin/env node

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, "..", "..", "..");
const linuxReleaseRoot = path.join(workspaceRoot, "release", "linux");
const releaseRoot = path.join(linuxReleaseRoot, "source");
const singleRoot = path.join(linuxReleaseRoot, "single");
const appRoot = path.join(releaseRoot, "app");

async function main() {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("Build the Linux x64 release on a Linux x64 machine so native dependencies match the target.");
  }

  if (!process.argv.includes("--single-only")) {
    for (const required of ["config/panel", "app/main.js", "package-lock.json", "web-client/dist"]) {
      await assertExists(path.join(workspaceRoot, required), required);
    }
    await buildSourceRelease();
  }

  await assertExists(releaseRoot, "release/linux/source (build the source release first)");
  await buildSingleRelease();
}

async function buildSourceRelease() {
  await fs.rm(releaseRoot, { recursive: true, force: true });
  await fs.mkdir(appRoot, { recursive: true });
  await fs.mkdir(path.join(releaseRoot, "data"), { recursive: true });

  for (const directory of ["config/panel", "web-client/dist", "web-client/public", "support/runtime-assets", "support/reference-data"]) {
    await copyIfExists(directory, directory);
  }
  for (const file of ["config/squad_name_nature_rules.json", "config/squad_name_policy.json", "config/tactical-report.json", "config/victim-damage-display-weapons.json"]) {
    await copyIfExists(file, file);
  }

  await copyLogPost();
  for (const directory of ["core", "modules", "plugins", "contracts", "domain", "repositories", "scripts", "services", "tasks", "web", "workers"]) {
    await copyIfExists(path.join("app", directory), path.join("app", directory));
  }
  await copyIfExists("app/main.js", "app/main.js");
  await copyIfExists("web-client/src/shared", "web-client/src/shared");

  await writeRuntimePackageFiles();
  await run("npm", ["ci", "--omit=dev", "--ignore-scripts=false"], { cwd: appRoot });

  const runtimeDirectory = path.join(appRoot, "runtime");
  await fs.mkdir(runtimeDirectory, { recursive: true });
  const runtimePath = path.join(runtimeDirectory, "node");
  await fs.copyFile(process.execPath, runtimePath);
  await fs.chmod(runtimePath, 0o755);

  await writeRunScript();
  await writeReadme();
  console.log(`Linux x64 source release prepared at ${releaseRoot}`);
}

async function buildSingleRelease() {
  await fs.rm(singleRoot, { recursive: true, force: true });
  await fs.mkdir(singleRoot, { recursive: true });

  const buildId = `${Date.now().toString(36)}-${process.pid.toString(36)}`;
  const executablePath = path.join(singleRoot, "BZSSPanel-Linux-x64.run");
  const launcher = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "root=\"$(cd -- \"$(dirname -- \"$(readlink -f -- \"$0\")\")\" && pwd)\"",
    "cd -- \"$root\"",
    `build_id=${buildId}`,
    "marker=\"$root/data/bzss-panel-single-release.txt\"",
    "if [[ ! -f \"$marker\" ]] || [[ \"$(cat -- \"$marker\")\" != \"$build_id\" ]]; then",
    "  stage=\"$(mktemp -d \"$root/.bzss-panel-stage.XXXXXX\")\"",
    "  trap 'rm -rf -- \"$stage\"' EXIT",
    "  payload_line=\"$(awk '$0 == \"__BZSS_PAYLOAD_START__\" { print NR + 1; exit }' \"$0\")\"",
    "  if [[ -z \"$payload_line\" ]]; then echo '[BZSS] Embedded release payload is missing.' >&2; exit 1; fi",
    "  tail -n +\"$payload_line\" \"$0\" | tar -xf - -C \"$stage\"",
    "  for item in app support web-client; do",
    "    if [[ -e \"$stage/$item\" ]]; then cp -a -- \"$stage/$item\" \"$root/\"; fi",
    "  done",
    "  mkdir -p -- \"$root/config\" \"$root/data\" \"$root/LogPost\"",
    "  if [[ -d \"$stage/config\" ]]; then cp -an -- \"$stage/config/.\" \"$root/config/\"; fi",
    "  if [[ -d \"$stage/LogPost/bzss_parser\" ]]; then cp -a -- \"$stage/LogPost/bzss_parser\" \"$root/LogPost/\"; fi",
    "  find \"$stage/LogPost\" -maxdepth 1 -type f -name '*.py' -exec cp -f -- {} \"$root/LogPost/\" \\;",
    "  if [[ ! -e \"$root/LogPost/config.json\" ]]; then cp -- \"$stage/LogPost/config.json\" \"$root/LogPost/config.json\"; fi",
    "  cp -f -- \"$stage/run-bzss-panel.sh\" \"$root/run-bzss-panel.sh\"",
    "  if [[ ! -e \"$root/BZSSPanel-README.txt\" ]]; then cp -- \"$stage/BZSSPanel-README.txt\" \"$root/BZSSPanel-README.txt\"; fi",
    "  chmod +x -- \"$root/run-bzss-panel.sh\"",
    "  printf '%s\\n' \"$build_id\" > \"$marker\"",
    "  rm -rf -- \"$stage\"",
    "  trap - EXIT",
    "fi",
    "exec ./app/runtime/node ./app/main.js \"$@\"",
    "__BZSS_PAYLOAD_START__",
    "",
  ].join("\n");

  await fs.writeFile(executablePath, launcher, "utf8");
  await fs.chmod(executablePath, 0o755);
  await appendTarPayload(executablePath);
  console.log(`Linux x64 single-file release prepared at ${executablePath}`);
}

async function appendTarPayload(executablePath) {
  await new Promise((resolve, reject) => {
    const output = createWriteStream(executablePath, { flags: "a" });
    const child = spawn("tar", ["-cf", "-", "-C", releaseRoot, "."], { stdio: ["ignore", "pipe", "inherit"] });
    let childClosed = false;
    let outputFinished = false;
    const finish = () => {
      if (childClosed && outputFinished) resolve();
    };
    child.once("error", reject);
    child.stdout.pipe(output);
    output.once("error", reject);
    output.once("finish", () => {
      outputFinished = true;
      finish();
    });
    child.once("close", (code, signal) => {
      if (code !== 0) reject(new Error(`tar failed (${signal ?? `exit ${code}`}).`));
      else {
        childClosed = true;
        finish();
      }
    });
  });
}

async function copyLogPost() {
  const source = path.join(workspaceRoot, "LogPost");
  const target = path.join(releaseRoot, "LogPost");
  await fs.mkdir(target, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (entry.name === "bzss_parser" && entry.isDirectory()) {
      await fs.cp(path.join(source, entry.name), path.join(target, entry.name), { recursive: true });
    } else if (entry.isFile() && (entry.name.endsWith(".py") || entry.name === "config.json")) {
      await fs.copyFile(path.join(source, entry.name), path.join(target, entry.name));
    }
  }

  const configPath = path.join(target, "config.json");
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  config.log_file = "./SquadGame/Saved/Logs/SquadGame.log";
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const panelConfigPath = path.join(releaseRoot, "config", "panel", "logpost.json");
  const panelConfig = JSON.parse(await fs.readFile(panelConfigPath, "utf8"));
  panelConfig.pythonLogParser ??= {};
  panelConfig.pythonLogParser.pythonExecutable = "python3";
  await fs.writeFile(panelConfigPath, `${JSON.stringify(panelConfig, null, 2)}\n`, "utf8");
}

async function writeRuntimePackageFiles() {
  const sourcePackage = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf8"));
  const runtimePackage = {
    name: sourcePackage.name,
    version: sourcePackage.version,
    private: true,
    type: "module",
    dependencies: sourcePackage.dependencies ?? {},
    devDependencies: sourcePackage.devDependencies ?? {},
    allowScripts: sourcePackage.allowScripts ?? {},
  };
  await fs.writeFile(path.join(appRoot, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`, "utf8");
  await fs.copyFile(path.join(workspaceRoot, "package-lock.json"), path.join(appRoot, "package-lock.json"));
}

async function writeRunScript() {
  const filePath = path.join(releaseRoot, "run-bzss-panel.sh");
  const content = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "cd -- \"$(dirname -- \"$(readlink -f -- \"$0\")\")\"",
    "exec ./app/runtime/node ./app/main.js \"$@\"",
    "",
  ].join("\n");
  await fs.writeFile(filePath, content, "utf8");
  await fs.chmod(filePath, 0o755);
}

async function writeReadme() {
  const content = [
    "BZSS Panel Linux x64 release",
    "",
    "This package is laid out to merge into the Squad dedicated-server root.",
    "Copy its contents into that directory, preserving existing server files, then run ./run-bzss-panel.sh.",
    "",
    "The package includes Node.js and Linux native dependencies. Install Python 3 on the server for LogPost and BZSS-Core scripts.",
    "Runtime data and logs are stored beside the Squad files in data/ and LogPost/.",
    "Edit config/panel/*.json and provide any required BZSS_* environment variables before starting.",
    "",
  ].join("\n");
  await fs.writeFile(path.join(releaseRoot, "BZSSPanel-README.txt"), content, "utf8");
}

async function copyIfExists(sourceRelativePath, targetRelativePath) {
  const source = path.join(workspaceRoot, sourceRelativePath);
  try {
    await fs.access(source);
  } catch {
    return;
  }
  const target = path.join(releaseRoot, targetRelativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true, force: true });
}

async function assertExists(target, relativePath) {
  try {
    await fs.access(target);
  } catch {
    throw new Error(`Required release source is missing: ${relativePath}`);
  }
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal ?? `exit ${code}`}).`));
    });
  });
}

main().catch((error) => {
  console.error(`[linux-release] ${error.message}`);
  process.exit(1);
});
