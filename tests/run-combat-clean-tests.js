import assert from "node:assert/strict";

import { createCombatCleanModule } from "../modules/combat-clean/index.js";

function createHarness({ playerState, matchState, combatCleanConfig, webStatus } = {}) {
  const listeners = new Map();
  const moduleEvents = [];
  const core = {
    logger: { info() {}, debug() {}, warn() {}, error() {} },
    webStatus: {
      serverId: "BZSS_Main",
      ...(webStatus ?? {}),
    },
    webRegistry: { registerPage() {} },
    eventBus: {
      onModuleEvent(moduleId, eventName, handler) {
        const key = `${moduleId}:${eventName}`;
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(handler);
        return () => listeners.get(key)?.delete(handler);
      },
      emitModuleEvent(moduleId, eventName, event) {
        moduleEvents.push({ moduleId, eventName, event });
      },
    },
  };
  const defaultCombatCleanConfig = {
    enabled: true,
    maxEvents: 100,
    weaponHistoryBackfill: {
      enabled: true,
      windowMs: 300000,
    },
  };
  const config = {
    get(pathText, defaultValue) {
      if (pathText === "modules.combatClean") {
        return {
          ...defaultCombatCleanConfig,
          ...(combatCleanConfig ?? {}),
          weaponHistoryBackfill: {
            ...defaultCombatCleanConfig.weaponHistoryBackfill,
            ...(combatCleanConfig?.weaponHistoryBackfill ?? {}),
          },
        };
      }
      return defaultValue;
    },
  };
  const module = createCombatCleanModule({
    core,
    modules: { playerState, matchState },
    config,
  });
  return { module, listeners, moduleEvents };
}

function emitCombatResolved(listeners, record) {
  for (const handler of listeners.get("module.combatState:updated") ?? []) {
    handler({
      eventId: `module.combatState:${record.sourceEventId}`,
      eventName: "module.combatState.updated",
      layer: "module",
      source: "module.combatState",
      serverId: record.serverId,
      time: record.time,
      record: {
        ...record,
        sourceEventId: record.sourceEventId,
        sourceModule: "module.combatState",
      },
    });
  }
}

async function testAttackerNullptrFallsBackToVictimExactly() {
  const { module, listeners, moduleEvents } = createHarness();
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:1",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:00:00.000Z",
    type: "damaged",
    attackerName: "nullptr",
    victimName: "Victim",
    victimSteam64ID: "76561198000000001",
    damage: 12,
    weapon: "BP_Rifle_C_214748",
    rawLog: "raw damage",
  });

  const clean = module.api.getEvents({ serverId: "BZSS_Main" })[0];
  assert.equal(clean.type, "damage");
  assert.equal(clean.eventName, "BZSS_DAMAGE");
  assert.equal(clean.attacker.name, "Victim");
  assert.equal(clean.attacker.steam64ID, "76561198000000001");
  assert.equal(clean.attacker.isFallback, true);
  assert.equal(clean.attacker.fallbackReason, "attacker_nullptr_use_victim");
  assert.deepEqual(clean.parse.warnings, ["attacker_nullptr_use_victim"]);
  assert.ok(moduleEvents.some((item) => item.eventName === "damageResolved"));
  assert.ok(moduleEvents.some((item) => item.eventName === "updated"));

  await module.stop();
}

async function testWeaponTypeClassificationIsPreserved() {
  const { module, listeners } = createHarness();
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:weapon-type",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:00:30.000Z",
    type: "damaged",
    attackerName: "Attacker",
    victimName: "Victim",
    weapon: "BP_PMT76_A940",
    rawCausedBy: "BP_PMT76_A940",
    causedBy: "BP_PMT76_A940",
    rawLog: "raw damage",
  });

  const clean = module.api.getEvents({ serverId: "BZSS_Main" })[0];
  assert.equal(clean.weapon.displayName, "PMT76 A940");
  assert.equal(clean.weapon.typeKey, "light");
  assert.ok(clean.weapon.typeLabel);
  assert.ok(clean.displayText.includes("PMT76 A940"));
  assert.ok(clean.displayText.includes(clean.weapon.typeLabel));

  await module.stop();
}

