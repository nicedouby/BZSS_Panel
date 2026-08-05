<template>
  <nav
    ref="rootRef"
    class="tactical-map-toolbar"
    aria-label="战术地图工具栏"
    @pointerdown.stop
    @click.stop
    @wheel.stop
  >
    <Transition name="toolbar-panel">
      <section
        v-if="activePanel"
        :id="panelId"
        class="tactical-map-toolbar__panel"
        :aria-label="panelLabel"
      >
        <template v-if="activePanel === 'layers'">
          <button
            v-for="layer in layerItems"
            :key="layer.key"
            type="button"
            class="tactical-map-toolbar__action"
            :class="{ 'is-active': layer.active }"
            :aria-pressed="layer.active"
            @click="layer.toggle"
          >
            <span class="tactical-map-toolbar__action-icon" aria-hidden="true">{{ layer.icon }}</span>
            <span>{{ layer.label }}</span>
          </button>
        </template>

        <template v-else-if="activePanel === 'tools'">
          <button
            v-if="canEditCapturePoints"
            type="button"
            class="tactical-map-toolbar__action tactical-map-toolbar__action--wide"
            :class="{ 'is-active': capturePointEditMode }"
            :disabled="capturePointCommandPending"
            :aria-pressed="capturePointEditMode"
            @click="emit('toggle-capture-point-edit')"
          >
            <span class="tactical-map-toolbar__action-icon" aria-hidden="true">⌖</span>
            <span>{{ capturePointCommandPending ? "提交中" : "改点" }}</span>
          </button>
          <button
            type="button"
            class="tactical-map-toolbar__action"
            :class="{ 'is-active': measureMode }"
            :aria-pressed="measureMode"
            @click="emit('toggle-measure')"
          >
            <span class="tactical-map-toolbar__action-icon" aria-hidden="true">↔</span>
            <span>测距</span>
          </button>
          <button
            v-if="hasMeasurePoints"
            type="button"
            class="tactical-map-toolbar__action"
            @click="emit('clear-measure')"
          >
            <span class="tactical-map-toolbar__action-icon" aria-hidden="true">×</span>
            <span>清空测距</span>
          </button>
          <button
            type="button"
            class="tactical-map-toolbar__action"
            :class="{ 'is-active': hasCombatHotspot }"
            :aria-pressed="hasCombatHotspot"
            @click="emit('calculate-hotspot')"
          >
            <span class="tactical-map-toolbar__action-icon" aria-hidden="true">◎</span>
            <span>热点</span>
          </button>
          <button
            v-if="hasCombatHotspot"
            type="button"
            class="tactical-map-toolbar__action"
            @click="emit('clear-hotspot')"
          >
            <span class="tactical-map-toolbar__action-icon" aria-hidden="true">×</span>
            <span>清除热点</span>
          </button>
        </template>

        <div v-else class="tactical-map-toolbar__help">
          <span><kbd>右键</kbd> 指令</span>
          <span><kbd>双击</kbd> 资料</span>
          <span><kbd>滚轮</kbd> 缩放</span>
          <span><kbd>拖拽</kbd> 移动</span>
          <span><kbd>M</kbd> 测距</span>
          <span><kbd>G</kbd> 网格</span>
          <span><kbd>F</kbd> 复位</span>
        </div>
      </section>
    </Transition>

    <div class="tactical-map-toolbar__bar">
      <div class="tactical-map-toolbar__group" aria-label="视图操作">
        <button type="button" class="tactical-map-toolbar__icon-button" title="放大" aria-label="放大" @click="emit('zoom-in')">+</button>
        <button type="button" class="tactical-map-toolbar__icon-button" title="缩小" aria-label="缩小" @click="emit('zoom-out')">−</button>
        <button type="button" class="tactical-map-toolbar__icon-button" title="适配视口 (F)" aria-label="适配视口" @click="emit('reset-view')">↺</button>
      </div>

      <span class="tactical-map-toolbar__divider" aria-hidden="true"></span>

      <div class="tactical-map-toolbar__group" aria-label="工具分类">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="tactical-map-toolbar__tab"
          :class="{ 'is-active': activePanel === tab.key || tab.engaged }"
          :aria-expanded="activePanel === tab.key"
          :aria-controls="panelId"
          @click="togglePanel(tab.key)"
        >
          {{ tab.label }}
          <span class="tactical-map-toolbar__chevron" aria-hidden="true">{{ activePanel === tab.key ? "⌄" : "⌃" }}</span>
        </button>
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

