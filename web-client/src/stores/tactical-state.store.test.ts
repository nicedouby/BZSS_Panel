import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises } from "@vue/test-utils";
import { isReactive, reactive } from "vue";

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

import { useServerStore } from "./server.store";
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

  it("uses the SSE initial snapshot for bootstrap instead of duplicating it with REST", async () => {
    hooks.fetchMock.mockResolvedValueOnce(snapshot(99, [player("rest", 99)]));
    const store = useTacticalStateStore();

    const bootstrap = store.fetchSnapshot();
    store.startStream();
    await bootstrap;
    await flushPromises();

    expect(hooks.fetchMock).not.toHaveBeenCalled();

    const live = player("stream", 1);
    hooks.onMessage?.({ ...snapshot(1, [live]), type: "tactical-state.snapshot" });
    await flushPromises();

    expect(store.players).toHaveLength(1);
    expect(store.players[0]).toBe(live);
    store.stopStream();
  });

  it("drops duplicate and older full snapshots before rebuilding reactive state", async () => {
    const store = useTacticalStateStore();
    store.startStream();

    const firstPlayer = player("p1", 1);
    hooks.onMessage?.({
      ok: true,
      type: "tactical-state.snapshot",
      snapshot: {
        meta: { serverId: "server-a", revision: 10, generatedAt: "2026-08-08T12:00:10.000Z" },
        server: { serverId: "server-a" },
        teams: [],
        assets: {},
        diagnostics: {},
        players: [firstPlayer],
      },
    });
    await flushPromises();
    const retained = store.players[0];

    hooks.onMessage?.({
      ok: true,
      type: "tactical-state.snapshot",
      snapshot: {
        meta: { serverId: "server-a", revision: 10, generatedAt: "2026-08-08T12:00:10.000Z" },
        server: { serverId: "server-a" },
        teams: [],
        assets: {},
        diagnostics: {},
        players: [player("duplicate", 2)],
      },
    });
    hooks.onMessage?.({
      ok: true,
      type: "tactical-state.snapshot",
      snapshot: {
        meta: { serverId: "server-a", revision: 9, generatedAt: "2026-08-08T12:00:09.000Z" },
        server: { serverId: "server-a" },
        teams: [],
        assets: {},
        diagnostics: {},
        players: [player("older", 3)],
      },
    });
    await flushPromises();

    expect(store.players).toHaveLength(1);
    expect(store.players[0]).toBe(retained);
    expect(store.players[0].identity.key).toBe("p1");
    store.stopStream();
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

  it("keeps full and delta players raw when inserted into a reactive window state", async () => {
    const store = useTacticalStateStore();
    store.startStream();
    const p1 = player("p1", 1);
    hooks.onMessage?.({ ...snapshot(1, [p1]), type: "tactical-state.snapshot" });
    await flushPromises();

    expect(store.players[0]).toBe(p1);
    expect(isReactive(store.players[0])).toBe(false);
    const fullHolder = reactive({ player: store.players[0] });
    expect(fullHolder.player).toBe(p1);

    const p2 = player("p2", 2);
    hooks.onMessage?.({
      ok: true,
      type: "tactical-state.delta",
      revision: 2,
      delta: { meta: { revision: 2 }, players: { upsert: [p2], remove: [] } },
    });
    await flushPromises();

    expect(store.players[1]).toBe(p2);
    expect(isReactive(store.players[1])).toBe(false);
    const deltaHolder = reactive({ player: store.players[1] });
    expect(deltaHolder.player).toBe(p2);
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

  it("propagates live layer changes and clears stale map identity without F5", async () => {
    const store = useTacticalStateStore();
    const serverStore = useServerStore();
    store.startStream();

    hooks.onMessage?.({
      ok: true,
      type: "tactical-state.snapshot",
      snapshot: {
        meta: { revision: 1 },
        server: { layer: "Tallil_RAAS_v1" },
        match: { layer: "Tallil_RAAS_v1" },
        teams: [],
        assets: {},
        diagnostics: {},
        players: [],
      },
    });
    await flushPromises();
    expect(serverStore.snapshot.mapName).toBe("Tallil_RAAS_v1");

    hooks.onMessage?.({
      ok: true,
      type: "tactical-state.delta",
      revision: 2,
      delta: {
        meta: { revision: 2 },
        server: { layer: "Yehorivka_RAAS_v2" },
        match: { layer: "Yehorivka_RAAS_v2" },
      },
    });
    await flushPromises();
    expect(serverStore.snapshot.mapName).toBe("Yehorivka_RAAS_v2");

    hooks.onMessage?.({
      ok: true,
      type: "tactical-state.delta",
      revision: 3,
      delta: {
        meta: { revision: 3 },
        server: { layer: "Unregistered_Custom_Layer" },
        match: { layer: "Unregistered_Custom_Layer" },
      },
    });
    await flushPromises();
    expect(serverStore.snapshot.mapName).toBe("Unregistered_Custom_Layer");

    hooks.onMessage?.({
      ok: true,
      type: "tactical-state.delta",
      revision: 4,
      delta: {
        meta: { revision: 4 },
        server: {},
        match: {},
      },
    });
    await flushPromises();
    expect(serverStore.snapshot.mapName).toBe("");
    store.stopStream();
  });
});
