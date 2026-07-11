import { ref, computed, watch, onBeforeUnmount, type Ref } from "vue";

// ── Types ───────────────────────────────────────────────────────────────────

export interface TileInfo {
  /** Tile key for v-for: "z-x-y" */
  key: string;
  /** Zoom level 0..maxZoom */
  z: number;
  /** Column index within this zoom level */
  x: number;
  /** Row index within this zoom level */
  y: number;
  /** CSS left position in % within the map coordinate space */
  left: number;
  /** CSS top position in % */
  top: number;
  /** CSS width in % */
  width: number;
  /** CSS height in % */
  height: number;
  /** Tile image URL */
  src: string;
  /** Whether the image has been loaded (tracked externally) */
  loaded: boolean;
}

export interface UseTileLoaderOptions {
  /** Base path for tiles, e.g. "/assets/map-tiles/Sumari_RAAS_v1" */
  tileBasePath: Ref<string>;
  /** Maximum zoom level available (typically 4) */
  maxZoom: Ref<number>;
  /** Current viewport zoom factor (continuous value from TacticalMapPage) */
  zoom: Ref<number>;
  /** Pan X offset in pixels */
  panX: Ref<number>;
  /** Pan Y offset in pixels */
  panY: Ref<number>;
  /** Viewport width in pixels */
  viewportWidth: Ref<number>;
  /** Viewport height in pixels */
  viewportHeight: Ref<number>;
  /** Whether tiling is enabled (false = fallback to original image) */
  enabled: Ref<boolean>;
  /** Map size in the CSS coordinate space (default 1000) */
  mapSize?: number;
}

// ── Constants ───────────────────────────────────────────────────────────────

const TILE_SIZE_PX = 256;
const LOAD_MARGIN = 1; // Extra tile margin around viewport for preloading\nconst MAX_TRACKED_TILE_KEYS = 256;

// ── Composable ──────────────────────────────────────────────────────────────

