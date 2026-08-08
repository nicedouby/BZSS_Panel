import { readonly, shallowRef } from "vue";
import { executeBzssCoreCommand } from "../app/bzssCoreApi";
import { useAuthStore } from "../stores/auth.store";
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

type TacticalMapPlayerSelection = Exclude<TacticalMapCurrentSelection, null>;
type KillFeedbackTone = "info" | "ok" | "error";

const currentSelected = shallowRef<TacticalMapCurrentSelection>(null);
const killModeEnabled = shallowRef(false);
const killModeFeedback = shallowRef("");
const killModeFeedbackTone = shallowRef<KillFeedbackTone>("info");
let controllerInstalled = false;
let killModeUiObserver: MutationObserver | null = null;
let killModeFeedbackTimer: number | null = null;
const killPendingPlayerIds = new Set<string>();
const killLastFireAt = new Map<string, number>();

const TACTICAL_MAP_VIEWPORT_SELECTOR = ".tactical-map-viewport";
const KILL_MODE_STYLE_ID = "bzss-tactical-kill-mode-style";
const KILL_MODE_BUTTON_CLASS = "bzss-tactical-kill-mode-toggle";
const KILL_MODE_STATUS_CLASS = "bzss-tactical-kill-mode-status";
const KILL_MODE_VIEWPORT_CLASS = "bzss-kill-mode-active";
const KILL_MODE_SAME_PLAYER_COOLDOWN_MS = 900;

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

