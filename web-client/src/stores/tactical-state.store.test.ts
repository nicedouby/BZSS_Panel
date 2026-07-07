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

vi.mock("../app/tacticalStateApi", () => ({
  fetchTacticalStateSnapshot: hooks.fetchMock,
  streamTacticalStateSnapshot: hooks.streamMock,
}));

import { useTacticalStateStore } from "./tactical-state.store";

describe("tactical-state store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    hooks.onMessage = null;
    hooks.fetchMock.mockReset();
    hooks.streamMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshes the snapshot when the stream stays silent", async () => {
    let intervalHandler: (() => void) | null = null;
    const originalSetInterval = window.setInterval;
    const originalClearInterval = window.clearInterval;
    window.setInterval = (((handler: TimerHandler) => {
      intervalHandler = () => {
        if (typeof handler === "function") {
          handler();
        }
      };
      return 1 as any;
    }) as any);
    window.clearInterval = (() => {}) as any;
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(new Date("2026-07-07T00:00:00.000Z").getTime())
      .mockReturnValue(new Date("2026-07-07T00:00:03.100Z").getTime());

    hooks.fetchMock.mockResolvedValue({
      ok: true,
      snapshot: {
        players: [],
        server: {},
        teams: [],
        assets: {},
        diagnostics: { generatedAt: "2026-07-07T00:00:00.000Z" },
      },
    });

    const store = useTacticalStateStore();
    store.startStream();

    expect(hooks.streamMock).toHaveBeenCalledTimes(1);

    intervalHandler?.();
    await flushPromises();

    expect(hooks.fetchMock).toHaveBeenCalledTimes(1);

    store.stopStream();
    window.setInterval = originalSetInterval;
    window.clearInterval = originalClearInterval;
  });
});
