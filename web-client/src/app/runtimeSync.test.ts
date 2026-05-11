import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("./apiClient", async () => {
  const actual = await vi.importActual<typeof import("./apiClient")>("./apiClient");
  return {
    ...actual,
    apiGet: vi.fn(),
  };
});

import { ApiError, apiGet } from "./apiClient";
import { getRuntimeSyncState, stopRuntimeSync, syncOnce } from "./runtimeSync";
import { useAuthStore } from "../stores/auth.store";

describe("runtimeSync", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    stopRuntimeSync();
    Object.assign(getRuntimeSyncState(), {
      started: true,
      inFlight: false,
      lastSuccessAt: 0,
      lastError: null,
      errorType: null,
      consecutiveFailures: 0,
    });
    vi.mocked(apiGet).mockReset();
  });

  it("stops and returns to login after a 401 snapshot response", async () => {
    const auth = useAuthStore();
    auth.checked = true;
    auth.authenticated = true;

    vi.mocked(apiGet).mockRejectedValue(new ApiError({
      type: "http",
      path: "/api/snapshot/all",
      status: 401,
      message: "Unauthorized",
    }));

    await syncOnce();

    expect(auth.authenticated).toBe(false);
    expect(auth.error).toBeTruthy();
    expect(getRuntimeSyncState().started).toBe(false);
    expect(getRuntimeSyncState().errorType).toBe("unauthorized");
  });
});
