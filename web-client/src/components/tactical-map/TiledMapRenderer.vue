<template>
  <div
    class="tiled-map-renderer"
    :class="{ 'is-interacting': interactionActive }"
    :data-resource-state="resourceState"
  >
    <!-- The first paint is always a request-free blank canvas. -->
    <div
      v-if="!resourceActive || !hasMapResource"
      class="map-resource-placeholder"
      aria-hidden="true"
    ></div>

    <!-- The fallback image is activated only after the page has painted. -->
    <img
      v-if="resourceActive && fallbackImage"
      :src="fallbackImage"
      alt="Tactical Map"
      class="map-image-fallback"
      draggable="false"
      loading="lazy"
      decoding="async"
      fetchpriority="low"
      @load="onFallbackLoad"
      @error="onFallbackError"
    />

    <!-- Only viewport tiles are requested; full-map cache warming is forbidden. -->
    <img
      v-for="entry in renderedTiles"
      :key="`${entry.layerId}-${entry.tile.key}`"
      :src="entry.tile.src"
      class="map-tile"
      :class="{ 'map-tile--pending': entry.pending }"
      :style="tileStyle(entry.tile)"
      draggable="false"
      decoding="async"
      :loading="entry.pending ? 'eager' : 'lazy'"
      @load="entry.pending && onPendingTileLoad(entry.layerId, entry.tile.src)"
      @error="entry.pending ? onPendingTileError(entry.layerId, entry.tile.key, entry.tile.src) : onTileError(entry.tile.key, entry.tile.src)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from "vue";
import { useTileLoader, type TileInfo } from "../../composables/useTileLoader";
import { useTacticalMapViewport } from "../../composables/tacticalMapViewport";

const RESOURCE_ACTIVATION_DELAY_MS = 120;
const RESOURCE_READY_SAFETY_MS = 2_000;

type MapResourceState = "idle" | "scheduled" | "loading" | "ready" | "error";

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

const emit = defineEmits<{
  (e: "ready"): void;
}>();

const { zoom, panX, panY } = useTacticalMapViewport();
const resourceState = ref<MapResourceState>("idle");
const resourceActive = ref(false);
const fallbackFailed = ref(false);

const hasMapResource = computed(() => Boolean(
  String(props.tileBasePath ?? "").trim()
  || String(props.fallbackImage ?? "").trim(),
));

const tilesActive = computed(() => Boolean(
  resourceActive.value
  && props.tilesEnabled
  && String(props.tileBasePath ?? "").trim(),
));

const { visibleTiles, currentTileZoom } = useTileLoader({
  tileBasePath: toRef(props, "tileBasePath"),
  maxZoom: toRef(props, "maxZoom"),
  zoom,
  panX,
  panY,
  viewportWidth: toRef(props, "viewportWidth"),
  viewportHeight: toRef(props, "viewportHeight"),
  enabled: tilesActive,
  interactionActive: computed(() => props.interactionActive === true),
});

interface TileLayer {
  id: number;
  pending: boolean;
  tiles: TileInfo[];
}

const tileLayers = ref<TileLayer[]>([]);
const renderedTiles = computed(() => tileLayers.value.flatMap((layer) => (
  layer.tiles.map((tile) => ({ layerId: layer.id, pending: layer.pending, tile }))
)));
const loadedTileSources = new Set<string>();
const pendingSources = new Set<string>();

let readyEmitted = false;
let loadGeneration = 0;
let pendingGeneration = 0;
let activationTimer: number | null = null;
let readySafetyTimer: number | null = null;

function clearTimer(timer: number | null) {
  if (timer !== null) window.clearTimeout(timer);
}

function cancelPendingResourceWork() {
  clearTimer(activationTimer);
  clearTimer(readySafetyTimer);
  activationTimer = null;
  readySafetyTimer = null;
}

function clearTileLayers() {
  pendingGeneration += 1;
  tileLayers.value = [];
  pendingSources.clear();
  loadedTileSources.clear();
}

function emitReadyOnce() {
  if (readyEmitted) return;
  readyEmitted = true;
  emit("ready");
}

function markResourceReady() {
  resourceState.value = "ready";
  clearTimer(readySafetyTimer);
  readySafetyTimer = null;
  emitReadyOnce();
}

function scheduleReadySafety(generation: number) {
  clearTimer(readySafetyTimer);
  readySafetyTimer = window.setTimeout(() => {
    readySafetyTimer = null;
    if (generation !== loadGeneration || resourceState.value !== "loading") return;

    // A slow or broken map resource must never keep the page unusable.
    resourceState.value = "error";
    emitReadyOnce();
  }, RESOURCE_READY_SAFETY_MS);
}

