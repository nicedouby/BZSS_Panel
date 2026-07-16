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
      v-for="tile in renderedTiles"
      :key="tile.key"
      :src="tile.src"
      class="map-tile"
      :style="tileStyle(tile)"
      draggable="false"
      decoding="async"
      loading="lazy"
      @load="onTileLoad"
      @error="onTileError(tile.key, tile.src)"
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

const renderedTiles = computed(() => (
  resourceActive.value ? visibleTiles.value : []
));

let readyEmitted = false;
let loadGeneration = 0;
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

function onTileLoad() {
  // Tiles can make the map ready when no base image exists or the base failed.
  if (!props.fallbackImage || fallbackFailed.value) markResourceReady();
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

.tiled-map-renderer.is-interacting .map-tile {
  transition: none;
}
</style>
