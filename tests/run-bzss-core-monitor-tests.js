import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createBzssCoreMonitorModule,
  extractBzssCoreTrackedText,
  parseBzssCorePlayerBlocks,
} from "../modules/bzss-core-monitor/index.js";

function testExtractBzssCoreTrackedTextReadsUtf16Block() {
  const payload = "PlayerBaseInfo{0,abc123,Donald DoubyBear,1,0,-1,-1}"
    + "SoldierInfo{BP_Soldier_PLA_Rifleman1_Arid_C_2147477191,100,0,0,0,0,0,0,"
    + "BP_QBZ191_IronSights_C_2147477184,19,30,30,30,30,30,30{X=15014 Y=-1672 Z=-12490}{X=0 Y=0 Z=93}}"
    + "PlayerScoreboard{-1,0,0,0,0,0,0,0,0,0,0,0}"
    + "{BZSS-Marked}";
  const buffer = Buffer.concat([
    Buffer.from("junk", "utf8"),
    Buffer.from(payload, "utf16le"),
    Buffer.from("tail", "utf8"),
  ]);

  const result = extractBzssCoreTrackedText(buffer);
  assert.equal(result.markerSeen, true);
  assert.ok(result.text.includes("PlayerBaseInfo{0,abc123"));
  assert.ok(result.text.includes("{BZSS-Marked}"));
}

function testParseBzssCorePlayerBlocksParsesPlayersAndVectors() {
  const text = "PlayerBaseInfo{0,abc123,Donald DoubyBear,1,0,-1,-1}"
    + "SoldierInfo{BP_Soldier_PLA_Rifleman1_Arid_C_2147477191,100,0,0,0,0,0,0,"
    + "BP_QBZ191_IronSights_C_2147477184,19,30,30,30,30,30,30{X=15014 Y=-1672 Z=-12490}{X=0 Y=0 Z=93}}"
    + "PlayerScoreboard{-1,0,0,0,0,0,0,0,0,0,0,0}"
    + "PlayerBaseInfo{0,def456,Second Player,2,7,-1,-1}"
    + "SoldierInfo{BP_Soldier_US_Rifleman_C,85,0,0,0,0,0,0,BP_M4_C,7,120{X=10 Y=20 Z=30}{X=0 Y=90 Z=0}}"
    + "PlayerScoreboard{1,2,3}";

  const players = parseBzssCorePlayerBlocks(text);
  assert.equal(players.length, 2);
  assert.equal(players[0].playerName, "Donald DoubyBear");
  assert.equal(players[0].soldierInfo.weaponClass, "BP_QBZ191_IronSights_C_2147477184");
  assert.deepEqual(players[0].soldierInfo.position, { x: 15014, y: -1672, z: -12490 });
  assert.deepEqual(players[0].playerScoreboard.numericValues.slice(0, 3), [-1, 0, 0]);
  assert.equal(players[1].teamId, 2);
  assert.equal(players[1].squadId, 7);
}

function testParseBzssCorePlayerBlocksAcceptsMissingSoldierInfo() {
  const text = "PlayerBaseInfo{0,abc123,Donald DoubyBear,1,0,0,0}"
    + "PlayerScoreboard{-1,0,0,9,0,9,0,0,0,0,0,0}"
    + "{BZSS-Marked}";

  const players = parseBzssCorePlayerBlocks(text);
  assert.equal(players.length, 1);
  assert.equal(players[0].playerName, "Donald DoubyBear");
  assert.equal(players[0].soldierInfo.soldierClass, "");
  assert.equal(players[0].soldierInfo.health, null);
  assert.deepEqual(players[0].playerScoreboard.numericValues.slice(0, 4), [-1, 0, 0, 9]);
}

