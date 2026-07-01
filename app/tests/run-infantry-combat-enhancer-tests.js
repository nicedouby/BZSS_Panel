import assert from "node:assert/strict";

import { createInfantryCombatEnhancerModule } from "../modules/infantry-combat-enhancer/index.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createEventBus() {
  const listeners = [];
  return {
    listeners,
    onModuleEvent(moduleId, eventName, handler) {
      const listener = { moduleId, eventName, handler };
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    async emitModuleEvent(moduleId, eventName, event) {
      const matches = listeners.filter((listener) => listener.moduleId === moduleId && listener.eventName === eventName);
      const results = matches.map((listener) => listener.handler(event));
      await Promise.all(results.filter((result) => result && typeof result.then === "function"));
      return results;
    },
  };
}

function createHarness({ moduleConfig = {}, adminWarn, squadFollowState, subscriptionMap = {} } = {}) {
  const pages = [];
  const calls = [];
  const eventBus = createEventBus();

  const module = createInfantryCombatEnhancerModule({
    core: {
      logger: { info() {}, warn() {}, error() {} },
      webRegistry: {
        registerPage(page) {
          pages.push(page);
        },
      },
      eventBus,
      webStatus: { serverId: "S1" },
      pluginSubscriptions: {
        isSubscribed(id) {
          if (Object.prototype.hasOwnProperty.call(subscriptionMap, id)) {
            return Boolean(subscriptionMap[id]);
          }
          return true;
        },
      },
    },
    modules: {
      adminWarn: adminWarn ?? {
        async sendAdminWarn(request) {
          calls.push(request);
          return { success: true, skipped: false, commandText: `AdminWarn "${request.targetName}"` };
        },
      },
      squadFollowState: squadFollowState ?? {
        getPlayerFollowState(identity) {
          if (!String(identity?.steam64ID ?? identity?.steamID ?? identity?.name ?? "").trim()) {
            return null;
          }
          return {
            status: "inside",
            leaderName: "SL",
            distanceMeters: 1200,
            radiusMeters: 20000,
            reason: "inside_leader_radius",
            inside: true,
            disengaged: false,
            teamId: 1,
            squadId: 4,
          };
        },
        isPlayerInsideLeaderRadius() {
          return true;
        },
      },
    },
    config: {
      get(pathText, defaultValue) {
        if (pathText === "modules.infantryCombatEnhancer") {
          return {
            enabled: true,
            forceAttackerDamageDisplay: false,
            minAttackerDamage: 15,
            damageDebounceMs: 150,
            showVictimDamage: true,
            showVictimWound: true,
            showVictimKill: true,
            showAttackerDamage: true,
            showOnlyLightWeaponDamage: true,
            storeRecentEventLimit: 10,
            ...moduleConfig,
          };
        }
        return defaultValue;
      },
    },
  });

  return { module, eventBus, pages, calls };
}

async function testDamageDebounceConfigAndDelay() {
  const { module, eventBus, calls } = createHarness();
  await module.start();

  assert.equal(module.api.getConfig().damageDebounceMs, 150);

  const updated = module.api.updateConfig({
    damageDebounceMs: 25,
  });
  assert.equal(updated.damageDebounceMs, 25);
  assert.equal(module.api.getState().config.damageDebounceMs, 25);

  const originalSetTimeout = globalThis.setTimeout;
  const delays = [];

  globalThis.setTimeout = (handler, delayMs) => {
    delays.push(delayMs);
    return originalSetTimeout(handler, 0);
  };

  try {
    await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
      record: {
        id: "combat-delay-check",
        serverId: "S1",
        type: "damage",
        time: "2026-05-30T12:00:00.000Z",
        attackerName: "Alpha",
        attackerSteam64ID: "123",
        victimName: "Bravo",
        victimSteam64ID: "456",
        damage: 42,
        weaponName: "M4A1",
        tags: ["weapon.small_arm", "damage.direct"],
      },
    });

    assert.deepEqual(delays, [25]);
    await new Promise((resolve) => originalSetTimeout(resolve, 50));
    assert.equal(calls.length, 2);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    await module.stop();
  }
}

