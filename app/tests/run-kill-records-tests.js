import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";

import { createKillRecordsModule } from "../modules/kill-records/index.js";
import { parseReplayCombatLine, parseReplayKillLine } from "../modules/kill-records/kill-record-normalizer.js";

const WORKER_PATH = new URL("../workers/kill-replay-worker.js", import.meta.url);

async function main() {
  await testWorkerFindsEveryKill();
  await testWorkerFindsDamageAndWound();
  await testFixedStartupCutoff();
  await testUtf8AcrossChunks();
  await testWorkerKeepsOnlyCurrentRoundSquadCreates();
  await testLiveReplayDedupeAndSafety();
  console.log("[run-kill-records-tests] OK");
}

async function testWorkerKeepsOnlyCurrentRoundSquadCreates() {
  await withTemp(async (root) => {
    const sourcePath = path.join(root, "SquadGame.log");
    const lines = [
      squadCreateLine(1, "Squad 1", "Old Leader"),
      "[2026.08.14-08.00.00:000][1]LogWorld: SeamlessTravel to: /Game/Maps/Test/NewLayer",
      squadCreateLine(7, "Squad 7", "Current Leader"),
      squadCreateLine(2, "Squad 2", "Current Leader 2"),
    ];
    await fsp.writeFile(sourcePath, `${lines.join("\n")}\n`, "utf8");
    const result = await runWorker(sourcePath, { readChunkBytes: 23, batchSize: 1 });
    assert.deepEqual(result.squadCreates.map((record) => record.squadId), [7, 2]);
    assert.equal(result.complete.squadCreatesFound, 2);
    for (const record of result.squadCreates) {
      assert.equal(record.sourceMode, "replay");
      assert.equal(record.canTriggerActions, false);
      assert.equal(record.isReplay, true);
    }
  });
}

async function testWorkerFindsDamageAndWound() {
  await withTemp(async (root) => {
    const sourcePath = path.join(root, "SquadGame.log");
    const lines = [damageLine("VictimA", "AttackerA", 62.5), woundLine("VictimB", "AttackerB", 80), deathLine("VictimC", "AttackerC")];
    await fsp.writeFile(sourcePath, `${lines.join("\n")}\n`, "utf8");
    const result = await runWorker(sourcePath, { readChunkBytes: 31, batchSize: 2 });
    assert.deepEqual(result.records.map((record) => record.type), ["damage", "wound", "kill"]);
    assert.equal(result.complete.combatFound, 3);
    assert.equal(result.complete.damageFound, 1);
    assert.equal(result.complete.woundsFound, 1);
    assert.equal(result.complete.killsFound, 1);
    for (const record of result.records) {
      assert.equal(record.isReplay, true);
      assert.equal(record.canTriggerActions, false);
      assert.equal(record.sourceMode, "replay");
    }
  });
}

async function testWorkerFindsEveryKill() {
  await withTemp(async (root) => {
    const sourcePath = path.join(root, "SquadGame.log");
    const lines = Array.from({ length: 100 }, (_, index) => deathLine(`Victim${index}`, index % 2 ? "Attacker" : "四不两直"));
    await fsp.writeFile(sourcePath, `${lines.join("\n")}\n`, "utf8");
    const result = await runWorker(sourcePath, { readChunkBytes: 127, batchSize: 7 });
    assert.equal(result.records.length, 100);
    assert.equal(result.complete.killsFound, 100);
    assert.equal(new Set(result.records.map((record) => record.id)).size, 100);
  });
}

async function testFixedStartupCutoff() {
  await withTemp(async (root) => {
    const sourcePath = path.join(root, "SquadGame.log");
    await fsp.writeFile(sourcePath, `${deathLine("Before", "Attacker")}\n`, "utf8");
    const cutoff = (await fsp.stat(sourcePath)).size;
    const pending = runWorker(sourcePath, { endOffset: cutoff, readChunkBytes: 32 });
    await fsp.appendFile(sourcePath, `${deathLine("After", "Attacker")}\n`, "utf8");
    const result = await pending;
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].victim.name, "Before");
  });
}

async function testUtf8AcrossChunks() {
  await withTemp(async (root) => {
    const sourcePath = path.join(root, "SquadGame.log");
    await fsp.writeFile(sourcePath, `${deathLine("中文玩家甲", "中文玩家乙")}\n`, "utf8");
    const result = await runWorker(sourcePath, { readChunkBytes: 17 });
    assert.equal(result.records[0].victim.name, "中文玩家甲");
    assert.equal(result.records[0].attacker.name, "中文玩家乙");
    assert.equal(result.records[0].rawLog.includes(String.fromCharCode(0xfffd)), false);
  });
}