type ToolbarPanel = "layers" | "tools" | "help";

const props = defineProps<{
  showGrid: boolean;
  showCaptureZones: boolean;
  showFobs: boolean;
  showPlayerNames: boolean;
  showPlayerCoords: boolean;
  filterAliveOnly: boolean;
  canEditCapturePoints: boolean;
  capturePointEditMode: boolean;
  capturePointCommandPending: boolean;
  measureMode: boolean;
  hasMeasurePoints: boolean;
  hasCombatHotspot: boolean;
}>();

const emit = defineEmits<{
  (event: "zoom-in"): void;
  (event: "zoom-out"): void;
  (event: "reset-view"): void;
  (event: "update:showGrid", value: boolean): void;
  (event: "update:showCaptureZones", value: boolean): void;
  (event: "update:showFobs", value: boolean): void;
  (event: "update:showPlayerNames", value: boolean): void;
  (event: "update:showPlayerCoords", value: boolean): void;
  (event: "update:filterAliveOnly", value: boolean): void;
  (event: "toggle-capture-point-edit"): void;
  (event: "toggle-measure"): void;
  (event: "clear-measure"): void;
  (event: "calculate-hotspot"): void;
  (event: "clear-hotspot"): void;
}>();

const rootRef = ref<HTMLElement | null>(null);
const activePanel = ref<ToolbarPanel | null>(null);
const panelId = "tactical-map-toolbar-panel";

const panelLabel = computed(() => {
  if (activePanel.value === "layers") return "地图图层";
  if (activePanel.value === "tools") return "地图工具";
  return "操作帮助";
});

const layerItems = computed(() => [
  { key: "grid", label: "网格", icon: "#", active: props.showGrid, toggle: () => emit("update:showGrid", !props.showGrid) },
  { key: "capture", label: "地标", icon: "⚑", active: props.showCaptureZones, toggle: () => emit("update:showCaptureZones", !props.showCaptureZones) },
  { key: "fob", label: "FOB", icon: "⌂", active: props.showFobs, toggle: () => emit("update:showFobs", !props.showFobs) },
  { key: "names", label: "姓名", icon: "A", active: props.showPlayerNames, toggle: () => emit("update:showPlayerNames", !props.showPlayerNames) },
  { key: "coords", label: "坐标", icon: "+", active: props.showPlayerCoords, toggle: () => emit("update:showPlayerCoords", !props.showPlayerCoords) },
  { key: "alive", label: "仅存活", icon: "●", active: props.filterAliveOnly, toggle: () => emit("update:filterAliveOnly", !props.filterAliveOnly) },
]);

const tabs = computed(() => [
  { key: "layers" as const, label: "图层", engaged: false },
  { key: "tools" as const, label: "工具", engaged: props.capturePointEditMode || props.measureMode || props.hasCombatHotspot },
  { key: "help" as const, label: "帮助", engaged: false },
]);

function togglePanel(panel: ToolbarPanel) {
  activePanel.value = activePanel.value === panel ? null : panel;
}

function closePanel() {
  activePanel.value = null;
}

function onDocumentPointerDown(event: PointerEvent) {
  if (activePanel.value && !rootRef.value?.contains(event.target as Node)) closePanel();
}

function onDocumentKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape" && activePanel.value) {
    event.stopPropagation();
    closePanel();
  }
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onDocumentKeyDown, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  document.removeEventListener("keydown", onDocumentKeyDown, true);
});
</script>

<style scoped>
.tactical-map-toolbar {
  position: absolute;
  z-index: 220;
  left: 16px;
  bottom: 16px;
  max-width: calc(100% - 32px);
  color: #dcebf3;
  pointer-events: auto;
  isolation: isolate;
}

