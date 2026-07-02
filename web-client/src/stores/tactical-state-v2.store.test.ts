import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises } from "@vue/test-utils";

const hooks = vi.hoisted(() => {
  const state: {
    onMessage: ((message: any) => void) | null;
    fetchMock: ReturnType<typeof vi.fn>;
    streamMock: ReturnType<typeof vi.fn>;
  } = {
    onMessage: null,
    fetchMock: vi.fn(),
    streamMock: vi.fn(),
  };

  state.streamMock.mockImplementation((onMessage: (message: any) => void) => {
    state.onMessage = onMessage;
    return () => {
      state.onMessage = null;
    };
  });

  return state;
});

vi.mock("../app/tacticalStateV2Api", () => ({
  fetchTacticalStateV2Snapshot: hooks.fetchMock,
  streamTacticalStateV2: hooks.streamMock,
}));

import { useTacticalStateV2Store } from "./tactical-state-v2.store";

function buildSnapshot(revision: number, key: string) {
  return {
    ok: true,
    snapshot: {
      meta: { revision },
      server: { serverId: "server-1" },
      match: { phase: "LIVE" },
      teams: [],
      players: [
        {
          identity: { key, name: key },
          telemetry: { position: { x: 1, y: 2 }, health: 100 },
          match: { teamId: 1, squadId: 1 },
        },
      ],
      assets: {
        captureZones: [],
        fobs: [],
        mainZones: [],
        explosions: [],
      },
      squadFollow: null,
      diagnostics: { generatedAt: "2026-07-02T00:00:00.000Z" },
    },
  };
}

describe("tactical-state-v2 store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    hooks.onMessage = null;
    hooks.fetchMock.mockReset();
    hooks.streamMock.mockClear();
  });

  it("resyncs the snapshot when a patch revision jumps", async () => {
    hooks.fetchMock.mockResolvedValueOnce(buildSnapshot(7, "p2"));

    const store = useTacticalStateV2Store();
    store.startStream();

    expect(hooks.streamMock).toHaveBeenCalledTimes(1);

    hooks.onMessage?.({
      type: "snapshot",
      revision: 1,
      snapshot: buildSnapshot(1, "p1").snapshot,
    });

    expect(store.revision).toBe(1);
    expect(store.playersByKey.has("p1")).toBe(true);

    hooks.onMessage?.({
      type: "patch",
      revision: 3,
      patches: [{ op: "player.remove", key: "p1" }],
      server: { serverId: "server-1" },
      match: { phase: "LIVE" },
      teams: [],
      squadFollow: null,
      diagnostics: { generatedAt: "2026-07-02T00:00:00.000Z" },
    });

    await flushPromises();

    expect(hooks.fetchMock).toHaveBeenCalledTimes(1);
    expect(store.revision).toBe(7);
    expect(store.playersByKey.has("p2")).toBe(true);
    expect(store.playersByKey.has("p1")).toBe(false);

    store.stopStream();
  });
});
