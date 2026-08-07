import { readonly, shallowRef } from "vue";
import { useServerStore } from "../stores/server.store";
import { useTacticalStateStore } from "../stores/tactical-state.store";

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

function normalizePlayerName(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function numericListPlayersId(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const numeric = Number(text);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? String(numeric) : null;
}

function candidateName(candidate: any) {
  return String(
    candidate?.identity?.name
    ?? candidate?.raw?.rcon?.name
    ?? candidate?.name
    ?? candidate?.playerName
    ?? "",
  ).trim();
}

function candidateListPlayersId(candidate: any): string | null {
  return numericListPlayersId(
    candidate?.raw?.rcon?.playerID
    ?? candidate?.raw?.rcon?.playerId
    ?? candidate?.identity?.playerID
    ?? candidate?.identity?.playerId
    ?? candidate?.playerID,
  );
}

function candidateTeamId(candidate: any): number | null {
  const value = Number(
    candidate?.match?.teamId
    ?? candidate?.teamId
    ?? candidate?.teamID
    ?? candidate?.raw?.rcon?.teamID,
  );
  return Number.isFinite(value) && value > 0 ? value : null;
}

function candidatePosition(candidate: any) {
  const position = candidate?.telemetry?.position
    ?? candidate?.soldierInfo?.position
    ?? candidate?.position
    ?? candidate?.raw?.bzss?.position
    ?? candidate?.raw?.bzss?.soldierInfo?.position
    ?? null;
  const x = Number(position?.x);
  const y = Number(position?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function collectPlayerCandidates() {
  const output: any[] = [];
  const seenObjects = new Set<any>();
  const seenIdentity = new Set<string>();

  const push = (candidate: any) => {
    if (!candidate || typeof candidate !== "object" || seenObjects.has(candidate)) return;
    seenObjects.add(candidate);

    const id = candidateListPlayersId(candidate);
    const name = normalizePlayerName(candidateName(candidate));
    const identityKey = id ? `id:${id}` : name ? `name:${name}` : "";
    if (identityKey && seenIdentity.has(identityKey)) return;
    if (identityKey) seenIdentity.add(identityKey);
    output.push(candidate);
  };

  try {
    const tacticalStateStore = useTacticalStateStore();
    const sources = [
      tacticalStateStore.players,
      (tacticalStateStore.snapshot as any)?.players,
    ];
    for (const source of sources) {
      if (Array.isArray(source)) source.forEach(push);
    }
  } catch {
    // Shared selection is auxiliary. It must never break the map's native click path.
  }

  try {
    const serverStore = useServerStore();
    const snapshot = serverStore.snapshot as any;
    const sources = [
      snapshot?.matchState?.players?.list,
      snapshot?.players,
      snapshot?.match?.players?.list,
      snapshot?.webStatus?.players,
    ];
    for (const source of sources) {
      if (Array.isArray(source)) source.forEach(push);
    }
  } catch {
    // Same rule as above: failure here only disables contextual Kill resolution.
  }

  return output;
}

function getMarkerPlayerName(marker: HTMLElement) {
  return String(
    marker.getAttribute("data-player-name")
    ?? marker.querySelector<HTMLElement>(".player-name-tag")?.textContent
    ?? "",
  ).trim();
}

function getPlayerInfoPanelName(scope: ParentNode) {
  return String(
    scope.querySelector<HTMLElement>(".player-info-panel .player-name")?.textContent
    ?? "",
  ).trim();
}

function selectPlayerByLabel(label: string) {
  const normalized = normalizePlayerName(label);
  if (!normalized) return false;

  const matches = collectPlayerCandidates().filter(
    (candidate) => normalizePlayerName(candidateName(candidate)) === normalized,
  );

  const ids = [...new Set(matches.map(candidateListPlayersId).filter((id): id is string => Boolean(id)))];
  // Duplicate names are legal. Never guess between multiple live ListPlayers IDs.
  const listPlayersId = ids.length === 1 ? ids[0] : null;
  const preferred = matches.find((candidate) => candidateListPlayersId(candidate) === listPlayersId)
    ?? matches[0]
    ?? null;
  const position = candidatePosition(preferred);

  setTacticalMapCurrentSelection({
    type: "player",
    key: String(
      preferred?.identity?.key
      ?? (listPlayersId ? `player:${listPlayersId}` : `name:${normalized}`),
    ),
    label: candidateName(preferred) || label,
    listPlayersId,
    teamId: candidateTeamId(preferred),
    gameX: position?.x ?? null,
    gameY: position?.y ?? null,
    selectedAt: Date.now(),
  });
  return true;
}

function selectPlayerMarker(marker: HTMLElement) {
  try {
    const label = getMarkerPlayerName(marker);
    if (label && selectPlayerByLabel(label)) return true;

    // Player names may be hidden. A left-click still opens PlayerInfoPanel, whose
    // header always contains the selected player's name.
    const viewport = marker.closest<HTMLElement>(".map-viewport");
    const panelLabel = viewport ? getPlayerInfoPanelName(viewport) : "";
    return panelLabel ? selectPlayerByLabel(panelLabel) : false;
  } catch {
    // Never let contextual-selection bookkeeping interfere with the real player click.
    return false;
  }
}

function selectVisualCurrentPlayer(map: HTMLElement) {
  try {
    const viewport = map.closest<HTMLElement>(".map-viewport") ?? map.parentElement;

    // The player info panel is the strongest visual signal because it is created
    // by TacticalMapPage only for its selectedPlayerKey.
    if (viewport) {
      const panelLabel = getPlayerInfoPanelName(viewport);
      if (panelLabel && selectPlayerByLabel(panelLabel)) return true;
    }

    // Fallback for selection paths that focus a marker without opening the info panel.
    // A focused squad can mark several players, so accept only one focused marker.
    const focusedMarkers = [...map.querySelectorAll<HTMLElement>(".player-marker.mode-tactical.is-focused")];
    if (focusedMarkers.length === 1 && selectPlayerMarker(focusedMarkers[0])) return true;

    return false;
  } catch {
    return false;
  }
}

function redirectPlayerContextMenu(event: MouseEvent, marker: HTMLElement) {
  const map = marker.closest<HTMLElement>(".map-transform-container");
  if (!map) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  map.dispatchEvent(new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    view: window,
    button: 2,
    buttons: 2,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  }));
}

export function ensureTacticalMapSelectionController() {
  if (controllerInstalled || typeof document === "undefined") return;
  controllerInstalled = true;

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target;
    const playerMarker = target.closest<HTMLElement>(".player-marker.mode-tactical");
    if (playerMarker) {
      // Capture-phase observation only. Do not prevent/stop the event: TacticalMapPage
      // remains the authority for selectedPlayerKey and the player info panel.
      selectPlayerMarker(playerMarker);
      return;
    }

    if (!target.closest(".map-transform-container")) return;
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

  // TacticalMapPage opens the generic wheel on right-button pointerdown, before
  // the browser emits contextmenu. Synchronize the visual selection here so the
  // first render of MapContextMenu already receives the player context.
  document.addEventListener("pointerdown", (event) => {
    if (!(event instanceof PointerEvent) || event.button !== 2 || !(event.target instanceof Element)) return;
    const target = event.target;
    const playerMarker = target.closest<HTMLElement>(".player-marker.mode-tactical");
    if (playerMarker) {
      selectPlayerMarker(playerMarker);
      return;
    }

    const map = target.closest<HTMLElement>(".map-transform-container");
    if (!map) return;
    selectVisualCurrentPlayer(map);
  }, true);

  document.addEventListener("contextmenu", (event) => {
    if (!(event instanceof MouseEvent) || !(event.target instanceof Element)) return;
    const target = event.target;
    const playerMarker = target.closest<HTMLElement>(".player-marker.mode-tactical");
    if (playerMarker) {
      selectPlayerMarker(playerMarker);
      // Tactical mode uses the same generic radial wheel for map and player context.
      redirectPlayerContextMenu(event, playerMarker);
      return;
    }

    const map = target.closest<HTMLElement>(".map-transform-container");
    if (!map) return;
    // Reconcile once more at contextmenu time in case the pointerdown path was
    // skipped by the browser/webview.
    selectVisualCurrentPlayer(map);
  }, true);
}

if (typeof document !== "undefined") {
  ensureTacticalMapSelectionController();
}
