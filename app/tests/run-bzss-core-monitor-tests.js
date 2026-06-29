import assert from "node:assert/strict";

import {
  createBzssCoreMonitorModule,
  parseBzssCorePlayerBlocks,
  parseBzssCoreLogLine,
} from "../modules/bzss-core-monitor/index.js";

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
  assert.deepEqual(players[0].soldierInfo.position, { x: 15014, y: -1672, z: -12490 });
  assert.equal(players[1].playerIndex, 0);
}

function testParseLogLine() {
  const runtime = parseBzssCoreLogLine("PIE: Error: PlayerBaseInfo{}");
  assert.equal(runtime.type, "playerRuntime");
  assert.equal(runtime.runtimePlayers.length, 0);

  const scoreboard = parseBzssCoreLogLine("PIE: PlayerScoreboard{0,1,-1,0,0,0,0,0,0,0,0,0,0,0,1,0-1,-1,19}}");
  assert.equal(scoreboard.type, "playerScoreboard");
  assert.equal(scoreboard.scoreboardPlayers.length, 1);
  assert.equal(scoreboard.scoreboardPlayers[0].playerIndex, 0);
  assert.equal(scoreboard.scoreboardPlayers[0].fireTeamIndex, -1);
  assert.equal(scoreboard.scoreboardPlayers[0].fireTeamPosition, 19);

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
  assert.equal(module.api.ingestLogLine("PIE: PlayerScoreboard{0,1,-1,0,0,0,0,0,0,0,0,0,0,0,1,0-1,-1,19}}").ok, true);
  assert.equal(module.api.getScoreboardPlayers().length, 1);
  assert.equal(module.api.getScoreboardPlayers()[0].playerIndex, 0);
  assert.equal(module.api.ingestLogLine("PIE: CPZ:{01-TriCommons,true,1.0,1},FOBI:{,1,Very_Small,300.0,10000.0,2000.0,},MainZone:{1,X=56820.773 Y=7170.025 Z=-13376.360}").ok, true);
  const raw = module.api.getRawSnapshot();
  assert.equal(raw.runtimePlayers.length, 0);
  assert.equal(raw.scoreboardPlayers.length, 1);
  assert.equal(raw.captureZones.length, 1);
  assert.equal(raw.fobs.length, 1);
  assert.equal(raw.mainZones.length, 1);
  assert.ok(raw.rawLineHash);
}

function main() {
  testParsePlayerBlocks();
  testParseLogLine();
  testMonitorState();
  console.log("run-bzss-core-monitor-tests: ok");
}

main();
