import { readonly, shallowRef } from "vue";

export type TacticalMapCurrentSelection =
  | {
      type: "player";
      key: string;
      label: string;
      listPlayersId: string | null;
      teamId: number | null;
      gameX: number | null;
      gameY: number | null;
      selectedAt: number;
    }
  | null;

const currentSelected = shallowRef<TacticalMapCurrentSelection>(null);
let controllerInstalled = false;

export function setTacticalMapCurrentSelection(selection: TacticalMapCurrentSelection) {
  currentSelected.value = selection;
}

export function clearTacticalMapCurrentSelection() {
  currentSelected.value = null;
}

export function useTacticalMapCurrentSelection() {
  return {
    currentSelected: readonly(currentSelected),
    setCurrentSelected: setTacticalMapCurrentSelection,
    clearCurrentSelected: clearTacticalMapCurrentSelection,
  };
}

export function ensureTacticalMapSelectionController() {
  if (controllerInstalled || typeof document === "undefined") return;
  controllerInstalled = true;

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target;
    if (!target.closest(".map-transform-container")) return;
    if (target.closest(".player-marker")) return;
    if (
      target.closest(".radial-context-menu")
      || target.closest(".map-floating-panel")
      || target.closest(".glass-panel")
      || target.closest(".tactical-sidebar")
    ) {
      return;
    }
    clearTacticalMapCurrentSelection();
  }, true);
}