function scheduleResourceActivation() {
  cancelPendingResourceWork();
  const generation = ++loadGeneration;
  readyEmitted = false;
  fallbackFailed.value = false;
  resourceActive.value = false;
  clearTileLayers();

  if (!hasMapResource.value) {
    resourceState.value = "idle";
    queueMicrotask(() => {
      if (generation === loadGeneration && !hasMapResource.value) emitReadyOnce();
    });
    return;
  }

  resourceState.value = "scheduled";
  activationTimer = window.setTimeout(() => {
    activationTimer = null;
    if (generation !== loadGeneration || !hasMapResource.value) return;

    resourceActive.value = true;
    resourceState.value = "loading";
    scheduleReadySafety(generation);
  }, RESOURCE_ACTIVATION_DELAY_MS);
}

function onFallbackLoad() {
  markResourceReady();
}

function onFallbackError() {
  fallbackFailed.value = true;
  if (!tilesActive.value) {
    resourceState.value = "error";
    emitReadyOnce();
  }
}

function stageTiles(nextTiles: TileInfo[]) {
  const nextSources = nextTiles.map((tile) => tile.src);
  const pendingLayer = tileLayers.value.find((layer) => layer.pending);
  const committedLayer = tileLayers.value.find((layer) => !layer.pending);
  const currentSources = pendingLayer?.tiles.map((tile) => tile.src) ?? [];
  const committedSources = committedLayer?.tiles.map((tile) => tile.src) ?? [];
  if (nextSources.join("|") === currentSources.join("|") || nextSources.join("|") === committedSources.join("|")) return;

  pendingGeneration += 1;
  tileLayers.value = [
    ...tileLayers.value.filter((layer) => !layer.pending),
    { id: pendingGeneration, pending: true, tiles: nextTiles },
  ];
  pendingSources.clear();
  for (const source of nextSources) {
    if (!loadedTileSources.has(source)) pendingSources.add(source);
  }

  if (pendingSources.size === 0) commitPendingTiles(pendingGeneration);
}

function commitPendingTiles(generation: number) {
  if (generation !== pendingGeneration) return;
  const pendingLayer = tileLayers.value.find((layer) => layer.id === generation && layer.pending);
  if (!pendingLayer) return;
  // Retaining the layer id lets Vue promote the already-decoded <img> nodes
  // in place instead of removing them and creating a fresh, blank layer.
  tileLayers.value = [{ ...pendingLayer, pending: false }];
  pendingSources.clear();
  // Tiles can make the map ready when no base image exists or the base failed.
  if (!props.fallbackImage || fallbackFailed.value) markResourceReady();
}

function onPendingTileLoad(generation: number, source: string) {
  if (generation !== pendingGeneration) return;
  loadedTileSources.add(source);
  pendingSources.delete(source);
  if (pendingSources.size === 0) commitPendingTiles(generation);
}

function onPendingTileError(generation: number, key: string, src: string) {
  if (generation !== pendingGeneration) return;
  // Missing tiles should not freeze a map transition forever. Keep the full-map
  // fallback visible and commit the remaining decoded tiles as one layer.
  pendingSources.delete(src);
  onTileError(key, src);
  if (pendingSources.size === 0) commitPendingTiles(generation);
}

function onTileError(key: string, src: string) {
  if (import.meta.env.DEV) {
    console.warn("[TiledMapRenderer] tile failed", { key, src });
  }
}

watch(
  () => [props.tileBasePath, props.fallbackImage, props.maxZoom, props.tilesEnabled] as const,
  scheduleResourceActivation,
  { immediate: true },
);

watch(
  visibleTiles,
  (tiles) => {
    if (resourceActive.value) stageTiles(tiles);
  },
  { deep: false },
);

watch(tilesActive, (active) => {
  if (active) stageTiles(visibleTiles.value);
});

function tileStyle(tile: TileInfo) {
  return {
    left: `${tile.left}%`,
    top: `${tile.top}%`,
    width: `${tile.width}%`,
    height: `${tile.height}%`,
  };
}

onBeforeUnmount(() => {
  loadGeneration += 1;
  cancelPendingResourceWork();
});

defineExpose({ currentTileZoom, resourceState });
</script>

<style scoped>
.tiled-map-renderer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  contain: layout paint style;
  background: #020205;
}

.map-resource-placeholder {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
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

.map-tile--pending {
  visibility: hidden;
}

.tiled-map-renderer.is-interacting .map-tile {
  transition: none;
}
</style>