function testParseBzssCorePlayerBlocksAcceptsNamedFieldsAndExtraBlocks() {
  const text = "PlayerBaseInfo{PlayerID:0,PlayerOnlineID:00026a0bbf67442f84777b964560fba4,PlayerName:Donald·DoubyBear,IsAdmin:1,IsCommander:0,FTIndex:0,FTPosition:0}"
    + "{NoExistingClaimedInfo}SeatsPlayers{Donald·DoubyBear,}{VehicleType:TruckTransportHealth:750.0/750.0}"
    + "PlayerScoreboard{-1,0,0,1,0,1,1,0,0,0,260,0}"
    + "PlayerBaseInfo{PlayerID:1,PlayerOnlineID:0002633b5836480d9593507d5ea0d8c7,PlayerName:Braovo,IsAdmin:1,IsCommander:0,FTIndex:-1,FTPosition:-1}"
    + "{NoExistingClaimedInfo}SeatsPlayers{Braovo,}{VehicleType:TruckTransport,Health:750.0/750.0Position:X=56779.162 Y=-55024.001 Z=1299.911,Rotation:P=-11.190256 Y=-30.877444 R=-2.920260,Velocity:13.482235}"
    + "PlayerScoreboard{-1,0,0,0,0,0,0,0,0,0,0,0}"
    + "PlayerBaseInfo{PlayerID:2,PlayerOnlineID:00020d7f49c040b58c4aa9cb0fc7a466,PlayerName:小诗不郁,IsAdmin:0,IsCommander:0,FTIndex:0,FTPosition:0}"
    + "SoldierInfo{PawnClass:BP_Soldier_PLA_Medic_Arid_C_2147152878,Health:-300,Bleeding:0,Wounded:0,Dying:1,Crouched:0,Prone:0,Falling:0,WeaponInfo{NoWeapon}Position{X=14669 Y=-1546 Z=-12557}Rotation{X=64 Y=-74 Z=-64}}"
    + "PlayerScoreboard{-1,2,0,5,0,5,2,0,1,20,720,-15}"
    + "PlayerBaseInfo{PlayerID:3,PlayerOnlineID:000217e73c774f029f316ff3cdcbc81c,PlayerName:day,IsAdmin:0,IsCommander:0,FTIndex:-1,FTPosition:-1}"
    + "SoldierInfo{PawnClass:BP_Soldier_AFU_Marksman01_C_2147184874,Health:52,Bleeding:0,Wounded:0,Dying:0,Crouched:0,Prone:1,Falling:0,WeaponInfo{BP_UAR-10_Optic_C_2147184869,10,10,10,10,3}Position{X=143 Y=-4045 Z=-12915}Rotation{X=0 Y=0 Z=63}}"
    + "PlayerScoreboard{-1,34,0,7,9,0,0,0,0,0,550,0}"
    + "PlayerBaseInfo{PlayerID:4,PlayerOnlineID:0002e5d6e53c4a31a53d5de8356d6d8c,PlayerName:篝鬻,IsAdmin:0,IsCommander:0,FTIndex:0,FTPosition:0}"
    + "SoldierInfo{PawnClass:BP_Soldier_PLA_Marksman_Arid_C_2147110510,Health:100,Bleeding:0,Wounded:0,Dying:0,Crouched:0,Prone:1,Falling:0,WeaponInfo{BP_QBU-191_DMR_Optic_QMK-191_Suppressor_C_2147110505,14,30,30,30,30}Position{X=3705 Y=-3540 Z=-12883}Rotation{X=0 Y=0 Z=123}}"
    + "PlayerScoreboard{-1,7,0,4,0,4,0,0,0,0,90,0}"
    + "{BZSS-Marked}";

  const players = parseBzssCorePlayerBlocks(text);
  assert.equal(players.length, 5);
  assert.equal(players[0].playerId, 0);
  assert.equal(players[0].playerName, "Donald·DoubyBear");
  assert.equal(players[0].playerGuid, "00026a0bbf67442f84777b964560fba4");
  assert.equal(players[0].isAdmin, true);
  assert.equal(players[0].isCommander, false);
  assert.equal(players[0].ftIndex, 0);
  assert.equal(players[0].ftPosition, 0);
  assert.deepEqual(players[0].seatsPlayers, ["Donald·DoubyBear"]);
  assert.equal(players[0].vehicleInfo.vehicleType, "TruckTransport");
  assert.equal(players[0].vehicleInfo.health, 750);
  assert.equal(players[0].vehicleInfo.maxHealth, 750);
  assert.equal(players[0].soldierInfo.soldierClass, "");
  assert.deepEqual(players[0].playerScoreboard.numericValues.slice(0, 4), [-1, 0, 0, 1]);
  assert.equal(players[0].playerScoreboard.stats.dataLives, -1);
  assert.equal(players[0].playerScoreboard.stats.numKills, 0);
  assert.equal(players[0].playerScoreboard.stats.numDeaths, 0);
  assert.equal(players[0].playerScoreboard.stats.numWoundeds, 1);
  assert.equal(players[0].playerScoreboard.stats.numWounds, 0);
  assert.equal(players[0].playerScoreboard.stats.numTeamKills, 1);
  assert.equal(players[0].playerScoreboard.stats.healPoints, 1);
  assert.equal(players[0].playerScoreboard.stats.revivedPoints, 0);
  assert.equal(players[0].playerScoreboard.stats.teamworkScore, 0);
  assert.equal(players[0].playerScoreboard.stats.objectiveScore, 0);
  assert.equal(players[0].playerScoreboard.stats.combatScore, 260);
  assert.deepEqual(players[0].playerScoreboard.extraValues, [0]);
  assert.equal(players[1].playerName, "Braovo");
  assert.equal(players[1].ftIndex, -1);
  assert.equal(players[1].vehicleInfo.vehicleType, "TruckTransport");
  assert.equal(players[1].vehicleInfo.health, 750);
  assert.equal(players[1].vehicleInfo.maxHealth, 750);
  assert.equal(players[1].vehicleInfo.healthText, "750.0/750.0");
  assert.deepEqual(players[1].soldierInfo.position, { x: 56779.162, y: -55024.001, z: 1299.911 });
  assert.deepEqual(players[1].soldierInfo.rotation, { x: -11.190256, y: -2.92026, z: -30.877444 });
  assert.equal(players[2].playerName, "小诗不郁");
  assert.equal(players[2].soldierInfo.soldierClass, "BP_Soldier_PLA_Medic_Arid_C_2147152878");
  assert.equal(players[2].soldierInfo.health, -300);
  assert.equal(players[2].soldierInfo.weaponClass, "");
  assert.deepEqual(players[2].soldierInfo.position, { x: 14669, y: -1546, z: -12557 });
  assert.equal(players[3].soldierInfo.weaponClass, "BP_UAR-10_Optic_C_2147184869");
  assert.deepEqual(players[3].soldierInfo.ammoValues, [10, 10, 10, 10, 3]);
  assert.deepEqual(players[3].soldierInfo.rotation, { x: 0, y: 0, z: 63 });
  assert.equal(players[4].playerName, "篝鬻");
  assert.equal(players[4].soldierInfo.weaponClass, "BP_QBU-191_DMR_Optic_QMK-191_Suppressor_C_2147110505");
}