export function useTileLoader(options: UseTileLoaderOptions) {
  const {
    tileBasePath,
    maxZoom,
    zoom,
    panX,
    panY,
    viewportWidth,
    viewportHeight,
    enabled,
    mapSize = 1000,
  } = options;

  // Track which zoom-level tiles have been seen before (for fallback rendering)
  const seenTileKeys = new Map<string, number>();

  const visibleTiles = ref<TileInfo[]>([]);
  const fallbackTiles = ref<TileInfo[]>([]);

  /**
   * Map continuous zoom value to the best discrete tile zoom level.
   *
   * At zoom level z, the map has 2^z tiles per axis.
   * Each tile covers mapSize / 2^z CSS units.
   * On screen, each tile is (mapSize / 2^z) * viewZoom pixels.
   * We want that to be roughly ≥ TILE_SIZE_PX for sharpness.
   *
   * (mapSize / 2^z) * viewZoom >= TILE_SIZE_PX
   * 2^z <= (mapSize * viewZoom) / TILE_SIZE_PX
   * z <= log2((mapSize * viewZoom) / TILE_SIZE_PX)
   */
  function pickZoomLevel(viewZoom: number): number {
    const maxZ = maxZoom.value;
    const raw = Math.log2((mapSize * viewZoom) / TILE_SIZE_PX);
    const z = Math.max(0, Math.min(maxZ, Math.floor(raw)));
    return z;
  }

  /**
   * Compute which tiles are visible in the current viewport.
   */
  function computeVisibleTiles(): TileInfo[] {
    if (!enabled.value) return [];

    const vZoom = zoom.value;
    const z = pickZoomLevel(vZoom);
    const tilesPerAxis = Math.pow(2, z);
    const tileSizeCss = mapSize / tilesPerAxis;

    // The map transform container is positioned with:
    //   translate(panX, panY) scale(zoom)
    // Visible CSS range:
    const vw = viewportWidth.value;
    const vh = viewportHeight.value;
    const px = panX.value;
    const py = panY.value;

    const cssMinX = (0 - px) / vZoom;
    const cssMaxX = (vw - px) / vZoom;
    const cssMinY = (0 - py) / vZoom;
    const cssMaxY = (vh - py) / vZoom;

    // Convert to tile indices
    const colMin = Math.max(0, Math.floor(cssMinX / tileSizeCss) - LOAD_MARGIN);
    const colMax = Math.min(tilesPerAxis - 1, Math.floor(cssMaxX / tileSizeCss) + LOAD_MARGIN);
    const rowMin = Math.max(0, Math.floor(cssMinY / tileSizeCss) - LOAD_MARGIN);
    const rowMax = Math.min(tilesPerAxis - 1, Math.floor(cssMaxY / tileSizeCss) + LOAD_MARGIN);

    const basePath = tileBasePath.value;
    const tiles: TileInfo[] = [];

    for (let y = rowMin; y <= rowMax; y++) {
      for (let x = colMin; x <= colMax; x++) {
        const key = `${z}-${x}-${y}`;
        const src = `${basePath}/${z}/${x}_${y}.jpg`;
        const tileWidthPct = 100 / tilesPerAxis;
        const tileHeightPct = 100 / tilesPerAxis;

        seenTileKeys.set(key, Date.now());

        tiles.push({
          key,
          z,
          x,
          y,
          left: x * tileWidthPct,
          top: y * tileHeightPct,
          width: tileWidthPct,
          height: tileHeightPct,
          src,
          loaded: false, // Tracked by the component via @load
        });
      }
    }

    return tiles;
  }

  /**
   * Compute a set of lower-zoom "fallback" tiles that cover the viewport,
   * but only those that have been previously loaded (already in browser cache).
   */
  function computeFallbackTiles(): TileInfo[] {
    if (!enabled.value) return [];

    const vZoom = zoom.value;
    const targetZ = pickZoomLevel(vZoom);

    // Use z-1 as fallback (or z0 minimum)
    const fbZ = Math.max(0, targetZ - 1);
    if (fbZ === targetZ) return [];

    const tilesPerAxis = Math.pow(2, fbZ);
    const tileSizeCss = mapSize / tilesPerAxis;
    const basePath = tileBasePath.value;

    const vw = viewportWidth.value;
    const vh = viewportHeight.value;
    const px = panX.value;
    const py = panY.value;

    const cssMinX = (0 - px) / vZoom;
    const cssMaxX = (vw - px) / vZoom;
    const cssMinY = (0 - py) / vZoom;
    const cssMaxY = (vh - py) / vZoom;

    const colMin = Math.max(0, Math.floor(cssMinX / tileSizeCss));
    const colMax = Math.min(tilesPerAxis - 1, Math.floor(cssMaxX / tileSizeCss));
    const rowMin = Math.max(0, Math.floor(cssMinY / tileSizeCss));
    const rowMax = Math.min(tilesPerAxis - 1, Math.floor(cssMaxY / tileSizeCss));

    const tiles: TileInfo[] = [];

    for (let y = rowMin; y <= rowMax; y++) {
      for (let x = colMin; x <= colMax; x++) {
        const key = `${fbZ}-${x}-${y}`;
        // Only render fallback tiles that have been previously loaded
        if (!seenTileKeys.has(key)) continue;

        const tileWidthPct = 100 / tilesPerAxis;
        const tileHeightPct = 100 / tilesPerAxis;

        tiles.push({
          key: `fb-${key}`,
          z: fbZ,
          x,
          y,
          left: x * tileWidthPct,
          top: y * tileHeightPct,
          width: tileWidthPct,
          height: tileHeightPct,
          src: `${basePath}/${fbZ}/${x}_${y}.jpg`,
          loaded: true,
        });
      }
    }

    return tiles;
  }

  let rafId: number | null = null;
  let dirty = false;

  function markDirty() {
    dirty = true;
    if (rafId == null) {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (dirty) {
          dirty = false;
          refreshTiles();
        }
      });
    }
  }

  function pruneSeenTileKeys(keepKeys: Set<string>) {
    for (const key of seenTileKeys.keys()) {
      if (!keepKeys.has(key)) seenTileKeys.delete(key);
    }
    if (seenTileKeys.size <= MAX_TRACKED_TILE_KEYS) return;
    const entries = [...seenTileKeys.entries()]
      .sort((left, right) => left[1] - right[1]);
    for (const [key] of entries.slice(0, seenTileKeys.size - MAX_TRACKED_TILE_KEYS)) {
      seenTileKeys.delete(key);
    }
  }

  function refreshTiles() {
    if (!enabled.value) {
      visibleTiles.value = [];
      fallbackTiles.value = [];
      seenTileKeys.clear();
      return;
    }

    const nextVisible = computeVisibleTiles();
    const nextFallback = computeFallbackTiles();
    pruneSeenTileKeys(new Set(nextVisible.map((tile) => tile.key.replace(/^fb-/, ""))));

    const currentSrcs = visibleTiles.value.map(t => t.src).join(",");
    const nextSrcs = nextVisible.map(t => t.src).join(",");
    if (currentSrcs !== nextSrcs) {
      visibleTiles.value = nextVisible;
    }

    const currentFbSrcs = fallbackTiles.value.map(t => t.src).join(",");
    const nextFbSrcs = nextFallback.map(t => t.src).join(",");
    if (currentFbSrcs !== nextFbSrcs) {
      fallbackTiles.value = nextFallback;
    }
  }

  // Current tile zoom level (exposed for debug / display)
  const currentTileZoom = computed(() => pickZoomLevel(zoom.value));

  // Watch all viewport parameters
  watch([zoom, panX, panY, viewportWidth, viewportHeight, tileBasePath, maxZoom, enabled], markDirty, {
    immediate: true,
  });

  // Clear caches when the map changes
  watch(tileBasePath, () => {
    seenTileKeys.clear();
  });

  onBeforeUnmount(() => {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
    }
  });

  return {
    /** Tiles that should be rendered at the current zoom level */
    visibleTiles,
    /** Lower-zoom tiles to show as blurry fallback while loading */
    fallbackTiles,
    /** Current discrete tile zoom level */
    currentTileZoom,
    /** Force refresh (e.g. after resize) */
    refresh: refreshTiles,
  };
}
