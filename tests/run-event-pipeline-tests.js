import assert from "node:assert/strict";

import { EventPipeline } from "../core/event-pipeline.js";
import { WebStatus } from "../core/web-status.js";

function testDiedEventDoesNotInheritWeaponContext() {
  const pipeline = new EventPipeline();

  pipeline.processRawGameEvent({
    Version: "1",
    ServerID: "BZSS_Main",
    SessionID: "TestSession",
    Seq: "1",
    Event: "On_PlayerWounded",
    Time: "2026-05-07 20:54:00.100",
    LogTime: "2026.05.07-12.54.00:100",
    Param1_VictimName: "Victim",
    Param2_KillingDamage: "-120.000000",
    Param3_AttackerName: "Attacker",
    Param4_AttackerEOSID: "000262cdb3d74f43b95da83d6640873c",
    Param5_AttackerSteam64ID: "76561199511806113",
    Param6_AttackerControllerID: "BP_PlayerController_C_2146301565",
    Param7_FromObject: "BP_PlayerController_C_2146301565",
    Param8_CausedBy: "BP_EF88_Specter_Foregrip_C_2146294694",
    Param9_ParseStatus: "Full",
    Param10_ParseConfidence: "High",
    Param11_IdentityConfidence: "High",
    Param12_Confidence: "High",
    Raw: "wounded raw",
  });

  const diedEvent = pipeline.processRawGameEvent({
    Version: "1",
    ServerID: "BZSS_Main",
    SessionID: "TestSession",
    Seq: "2",
    Event: "On_PlayerDied",
    Time: "2026-05-07 20:54:01.200",
    LogTime: "2026.05.07-12.54.01:200",
    Param1_VictimName: "Victim",
    Param2_KillingDamage: "-300.000000",
    Param3_AttackerName: "Attacker",
    Param4_AttackerEOSID: "000262cdb3d74f43b95da83d6640873c",
    Param5_AttackerSteam64ID: "76561199511806113",
    Param6_AttackerControllerID: "BP_PlayerController_C_2146301565",
    Param7_FromObject: "BP_PlayerController_C_2146301565",
    Param8_CausedBy: "BP_Soldier_CAF_Marksman_C_2146337941",
    Param9_ParseStatus: "Full",
    Param10_ParseConfidence: "High",
    Param11_IdentityConfidence: "High",
    Param12_Confidence: "High",
    Raw: "died raw",
  });

  assert.equal(diedEvent.normalized.combat.rawCausedBy, "BP_Soldier_CAF_Marksman_C_2146337941");
  assert.equal(diedEvent.normalized.combat.causedBy, "BP_Soldier_CAF_Marksman_C_2146337941");
  assert.equal(diedEvent.normalized.combat.weapon, "BP_Soldier_CAF_Marksman_C_2146337941");
  assert.equal(diedEvent.normalized.combat.causedByCategory, "pawn");
  assert.equal("weaponSource" in diedEvent.normalized.combat, false);
  assert.equal("inheritedWeapon" in diedEvent.normalized.combat, false);
  assert.equal("contextDamage" in diedEvent.normalized.combat, false);
  assert.equal("contextLogTime" in diedEvent.normalized.combat, false);
  assert.equal("contextReceiveTime" in diedEvent.normalized.combat, false);
}

function testAttackerDisplayNameFallsBackToPlayerStateAndSteam64() {
  const pipeline = new EventPipeline();
  pipeline.setCombatIdentityResolver(({ keyType, keyValue }) => {
    if (keyType === "steam64ID" && keyValue === "76561198964500743") {
      return { name: "ResolvedPlayer", source: "playerStateBySteam64" };
    }
    return null;
  });

  const resolvedEvent = pipeline.processRawGameEvent({
    Version: "1",
    ServerID: "BZSS_Main",
    SessionID: "TestSession",
    Seq: "3",
    Event: "On_PlayerDied",
    Time: "2026-05-07 20:54:03.000",
    LogTime: "2026.05.07-12.54.03:000",
    Param1_VictimName: "Victim",
    Param2_KillingDamage: "-300.000000",
    Param3_AttackerName: "",
    Param4_AttackerEOSID: "",
    Param5_AttackerSteam64ID: "76561198964500743",
    Param6_AttackerControllerID: "BP_PlayerController_C_2146370936",
    Param7_FromObject: "BP_PlayerController_C_2146370936",
    Param8_CausedBy: "BP_Soldier_PLA_HAT_Woodland_C_2145921291",
    Param9_ParseStatus: "Full",
    Param10_ParseConfidence: "High",
    Param11_IdentityConfidence: "High",
    Param12_Confidence: "High",
    Raw: "died raw",
  });

  assert.equal(resolvedEvent.normalized.combat.attackerName, "ResolvedPlayer");
  assert.equal(resolvedEvent.normalized.combat.attackerDisplayName, "ResolvedPlayer");
  assert.equal(resolvedEvent.normalized.combat.attackerNameSource, "playerStateBySteam64");

  const fallbackPipeline = new EventPipeline();
  const fallbackEvent = fallbackPipeline.processRawGameEvent({
    Version: "1",
    ServerID: "BZSS_Main",
    SessionID: "TestSession",
    Seq: "4",
    Event: "On_PlayerDied",
    Time: "2026-05-07 20:54:04.000",
    LogTime: "2026.05.07-12.54.04:000",
    Param1_VictimName: "Victim",
    Param2_KillingDamage: "-300.000000",
    Param3_AttackerName: "",
    Param4_AttackerEOSID: "",
    Param5_AttackerSteam64ID: "76561198964500743",
    Param6_AttackerControllerID: "BP_PlayerController_C_2146370936",
    Param7_FromObject: "BP_PlayerController_C_2146370936",
    Param8_CausedBy: "BP_Soldier_PLA_HAT_Woodland_C_2145921291",
    Param9_ParseStatus: "Full",
    Param10_ParseConfidence: "High",
    Param11_IdentityConfidence: "High",
    Param12_Confidence: "High",
    Raw: "died raw",
  });

  assert.equal(fallbackEvent.normalized.combat.attackerName, "76561198964500743");
  assert.equal(fallbackEvent.normalized.combat.attackerDisplayName, "76561198964500743");
  assert.equal(fallbackEvent.normalized.combat.attackerNameSource, "steam64Fallback");
}

