import assert from "node:assert/strict";
import { RuntimeState } from "../core/runtime-state.js";

function createHarness() {
  const listeners = new Map();
  const coreEvents = [];

  const eventBus = {
    onCoreEvent(eventName, handler) {
      const list = listeners.get(eventName) ?? [];
      list.push(handler);
      listeners.set(eventName, list);
      return () => {
        const next = (listeners.get(eventName) ?? []).filter((item) => item !== handler);
        listeners.set(eventName, next);
      };
    },
    emitCoreEvent(eventName, payload) {
      coreEvents.push({ eventName, payload });
      for (const handler of listeners.get(eventName) ?? []) {
        handler(payload);
      }
    },
  };

  const runtimeState = new RuntimeState({
    eventBus,
    webStatus: {
      serverId: "BZSS_Main",
      getSnapshot() {
        return {};
      },
    },
    logger: {
      warn() {},
      info() {},
      error() {},
      debug() {},
    },
  });

  return {
    runtimeState,
    eventBus,
    coreEvents,
  };
}

function testSquadSnapshotUpdateAndFailureRetention() {
  const harness = createHarness();
  const updatedAt = "2026-05-12T00:00:00.000Z";

  harness.eventBus.emitCoreEvent("RUNTIME_SQUADS_UPDATED", {
    serverId: "BZSS_Main",
    source: "rcon:listSquads",
    time: updatedAt,
    ok: true,
    squads: [
      {
        teamID: 1,
        squadID: 2,
        teamName: "USA",
        squadName: "Alpha",
        size: 1,
        locked: false,
        creatorName: "Alice",
        creatorSteamId: "76561198000000001",
      },
    ],
  });

  const snapshot = harness.runtimeState.getSquads();
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.error, null);
  assert.equal(snapshot.count, 1);
  assert.equal(snapshot.list[0].squadName, "Alpha");
  assert.equal(snapshot.list[0].leaderName, "Alice");
  assert.equal(snapshot.teams[0].squads[0].squadName, "Alpha");

  harness.eventBus.emitCoreEvent("RUNTIME_SQUADS_REFRESH_FAILED", {
    serverId: "BZSS_Main",
    source: "core.rconManager",
    time: "2026-05-12T00:00:05.000Z",
    ok: false,
    error: "simulated failure",
  });

  const failedSnapshot = harness.runtimeState.getSquads();
  assert.equal(failedSnapshot.ok, false);
  assert.equal(failedSnapshot.error, "simulated failure");
  assert.equal(failedSnapshot.count, 1);
  assert.equal(failedSnapshot.list[0].squadName, "Alpha");
}

testSquadSnapshotUpdateAndFailureRetention();

console.log("runtime state tests passed");