async function testProcessedCombatRecordPublishesUnifiedEventAndTags() {
  const { module, listeners, moduleEvents } = createHarness();
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:processed-tags",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:00:31.000Z",
    type: "damaged",
    attackerName: "Attacker",
    victimName: "Victim",
    attackerSteam64ID: "111",
    victimSteam64ID: "222",
    weapon: "BP_AK74_C",
    rawCausedBy: "BP_AK74_C",
    causedBy: "BP_AK74_C",
    damage: 27,
    rawLog: "raw processed tags",
  });

  const clean = module.api.getEvents({ serverId: "BZSS_Main" })[0];
  assert.equal(clean.type, "damage");
  assert.ok(clean.tags.includes("combat.damage"));
  assert.ok(clean.tags.includes("weapon.small_arm"));
  assert.ok(clean.tags.includes("weapon.rifle"));
  assert.ok(clean.tags.includes("damage.direct"));
  assert.ok(clean.tags.includes("victim.valid"));
  assert.equal(clean.warningState.attacker.warned, false);
  assert.ok(moduleEvents.some((item) => item.eventName === "combat.record.processed"));

  await module.stop();
}

async function testExactProjectileAttackDisplaysBot() {
  const { module, listeners } = createHarness();
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:exact-projectile-damage",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:00:45.000Z",
    type: "damaged",
    attackerName: "Enemy Soldier",
    victimName: "Victim",
    damage: 12,
    causedBy: "Projectile",
    rawCausedBy: "Projectile",
    rawLog: "raw projectile damage",
  });

  const clean = module.api.getEvents({ serverId: "BZSS_Main" })[0];
  assert.equal(clean.attacker.name, "");
  assert.equal(clean.attacker.displayName, "bot");
  assert.equal(clean.attacker.isBot, true);
  assert.equal(clean.attacker.botReason, "exact_projectile");
  assert.equal(clean.attacker.teamID, "");
  assert.equal(clean.attacker.squadID, "");
  assert.equal(clean.attacker.isFallback, false);
  assert.equal(clean.weapon.typeKey, "bot_weapon");
  assert.equal(clean.weapon.typeLabel, "人机武器");
  assert.equal(clean.weapon.isBotWeapon, true);
  assert.equal(clean.isBotAttack, true);
  assert.equal(clean.relation.isFriendlyFire, false);
  assert.equal(clean.displayText.includes("bot"), true);

  await module.stop();
}

async function testExactProjectileKillGetsBotFlag() {
  const { module, listeners } = createHarness();
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:exact-projectile-kill",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:00:50.000Z",
    type: "died",
    attackerName: "Enemy Soldier",
    victimName: "Victim",
    damage: 300,
    causedBy: "Projectile",
    rawCausedBy: "Projectile",
    rawLog: "raw projectile kill",
  });

  const clean = module.api.getEvents({ serverId: "BZSS_Main" })[0];
  assert.equal(clean.type, "kill");
  assert.equal(clean.attacker.displayName, "bot");
  assert.equal(clean.relation.isFriendlyFire, false);
  assert.equal(clean.relation.teamSource, "bot");
  assert.ok(clean.eventFlags.some((flag) => flag.key === "killed_by_bot"));
  assert.ok(clean.eventFlagLabels.includes("被bot击杀"));
  assert.ok(!clean.eventFlags.some((flag) => flag.key === "friendly_fire"));
  assert.ok(!clean.eventFlagLabels.includes("友伤"));
  assert.ok(!clean.eventFlagLabels.includes("放弃"));

  await module.stop();
}