function testWebStatusStale() {
  const config = {
    get(path, defaultValue) {
      const values = {
        "server.id": "BZSS_Main",
        "server.name": "BZSS Main Server",
        "serverTickRate.expected": 30,
        "serverTickRate.warningBelow": 28,
        "serverTickRate.criticalBelow": 20,
        "serverTickRate.staleAfterSeconds": 10,
      };
      return path in values ? values[path] : defaultValue;
    },
  };

  const webStatus = new WebStatus({ config });
  webStatus.applyServerTickRateUpdate({
    tps: 29.2,
    status: "good",
    time: new Date(Date.now() - 11_000).toISOString(),
  });

  const snapshot = webStatus.getSnapshot();
  assert.equal(snapshot.tps, 29.2);
  assert.equal(snapshot.tpsStatus, "stale");
}

function testTpsNormalization() {
  const pipeline = new EventPipeline();
  const event = pipeline.processRawGameEvent({
    Version: "1",
    ServerID: "BZSS_Main",
    SessionID: "TestSession",
    Seq: "1",
    Event: "On_ServerTickRateUpdated",
    Time: "2026-05-07 20:54:02.963",
    LogTime: "2026.05.07-12.54.02:963",
    Param1_TickRate: "29.20",
    Param2_Unit: "TPS",
    Param3_Status: "good",
    Raw: "[2026.05.07-12.54.02:963][784]LogSquad: USQGameState: Server Tick Rate: 29.20",
  });

  assert.equal(event.eventName, "On_ServerTickRateUpdated");
  assert.equal(event.normalized.serverTickRate.tps, 29.2);
  assert.equal(event.normalized.serverTickRate.status, "good");
}

function testWorldBringUpNormalization() {
  const pipeline = new EventPipeline();
  const event = pipeline.processRawGameEvent({
    Version: "1",
    ServerID: "BZSS_Main",
    SessionID: "TestSession",
    Seq: "5",
    Event: "round.world_bring_up",
    Time: "2026-05-12 18:46:27.432",
    LogTime: "2026.05.12-10.46.27:432",
    Param1_logLineTime: "2026.05.12-10.46.27:432",
    Param2_frame: "11",
    Param3_worldPath: "/Game/Maps/Mutaha/Gameplay_Layers/Mutaha_RAAS_v1.Mutaha_RAAS_v1",
    Param4_layerName: "Mutaha_RAAS_v1",
    Param5_mapName: "Mutaha",
    Param6_gameMode: "RAAS",
    Param7_maxTickRate: "50",
    Param8_serverPlayAt: "2026.05.12-18.46.27",
    Raw: "[2026.05.12-10.46.27:432][ 11]LogWorld: Bringing World /Game/Maps/Mutaha/Gameplay_Layers/Mutaha_RAAS_v1.Mutaha_RAAS_v1 up for play (max tick rate 50) at 2026.05.12-18.46.27",
  });

  assert.equal(event.eventName, "round.world_bring_up");
  assert.equal(event.normalized.roundWorldBringUp.type, "round.world_bring_up");
  assert.equal(event.normalized.roundWorldBringUp.layerName, "Mutaha_RAAS_v1");
  assert.equal(event.normalized.roundWorldBringUp.mapName, "Mutaha");
  assert.equal(event.normalized.roundWorldBringUp.gameMode, "RAAS");
  assert.equal(event.normalized.roundWorldBringUp.maxTickRate, 50);
  assert.equal(event.normalized.roundWorldBringUp.frame, 11);
  assert.equal(event.normalized.roundWorldBringUp.logLineTime, "2026.05.12-10.46.27:432");
  assert.equal(event.normalized.roundWorldBringUp.serverPlayAt, "2026.05.12-18.46.27");
  assert.equal(event.normalized.roundWorldBringUp.rawLog.includes("LogWorld: Bringing World"), true);
}

testDiedEventDoesNotInheritWeaponContext();
testAttackerDisplayNameFallsBackToPlayerStateAndSteam64();
testWebStatusStale();
testTpsNormalization();
testWorldBringUpNormalization();

console.log("event pipeline tests passed");
