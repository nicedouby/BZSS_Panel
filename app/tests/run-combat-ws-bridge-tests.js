import assert from "node:assert/strict";
import { createCombatWsBridgeModule } from "../modules/combat-ws-bridge/index.js";
import { compactCombatEvent } from "../modules/combat-ws-bridge/protocol.js";

const tests = [];
const test = (name, run) => tests.push({ name, run });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createEvent(type = "damage", extra = {}) {
  return { eventName: "module.combatCollector.combatEvent", time: "2026-09-03T08:00:00.000Z", record: { id: `event:${Math.random()}`, type, sourceMode: "live", isReplay: false, canTriggerActions: true, attacker: { name: "Attacker", steam64ID: "1", eosID: "e1" }, victim: { name: "Victim", steam64ID: "2", eosID: "e2" }, damage: 42.5, weapon: "BP_M4A1_C", ...extra } };
}

function createHarness(overrides = {}) {
  const coreListeners = new Map();
  const moduleListeners = new Map();
  let matchId = overrides.matchId === undefined ? "BZSS_Main:match-a" : overrides.matchId;
  const on = (map, key, fn) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(fn); return () => map.get(key)?.delete(fn); };
  const configValue = { enabled: true, apiToken: "12345", websocket: { authTimeoutMs: 100, heartbeatIntervalMs: 100, heartbeatTimeoutMs: 200 }, batch: { flushIntervalMs: 20, maxEvents: 64 }, delivery: { ackTimeoutMs: 50, maxPendingBatches: 100, maxUnassignedEvents: 100 }, monitor: { maxPackets: 10, maxEvents: 20 }, ...overrides.config };
  const core = { webStatus: { serverId: "BZSS_Main" }, eventBus: { onCoreEvent: (name, fn) => on(coreListeners, name, fn), onModuleEvent: (moduleId, name, fn) => on(moduleListeners, `${moduleId}:${name}`, fn) }, logger: { info() {}, warn() {}, error() {} } };
  const modules = { matchState: { getCurrentMatchId: () => matchId } };
  const instance = createCombatWsBridgeModule({ core, modules, config: { get: (key, fallback) => key === "modules.combatWsBridge" ? configValue : key === "server.id" ? "BZSS_Main" : fallback }, logger: core.logger });
  return { instance, api: instance.api, setMatchId(value) { matchId = value; }, start: () => instance.start(), stop: () => instance.stop() };
}

class FakeTransport {
  constructor() { this.messages = []; this.closeInfo = null; this.messageHandler = null; this.closeHandler = null; }
  sendText(value) { this.messages.push(JSON.parse(value)); }
  close(code, reason) { this.closeInfo = { code, reason }; this.closeHandler?.(); }
  onMessage(handler) { this.messageHandler = handler; }
  onClose(handler) { this.closeHandler = handler; }
  receive(value) { this.messageHandler?.(JSON.stringify(value)); }
  disconnect() { this.closeHandler?.(); }
  packets(type = "cb") { return this.messages.filter((item) => item.t === type); }
}

async function withHarness(options, run) { const harness = createHarness(options); await harness.start(); try { await run(harness); } finally { await harness.stop(); } }

