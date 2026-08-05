import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import process from "node:process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const STABLE_NODE_MIN_MAJOR = 24;
const STABLE_NODE_MAX_MAJOR = 25;

export function createStableNodeToolEnv(source = process.env) {
  const env = { ...source };

  // Do not inherit user-level flags into Vite/vue-tsc child processes.
  delete env.NODE_OPTIONS;

  // Avoid the Node 26 module compile-cache disposal crash during large builds.
  env.NODE_DISABLE_COMPILE_CACHE = "1";

  return env;
}

export function createNodeToolExecArgs({
  entry,
  args = [],
  nodeArgs = [],
  maxOldSpaceSizeMb = 4096,
  nodeMajor = getNodeMajor(process.version),
} = {}) {
  const normalizedEntry = String(entry ?? "").trim();

  if (!normalizedEntry) {
    throw new Error("Node tool entry is required.");
  }

  const heapSize = Number.isFinite(Number(maxOldSpaceSizeMb))
    ? Math.max(1024, Math.round(Number(maxOldSpaceSizeMb)))
    : 4096;

  const extraNodeArgs = Array.isArray(nodeArgs)
    ? nodeArgs
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    : [];

  const runtimeArgs = [
    `--max-old-space-size=${heapSize}`,
  ];

  // Keep this workaround only when the selected child runtime is Node 26+.
  if (process.platform === "win32" && Number(nodeMajor) >= 26) {
    runtimeArgs.push("--no-maglev");
  }

  for (const arg of extraNodeArgs) {
    if (!runtimeArgs.includes(arg)) {
      runtimeArgs.push(arg);
    }
  }

  const toolArgs = Array.isArray(args)
    ? args.map((value) => String(value))
    : [];

  return [
    ...runtimeArgs,
    normalizedEntry,
    ...toolArgs,
  ];
}

export async function runNodeTool({
  label,
  entry,
  args = [],
  nodeArgs = [],
  maxOldSpaceSizeMb = 4096,
}) {
  const toolLabel = String(label || "Node tool");
  const startedAt = Date.now();

  const runtime = await resolveBuildNodeRuntime();

  const execArgs = createNodeToolExecArgs({
    entry,
    args,
    nodeArgs,
    maxOldSpaceSizeMb,
    nodeMajor: runtime.major,
  });

  const entryIndex = execArgs.indexOf(String(entry));

  console.log(
    `[client-build] Starting ${toolLabel} with ${runtime.version} at ${runtime.path}`,
  );

  console.log(
    `[client-build] Runtime flags: ${
      entryIndex > 0
        ? execArgs.slice(0, entryIndex).join(" ")
        : ""
    }`,
  );

  const code = await runNodeToolProcess({
    toolLabel,
    executable: runtime.path,
    execArgs,
  });

  const elapsed = Date.now() - startedAt;

  if (code === 0) {
    console.log(
      `[client-build] Finished ${toolLabel} in ${elapsed} ms`,
    );
  } else {
    console.error(
      `[client-build] ${toolLabel} failed with exit code ${code} after ${elapsed} ms.`,
    );
    console.error(
      `[client-build] Runtime: ${runtime.version}, platform ${process.platform} ${process.arch}`,
    );
  }

  return code;
}

async function resolveBuildNodeRuntime() {
  const currentMajor = getNodeMajor(process.version);

  if (
    currentMajor >= STABLE_NODE_MIN_MAJOR &&
    currentMajor <= STABLE_NODE_MAX_MAJOR
  ) {
    return {
      major: currentMajor,
      path: process.execPath,
      version: process.version,
    };
  }

  const candidates = getNodeRuntimeCandidates();

  for (const candidate of candidates) {
    const runtime = await inspectNodeRuntime(candidate);

    if (
      runtime &&
      runtime.major >= STABLE_NODE_MIN_MAJOR &&
      runtime.major <= STABLE_NODE_MAX_MAJOR
    ) {
      return runtime;
    }
  }

  throw new Error(
    [
      `A stable Node 24 LTS runtime is required for client builds.`,
      `The current process is ${process.version} at ${process.execPath}.`,
      `Install Node 24 LTS or set BZSS_NODE_RUNTIME to the full path of node.exe.`,
    ].join(" "),
  );
}

function getNodeRuntimeCandidates() {
  const candidates = [];
  const seen = new Set();

  const add = (value) => {
    const candidate = String(value ?? "").trim();

    if (!candidate || seen.has(candidate)) {
      return;
    }

    seen.add(candidate);
    candidates.push(candidate);
  };

  const configuredRuntime =
    process.env.BZSS_NODE_RUNTIME ||
    process.env.BZSS_NODE_PATH;

  add(configuredRuntime);

  if (process.platform === "win32") {
    const nvmRoots = [
      process.env.NVM_HOME,
      process.env.APPDATA
        ? join(process.env.APPDATA, "nvm")
        : "",
    ];

    for (const root of nvmRoots) {
      addNodeVersionDirectories(root, add);
    }

    if (process.env.ProgramFiles) {
      addNodeVersionDirectories(
        join(process.env.ProgramFiles, "nodejs"),
        add,
      );
    }

    // Include every node.exe directory currently visible in PATH.
    for (const directory of String(process.env.PATH ?? "").split(";")) {
      add(join(directory, "node.exe"));
    }
  } else {
    for (const directory of String(process.env.PATH ?? "").split(":")) {
      add(join(directory, "node"));
    }
  }

  return candidates;
}

function addNodeVersionDirectories(root, add) {
  const normalizedRoot = String(root ?? "").trim();

  if (!normalizedRoot) {
    return;
  }

  try {
    for (const name of readdirSync(normalizedRoot)) {
      if (/^v?24\\./i.test(name)) {
        add(join(normalizedRoot, name, process.platform === "win32" ? "node.exe" : "bin/node"));
      }
    }
  } catch {
    // Missing NVM_HOME or an inaccessible directory is not fatal.
  }

  add(join(normalizedRoot, process.platform === "win32" ? "node.exe" : "bin/node"));
}

async function inspectNodeRuntime(candidate) {
  if (!existsSync(candidate)) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync(
      candidate,
      ["--version"],
      {
        env: createStableNodeToolEnv(),
        windowsHide: true,
      },
    );

    const version = String(stdout).trim();
    const major = getNodeMajor(version);

    if (!major) {
      return null;
    }

    return { major, path: candidate, version };
  } catch {
    return null;
  }
}

function getNodeMajor(version) {
  const match = String(version ?? "").match(/v?(\\d+)/);
  return match ? Number(match[1]) : 0;
}

async function runNodeToolProcess({
  toolLabel,
  executable,
  execArgs,
}) {
  return await new Promise((resolve) => {
    const child = execFile(
      executable,
      execArgs,
      {
        env: createStableNodeToolEnv(),
        windowsHide: false,
      },
      (error) => {
        if (error) {
          console.error(
            `[client-build] ${toolLabel} process error:`,
            error,
          );

          resolve(
            typeof error.code === "number"
              ? error.code
              : 1,
          );

          return;
        }

        resolve(0);
      },
    );

    if (child.stdout) {
      child.stdout.pipe(process.stdout);
    }

    if (child.stderr) {
      child.stderr.pipe(process.stderr);
    }

    child.once("error", (error) => {
      console.error(
        `[client-build] Unable to start ${toolLabel}:`,
        error,
      );

      resolve(1);
    });

    child.once("exit", (exitCode, signal) => {
      if (signal) {
        console.error(
          `[client-build] ${toolLabel} terminated by signal ${signal}.`,
        );

        resolve(1);
        return;
      }

      resolve(exitCode ?? 0);
    });
  });
}
