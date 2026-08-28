import assert from "node:assert/strict";

import { createMatchPlayerPresenceModule } from "../modules/match-player-presence/index.js";

function createEventBus() {
  const listeners = new Map();
  const on = (key, handler) => {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(handler);
    return () => listeners.get(key)?.delete(handler);
  };
  return {
    onCoreEvent(name, handler) {
      return on(`core:${name}`, handler);
    },
    onModuleEvent(moduleId, name, handler) {
      return on(`module:${moduleId}:${name}`, handler);
    },
    emitCoreEvent(name, event) {
      for (const handler of listeners.get(`core:${name}`) ?? []) handler(event);
    },
    emitModuleEvent(moduleId, name, event) {
      for (const handler of listeners.get(`module:${moduleId}:${name}`) ?? []) handler(event);
    },
  };
}

async function main() {
  const eventBus = createEventBus();
  let provider = null;
  let flushCount = 0;
  const modules = {
    matchCache: {
      registerProvider(value) {
        provider = value;
      },
      markDirty() {},
      async flush() {
        flushCount += 1;
      },
    },
  };
  const module = createMatchPlayerPresenceModule({
    core: {
      eventBus,
      webStatus: { serverId: "server-1" },
      logger: { info() {}, warn() {} },
    },
    modules,
    config: { get: (_key, fallback) => fallback },
    logger: { info() {}, warn() {} },
  });

  await module.start();
  assert.ok(provider, "match cache provider should be registered");

  provider.importState({
    version: 1,
    updatedAt: "2026-08-28T00:00:10.000Z",
    players: {
      "steam:76561198000000001": {
        steamID: "76561198000000001",
        lastName: "Alpha",
        observedOnlineMs: 10_000,
        estimatedGapMs: 0,
        online: false,
      },
    },
  }, {
    serverId: "server-1",
    savedAt: "2026-08-28T00:00:10.000Z",
    restoredAt: "2026-08-28T00:00:10.000Z",
  });

  assert.equal(module.api.getPlayers("server-1")[0].matchOnlineMs, 10_000);
  assert.deepEqual(
    module.api.getExchangeEligibility(
      { steamID: "76561198000000001" },
      { serverId: "server-1", requiredSeconds: 15 },
    ),
    {
      eligible: false,
      serverId: "server-1",
      requiredSeconds: 15,
      matchOnlineSeconds: 10,
      remainingSeconds: 5,
      player: module.api.getPlayer({ steamID: "76561198000000001" }, "server-1"),
    },
  );

  eventBus.emitCoreEvent("RCON_LIST_PLAYERS_UPDATED", {
    serverId: "server-1",
    time: "2026-08-28T00:00:10.000Z",
    players: [{ steamID: "76561198000000001", name: "Alpha" }],
  });
  const exported = provider.exportState({
    serverId: "server-1",
    savedAt: "2026-08-28T00:00:20.000Z",
  });
  assert.equal(
    exported.players["steam:76561198000000001"].observedOnlineMs,
    20_000,
    "active segment should be settled into the persisted snapshot",
  );

  eventBus.emitModuleEvent("module.matchState", "newRoundDetected", { serverId: "server-1" });
  assert.equal(module.api.getPlayers("server-1").length, 0, "new round should reset accumulated time");

  await module.stop();
  assert.equal(flushCount, 1, "panel shutdown should flush the current match cache");
  console.log("match player presence tests passed");
}

await main();
