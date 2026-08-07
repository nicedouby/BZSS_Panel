import { inject, provide, type Ref } from "vue";

export interface TacticalMapViewportState {
  zoom: Ref<number>;
  panX: Ref<number>;
  panY: Ref<number>;
}

const tacticalMapViewportKey = Symbol("tacticalMapViewport");

export function provideTacticalMapViewport(state: TacticalMapViewportState) {
  provide(tacticalMapViewportKey, state);
}

export function useTacticalMapViewport() {
  const state = inject<TacticalMapViewportState | null>(tacticalMapViewportKey, null);
  if (!state) {
    throw new Error("Tactical map viewport state is not available");
  }
  return state;
}
