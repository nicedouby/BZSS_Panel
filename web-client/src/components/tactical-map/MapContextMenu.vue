<template>
  <div
    ref="menuRef"
    class="map-context-menu map-floating-panel"
    :style="menuStyle"
    @click.stop
    @contextmenu.prevent.stop
  >
    <div class="menu-header font-mono">
      <div class="header-title">COORDS SPECIFICATION</div>
      <div class="coords-display">
        <span class="coord-tag">GX:</span> <span class="coord-val">{{ Math.round(gameX) }}</span>
        <span class="coord-tag spacer">GY:</span> <span class="coord-val text-yellow">{{ Math.round(gameY) }}</span>
      </div>
      <div v-if="measureActive" class="measure-state">{{ measureCount === 0 ? "测距未开始" : `测距中 · ${measureCount} 点` }}</div>
    </div>

    <div class="menu-divider"></div>

    <ul class="menu-list">
      <!-- Section: Measurement & Focus -->
      <div class="menu-section-header">战术测距</div>
      <li class="menu-item" @click="handleAction('start-measure')">
        <span class="menu-icon">📏</span>
        <span class="menu-label">{{ measurePrimaryLabel }}</span>
      </li>
      <li class="menu-item" @click="handleAction('add-point')">
        <span class="menu-icon">📍</span>
        <span class="menu-label">{{ measureAppendLabel }}</span>
      </li>
      <li
        class="menu-item"
        :class="{ disabled: !hasPoints }"
        @click="hasPoints && handleAction('undo-point')"
      >
        <span class="menu-icon">↩️</span>
        <span class="menu-label">撤销测距点</span>
      </li>
      <li
        class="menu-item"
        :class="{ disabled: !hasPoints }"
        @click="hasPoints && handleAction('clear-measure')"
      >
        <span class="menu-icon">🗑️</span>
        <span class="menu-label">清空测距</span>
      </li>

      <div class="menu-divider sub-divider"></div>

      <!-- Section: Tactical Tools -->
      <div class="menu-section-header">战术工具</div>
      <li 
        v-if="canEditCapturePoints" 
        class="menu-item" 
        :class="{ disabled: capturePointCommandPending }"
        @click="!capturePointCommandPending && handleAction('toggle-capture-point-edit')"
      >
        <span class="menu-icon">⌖</span>
        <span class="menu-label">
          <span>{{ capturePointEditMode ? "退出改点模式" : "开启改点模式" }}</span>
          <span class="status-dot" :class="{ active: capturePointEditMode }"></span>
        </span>
      </li>
      <li class="menu-item" @click="handleAction('calculate-hotspot')">
        <span class="menu-icon">◎</span>
        <span class="menu-label">
          <span>{{ hasCombatHotspot ? "更新交战热点" : "计算交战热点" }}</span>
          <span class="status-dot" :class="{ active: hasCombatHotspot }"></span>
        </span>
      </li>
      <li
        v-if="hasCombatHotspot"
        class="menu-item"
        @click="handleAction('clear-hotspot')"
      >
        <span class="menu-icon">×</span>
        <span class="menu-label">清除交战热点</span>
      </li>

      <div class="menu-divider sub-divider"></div>

      <!-- Section: Layers -->
      <div class="menu-section-header">图层显示</div>
      <li class="menu-item" @click="handleAction('toggle-layer-alive')">
        <span class="menu-icon">👥</span>
        <span class="menu-label">
          <span>仅显示存活玩家</span>
          <span class="status-checkbox" :class="{ checked: filterAliveOnly }"></span>
        </span>
      </li>
      <li class="menu-item" @click="handleAction('toggle-layer-names')">
        <span class="menu-icon">🏷️</span>
        <span class="menu-label">
          <span>显示玩家姓名</span>
          <span class="status-checkbox" :class="{ checked: showPlayerNames }"></span>
        </span>
      </li>
      <li class="menu-item" @click="handleAction('toggle-layer-coords')">
        <span class="menu-icon">📍</span>
        <span class="menu-label">
          <span>显示玩家坐标</span>
          <span class="status-checkbox" :class="{ checked: showPlayerCoords }"></span>
        </span>
      </li>
      <li class="menu-item" @click="handleAction('toggle-layer-fobs')">
        <span class="menu-icon">⛺</span>
        <span class="menu-label">
          <span>显示 FOB 范围</span>
          <span class="status-checkbox" :class="{ checked: showFobs }"></span>
        </span>
      </li>
      <li class="menu-item" @click="handleAction('toggle-layer-zones')">
        <span class="menu-icon">🏳️</span>
        <span class="menu-label">
          <span>显示点位旗帜</span>
          <span class="status-checkbox" :class="{ checked: showCaptureZones }"></span>
        </span>
      </li>
      <li class="menu-item" @click="handleAction('toggle-layer-grid')">
        <span class="menu-icon">🌐</span>
        <span class="menu-label">
          <span>网格背景</span>
          <span class="status-checkbox" :class="{ checked: showGrid }"></span>
        </span>
      </li>

      <div class="menu-divider sub-divider"></div>

      <!-- Section: Utils -->
      <li class="menu-item" @click="handleAction('copy-coords')">
        <span class="menu-icon">📋</span>
        <span class="menu-label">复制坐标</span>
      </li>
      <li class="menu-item" @click="handleAction('focus-here')">
        <span class="menu-icon">👁️</span>
        <span class="menu-label">聚焦此处</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";

