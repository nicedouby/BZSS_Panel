import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { canAutoRefreshNow } from "./useAutoRefreshGate";

export function useServerMetricsPolling(
  refreshCurrent: () => Promise<void>,
  options: {
    intervalMs?: number;
    hasCustomSelection: () => boolean;
  }
) {
  const { intervalMs = 5000, hasCustomSelection } = options;
  const isPolling = ref(false);
  const isPending = ref(false);
  const consecutiveFailures = ref(0);
  let pollTimeoutId: any = null;

  async function tick() {
    if (!isPolling.value) return;
    if (hasCustomSelection()) {
      scheduleNext(1000);
      return;
    }
    if (!canAutoRefreshNow()) {
      scheduleNext(2000);
      return;
    }
    if (isPending.value) {
      scheduleNext(1000);
      return;
    }

    isPending.value = true;
    try {
      await refreshCurrent();
      consecutiveFailures.value = 0;
    } catch (error) {
      consecutiveFailures.value++;
      console.warn("[ServerStatsPolling] Refresh failed:", error);
    } finally {
      isPending.value = false;
    }

    // Exponential backoff if failures occur: 5s, 10s, 20s, max 60s
    const backoffMultiplier = Math.min(12, Math.pow(2, consecutiveFailures.value - 1));
    const nextInterval = consecutiveFailures.value > 0
      ? intervalMs * backoffMultiplier
      : intervalMs;

    scheduleNext(nextInterval);
  }

  function scheduleNext(delay: number) {
    clearTimeout(pollTimeoutId);
    if (isPolling.value) {
      pollTimeoutId = setTimeout(() => {
        void tick();
      }, delay);
    }
  }

  function start() {
    if (isPolling.value) return;
    isPolling.value = true;
    consecutiveFailures.value = 0;
    void tick();
  }

  function stop() {
    isPolling.value = false;
    clearTimeout(pollTimeoutId);
    pollTimeoutId = null;
  }

  onMounted(() => {
    // Visibility listener to restart polling immediately when page becomes visible
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
  });

  onBeforeUnmount(() => {
    stop();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
  });

  function handleVisibilityChange() {
    if (document.visibilityState === "visible" && isPolling.value) {
      consecutiveFailures.value = 0;
      void tick();
    }
  }

  return {
    isPolling,
    isPending,
    start,
    stop,
  };
}