async function testProcessingAndWarnings() {
  const { module, eventBus, pages, calls } = createHarness();
  await module.start();

  assert.equal(pages.length, 1);
  assert.equal(pages[0].route, "/plugins/infantry-combat-enhancer");

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      id: "combat-1",
      serverId: "S1",
      type: "damage",
      time: "2026-05-30T12:00:00.000Z",
      attackerName: "Alpha",
      attackerSteam64ID: "123",
      victimName: "Bravo",
      victimSteam64ID: "456",
      damage: 42,
      weaponName: "M4A1",
      eventFlags: [{ key: "self_damage", label: "自伤" }],
      eventFlagLabels: ["自伤"],
      tags: ["weapon.small_arm", "damage.direct"],
    },
  });

  await sleep(500);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].sourceModule, "module.infantryCombatEnhancer");
  assert.equal(calls[0].targetName, "Bravo");
  assert.equal(calls[1].targetName, "Alpha");

  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].victimWarning.success, true);
  assert.equal(events[0].attackerWarning.success, true);
  assert.equal(events[0].eventFlags[0].key, "self_damage");
  assert.equal(events[0].eventFlagLabels[0], "自伤");
  assert.ok(events[0].tags.includes("weapon.small_arm"));
  assert.equal(module.api.getOverview().stats.victimWarned, 1);
  assert.equal(module.api.getOverview().stats.attackerWarned, 1);

  await module.stop();
}