async function testRejectsNullptrVictim() {
  const { module, listeners, moduleEvents } = createHarness();
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:reject",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:01:00.000Z",
    type: "wounded",
    attackerName: "Attacker",
    victimName: "nullptr",
    weapon: "BP_Rifle_C",
    rawLog: "raw reject",
  });

  assert.equal(module.api.getEvents({ serverId: "BZSS_Main" }).length, 0);
  const rejected = moduleEvents.find((item) => item.eventName === "rejected");
  assert.ok(rejected);
  assert.equal(rejected.event.rejection.status, "missing_victim");

  await module.stop();
}

async function testResolvesPlayersAndRelation() {
  const playerState = {
    getPlayerBySteamID(serverId, steamID) {
      if (serverId === "BZSS_Main" && steamID === "111") {
        return { name: "Attacker Live", steamID, eosID: "eos-a", teamID: 1, squadID: 2, role: "Rifleman", isLeader: true };
      }
      return null;
    },
    getPlayerByEOSID() { return null; },
    getPlayerByControllerID() { return null; },
    getPlayerByName() { return null; },
  };
  const matchState = {
    getState() {
      return {
        players: {
          bySteam64ID: {},
          byEOSID: {},
          byControllerID: {},
          byName: {},
          list: [{ name: "victim live", steamID: "222", teamID: 1, squadID: 3 }],
        },
      };
    },
  };
  const { module, listeners } = createHarness({ playerState, matchState });
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:2",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:02:00.000Z",
    type: "died",
    attackerName: "Attacker",
    attackerSteam64ID: "111",
    victimName: "Victim Live",
    damage: 100,
    causedBy: "BP_Rifle_C",
    rawLog: "raw kill",
  });

  const clean = module.api.getEvents({ type: "kill" })[0];
  assert.equal(clean.eventName, "BZSS_KILL");
  assert.equal(clean.attacker.name, "Attacker");
  assert.equal(clean.attacker.steam64ID, "111");
  assert.equal(clean.attacker.teamID, 1);
  assert.equal(clean.attacker.resolutionSource, "module.playerState");
  assert.equal(clean.victim.name, "Victim Live");
  assert.equal(clean.victim.teamID, 1);
  assert.equal(clean.victim.resolutionSource, "module.matchState");
  assert.equal(clean.relation.sameTeam, true);
  assert.equal(clean.relation.isFriendlyFire, true);
  assert.equal(clean.relation.friendlyFireType, "team_kill");

  await module.stop();
}

async function testGiveUpOnlyKeepsSingleLabelInProcessedData() {
  const { module, listeners } = createHarness();
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:give-up",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:04:00.000Z",
    type: "died",
    attackerName: "PlayerA",
    victimName: "PlayerA",
    damage: 300,
    eventFlags: [{ key: "give_up", label: "放弃", level: "neutral", reason: "died_damage_300" }],
    eventFlagLabels: ["放弃"],
    rawLog: "raw give up",
  });

  const clean = module.api.getEvents({ serverId: "BZSS_Main" })[0];
  assert.deepEqual(clean.eventFlagLabels, ["放弃"]);
  assert.equal(clean.eventFlags.length, 1);
  assert.equal(clean.eventFlags[0].key, "give_up");
  await module.stop();
}

async function testGiveUpSameTeamKeepsFriendlyFireLabelInProcessedData() {
  const playerState = {
    getPlayerByName(serverId, name) {
      if (serverId !== "BZSS_Main") return null;
      if (name === "Attacker") return { name, teamID: 2 };
      if (name === "Victim") return { name, teamID: 2 };
      return null;
    },
  };
  const { module, listeners } = createHarness({ playerState });
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:give-up-tk",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:04:30.000Z",
    type: "died",
    attackerName: "Attacker",
    victimName: "Victim",
    damage: 300,
    rawLog: "raw give up tk",
  });

  const clean = module.api.getEvents({ serverId: "BZSS_Main" })[0];
  assert.ok(clean.eventFlagLabels.includes("放弃"));
  assert.ok(clean.eventFlagLabels.includes("友伤"));
  assert.equal(clean.relation.isFriendlyFire, true);

  await module.stop();
}

