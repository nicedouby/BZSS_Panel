import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Volar's vue-tsc bridge uses TypeScript's dynamic compiler helpers. Some
// hardened Node installations expose --disallow-code-generation-from-strings
// through NODE_OPTIONS, which makes vue-tsc fail before it can report any
// project diagnostics. Remove only that inherited restriction for this
// trusted local compiler process; do not change the parent process.
const env = { ...process.env };
if (env.NODE_OPTIONS) {
  env.NODE_OPTIONS = env.NODE_OPTIONS
    .replace(/(^|\s)--disallow-code-generation-from-strings(?:=\w+)?(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!env.NODE_OPTIONS) delete env.NODE_OPTIONS;
}

const result = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("../node_modules/vue-tsc/bin/vue-tsc.js", import.meta.url)), ...process.argv.slice(2)],
  { stdio: "inherit", env, windowsHide: false },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
