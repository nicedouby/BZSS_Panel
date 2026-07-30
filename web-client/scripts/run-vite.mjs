import process from "node:process";
import { fileURLToPath } from "node:url";

import { runNodeTool } from "./node-tool-runner.mjs";

const vitePath = fileURLToPath(
  new URL("../node_modules/vite/bin/vite.js", import.meta.url),
);

const nodeMajor = Number.parseInt(String(process.versions.node ?? "0").split(".")[0], 10);
const nodeArgs = nodeMajor >= 24
  ? ["--jitless", "--no-experimental-require-module"]
  : [];

try {
  process.exitCode = await runNodeTool({
    label: "Vite production build",
    entry: vitePath,
    args: process.argv.slice(2),
    nodeArgs,
    maxOldSpaceSizeMb: 8192,
  });
} catch (error) {
  console.error("[client-build] Unable to start Vite.", error);
  process.exitCode = 1;
}
