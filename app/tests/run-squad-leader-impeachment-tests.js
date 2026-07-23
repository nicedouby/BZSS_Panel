import assert from "node:assert/strict";
import { createPlugin } from "../plugins/squad-leader-impeachment.js";

const sleep = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
function player(name, teamId, squadId, isLeader = false) { return { name, steamId: `steam-${name}`, playerId: `pid-${name}`, teamId, squadId, isLeader }; }
function snapshot(count = 51) {
  const players = [player("Init", 1, 1, true), ...Array.from({ length: 8 }, (_, i) => player(`I${i}`, 1, 1)), player("Target", 1, 2, true), ...Array.from({ length: 7 }, (_, i) => player(`T${i}`, 1, 2)), player("Voter", 1, 3, true), ...Array.from({ length: 7 }, (_, i) => player(`V${i}`, 1, 3))];
  while (players.length < count) players.push(player(`F${players.length}`, 2, 0));
  const makeSquad = (id) => ({ teamId: 1, squadId: id, generation: `g-${id}`, createdAtMs: id, active: true, memberCount: players.filter(p => p.teamId === 1 && p.squadId === id).length, leaderName: players.find(p => p.teamId === 1 && p.squadId === id && p.isLeader)?.name, leaderSteamId: `steam-${id === 1 ? "Init" : id === 2 ? "Target" : "Voter"}`, members: players.filter(p => p.teamId === 1 && p.squadId === id) });
  return { players, squads: [makeSquad(1), makeSquad(2), makeSquad(3)] };
}
function makeHarness(count = 51) {
  let current = snapshot(count); const warnings=[]; const actions=[]; let listener=null;
  const plugin = createPlugin({ config: { get(key, fallback) { return key === "plugins.squadLeaderImpeachment" ? { directory: "/tmp/bzss-impeachment-tests", selectionTimeoutMs: 30_000, voteTimeoutMs: 90_000 } : fallback; } }, core: { pluginSubscriptions: { isSubscribed: () => true }, webStatus: { serverId: "s1" }, webRegistry: { registerPage() {} }, eventBus: { onCoreEvent() { return () => {}; } } }, modules: { pluginSubscriptions: { isSubscribed: () => true }, chatManager: { on(_type, fn) { listener = fn; return () => {}; } }, squadManagement: { getState: () => current, executeAction: async request => { actions.push(request); return { ok: true, command: "mock" }; } }, adminWarn: { async sendAdminWarn(x) { warnings.push(x); } } } });
  return { plugin, warnings, actions, async chat(name, message) { const p = current.players.find(x => x.name === name); await listener({ serverId: "s1", playerName: p.name, steamId: p.steamId, message }); await sleep(); }, setSnapshot(value) { current = value; } };
}

{ const h=makeHarness(50); await h.plugin.start(); await h.chat("Init","THDZ"); assert.match(h.warnings.at(-1).message,/超过50人/); await h.plugin.stop(); }
{ const h=makeHarness(); await h.plugin.start(); await h.chat("I0","THDZ"); assert.match(h.warnings.at(-1).message,/仅当前小队队长/); await h.plugin.stop(); }
{ const h=makeHarness(); await h.plugin.start(); await h.chat("Init","THDZ"); assert.match(h.warnings.at(-1).message,/请选择目标/); await h.chat("Init","1"); assert.match(h.warnings.at(-1).message,/请选择目标/); await h.chat("Init","2"); await h.chat("Init","1"); const vote=h.plugin.api.getDebugSnapshot().votes[0]; assert.equal(vote.yesWeight,9); assert.equal(vote.noWeight,8); assert.equal(vote.teamPlayerCount,25); await h.chat("Voter","THDZ 1"); assert.equal(h.actions.length,1); assert.equal(h.actions[0].type,"disband_squad"); await h.plugin.stop(); }
console.log("squad-leader-impeachment tests passed");