async function testTeamWoundGetsTkDownLabelInProcessedData() {
  const playerState = {
    getPlayerByName(serverId, name) {
      if (serverId !== "BZSS_Main") return null;
      if (name === "Attacker") return { name, teamID: 2 };
      if (name === "Victim") return { name, teamID: 2 };
      return null;
    },
  };
  const { module, listeners } = createHarness({ playerState });
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:tk-down",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:05:00.000Z",
    type: "wounded",
    attackerName: "Attacker",
    victimName: "Victim",
    damage: 80,
    rawLog: "raw tk down",
  });

  const clean = module.api.getEvents({ type: "wound" })[0];
  assert.ok(clean.eventFlagLabels.includes("TK击倒"));
  assert.ok(clean.eventFlags.some((flag) => flag.key === "tk_down"));
  assert.equal(clean.relation.friendlyFireType, "team_wound");

  await module.stop();
}

async function testReviveEventIsKeptWithoutFriendlyFire() {
  const playerState = {
    getPlayerByName(serverId, name) {
      if (serverId !== "BZSS_Main") return null;
      if (name === "Medic") return { name, teamID: 1 };
      if (name === "Victim") return { name, teamID: 1 };
      return null;
    },
  };
  const { module, listeners, moduleEvents } = createHarness({ playerState });
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:revive",
    serverId: "BZSS_Main",
    time: "2026-05-15T08:44:22.528Z",
    type: "revive",
    attackerName: "Medic",
    victimName: "Victim",
    attackerSteam64ID: "76561198000000001",
    victimSteam64ID: "76561198000000002",
    rawLog: "raw revive",
  });

  const clean = module.api.getEvents({ type: "revive" })[0];
  assert.equal(clean.type, "revive");
  assert.equal(clean.eventName, "BZSS_REVIVE");
  assert.equal(clean.relation.isFriendlyFire, false);
  assert.equal(clean.eventFlagLabels.length, 0);
  assert.ok(clean.displayText.includes("revived"));
  assert.ok(moduleEvents.some((item) => item.eventName === "reviveResolved"));

  await module.stop();
}

async function testProcessedDataPreservesAllIncomingFlags() {
  const playerState = {
    getPlayerByName(serverId, name) {
      if (serverId !== "BZSS_Main") return null;
      if (name === "Attacker") return { name, teamID: 2 };
      if (name === "Victim") return { name, teamID: 2 };
      return null;
    },
  };
  const { module, listeners } = createHarness({ playerState });
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:multi-flags",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:06:00.000Z",
    type: "wounded",
    attackerName: "Attacker",
    victimName: "Victim",
    damage: 80,
    eventFlags: [
      { key: "friendly_fire", label: "友伤", level: "warning", reason: "same_team" },
      { key: "self_damage", label: "自伤", level: "warning", reason: "same_attacker_victim" },
    ],
    eventFlagLabels: ["友伤", "自伤"],
    rawLog: "raw multi flags",
  });

  const clean = module.api.getEvents({ type: "wound" })[0];
  assert.ok(clean.eventFlagLabels.includes("友伤"));
  assert.ok(clean.eventFlagLabels.includes("自伤"));
  assert.ok(clean.eventFlagLabels.includes("TK击倒"));
  assert.ok(clean.eventFlags.some((flag) => flag.key === "friendly_fire"));
  assert.ok(clean.eventFlags.some((flag) => flag.key === "self_damage"));
  assert.ok(clean.eventFlags.some((flag) => flag.key === "tk_down"));

  await module.stop();
}

