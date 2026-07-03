import assert from "node:assert/strict";

import {
  createBzssCoreMonitorModule,
  parseBzssCorePlayerBlocks,
  parseBzssCoreLogLine,
} from "../modules/bzss-core-monitor/index.js";

function withMockedDate(iso, fn) {
  const RealDate = globalThis.Date;
  const fixedTime = new RealDate(iso).getTime();

  class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(fixedTime);
        return;
      }
      super(...args);
    }

    static now() {
      return fixedTime;
    }
  }

  MockDate.parse = RealDate.parse;
  MockDate.UTC = RealDate.UTC;
  globalThis.Date = MockDate;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

function testParsePlayerBlocks() {
  const text = "PlayerBaseInfo{0,abc123,Donald DoubyBear,1,0,-1,-1}"
    + "SoldierInfo{BP_Soldier_PLA_Rifleman1_Arid_C_2147477191,100,0,0,0,0,0,0,"
    + "BP_QBZ191_IronSights_C_2147477184,19,30,30,30,30,30,30{X=15014 Y=-1672 Z=-12490}{X=0 Y=0 Z=93}}"
    + "PlayerScoreboard{-1,0,0,0,0,0,0,0,0,0,0,0}"
    + "PlayerBaseInfo{0,def456,Second Player,2,7,-1,-1}"
    + "SoldierInfo{BP_Soldier_US_Rifleman_C,85,0,0,0,0,0,0,BP_M4_C,7,120{X=10 Y=20 Z=30}{X=0 Y=90 Z=0}}"
    + "PlayerScoreboard{1,2,3}";

  const players = parseBzssCorePlayerBlocks(text);
  assert.equal(players.length, 2);
  assert.equal(players[0].playerIndex, 0);
  assert.equal(players[0].playerName, "Donald DoubyBear");
  assert.equal(players[0].soldierInfo.weaponClass, "BP_QBZ191_IronSights_C_2147477184");
  assert.deepEqual(players[0].soldierInfo.position, { x: 1501400, y: -167200, z: -1249000 });
  assert.equal(players[1].playerIndex, 0);

  const shiftedTailText = "PlayerBaseInfo{1,eos-1,Tail Shift,1,1,-1,-1}"
    + "SoldierInfo{BP_Soldier_US_Rifleman_C,100,0,0,0,0,0,0,BP_M4_C,30,120{X=1 Y=2 Z=3}{X=4 Y=5 Z=6}}"
    + "PlayerScoreboard{9,8,7,6,5,4,3,2,1,99}";
  const shiftedPlayers = parseBzssCorePlayerBlocks(shiftedTailText);
  assert.equal(shiftedPlayers.length, 1);
  assert.equal(shiftedPlayers[0].playerScoreboard.stats.vehicleKills, 7);
  assert.equal(shiftedPlayers[0].playerScoreboard.stats.numTeamKills, 3);
  assert.equal(shiftedPlayers[0].playerScoreboard.stats.healPoints, 2);
  assert.equal(shiftedPlayers[0].playerScoreboard.stats.revivedPoints, 1);
  assert.equal(shiftedPlayers[0].playerScoreboard.stats.teamworkScore, 99);
  assert.equal(shiftedPlayers[0].playerScoreboard.stats.objectiveScore, null);
  assert.equal(shiftedPlayers[0].playerScoreboard.stats.combatScore, null);
}