export function useTacticalMapKillMode() {
  return {
    enabled: readonly(killModeEnabled),
    feedback: readonly(killModeFeedback),
    setEnabled: setTacticalMapKillMode,
    toggle: toggleTacticalMapKillMode,
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
    // Tactical state is optional while the page is still bootstrapping.
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
    // RCON snapshot can be temporarily unavailable without breaking map input.
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

function buildPlayerSelection(label: string): TacticalMapPlayerSelection | null {
  const normalized = normalizePlayerName(label);
  if (!normalized) return null;

  const matches = collectPlayerCandidates().filter(
    (candidate) => normalizePlayerName(candidateName(candidate)) === normalized,
  );

  const ids = [...new Set(matches.map(candidateListPlayersId).filter((id): id is string => Boolean(id)))];
  // Squad can contain duplicate names. Kill must never guess between two
  // different transient ListPlayers IDs.
  const listPlayersId = ids.length === 1 ? ids[0] : null;
  const preferred = matches.find((candidate) => candidateListPlayersId(candidate) === listPlayersId)
    ?? matches[0]
    ?? null;
  const position = candidatePosition(preferred);

  return {
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
  };
}

function selectPlayerByLabel(label: string) {
  const selection = buildPlayerSelection(label);
  if (!selection) return false;
  setTacticalMapCurrentSelection(selection);
  return true;
}

function selectPlayerMarker(marker: HTMLElement) {
  try {
    const label = getMarkerPlayerName(marker);
    if (label && selectPlayerByLabel(label)) return true;

    // Player names may be hidden. A normal left click opens PlayerInfoPanel,
    // whose header still contains the selected player's name.
    const viewport = marker.closest<HTMLElement>(".map-viewport");
    const panelLabel = viewport ? getPlayerInfoPanelName(viewport) : "";
    return panelLabel ? selectPlayerByLabel(panelLabel) : false;
  } catch {
    // Context bookkeeping must never break the map's native click path.
    return false;
  }
}

function selectVisualCurrentPlayer(map: HTMLElement) {
  try {
    const viewport = map.closest<HTMLElement>(".map-viewport") ?? map.parentElement;

    if (viewport) {
      const panelLabel = getPlayerInfoPanelName(viewport);
      if (panelLabel && selectPlayerByLabel(panelLabel)) return true;
    }

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

function hasBzssCoreKillPermission() {
  try {
    const authStore = useAuthStore();
    return Boolean(
      authStore.user?.isSuperAdmin
      || authStore.user?.permissions?.includes("bzss_core.use"),
    );
  } catch {
    return false;
  }
}

function setKillModeFeedback(tone: KillFeedbackTone, text: string, timeoutMs = 2600) {
  killModeFeedbackTone.value = tone;
  killModeFeedback.value = text;
  if (killModeFeedbackTimer !== null && typeof window !== "undefined") {
    window.clearTimeout(killModeFeedbackTimer);
    killModeFeedbackTimer = null;
  }
  if (timeoutMs > 0 && typeof window !== "undefined") {
    killModeFeedbackTimer = window.setTimeout(() => {
      killModeFeedbackTimer = null;
      killModeFeedback.value = "";
      syncKillModeUi();
    }, timeoutMs);
  }
  syncKillModeUi();
}

export function setTacticalMapKillMode(enabled: boolean) {
  if (enabled && !hasBzssCoreKillPermission()) {
    killModeEnabled.value = false;
    setKillModeFeedback("error", "无法开启击杀模式：缺少 bzss_core.use 权限", 4200);
    return false;
  }

  killModeEnabled.value = Boolean(enabled);
  if (killModeEnabled.value) {
    setKillModeFeedback("info", "击杀模式已开启：点击玩家立即执行 Kill · ESC 退出", 3200);
  } else {
    setKillModeFeedback("info", "击杀模式已关闭", 1600);
  }
  syncKillModeUi();
  return killModeEnabled.value;
}

export function toggleTacticalMapKillMode() {
  return setTacticalMapKillMode(!killModeEnabled.value);
}

async function executeKillSelection(selection: TacticalMapPlayerSelection, marker?: HTMLElement | null) {
  const playerId = numericListPlayersId(selection.listPlayersId);
  if (!playerId) {
    setKillModeFeedback(
      "error",
      `${selection.label} 没有唯一有效的 ListPlayers ID，未执行 Kill`,
      4200,
    );
    return;
  }
  if (!hasBzssCoreKillPermission()) {
    setKillModeFeedback("error", "缺少 bzss_core.use 权限，击杀模式已关闭", 4200);
    killModeEnabled.value = false;
    syncKillModeUi();
    return;
  }

  const now = Date.now();
  const lastFireAt = killLastFireAt.get(playerId) ?? 0;
  if (killPendingPlayerIds.has(playerId) || now - lastFireAt < KILL_MODE_SAME_PLAYER_COOLDOWN_MS) {
    return;
  }

  killLastFireAt.set(playerId, now);
  killPendingPlayerIds.add(playerId);
  marker?.classList.add("bzss-kill-target-pending");
  setKillModeFeedback("info", `正在执行 Kill:${playerId} · ${selection.label}`, 0);

  try {
    const result = await executeBzssCoreCommand({
      directive: "Kill",
      parameter: playerId,
    });
    if (!result?.ok) {
      throw new Error(String(result?.message ?? `Kill:${playerId} 执行失败`));
    }

    marker?.classList.remove("bzss-kill-target-pending");
    marker?.classList.add("bzss-kill-target-hit");
    if (marker && typeof window !== "undefined") {
      window.setTimeout(() => marker.classList.remove("bzss-kill-target-hit"), 520);
    }
    setKillModeFeedback("ok", `已发送 Kill:${playerId} · ${selection.label}`, 2200);
  } catch (error) {
    setKillModeFeedback(
      "error",
      error instanceof Error ? error.message : `Kill:${playerId} 发送失败`,
      5000,
    );
  } finally {
    killPendingPlayerIds.delete(playerId);
    marker?.classList.remove("bzss-kill-target-pending");
  }
}

function tryKillPlayerByLabel(label: string, marker?: HTMLElement | null) {
  const selection = buildPlayerSelection(label);
  if (!selection) return false;
  setTacticalMapCurrentSelection(selection);
  void executeKillSelection(selection, marker);
  return true;
}

function scheduleKillFromPlayerInfoPanel(marker: HTMLElement) {
  if (typeof window === "undefined") return;
  const viewport = marker.closest<HTMLElement>(".map-viewport");
  window.setTimeout(() => {
    if (!killModeEnabled.value || !viewport?.isConnected) return;
    const label = getPlayerInfoPanelName(viewport);
    if (!label || !tryKillPlayerByLabel(label, marker)) {
      setKillModeFeedback("error", "无法识别该玩家的 RCON/ListPlayers 身份", 4200);
      return;
    }

    // Hidden-name fallback allows TacticalMapPage to open its info panel only
    // long enough for us to read the authoritative player name, then closes it.
    const closeButton = viewport.querySelector<HTMLButtonElement>(".player-info-panel .close-btn");
    closeButton?.click();
  }, 0);
}

function ensureKillModeStyles() {
  if (typeof document === "undefined" || document.getElementById(KILL_MODE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = KILL_MODE_STYLE_ID;
  style.textContent = `
.${KILL_MODE_BUTTON_CLASS} {
  position: absolute;
  z-index: 85;
  top: 82px;
  left: 14px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  padding: 6px 11px;
  border: 1px solid rgba(248, 113, 113, .52);
  border-radius: 8px;
  background: rgba(36, 10, 15, .88);
  box-shadow: 0 7px 22px rgba(0, 0, 0, .42);
  color: #fecaca;
  font: 800 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: .04em;
  cursor: pointer;
  user-select: none;
  backdrop-filter: blur(10px);
  transition: background .14s ease, border-color .14s ease, box-shadow .14s ease, transform .14s ease;
}
.${KILL_MODE_BUTTON_CLASS}:hover {
  border-color: rgba(248, 113, 113, .9);
  background: rgba(69, 10, 10, .94);
  transform: translateY(-1px);
}
.${KILL_MODE_BUTTON_CLASS}.is-active {
  border-color: #ef4444;
  background: rgba(127, 29, 29, .96);
  color: #fff1f2;
  box-shadow: 0 0 0 1px rgba(239, 68, 68, .22), 0 0 22px rgba(239, 68, 68, .42), 0 7px 22px rgba(0, 0, 0, .5);
}
.${KILL_MODE_STATUS_CLASS} {
  position: absolute;
  z-index: 86;
  left: 50%;
  bottom: 54px;
  max-width: min(680px, calc(100% - 48px));
  padding: 7px 12px;
  transform: translateX(-50%);
  border: 1px solid rgba(248, 113, 113, .5);
  border-radius: 9px;
  background: rgba(30, 8, 12, .92);
  box-shadow: 0 9px 28px rgba(0, 0, 0, .42);
  color: #fecaca;
  font: 800 11px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-align: center;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  backdrop-filter: blur(10px);
  transition: opacity .12s ease, visibility .12s ease;
}
.${KILL_MODE_STATUS_CLASS}.is-visible { opacity: 1; visibility: visible; }
.${KILL_MODE_STATUS_CLASS}.is-ok { border-color: rgba(74, 222, 128, .62); color: #86efac; background: rgba(6, 42, 26, .92); }
.${KILL_MODE_STATUS_CLASS}.is-error { border-color: rgba(248, 113, 113, .8); color: #fca5a5; background: rgba(69, 10, 10, .95); }
.${KILL_MODE_VIEWPORT_CLASS} .player-markers-layer {
  pointer-events: auto !important;
  z-index: 78 !important;
}
.${KILL_MODE_VIEWPORT_CLASS} .player-marker.mode-tactical {
  cursor: crosshair !important;
}
.${KILL_MODE_VIEWPORT_CLASS} .player-marker.mode-tactical:hover {
  outline: 2px solid rgba(248, 113, 113, .95) !important;
  outline-offset: 2px;
  border-radius: 50% !important;
  filter: drop-shadow(0 0 8px rgba(239, 68, 68, .8));
}
.${KILL_MODE_VIEWPORT_CLASS} .player-marker.mode-tactical.bzss-kill-target-pending {
  outline: 2px solid #fbbf24 !important;
  outline-offset: 3px;
  border-radius: 50% !important;
  cursor: wait !important;
}
.${KILL_MODE_VIEWPORT_CLASS} .player-marker.mode-tactical.bzss-kill-target-hit {
  outline: 3px solid #ef4444 !important;
  outline-offset: 4px;
  border-radius: 50% !important;
  filter: drop-shadow(0 0 14px rgba(239, 68, 68, 1));
}
@media (max-width: 700px) {
  .${KILL_MODE_BUTTON_CLASS} { top: 70px; left: 8px; }
  .${KILL_MODE_STATUS_CLASS} { bottom: 44px; max-width: calc(100% - 24px); }
}
`;
  document.head.appendChild(style);
}

function createKillModeButton(viewport: HTMLElement) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = KILL_MODE_BUTTON_CLASS;
  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleTacticalMapKillMode();
  });
  viewport.appendChild(button);
  return button;
}

function createKillModeStatus(viewport: HTMLElement) {
  const status = document.createElement("div");
  status.className = KILL_MODE_STATUS_CLASS;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  viewport.appendChild(status);
  return status;
}

function syncKillModeUi() {
  if (typeof document === "undefined") return;
  ensureKillModeStyles();

  const viewports = [...document.querySelectorAll<HTMLElement>(TACTICAL_MAP_VIEWPORT_SELECTOR)];
  for (const viewport of viewports) {
    const button = viewport.querySelector<HTMLButtonElement>(`.${KILL_MODE_BUTTON_CLASS}`)
      ?? createKillModeButton(viewport);
    const status = viewport.querySelector<HTMLElement>(`.${KILL_MODE_STATUS_CLASS}`)
      ?? createKillModeStatus(viewport);

    viewport.classList.toggle(KILL_MODE_VIEWPORT_CLASS, killModeEnabled.value);
    button.classList.toggle("is-active", killModeEnabled.value);
    button.textContent = killModeEnabled.value ? "☠ 击杀模式 ON" : "☠ 击杀模式";
    button.setAttribute("aria-pressed", killModeEnabled.value ? "true" : "false");
    button.title = killModeEnabled.value
      ? "击杀模式已开启：点击玩家立即 Kill，按 ESC 退出"
      : "开启击杀模式：之后点击玩家立即执行 Kill";

    const defaultStatus = killModeEnabled.value
      ? "☠ 击杀模式已开启 · 点击玩家立即执行 Kill · ESC 退出"
      : "";
    const statusText = killModeFeedback.value || defaultStatus;
    status.textContent = statusText;
    status.classList.toggle("is-visible", Boolean(statusText));
    status.classList.toggle("is-ok", killModeFeedbackTone.value === "ok");
    status.classList.toggle("is-error", killModeFeedbackTone.value === "error");
  }
}

function ensureKillModeUiController() {
  if (typeof document === "undefined") return;
  syncKillModeUi();
  if (killModeUiObserver || typeof MutationObserver === "undefined") return;
  // Only react when a tactical map viewport is mounted. Observing every
  // subtree mutation here is unsafe because syncKillModeUi() itself updates
  // text nodes, classes, and attributes, which would recursively retrigger the
  // observer and lock the browser main thread after a map click.
  killModeUiObserver = new MutationObserver((records) => {
    const viewportAdded = records.some((record) => (
      [...record.addedNodes].some((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        const element = node as Element;
        return element.matches(TACTICAL_MAP_VIEWPORT_SELECTOR) || Boolean(element.querySelector(TACTICAL_MAP_VIEWPORT_SELECTOR));
      })
    ));
    if (viewportAdded) syncKillModeUi();
  });
  killModeUiObserver.observe(document.documentElement, { childList: true, subtree: true });
}

export function ensureTacticalMapSelectionController() {
  if (controllerInstalled || typeof document === "undefined") return;
  controllerInstalled = true;
  ensureKillModeUiController();

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target;

    if (target.closest(`.${KILL_MODE_BUTTON_CLASS}`)) return;

    const playerMarker = target.closest<HTMLElement>(".player-marker.mode-tactical");
    if (playerMarker && killModeEnabled.value) {
      const label = getMarkerPlayerName(playerMarker);
      if (label) {
        // Normal case: visible marker label resolves the player immediately, so
        // the map's player-info click never runs in Kill mode.
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (!tryKillPlayerByLabel(label, playerMarker)) {
          setKillModeFeedback("error", "无法识别该玩家的 RCON/ListPlayers 身份", 4200);
        }
      } else {
        // Hidden player-name mode has no label in the marker DOM. Let the native
        // click briefly create PlayerInfoPanel, read its authoritative name on
        // the next task, execute Kill, then close the panel automatically.
        scheduleKillFromPlayerInfoPanel(playerMarker);
      }
      return;
    }

    if (playerMarker) {
      // Capture-phase observation only. Do not prevent/stop the event:
      // TacticalMapPage remains the authority for its normal selection UI.
      selectPlayerMarker(playerMarker);
      return;
    }

    if (!target.closest(`${TACTICAL_MAP_VIEWPORT_SELECTOR} .map-transform-container`)) return;
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
  // the browser emits contextmenu. Synchronize the visual selection first.
  document.addEventListener("pointerdown", (event) => {
    if (!(event instanceof PointerEvent) || event.button !== 2 || !(event.target instanceof Element)) return;
    const target = event.target;
    const playerMarker = target.closest<HTMLElement>(".player-marker.mode-tactical");
    if (playerMarker) {
      selectPlayerMarker(playerMarker);
      return;
    }

    const map = target.closest<HTMLElement>(`${TACTICAL_MAP_VIEWPORT_SELECTOR} .map-transform-container`);
    if (!map) return;
    selectVisualCurrentPlayer(map);
  }, true);

  document.addEventListener("contextmenu", (event) => {
    if (!(event instanceof MouseEvent) || !(event.target instanceof Element)) return;
    const target = event.target;
    const playerMarker = target.closest<HTMLElement>(".player-marker.mode-tactical");
    if (playerMarker) {
      selectPlayerMarker(playerMarker);
      // Keep the existing generic radial wheel path available outside the
      // dedicated left-click Kill mode.
      redirectPlayerContextMenu(event, playerMarker);
      return;
    }

    const map = target.closest<HTMLElement>(".map-transform-container");
    if (!map) return;
    selectVisualCurrentPlayer(map);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !killModeEnabled.value) return;
    setTacticalMapKillMode(false);
  }, true);
}

if (typeof document !== "undefined") {
  ensureTacticalMapSelectionController();
}
