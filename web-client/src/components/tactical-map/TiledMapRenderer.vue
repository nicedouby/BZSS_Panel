<template>
  <div class="tiled-map-renderer">
    <!-- Fallback: low-res tiles from cached lower zoom level -->
    <img
      v-for="tile in fallbackTiles"
      :key="tile.key"
      :src="tile.src"
      class="map-tile map-tile--fallback"
      :style="tileStyle(tile)"
      draggable="false"
      decoding="async"
    />

    <!-- Primary tiles at current zoom level -->
    <img
      v-for="tile in visibleTiles"
      :key="tile.key"
      :src="tile.src"
      class="map-tile"
      :class="{ 'map-tile--loaded': isTileLoaded(tile.key) }"
      :style="tileStyle(tile)"
      draggable="false"
      decoding="async"
      @load="onTileLoad(tile.key)"
    />

    <!-- Fallback: original full image when tiles unavailable -->
    <img
      v-if="!tilesEnabled && fallbackImage"
      :src="fallbackImage"
      alt="Tactical Map"
      class="map-image-fallback"
      draggable="false"
      @load="onFallbackLoad"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, toRef, ref, watch } from "vue";
import { useTileLoader, type TileInfo } from "../../composables/useTileLoader";
import { useTacticalMapViewport } from "../../composables/tacticalMapViewport";

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
  /** Fallback image URL (original full PNG) */
  fallbackImage?: string;
}>();

const { zoom, panX, panY } = useTacticalMapViewport();

const { visibleTiles, fallbackTiles, currentTileZoom } = useTileLoader({
  tileBasePath: toRef(props, "tileBasePath"),
  maxZoom: toRef(props, "maxZoom"),
  zoom,
  panX,
  panY,
  viewportWidth: toRef(props, "viewportWidth"),
  viewportHeight: toRef(props, "viewportHeight"),
  enabled: toRef(props, "tilesEnabled"),
});

const emit = defineEmits<{
  (e: "ready"): void;
}>();

// Track which tiles have finished loading via native <img> @load event
const loadedSet = ref(new Set<string>());
const fallbackLoaded = ref(false);

function onTileLoad(key: string) {
  const next = new Set(loadedSet.value);
  next.add(key);
  loadedSet.value = next;
  syncReadyState();
}

function isTileLoaded(key: string) {
  return loadedSet.value.has(key);
}

function onFallbackLoad() {
  fallbackLoaded.value = true;
  syncReadyState();
}

// Clear loaded state when map changes
watch(() => props.tileBasePath, () => {
  loadedSet.value = new Set();
  fallbackLoaded.value = false;
  syncReadyState();
});

watch(
  () => [visibleTiles.value.length, fallbackTiles.value.length, props.tilesEnabled] as const,
  () => {
    syncReadyState();
  },
  { immediate: true }
);

function syncReadyState() {
  const expectedTiles = visibleTiles.value.length;
  const tilesReady = expectedTiles > 0 ? loadedSet.value.size >= expectedTiles : fallbackLoaded.value || !props.tilesEnabled;
  if (tilesReady) {
    emit("ready");
  }
}

function tileStyle(tile: TileInfo) {
  return {
    position: "absolute" as const,
    left: `${tile.left}%`,
    top: `${tile.top}%`,
    width: `${tile.width}%`,
    height: `${tile.height}%`,
  };
}

defineExpose({ currentTileZoom });
</script>

<style scoped>
.tiled-map-renderer {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.map-tile {
  display: block;
  image-rendering: auto;
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
  /* Prevents sub-pixel gaps between tiles */
  backface-visibility: hidden;
}

.map-tile--loaded {
  opacity: 1;
}

.map-tile--fallback {
  opacity: 0.6;
  filter: blur(1px);
  z-index: 0;
}

.map-image-fallback {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
}
</style>