async function testReviveResolvedWarnings() {
  const { module, eventBus, calls } = createHarness();
  await module.start();

  await eventBus.emitModuleEvent("module.combatClean", "reviveResolved", {
    eventId: "module.combatClean:revive-1",
    serverId: "S1",
    time: "2026-05-30T12:01:00.000Z",
    record: {
      id: "revive-1",
      serverId: "S1",
      type: "revive",
      time: "2026-05-30T12:01:00.000Z",
      attackerName: "Medic",
      attackerSteam64ID: "111",
      victimName: "Downed",
      victimSteam64ID: "222",
      tags: ["combat.revive"],
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].targetName, "Downed");
  assert.equal(calls[0].message, "[BZSS]Medic复苏了你，立即归队作战");
  assert.equal(calls[0].reason, "infantry_revive_victim");
  assert.equal(calls[1].targetName, "Medic");
  assert.equal(calls[1].message, "[BZSS]你复苏了Downed，继续并肩作战");
  assert.equal(calls[1].reason, "infantry_revive_attacker");

  const events = module.api.getEvents({ type: "revive", limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "revive");
  assert.equal(events[0].victimWarning.success, true);
  assert.equal(events[0].attackerWarning.success, true);
  assert.equal(module.api.getOverview().stats.revive, 1);
  assert.equal(module.api.getOverview().stats.victimWarned, 1);
  assert.equal(module.api.getOverview().stats.attackerWarned, 1);

  await module.stop();
}

async function testTagDrivenMessages() {
  const { module, eventBus, calls } = createHarness({
    moduleConfig: {
      showKillDisplay: true,
    },
  });
  await module.start();

  const emit = async (record) => {
    await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", { record });
  };

  await emit({
    id: "combat-damage-enemy",
    serverId: "S1",
    type: "damage",
    time: "2026-05-30T12:10:00.000Z",
    attackerName: "Attacker",
    attackerSteam64ID: "111",
    victimName: "Victim",
    victimSteam64ID: "222",
    damage: 60,
    weaponName: "XX",
    tags: ["combat.damage", "weapon.small_arm", "damage.direct"],
  });

  await sleep(500);
  assert.equal(calls.at(-2).message, "[BZSS]你被Attacker使用XX造成60伤害");
  assert.equal(calls.at(-1).message, "[BZSS]你使用XX对Victim造成60伤害");

  await emit({
    id: "combat-damage-friendly",
    serverId: "S1",
    type: "damage",
    time: "2026-05-30T12:10:01.000Z",
    attackerName: "Attacker",
    attackerSteam64ID: "111",
    victimName: "Victim",
    victimSteam64ID: "222",
    damage: 60,
    weaponName: "XX",
    tags: ["combat.team_damage", "friendly_fire", "combat.damage", "weapon.small_arm", "damage.direct"],
  });

  await sleep(500);
  assert.equal(calls.at(-2).message, "[BZSS]你被<友军>Attacker使用XX造成60伤害");
  assert.equal(calls.at(-1).message, "[BZSS]你他奶奶的使用XX对<友军>Victim，造成60伤害");

  await emit({
    id: "combat-wound-friendly",
    serverId: "S1",
    type: "wound",
    time: "2026-05-30T12:10:02.000Z",
    attackerName: "Attacker",
    attackerSteam64ID: "111",
    victimName: "Victim",
    victimSteam64ID: "222",
    damage: 60,
    weaponName: "XX",
    tags: ["combat.team_wound", "friendly_fire", "combat.wound", "weapon.small_arm"],
  });
  assert.equal(calls.at(-2).message, "[BZSS]你被<友军>Attacker使用XX击倒，造成60伤害");
  assert.equal(calls.at(-1).message, "[BZSS]你他奶奶的使用XX击倒<友军>Victim，造成60伤害");

  await emit({
    id: "combat-kill-enemy",
    serverId: "S1",
    type: "kill",
    time: "2026-05-30T12:10:03.000Z",
    attackerName: "Attacker",
    attackerSteam64ID: "111",
    victimName: "Victim",
    victimSteam64ID: "222",
    damage: 300,
    weaponName: "XX",
    tags: ["combat.kill", "weapon.small_arm"],
  });
  assert.equal(calls.at(-2).message, "[BZSS]你被Attacker击杀了");
  assert.equal(calls.at(-1).message, "[BZSS]你击杀了Victim");

  await emit({
    id: "combat-kill-friendly",
    serverId: "S1",
    type: "kill",
    time: "2026-05-30T12:10:04.000Z",
    attackerName: "Attacker",
    attackerSteam64ID: "111",
    victimName: "Victim",
    victimSteam64ID: "222",
    damage: 300,
    weaponName: "XX",
    tags: ["combat.team_kill", "friendly_fire", "combat.kill", "weapon.small_arm"],
  });
  assert.equal(calls.at(-2).message, "[BZSS]你被<友军>Attacker击杀了");
  assert.equal(calls.at(-1).message, "[BZSS]你他奶奶的杀了<友军>Victim");

  await module.stop();
}

async function testOnlyLightWeaponDamageSkipsNonLightWeapons() {
  const { module, eventBus, calls } = createHarness();
  await module.start();

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      id: "combat-heavy-damage",
      serverId: "S1",
      type: "damage",
      time: "2026-05-30T12:11:00.000Z",
      attackerName: "Attacker",
      attackerSteam64ID: "111",
      victimName: "Victim",
      victimSteam64ID: "222",
      damage: 60,
      weaponName: "Grenade",
      tags: ["combat.damage", "weapon.explosive", "damage.splash"],
    },
  });

  await sleep(500);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].targetName, "Victim");
  assert.ok(String(calls[0].message).includes("Attacker"));

  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].victimWarning.success, true);
  assert.equal(events[0].attackerWarning.skipped, true);
  assert.equal(events[0].attackerWarning.skipReason, "non_light_weapon_hidden");

  await module.stop();
}

async function testForceAttackerDamageDisplayOverridesLightWeaponFilter() {
  const { module, eventBus, calls } = createHarness({
    moduleConfig: {
      forceAttackerDamageDisplay: true,
      showOnlyLightWeaponDamage: true,
    },
  });
  await module.start();

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      id: "combat-force-attacker-damage",
      serverId: "S1",
      type: "damage",
      time: "2026-05-30T12:11:30.000Z",
      attackerName: "Attacker",
      attackerSteam64ID: "111",
      victimName: "Victim",
      victimSteam64ID: "222",
      damage: 60,
      weaponName: "Grenade",
      tags: ["combat.damage", "weapon.explosive", "damage.splash"],
    },
  });

  await sleep(500);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].targetName, "Victim");
  assert.equal(calls[1].targetName, "Attacker");

  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].victimWarning.success, true);
  assert.equal(events[0].attackerWarning.success, true);

  await module.stop();
}

