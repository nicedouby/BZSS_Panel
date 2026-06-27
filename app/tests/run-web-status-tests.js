import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ConfigManager } from "../core/config-manager.js";
import { WebStatus } from "../core/web-status.js";

async function createTempConfig(content) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-web-status-"));
  const configPath = path.join(tempDir, "config.json");
  await fs.writeFile(configPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
  return { tempDir, configPath };
}

async function testWarmupStateLoadsFromConfigAndPersistsUpdates() {
  const { tempDir, configPath } = await createTempConfig({
    warmup: {
      enabled: false,
    },
  });

  try {
    const config = new ConfigManager(configPath);
    await config.load();

    const webStatus = new WebStatus({ config });
    assert.deepEqual(webStatus.getWarmupState(), {
      isWarmup: false,
      updatedAt: null,
      updatedBy: null,
    });

    const result = await webStatus.setWarmup(true);
    assert.equal(result.isWarmup, true);
    assert.equal(typeof result.updatedAt, "string");
    assert.equal(result.updatedBy, null);
    assert.equal(webStatus.getSnapshot().isWarmup, true);
    assert.equal(webStatus.getSnapshot().warmupUpdatedAt, result.updatedAt);
    assert.equal(config.get("warmup.enabled"), true);

    const saved = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert.equal(saved.warmup.enabled, true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

await testWarmupStateLoadsFromConfigAndPersistsUpdates();

console.log("web status tests passed");
