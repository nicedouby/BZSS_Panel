import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const env = { ...process.env };

// vue-tsc/Volar transforms TypeScript's compiler and uses its upstream
// eval-based bridge to keep the transformed compiler's private state
// consistent. Keep this exception scoped to the compiler child process;
// the panel and Vite runtime remain unchanged.
if (env.NODE_OPTIONS) {
  env.NODE_OPTIONS = env.NODE_OPTIONS
    .replace(/(^|\s)--disallow-code-generation-from-strings(?:=\w+)?(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!env.NODE_OPTIONS) {
    delete env.NODE_OPTIONS;
  }
}

const vueTscPath = fileURLToPath(
  new URL("../node_modules/vue-tsc/bin/vue-tsc.js", import.meta.url),
);

const result = spawnSync(
  process.execPath,
  [vueTscPath, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env,
    windowsHide: false,
  },
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