.tactical-map-toolbar__bar,
.tactical-map-toolbar__panel {
  border: 1px solid rgba(148, 163, 184, .32);
  background: linear-gradient(180deg, rgba(9, 25, 43, .97), rgba(3, 12, 24, .97));
  box-shadow: 0 14px 34px rgba(0, 0, 0, .46);
  backdrop-filter: blur(16px);
}

.tactical-map-toolbar__bar {
  display: flex;
  align-items: center;
  gap: 6px;
  width: max-content;
  max-width: 100%;
  padding: 5px;
  border-radius: 12px;
}

.tactical-map-toolbar__group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.tactical-map-toolbar__divider {
  width: 1px;
  height: 24px;
  margin: 0 2px;
  background: rgba(148, 163, 184, .22);
}

.tactical-map-toolbar button {
  font: inherit;
  cursor: pointer;
  touch-action: manipulation;
}

.tactical-map-toolbar button:focus-visible {
  outline: 2px solid #5eead4;
  outline-offset: 1px;
}

.tactical-map-toolbar__icon-button,
.tactical-map-toolbar__tab {
  height: 34px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #b8ccd9;
}

.tactical-map-toolbar__icon-button {
  width: 34px;
  font-size: 18px;
  font-weight: 800;
}

.tactical-map-toolbar__tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 58px;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 750;
}

.tactical-map-toolbar__icon-button:hover,
.tactical-map-toolbar__tab:hover,
.tactical-map-toolbar__tab.is-active {
  background: rgba(72, 214, 170, .18);
  color: #a7f6d4;
}

.tactical-map-toolbar__chevron {
  color: #6ee7c1;
  font-size: 10px;
}

.tactical-map-toolbar__panel {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  display: grid;
  grid-template-columns: repeat(3, minmax(72px, 1fr));
  gap: 5px;
  width: min(304px, calc(100vw - 32px));
  padding: 7px;
  border-radius: 12px;
}

.tactical-map-toolbar__action {
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 7px;
  padding: 0 9px;
  border: 1px solid rgba(148, 163, 184, .15);
  border-radius: 8px;
  background: rgba(255, 255, 255, .025);
  color: #b8ccd9;
  font-size: 11px;
  font-weight: 700;
}

.tactical-map-toolbar__action:hover,
.tactical-map-toolbar__action.is-active {
  border-color: rgba(94, 234, 212, .54);
  background: rgba(45, 212, 191, .15);
  color: #b9ffea;
}

.tactical-map-toolbar__action:disabled {
  cursor: wait;
  opacity: .58;
}

.tactical-map-toolbar__action-icon {
  width: 17px;
  color: #67e8c2;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: center;
}

.tactical-map-toolbar__help {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  padding: 4px;
  color: #aac0ce;
  font-size: 11px;
}

.tactical-map-toolbar__help span {
  display: flex;
  align-items: center;
  gap: 7px;
}

.tactical-map-toolbar__help kbd {
  min-width: 36px;
  padding: 3px 5px;
  border: 1px solid rgba(148, 163, 184, .34);
  border-radius: 5px;
  background: rgba(30, 41, 59, .8);
  color: #e1edf5;
  font: inherit;
  text-align: center;
}

.toolbar-panel-enter-active,
.toolbar-panel-leave-active {
  transition: opacity .13s ease, transform .13s ease;
}

.toolbar-panel-enter-from,
.toolbar-panel-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(.98);
}

@media (max-width: 700px) {
  .tactical-map-toolbar { left: 8px; bottom: 8px; max-width: calc(100% - 16px); }
  .tactical-map-toolbar__bar { overflow-x: auto; scrollbar-width: none; }
  .tactical-map-toolbar__bar::-webkit-scrollbar { display: none; }
  .tactical-map-toolbar__tab { min-width: 52px; padding: 0 8px; }
  .tactical-map-toolbar__panel { width: min(286px, calc(100vw - 16px)); }
}

@media (prefers-reduced-motion: reduce) {
  .toolbar-panel-enter-active,
  .toolbar-panel-leave-active { transition: none; }
}
</style>