const props = defineProps<{
  x: number;
  y: number;
  gameX: number;
  gameY: number;
  mapX: number;
  mapY: number;
  hasPoints: boolean;
  measureActive: boolean;
  measureCount: number;

  // Layer Visibility
  filterAliveOnly: boolean;
  showPlayerNames: boolean;
  showPlayerCoords: boolean;
  showFobs: boolean;
  showCaptureZones: boolean;
  showGrid: boolean;

  // Tools & States
  canEditCapturePoints: boolean;
  capturePointEditMode: boolean;
  capturePointCommandPending: boolean;
  hasCombatHotspot: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "start-measure"): void;
  (e: "add-point"): void;
  (e: "undo-point"): void;
  (e: "clear-measure"): void;
  (e: "copy-coords"): void;
  (e: "focus-here"): void;

  // Context Menu Actions
  (e: "toggle-capture-point-edit"): void;
  (e: "calculate-hotspot"): void;
  (e: "clear-hotspot"): void;
  (e: "toggle-layer", payload: "alive" | "names" | "coords" | "fobs" | "zones" | "grid"): void;
}>();

const menuRef = ref<HTMLElement | null>(null);
const offsetLeft = ref(props.x);
const offsetTop = ref(props.y);

const menuStyle = computed(() => {
  return {
    left: `${offsetLeft.value}px`,
    top: `${offsetTop.value}px`,
  };
});

const measurePrimaryLabel = computed(() => props.measureActive ? "重新从此处测距" : "从此处开始测距");
const measureAppendLabel = computed(() => props.measureActive ? `继续添加测距点 (${props.measureCount})` : "添加测距点");

onMounted(() => {
  if (menuRef.value) {
    const rect = menuRef.value.getBoundingClientRect();
    const parentRect = menuRef.value.parentElement?.getBoundingClientRect() || {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    let left = props.x;
    let top = props.y;

    if (left + rect.width > parentRect.width) {
      left = parentRect.width - rect.width - 8;
    }
    if (top + rect.height > parentRect.height) {
      top = parentRect.height - rect.height - 8;
    }

    offsetLeft.value = Math.max(8, left);
    offsetTop.value = Math.max(8, top);
  }
});

function handleAction(
  event:
    | "start-measure"
    | "add-point"
    | "undo-point"
    | "clear-measure"
    | "copy-coords"
    | "focus-here"
    | "toggle-capture-point-edit"
    | "calculate-hotspot"
    | "clear-hotspot"
    | "toggle-layer-alive"
    | "toggle-layer-names"
    | "toggle-layer-coords"
    | "toggle-layer-fobs"
    | "toggle-layer-zones"
    | "toggle-layer-grid"
) {
  if (event === "start-measure") emit("start-measure");
  else if (event === "add-point") emit("add-point");
  else if (event === "undo-point") emit("undo-point");
  else if (event === "clear-measure") emit("clear-measure");
  else if (event === "copy-coords") emit("copy-coords");
  else if (event === "focus-here") emit("focus-here");
  else if (event === "toggle-capture-point-edit") emit("toggle-capture-point-edit");
  else if (event === "calculate-hotspot") emit("calculate-hotspot");
  else if (event === "clear-hotspot") emit("clear-hotspot");
  else if (event === "toggle-layer-alive") emit("toggle-layer", "alive");
  else if (event === "toggle-layer-names") emit("toggle-layer", "names");
  else if (event === "toggle-layer-coords") emit("toggle-layer", "coords");
  else if (event === "toggle-layer-fobs") emit("toggle-layer", "fobs");
  else if (event === "toggle-layer-zones") emit("toggle-layer", "zones");
  else if (event === "toggle-layer-grid") emit("toggle-layer", "grid");
  emit("close");
}
</script>

<style scoped>
.map-floating-panel {
  background: rgba(8, 12, 24, 0.94);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(0, 229, 255, 0.25);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.85), 0 0 20px rgba(0, 229, 255, 0.15);
  border-radius: 6px;
}

