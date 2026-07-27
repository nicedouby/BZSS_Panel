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

  let options = String(env.NODE_OPTIONS || "");
  for (const pattern of UNSAFE_NODE_OPTION_PATTERNS) {
    options = options.replace(pattern, " ");
  }
  if (!options.includes("--max-old-space-size")) {
    options += " --max-old-space-size=4096";
  }
  options = options.replace(/\s+/g, " ").trim();
  if (options) env.NODE_OPTIONS = options;
  else delete env.NODE_OPTIONS;

  return env;
}

export async function runNodeTool({ label, entry, args = [] }) {
  const toolLabel = String(label || "Node tool");
  const startedAt = Date.now();
  const nodeVersion = process.version;

  console.log(`[client-build] Starting ${toolLabel} with Node ${nodeVersion}`);

  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
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
