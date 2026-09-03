import assert from "node:assert/strict";
import { createCombatWsBridgeModule } from "../modules/combat-ws-bridge/index.js";

const listeners = new Map();
const on = (key, handler) => { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(handler); return () => listeners.get(key)?.delete(handler); };
const core = { webStatus: { serverId: "BZSS_Main" }, eventBus: { onCoreEvent: (name, fn) => on(name, fn), onModuleEvent: (moduleId, name, fn) => on(`${moduleId}:${name}`, fn) }, logger: { info() {}, warn() {}, error() {} } };
const modules = { matchState: { api: { getCurrentMatchId: () => "BZSS_Main:load" } } };
const configuration = { enabled: true, apiToken: "load", batch: { flushIntervalMs: 250, maxEvents: 64 }, delivery: { ackTimeoutMs: 3000, maxPendingBatches: 4096 }, monitor: { maxPackets: 1000, maxEvents: 3000 } };
const instance = createCombatWsBridgeModule({ core, modules, config: { get: (key, fallback) => key === "modules.combatWsBridge" ? configuration : fallback }, logger: core.logger });
await instance.start();
class AutoAckTransport {
  onMessage(handler) { this.message = handler; }
  onClose(handler) { this.closed = handler; }
  close() { this.closed?.(); }
  sendText(wire) {
    const packet = JSON.parse(wire);
    if (packet.t === "cb" || packet.t === "mf") this.message(JSON.stringify({ t: "ack", v: 1, pid: packet.pid, mid: packet.mid }));
  }
}
const transport = new AutoAckTransport();
instance.api.acceptWebSocket({ socket: {} }, transport);
transport.message(JSON.stringify({ t: "hello", v: 1, token: "load", client: "load-test" }));
const before = process.memoryUsage().heapUsed;
const startedAt = Date.now();
for (let i = 0; i < 60_000; i += 1) instance.api.ingestCombatEvent({ record: { type: i % 10 ? "damage" : "death", sourceMode: "live", canTriggerActions: true, time: Date.now(), attacker: { name: `A${i % 100}` }, victim: { name: `V${i % 100}` }, damage: i % 101, weapon: null } });
instance.api.flush();
const state = instance.api.getState();
const durationMs = Date.now() - startedAt;
const heapGrowthBytes = process.memoryUsage().heapUsed - before;
assert.equal(state.stats.accepted, 60_000);
assert.equal(state.pending.count, 0);
assert.ok(state.packets.total <= 1000);
assert.ok(state.events.total <= 3000);
assert.ok(heapGrowthBytes < 128 * 1024 * 1024);
await instance.stop();
console.log(JSON.stringify({ ok: true, simulatedEvents: 60_000, equivalentRate: "1000 events/s for 60 seconds", durationMs, heapGrowthBytes, pending: state.pending.count, monitorEvents: state.events.total, monitorPackets: state.packets.total }, null, 2));