.map-context-menu {
  position: absolute;
  width: 230px;
  z-index: 1000;
  padding: 8px 0;
  max-height: 480px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 229, 255, 0.3) transparent;
  animation: contextMenuAppear 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
}

.map-context-menu::-webkit-scrollbar {
  width: 4px;
}
.map-context-menu::-webkit-scrollbar-thumb {
  background: rgba(0, 229, 255, 0.3);
  border-radius: 2px;
}

@keyframes contextMenuAppear {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(-6px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.menu-header {
  padding: 8px 14px 6px;
}

.header-title {
  font-size: 9px;
  color: rgba(0, 229, 255, 0.6);
  letter-spacing: 1px;
  margin-bottom: 4px;
}

.coords-display {
  font-size: 11px;
  color: #cbd5e1;
  display: flex;
  align-items: center;
}

.measure-state {
  margin-top: 4px;
  font-size: 10px;
  color: rgba(56, 189, 248, 0.9);
  letter-spacing: 0.5px;
}

.coord-tag {
  color: rgba(255, 255, 255, 0.4);
  margin-right: 4px;
}

.coord-val {
  color: #38bdf8;
  font-weight: bold;
}

.spacer {
  margin-left: 10px;
}

.menu-divider {
  height: 1px;
  background: linear-gradient(90deg, rgba(0, 229, 255, 0.25) 0%, rgba(0, 229, 255, 0.05) 100%);
  margin: 6px 0;
}

.sub-divider {
  background: rgba(255, 255, 255, 0.08);
}

.menu-section-header {
  font-size: 9px;
  color: rgba(148, 163, 184, 0.7);
  letter-spacing: 0.8px;
  padding: 6px 14px 2px;
  text-transform: uppercase;
}

.menu-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.menu-item {
  padding: 7px 14px;
  font-size: 12px;
  color: #e2e8f0;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  transition: all 0.15s ease;
  position: relative;
}

.menu-item:hover:not(.disabled) {
  background: rgba(0, 229, 255, 0.12);
  color: #ffffff;
  padding-left: 17px;
}

.menu-item:hover:not(.disabled)::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: #00e5ff;
  box-shadow: 0 0 8px #00e5ff;
}

.menu-item.disabled {
  color: #64748b;
  cursor: not-allowed;
  opacity: 0.65;
}

.menu-icon {
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
}

.menu-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

/* Status Indicator Dot */
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.3);
  transition: all 0.2s ease;
}

.status-dot.active {
  background: #10b981;
  border-color: #34d399;
  box-shadow: 0 0 6px #10b981;
}

/* Checkbox State style */
.status-checkbox {
  width: 12px;
  height: 12px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  position: relative;
  transition: all 0.2s ease;
}

.status-checkbox.checked {
  background: rgba(0, 229, 255, 0.25);
  border-color: #00e5ff;
}

.status-checkbox.checked::after {
  content: '✓';
  position: absolute;
  font-size: 9px;
  color: #00e5ff;
  font-weight: bold;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}
</style>
