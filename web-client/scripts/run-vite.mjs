import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

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
  [fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)), ...process.argv.slice(2)],
  { stdio: "inherit", env, windowsHide: false },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
