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

type SidebarMoveWindow = Window & {
  __bzssTacticalCapturePointSidebarMoveInstalled?: boolean;
};

let installed = false;
let selectedPointIndex: number | null = null;
let commandPending = false;
let placementPreview: HTMLButtonElement | null = null;
let refreshFrame: number | null = null;
let domObserver: MutationObserver | null = null;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parsePercent(value: string | null | undefined) {
  const numeric = Number.parseFloat(String(value ?? "").replace("%", ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function parsePointIndex(marker: Element) {
  const label = marker.querySelector(".capture-point-index")?.textContent ?? "";
  const labelMatch = label.match(/P\s*(\d+)/i);
  if (labelMatch) return Number(labelMatch[1]);

  const title = marker.getAttribute("title") ?? "";
  const titleMatch = title.match(/点位\s*(\d+)/);
  return titleMatch ? Number(titleMatch[1]) : null;
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

function getEditingViewport() {
  return document.querySelector<HTMLElement>(".map-viewport.is-capture-point-editing");
}

function getCaptureLayer(viewport: HTMLElement) {
  return viewport.querySelector<HTMLElement>(".capture-zone-layer");
}

function getMapElement(viewport: HTMLElement) {
  return viewport.querySelector<HTMLElement>(".map-transform-container");
}

function findLiveMarker(layer: HTMLElement, pointIndex: number) {
  return Array.from(layer.querySelectorAll<HTMLButtonElement>(".capture-zone-marker:not([data-capture-drag-preview])"))
    .find((marker) => parsePointIndex(marker) === pointIndex) ?? null;
}

function getCaptureSidebarRows() {
  const groups = Array.from(document.querySelectorAll<HTMLElement>(".tactical-sidebar .asset-group"));
  const captureGroup = groups.find((group) => {
    const title = group.querySelector(".asset-group-title")?.textContent ?? "";
    return /占领点|Capture Points/i.test(title);
  });
  if (!captureGroup) return [] as HTMLButtonElement[];
  return Array.from(captureGroup.querySelectorAll<HTMLButtonElement>("button.asset-row"));
}

function clearSelectionStyles() {
  for (const row of getCaptureSidebarRows()) {
    row.classList.remove("is-capture-move-selected");
  }

  for (const marker of Array.from(document.querySelectorAll<HTMLElement>(".capture-zone-marker.is-sidebar-capture-selected"))) {
    marker.classList.remove("is-sidebar-capture-selected");
  }
}

function refreshSelectionStyles() {
  clearSelectionStyles();
  if (selectedPointIndex == null) return;

  const rows = getCaptureSidebarRows();
  rows[selectedPointIndex - 1]?.classList.add("is-capture-move-selected");

  const viewport = getEditingViewport();
  const layer = viewport ? getCaptureLayer(viewport) : null;
  const marker = layer ? findLiveMarker(layer, selectedPointIndex) : null;
  marker?.classList.add("is-sidebar-capture-selected");
}

function scheduleRefreshSelectionStyles() {
  if (refreshFrame != null) return;
  refreshFrame = requestAnimationFrame(() => {
    refreshFrame = null;
    refreshSelectionStyles();
  });
}

function removePlacementPreview() {
  placementPreview?.remove();
  placementPreview = null;
}

function setFeedback(text: string) {
  const viewport = getEditingViewport();
  const feedback = viewport?.querySelector<HTMLElement>(".capture-point-edit-status");
  if (feedback) feedback.textContent = text;
}

function clearSelection() {
  selectedPointIndex = null;
  removePlacementPreview();
  clearSelectionStyles();
  const viewport = getEditingViewport();
  if (viewport) setFeedback("改点模式：按住点位旗帜拖拽，或从右侧资产列表选择点位后点击地图移动");
}

function selectPoint(pointIndex: number) {
  selectedPointIndex = pointIndex;
  removePlacementPreview();
  refreshSelectionStyles();
  setFeedback(`已从右侧选择点位 P${pointIndex} · 移动鼠标预览位置 · 点击地图提交`);
}

function resolveSidebarPointIndex(target: Element) {
  const row = target.closest<HTMLButtonElement>(".tactical-sidebar button.asset-row");
  if (!row) return null;
  const group = row.closest<HTMLElement>(".asset-group");
  const title = group?.querySelector(".asset-group-title")?.textContent ?? "";
  if (!/占领点|Capture Points/i.test(title)) return null;

  const rows = group ? Array.from(group.querySelectorAll<HTMLButtonElement>("button.asset-row")) : [];
  const index = rows.indexOf(row);
  return index >= 0 ? index + 1 : null;
}

function getPlacementPosition(clientX: number, clientY: number) {
  const viewport = getEditingViewport();
  if (!viewport) return null;
  const mapElement = getMapElement(viewport);
  const layer = getCaptureLayer(viewport);
  if (!mapElement || !layer) return null;

  const rect = mapElement.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const mapX = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
  const mapY = clamp(((clientY - rect.top) / rect.height) * 100, 0, 100);
  const bounds = resolveBounds(viewport, mapElement, layer);
  if (!bounds) return null;

  return {
    viewport,
    mapElement,
    layer,
    rect,
    mapX,
    mapY,
    gameX: bounds.minX + (mapX / 100) * (bounds.maxX - bounds.minX),
    gameY: bounds.minY + (mapY / 100) * (bounds.maxY - bounds.minY),
  };
}

function ensurePlacementPreview(layer: HTMLElement, pointIndex: number) {
  if (placementPreview && placementPreview.parentElement === layer) return placementPreview;
  removePlacementPreview();

  const source = findLiveMarker(layer, pointIndex);
  if (!source) return null;

  const preview = source.cloneNode(true) as HTMLButtonElement;
  preview.dataset.captureDragPreview = "sidebar-placement";
  preview.classList.remove("is-sidebar-capture-selected", "is-point-dragging", "is-command-pending", "is-runtime-capture-drag-source");
  preview.classList.add("is-sidebar-capture-placement-preview");
  preview.removeAttribute("title");
  preview.setAttribute("aria-hidden", "true");
  preview.tabIndex = -1;
  layer.appendChild(preview);
  placementPreview = preview;
  return preview;
}

function updatePlacementPreview(clientX: number, clientY: number) {
  if (selectedPointIndex == null || commandPending) return;
  const position = getPlacementPosition(clientX, clientY);
  if (!position) return;

  const { rect, mapX, mapY, gameX, gameY, layer } = position;
  if (
    clientX < rect.left
    || clientX > rect.right
    || clientY < rect.top
    || clientY > rect.bottom
  ) {
    removePlacementPreview();
    return;
  }

  const preview = ensurePlacementPreview(layer, selectedPointIndex);
  if (preview) {
    preview.style.left = `${mapX}%`;
    preview.style.top = `${mapY}%`;
  }
  setFeedback(`已选择 P${selectedPointIndex} · 目标 X ${Math.round(gameX)} Y ${Math.round(gameY)} · 点击地图移动`);
}

function waitForCommittedMarker(layer: HTMLElement, pointIndex: number, mapX: number, mapY: number, timeoutMs = 4500) {
  return new Promise<void>((resolve) => {
    const startedAt = performance.now();
    const check = () => {
      const marker = findLiveMarker(layer, pointIndex);
      const nextX = marker ? parsePercent(marker.style.left) : null;
      const nextY = marker ? parsePercent(marker.style.top) : null;
      if (
        nextX != null
        && nextY != null
        && Math.abs(nextX - mapX) < 0.12
        && Math.abs(nextY - mapY) < 0.12
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

async function placeSelectedPoint(event: PointerEvent) {
  if (selectedPointIndex == null || commandPending || event.button !== 0) return false;
  if (!(event.target instanceof Element)) return false;

  const viewport = getEditingViewport();
  if (!viewport) {
    clearSelection();
    return false;
  }
  const mapElement = getMapElement(viewport);
  if (!mapElement || !mapElement.contains(event.target)) return false;

  // Existing direct flag dragging remains authoritative when the pointer starts
  // on a real capture marker. Sidebar placement only owns map-background clicks.
  if (event.target.closest(".capture-zone-marker:not([data-capture-drag-preview])")) return false;

  const position = getPlacementPosition(event.clientX, event.clientY);
  if (!position) return false;
  const { rect, layer, mapX, mapY, gameX, gameY } = position;
  if (
    event.clientX < rect.left
    || event.clientX > rect.right
    || event.clientY < rect.top
    || event.clientY > rect.bottom
  ) return false;

  event.preventDefault();
  event.stopPropagation();

  const pointIndex = selectedPointIndex;
  const roundedX = Math.round(gameX);
  const roundedY = Math.round(gameY);
  commandPending = true;

  const preview = ensurePlacementPreview(layer, pointIndex);
  if (preview) {
    preview.style.left = `${mapX}%`;
    preview.style.top = `${mapY}%`;
    preview.classList.add("is-command-pending");
  }
  setFeedback(`正在提交 DragCapturePoint:${pointIndex},${roundedX},${roundedY}`);

  try {
    const result = await executeBzssCoreCommand({
      directive: "DragCapturePoint",
      parameter: `${pointIndex},${roundedX},${roundedY}`,
    });
    if (!result?.ok) {
      throw new Error(String((result as { message?: unknown } | null)?.message ?? "BZSS Core 拒绝了改点命令"));
    }

    setFeedback(`点位 P${pointIndex} 已移动到 X ${roundedX}, Y ${roundedY}`);
    await waitForCommittedMarker(layer, pointIndex, mapX, mapY);
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "改点命令发送失败");
  } finally {
    commandPending = false;
    removePlacementPreview();
    refreshSelectionStyles();
  }

  return true;
}

function handlePointerDown(event: PointerEvent) {
  if (!(event.target instanceof Element)) return;

  const sidebarPointIndex = resolveSidebarPointIndex(event.target);
  if (sidebarPointIndex != null) {
    if (!getEditingViewport() || commandPending) return;
    selectPoint(sidebarPointIndex);
    // Do not stop propagation: TacticalMapSidebar should still run its normal
    // focus-zone handler so the selected point is brought into view.
    return;
  }

  void placeSelectedPoint(event);
}

function handlePointerMove(event: PointerEvent) {
  if (selectedPointIndex == null) return;
  if (!getEditingViewport()) {
    clearSelection();
    return;
  }
  updatePlacementPreview(event.clientX, event.clientY);
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || selectedPointIndex == null) return;
  event.preventDefault();
  clearSelection();
}

function handleWindowBlur() {
  removePlacementPreview();
}

export function ensureTacticalCapturePointSidebarMoveController() {
  if (installed || typeof window === "undefined" || typeof document === "undefined") return;
  const targetWindow = window as SidebarMoveWindow;
  if (targetWindow.__bzssTacticalCapturePointSidebarMoveInstalled) return;

  installed = true;
  targetWindow.__bzssTacticalCapturePointSidebarMoveInstalled = true;
  targetWindow.addEventListener("pointerdown", handlePointerDown, true);
  targetWindow.addEventListener("pointermove", handlePointerMove, true);
  targetWindow.addEventListener("keydown", handleKeyDown, true);
  targetWindow.addEventListener("blur", handleWindowBlur);

  if (typeof MutationObserver !== "undefined" && document.body) {
    domObserver = new MutationObserver(() => {
      if (selectedPointIndex != null) scheduleRefreshSelectionStyles();
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
  }
}
