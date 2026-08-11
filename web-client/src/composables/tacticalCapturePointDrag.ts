import { executeBzssCoreCommand } from "../app/bzssCoreApi";
import {
  TACTICAL_MAP_CONFIGS,
  getDefaultTacticalMapKey,
  resolveTacticalMapKey,
} from "../shared/tactical-map-data";

type MapBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type AxisPair = {
  percent: number;
  game: number;
};

type DragSession = {
  pointerId: number;
  pointName: string;
  marker: HTMLButtonElement;
  layer: HTMLElement;
  viewport: HTMLElement;
  mapElement: HTMLElement;
  mapRect: DOMRect;
  bounds: MapBounds;
  startClientX: number;
  startClientY: number;
  startMapX: number;
  startMapY: number;
  mapX: number;
  mapY: number;
  gameX: number;
  gameY: number;
  moved: boolean;
  preview: HTMLButtonElement | null;
  feedbackElement: HTMLElement | null;
  feedbackOriginalText: string;
};

type CaptureDragWindow = Window & {
  __bzssTacticalCapturePointDragInstalled?: boolean;
};

let installed = false;
let activeDrag: DragSession | null = null;
let commandPending = false;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parsePercent(value: string | null | undefined) {
  const numeric = Number.parseFloat(String(value ?? "").replace("%", ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function parsePointName(marker: Element) {
  const explicitName = marker instanceof HTMLElement
    ? marker.dataset.capturePointName?.trim() ?? ""
    : "";
  if (explicitName && !/^\d+$/.test(explicitName)) return explicitName;

  const visibleName = marker.querySelector(".zone-flag-name")?.textContent?.trim() ?? "";
  return visibleName && !/^\d+$/.test(visibleName) ? visibleName : "";
}

function parseMarkerGamePosition(marker: Element) {
  const title = marker.getAttribute("title") ?? "";
  const match = title.match(/X\s*(-?\d+(?:\.\d+)?)\s+Y\s*(-?\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const x = Number(match[1]);
  const y = Number(match[2]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function collectGridPairs(mapElement: HTMLElement, axis: "x" | "y") {
  const selector = axis === "x" ? ".grid-line.vertical" : ".grid-line.horizontal";
  const styleProperty = axis === "x" ? "left" : "top";
  const prefix = axis === "x" ? /X:\s*(-?\d+(?:\.\d+)?)/i : /Y:\s*(-?\d+(?:\.\d+)?)/i;
  const pairs: AxisPair[] = [];

  for (const element of Array.from(mapElement.querySelectorAll<HTMLElement>(selector))) {
    const percent = parsePercent(element.style.getPropertyValue(styleProperty));
    const match = (element.textContent ?? "").match(prefix);
    const game = match ? Number(match[1]) : Number.NaN;
    if (percent != null && Number.isFinite(game)) pairs.push({ percent, game });
  }

  return pairs;
}

function collectMarkerPairs(layer: HTMLElement, axis: "x" | "y") {
  const styleProperty = axis === "x" ? "left" : "top";
  const pairs: AxisPair[] = [];

  for (const marker of Array.from(layer.querySelectorAll<HTMLElement>(".capture-zone-marker:not([data-capture-drag-preview])"))) {
    const percent = parsePercent(marker.style.getPropertyValue(styleProperty));
    const gamePosition = parseMarkerGamePosition(marker);
    const game = axis === "x" ? gamePosition?.x : gamePosition?.y;
    if (percent != null && game != null && Number.isFinite(game)) pairs.push({ percent, game });
  }

  return pairs;
}

function inferAxisBounds(pairs: AxisPair[]) {
  let best: { first: AxisPair; second: AxisPair; distance: number } | null = null;

  for (let i = 0; i < pairs.length; i += 1) {
    for (let j = i + 1; j < pairs.length; j += 1) {
      const distance = Math.abs(pairs[j].percent - pairs[i].percent);
      if (distance < 0.001) continue;
      if (!best || distance > best.distance) {
        best = { first: pairs[i], second: pairs[j], distance };
      }
    }
  }

  if (!best) return null;
  const deltaPercent = best.second.percent - best.first.percent;
  const range = ((best.second.game - best.first.game) * 100) / deltaPercent;
  if (!Number.isFinite(range) || Math.abs(range) < 0.001) return null;

  const min = best.first.game - (best.first.percent / 100) * range;
  const max = min + range;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return { min, max };
}

function fallbackBounds(viewport: HTMLElement): MapBounds | null {
  const visibleMapName = viewport.querySelector(".tactical-command-bar__identity strong")?.textContent?.trim() ?? "";
  const key = resolveTacticalMapKey(visibleMapName) ?? getDefaultTacticalMapKey() ?? "";
  const config = key ? TACTICAL_MAP_CONFIGS[key] : null;
  const bounds = config?.bounds;
  if (!bounds) return null;

  return {
    minX: Number(bounds.minX),
    maxX: Number(bounds.maxX),
    minY: Number(bounds.minY),
    maxY: Number(bounds.maxY),
  };
}

function resolveBounds(viewport: HTMLElement, mapElement: HTMLElement, layer: HTMLElement): MapBounds | null {
  const gridX = inferAxisBounds(collectGridPairs(mapElement, "x"));
  const gridY = inferAxisBounds(collectGridPairs(mapElement, "y"));
  const markerX = inferAxisBounds(collectMarkerPairs(layer, "x"));
  const markerY = inferAxisBounds(collectMarkerPairs(layer, "y"));
  const fallback = fallbackBounds(viewport);

  const x = gridX ?? markerX ?? (fallback ? { min: fallback.minX, max: fallback.maxX } : null);
  const y = gridY ?? markerY ?? (fallback ? { min: fallback.minY, max: fallback.maxY } : null);
  if (!x || !y) return null;

  return { minX: x.min, maxX: x.max, minY: y.min, maxY: y.max };
}

function ensurePreviewAttached(session: DragSession) {
  if (session.preview && session.preview.parentElement !== session.layer) {
    session.layer.appendChild(session.preview);
  }
}

function createPreview(session: DragSession) {
  if (session.preview) {
    ensurePreviewAttached(session);
    return session.preview;
  }

  const preview = session.marker.cloneNode(true) as HTMLButtonElement;
  preview.dataset.captureDragPreview = "true";
  preview.classList.remove("is-runtime-capture-drag-source", "is-point-dragging", "is-command-pending");
  preview.classList.add("is-runtime-capture-drag-preview");
  preview.removeAttribute("title");
  preview.setAttribute("aria-hidden", "true");
  preview.tabIndex = -1;
  preview.style.left = `${session.mapX}%`;
  preview.style.top = `${session.mapY}%`;
  session.layer.appendChild(preview);
  session.preview = preview;
  return preview;
}

function setFeedback(session: DragSession, text: string) {
  if (session.feedbackElement) session.feedbackElement.textContent = text;
}

function updateDrag(session: DragSession, clientX: number, clientY: number) {
  const dx = clientX - session.startClientX;
  const dy = clientY - session.startClientY;
  if (!session.moved && Math.abs(dx) <= 4 && Math.abs(dy) <= 4) return;

  session.moved = true;
  session.mapX = clamp(session.startMapX + (dx / session.mapRect.width) * 100, 0, 100);
  session.mapY = clamp(session.startMapY + (dy / session.mapRect.height) * 100, 0, 100);
  session.gameX = session.bounds.minX + (session.mapX / 100) * (session.bounds.maxX - session.bounds.minX);
  session.gameY = session.bounds.minY + (session.mapY / 100) * (session.bounds.maxY - session.bounds.minY);

  const preview = createPreview(session);
  preview.style.left = `${session.mapX}%`;
  preview.style.top = `${session.mapY}%`;
  setFeedback(session, `正在移动点位 ${session.pointName} · X ${Math.round(session.gameX)} Y ${Math.round(session.gameY)}`);
}

function releasePointer(session: DragSession) {
  try {
    if (session.marker.hasPointerCapture?.(session.pointerId)) {
      session.marker.releasePointerCapture(session.pointerId);
    }
  } catch {
    // Window capture listeners remain authoritative if pointer capture is unavailable.
  }
}

function cleanupSession(session: DragSession, restoreFeedback = true) {
  releasePointer(session);
  session.marker.classList.remove("is-runtime-capture-drag-source");
  session.preview?.remove();
  session.preview = null;
  if (restoreFeedback && session.feedbackElement) {
    session.feedbackElement.textContent = session.feedbackOriginalText;
  }
}

function cancelActiveDrag() {
  const session = activeDrag;
  if (!session) return;
  activeDrag = null;
  cleanupSession(session);
}

function findLiveMarker(layer: HTMLElement, pointName: string) {
  return Array.from(layer.querySelectorAll<HTMLButtonElement>(".capture-zone-marker:not([data-capture-drag-preview])"))
    .find((marker) => parsePointName(marker) === pointName) ?? null;
}

function waitForCommittedMarker(session: DragSession, timeoutMs = 4500) {
  return new Promise<void>((resolve) => {
    const startedAt = performance.now();
    const check = () => {
      ensurePreviewAttached(session);
      const marker = findLiveMarker(session.layer, session.pointName);
      const mapX = marker ? parsePercent(marker.style.left) : null;
      const mapY = marker ? parsePercent(marker.style.top) : null;
      if (
        mapX != null
        && mapY != null
        && Math.abs(mapX - session.mapX) < 0.12
        && Math.abs(mapY - session.mapY) < 0.12
      ) {
        resolve();
        return;
      }
      if (performance.now() - startedAt >= timeoutMs) {
        resolve();
        return;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

async function finishActiveDrag(event: PointerEvent) {
  const session = activeDrag;
  if (!session || event.pointerId !== session.pointerId) return;

  event.preventDefault();
  event.stopPropagation();
  updateDrag(session, event.clientX, event.clientY);
  activeDrag = null;
  releasePointer(session);

  if (!session.moved) {
    cleanupSession(session);
    setFeedback(session, `点位 ${session.pointName} 未移动，未发送命令`);
    return;
  }

  const gameX = Math.round(session.gameX);
  const gameY = Math.round(session.gameY);
  commandPending = true;
  session.preview?.classList.add("is-command-pending");
  setFeedback(session, `正在提交 DragCapturePoint:${session.pointName},${gameX},${gameY}`);

  try {
    const result = await executeBzssCoreCommand({
      directive: "DragCapturePoint",
      parameter: `${session.pointName},${gameX},${gameY}`,
    });
    if (!result?.ok) {
      throw new Error(String((result as { message?: unknown } | null)?.message ?? "BZSS Core 拒绝了改点命令"));
    }

    setFeedback(session, `点位 ${session.pointName} 已移动到 X ${gameX}, Y ${gameY}`);
    await waitForCommittedMarker(session);
  } catch (error) {
    setFeedback(session, error instanceof Error ? error.message : "改点命令发送失败");
  } finally {
    commandPending = false;
    cleanupSession(session, false);
  }
}

function startDrag(event: PointerEvent) {
  if (commandPending || activeDrag || event.button !== 0) return;
  if (!(event.target instanceof Element)) return;

  const marker = event.target.closest<HTMLButtonElement>(".capture-zone-marker:not([data-capture-drag-preview])");
  if (!marker) return;
  const viewport = marker.closest<HTMLElement>(".map-viewport");
  if (!viewport?.classList.contains("is-capture-point-editing")) return;

  const layer = marker.closest<HTMLElement>(".capture-zone-layer");
  const mapElement = marker.closest<HTMLElement>(".map-transform-container");
  const pointName = parsePointName(marker);
  const startMapX = parsePercent(marker.style.left);
  const startMapY = parsePercent(marker.style.top);
  const markerGamePosition = parseMarkerGamePosition(marker);
  if (!layer || !mapElement || !pointName || startMapX == null || startMapY == null || !markerGamePosition) return;

  const mapRect = mapElement.getBoundingClientRect();
  if (!(mapRect.width > 0) || !(mapRect.height > 0)) return;
  const bounds = resolveBounds(viewport, mapElement, layer);
  if (!bounds) return;

  const feedbackElement = viewport.querySelector<HTMLElement>(".capture-point-edit-status");
  const session: DragSession = {
    pointerId: event.pointerId,
    pointName,
    marker,
    layer,
    viewport,
    mapElement,
    mapRect,
    bounds,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startMapX,
    startMapY,
    mapX: startMapX,
    mapY: startMapY,
    gameX: markerGamePosition.x,
    gameY: markerGamePosition.y,
    moved: false,
    preview: null,
    feedbackElement,
    feedbackOriginalText: feedbackElement?.textContent ?? "改点模式：按住点位旗帜拖拽，松开后提交",
  };

  activeDrag = session;
  marker.classList.add("is-runtime-capture-drag-source");
  try {
    marker.setPointerCapture?.(event.pointerId);
  } catch {
    // Global capture listeners below are sufficient in embedded webviews.
  }
  setFeedback(session, `正在移动点位 ${pointName}`);
}

function moveDrag(event: PointerEvent) {
  const session = activeDrag;
  if (!session || event.pointerId !== session.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  updateDrag(session, event.clientX, event.clientY);
}

function cancelDragEvent(event: PointerEvent) {
  const session = activeDrag;
  if (!session || event.pointerId !== session.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  cancelActiveDrag();
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || !activeDrag) return;
  event.preventDefault();
  event.stopPropagation();
  cancelActiveDrag();
}

function blockWheelDuringDrag(event: WheelEvent) {
  if (!activeDrag) return;
  event.preventDefault();
  event.stopPropagation();
}

export function ensureTacticalCapturePointDragController() {
  if (installed || typeof window === "undefined") return;
  const targetWindow = window as CaptureDragWindow;
  if (targetWindow.__bzssTacticalCapturePointDragInstalled) return;

  installed = true;
  targetWindow.__bzssTacticalCapturePointDragInstalled = true;
  targetWindow.addEventListener("pointerdown", startDrag, true);
  targetWindow.addEventListener("pointermove", moveDrag, true);
  targetWindow.addEventListener("pointerup", (event) => void finishActiveDrag(event), true);
  targetWindow.addEventListener("pointercancel", cancelDragEvent, true);
  targetWindow.addEventListener("keydown", handleKeyDown, true);
  targetWindow.addEventListener("wheel", blockWheelDuringDrag, { capture: true, passive: false });
  targetWindow.addEventListener("blur", cancelActiveDrag);
}
