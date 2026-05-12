import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ConfigManager } from "../core/config-manager.js";

async function createTempConfig(content) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-config-"));
  const configPath = path.join(tempDir, "config.json");
  await fs.writeFile(configPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
  return { tempDir, configPath };
}

async function testLoadAndGet() {
  const { tempDir, configPath } = await createTempConfig({
    server: { name: "BZSS" },
    settingsEditor: { enabled: false, exposed: [] },
  });

  const config = new ConfigManager(configPath);
  await config.load();

  assert.equal(config.get("server.name"), "BZSS");
  assert.deepEqual(config.get(), {
    server: { name: "BZSS" },
    settingsEditor: { enabled: false, exposed: [] },
  });

  await fs.rm(tempDir, { recursive: true, force: true });
}

async function testExposedSettingsAndSave() {
  const { tempDir, configPath } = await createTempConfig({
    web: { host: "127.0.0.1", port: 7799 },
    settingsEditor: {
      enabled: true,
      exposed: [
        { path: "web.host", label: "Web Host", type: "string", restartRequired: true },
        {
          path: "web.port",
          label: "Web Port",
          type: "number",
          min: 1,
          max: 65535,
          restartRequired: true,
        },
      ],
    },
  });

  const config = new ConfigManager(configPath);
  await config.load();

  const initial = config.getExposedSettings();
  assert.equal(initial.enabled, true);
  assert.equal(initial.settings.length, 2);
  assert.equal(initial.settings[0].value, "127.0.0.1");
  assert.equal(initial.settings[1].value, 7799);

  const result = await config.updateExposedSettings({
    "web.host": "0.0.0.0",
    "web.port": "7800",
  });

  assert.equal(result.restartRequired, true);
  assert.equal(config.get("web.host"), "0.0.0.0");
  assert.equal(config.get("web.port"), 7800);

  const saved = JSON.parse(await fs.readFile(configPath, "utf8"));
  assert.equal(saved.web.host, "0.0.0.0");
  assert.equal(saved.web.port, 7800);
  await fs.access(`${configPath}.bak`);

  const saveResult = await config.save();
  assert.equal(saveResult.ok, true);
  assert.equal(saveResult.configPath, configPath);

  await fs.rm(tempDir, { recursive: true, force: true });
}

async function testValidationAndGuards() {
  const { tempDir, configPath } = await createTempConfig({
    settingsEditor: {
      enabled: true,
      exposed: [
        { path: "web.useVueClient", label: "Use Vue", type: "boolean", restartRequired: true },
        {
          path: "ipLookup.provider",
          label: "Provider",
          type: "select",
          options: ["none", "manual"],
          restartRequired: true,
        },
        {
          path: "serverTickRate.expected",
          label: "Tick",
          type: "number",
          min: 1,
          max: 120,
          restartRequired: true,
        },
      ],
    },
    web: { useVueClient: true },
    ipLookup: { provider: "none" },
    serverTickRate: { expected: 30 },
  });

  const config = new ConfigManager(configPath);
  await config.load();

  assert.throws(
    () => config.set("web.passwordHint", "visible"),
    (error) => error.statusCode === 403 && error.code === "SensitiveSettingBlocked",
  );
  assert.doesNotThrow(() => config.set("database.name", "allowed"));
  assert.equal(config.get("database.name"), "allowed");

  await assert.rejects(
    () => config.updateExposedSettings({ "web.password": "nope" }),
    (error) => error.statusCode === 403 && error.code === "SensitiveSettingBlocked",
  );

  assert.throws(
    () => config.set("database.dir", "./data"),
    (error) => error.statusCode === 403 && error.code === "SensitiveSettingBlocked",
  );

  assert.throws(
    () => config.set("auth.users.list", []),
    (error) => error.statusCode === 403 && error.code === "SensitiveSettingBlocked",
  );

  await assert.rejects(
    () => config.updateExposedSettings({ "web.useVueClient": "not-a-bool" }),
    (error) => error.statusCode === 400 && error.code === "InvalidSettingValue",
  );

  await assert.rejects(
    () => config.updateExposedSettings({ "ipLookup.provider": "missing" }),
    (error) => error.statusCode === 400 && error.code === "InvalidSettingValue",
  );

  await assert.rejects(
    () => config.updateExposedSettings({ "serverTickRate.expected": 999 }),
    (error) => error.statusCode === 400 && error.code === "SettingAboveMax",
  );

  await fs.rm(tempDir, { recursive: true, force: true });
}

async function testQueuedUpdatesRunSequentially() {
  const { tempDir, configPath } = await createTempConfig({
    web: { host: "127.0.0.1" },
    settingsEditor: {
      enabled: true,
      exposed: [
        { path: "web.host", label: "Web Host", type: "string", restartRequired: true },
      ],
    },
  });

  const config = new ConfigManager(configPath);
  await config.load();

  let activeSaves = 0;
  let maxActiveSaves = 0;
  const originalPerformSave = config.performSave.bind(config);
  config.performSave = async function patchedPerformSave(options) {
    activeSaves += 1;
    maxActiveSaves = Math.max(maxActiveSaves, activeSaves);
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return await originalPerformSave(options);
    } finally {
      activeSaves -= 1;
    }
  };

  await Promise.all([
    config.updateExposedSettings({ "web.host": "0.0.0.0" }),
    config.updateExposedSettings({ "web.host": "127.0.0.2" }),
  ]);

  assert.equal(maxActiveSaves, 1);
  assert.equal(config.get("web.host"), "127.0.0.2");

  await fs.rm(tempDir, { recursive: true, force: true });
}

await testLoadAndGet();
await testExposedSettingsAndSave();
await testValidationAndGuards();
await testQueuedUpdatesRunSequentially();

console.log("config manager tests passed");
