import assert from "node:assert/strict";

import {
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

function main() {
  testExtractBzssCoreTrackedTextReadsUtf16Block();
  testParseBzssCorePlayerBlocksParsesPlayersAndVectors();
  testParseBzssCorePlayerBlocksAcceptsMissingSoldierInfo();
  console.log("run-bzss-core-monitor-tests: ok");
}

main();
