import {
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  shallowRef,
} from "vue";
import { canAutoRefreshNow } from "./useAutoRefreshGate";

export type UsePollingResourceOptions<T> = {
  fetcher: () => Promise<T>;
  intervalMs?: number;
  immediate?: boolean;
  pauseWhenHidden?: boolean;
  refreshOnActivated?: boolean;
  keepPreviousData?: boolean;
};

export function usePollingResource<T>(options: UsePollingResourceOptions<T>) {
  const data = shallowRef<T | null>(null);
  const loading = ref(false);
  const refreshing = ref(false);
  const error = ref("");
  const stale = ref(false);
  const lastSuccessAt = ref<number | null>(null);

  const intervalMs = options.intervalMs ?? 5000;
  const immediate = options.immediate ?? true;
  const pauseWhenHidden = options.pauseWhenHidden ?? true;
  const refreshOnActivated = options.refreshOnActivated ?? true;
  const keepPreviousData = options.keepPreviousData ?? true;

  let timer: number | null = null;
  let inFlight: Promise<void> | null = null;
  let active = false;
  let mounted = false;

  const hasData = () => data.value != null;
  const isHidden = () => typeof document !== "undefined" && document.hidden;

  function clearTimer() {
    if (timer != null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  function start() {
    active = true;
    clearTimer();
    if (intervalMs > 0 && (!pauseWhenHidden || !isHidden())) {
      timer = window.setInterval(() => {
        if (canAutoRefreshNow()) void refresh();
      }, intervalMs);
    }
  }

  function stop() {
    active = false;
    clearTimer();
  }

  async function refresh() {
    if (inFlight) return inFlight;
    if (pauseWhenHidden && isHidden()) return Promise.resolve();

    loading.value = !hasData();
    refreshing.value = hasData();
    error.value = "";

    inFlight = options.fetcher()
      .then((result) => {
        data.value = result;
        stale.value = false;
        lastSuccessAt.value = Date.now();
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "请求失败";
        error.value = message;
        stale.value = hasData();
        if (!keepPreviousData) data.value = null;
      })
      .finally(() => {
        loading.value = false;
        refreshing.value = false;
        inFlight = null;
      });

    return inFlight;
  }

  function handleVisibilityChange() {
    if (pauseWhenHidden && isHidden()) {
      clearTimer();
      return;
    }
    if (active) {
      start();
      if (canAutoRefreshNow()) void refresh();
    }
  }

  onMounted(() => {
    mounted = true;
    start();
    if (immediate) void refresh();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
  });

  onActivated(() => {
    if (!mounted) return;
    start();
    if (refreshOnActivated) void refresh();
  });

  onDeactivated(() => {
    stop();
  });

  onBeforeUnmount(() => {
    stop();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
  });

  return {
    data,
    loading,
    refreshing,
    error,
    stale,
    lastSuccessAt,
    refresh,
    start,
    stop,
  };
}
