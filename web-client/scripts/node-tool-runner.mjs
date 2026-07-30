import { spawn } from "node:child_process";
import process from "node:process";

const UNSAFE_NODE_OPTION_PATTERNS = [
  /(^|\s)--disallow-code-generation-from-strings(?:=\w+)?(?=\s|$)/g,
];

export function createStableNodeToolEnv(source = process.env) {
  const env = { ...source };

  env.NODE_DISABLE_COMPILE_CACHE = "1";
  env.DISABLE_V8_COMPILE_CACHE = "1";
  delete env.NODE_COMPILE_CACHE;
  delete env.V8_COMPILE_CACHE_CACHE_DIR;

  if (env.NODE_OPTIONS) {
    let options = String(env.NODE_OPTIONS);
    for (const pattern of UNSAFE_NODE_OPTION_PATTERNS) {
      options = options.replace(pattern, " ");
    }
    options = options.replace(/\s+/g, " ").trim();
    if (options) env.NODE_OPTIONS = options;
    else delete env.NODE_OPTIONS;
  }

  return env;
}

export function createNodeToolExecArgs({
  entry,
  args = [],
  nodeArgs = [],
  maxOldSpaceSizeMb = 4096,
} = {}) {
  const normalizedEntry = String(entry ?? "").trim();
  if (!normalizedEntry) throw new Error("Node tool entry is required.");

  const requestedHeap = Number(maxOldSpaceSizeMb);
  const heapSize = Number.isFinite(requestedHeap)
    ? Math.max(1024, Math.round(requestedHeap))
    : 4096;

  const extraNodeArgs = Array.isArray(nodeArgs)
    ? nodeArgs.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  const toolArgs = Array.isArray(args)
    ? args.map((value) => String(value))
    : [];

  return [
    `--max-old-space-size=${heapSize}`,
    "--no-maglev",
    ...extraNodeArgs,
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
  const nodeVersion = process.version;
  const execArgs = createNodeToolExecArgs({
    entry,
    args,
    nodeArgs,
    maxOldSpaceSizeMb,
  });

  console.log(`[client-build] Starting ${toolLabel} with Node ${nodeVersion}`);
  console.log(`[client-build] Runtime flags: ${execArgs.slice(0, -1 - args.length).join(" ")}`);

  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, execArgs, {
      stdio: "inherit",
      env: createStableNodeToolEnv(),
      windowsHide: false,
    });

    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (signal) {
        console.error(`[client-build] ${toolLabel} terminated by signal ${signal}.`);
        resolve(1);
        return;
      }
      resolve(exitCode ?? 1);
    });
  });

  const elapsedMs = Date.now() - startedAt;
  if (code === 0) {
    console.log(`[client-build] Finished ${toolLabel} in ${elapsedMs} ms`);
  } else {
    console.error(`[client-build] ${toolLabel} failed with exit code ${code} after ${elapsedMs} ms.`);
    console.error(`[client-build] Runtime: Node ${nodeVersion}, platform ${process.platform} ${process.arch}`);
  }

  return code;
}
