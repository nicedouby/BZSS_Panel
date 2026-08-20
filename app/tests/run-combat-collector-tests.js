import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createCombatCollectorModule } from "../modules/combat-collector/index.js";
import { normalizeReplayCombatEvent } from "../modules/combat-collector/combat-event-normalizer.js";
import { parseReplayCombatLine } from "../modules/kill-records/kill-record-normalizer.js";

await testNullptrFieldsAreCollected();
await testStartupReplayCacheAndLiveIngest();
console.log("[run-combat-collector-tests] OK");

async function testNullptrFieldsAreCollected() {
  const lines = [
    damageLine("nullptr", "nullptr", "nullptr"),
    woundLine("nullptr", "nullptr", "nullptr"),
    deathLine("nullptr", "nullptr", "nullptr"),
  ];
  const records = lines.map((line, index) => normalizeReplayCombatEvent(parseReplayCombatLine(line, {
    serverId: "BZSS_Main",
    sourceFile: "SquadGame.log",
    sourceFileId: "file-nullptr",
    sourceOffset: index * 100,
  })));

  assert.deepEqual(records.map((record) => record.type), ["damage", "wound", "death"]);
  for (const record of records) {
    assert.equal(record.attacker.name, null);
    assert.equal(record.attacker.nameState, "nullptr");
    assert.equal(record.victim.name, null);
    assert.equal(record.victim.nameState, "nullptr");
    assert.equal(record.weapon, null);
    assert.equal(record.weaponState, "nullptr");
    assert.match(record.rawLog, /from nullptr/);
    assert.equal(record.canTriggerActions, false);
  }
}

async function testStartupReplayCacheAndLiveIngest() {
  await withTemp(async (root) => {
    const sourcePath = path.join(root, "SquadGame.log");
    const storeDirectory = path.join(root, "combat-cache");
    await fsp.writeFile(sourcePath, [
      damageLine("VictimA", "AttackerA", "BP_Rifle_C"),
      woundLine("VictimB", "AttackerB", "BP_Rifle_C"),
      deathLine("VictimC", "AttackerC", "BP_Rifle_C"),
    ].join("\n") + "\n", "utf8");

    const firstHarness = createHarness({ sourcePath, storeDirectory });
    const first = createCombatCollectorModule(firstHarness);
    await first.start();
    await waitFor(() => first.api.getReplayStatus().status === "completed");
    assert.equal(first.api.getRecords({ limit: 20 }).total, 3);
    assert.deepEqual(first.api.getRecords({ limit: 20 }).records.map((record) => record.type).sort(), ["damage", "death", "wound"]);
    assert.equal(first.api.getReplayStatus().startOffset, 0);
    assert.equal(firstHarness.emitted, 0, "collector must not emit events during replay");

    const replayDamage = first.api.getRecords({ type: "damage", limit: 1 }).records[0];
    firstHarness.emitCore("On_PlayerDamaged", {
      eventId: "live-overlap",
      serverId: "BZSS_Main",
      time: replayDamage.time,
      sourceOffset: replayDamage.sourceOffset,
      rawLog: replayDamage.rawLog,
      normalized: { combat: {
        type: "damaged", attackerName: "AttackerA", victimName: "VictimA",
        weapon: "BP_Rifle_C", damage: "25",
      } },
    });
    assert.equal(first.api.getRecords({ limit: 20 }).total, 3, "live/replay overlap must be idempotent");
    assert.deepEqual(first.api.getRecords({ type: "damage", limit: 1 }).records[0].observedModes.sort(), ["live", "replay"]);

    const liveRaw = deathLine("LiveVictim", "nullptr", "nullptr", "2026.08.14-07.00.01:001");
    firstHarness.emitCore("On_PlayerDied", {
      eventId: "live-nullptr",
      serverId: "BZSS_Main",
      time: "2026-08-14T07:00:01.001Z",
      rawLog: liveRaw,
      rawLineHash: "live-nullptr-hash",
      normalized: { combat: {
        type: "died", attackerName: "", victimName: "LiveVictim", weapon: "nullptr",
      } },
    });
    await waitFor(() => first.api.getRecords({ limit: 20 }).total === 4);
    await first.stop();

    const cachePath = path.join(storeDirectory, "combat-events.jsonl");
    const cachedLines = (await fsp.readFile(cachePath, "utf8")).trim().split("\n");
    assert.equal(cachedLines.length, 4);

    const secondHarness = createHarness({ sourcePath, storeDirectory });
    const second = createCombatCollectorModule(secondHarness);
    await second.start();
    try {
      await waitFor(() => second.api.getReplayStatus().status === "completed");
      assert.equal(second.api.getReplayStatus().startOffset, 0, "every startup must replay from byte zero");
      assert.equal(second.api.getRecords({ limit: 20 }).total, 4, "full replay must not duplicate cached records");
      assert.equal(second.api.getReplayStatus().duplicates, 3);
      assert.equal(second.api.getOverview().death, 2);
      assert.equal(secondHarness.emitted, 0);
    } finally {
      await second.stop();
    }

    const cachedAfterRestart = (await fsp.readFile(cachePath, "utf8")).trim().split("\n");
    assert.equal(cachedAfterRestart.length, 4);
  });
}

