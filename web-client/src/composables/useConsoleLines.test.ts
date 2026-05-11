import { defineComponent, nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

vi.mock("../app/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../app/apiClient")>("../app/apiClient");
  return {
    ...actual,
    apiGet: vi.fn(),
  };
});

import { apiGet } from "../app/apiClient";
import { useConsoleLines } from "./useConsoleLines";

describe("useConsoleLines", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path.startsWith("/api/console/channels")) {
        return {
          streams: [{ id: "modules", title: "Modules" }],
          scopes: [{ id: "all", title: "All scopes" }],
          levels: [{ id: "all", title: "All levels" }],
        };
      }

      return {
        lines: [{ seq: 1, message: "line", stream: "modules", scope: "all", level: "info" }],
      };
    });
  });

  it("does not keep polling when paused", async () => {
    const Harness = defineComponent({
      setup(_, { expose }) {
        const filters = reactive({
          stream: "modules",
          scope: "all",
          level: "all",
          q: "",
          paused: false,
        });
        const state = useConsoleLines(filters);
        expose({ filters, state });
        return () => null;
      },
    });

    const wrapper = mount(Harness, {
      global: {
        plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]],
      },
    });

    await flushPromises();
    (wrapper.vm as any).filters.paused = true;
    await nextTick();
    await flushPromises();
    const pausedCalls = vi.mocked(apiGet).mock.calls.length;

    vi.advanceTimersByTime(2500);
    await flushPromises();

    expect(vi.mocked(apiGet).mock.calls.length).toBe(pausedCalls);
  });
});
