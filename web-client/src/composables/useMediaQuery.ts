import { computed, onBeforeUnmount, onMounted, ref } from "vue";

export function useMediaQuery(query: string) {
  const matches = ref(false);
  let mediaQueryList: MediaQueryList | null = null;
  let listener: ((event: MediaQueryListEvent) => void) | null = null;

  function update(next?: boolean) {
    if (typeof next === "boolean") {
      matches.value = next;
      return;
    }
    matches.value = Boolean(mediaQueryList?.matches);
  }

  onMounted(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    mediaQueryList = window.matchMedia(query);
    listener = (event) => update(event.matches);
    update(mediaQueryList.matches);
    mediaQueryList.addEventListener("change", listener);
  });

  onBeforeUnmount(() => {
    if (mediaQueryList && listener) {
      mediaQueryList.removeEventListener("change", listener);
    }
    mediaQueryList = null;
    listener = null;
  });

  return computed(() => matches.value);
}

export function useIsMobile(breakpointPx = 780) {
  return useMediaQuery(`(max-width: ${breakpointPx}px)`);
}

export function useIsCompactLandscape(maxHeightPx = 520) {
  return useMediaQuery(`(orientation: landscape) and (max-height: ${maxHeightPx}px)`);
}