async function testOnlyLightWeaponDamageSkipsHeavyKillAttacker() {
  const { module, eventBus, calls } = createHarness({
    moduleConfig: {
      showKillDisplay: true,
      showOnlyLightWeaponDamage: true,
    },
  });
  await module.start();

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      id: "combat-heavy-kill",
      serverId: "S1",
      type: "kill",
      time: "2026-05-30T12:12:00.000Z",
      attackerName: "Attacker",
      attackerSteam64ID: "111",
      victimName: "Victim",
      victimSteam64ID: "222",
      damage: 300,
      weaponName: "ZBD04A AP",
      tags: ["combat.kill", "weapon.vehicle", "damage.direct"],
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].targetName, "Victim");

  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].victimWarning.success, true);
  assert.equal(events[0].attackerWarning.skipped, true);
  assert.equal(events[0].attackerWarning.skipReason, "non_light_weapon_hidden");

  await module.stop();
}

async function testSamePlayerStillDisplays() {
  const { module, eventBus, calls } = createHarness({
    moduleConfig: {
      showOnlyLightWeaponDamage: false,
    },
  });
  await module.start();

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      id: "combat-2",
      serverId: "S1",
      type: "wound",
      time: "2026-05-30T12:05:00.000Z",
      attackerName: "Echo",
      attackerSteam64ID: "999",
      victimName: "Echo",
      victimSteam64ID: "999",
      damage: 5,
      weaponName: "Grenade",
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].targetName, "Echo");

  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].victimWarning.success, true);
  assert.equal(events[0].attackerWarning.skipped, true);
  assert.equal(events[0].attackerWarning.skipReason, "same_player");

  const cleared = module.api.clear();
  assert.equal(cleared.ok, true);
  assert.equal(cleared.cleared, 1);
  assert.equal(module.api.getEvents({ limit: 10 }).length, 0);

  await module.stop();
}

async function testKillDisplayIsDisabledByDefault() {
  const { module, eventBus, calls } = createHarness();
  await module.start();

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      id: "combat-kill",
      serverId: "S1",
      type: "kill",
      time: "2026-05-30T12:06:00.000Z",
      attackerName: "Killer",
      attackerSteam64ID: "111",
      victimName: "Target",
      victimSteam64ID: "222",
      damage: 300,
      weaponName: "M4A1",
      tags: ["combat.kill", "weapon.small_arm"],
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].targetName, "Target");
  assert.equal(calls[0].message, "[BZSS]你被Killer击杀了");
  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].victimWarning.success, true);
  assert.equal(events[0].attackerWarning.skipped, true);
  assert.equal(events[0].attackerWarning.skipReason, "kill_display_disabled");

  await module.stop();
}

async function testFractionalDamageRoundsToInteger() {
  const { module, eventBus, calls } = createHarness({
    moduleConfig: {
      showOnlyLightWeaponDamage: false,
    },
  });
  await module.start();

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      id: "combat-fractional-damage",
      serverId: "S1",
      type: "damage",
      time: "2026-05-30T12:13:00.000Z",
      attackerName: "Attacker",
      attackerSteam64ID: "111",
      victimName: "Victim",
      victimSteam64ID: "222",
      damage: 42.6,
      weaponName: "M4A1",
      tags: ["combat.damage", "weapon.small_arm", "damage.direct"],
    },
  });

  await sleep(500);

  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].damage, 43);
  assert.equal(calls.length, 2);
  assert.ok(String(calls[0].message).includes("43伤害"));
  assert.ok(String(calls[1].message).includes("43伤害"));

  await module.stop();
}

async function testCombatCleanDependencyGate() {
  const { module, eventBus, pages } = createHarness({
    subscriptionMap: {
      "module.combatClean": false,
    },
  });

  await module.start();

  assert.equal(pages.length, 1);
  assert.equal(eventBus.listeners.length, 0);

  await module.stop();
}

