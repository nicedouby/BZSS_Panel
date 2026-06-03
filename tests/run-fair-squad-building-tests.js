import assert from "node:assert/strict";

import { createPlugin as createFairSquadBuildingPlugin } from "../plugins/fair-squad-building.js";

function createHarness(overrides = {}) {
  const registeredPages = [];
  const actionCalls = [];

  const state = {
    currentMatchId: "match-1",
    enforcementEnabled: true,
    window: "no-build",
    logClockSeconds: 15,
    noBuildUntilSeconds: 20,
    infantryOnlyUntilSeconds: 50,
    kickThreshold: 2,
    allowedInfantryNames: ["INF"],
    disbandPermission: "squad.disband",
    kickPermission: "squad.kick",
    removePermission: "squad.remove",
    switchPermission: "squad.switch",
    summary: {
      currentSquads: 3,
      trackedCreations: 3,
    },
    squads: [
      {
        active: true,
        teamId: 1,
        squadId: 1,
        generation: 1,
        squadName: "Tank",
        creatorName: "Builder",
        creatorKey: "builder",
        creatorSteamId: "steam-builder",
        creatorEosId: "",
        squadNature: "vehicle",
        squadNatureLabel: "Vehicle",
        memberCount: 4,
      },
      {
        active: true,
        teamId: 1,
        squadId: 2,
        generation: 1,
        squadName: "INF Main",
        creatorName: "Rifle",
        creatorKey: "rifle",
        creatorSteamId: "steam-rifle",
        creatorEosId: "",
        squadNature: "infantry",
        squadNatureLabel: "Infantry",
        memberCount: 3,
      },
      {
        active: true,
        teamId: 2,
        squadId: 3,
        generation: 1,
        squadName: "Mortar",
        creatorName: "Late",
        creatorKey: "late",
        creatorSteamId: "steam-late",
        creatorEosId: "",
        squadNature: "vehicle",
        squadNatureLabel: "Vehicle",
        memberCount: 2,
      },
    ],
    creators: [
      {
        creatorKey: "builder",
        creatorName: "Builder",
        steamId: "steam-builder",
        eosId: "",
        count: 3,
        latestSquadName: "Tank",
        latestTeamId: 1,
        latestSquadId: 1,
      },
      {
        creatorKey: "rifle",
        creatorName: "Rifle",
        steamId: "steam-rifle",
        eosId: "",
        count: 1,
        latestSquadName: "INF Main",
        latestTeamId: 1,
        latestSquadId: 2,
      },
    ],
    recentActions: [
      {
        time: "2026-06-03T00:00:00.000Z",
        action: "squad_created",
        source: "log",
        ok: true,
        error: "",
        message: "HIGH",
        reason: "LOG",
        command: "",
        system: false,
        target: { teamId: 1, squadId: 1 },
      },
    ],
    ...(overrides.state ?? {}),
  };

  const creationRecords = overrides.creationRecords ?? [
    { recordKey: "r1", kind: "squad_created", teamId: 1, squadId: 1, generation: 1, logSeconds: 5, time: "2026-06-03T00:00:00.000Z" },
    { recordKey: "r2", kind: "squad_created", teamId: 1, squadId: 2, generation: 1, logSeconds: 10, time: "2026-06-03T00:01:00.000Z" },
    { recordKey: "r3", kind: "squad_created", teamId: 2, squadId: 3, generation: 1, logSeconds: 70, time: "2026-06-03T00:02:00.000Z" },
  ];

  const plugin = createFairSquadBuildingPlugin({
    core: {
      webStatus: {
        serverId: "BZSS_Main",
      },
      authManager: {
        hasEverything(user) {
          return Boolean(user?.isSuperAdmin);
        },
        hasPermission(user, permission) {
          return Boolean(user?.isSuperAdmin || user?.permissions?.includes?.(permission));
        },
      },
      webRegistry: {
        registerPage(page) {
          registeredPages.push(page);
        },
      },
    },
    modules: {
      squadManagement: {
        getState() {
          return state;
        },
        async getRecords(query) {
          if (query?.kind === "squad_created") {
            return {
              ok: true,
              kind: "squad_created",
              limit: Number(query.limit ?? 1000),
              offset: Number(query.offset ?? 0),
              total: creationRecords.length,
              summary: {
                total: creationRecords.length,
                created: creationRecords.length,
                disbanded: 0,
                kicked: 0,
                removed: 0,
                switched: 0,
                actions: 0,
                success: 0,
                failed: 0,
                lastEventAt: creationRecords[creationRecords.length - 1]?.time ?? "",
              },
              records: creationRecords,
            };
          }
          return {
            ok: true,
            kind: query?.kind ?? "all",
            limit: Number(query?.limit ?? 1000),
            offset: Number(query?.offset ?? 0),
            total: 0,
            summary: {
              total: 0,
              created: 0,
              disbanded: 0,
              kicked: 0,
              removed: 0,
              switched: 0,
              actions: 0,
              success: 0,
              failed: 0,
              lastEventAt: "",
            },
            records: [],
          };
        },
        async executeAction(payload) {
          actionCalls.push(payload);
          return {
            ok: true,
            type: payload.type,
            action: payload.type,
            serverId: payload.serverId,
            source: payload.source,
            reason: payload.reason ?? "",
          };
        },
      },
      pluginSubscriptions: {
        isSubscribed() {
          return true;
        },
      },
    },
    config: {
      get(pathText, fallback) {
        if (pathText === "plugins.fairSquadBuilding") {
          return { enabled: true };
        }
        return fallback;
      },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
  });

  return {
    plugin,
    registeredPages,
    actionCalls,
  };
}

async function testPluginRegistersPageAndDerivesViolations() {
  const harness = createHarness();
  await harness.plugin.start();

  assert.equal(harness.registeredPages.length, 1);
  assert.equal(harness.registeredPages[0].route, "/plugins/fair-squad-building");

  const pageState = await harness.plugin.api.getPageState("BZSS_Main", {
    username: "operator",
    role: "Operator",
    permissions: ["squad.disband", "squad.kick"],
  });

  assert.equal(pageState.plugin.active, true);
  assert.equal(pageState.viewer.canDisband, true);
  assert.equal(pageState.viewer.canKick, true);
  assert.equal(pageState.viewer.canRemove, false);
  assert.equal(pageState.violations.length, 4);
  assert.equal(pageState.violations.some((item) => item.kind === "no_build"), true);
  assert.equal(pageState.violations.some((item) => item.kind === "infantry_only"), true);
  assert.equal(pageState.violations.some((item) => item.kind === "creator_threshold"), true);
  assert.equal(pageState.creators.find((item) => item.creatorKey === "builder")?.overThreshold, true);
}

async function testExecuteActionProxyUsesPluginSource() {
  const harness = createHarness();
  const actor = {
    username: "operator",
    role: "Operator",
    permissions: ["squad.disband"],
  };

  const result = await harness.plugin.api.executeAction({
    type: "disband_squad",
    teamId: 1,
    squadId: 1,
    reason: "manual test",
  }, actor);

  assert.equal(result.ok, true);
  assert.equal(harness.actionCalls.length, 1);
  assert.equal(harness.actionCalls[0].source, "web.fairSquadBuilding");
  assert.equal(harness.actionCalls[0].actor.username, "operator");
  assert.equal(harness.actionCalls[0].teamId, 1);
  assert.equal(harness.actionCalls[0].squadId, 1);
}

await testPluginRegistersPageAndDerivesViolations();
await testExecuteActionProxyUsesPluginSource();

console.log("fair squad building tests passed");