async function testLiveReplayDedupeAndSafety() {
  await withTemp(async (root) => {
    let coreEvents = 0;
    let moduleEvents = 0;
    const rawLog = deathLine("Victim", "Attacker", "AttackerTeamID=1 VictimTeamID=1");
    const replay = parseReplayKillLine(rawLog, { serverId: "BZSS_Main", sourceFile: "SquadGame.log", sourceFileId: "file-1", sourceOffset: 10 });
    const replayDamage = parseReplayCombatLine(damageLine("DamageVictim", "DamageAttacker", 25), {
      serverId: "BZSS_Main", sourceFile: "SquadGame.log", sourceFileId: "file-1", sourceOffset: 20,
    });
    const liveRecord = {
      id: "live-source", type: "kill", serverId: "BZSS_Main", time: replay.time,
      attacker: { name: "Attacker", teamID: 1 }, victim: { name: "Victim", teamID: 1 },
      weaponName: "BP_Rifle_C", isTeamKill: true, relation: { known: true, sameTeam: true }, rawLog,
    };
    const modules = { combatClean: { getState: () => ({ events: [liveRecord] }) } };
    const config = { get(key, fallback) { return key === "modules.killRecords" ? { storeDirectory: root, replayOnStart: false } : fallback; } };
    const core = {
      webStatus: { serverId: "BZSS_Main" },
      eventBus: { emitCoreEvent() { coreEvents += 1; }, emitModuleEvent() { moduleEvents += 1; } },
      webRegistry: { registerPage() {} }, logger: silentLogger(),
    };
    const instance = createKillRecordsModule({ core, modules, config, logger: silentLogger() });
    await instance.start();
    try {
      await instance.api.importReplayBatch([replay, replayDamage]);
      const result = instance.api.getRecords({ source: "all", limit: 20 });
      assert.equal(result.total, 1);
      assert.equal(result.records[0].source, "live");
      assert.equal(replay.isTeamKill, true);
      const combat = instance.api.getCombatRecords({ source: "replay", limit: 20 });
      assert.equal(combat.total, 2);
      assert.equal(combat.records.find((record) => record.type === "damage").canTriggerActions, false);
      assert.equal(instance.api.getOverview().total, 1);
      assert.equal(instance.api.getOverview().replayDamage, 1);
      assert.equal(coreEvents, 0);
      assert.equal(moduleEvents, 0);
    } finally { await instance.stop(); }
  });
}

function runWorker(sourcePath, options = {}) {
  return new Promise(async (resolve, reject) => {
    const stat = await fsp.stat(sourcePath);
    const sourceFileId = stat.ino ? `${stat.dev}:${stat.ino}` : `${stat.dev}:0:${Math.trunc(stat.ctimeMs)}`;
    const records = [];
    const squadCreates = [];
    let complete = null;
    const worker = new Worker(WORKER_PATH, { workerData: {
      sourcePath, sourceFileId, serverId: "BZSS_Main", startOffset: 0,
      endOffset: options.endOffset ?? stat.size, readChunkBytes: options.readChunkBytes,
      batchSize: options.batchSize ?? 10, progressBytes: 64,
    } });
    worker.on("message", (message) => {
      if (message.type === "combatBatch" || message.type === "killBatch") records.push(...message.records);
      if (message.type === "squadCreateBatch") squadCreates.push(...message.records);
      if (message.type === "complete") complete = message;
      if (message.type === "error") reject(new Error(message.message));
    });
    worker.on("error", reject);
    worker.on("exit", (code) => code === 0 ? resolve({ records, squadCreates, complete }) : reject(new Error(`worker exit ${code}`)));
  });
}

function deathLine(victim, attacker, suffix = "") {
  return `[2026.08.14-07.00.00:001][1]LogSquadTrace: [DedicatedServer]Die(): Player: ${victim} KillingDamage=100.000000 from ${attacker} (Online IDs: EOS: eos123 steam: 76561198000000000 | Contoller ID: Controller_1) caused by BP_Rifle_C ${suffix}`.trim();
}
function damageLine(victim, attacker, damage = 25) {
  return `[2026.08.14-07.00.00:002][2]LogSquadTrace: Player: ${victim} ActualDamage=${Number(damage).toFixed(6)} from ${attacker} (Online IDs: EOS: eos-damage steam: 76561198000000001 | Player Controller ID: Controller_D) caused by BP_Rifle_C`;
}
function woundLine(victim, attacker, damage = 80) {
  return `[2026.08.14-07.00.00:003][3]LogSquadTrace: Wound(): Player: ${victim} KillingDamage=${Number(damage).toFixed(6)} from ${attacker} (Online IDs: EOS: eos-wound steam: 76561198000000002 | Player Controller ID: Controller_W) caused by BP_Rifle_C`;
}
function squadCreateLine(squadId, squadName, leader) {
  return `[2026.08.14-08.01.00:001][2]LogSquad: ${leader} (Online IDs: EOS: eos-${squadId} steam: 7656119800000000${squadId}) has created Squad ${squadId} (Squad Name: ${squadName}) on United States Army`;
}
async function withTemp(callback) { const root = await fsp.mkdtemp(path.join(os.tmpdir(), "kill-records-")); try { await callback(root); } finally { await fsp.rm(root, { recursive: true, force: true }); } }
function silentLogger() { return { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } }; }

main().catch((error) => { console.error(error); process.exit(1); });