async function testAttackerCircleGateInsideAllowsDamage() {
  const { module, eventBus, calls } = createHarness({
    moduleConfig: {
      showOnlyLightWeaponDamage: false,
    },
    squadFollowState: {
      getPlayerFollowState(identity) {
        if (identity?.steam64ID === "123" || identity?.steamID === "123") {
          return {
            status: "inside",
            leaderName: "SL",
            distanceMeters: 1200,
            radiusMeters: 20000,
            reason: "inside_leader_radius",
            inside: true,
            disengaged: false,
            teamId: 1,
            squadId: 4,
          };
        }
        return null;
      },
      isPlayerInsideLeaderRadius() {
        return true;
      },
    },
  });
  await module.start();

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      id: "combat-circle-inside",
      serverId: "S1",
      type: "damage",
      time: "2026-05-30T13:20:00.000Z",
      attackerName: "Alpha",
      attackerSteam64ID: "123",
      victimName: "Bravo",
      victimSteam64ID: "456",
      damage: 36,
      weaponName: "M4A1",
      tags: ["weapon.small_arm", "damage.direct"],
    },
  });

  await sleep(500);

  assert.equal(calls.length, 2);
  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events[0].attackerCircleState.status, "inside");
  assert.equal(events[0].attackerWarning.success, true);

  await module.stop();
}

async function testAttackerCircleGateOutsideSkipsDamage() {
  const { module, eventBus, calls } = createHarness({
    moduleConfig: {
      showOnlyLightWeaponDamage: false,
    },
    squadFollowState: {
      getPlayerFollowState() {
        return {
          status: "outside",
          leaderName: "SL",
          distanceMeters: 24000,
          radiusMeters: 20000,
          reason: "outside_leader_radius",
          inside: false,
          disengaged: true,
          teamId: 1,
          squadId: 4,
        };
      },
      isPlayerInsideLeaderRadius() {
        return false;
      },
    },
  });
  await module.start();

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      id: "combat-circle-outside",
      serverId: "S1",
      type: "damage",
      time: "2026-05-30T13:21:00.000Z",
      attackerName: "Alpha",
      attackerSteam64ID: "123",
      victimName: "Bravo",
      victimSteam64ID: "456",
      damage: 36,
      weaponName: "M4A1",
      tags: ["weapon.small_arm", "damage.direct"],
    },
  });

  await sleep(500);

  assert.equal(calls.length, 1);
  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events[0].attackerCircleState.status, "outside");
  assert.equal(events[0].attackerWarning.skipped, true);
  assert.equal(events[0].attackerWarning.skipReason, "attacker_outside_leader_radius");

  await module.stop();
}

async function testAttackerCircleGateUnknownFallbacks() {
  const denyHarness = createHarness({
    moduleConfig: {
      showOnlyLightWeaponDamage: false,
    },
    squadFollowState: {
      getPlayerFollowState() {
        return null;
      },
      isPlayerInsideLeaderRadius() {
        return null;
      },
    },
  });
  await denyHarness.module.start();

  await denyHarness.eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      id: "combat-circle-unknown-deny",
      serverId: "S1",
      type: "damage",
      time: "2026-05-30T13:22:00.000Z",
      attackerName: "Alpha",
      attackerSteam64ID: "123",
      victimName: "Bravo",
      victimSteam64ID: "456",
      damage: 36,
      weaponName: "M4A1",
      tags: ["weapon.small_arm", "damage.direct"],
    },
  });

  await sleep(500);
  assert.equal(denyHarness.calls.length, 1);
  assert.equal(denyHarness.module.api.getEvents({ limit: 10 })[0].attackerWarning.skipReason, "attacker_leader_radius_unknown");
  await denyHarness.module.stop();

  const allowHarness = createHarness({
    moduleConfig: {
      showOnlyLightWeaponDamage: false,
      attackerDamageDisplayGate: {
        enabled: true,
        mode: "inside_leader_radius",
        fallbackWhenUnknown: "allow",
        applyToTypes: ["damage"],
        onlyLightWeapon: true,
      },
    },
    squadFollowState: {
      getPlayerFollowState() {
        return null;
      },
      isPlayerInsideLeaderRadius() {
        return null;
      },
    },
  });
  await allowHarness.module.start();

  await allowHarness.eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      id: "combat-circle-unknown-allow",
      serverId: "S1",
      type: "damage",
      time: "2026-05-30T13:23:00.000Z",
      attackerName: "Alpha",
      attackerSteam64ID: "123",
      victimName: "Bravo",
      victimSteam64ID: "456",
      damage: 36,
      weaponName: "M4A1",
      tags: ["weapon.small_arm", "damage.direct"],
    },
  });

  await sleep(500);
  assert.equal(allowHarness.calls.length, 2);
  assert.equal(allowHarness.module.api.getEvents({ limit: 10 })[0].attackerWarning.success, true);
  await allowHarness.module.stop();
}