async function testProcessedDataBackfillsFriendlyFireFlags() {
  const playerState = {
    getPlayerByName(serverId, name) {
      if (serverId !== "BZSS_Main") return null;
      if (name === "Attacker") return { name, teamID: 2 };
      if (name === "Victim") return { name, teamID: 2 };
      return null;
    },
  };
  const { module, listeners } = createHarness({ playerState });
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:backfill",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:07:00.000Z",
    type: "wounded",
    attackerName: "Attacker",
    victimName: "Victim",
    damage: 80,
    rawLog: "raw backfill",
  });

  const clean = module.api.getEvents({ type: "wound" })[0];
  assert.ok(clean.eventFlagLabels.includes("友伤"));
  assert.ok(clean.eventFlagLabels.includes("TK击倒"));

  await module.stop();
}

async function testWeaponHistoryBackfillsLatestWoundOnKillEvents() {
  const { module, listeners } = createHarness();
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:history-1",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:00:00.000Z",
    type: "wounded",
    attackerName: "Enemy",
    victimName: "Victim",
    victimSteam64ID: "76561198000000009",
    weapon: "BP_PKP_C_214748",
    rawLog: "raw history wound",
  });

  emitCombatResolved(listeners, {
    sourceEventId: "raw:history-2a",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:02:00.000Z",
    type: "damaged",
    attackerName: "Enemy",
    victimName: "Victim",
    victimSteam64ID: "76561198000000009",
    weapon: "BP_Soldier_PLA_SquadLeader_Arid_C_2147383420",
    rawLog: "raw history damage",
  });

  emitCombatResolved(listeners, {
    sourceEventId: "raw:history-2b",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:03:00.000Z",
    type: "wounded",
    attackerName: "Enemy",
    victimName: "Victim",
    victimSteam64ID: "76561198000000009",
    weapon: "BP_Soldier_PLA_SquadLeader_Arid_C_2147383420",
    rawLog: "raw history wound placeholder",
  });

  emitCombatResolved(listeners, {
    sourceEventId: "raw:history-2",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:04:59.000Z",
    type: "died",
    attackerName: "Enemy",
    victimName: "Victim",
    victimSteam64ID: "76561198000000009",
    weapon: "Type86p Frag",
    rawLog: "raw give up",
  });

  const clean = module.api.getEvents({ serverId: "BZSS_Main", limit: 10 });
  const woundReal = clean.find((event) => event.raw?.sourceEventId === "raw:history-1");
  const damage = clean.find((event) => event.raw?.sourceEventId === "raw:history-2a");
  const woundPlaceholder = clean.find((event) => event.raw?.sourceEventId === "raw:history-2b");
  const kill = clean.find((event) => event.raw?.sourceEventId === "raw:history-2");

  assert.equal(woundReal.weapon.displayName, "PKP");
  assert.equal(woundReal.weapon.resolvedFromHistory, undefined);
  assert.equal(damage.weapon.raw, "BP_Soldier_PLA_SquadLeader_Arid_C_2147383420");
  assert.equal(damage.weapon.resolvedFromHistory, undefined);
  assert.equal(damage.weapon.displayName, "Soldier PLA SquadLeader Arid");
  assert.equal(woundPlaceholder.weapon.raw, "BP_Soldier_PLA_SquadLeader_Arid_C_2147383420");
  assert.equal(woundPlaceholder.weapon.resolvedFromHistory, undefined);
  assert.equal(woundPlaceholder.weapon.displayName, "Soldier PLA SquadLeader Arid");
  assert.equal(kill.weapon.raw, "Type86p Frag");
  assert.equal(kill.weapon.displayName, "Soldier PLA SquadLeader Arid");
  assert.equal(kill.weapon.resolvedFromHistory, true);
  assert.equal(kill.weapon.historyBackfill.sourceEventId, "raw:history-2b");
  assert.ok(kill.parse.warnings.includes("weapon_history_backfill"));
  assert.ok(kill.displayText.includes("with Soldier PLA SquadLeader Arid"));

  await module.stop();
}