test("1 Damage 正常发送", () => withHarness({}, async ({ api }) => { api.ingestCombatEvent(createEvent("damage")); api.flush(); assert.equal(api.getState().events.items[0].k, "dmg"); }));
test("2 Wound 映射为 down", () => withHarness({}, async ({ api }) => { api.ingestCombatEvent(createEvent("wound")); api.flush(); assert.equal(api.getState().events.items[0].k, "down"); }));
test("3 Death 映射为 kill", () => withHarness({}, async ({ api }) => { api.ingestCombatEvent(createEvent("death")); api.flush(); assert.equal(api.getState().events.items[0].k, "kill"); }));
test("4 Revive 映射为 rev", () => withHarness({}, async ({ api }) => { api.ingestReviveEvent(createEvent("revive")); api.flush(); assert.equal(api.getState().events.items[0].k, "rev"); }));
test("5 TEAM_KILL 映射为 tk", () => withHarness({}, async ({ api }) => { api.ingestTeamKillEvent(createEvent("tk")); api.flush(); assert.equal(api.getState().events.items[0].k, "tk"); }));
test("6 attacker=null 仍发送", () => withHarness({}, async ({ api }) => { api.ingestCombatEvent(createEvent("damage", { attacker: null, attackerName: "" })); api.flush(); assert.equal(api.getState().events.items[0].a, null); }));
test("7 victim=null 仍发送", () => withHarness({}, async ({ api }) => { api.ingestCombatEvent(createEvent("damage", { victim: null, victimName: "" })); api.flush(); assert.equal(api.getState().events.items[0].v, null); }));
test("8 双方 null 仍发送", () => withHarness({}, async ({ api }) => { api.ingestCombatEvent(createEvent("damage", { attacker: null, victim: null })); api.flush(); const event = api.getState().events.items[0]; assert.equal(event.a, null); assert.equal(event.v, null); }));
test("9 Replay 不发送", () => withHarness({}, async ({ api }) => { api.ingestCombatEvent({ ...createEvent(), isReplay: true }); api.flush(); assert.equal(api.getState().events.items.length, 0); }));
test("10 64 Event 自动 Flush", () => withHarness({}, async ({ api }) => { for (let i = 0; i < 64; i += 1) api.ingestCombatEvent(createEvent()); assert.equal(api.getState().packets.items[0].events, 64); }));
test("11 定时自动 Flush", () => withHarness({}, async ({ api }) => { api.ingestCombatEvent(createEvent()); await wait(35); assert.equal(api.getState().packets.items.length, 1); }));
test("12 一个 Batch 只有一个 Match ID", () => withHarness({}, async ({ api }) => { api.ingestCombatEvent(createEvent()); api.ingestCombatEvent(createEvent()); api.flush(); const summary = api.getState().packets.items[0]; const packet = JSON.parse(api.getState({ packetId: summary.pid }).packetDetail.wire); assert.equal(packet.mid, "BZSS_Main:match-a"); assert.ok(packet.e.every((event) => !("mid" in event))); }));
test("13 Match A -> B 立即 Flush", () => withHarness({}, async ({ api, setMatchId }) => { api.ingestCombatEvent(createEvent()); setMatchId("BZSS_Main:match-b"); api.ingestCombatEvent(createEvent()); api.flush(); assert.deepEqual(new Set(api.getState().packets.items.map((x) => x.mid)), new Set(["BZSS_Main:match-a", "BZSS_Main:match-b"])); }));
test("14 缺少 Match ID 不生成 synthetic ID", () => withHarness({ matchId: null }, async ({ api }) => { api.ingestCombatEvent(createEvent()); assert.equal(api.getState().packets.items.length, 0); assert.equal(api.getState().buffer.unassignedEvents, 1); }));
test("15 Match ID 恢复后发送 unassigned", () => withHarness({ matchId: null }, async ({ api, setMatchId }) => { api.ingestCombatEvent(createEvent()); setMatchId("BZSS_Main:restored"); api.notifyMatchAvailable(); api.flush(); assert.equal(api.getState().packets.items[0].mid, "BZSS_Main:restored"); }));
test("16 客户端认证失败", () => withHarness({}, async ({ api }) => { const transport = new FakeTransport(); api.acceptWebSocket({ socket: {} }, transport); transport.receive({ t: "hello", v: 1, token: "wrong", client: "test" }); assert.equal(transport.closeInfo.code, 4003); }));
test("17 客户端认证成功", () => withHarness({}, async ({ api }) => { const transport = new FakeTransport(); api.acceptWebSocket({ socket: {} }, transport); transport.receive({ t: "hello", v: 1, token: "12345", client: "test" }); assert.equal(transport.messages[0].t, "welcome"); assert.equal(api.getState().clients[0].authenticated, true); }));
test("18 ACK 后 Pending 删除", () => withHarness({}, async ({ api }) => { const transport = new FakeTransport(); api.acceptWebSocket({ socket: {} }, transport); transport.receive({ t: "hello", v: 1, token: "12345", client: "test" }); api.ingestCombatEvent(createEvent()); api.flush(); const packet = transport.packets()[0]; assert.equal(api.getState().pending.count, 1); transport.receive({ t: "ack", v: 1, pid: packet.pid, mid: packet.mid }); assert.equal(api.getState().pending.count, 0); }));
test("19 未 ACK 使用相同 PID 重发", () => withHarness({}, async ({ api }) => { const transport = new FakeTransport(); api.acceptWebSocket({ socket: {} }, transport); transport.receive({ t: "hello", v: 1, token: "12345", client: "test" }); api.ingestCombatEvent(createEvent()); api.flush(); await wait(90); const packets = transport.packets(); assert.ok(packets.length >= 2); assert.equal(packets[0].pid, packets[1].pid); }));
test("20 断线重连恢复 Pending", () => withHarness({}, async ({ api }) => { const first = new FakeTransport(); api.acceptWebSocket({ socket: {} }, first); first.receive({ t: "hello", v: 1, token: "12345", client: "test" }); api.ingestCombatEvent(createEvent()); api.flush(); const pid = first.packets()[0].pid; first.disconnect(); const second = new FakeTransport(); api.acceptWebSocket({ socket: {} }, second); second.receive({ t: "hello", v: 1, token: "12345", client: "test" }); assert.equal(second.packets()[0].pid, pid); }));
test("21 Heartbeat timeout 断开", () => withHarness({}, async ({ api }) => { const transport = new FakeTransport(); api.acceptWebSocket({ socket: {} }, transport); transport.receive({ t: "hello", v: 1, token: "12345", client: "test" }); await wait(330); assert.equal(transport.closeInfo?.code, 4008); }));
test("22 监控 Ring Buffer 有界", () => withHarness({ config: { monitor: { maxPackets: 2, maxEvents: 3 }, batch: { flushIntervalMs: 20, maxEvents: 1 } } }, async ({ api }) => { for (let i = 0; i < 8; i += 1) api.ingestCombatEvent(createEvent()); const state = api.getState(); assert.equal(state.packets.items.length, 2); assert.equal(state.events.items.length, 3); }));
test("协议精简只保留玩家 n/s/e", () => { const event = compactCombatEvent(createEvent("damage", { attacker: { name: "A", steam64ID: "1", eosID: "2", teamID: 1, controllerID: "x" } })); assert.deepEqual(event.a, { n: "A", s: "1", e: "2" }); });
test("match.finished 独立发送且只入队一次", () => withHarness({}, async ({ api }) => { const packet = api.enqueueMatchFinished({ matchId: "BZSS_Main:finished", data: { ok: true } }); const state = api.getState({ packetId: packet.pid }); assert.equal(state.packets.total, 1); assert.equal(state.packetDetail.type, "mf"); assert.equal(state.pending.count, 1); }));

let failures = 0;
for (const entry of tests) { try { await entry.run(); console.log(`✓ ${entry.name}`); } catch (error) { failures += 1; console.error(`✗ ${entry.name}\n${error?.stack ?? error}`); } }
if (failures) process.exitCode = 1; else console.log(`Combat WS bridge: ${tests.length} tests passed.`);
