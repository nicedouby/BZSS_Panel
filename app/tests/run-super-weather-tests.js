import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { compileTimeline, resolveTimeline, validateTimeline } from "../domain/super-weather/timeline.js";
import { RconAnchoredClock } from "../domain/super-weather/rcon-clock.js";
import { SuperWeatherPresetStore } from "../domain/super-weather/preset-store.js";
import { SuperWeatherScheduler } from "../domain/super-weather/scheduler.js";
import { BzssCoreCommandService } from "../core/bzss-core-command-service.js";
import { createPlugin as createSuperWeatherPlugin } from "../plugins/bzss-super-weather.js";

const basicTimeline = [
  { id: "clear", type: "weather", weatherType: 0, durationSeconds: 60 },
  { id: "to-rain", type: "transition", durationSeconds: 20 },
  { id: "rain", type: "weather", weatherType: 5, durationSeconds: 60 },
];

function testTimelineCompiler() {
  const compiled = compileTimeline(basicTimeline);
  assert.equal(compiled.totalDurationSeconds, 140);
  assertResolved(resolveTimeline(compiled, 0), "weather", "clear", 0, 0);
  assertResolved(resolveTimeline(compiled, 60), "transition", "to-rain", 5, 20);
  assertResolved(resolveTimeline(compiled, 72), "transition", "to-rain", 5, 8);
  assertResolved(resolveTimeline(compiled, 80), "weather", "rain", 5, 0);
  assert.equal(resolveTimeline(compiled, 900).held, true);
  assert.equal(validateTimeline([{ id: "bad", type: "transition", durationSeconds: 2 }]).ok, false);
  assert.equal(validateTimeline([
    { id: "one", type: "weather", weatherType: 0, durationSeconds: 2 },
    { id: "two", type: "weather", weatherType: 1, durationSeconds: 2 },
  ]).ok, false);
}

function assertResolved(actual, type, segmentId, targetWeather, remaining) {
  assert.equal(actual.type, type);
  assert.equal(actual.segmentId, segmentId);
  assert.equal(actual.targetWeather, targetWeather);
  assert.equal(actual.transitionRemainingSeconds, remaining);
}

function testRconClock() {
  let now = 0;
  const clock = new RconAnchoredClock({
    now: () => now,
    maxExtrapolationSeconds: 180,
    backwardJitterToleranceSeconds: 15,
  });
  assert.equal(clock.update(600).accepted, true);
  now = 12_000;
  assert.equal(clock.getLogicalSeconds(), 612);
  assert.equal(clock.update(600).duplicate, true);
  assert.equal(clock.getLogicalSeconds(), 612, "duplicate RCON samples must not reset interpolation");
  assert.equal(clock.update(590).ignoredJitter, true);
  assert.equal(clock.rawRconSeconds, 600);
  assert.equal(clock.update(580).accepted, true);
  now = 181_000 + 12_000;
  assert.equal(clock.getState().clockState, "CLOCK_STALE");
}

async function testCommandService() {
  const calls = [];
  const config = {
    get(key, fallback) {
      if (key === "bzssCore") return { modifyScriptPath: "./ModifySaveGame.py", remoteSaveGamePath: "./BZSS.sav" };
      return fallback;
    },
  };
  const service = new BzssCoreCommandService({
    config,
    executor: async (file, args) => { calls.push({ file, args }); return { stdout: "ok", stderr: "" }; },
  });
  assert.equal(service.normalizeDirective("SetWeather", "12,0").ok, true);
  assert.equal(service.normalizeDirective("SetWeather", "13,0").error, "InvalidWeatherParameter");
  const result = await service.execute({ directive: "SetWeather", parameter: "5,120", source: "test" });
  assert.equal(result.ok, true);
  assert.equal(result.source, "test");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.at(-1), "SetWeather:5,120");
}

async function testSchedulerJumpAndCrossing() {
  let now = 0;
  const commands = [];
  const scheduler = new SuperWeatherScheduler({
    now: () => now,
    commandService: { async execute(command) { commands.push(command); return { ok: true, command: `${command.directive}:${command.parameter}` }; } },
  });
  await scheduler.updateRcon(50, "round-a");
  await scheduler.activate({ id: "basic", name: "Basic", version: 1, timeline: basicTimeline });
  assert.equal(commands.at(-1).parameter, "0,0");

  await scheduler.updateRcon(72, "round-a");
  assert.equal(commands.at(-1).parameter, "5,8");

  commands.length = 0;
  scheduler.resetRound("round-b");
  await scheduler.updateRcon(50, "round-b");
  assert.equal(commands.at(-1).parameter, "0,0");
  await scheduler.updateRcon(90, "round-b");
  assert.equal(commands.at(-1).parameter, "5,0");
  assert.equal(commands.length, 2, "jumping over a transition must apply only the final state");

  commands.length = 0;
  scheduler.resetRound("round-c");
  await scheduler.updateRcon(0, "round-c");
  assert.equal(commands.at(-1).parameter, "0,0");
  now = 61_000;
  await scheduler.evaluate();
  assert.equal(commands.at(-1).parameter, "5,19");
  now = 81_000;
  await scheduler.evaluate();
  assert.equal(commands.length, 2, "stable Weather segment must not duplicate a completed transition");
}