async function testWeaponHistoryBackfillCanBeDisabled() {
  const { module, listeners } = createHarness({
    combatCleanConfig: {
      weaponHistoryBackfill: { enabled: false },
    },
  });
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:disable-1",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:10:00.000Z",
    type: "wounded",
    attackerName: "Enemy",
    victimName: "Victim",
    victimSteam64ID: "76561198000000010",
    weapon: "BP_PKP_C_214748",
    rawLog: "raw history wound disabled",
  });

  emitCombatResolved(listeners, {
    sourceEventId: "raw:disable-2",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:10:10.000Z",
    type: "died",
    attackerName: "Enemy",
    victimName: "Victim",
    victimSteam64ID: "76561198000000010",
    weapon: "Soldier BAF Rifleman1",
    rawLog: "raw give up disabled",
  });

  const kill = module.api.getEvents({ serverId: "BZSS_Main", type: "kill" })[0];
  assert.equal(kill.weapon.displayName, "Soldier BAF Rifleman1");
  assert.equal(kill.weapon.resolvedFromHistory, undefined);
  assert.ok(!kill.parse.warnings.includes("weapon_history_backfill"));

  await module.stop();
}

async function testProjectile762NullptrAttackDisplaysBotWeapon() {
  const { module, listeners } = createHarness();
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:projectile-762-nullptr",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:00:47.000Z",
    type: "damaged",
    attackerName: "nullptr",
    victimName: "Victim",
    damage: 18,
    causedBy: "Projectile 7 62mm",
    rawCausedBy: "Projectile 7 62mm",
    rawLog: "raw projectile 7 62mm damage",
  });

  const clean = module.api.getEvents({ serverId: "BZSS_Main" })[0];
  assert.equal(clean.attacker.displayName, "bot");
  assert.equal(clean.attacker.botReason, "nullptr_projectile_7_62mm");
  assert.equal(clean.weapon.typeKey, "bot_weapon");
  assert.equal(clean.weapon.typeLabel, "人机武器");
  assert.equal(clean.weapon.isBotWeapon, true);
  assert.equal(clean.weapon.botWeaponReason, "nullptr_projectile_7_62mm");
  assert.equal(clean.isBotAttack, true);
  assert.equal(clean.relation.isFriendlyFire, false);

  await module.stop();
}

async function testPlayerEventsAndClear() {
  const { module, listeners } = createHarness();
  await module.start();
  emitCombatResolved(listeners, {
    sourceEventId: "raw:3",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:03:00.000Z",
    type: "wounded",
    attackerName: "Attacker",
    victimName: "Victim",
    victimEOSID: "eos-v",
  });

  assert.equal(module.api.getPlayerEvents("BZSS_Main", { eosID: "eos-v" }, { limit: 20 }).length, 1);
  assert.equal(module.api.getOverview("BZSS_Main").stats.wound, 1);
  assert.equal(module.api.clear("BZSS_Main").cleared, 1);
  assert.equal(module.api.getEvents({ serverId: "BZSS_Main" }).length, 0);

  await module.stop();
}

await testAttackerNullptrFallsBackToVictimExactly();
await testWeaponTypeClassificationIsPreserved();
await testProcessedCombatRecordPublishesUnifiedEventAndTags();
await testExactProjectileAttackDisplaysBot();
await testProjectile762NullptrAttackDisplaysBotWeapon();
await testExactProjectileKillGetsBotFlag();
await testRejectsNullptrVictim();
await testResolvesPlayersAndRelation();
await testGiveUpOnlyKeepsSingleLabelInProcessedData();
await testGiveUpSameTeamKeepsFriendlyFireLabelInProcessedData();
await testTeamWoundGetsTkDownLabelInProcessedData();
await testProcessedDataPreservesAllIncomingFlags();
await testProcessedDataBackfillsFriendlyFireFlags();
await testWeaponHistoryBackfillsLatestWoundOnKillEvents();
await testWeaponHistoryBackfillCanBeDisabled();
await testReviveEventIsKeptWithoutFriendlyFire();
await testPlayerEventsAndClear();

console.log("combat clean tests passed");