async function testDamageDebounceAggregatesTwoHits() {
  const { module, eventBus, calls } = createHarness({
    moduleConfig: {
      showOnlyLightWeaponDamage: false,
    },
  });
  await module.start();

  const recordBase = {
    serverId: "S1",
    type: "damage",
    attackerName: "Alpha",
    attackerSteam64ID: "123",
    victimName: "Bravo",
    victimSteam64ID: "456",
    weaponName: "M4A1",
    tags: ["weapon.small_arm", "damage.direct"],
  };

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      ...recordBase,
      id: "agg-dmg-1",
      time: "2026-05-30T13:00:00.000Z",
      damage: 30,
    },
  });

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      ...recordBase,
      id: "agg-dmg-2",
      time: "2026-05-30T13:00:00.200Z",
      damage: 40,
    },
  });

  assert.equal(calls.length, 0);

  await sleep(500);

  assert.equal(calls.length, 2);
  assert.ok(String(calls[0].message).includes("70伤害"));
  assert.ok(String(calls[1].message).includes("70伤害"));

  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "damage");
  assert.equal(events[0].damage, 70);

  await module.stop();
}

async function testWoundMergesPendingDamageExcludingLastHit() {
  const { module, eventBus, calls } = createHarness({
    moduleConfig: {
      showOnlyLightWeaponDamage: false,
    },
  });
  await module.start();

  const recordBase = {
    serverId: "S1",
    attackerName: "Alpha",
    attackerSteam64ID: "123",
    victimName: "Bravo",
    victimSteam64ID: "456",
    weaponName: "M4A1",
    tags: ["weapon.small_arm"],
  };

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      ...recordBase,
      id: "wound-merge-dmg-1",
      type: "damage",
      time: "2026-05-30T13:10:00.000Z",
      damage: 30,
    },
  });

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      ...recordBase,
      id: "wound-merge-dmg-2",
      type: "damage",
      time: "2026-05-30T13:10:00.200Z",
      damage: 40,
    },
  });

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      ...recordBase,
      id: "wound-merge-wound",
      type: "wound",
      time: "2026-05-30T13:10:00.400Z",
      damage: 20,
    },
  });

  assert.equal(calls.length, 2);
  assert.ok(String(calls[0].message).includes("造成50伤害"));
  assert.ok(String(calls[1].message).includes("造成50伤害"));

  await sleep(500);
  assert.equal(calls.length, 2);

  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "wound");
  assert.equal(events[0].damage, 50);

  await module.stop();
}

await testProcessingAndWarnings();
await testDamageDebounceConfigAndDelay();
await testReviveResolvedWarnings();
await testTagDrivenMessages();
await testOnlyLightWeaponDamageSkipsNonLightWeapons();
await testForceAttackerDamageDisplayOverridesLightWeaponFilter();
await testOnlyLightWeaponDamageSkipsHeavyKillAttacker();
await testSamePlayerStillDisplays();
await testKillDisplayIsDisabledByDefault();
await testFractionalDamageRoundsToInteger();
await testCombatCleanDependencyGate();
await testAttackerCircleGateInsideAllowsDamage();
await testAttackerCircleGateOutsideSkipsDamage();
await testAttackerCircleGateUnknownFallbacks();
await testDamageDebounceAggregatesTwoHits();
await testWoundMergesPendingDamageExcludingLastHit();

console.log("infantry combat enhancer tests passed");
