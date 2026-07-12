import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises } from "@vue/test-utils";

const hooks = vi.hoisted(() => {
  const state = {
    onMessage: null as ((message: any) => void) | null,
    fetchMock: vi.fn(),
    streamMock: vi.fn(),
  };
  state.streamMock.mockImplementation((onMessage: (message: any) => void) => {
    state.onMessage = onMessage;
    return () => { state.onMessage = null; };
  });
  return state;
});

vi.mock("../app/tacticalStateApi", () => ({
  fetchTacticalStateSnapshot: hooks.fetchMock,
  streamTacticalStateSnapshot: hooks.streamMock,
}));

import { useTacticalStateStore } from "./tactical-state.store";

function player(key: string, x: number) {
  return { identity: { key, name: key }, telemetry: { position: { x, y: 0 } } };
}

function snapshot(revision: number, players: any[]) {
  return {
    ok: true,
    snapshot: {
      meta: { revision },
      server: {},
      teams: [],
      assets: {},
      diagnostics: {},
      players,
    },
  };
}

describe("tactical-state store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    hooks.onMessage = null;
    hooks.fetchMock.mockReset();
    hooks.streamMock.mockClear();
  });

  it("preserves unchanged player references and applies remove/upsert in stable order", async () => {
    const store = useTacticalStateStore();
    store.startStream();
    const p1 = player("p1", 1);
    const p2 = player("p2", 2);
    hooks.onMessage?.({ ...snapshot(1, [p1, p2]), type: "tactical-state.snapshot" });
    await flushPromises();
    const beforeP1 = store.players[0];

    const nextP2 = player("p2", 20);
    hooks.onMessage?.({
      ok: true,
      type: "tactical-state.delta",
      revision: 2,
      delta: { meta: { revision: 2 }, players: { upsert: [nextP2], remove: [] } },
    });
    await flushPromises();
    expect(store.players[0]).toBe(beforeP1);
    expect(store.players[1]).toBe(nextP2);

    const p3 = player("p3", 3);
    hooks.onMessage?.({
      ok: true,
      type: "tactical-state.delta",
      revision: 3,
      delta: { meta: { revision: 3 }, players: { upsert: [p3], remove: ["p1"] } },
    });
    await flushPromises();
    expect(store.players.map((item) => item.identity.key)).toEqual(["p2", "p3"]);
    store.stopStream();
  });

  it("ignores old deltas and resyncs on a revision gap", async () => {
    hooks.fetchMock.mockResolvedValueOnce(snapshot(7, [player("fresh", 7)]));
    const store = useTacticalStateStore();
    store.startStream();
    hooks.onMessage?.({ ...snapshot(2, [player("p1", 1)]), type: "tactical-state.snapshot" });
    await flushPromises();

    hooks.onMessage?.({
      ok: true, type: "tactical-state.delta", revision: 2,
      delta: { players: { upsert: [player("old", 0)], remove: [] } },
    });
    await flushPromises();
    expect(store.players.some((item) => item.identity.key === "old")).toBe(false);

    hooks.onMessage?.({
      ok: true, type: "tactical-state.delta", revision: 4,
      delta: { players: { upsert: [player("gap", 4)], remove: [] } },
    });
    await flushPromises();
    expect(hooks.fetchMock).toHaveBeenCalledTimes(1);
    expect(store.snapshot.meta.revision).toBe(7);
    expect(store.players[0].identity.key).toBe("fresh");
    store.stopStream();
  });
});
