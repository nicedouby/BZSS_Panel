import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const streamMock = vi.hoisted(() => {
  const close = vi.fn();
  const start = vi.fn((_onData: unknown, _onError: unknown) => close);
  return { close, start };
});

vi.mock("../app/bzssCoreApi", () => ({
  fetchBzssCorePlayerInfoList: vi.fn(),
  fetchBzssCoreRawData: vi.fn(),
  streamBzssCorePlayerInfoList: streamMock.start,
}));

import { useBzssCoreStore } from "./bzss-core.store";

describe("bzss-core store stream lifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", { CLOSED: 2 });
    setActivePinia(createPinia());
    streamMock.close.mockClear();
    streamMock.start.mockClear();
  });

  it("starts only one stream and releases it idempotently", () => {
    const store = useBzssCoreStore();

    store.startStream();
    store.startStream();

    expect(streamMock.start).toHaveBeenCalledTimes(1);
    expect(store.streamActive).toBe(true);

    store.stopStream();
    store.stopStream();

    expect(streamMock.close).toHaveBeenCalledTimes(1);
    expect(store.streamActive).toBe(false);

    store.startStream();
    expect(streamMock.start).toHaveBeenCalledTimes(2);
    expect(store.streamActive).toBe(true);
  });

  it("fully releases a closed EventSource so a later visit can reconnect", () => {
    const store = useBzssCoreStore();
    store.startStream();

    const onError = streamMock.start.mock.calls[0]?.[1] as (
      error: unknown,
      source: { readyState: number },
    ) => void;

    onError(new Error("closed"), { readyState: EventSource.CLOSED });

    expect(streamMock.close).toHaveBeenCalledTimes(1);
    expect(store.streamActive).toBe(false);
    expect(store.error).toBe("SSE Stream connection error.");

    store.startStream();
    expect(streamMock.start).toHaveBeenCalledTimes(2);
  });
});
