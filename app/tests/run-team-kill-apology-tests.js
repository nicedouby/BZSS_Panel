import assert from "node:assert/strict";

import { createPlugin } from "../plugins/team-kill-duration-warning.js";

function createHarness() {
  const coreHandlers = new Map();
  const moduleHandlers = new Map();
  const warnings = [];
  const broadcasts = [];
  const actions = [];
  const configStore = new Map();
  const plugin = createPlugin({
    core: {
      webStatus: { serverId: "BZSS_Main" },
      pluginSubscriptions: { isSubscribed: () => true },
      webRegistry: { registerPage() {} },
      rconManager: { async dispatchCommand(request) { actions.push(request); return { success: true, command: request.command }; } },
      eventBus: {
        onCoreEvent(name, handler) { coreHandlers.set(name, handler); return () => coreHandlers.delete(name); },
        onModuleEvent(moduleId, name, handler) { moduleHandlers.set(`${moduleId}:${name}`, handler); return () => moduleHandlers.delete(`${moduleId}:${name}`); },
      },
    },
    modules: {
      playerState: {
        getPlayerBySteamID(_serverId, steamId) {
          return steamId === "steam-attacker" ? { name: "Attacker", steamId, eosId: "eos-attacker", playerId: "42" } : null;
        },
        getPlayerByEOSID(_serverId, eosId) {
          return eosId === "eos-attacker" ? { name: "Attacker", steamId: "steam-attacker", eosId, playerId: "42" } : null;
        },
      },
      adminWarn: {
        async sendAdminWarn(request) { warnings.push(request); return { success: true }; },
        async sendAdminBroadcast(request) { broadcasts.push(request); return { success: true }; },
      },
      squadManagement: {
        async executeAction(request) { actions.push(request); return { ok: true }; },
      },
    },
    config: {
      get(key, fallback) { return configStore.get(key) ?? fallback; },
      set(key, value) { configStore.set(key, value); },
      async save() {},
    },
    logger: { info() {}, warn() {} },
  });
  return { plugin, coreHandlers, moduleHandlers, warnings, broadcasts, actions };
}

const harness = createHarness();
await harness.plugin.start();
assert.equal(harness.coreHandlers.has("TEAM_KILL"), true);
assert.equal(harness.moduleHandlers.has("module.chatManager:CHAT_RECEIVED"), true);
assert.equal(harness.moduleHandlers.has("module.combatState:updated"), false);

await harness.plugin.api.handleTeamKill({
  eventName: "TEAM_KILL",
  eventId: "remote-tk-1",
  serverId: "BZSS_Main",
  attackerName: "Attacker",
  attackerSteam64ID: "steam-attacker",
  victimName: "Victim",
  victimSteam64ID: "steam-victim",
});
assert.equal(harness.plugin.api.getState().summary.pending, 1);
assert.equal(harness.plugin.api.getState().summary.totalTeamKills, 1);
assert.equal(harness.warnings.length, 1);
assert.equal(harness.broadcasts.length, 1);
assert.match(harness.broadcasts[0].message, /本局已 TK 1 名队友/);

await harness.plugin.api.handleChat({
  playerName: "Attacker",
  steamId: "steam-attacker",
  message: "sry bro",
});
assert.equal(harness.plugin.api.getState().summary.pending, 0);
assert.equal(harness.plugin.api.getState().summary.totalApologies, 1);
assert.equal(harness.plugin.api.getState().chats.length >= 1, true);
assert.equal(harness.plugin.api.getState().chats.some((chat) => chat.message === "sry bro" && chat.matched), true);

// The chat feed may only expose EOSID and a changed display name. It must
// still resolve to the pending TEAM_KILL player, including full-width Sorry.
await harness.plugin.api.handleTeamKill({
  eventName: "TEAM_KILL",
  eventId: "remote-tk-identity-fallback",
  serverId: "BZSS_Main",
  attackerName: "Attacker",
  attackerSteam64ID: "steam-attacker",
  victimName: "Victim EOS",
});
await harness.plugin.api.handleChat({
  payload: { playerName: "Attacker Renamed", eosId: "eos-attacker", message: "ＳＯＲＲＹ" },
});
assert.equal(harness.plugin.api.getState().summary.pending, 0);
assert.equal(harness.plugin.api.getState().summary.totalApologies, 2);

await harness.plugin.api.handleTeamKill({
  eventName: "TEAM_KILL",
  eventId: "remote-tk-2",
  serverId: "BZSS_Main",
  attackerName: "Attacker",
  attackerSteam64ID: "steam-attacker",
  victimName: "Victim Two",
});
assert.equal(harness.plugin.api.getState().players[0].count, 3);
harness.coreHandlers.get("round.world_bring_up")({});
assert.equal(harness.plugin.api.getState().summary.pending, 0);
assert.equal(harness.plugin.api.getState().summary.totalTeamKills, 0);

// English apology words must always be case-insensitive.
for (const [index, message] of ["sorry", "SORRY", "SoRrY"].entries()) {
  await harness.plugin.api.handleTeamKill({
    eventName: "TEAM_KILL",
    eventId: `case-insensitive-${index}`,
    serverId: "BZSS_Main",
    attackerName: "Attacker",
    attackerSteam64ID: "steam-attacker",
    victimName: `Victim ${index}`,
  });
  await harness.plugin.api.handleChat({
    playerName: "Attacker",
    steamId: "steam-attacker",
    message,
  });
  assert.equal(harness.plugin.api.getState().summary.pending, 0, `Expected ${message} to clear the apology case`);
}
assert.equal(harness.plugin.api.getState().summary.totalApologies, 3);

await harness.plugin.stop();
console.log("team kill apology tests passed");