function testParseBzssCorePlayerBlocksAcceptsCaptureZonesAndCompactScoreboard() {
  const text = "PlayerBaseInfo{PlayerID:0,PlayerOnlineID:00026a0bbf67442f84777b964560fba4,PlayerName:Donald·DoubyBear,IsAdmin:1,IsCommander:0,FTIndex:0,FTPosition:0}"
    + "SoldierInfo{PawnClass:BP_Soldier_USMC_Rifleman1_C_2147212519,Health:100,Bleeding:0,Wounded:0,Dying:0,Crouched:0,Prone:0,Falling:0,WeaponInfo{BP_M4_Carryhandle_Foregrip_C_2147212513,30,30,30,30,30,30,30}Position{X=-128858 Y=-142812 Z=320}Rotation{X=0 Y=0 Z=41}}"
    + "PlayerScoreboard{Lives:-1,NumKills:0,VehicleKills:0,NumDeaths:1,Woundeds:0,Wounds:1,TKs:0,HealPoints:0,Revived:0,TeamWork:0,Objective:420,Combat:0Ping:21}"
    + "}TeamID:2{}FOBs{}CaptureZones{CaptureZone{01-AlKhora,Position:X=-57095.684 Y=-126662.330 Z=904.580}CaptureZone{02-WestOutskirts,Position:X=-122747.449 Y=-49634.712 Z=592.186}}{BZSS-Marked}";

  const players = parseBzssCorePlayerBlocks(text);
  assert.equal(players.length, 1);
  assert.equal(players[0].teamId, 2);
  assert.deepEqual(players[0].playerScoreboard.numericValues.slice(0, 12), [-1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 420, 0]);
  assert.equal(players[0].playerScoreboard.stats.combatScore, 0);
  assert.equal(Number(players[0].playerScoreboard.valuesByKey.Ping), 21);
  assert.equal(players[0].ping, 21);
  assert.ok(players[0].rawText.includes("CaptureZones{"));
}

