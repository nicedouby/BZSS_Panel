import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createBzssCoreMonitorModule,
  parseBzssCorePlayerBlocks,
  parseBzssCoreLogLine,
  parseBzssCoreVehicleLine,
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

async function withTempCwd(fn) {
  const previous = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bzss-core-monitor-"));
  process.chdir(tempDir);
  try {
    return await fn(tempDir);
  } finally {
    process.chdir(previous);
    fs.rmSync(tempDir, { recursive: true, force: true });
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
  const vehicleFrame = parseBzssCoreVehicleLine("LogSquad: Warning: VRI{{ID:42,VT:Tank,HP:87.5,PosX=10.5 Y=-20 Z=3,Speed:1.25,TID:1}{ID:-1,VT:APC,HP:100,PosX=1,Y=2,Z=3,Speed:0,TID:2}}");
  assert.equal(vehicleFrame.type, "vehicles");
  assert.equal(vehicleFrame.vehicles.length, 2);
  assert.equal(vehicleFrame.vehicles[0].driverPlayerId, 42);
  assert.equal(vehicleFrame.vehicles[0].healthPercent, 87.5);
  assert.deepEqual(vehicleFrame.vehicles[0].position, { x: 10.5, y: -20, z: 3 });
  assert.equal(vehicleFrame.vehicles[1].driverPlayerId, null);
  assert.equal(vehicleFrame.vehicles[1].occupied, false);
  assert.deepEqual(vehicleFrame.vehicles[1].position, { x: 1, y: 2, z: 3 });

  const directVehicleFrame = parseBzssCoreVehicleLine("PIE: VRI{DriverID=8,VehicleType=M1126 Stryker,Health=450/600,Position=100.5,-25,8,Velocity=4.25,TeamID=2}");
  assert.equal(directVehicleFrame.vehicles.length, 1);
  assert.equal(directVehicleFrame.vehicles[0].driverPlayerId, 8);
  assert.equal(directVehicleFrame.vehicles[0].vehicleType, "M1126 Stryker");
  assert.equal(directVehicleFrame.vehicles[0].healthPercent, 75);
  assert.deepEqual(directVehicleFrame.vehicles[0].position, { x: 100.5, y: -25, z: 8 });
  assert.equal(directVehicleFrame.vehicles[0].teamId, 2);

  const namedVehicleFrame = parseBzssCoreLogLine("PIE: VehicleInfo{{ID:-1,Type:Tank,HP:55%,PosX=1 Y=2 Z=3,Speed:0,Team:1}}");
  assert.equal(namedVehicleFrame.type, "vehicles");
  assert.equal(namedVehicleFrame.vehicles.length, 1);
  assert.equal(namedVehicleFrame.vehicles[0].vehicleType, "Tank");
  assert.equal(namedVehicleFrame.vehicles[0].healthPercent, 55);

  const blueprintVehicleFrame = parseBzssCoreVehicleLine("PIE: Warning: VRI{{ID:-1,VT:Tank,HP:(3000.0/3000.0),,PosX=625.555 Y=1393.131 Z=12.490-146.583527,Speed:0.0,TID:2,}}");
  assert.equal(blueprintVehicleFrame.vehicles.length, 1);
  assert.equal(blueprintVehicleFrame.vehicles[0].healthPercent, 100);
  assert.deepEqual(blueprintVehicleFrame.vehicles[0].position, { x: 625.555, y: 1393.131, z: 12.49 });

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

  const priFrameRuntime = parseBzssCoreLogLine("PIE: PRIFrame{Frame=12345,Chunk=1/2,Count=1,Total=2}{{88,123.4,567.8,9,180,{0,150.0,false,NW,}}}");
  assert.equal(priFrameRuntime.type, "playerRuntime");
  assert.equal(priFrameRuntime.runtimePlayers.length, 1);
  assert.equal(priFrameRuntime.runtimePlayers[0].playerIndex, 88);
  assert.equal(Math.round(priFrameRuntime.runtimePlayers[0].position.x), 12340);
  assert.equal(Math.round(priFrameRuntime.runtimePlayers[0].position.y), 56780);
  assert.equal(Math.round(priFrameRuntime.runtimePlayers[0].position.z), 900);
  assert.equal(priFrameRuntime.priFrame.frameId, "12345");
  assert.equal(priFrameRuntime.priFrame.chunkIndex, 1);
  assert.equal(priFrameRuntime.priFrame.chunkCount, 2);
  assert.equal(priFrameRuntime.priFrame.totalPlayers, 2);

  const compactRuntime = parseBzssCoreLogLine("PIE: Error: {ID:0,Pos:-1295,-1465,3,8,CI{0,125,QBZ191,}}/n/");
  assert.equal(compactRuntime.type, "playerRuntime");
  assert.equal(compactRuntime.runtimePlayers.length, 1);
  assert.equal(compactRuntime.runtimePlayers[0].playerIndex, 0);
  assert.deepEqual(compactRuntime.runtimePlayers[0].position, { x: -129500, y: -146500, z: 300 });
  assert.equal(compactRuntime.runtimePlayers[0].yaw, 8);
  assert.equal(compactRuntime.runtimePlayers[0].combatInfo, "CI{0,125,QBZ191,}");
  assert.equal(compactRuntime.runtimePlayers[0].soldierInfo.raw, "CI{0,125,QBZ191,}");
  assert.deepEqual(compactRuntime.runtimePlayers[0].soldierInfo.fields, ["0", "125", "QBZ191"]);
  assert.equal(compactRuntime.runtimePlayers[0].soldierInfo.health, 125);
  assert.equal(compactRuntime.runtimePlayers[0].soldierInfo.weaponClass, "QBZ191");

  const invalidPawnRuntime = parseBzssCoreLogLine("PIE: Error: {ID:2,Pos:InvalidPawn,CI{0,125,M16A4,}}/n/");
  assert.equal(invalidPawnRuntime.type, "playerRuntime");
  assert.equal(invalidPawnRuntime.runtimePlayers.length, 1);
  assert.equal(invalidPawnRuntime.runtimePlayers[0].playerIndex, 2);
  assert.equal(invalidPawnRuntime.runtimePlayers[0].position, null);
  assert.equal(invalidPawnRuntime.runtimePlayers[0].yaw, null);
  assert.equal(invalidPawnRuntime.runtimePlayers[0].presenceHint, "noPawn");
  assert.equal(invalidPawnRuntime.runtimePlayers[0].combatInfo, "CI{0,125,M16A4,}");
  assert.equal(invalidPawnRuntime.runtimePlayers[0].soldierInfo.raw, "CI{0,125,M16A4,}");
  assert.equal(invalidPawnRuntime.runtimePlayers[0].soldierInfo.health, 125);
  assert.equal(invalidPawnRuntime.runtimePlayers[0].soldierInfo.weaponClass, "M16A4");

  const compactMultiRuntime = parseBzssCoreLogLine(
    "PIE: Error: {ID:0,Pos:-1295,-1465,3,8,CI{0,125,QBZ191,}}/n/\n{ID:1,Pos:10,20,3,90,CI{0,100,M4,}}/n/"
  );
  assert.equal(compactMultiRuntime.type, "playerRuntime");
  assert.equal(compactMultiRuntime.runtimePlayers.length, 2);
  assert.deepEqual(
    compactMultiRuntime.runtimePlayers.map((player) => player.playerIndex),
    [0, 1],
  );
  assert.equal(compactMultiRuntime.runtimePlayers[1].soldierInfo.weaponClass, "M4");

  const compactMixedRuntime = parseBzssCoreLogLine(
    "PIE: Error: {ID:3,Pos:-168,193,-133,98,CI{0,125,M16A4,}}/n/{ID:2,Pos:InvalidPawn,CI{0,125,M16A4,}}/n/{ID:7,Pos:InvalidPawn,CI{0,125,M16A4,}}/n/{ID:4,Pos:43,64,-130,-90,CI{0,-300,QBU-191,}}/n/{ID:6,Pos:27,124,-134,49,CI{0,125,M249,}}/n/"
  );
  assert.equal(compactMixedRuntime.type, "playerRuntime");
  assert.equal(compactMixedRuntime.runtimePlayers.length, 5);
  assert.deepEqual(
    compactMixedRuntime.runtimePlayers.map((player) => player.playerIndex),
    [3, 2, 7, 4, 6],
  );
  assert.equal(compactMixedRuntime.runtimePlayers[1].presenceHint, "noPawn");
  assert.equal(compactMixedRuntime.runtimePlayers[1].combatInfo, "CI{0,125,M16A4,}");
  assert.equal(compactMixedRuntime.runtimePlayers[2].presenceHint, "noPawn");
  assert.equal(compactMixedRuntime.runtimePlayers[2].combatInfo, "CI{0,125,M16A4,}");
  assert.deepEqual(compactMixedRuntime.runtimePlayers[3].position, { x: 4300, y: 6400, z: -13000 });
  assert.equal(compactMixedRuntime.runtimePlayers[4].soldierInfo.weaponClass, "M249");

  const compactAnonymousRuntime = parseBzssCoreLogLine(
    "PIE: Error: {ID:6,Pos:777,1505,0,112,{1,1000.0/1000.0,None,13}}/n/"
  );
  assert.equal(compactAnonymousRuntime.type, "playerRuntime");
  assert.equal(compactAnonymousRuntime.runtimePlayers.length, 1);
  assert.equal(compactAnonymousRuntime.runtimePlayers[0].playerIndex, 6);
  assert.deepEqual(compactAnonymousRuntime.runtimePlayers[0].position, { x: 77700, y: 150500, z: 0 });
  assert.equal(compactAnonymousRuntime.runtimePlayers[0].yaw, 112);
  assert.equal(compactAnonymousRuntime.runtimePlayers[0].combatInfo, "{1,1000.0/1000.0,None,13}");
  assert.equal(compactAnonymousRuntime.runtimePlayers[0].compactStateInfo?.stateCode, 1);
  assert.equal(compactAnonymousRuntime.runtimePlayers[0].compactStateInfo?.health, 1000);
  assert.equal(compactAnonymousRuntime.runtimePlayers[0].compactStateInfo?.maxHealth, 1000);
  assert.equal(compactAnonymousRuntime.runtimePlayers[0].compactStateInfo?.seatIndex, 13);

  const compactAnonymousInvalidPawnRuntime = parseBzssCoreLogLine(
    "PIE: Error: {ID:2,Pos:InvalidPawn,{1,1000.0/1000.0,None,13}}/n/"
  );
  assert.equal(compactAnonymousInvalidPawnRuntime.type, "playerRuntime");
  assert.equal(compactAnonymousInvalidPawnRuntime.runtimePlayers.length, 1);
  assert.equal(compactAnonymousInvalidPawnRuntime.runtimePlayers[0].playerIndex, 2);
  assert.equal(compactAnonymousInvalidPawnRuntime.runtimePlayers[0].position, null);
  assert.equal(compactAnonymousInvalidPawnRuntime.runtimePlayers[0].yaw, null);
  assert.equal(compactAnonymousInvalidPawnRuntime.runtimePlayers[0].presenceHint, "noPawn");
  assert.equal(compactAnonymousInvalidPawnRuntime.runtimePlayers[0].combatInfo, "{1,1000.0/1000.0,None,13}");

  const compactAnonymousOnlyRuntime = parseBzssCoreLogLine(
    "PIE: Error: {ID:2,Pos:InvalidPawn,{1,1000.0/1000.0,None,13}}/n/{ID:6,Pos:499,-43,-4,170,{3}}/n/{ID:1,Pos:866,1590,-4,-139,{1,1000.0/1000.0,None,13}}/n/"
  );
  assert.equal(compactAnonymousOnlyRuntime.type, "playerRuntime");
  assert.equal(compactAnonymousOnlyRuntime.runtimePlayers.length, 3);
  assert.deepEqual(
    compactAnonymousOnlyRuntime.runtimePlayers.map((player) => player.playerIndex),
    [2, 6, 1],
  );
  assert.equal(compactAnonymousOnlyRuntime.runtimePlayers[0].presenceHint, "noPawn");
  assert.equal(compactAnonymousOnlyRuntime.runtimePlayers[1].combatInfo, "{3}");
  assert.deepEqual(compactAnonymousOnlyRuntime.runtimePlayers[2].position, { x: 86600, y: 159000, z: -400 });

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

  const scene = parseBzssCoreLogLine("PIE: CPZ:{01-TriCommons,X=100 Y=200 Z=0,true,1.0,1}{02-AbdelsFarm,X=300 Y=400 Z=0,true,1.0,2},FOBI:{,X=15160.000 Y=-2150.000 Z=-12980.000,1,Very_Small,300.0,8152.0,4225.0,},MainZone:{1,X=56820.773 Y=7170.025 Z=-13376.360}");
  assert.equal(scene.type, "scene");
  assert.equal(scene.captureZones.length, 2);
  assert.equal(scene.captureZones[0].teamId, 1);
  assert.equal(scene.captureZones[0].ownerTeamId, 1);
  assert.equal(scene.captureZones[1].teamId, 2);
  assert.deepEqual(scene.fobs[0].position, { x: 15160, y: -2150, z: -12980 });
  assert.equal(scene.fobs[0].teamId, 1);
  assert.equal(scene.fobs[0].ammo, 8152);
  assert.equal(scene.fobs[0].construction, 4225);
  assert.equal(scene.fobs.length, 1);
  assert.equal(scene.mainZones.length, 1);

  const fullBlockScene = parseBzssCoreLogLine(
    "PIE: CaptureZones{CaptureZone{B1-Airfield,Position:X=-57095.684 Y=-126662.330 Z=904.580}CaptureZone{B7-Kiriku,Position:X=63855.960 Y=64688.161 Z=642.812}}FOBs{FobInfo{TeamID=1,Health=300.0,IsBleeding=false,Ammo=10000.0,Construction=2000.0,Name=Alpha,Position=X=10.0 Y=20.0 Z=30.0}}MainZones{MainZone{1,X=-117217.094 Y=-83417.945 Z=1423.340}}"
  );
  assert.equal(fullBlockScene.type, "captureZones");
  assert.equal(fullBlockScene.captureZones.length, 2);
  assert.equal(fullBlockScene.captureZones[0].name, "B1-Airfield");
  assert.equal(fullBlockScene.captureZones[1].name, "B7-Kiriku");
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
  assert.equal(typeof module.api.getTelemetryPlayers, "function");
  assert.equal(module.api.ingestLogLine("PIE: VRI{{ID:7,VT:Tank,HP:75,PosX=1 Y=2 Z=3,Speed:0.5,TID:1}}").ok, true);
  assert.equal(module.api.getVehicles().length, 1);
  assert.equal(module.api.getState().vehicleCount, 1);
  assert.equal(module.api.ingestLogLine("PIE: VRI{}").ok, true);
  assert.equal(module.api.getVehicles().length, 0);

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
  assert.deepEqual(module.api.getTelemetryPlayers().map((player) => player.playerIndex).sort((a, b) => a - b), module.api.getPlayers().map((player) => player.playerIndex).sort((a, b) => a - b));

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

  assert.equal(module.api.ingestLogLine("PIE: CPZ:{01-TriCommons,X=100 Y=200 Z=0,true,1.0,1},FOBI:{,1,Very_Small,300.0,10000.0,2000.0,},MainZone:{1,X=56820.773 Y=7170.025 Z=-13376.360}").ok, true);
  const raw = module.api.getRawSnapshot();
  assert.equal(raw.runtimePlayers.length, 3);
  assert.equal(raw.scoreboardPlayers.length, 3);
  assert.equal(raw.captureZones.length, 1);
  assert.equal(raw.captureZones[0].teamId, 1);
  assert.equal(raw.captureZones[0].ownerTeamId, 1);
  assert.equal(raw.fobs.length, 1);
  assert.equal(raw.mainZones.length, 1);
  assert.ok(raw.rawLineHash);

  const compactRuntimeModule = createBzssCoreMonitorModule({
    core: {
      eventBus: { onCoreEvent() { return () => {}; }, emitModuleEvent() {} },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
  });
  assert.equal(
    compactRuntimeModule.api.ingestLogLine(
      "PIE: Error: {ID:0,Pos:-1295,-1465,3,8,CI{0,125,QBZ191,}}/n/{ID:1,Pos:InvalidPawn,CI{0,100,M4,}}/n/{ID:2,Pos:10,20,3,90,CI{0,100,M4,}}/n/"
    ).ok,
    true,
  );
  assert.equal(compactRuntimeModule.api.getRuntimePlayers().length, 3);
  assert.deepEqual(
    compactRuntimeModule.api.getRuntimePlayers().map((player) => player.playerIndex),
    [0, 1, 2],
  );
  assert.equal(compactRuntimeModule.api.getRuntimePlayers()[0].soldierInfo.weaponClass, "QBZ191");
  assert.equal(compactRuntimeModule.api.getRuntimePlayers()[1].presenceHint, "noPawn");
  assert.equal(compactRuntimeModule.api.getRuntimePlayers()[1].position, null);
  assert.equal(compactRuntimeModule.api.getRuntimePlayers()[1].soldierInfo.health, 100);
  assert.equal(compactRuntimeModule.api.getRuntimePlayers()[1].soldierInfo.weaponClass, "M4");
  const compactInvalidPawnMerged = compactRuntimeModule.api.getPlayers().find((player) => player.playerIndex === 1);
  assert.ok(compactInvalidPawnMerged);
  assert.equal(compactInvalidPawnMerged.presenceHint, "noPawn");
  assert.equal(compactInvalidPawnMerged.presence?.state, "noPawn");
  assert.equal(compactInvalidPawnMerged.telemetry?.position, null);

  const compactAnonymousRuntimeModule = createBzssCoreMonitorModule({
    core: {
      eventBus: { onCoreEvent() { return () => {}; }, emitModuleEvent() {} },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
  });
  assert.equal(
    compactAnonymousRuntimeModule.api.ingestLogLine(
      "PIE: Error: {ID:2,Pos:InvalidPawn,{1,1000.0/1000.0,None,13}}/n/{ID:6,Pos:499,-43,-4,170,{3}}/n/{ID:1,Pos:866,1590,-4,-139,{1,1000.0/1000.0,None,13}}/n/"
    ).ok,
    true,
  );
  assert.deepEqual(
    compactAnonymousRuntimeModule.api.getRuntimePlayers().map((player) => player.playerIndex),
    [2, 6, 1],
  );
  const anonymousNoPawnPlayer = compactAnonymousRuntimeModule.api.getPlayers().find((player) => player.playerIndex === 2);
  assert.ok(anonymousNoPawnPlayer);
  assert.equal(anonymousNoPawnPlayer.presenceHint, "noPawn");
  assert.equal(anonymousNoPawnPlayer.presence?.state, "noPawn");
  assert.equal(anonymousNoPawnPlayer.telemetry?.position, null);
  const anonymousActivePlayer = compactAnonymousRuntimeModule.api.getPlayers().find((player) => player.playerIndex === 1);
  assert.ok(anonymousActivePlayer);
  assert.deepEqual(anonymousActivePlayer.telemetry?.position, { x: 86600, y: 159000, z: -400 });
  assert.equal(anonymousActivePlayer.combatInfo, "{1,1000.0/1000.0,None,13}");

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

  assert.equal(module.api.ingestLogLine("PIE: PRI{{42,321,654,7,135,{0,100.0,false,NW,}}}").ok, true);
  const afterRespawn = module.api.getPlayers().find((p) => p.playerIndex === 42);
  assert.ok(afterRespawn);
  assert.equal(afterRespawn.presenceHint, "");
  assert.equal(afterRespawn.presence?.state, "active");
  assert.deepEqual(afterRespawn.telemetry?.position, { x: 32100, y: 65400, z: 700 });
  assert.equal(afterRespawn.telemetry?.yaw, 135);

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

  const rconOnlinePlayers = Array.from({ length: 100 }, (_, index) => {
    const playerID = index + 1;
    return {
      playerID,
      name: `RCON Player ${playerID}`,
      steamID: `7656119800000${String(playerID).padStart(3, "0")}`,
      eosID: `eos-${playerID}`,
      controllerID: String(playerID),
      teamID: playerID % 2 === 0 ? 2 : 1,
      squadID: (playerID % 9) + 1,
      role: "BP_SoldierRole_Rifleman",
      online: true,
    };
  });
  const rconTemplateModule = createBzssCoreMonitorModule({
    core: {
      eventBus: { onCoreEvent() { return () => {}; }, emitModuleEvent() {} },
      webStatus: { serverId: "server-rcon" },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
    modules: {
      playerState: {
        getOnlinePlayers(serverId) {
          assert.equal(serverId, "server-rcon");
          return rconOnlinePlayers;
        },
      },
    },
  });
  assert.equal(rconTemplateModule.api.ingestLogLine(priBatch(1, 12)).ok, true);
  const rconTemplatePlayers = rconTemplateModule.api.getPlayers();
  assert.equal(rconTemplatePlayers.length, 100);
  assert.equal(rconTemplateModule.api.getState().playerCount, 100);
  assert.equal(rconTemplatePlayers.every((player) => player.playerName && player.steamID && player.eosID && player.teamId != null && player.squadId != null), true);
  const rconRuntimeHits = rconTemplatePlayers.filter((player) => player.playerIndex <= 12);
  assert.equal(rconRuntimeHits.length, 12);
  assert.equal(rconRuntimeHits.every((player) => player.position && player.yaw != null && player.soldierInfo?.position), true);
  const rconOnlyPlayers = rconTemplatePlayers.filter((player) => player.playerIndex > 12);
  assert.equal(rconOnlyPlayers.length, 88);
  assert.equal(rconOnlyPlayers.every((player) => ["rconOnly", "scoreboardOnly"].includes(player.presence?.state)), true);
  assert.equal(rconTemplatePlayers.find((player) => player.playerIndex === 1)?.playerName, "RCON Player 1");
  assert.equal(rconTemplatePlayers.find((player) => player.playerIndex === 1)?.role, "BP_SoldierRole_Rifleman");
  assert.equal(rconTemplatePlayers.find((player) => player.playerIndex === 1)?.rcon?.online, true);
  const rconState = rconTemplateModule.api.getState();
  assert.equal(rconState.rconOnlinePlayerCount, 100);
  assert.deepEqual(rconState.runtimeCoverage, {
    expectedCount: 100,
    actualCount: 12,
    missingCount: 88,
    complete: false,
  });
  assert.deepEqual(rconState.scoreboardCoverage, {
    expectedCount: 100,
    actualCount: 0,
    missingCount: 100,
    complete: false,
  });
  const rconRaw = rconTemplateModule.api.getRawSnapshot();
  assert.equal(rconRaw.runtimePlayers.length, 12);
  assert.equal(rconRaw.scoreboardPlayers.length, 0);

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

async function testPriFrameAssembler() {
  const module = createBzssCoreMonitorModule({
    core: {
      eventBus: { onCoreEvent() { return () => {}; }, emitModuleEvent() {} },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
  });

  const chunk1 = "PIE: PRIFrame{Frame=87654,Chunk=1/2,Count=2,Total=4}{{1,10,11,12,90,{0,150.0,false,NW,}}{2,20,21,22,180,{0,150.0,false,BP_M4_C,false,}}}";
  const chunk2 = "PIE: PRIFrame{Frame=87654,Chunk=2/2,Count=2,Total=4}{{3,30,31,32,270,{0,150.0,false,NW,}}{4,40,41,42,0,{0,150.0,false,BP_M4_C,false,}}}";
  assert.equal(module.api.ingestLogLine(chunk1).ok, true);
  assert.equal(module.api.getRuntimePlayers().length, 0);
  assert.deepEqual(module.api.getState().priFrame, {
    frameId: "87654",
    complete: false,
    legacy: false,
    chunks: 2,
    receivedChunks: [1],
    missingChunks: [2],
    playerCount: 2,
    expectedPlayerCount: 4,
    updatedAt: module.api.getState().priFrame.updatedAt,
  });

  assert.equal(module.api.ingestLogLine(chunk2).ok, true);
  assert.equal(module.api.getRuntimePlayers().length, 4);
  assert.equal(module.api.getState().priFrame.frameId, "87654");
  assert.equal(module.api.getState().priFrame.complete, true);
  assert.deepEqual(module.api.getState().priFrame.receivedChunks, [1, 2]);
  assert.deepEqual(module.api.getState().priFrame.missingChunks, []);
  assert.equal(module.api.getState().priFrame.playerCount, 4);

  const partialModule = createBzssCoreMonitorModule({
    core: {
      eventBus: { onCoreEvent() { return () => {}; }, emitModuleEvent() {} },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    },
  });
  assert.equal(partialModule.api.ingestLogLine(chunk1.replace("87654", "90001")).ok, true);
  await sleep(650);
  assert.equal(partialModule.api.getRuntimePlayers().length, 2);
  assert.equal(partialModule.api.getState().priFrame.frameId, "90001");
  assert.equal(partialModule.api.getState().priFrame.complete, false);
  assert.deepEqual(partialModule.api.getState().priFrame.missingChunks, [2]);
  assert.equal(partialModule.api.getState().priFrame.playerCount, 2);
  assert.equal(
    partialModule.api.getRawSnapshot().diagnostics.some((entry) => entry.type === "priFrame" && entry.reason === "timeout_partial" && entry.frameId === "90001"),
    true,
  );

  await module.stop();
  await partialModule.stop();
}

async function testParseExplosionDamage() {
  const line = "[2026.06.30-08.00.41:404][702]LogSquadTrace: [DedicatedServer]ApplyExplosiveDamage(): HitActor=nullptr DamageCauser=BP_M67Frag_C_2147006951 DamageInstigator=BP_PlayerController_C_2147480791 ExplosionLocation=V(X=-7008.21, Y=11835.69, Z=-13475.49)";
  const parsed = parseBzssCoreLogLine(line);
  assert.ok(parsed);
  assert.equal(parsed.type, "explosiveDamage");
  assert.ok(parsed.explosion);
  assert.ok(parsed.explosion.id.startsWith("exp-"));
  assert.equal(parsed.explosion.x, -7008.21);
  assert.equal(parsed.explosion.y, 11835.69);
  assert.equal(parsed.explosion.z, -13475.49);
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
  assert.equal(snapshot.explosions[0].x, -7008.21);
  assert.equal(snapshot.explosions[0].damageCauser, "BP_M67Frag_C_2147006951");

  await sleep(3100);
  const snapshotAfter = module.api.getRawSnapshot();
  assert.equal(snapshotAfter.explosions.length, 0);

  await module.stop();
}

async function testRawCaptureFileLifecycle() {
  await withTempCwd(async (tempDir) => {
    const module = createBzssCoreMonitorModule({
      config: {
        get(key, defaultValue) {
          if (key === "modules.bzssCoreMonitor.rawCapture.enabled") {
            return true;
          }
          return defaultValue;
        },
      },
      core: {
        eventBus: { onCoreEvent() { return () => {}; }, emitModuleEvent() {} },
        logger: { info() {}, warn() {}, error() {}, debug() {} },
      },
    });

    const capturePath = module.api.getRawCapturePath();
    fs.mkdirSync(path.dirname(capturePath), { recursive: true });
    fs.writeFileSync(capturePath, "stale\n", "utf8");

    await module.start();
    assert.equal(fs.existsSync(capturePath), false);

    const line = "PIE: Error: {ID:3,Pos:-168,193,-133,98,CI{0,125,M16A4,}}/n/";
    assert.equal(module.api.ingestLogLine(line).ok, true);
    assert.equal(fs.existsSync(capturePath), true);

    const entries = fs.readFileSync(capturePath, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((row) => JSON.parse(row));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].rawLine, line);
    assert.ok(typeof entries[0].observedAt === "string" && entries[0].observedAt.length > 0);
    assert.ok(capturePath.startsWith(tempDir));

    await module.stop();
  });
}


async function testRawCaptureRotation() {
  await withTempCwd(async () => {
    const module = createBzssCoreMonitorModule({
      config: {
        get(key, defaultValue) {
          if (key === "modules.bzssCoreMonitor.rawCapture.enabled") return true;
          if (key === "modules.bzssCoreMonitor.rawCapture.maxFileBytes") return 1024;
          if (key === "modules.bzssCoreMonitor.rawCapture.maxFiles") return 3;
          return defaultValue;
        },
      },
      core: {
        eventBus: { onCoreEvent() { return () => {}; }, emitModuleEvent() {} },
        logger: { info() {}, warn() {}, error() {}, debug() {} },
      },
    });

    await module.start();
    const capturePath = module.api.getRawCapturePath();
    for (let index = 0; index < 80; index += 1) {
      module.api.ingestLogLine(`PIE: Raw capture rotation line ${index} ${"x".repeat(120)}`);
    }
    await module.stop();

    const base = capturePath.replace(/\.jsonl$/, "");
    const files = [capturePath, `${base}.1.jsonl`, `${base}.2.jsonl`];
    assert.equal(files.every((file) => fs.existsSync(file)), true);
    assert.equal(fs.existsSync(`${base}.3.jsonl`), false);
    for (const file of files) {
      const size = fs.statSync(file).size;
      assert.ok(size > 0);
      assert.ok(size <= 1024);
      for (const row of fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean)) {
        JSON.parse(row);
      }
    }
  });
}

async function testChunkSubscriptionAndNoRawCapture() {
  await withTempCwd(async (tempDir) => {
    const listeners = new Map();
    const module = createBzssCoreMonitorModule({
      config: {
        get(key, defaultValue) {
          if (key === "modules.bzssCoreMonitor.rawCapture.enabled") {
            return false;
          }
          return defaultValue;
        },
      },
      core: {
        eventBus: {
          onCoreEvent(eventName, handler) {
            if (!listeners.has(eventName)) listeners.set(eventName, new Set());
            listeners.get(eventName).add(handler);
            return () => listeners.get(eventName)?.delete(handler);
          },
          emitModuleEvent() {},
        },
        logger: { info() {}, warn() {}, error() {}, debug() {} },
      },
    });

    await module.start();
    assert.equal(listeners.has("On_BzssCorePlayerChunk"), true);
    const handler = [...(listeners.get("On_BzssCorePlayerChunk") ?? [])][0];
    assert.equal(typeof handler, "function");

    const capturePath = module.api.getRawCapturePath();
    assert.equal(fs.existsSync(capturePath), false);

    assert.equal(
      module.api.ingestPlayerChunk({
        version: "v1",
        seq: "42",
        tick: "12345",
        count: "1",
        players: [[7, 0, 0, 1, 2, 3, 4, 55, "Alpha", 9, 1, 2]],
      }, "" ).ok,
      true,
    );

    const runtimePlayers = module.api.getRuntimePlayers();
    assert.equal(runtimePlayers.length, 1);
    assert.equal(runtimePlayers[0].playerId, 7);
    assert.equal(runtimePlayers[0].playerIndex, 7);
    assert.equal(runtimePlayers[0].playerName, "Alpha");
    assert.equal(fs.existsSync(capturePath), false);
    assert.ok(capturePath.startsWith(tempDir));

    await module.stop();
  });
}

async function main() {
  testParsePlayerBlocks();
  testParseLogLine();
  testMonitorState();
  await testPriFrameAssembler();
  await testParseExplosionDamage();
  await testChunkSubscriptionAndNoRawCapture();
  await testRawCaptureFileLifecycle();
  await testRawCaptureRotation();
  console.log("run-bzss-core-monitor-tests: ok");
}

main();
