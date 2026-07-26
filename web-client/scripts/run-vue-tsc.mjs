import process from "node:process";
import { fileURLToPath } from "node:url";

import { runNodeTool } from "./node-tool-runner.mjs";

const vueTscPath = fileURLToPath(
  new URL("../node_modules/vue-tsc/bin/vue-tsc.js", import.meta.url),
);

try {
  process.exitCode = await runNodeTool({
    label: "Vue TypeScript check",
    entry: vueTscPath,
    args: process.argv.slice(2),
  });
} catch (error) {
  console.error("[client-build] Unable to start vue-tsc.", error);
  process.exitCode = 1;
}
