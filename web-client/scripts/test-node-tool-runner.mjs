import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createStableNodeToolEnv, runNodeTool } from "./node-tool-runner.mjs";

const env = createStableNodeToolEnv({
  NODE_OPTIONS: "--max-old-space-size=4096 --disallow-code-generation-from-strings",
  NODE_COMPILE_CACHE: "C:/stale-node-cache",
  V8_COMPILE_CACHE_CACHE_DIR: "C:/stale-v8-cache",
});

assert.equal(env.NODE_OPTIONS, "--max-old-space-size=4096");
assert.equal(env.NODE_DISABLE_COMPILE_CACHE, "1");
assert.equal(env.DISABLE_V8_COMPILE_CACHE, "1");
assert.equal("NODE_COMPILE_CACHE" in env, false);
assert.equal("V8_COMPILE_CACHE_CACHE_DIR" in env, false);

const directory = await mkdtemp(path.join(os.tmpdir(), "bzss-node-tool-"));
const childPath = path.join(directory, "verify-child.mjs");

try {
  await writeFile(childPath, [
    "if (process.env.NODE_DISABLE_COMPILE_CACHE !== '1') process.exit(2);",
    "if (process.env.DISABLE_V8_COMPILE_CACHE !== '1') process.exit(3);",
    "if (process.env.NODE_COMPILE_CACHE) process.exit(4);",
  ].join("\n"), "utf8");

  const exitCode = await runNodeTool({
    label: "build runner environment test",
    entry: childPath,
  });
  assert.equal(exitCode, 0);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log("test-node-tool-runner: ok");
