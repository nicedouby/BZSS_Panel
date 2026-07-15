<template>
  <div class="tiled-map-renderer" :class="{ 'is-interacting': interactionActive }">
    <!-- A stable, fully decoded image remains under the tiles at all times. -->
    <img
      v-if="fallbackImage"
      :src="fallbackImage"
      alt="Tactical Map"
      class="map-image-fallback"
      draggable="false"
      loading="eager"
      decoding="async"
      fetchpriority="high"
      @load="onFallbackLoad"
    />

    <!-- Loaded tiles naturally paint over the stable full-map image. -->
    <img
      v-for="tile in visibleTiles"
      :key="tile.key"
      :src="tile.src"
      class="map-tile"
      :style="tileStyle(tile)"
      draggable="false"
      decoding="async"
      loading="eager"
      @load="onTileLoad"
      @error="onTileError(tile.key, tile.src)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, toRef, watch } from "vue";
import { useTileLoader, type TileInfo } from "../../composables/useTileLoader";
import { useTacticalMapViewport } from "../../composables/tacticalMapViewport";
import { warmTacticalMapTileCache } from "../../utils/map-tile-cache";

const props = defineProps<{
  /** Base path to tiles directory, e.g. "/assets/map-tiles/Sumari_RAAS_v1" */
  tileBasePath: string;
  /** Maximum tile zoom level (typically 4) */
  maxZoom: number;
  /** Whether tiled rendering is enabled */
  tilesEnabled: boolean;
  /** Viewport width in pixels */
  viewportWidth: number;
  /** Viewport height in pixels */
  viewportHeight: number;
  /** Stable full-map image shown underneath the tiles */
  fallbackImage?: string;
  /** True while pointer dragging; tile discovery is deferred until release */
  interactionActive?: boolean;
}>();

const { zoom, panX, panY } = useTacticalMapViewport();

const { visibleTiles, currentTileZoom } = useTileLoader({
  tileBasePath: toRef(props, "tileBasePath"),
  maxZoom: toRef(props, "maxZoom"),
  zoom,
  panX,
  panY,
  viewportWidth: toRef(props, "viewportWidth"),
  viewportHeight: toRef(props, "viewportHeight"),
  enabled: toRef(props, "tilesEnabled"),
  interactionActive: computed(() => props.interactionActive === true),
});

const emit = defineEmits<{
  (e: "ready"): void;
}>();

let readyEmitted = false;
let warmupTimer: number | null = null;
let warmupController: AbortController | null = null;

function emitReadyOnce() {
  if (readyEmitted) return;
  readyEmitted = true;
  emit("ready");
}

function onFallbackLoad() {
  emitReadyOnce();
  scheduleCacheWarmup();
}

function onTileLoad() {
  // Tiles can still make the map ready when a legacy config has no base image.
  if (!props.fallbackImage) emitReadyOnce();
  scheduleCacheWarmup();
}

function onTileError(key: string, src: string) {
  if (import.meta.env.DEV) {
    console.warn("[TiledMapRenderer] tile failed", { key, src });
  }
}

function scheduleCacheWarmup() {
  if (!props.tilesEnabled || warmupTimer !== null || warmupController !== null) return;
  warmupTimer = window.setTimeout(() => {
    warmupTimer = null;
    if (!props.tilesEnabled) return;

    const controller = new AbortController();
    warmupController = controller;
    void warmTacticalMapTileCache({
      basePath: props.tileBasePath,
      maxZoom: props.maxZoom,
      preferredZoom: currentTileZoom.value,
      concurrency: 6,
      signal: controller.signal,
    }).finally(() => {
      if (warmupController === controller) warmupController = null;
    });
  }, 350);
}

function resetMapLoadingState() {
  readyEmitted = false;
  if (warmupTimer !== null) {
    window.clearTimeout(warmupTimer);
    warmupTimer = null;
  }
  warmupController?.abort();
  warmupController = null;
}

watch(
  () => [props.tileBasePath, props.maxZoom] as const,
  () => {
    resetMapLoadingState();
    if (props.tilesEnabled && !props.fallbackImage) scheduleCacheWarmup();
  },
);

watch(
  () => props.tilesEnabled,
  (enabled) => {
    if (enabled) scheduleCacheWarmup();
    else resetMapLoadingState();
  },
);

function tileStyle(tile: TileInfo) {
  return {
    left: `${tile.left}%`,
    top: `${tile.top}%`,
    width: `${tile.width}%`,
    height: `${tile.height}%`,
  };
}

onBeforeUnmount(resetMapLoadingState);

defineExpose({ currentTileZoom });
</script>

<style scoped>
.tiled-map-renderer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  contain: layout paint style;
  background: #020205;
}

.map-image-fallback,
.map-tile {
  position: absolute;
  display: block;
  pointer-events: none;
  backface-visibility: hidden;
}

.map-image-fallback {
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  z-index: 0;
}

.map-tile {
  image-rendering: auto;
  z-index: 1;
}

.tiled-map-renderer.is-interacting .map-tile {
  transition: none;
}
</style>