function testParseLogLine() {
  const runtime = parseBzssCoreLogLine("PIE: Error: PlayerBaseInfo{}");
  assert.equal(runtime.type, "playerRuntime");
  assert.equal(runtime.runtimePlayers.length, 0);

  const priRuntime = parseBzssCoreLogLine("PIE: PRI{{0,994,715,3,90,{0,150.0,false,BP_M4A1_M150_Foregrip_C_2147459836,false,}}}");
  assert.equal(priRuntime.type, "playerRuntime");
  assert.equal(priRuntime.runtimePlayers.length, 1);
  assert.equal(priRuntime.runtimePlayers[0].playerIndex, 0);
  assert.deepEqual(priRuntime.runtimePlayers[0].position, { x: 99400, y: 71500, z: 300 });
  assert.equal(priRuntime.runtimePlayers[0].yaw, 90);

  const noPawnRuntime = parseBzssCoreLogLine("PIE: PRI{{77,,,,,NoPawn}}");
  assert.equal(noPawnRuntime.type, "playerRuntime");
  assert.equal(noPawnRuntime.runtimePlayers.length, 1);
  assert.equal(noPawnRuntime.runtimePlayers[0].playerIndex, 77);
  assert.equal(noPawnRuntime.runtimePlayers[0].position, null);
  assert.equal(noPawnRuntime.runtimePlayers[0].combatInfo, "NoPawn");
  assert.equal(noPawnRuntime.runtimePlayers[0].presenceHint, "noPawn");

  const scoreboard = parseBzssCoreLogLine("PIE: PlayerScoreboard{0,1,-1,0,0,0,0,0,0,0,0,0,0,0,1,0-1,-1,19}}");
  assert.equal(scoreboard.type, "playerScoreboard");
  assert.equal(scoreboard.scoreboardPlayers.length, 1);
  assert.equal(scoreboard.scoreboardPlayers[0].playerIndex, 0);
  assert.equal(scoreboard.scoreboardPlayers[0].fireTeamIndex, -1);
  assert.equal(scoreboard.scoreboardPlayers[0].fireTeamPosition, -1);
  assert.equal(scoreboard.scoreboardPlayers[0].playerScoreboard.stats.teamworkScore, 0);
  assert.equal(scoreboard.scoreboardPlayers[0].playerScoreboard.stats.combatScore, 0);

  const gluedBooleanScoreboard = parseBzssCoreLogLine(
    "PIE: PlayerScoreboard{0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,47,88}}"
  );
  assert.equal(gluedBooleanScoreboard.type, "playerScoreboard");
  assert.equal(gluedBooleanScoreboard.scoreboardPlayers.length, 1);
  assert.equal(gluedBooleanScoreboard.scoreboardPlayers[0].isAdmin, false);
  assert.equal(gluedBooleanScoreboard.scoreboardPlayers[0].isCommander, true);
  assert.equal(gluedBooleanScoreboard.scoreboardPlayers[0].fireTeamIndex, 0);
  assert.equal(gluedBooleanScoreboard.scoreboardPlayers[0].fireTeamPosition, 47);
  assert.equal(gluedBooleanScoreboard.scoreboardPlayers[0].playerScoreboard.stats.teamworkScore, 0);
  assert.equal(gluedBooleanScoreboard.scoreboardPlayers[0].playerScoreboard.stats.combatScore, 0);

  const gluedPositiveFtScoreboard = parseBzssCoreLogLine(
    "PIE: PlayerScoreboard{7,2,1,5,0,4,0,1,0,0,0,0,0,0,1,02,0,78}}"
  );
  assert.equal(gluedPositiveFtScoreboard.type, "playerScoreboard");
  assert.equal(gluedPositiveFtScoreboard.scoreboardPlayers.length, 1);
  assert.equal(gluedPositiveFtScoreboard.scoreboardPlayers[0].playerIndex, 7);
  assert.equal(gluedPositiveFtScoreboard.scoreboardPlayers[0].isCommander, null);
  assert.equal(gluedPositiveFtScoreboard.scoreboardPlayers[0].fireTeamIndex, 2);
  assert.equal(gluedPositiveFtScoreboard.scoreboardPlayers[0].fireTeamPosition, 0);
  assert.equal(gluedPositiveFtScoreboard.scoreboardPlayers[0].ping, 78);

  const observedScoreboard = parseBzssCoreLogLine(
    "PIE: PlayerScoreboard{42,2,1,1,1,4,0,0,0,0,0,0,80,15,0,0,1,99,55}}"
  );
  assert.equal(observedScoreboard.type, "playerScoreboard");
  assert.equal(observedScoreboard.scoreboardPlayers.length, 1);
  assert.equal(observedScoreboard.scoreboardPlayers[0].playerIndex, 42);
  assert.equal(observedScoreboard.scoreboardPlayers[0].kills, 1);
  assert.equal(observedScoreboard.scoreboardPlayers[0].vehicleKills, 1);
  assert.equal(observedScoreboard.scoreboardPlayers[0].woundeds, 0);
  assert.equal(observedScoreboard.scoreboardPlayers[0].deaths, 4);
  assert.equal(observedScoreboard.scoreboardPlayers[0].teamworkScore, 0);
  assert.equal(observedScoreboard.scoreboardPlayers[0].objectiveScore, 80);
  assert.equal(observedScoreboard.scoreboardPlayers[0].combatScore, 15);
  assert.equal(observedScoreboard.scoreboardPlayers[0].isCommander, false);
  assert.deepEqual(observedScoreboard.scoreboardPlayers[0].playerScoreboard.stats, {
    dataLives: null,
    numKills: 1,
    vehicleKills: 1,
    numDeaths: 4,
    numWoundeds: 0,
    numWounds: 0,
    numTeamKills: 0,
    healPoints: 0,
    revivedPoints: 0,
    teamworkScore: 0,
    objectiveScore: 80,
    combatScore: 15,
  });

  const compactMultiScoreboard = parseBzssCoreLogLine(
    "PIE: PlayerScoreboard{0,1,3,0,1,0,0,0,0,0,0,0,0,0,5,0,0,-1,19}{1,1,3,0,2,0,0,0,0,0,0,0,0,0,6,0,0,-1,19}{2,1,3,0,3,0,0,0,0,0,0,0,0,0,7,0,0,-1,19}}"
  );
  assert.equal(compactMultiScoreboard.type, "playerScoreboard");
  assert.equal(compactMultiScoreboard.scoreboardPlayers.length, 3);
  assert.deepEqual(
    compactMultiScoreboard.scoreboardPlayers.map((player) => player.playerIndex),
    [0, 1, 2],
  );
  assert.deepEqual(
    compactMultiScoreboard.scoreboardPlayers.map((player) => player.squadId),
    [3, 3, 3],
  );

  const flatMultiScoreboard = parseBzssCoreLogLine(
    "PIE: PlayerScoreboard{22,1,3,0,1,0,0,0,0,0,0,0,0,0,5,0,0,-1,19,23,1,3,0,2,0,0,0,0,0,0,0,0,0,6,0,0,-1,19,24,1,3,0,3,0,0,0,0,0,0,0,0,0,7,0,0,-1,19}}"
  );
  assert.equal(flatMultiScoreboard.type, "playerScoreboard");
  assert.equal(flatMultiScoreboard.scoreboardPlayers.length, 3);
  assert.deepEqual(
    flatMultiScoreboard.scoreboardPlayers.map((player) => player.playerIndex),
    [22, 23, 24],
  );

  const scene = parseBzssCoreLogLine("PIE: CPZ:{01-TriCommons,true,1.0,1}{02-AbdelsFarm,true,1.0,1},FOBI:{,1,Very_Small,300.0,10000.0,2000.0,},MainZone:{1,X=56820.773 Y=7170.025 Z=-13376.360}");
  assert.equal(scene.type, "scene");
  assert.equal(scene.captureZones.length, 2);
  assert.equal(scene.fobs.length, 1);
  assert.equal(scene.mainZones.length, 1);
}