async function testMultipleSegmentJump() {
  const commands = [];
  const timeline = [
    { id: "clear", type: "weather", weatherType: 0, durationSeconds: 30 },
    { id: "t1", type: "transition", durationSeconds: 10 },
    { id: "rain", type: "weather", weatherType: 5, durationSeconds: 30 },
    { id: "t2", type: "transition", durationSeconds: 10 },
    { id: "fog", type: "weather", weatherType: 2, durationSeconds: 300 },
  ];
  const scheduler = new SuperWeatherScheduler({
    commandService: { async execute(command) { commands.push(command); return { ok: true }; } },
  });
  await scheduler.updateRcon(30, "round-a");
  await scheduler.activate({ id: "multi", name: "Multi", version: 1, timeline });
  commands.length = 0;
  await scheduler.updateRcon(240, "round-a");
  assert.deepEqual(commands.map((item) => item.parameter), ["2,0"]);
}

async function testRestartRestoreAndStaleRecovery() {
  let now = 0;
  const commands = [];
  const scheduler = new SuperWeatherScheduler({
    now: () => now,
    maxExtrapolationSeconds: 180,
    commandService: { async execute(command) { commands.push(command); return { ok: true }; } },
  });
  scheduler.restore({
    enabled: true,
    activePresetId: "basic",
    activeTimeline: { id: "basic", name: "Basic", version: 1, timeline: basicTimeline },
    roundKey: "round-a",
    lastAppliedWeather: 0,
    lastSegmentId: "clear",
  });
  await scheduler.updateRcon(90, "round-a");
  assert.deepEqual(commands.map((item) => item.parameter), ["5,0"], "restart recovery must resolve current RCON time");
  now = 181_000;
  await scheduler.evaluate();
  assert.equal(scheduler.getState().clockState, "CLOCK_STALE");
  const countAtStale = commands.length;
  now = 182_000;
  await scheduler.evaluate();
  assert.equal(commands.length, countAtStale, "stale clock must not trigger new weather actions");
  await scheduler.updateRcon(120, "round-a");
  assert.equal(scheduler.getState().clockState, "RUNNING");
  assert.equal(commands.at(-1).parameter, "5,0");
}

async function testPresetStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-super-weather-"));
  try {
    const store = new SuperWeatherPresetStore({ dataDirectory: dir });
    await store.init();
    assert.equal(store.list().length, 1);
    const created = await store.create({ name: "Test", timeline: basicTimeline });
    const updated = await store.update(created.id, { name: "Test Updated" });
    assert.equal(updated.version, 2);
    assert.equal((await store.duplicate(created.id)).name, "Test Updated Copy");
    await store.delete(created.id);
    assert.equal(store.get(created.id), null);
    await assert.rejects(() => store.create({ name: "Bad", timeline: [{ id: "t", type: "transition", durationSeconds: 1 }] }), {
      code: "InvalidWeatherTimeline",
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function testPluginLifecycle() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-super-weather-plugin-"));
  const commands = [];
  const listeners = [];
  const snapshot = {
    serverStatus: { playtime: 72, lastUpdatedAt: "2026-08-02T00:00:00.000Z" },
    match: { playtime: 72 },
    round: { current: { dedupeKey: "round-plugin" } },
  };
  const values = new Map([
    ["plugins.bzss-super-weather.enabled", true],
    ["plugins.bzss-super-weather.dataDirectory", dir],
    ["plugins.bzss-super-weather.persistRuntime", true],
  ]);
  const plugin = createSuperWeatherPlugin({
    config: { get(key, fallback) { return values.has(key) ? values.get(key) : fallback; } },
    logger: { info() {}, warn() {}, error() {} },
    core: {
      bzssCoreCommandService: { async execute(command) { commands.push(command); return { ok: true }; } },
      eventBus: {
        onModuleEvent(moduleId, eventName, handler) {
          listeners.push({ moduleId, eventName, handler });
          return () => {};
        },
      },
    },
    modules: { matchState: { getState() { return snapshot; } } },
  });
  try {
    await plugin.init();
    await plugin.start();
    const preset = await plugin.api.createPreset({ name: "Plugin Test", timeline: basicTimeline });
    const active = await plugin.api.activate(preset.id);
    assert.equal(active.running, true);
    assert.equal(commands.at(-1).parameter, "5,8");
    assert.equal(listeners.length, 2);
    await plugin.stop();
    const runtime = JSON.parse(await fs.readFile(path.join(dir, "runtime.json"), "utf8"));
    assert.equal(runtime.activePresetId, preset.id);
    assert.equal(runtime.enabled, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

testTimelineCompiler();
testRconClock();
await testCommandService();
await testSchedulerJumpAndCrossing();
await testMultipleSegmentJump();
await testRestartRestoreAndStaleRecovery();
await testPresetStore();
await testPluginLifecycle();
console.log("run-super-weather-tests.js passed");
