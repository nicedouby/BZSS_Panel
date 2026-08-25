import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import process from "node:process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const STABLE_NODE_MAJOR = 26;
const FALLBACK_NODE_MAJOR = 24;
const EMERGENCY_NODE_MAJOR = 20;
const SUPPORTED_NODE_MAJORS = [
  STABLE_NODE_MAJOR,
  FALLBACK_NODE_MAJOR,
  EMERGENCY_NODE_MAJOR,
];
const SUPPORTED_NODE_PATTERNS = SUPPORTED_NODE_MAJORS.map(
  (major) => new RegExp(`^(?:node-)?v?${major}\\.`, "i"),
);

export function createStableNodeToolEnv(source = process.env) {
  const env = { ...source };

  delete env.NODE_OPTIONS;

  // 禁用 Node 编译缓存，避免 Windows 下 Node 原生崩溃
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

  const runtimeArgs = [`--max-old-space-size=${heapSize}`];

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

  const runtimes = await resolveBuildNodeRuntimes();

  let lastCode = 1;

  for (const [index, runtime] of runtimes.entries()) {
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

    lastCode = code;

    if (code === 0) {
      const elapsed = Date.now() - startedAt;
      console.log(
        `[client-build] Finished ${toolLabel} in ${elapsed} ms`,
      );
      return code;
    }

    const nextRuntime = runtimes[index + 1];

    if (isNativeCrashCode(code) && nextRuntime) {
      console.error(
        `[client-build] ${toolLabel} hit a native crash (exit ${code}); retrying with ${nextRuntime.version}...`,
      );
      continue;
    }

    const elapsed = Date.now() - startedAt;
    console.error(
      `[client-build] ${toolLabel} failed with exit code ${code} after ${elapsed} ms.`,
    );

    console.error(
      `[client-build] Runtime: ${runtime.version}, platform ${process.platform} ${process.arch}`,
    );

    return code;
  }

  return lastCode;
}

async function resolveBuildNodeRuntimes() {
  const currentMajor = getNodeMajor(process.version);

  const runtimes = [];

  for (const candidate of getNodeRuntimeCandidates()) {
    const runtime = await inspectNodeRuntime(candidate);

    if (runtime) {
      runtimes.push(runtime);
    }
  }

  const ordered = [];
  const seenPaths = new Set();

  const addRuntime = (runtime) => {
    if (!runtime || seenPaths.has(runtime.path)) {
      return;
    }

    seenPaths.add(runtime.path);
    ordered.push(runtime);
  };

  if (currentMajor === STABLE_NODE_MAJOR) {
    addRuntime({
      major: currentMajor,
      path: process.execPath,
      version: process.version,
    });
  }

  for (const major of SUPPORTED_NODE_MAJORS) {
    const runtime = runtimes.find(
      (candidate) => candidate.major === major,
    );

    if (runtime) {
      addRuntime(runtime);
    }
  }

  if (ordered.length === 0 && currentMajor >= EMERGENCY_NODE_MAJOR) {
    addRuntime({
      major: currentMajor,
      path: process.execPath,
      version: process.version,
    });
  }

  if (ordered.length === 0) {
    throw new Error(
      [
        `A supported Node runtime is required for client builds.`,
        `The current process is ${process.version} at ${process.execPath}.`,
        `Install Node ${STABLE_NODE_MAJOR} or set BZSS_NODE_RUNTIME to the full path of node.exe.`,
      ].join(" "),
    );
  }

  return ordered;
}

function isNativeCrashCode(code) {
  const value = typeof code === "number" ? code >>> 0 : 0;

  return [
    0xC0000005,
    0x80000003,
    0xC0000409,
    0xC0000374,
  ].includes(value);
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

  const localNodeRoot = fileURLToPath(
    new URL("../.node/", import.meta.url),
  );
  addNodeVersionDirectories(localNodeRoot, add);

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

    // 检查 PATH 中的 node.exe
    for (const directory of String(process.env.PATH ?? "").split(";")) {
      if (directory.trim()) {
        add(join(directory, "node.exe"));
      }
    }
  } else {
    for (const directory of String(process.env.PATH ?? "").split(":")) {
      if (directory.trim()) {
        add(join(directory, "node"));
      }
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
      if (
        SUPPORTED_NODE_PATTERNS.some((pattern) =>
          pattern.test(name),
        )
      ) {
        add(
          join(
            normalizedRoot,
            name,
            process.platform === "win32"
              ? "node.exe"
              : "bin/node",
          ),
        );
      }
    }
  } catch {
    // 目录不存在或无法访问时忽略
  }

  add(
    join(
      normalizedRoot,
      process.platform === "win32"
        ? "node.exe"
        : "bin/node",
    ),
  );
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

    return {
      major,
      path: candidate,
      version,
    };
  } catch {
    return null;
  }
}

function getNodeMajor(version) {
  const normalized = String(version ?? "").trim();

  // 注意：这里必须是 \d 和 \.
  const match = normalized.match(/^v?(\d+)(?:\.|$)/);

  return match ? Number(match[1]) : 0;
}

async function runNodeToolProcess({
  toolLabel,
  executable,
  execArgs,
}) {
  return await new Promise((resolve) => {
    let settled = false;

    const finish = (code) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(code);
    };

    const child = execFile(
      executable,
      execArgs,
      {
        env: createStableNodeToolEnv(),
        windowsHide: false,
      },
      (error) => {
        if (!error) {
          finish(0);
          return;
        }

        console.error(
          `[client-build] ${toolLabel} process error:`,
          error,
        );

        finish(
          typeof error.code === "number"
            ? error.code
            : 1,
        );
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

      finish(1);
    });

    child.once("exit", (exitCode, signal) => {
      if (signal) {
        console.error(
          `[client-build] ${toolLabel} terminated by signal ${signal}.`,
        );

        finish(1);
        return;
      }

      finish(exitCode ?? 0);
    });
  });
}