function testMonitorState() {
  const module = createBzssCoreMonitorModule({
    core: {
      eventBus: { onCoreEvent() { return () => {}; }, emitModuleEvent() {} },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
  });

  assert.equal(module.api.ingestLogLine("PIE: Error: PlayerBaseInfo{}").ok, true);
  assert.equal(module.api.getRuntimePlayers().length, 0);

  assert.equal(module.api.ingestLogLine("PIE: PlayerBaseInfo{7,100,200,300,45}").ok, true);
  assert.equal(module.api.ingestLogLine("PIE: PlayerBaseInfo{21,400,500,600,90}").ok, true);
  assert.equal(module.api.ingestLogLine("PIE: PlayerBaseInfo{22,700,800,900,135}").ok, true);
  assert.deepEqual(
    module.api.getRuntimePlayers().map((player) => player.playerIndex).sort((a, b) => a - b),
    [7, 21, 22],
  );

  assert.equal(module.api.ingestLogLine("PIE: PlayerScoreboard{7,1,3,0,1,2,0,3,4,0,0,10,20,30,0,0,-1,19,55}").ok, true);
  assert.equal(module.api.ingestLogLine("PIE: PlayerScoreboard{21,2,5,0,2,1,0,4,5,0,0,11,21,31,0,0,-1,19,56}").ok, true);
  assert.equal(module.api.ingestLogLine("PIE: PlayerScoreboard{22,3,6,0,3,0,0,5,6,0,0,12,22,32,0,0,-1,19,57}").ok, true);
  assert.deepEqual(
    module.api.getScoreboardPlayers().map((player) => player.playerIndex).sort((a, b) => a - b),
    [7, 21, 22],
  );

  const beforeEmptyRuntime = module.api.getRuntimePlayers().map((player) => player.playerIndex).sort((a, b) => a - b);
  assert.equal(module.api.ingestLogLine("PIE: PlayerBaseInfo{}").ok, true);
  assert.deepEqual(
    module.api.getRuntimePlayers().map((player) => player.playerIndex).sort((a, b) => a - b),
    beforeEmptyRuntime,
  );

  const beforeEmptyScoreboard = module.api.getScoreboardPlayers().map((player) => player.playerIndex).sort((a, b) => a - b);
  assert.equal(module.api.ingestLogLine("PIE: PlayerScoreboard{}").ok, true);
  assert.deepEqual(
    module.api.getScoreboardPlayers().map((player) => player.playerIndex).sort((a, b) => a - b),
    beforeEmptyScoreboard,
  );

  assert.equal(module.api.ingestLogLine("PIE: CPZ:{01-TriCommons,true,1.0,1},FOBI:{,1,Very_Small,300.0,10000.0,2000.0,},MainZone:{1,X=56820.773 Y=7170.025 Z=-13376.360}").ok, true);
  const raw = module.api.getRawSnapshot();
  assert.equal(raw.runtimePlayers.length, 3);
  assert.equal(raw.scoreboardPlayers.length, 3);
  assert.equal(raw.captureZones.length, 1);
  assert.equal(raw.fobs.length, 1);
  assert.equal(raw.mainZones.length, 1);
  assert.ok(raw.rawLineHash);

  const fullBlockText = "PlayerBaseInfo{42,eos-42,Test Player,2,3,-1,-1}"
    + "SoldierInfo{BP_Soldier_US_Rifleman_C,88,0,0,0,0,0,0,BP_M4_C,30,120{X=1000 Y=2000 Z=0}{X=0 Y=90 Z=0}}"
    + "PlayerScoreboard{0,0,0,0,0,0,0,0,0,0,0,99}";
  assert.equal(module.api.ingestLogLine(fullBlockText).ok, true);

  const players = module.api.getPlayers();
  const p42 = players.find((p) => p.playerIndex === 42);
  assert.ok(p42);
  assert.equal(p42.playerName, "Test Player");
  assert.equal(p42.teamId, 2);
  assert.equal(p42.squadId, 3);
  assert.equal(p42.soldierInfo.health, 88);
  assert.deepEqual(p42.soldierInfo.position, { x: 100000, y: 200000, z: 0 });
  assert.equal(p42.playerScoreboard.stats.combatScore, 99);

  assert.equal(module.api.ingestLogLine("PIE: PRI{{42,,,,,NoPawn}}").ok, true);
  const afterNoPawn = module.api.getPlayers().find((p) => p.playerIndex === 42);
  assert.ok(afterNoPawn);
  assert.equal(afterNoPawn.position, null);
  assert.equal(afterNoPawn.yaw, null);
  assert.equal(afterNoPawn.telemetry?.position, null);
  assert.equal(afterNoPawn.telemetry?.yaw, null);
  assert.equal(afterNoPawn.soldierInfo.position, null);
  assert.equal(afterNoPawn.soldierInfo.rotation, null);
  assert.equal(afterNoPawn.presenceHint, "noPawn");
  assert.equal(afterNoPawn.presence?.state, "noPawn");
  assert.equal(afterNoPawn.stale, false);

  const runtimeMergeModule = createBzssCoreMonitorModule({
    core: {
      eventBus: { onCoreEvent() { return () => {}; }, emitModuleEvent() {} },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
  });
  const priBatch = (start, count) => {
    const rows = [];
    for (let index = 0; index < count; index += 1) {
      const playerId = start + index;
      rows.push(`PRI{{${playerId},${playerId * 10},${playerId * 10 + 1},${playerId * 10 + 2},${playerId % 360}}}`);
    }
    return `PIE: ${rows.join("")}`;
  };
  assert.equal(runtimeMergeModule.api.ingestLogLine(priBatch(1, 25)).ok, true);
  assert.equal(runtimeMergeModule.api.ingestLogLine(priBatch(26, 25)).ok, true);
  assert.equal(runtimeMergeModule.api.ingestLogLine(priBatch(51, 25)).ok, true);
  assert.equal(runtimeMergeModule.api.ingestLogLine(priBatch(76, 17)).ok, true);
  assert.equal(runtimeMergeModule.api.getRuntimePlayers().length, 92);
  assert.deepEqual(
    [1, 25, 26, 50, 51, 75, 76, 92].every((playerId) => runtimeMergeModule.api.getRuntimePlayers().some((player) => player.playerIndex === playerId)),
    true,
  );

  const scoreboardOnlyModule = createBzssCoreMonitorModule({
    core: {
      eventBus: { onCoreEvent() { return () => {}; }, emitModuleEvent() {} },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
  });
  const scoreboardRows = [];
  for (let playerId = 1; playerId <= 99; playerId += 1) {
    const squadId = playerId <= 92 ? 3 : 7;
    scoreboardRows.push(`${[
      playerId,
      1,
      squadId,
      0,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      -1,
      -1,
      19,
    ].join(",")}`);
  }
  assert.equal(scoreboardOnlyModule.api.ingestLogLine(`PIE: PlayerScoreboard{${scoreboardRows.map((row) => `{${row}}`).join("")}}`).ok, true);
  const scoreboardOnlyPlayers = scoreboardOnlyModule.api.getPlayers();
  assert.equal(scoreboardOnlyPlayers.length, 99);
  assert.equal(scoreboardOnlyPlayers.filter((player) => player.telemetry?.position == null).length, 99);
  assert.equal(scoreboardOnlyPlayers.every((player) => player.presence?.state === "scoreboardOnly"), true);

  const mergedModule = createBzssCoreMonitorModule({
    core: {
      eventBus: { onCoreEvent() { return () => {}; }, emitModuleEvent() {} },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
  });
  assert.equal(mergedModule.api.ingestLogLine(priBatch(1, 25)).ok, true);
  assert.equal(mergedModule.api.ingestLogLine(priBatch(26, 25)).ok, true);
  assert.equal(mergedModule.api.ingestLogLine(priBatch(51, 25)).ok, true);
  assert.equal(mergedModule.api.ingestLogLine(priBatch(76, 17)).ok, true);
  assert.equal(mergedModule.api.ingestLogLine(`PIE: PlayerScoreboard{${scoreboardRows.map((row) => `{${row}}`).join("")}}`).ok, true);
  const mergedPlayers = mergedModule.api.getPlayers();
  assert.equal(mergedPlayers.length, 99);
  assert.equal(mergedModule.api.getState().playerCount, 99);
  assert.ok(mergedPlayers.every((player) => player.playerScoreboard));
  assert.equal(mergedPlayers.filter((player) => player.playerIndex <= 92).every((player) => player.telemetry?.position != null), true);
  assert.equal(mergedPlayers.filter((player) => player.playerIndex >= 93).every((player) => player.telemetry?.position == null), true);
  assert.equal(mergedPlayers.filter((player) => player.playerIndex >= 93).every((player) => player.presence?.state === "scoreboardOnly"), true);

  const hardTtlModule = createBzssCoreMonitorModule({
    core: {
      eventBus: { onCoreEvent() { return () => {}; }, emitModuleEvent() {} },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
  });
  withMockedDate("2026-07-02T00:00:00.000Z", () => {
    assert.equal(hardTtlModule.api.ingestLogLine("PIE: PlayerBaseInfo{99,10,20,30,40}").ok, true);
  });
  withMockedDate("2026-07-02T00:00:16.000Z", () => {
    const players16 = hardTtlModule.api.getRuntimePlayers();
    assert.equal(players16.length, 1);
    assert.equal(players16[0].stale, true);
  });
  withMockedDate("2026-07-02T00:10:01.000Z", () => {
    assert.equal(hardTtlModule.api.getRuntimePlayers().length, 0);
  });

  const onlineAwareModule = createBzssCoreMonitorModule({
    core: {
      eventBus: { onCoreEvent() { return () => {}; }, emitModuleEvent() {} },
      webStatus: { serverId: "server-1" },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
    modules: {
      playerState: {
        getOnlinePlayers() {
          return [];
        },
      },
    },
  });
  withMockedDate("2026-07-02T00:00:00.000Z", () => {
    assert.equal(onlineAwareModule.api.ingestLogLine("PIE: PlayerBaseInfo{77,10,20,30,40}").ok, true);
  });
  withMockedDate("2026-07-02T00:05:01.000Z", () => {
    assert.equal(onlineAwareModule.api.getRuntimePlayers().length, 0);
  });

  const onlineControllerAwareModule = createBzssCoreMonitorModule({
    core: {
      eventBus: { onCoreEvent() { return () => {}; }, emitModuleEvent() {} },
      webStatus: { serverId: "server-1" },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
    modules: {
      playerState: {
        getOnlinePlayers() {
          return [{ controllerID: "77", name: "Still Online" }];
        },
      },
    },
  });
  withMockedDate("2026-07-02T00:00:00.000Z", () => {
    assert.equal(onlineControllerAwareModule.api.ingestLogLine("PIE: PlayerBaseInfo{77,10,20,30,40}").ok, true);
  });
  withMockedDate("2026-07-02T00:06:01.000Z", () => {
    const players = onlineControllerAwareModule.api.getRuntimePlayers();
    assert.equal(players.length, 1);
    assert.equal(players[0].stale, true);
    assert.equal(onlineControllerAwareModule.api.getPlayers().length, 1);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testParseExplosionDamage() {
  const line = "[2026.06.30-08.00.41:404][702]LogSquadTrace: [DedicatedServer]ApplyExplosiveDamage(): HitActor=nullptr DamageCauser=BP_M67Frag_C_2147006951 DamageInstigator=BP_PlayerController_C_2147480791 ExplosionLocation=V(X=-7008.21, Y=11835.69, Z=-13475.49)";
  const parsed = parseBzssCoreLogLine(line);
  assert.ok(parsed);
  assert.equal(parsed.type, "explosiveDamage");
  assert.ok(parsed.explosion);
  assert.ok(parsed.explosion.id.startsWith("exp-"));
  assert.equal(parsed.explosion.x, -700821);
  assert.equal(parsed.explosion.y, 1183569);
  assert.equal(parsed.explosion.z, -1347549);
  assert.equal(parsed.explosion.damageCauser, "BP_M67Frag_C_2147006951");
  assert.equal(parsed.explosion.damageInstigator, "BP_PlayerController_C_2147480791");

  const module = createBzssCoreMonitorModule({
    core: {
      eventBus: { onCoreEvent() { return () => {}; }, emitModuleEvent() {} },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
  });

  const res = module.api.ingestLogLine(line);
  assert.equal(res.ok, true);
  assert.equal(res.type, "explosiveDamage");

  const snapshot = module.api.getRawSnapshot();
  assert.equal(snapshot.explosions.length, 1);
  assert.equal(snapshot.explosions[0].x, -700821);
  assert.equal(snapshot.explosions[0].damageCauser, "BP_M67Frag_C_2147006951");

  await sleep(3100);
  const snapshotAfter = module.api.getRawSnapshot();
  assert.equal(snapshotAfter.explosions.length, 0);

  await module.stop();
}

async function main() {
  testParsePlayerBlocks();
  testParseLogLine();
  testMonitorState();
  await testParseExplosionDamage();
  console.log("run-bzss-core-monitor-tests: ok");
}

main();
