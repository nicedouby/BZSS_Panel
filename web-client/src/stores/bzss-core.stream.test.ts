import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const apiMock = vi.hoisted(() => {
  const close = vi.fn();
  const start = vi.fn((_onData: unknown, _onError: unknown) => close);
  const fetchPlayers = vi.fn();
  return { close, start, fetchPlayers };
});

vi.mock("../app/bzssCoreApi", () => ({
  BZSS_CORE_BOOL_KEYS: [],
  fetchBzssCorePlayerInfoList: apiMock.fetchPlayers,
  fetchBzssCoreRawData: vi.fn(),
  fetchBzssCoreVariables: vi.fn(),
  setBzssCoreVariable: vi.fn(),
  streamBzssCorePlayerInfoList: apiMock.start,
}));

import { useBzssCoreStore } from "./bzss-core.store";

describe("bzss-core store stream lifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", { CLOSED: 2, CONNECTING: 0 });
    setActivePinia(createPinia());
    apiMock.close.mockClear();
    apiMock.start.mockClear();
    apiMock.fetchPlayers.mockReset();
    apiMock.fetchPlayers.mockResolvedValue({
      ok: true,
      status: "ready",
      state: {},
      players: [{ playerIndex: 3, name: "Player 3" }],
    });
  });

  it("starts only one stream and releases it idempotently", () => {
    const store = useBzssCoreStore();

    store.startStream();
    store.startStream();

    expect(apiMock.start).toHaveBeenCalledTimes(1);
    expect(store.streamActive).toBe(true);

    store.stopStream();
    store.stopStream();

    expect(apiMock.close).toHaveBeenCalledTimes(1);
    expect(store.streamActive).toBe(false);

    store.startStream();
    expect(apiMock.start).toHaveBeenCalledTimes(2);
    expect(store.streamActive).toBe(true);
  });

  it("falls back to HTTP polling on any EventSource error", async () => {
    const store = useBzssCoreStore();
    store.startStream();

    const onError = apiMock.start.mock.calls[0]?.[1] as (
      error: unknown,
      source: { readyState: number },
    ) => void;

    onError(new Error("reconnecting forever"), { readyState: EventSource.CONNECTING });

    expect(apiMock.close).toHaveBeenCalledTimes(1);
    expect(store.streamActive).toBe(false);
    expect(apiMock.fetchPlayers).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => {
      expect(store.players).toEqual([{ playerIndex: 3, name: "Player 3" }]);
      expect(store.error).toBe("");
    });

    store.startStream();
    expect(apiMock.start).toHaveBeenCalledTimes(2);
  });
});