function testParseBzssCorePlayerBlocksReadsNewSquadContext() {
  const text = "[BZSS-Core-PBI]TeamID:1{}TeamID:2{SquadInfo{SquadStateInfo{No RPSquadBaseInfo{Team:2,ID:1,SQName:Squad 1,CreatorID:EOS: 00026a0bbf67442f84777b964560fba4 steam: 76561198194428818,CreationTimeStamp:4174.044434}SquadScoreBoard{Kills:0,VehicleKills:0,Woundeds:0,Wounds:0,Deaths:0,TKs:0,Score:0.0,HealPoints:0.0,RevivedPoints:0.0,TeamWorkScore:0.0,ObjectiveScore:0.0,CombatScore:0.0}}"
    + "PlayerBaseInfo{PlayerID:0,PlayerOnlineID:00026a0bbf67442f84777b964560fba4,PlayerName:Donald·DoubyBear,IsAdmin:1,IsCommander:0,FTIndex:0,FTPosition:0}"
    + "SoldierInfo{PawnClass:BP_Soldier_USMC_Rifleman1_C_2147212519,Health:0,Bleeding:0,Wounded:0,Dying:1,Crouched:0,Prone:0,Falling:0,WeaponInfo{BP_M16A4_1mag_C_2147149543,30}Position{X=-103515 Y=-118062 Z=453}Rotation{X=0 Y=0 Z=-31}}"
    + "PlayerScoreboard{Lives:-1,NumKills:0,VehicleKills:0,NumDeaths:2,Woundeds:0,Wounds:2,TKs:0,HealPoints:0,Revived:0,TeamWork:0,Objective:420,Combat:0Ping:17}}}FOBs{}CaptureZones{CaptureZone{01-AlKhora,Position:X=-57095.684 Y=-126662.330 Z=904.580}}{BZSS-Marked}";

  const players = parseBzssCorePlayerBlocks(text);
  assert.equal(players.length, 1);
  assert.equal(players[0].teamId, 2);
  assert.equal(players[0].squadId, 1);
  assert.equal(players[0].playerScoreboard.stats.numDeaths, 2);
  assert.equal(players[0].playerScoreboard.stats.objectiveScore, 420);
}

async function testMonitorRefreshesFromFileWatcher() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-core-watch-"));
  const savePath = path.join(tempDir, "PBI.sav");
  const module = createBzssCoreMonitorModule({
    core: {
      config: {
        get(key) {
          if (key !== "bzssCore") return {};
          return {
            playerInfoSavePath: savePath,
            playerInfoPollIntervalMs: 5000,
            playerInfoWatchDebounceMs: 0,
          };
        },
      },
      logger: { info() {}, warn() {}, error() {} },
    },
  });

  try {
    await module.start();
    await fs.writeFile(savePath, Buffer.from(
      "PlayerBaseInfo{0,abc123,Watcher Player,1,0,-1,-1}"
      + "PlayerScoreboard{-1,0,0,0}"
      + "{BZSS-Marked}",
      "utf16le",
    ));

    const readyState = await waitForState(module, "ready", 1000);
    assert.equal(readyState.playerCount, 1);
    assert.equal(module.api.findPlayer({ name: "Watcher Player" })?.playerGuid, "abc123");
    const rawSnapshot = module.api.getRawSnapshot();
    assert.equal(rawSnapshot.rawText.includes("PlayerBaseInfo{0,abc123"), true);
    assert.equal(rawSnapshot.rawTextLength, rawSnapshot.rawText.length);
  } finally {
    await module.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function waitForState(module, status, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = module.api.getState();
    if (state.status === status) return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for BZSS-Core monitor status ${status}.`);
}

async function main() {
  testExtractBzssCoreTrackedTextReadsUtf16Block();
  testParseBzssCorePlayerBlocksParsesPlayersAndVectors();
  testParseBzssCorePlayerBlocksAcceptsMissingSoldierInfo();
  testParseBzssCorePlayerBlocksAcceptsNamedFieldsAndExtraBlocks();
  testParseBzssCorePlayerBlocksAcceptsCaptureZonesAndCompactScoreboard();
  testParseBzssCorePlayerBlocksReadsNewSquadContext();
  await testMonitorRefreshesFromFileWatcher();
  console.log("run-bzss-core-monitor-tests: ok");
}

main();
