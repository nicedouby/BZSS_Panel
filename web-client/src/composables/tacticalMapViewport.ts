import { inject, provide, type Ref } from "vue";
import "../styles/tactical-capture-point-drag.css";
import "../styles/tactical-vehicle-colors.css";
import { ensureTacticalCapturePointDragController } from "./tacticalCapturePointDrag";
import { ensureTacticalVehicleIconTintController } from "./tacticalVehicleIconTint";

export interface TacticalMapViewportState {
  zoom: Ref<number>;
  panX: Ref<number>;
  panY: Ref<number>;
}

const tacticalMapViewportKey = Symbol("tacticalMapViewport");

export function provideTacticalMapViewport(state: TacticalMapViewportState) {
  ensureTacticalCapturePointDragController();
  ensureTacticalVehicleIconTintController();
  provide(tacticalMapViewportKey, state);
}

export function useTacticalMapViewport() {
  const state = inject<TacticalMapViewportState | null>(tacticalMapViewportKey, null);
  if (!state) {
    throw new Error("Tactical map viewport state is not available");
  }
  return state;
}