function createHarness({ sourcePath, storeDirectory }) {
  const listeners = new Map();
  const harness = {
    emitted: 0,
    core: {
      webStatus: { serverId: "BZSS_Main" },
      eventBus: {
        onCoreEvent(eventName, handler) {
          const key = `core:${eventName}`;
          listeners.set(key, handler);
          return () => listeners.delete(key);
        },
        onModuleEvent(moduleId, eventName, handler) {
          const key = `${moduleId}:${eventName}`;
          listeners.set(key, handler);
          return () => listeners.delete(key);
        },
        emitModuleEvent() { harness.emitted += 1; },
        emitCoreEvent() { harness.emitted += 1; },
      },
      logger: silentLogger(),
    },
    modules: {},
    config: {
      get(key, fallback) {
        if (key === "modules.combatCollector") return {
          enabled: true,
          replayOnStart: true,
          sourcePath,
          storeDirectory,
          readChunkBytes: 31,
          batchSize: 2,
        };
        if (key === "modules.squadLifecycle") return { replay: { enabled: false, restoreCreationOrder: false } };
        return fallback;
      },
    },
    logger: silentLogger(),
    emitModule(moduleId, eventName, payload) {
      listeners.get(`${moduleId}:${eventName}`)?.(payload);
    },
    emitCore(eventName, payload) {
      listeners.get(`core:${eventName}`)?.({ eventName, ...payload });
    },
  };
  return harness;
}

function damageLine(victim, attacker, weapon, timestamp = "2026.08.14-07.00.00:001") {
  return `[${timestamp}][1]LogSquadTrace: Player: ${victim} ActualDamage=25.000000 from ${attacker} (Online IDs: EOS: invalid steam: invalid | Player Controller ID: nullptr) caused by ${weapon}`;
}

function woundLine(victim, attacker, weapon, timestamp = "2026.08.14-07.00.00:002") {
  return `[${timestamp}][2]LogSquadTrace: Wound(): Player: ${victim} KillingDamage=80.000000 from ${attacker} (Online IDs: EOS: invalid steam: invalid | Player Controller ID: nullptr) caused by ${weapon}`;
}

function deathLine(victim, attacker, weapon, timestamp = "2026.08.14-07.00.00:003") {
  return `[${timestamp}][3]LogSquadTrace: [DedicatedServer]Die(): Player: ${victim} KillingDamage=100.000000 from ${attacker} (Online IDs: EOS: invalid steam: invalid | Player Controller ID: nullptr) caused by ${weapon}`;
}

async function withTemp(callback) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "combat-collector-"));
  try { await callback(root); } finally { await fsp.rm(root, { recursive: true, force: true }); }
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for combat collector");
}

function silentLogger() {
  return { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } };
}
