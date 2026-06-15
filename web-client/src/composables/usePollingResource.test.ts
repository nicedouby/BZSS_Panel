import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePollingResource } from "./usePollingResource";

describe("usePollingResource", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function mountHarness(fetcher: () => Promise<string>, intervalMs = 1000) {
    return mount(defineComponent({
      setup() {
        const resource = usePollingResource<string>({
          fetcher,
          intervalMs,
          immediate: true,
          pauseWhenHidden: true,
          refreshOnActivated: true,
        });
        return { resource };
      },
      render() {
        return h("div", this.resource.data.value ?? "");
      },
    }));
  }

  it("runs immediately and polls on the configured interval", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");

    const wrapper = mountHarness(fetcher);
    await flushPromises();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toBe("first");

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toBe("second");
    wrapper.unmount();
  });

  it("does not create concurrent refresh requests", async () => {
    let resolveFetch: (value: string) => void = () => undefined;
    const fetcher = vi.fn(() => new Promise<string>((resolve) => {
      resolveFetch = resolve;
    }));

    const wrapper = mountHarness(fetcher);
    const vm = wrapper.vm as unknown as { resource: ReturnType<typeof usePollingResource<string>> };

    void vm.resource.refresh();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolveFetch("done");
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    wrapper.unmount();
  });

  it("marks stale when a later request fails after data exists", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce("first")
      .mockRejectedValueOnce(new Error("boom"));

    const wrapper = mountHarness(fetcher);
    const vm = wrapper.vm as unknown as { resource: ReturnType<typeof usePollingResource<string>> };

    await flushPromises();
    await vm.resource.refresh();

    expect(vm.resource.data.value).toBe("first");
    expect(vm.resource.error.value).toBe("boom");
    expect(vm.resource.stale.value).toBe(true);
    wrapper.unmount();
  });

  it("pauses while document is hidden and clears timers on unmount", async () => {
    const fetcher = vi.fn().mockResolvedValue("ok");
    const wrapper = mountHarness(fetcher);

    await flushPromises();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await vi.advanceTimersByTimeAsync(3000);
    expect(fetcher).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
