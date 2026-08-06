<template>
  <div
    ref="menuRef"
    class="radial-context-menu"
    :style="menuStyle"
    @click.stop
    @contextmenu.prevent.stop
  >
    <!-- Radial Outer Ring Glow -->
    <div class="radial-ring-background"></div>

    <!-- Center Core Info Hub -->
    <div
      class="radial-center-core font-mono"
      :class="{ 'is-hovered': hoverIndex === -1 }"
      @click="handleAction('close')"
    >
      <div class="core-tag">COORDS</div>
      <div class="core-coords">
        <span class="gx">X: {{ Math.round(gameX) }}</span>
        <span class="gy">Y: {{ Math.round(gameY) }}</span>
      </div>
      <div v-if="measureActive" class="core-sub text-cyan">
        {{ measureCount === 0 ? "测距开启" : `${measureCount} 点` }}
      </div>
      <div v-else class="core-sub">点击/松开关闭</div>
    </div>

    <!-- Main Radial Action Buttons (8 Sectors) -->
    <div v-if="!showLayerRing" class="radial-sector-group">
      <!-- 0 deg: Measure -->
      <button
        type="button"
        class="radial-btn"
        :class="{ 'is-hovered': hoverIndex === 0 }"
        style="--angle: 0deg;"
        :title="measurePrimaryLabel"
        @pointerdown.stop
        @click="handleAction(measureActive ? 'add-point' : 'start-measure')"
      >
        <span class="radial-btn-icon">📏</span>
        <span class="radial-btn-label">{{ measureActive ? "添加点" : "开始测距" }}</span>
      </button>

      <!-- 45 deg: Point Edit Mode -->
      <button
        v-if="canEditCapturePoints"
        type="button"
        class="radial-btn"
        :class="{ 'is-active': capturePointEditMode, 'is-disabled': capturePointCommandPending, 'is-hovered': hoverIndex === 1 }"
        style="--angle: 45deg;"
        title="开启/退出点位编辑模式"
        @pointerdown.stop
        @click="!capturePointCommandPending && handleAction('toggle-capture-point-edit')"
      >
        <span class="radial-btn-icon">⌖</span>
        <span class="radial-btn-label">改点模式</span>
        <span class="active-dot" :class="{ active: capturePointEditMode }"></span>
      </button>

      <!-- 90 deg: Hotspot -->
      <button
        type="button"
        class="radial-btn"
        :class="{ 'is-active': hasCombatHotspot, 'is-hovered': hoverIndex === 2 }"
        style="--angle: 90deg;"
        title="计算/更新交战集中热点"
        @pointerdown.stop
        @click="handleAction('calculate-hotspot')"
      >
        <span class="radial-btn-icon">◎</span>
        <span class="radial-btn-label">交战热点</span>
        <span class="active-dot" :class="{ active: hasCombatHotspot }"></span>
      </button>

      <!-- 135 deg: Focus Here -->
      <button
        type="button"
        class="radial-btn"
        :class="{ 'is-hovered': hoverIndex === 3 }"
        style="--angle: 135deg;"
        title="地图视角聚焦于此"
        @pointerdown.stop
        @click="handleAction('focus-here')"
      >
        <span class="radial-btn-icon">👁️</span>
        <span class="radial-btn-label">聚焦此处</span>
      </button>

      <!-- 180 deg: Layers Subring Trigger -->
      <button
        type="button"
        class="radial-btn"
        :class="{ 'is-hovered': hoverIndex === 4 }"
        style="--angle: 180deg;"
        title="展开地图图层显示开关"
        @pointerdown.stop
        @click="showLayerRing = true"
      >
        <span class="radial-btn-icon">🛡️</span>
        <span class="radial-btn-label">图层控制</span>
        <span class="sub-indicator">›</span>
      </button>

      <!-- 225 deg: Clear Measure -->
      <button
        type="button"
        class="radial-btn"
        :class="{ 'is-disabled': !hasPoints, 'is-hovered': hoverIndex === 5 }"
        style="--angle: 225deg;"
        title="清空所有测距点"
        @pointerdown.stop
        @click="hasPoints && handleAction('clear-measure')"
      >
        <span class="radial-btn-icon">🗑️</span>
        <span class="radial-btn-label">清空测距</span>
      </button>

      <!-- 270 deg: Copy Coords -->
      <button
        type="button"
        class="radial-btn"
        :class="{ 'is-hovered': hoverIndex === 6 }"
        style="--angle: 270deg;"
        title="复制世界坐标"
        @pointerdown.stop
        @click="handleAction('copy-coords')"
      >
        <span class="radial-btn-icon">📋</span>
        <span class="radial-btn-label">复制坐标</span>
      </button>

      <!-- 315 deg: Close Wheel -->
      <button
        type="button"
        class="radial-btn close-btn"
        :class="{ 'is-hovered': hoverIndex === 7 }"
        style="--angle: 315deg;"
        title="关闭轮盘"
        @pointerdown.stop
        @click="handleAction('close')"
      >
        <span class="radial-btn-icon">✕</span>
        <span class="radial-btn-label">关闭菜单</span>
      </button>
    </div>

    <!-- Sub Radial Ring: Layers Control Submenu (6 sectors: 0, 60, 120, 180, 240, 300) -->
    <div v-else class="radial-sector-group layer-subring">
      <button
        type="button"
        class="radial-btn back-btn"
        :class="{ 'is-hovered': hoverIndex === 0 }"
        style="--angle: 0deg;"
        title="返回主轮盘"
        @pointerdown.stop
        @click="showLayerRing = false"
      >
        <span class="radial-btn-icon">↩</span>
        <span class="radial-btn-label">返回主盘</span>
      </button>

      <!-- 60 deg: Alive Players -->
      <button
        type="button"
        class="radial-btn"
        :class="{ 'is-active': filterAliveOnly, 'is-hovered': hoverIndex === 1 }"
        style="--angle: 60deg;"
        @pointerdown.stop
        @click="handleAction('toggle-layer-alive')"
      >
        <span class="radial-btn-icon">👥</span>
        <span class="radial-btn-label">仅存活玩家</span>
        <span class="check-box" :class="{ checked: filterAliveOnly }"></span>
      </button>

      <!-- 120 deg: Player Names -->
      <button
        type="button"
        class="radial-btn"
        :class="{ 'is-active': showPlayerNames, 'is-hovered': hoverIndex === 2 }"
        style="--angle: 120deg;"
        @pointerdown.stop
        @click="handleAction('toggle-layer-names')"
      >
        <span class="radial-btn-icon">🏷️</span>
        <span class="radial-btn-label">玩家姓名</span>
        <span class="check-box" :class="{ checked: showPlayerNames }"></span>
      </button>

      <!-- 180 deg: Player Coords -->
      <button
        type="button"
        class="radial-btn"
        :class="{ 'is-active': showPlayerCoords, 'is-hovered': hoverIndex === 3 }"
        style="--angle: 180deg;"
        @pointerdown.stop
        @click="handleAction('toggle-layer-coords')"
      >
        <span class="radial-btn-icon">📍</span>
        <span class="radial-btn-label">玩家坐标</span>
        <span class="check-box" :class="{ checked: showPlayerCoords }"></span>
      </button>

      <!-- 240 deg: FOB Range -->
      <button
        type="button"
        class="radial-btn"
        :class="{ 'is-active': showFobs, 'is-hovered': hoverIndex === 4 }"
        style="--angle: 240deg;"
        @pointerdown.stop
        @click="handleAction('toggle-layer-fobs')"
      >
        <span class="radial-btn-icon">⛺</span>
        <span class="radial-btn-label">FOB 范围</span>
        <span class="check-box" :class="{ checked: showFobs }"></span>
      </button>

      <!-- 300 deg: Capture Zones -->
      <button
        type="button"
        class="radial-btn"
        :class="{ 'is-active': showCaptureZones, 'is-hovered': hoverIndex === 5 }"
        style="--angle: 300deg;"
        @pointerdown.stop
        @click="handleAction('toggle-layer-zones')"
      >
        <span class="radial-btn-icon">🏳️</span>
        <span class="radial-btn-label">点位旗帜</span>
        <span class="check-box" :class="{ checked: showCaptureZones }"></span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from "vue";

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
const showLayerRing = ref(false);
const hoverIndex = ref<number | null>(null);

const offsetLeft = ref(props.x);
const offsetTop = ref(props.y);
let dragMoved = false;

const menuStyle = computed(() => {
  return {
    left: `${offsetLeft.value}px`,
    top: `${offsetTop.value}px`,
  };
});

const measurePrimaryLabel = computed(() => props.measureActive ? "重新从此处测距" : "从此处开始测距");

// Main Ring Action Map (8 sectors)
const mainActions: Array<string | null> = [
  "measure",               // 0 deg (Top)
  "toggle-capture-edit",   // 45 deg (Top-Right)
  "calculate-hotspot",     // 90 deg (Right)
  "focus-here",            // 135 deg (Bottom-Right)
  "show-layer-ring",       // 180 deg (Bottom)
  "clear-measure",         // 225 deg (Bottom-Left)
  "copy-coords",           // 270 deg (Left)
  "close",                 // 315 deg (Top-Left)
];

// Layer Subring Action Map (6 sectors)
const subActions: Array<string | null> = [
  "back-main",            // 0 deg
  "toggle-layer-alive",   // 60 deg
  "toggle-layer-names",   // 120 deg
  "toggle-layer-coords",  // 180 deg
  "toggle-layer-fobs",    // 240 deg
  "toggle-layer-zones",   // 300 deg
];

function onWindowPointerMove(event: PointerEvent) {
  const dx = event.clientX - offsetLeft.value;
  const dy = event.clientY - offsetTop.value;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > 20) {
    dragMoved = true;
  }

  if (distance <= 30) {
    hoverIndex.value = -1; // Hovering center core
    return;
  }

  let angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
  if (angle < 0) angle += 360;

  if (!showLayerRing.value) {
    // 8 sectors (45 deg each)
    const idx = Math.floor((angle + 22.5) / 45) % 8;
    hoverIndex.value = idx;
  } else {
    // 6 sectors (60 deg each)
    const idx = Math.floor((angle + 30) / 60) % 6;
    hoverIndex.value = idx;
  }
}

function onWindowPointerUp(event: PointerEvent) {
  // If user dragged to a sector and released mouse button
  const dx = event.clientX - offsetLeft.value;
  const dy = event.clientY - offsetTop.value;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (dragMoved && distance > 30 && hoverIndex.value !== null && hoverIndex.value >= 0) {
    if (!showLayerRing.value) {
      const act = mainActions[hoverIndex.value];
      if (act === "measure") handleAction(props.measureActive ? "add-point" : "start-measure");
      else if (act === "toggle-capture-edit") handleAction("toggle-capture-point-edit");
      else if (act === "calculate-hotspot") handleAction("calculate-hotspot");
      else if (act === "show-layer-ring") {
        showLayerRing.value = true;
        return;
      }
      else if (act === "clear-measure") handleAction("clear-measure");
      else if (act === "focus-here") handleAction("focus-here");
      else if (act === "copy-coords") handleAction("copy-coords");
      else if (act === "close") handleAction("close");
    } else {
      const act = subActions[hoverIndex.value];
      if (act === "back-main") {
        showLayerRing.value = false;
        return;
      } else if (act) {
        handleAction(act as any);
      }
    }
  } else if (dragMoved && distance <= 30) {
    // Released in center core -> close
    emit("close");
  }
}

onMounted(() => {
  if (menuRef.value) {
    const parentRect = menuRef.value.parentElement?.getBoundingClientRect() || {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    const radius = 140;
    let left = props.x;
    let top = props.y;

    if (left - radius < 10) left = radius + 10;
    if (left + radius > parentRect.width - 10) left = parentRect.width - radius - 10;
    if (top - radius < 10) top = radius + 10;
    if (top + radius > parentRect.height - 10) top = parentRect.height - radius - 10;

    offsetLeft.value = left;
    offsetTop.value = top;
  }

  window.addEventListener("pointermove", onWindowPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onWindowPointerMove);
  window.removeEventListener("pointerup", onWindowPointerUp);
});

function handleAction(
  event:
    | "close"
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
/* Radial Context Menu Root */
.radial-context-menu {
  position: absolute;
  width: 280px;
  height: 280px;
  transform: translate(-50%, -50%);
  z-index: 1000;
  user-select: none;
  animation: radialPopIn 0.18s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

@keyframes radialPopIn {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.6) rotate(-15deg);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1) rotate(0deg);
  }
}

/* Background Ring Grid & Glassmorphism */
.radial-ring-background {
  position: absolute;
  inset: 20px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(15, 23, 42, 0.88) 0%, rgba(8, 12, 24, 0.95) 70%);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1.5px solid rgba(0, 229, 255, 0.35);
  box-shadow: 0 0 40px rgba(0, 0, 0, 0.85), inset 0 0 25px rgba(0, 229, 255, 0.15);
  pointer-events: none;
}

/* Center Core Hub */
.radial-center-core {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 82px;
  height: 82px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.95);
  border: 1.5px solid #00e5ff;
  box-shadow: 0 0 15px rgba(0, 229, 255, 0.4), inset 0 0 10px rgba(0, 229, 255, 0.2);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 10;
  transition: all 0.18s ease;
}

.radial-center-core.is-hovered,
.radial-center-core:hover {
  transform: translate(-50%, -50%) scale(1.06);
  background: #0f172a;
  border-color: #38bdf8;
  box-shadow: 0 0 22px rgba(56, 189, 248, 0.6);
}

.core-tag {
  font-size: 8px;
  color: rgba(0, 229, 255, 0.7);
  letter-spacing: 1px;
}

.core-coords {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 10px;
  font-weight: 800;
  color: #f8fafc;
  line-height: 1.2;
}

.core-sub {
  font-size: 8px;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 2px;
}

/* Sector Action Buttons */
.radial-sector-group {
  position: absolute;
  inset: 0;
}

.radial-btn {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 58px;
  height: 58px;
  margin-left: -29px;
  margin-top: -29px;
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #cbd5e1;
  transition: all 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
  transform: rotate(var(--angle)) translateY(-98px) rotate(calc(-1 * var(--angle)));
}

.radial-btn.is-hovered,
.radial-btn:hover:not(.is-disabled) {
  background: rgba(0, 229, 255, 0.25);
  border-color: #00e5ff;
  color: #ffffff;
  box-shadow: 0 0 20px rgba(0, 229, 255, 0.7);
  transform: rotate(var(--angle)) translateY(-106px) rotate(calc(-1 * var(--angle))) scale(1.18);
  z-index: 5;
}

.radial-btn.is-active {
  background: rgba(0, 229, 255, 0.25);
  border-color: #00e5ff;
  color: #ffffff;
}

.radial-btn.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.radial-btn-icon {
  font-size: 15px;
  line-height: 1;
}

.radial-btn-label {
  font-size: 8px;
  font-weight: 700;
  margin-top: 2px;
  white-space: nowrap;
  letter-spacing: 0.2px;
}

.active-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
}

.active-dot.active {
  background: #10b981;
  box-shadow: 0 0 6px #10b981;
}

.sub-indicator {
  position: absolute;
  bottom: 2px;
  font-size: 10px;
  color: #00e5ff;
  font-weight: bold;
}

.check-box {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 8px;
  height: 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 2px;
}

.check-box.checked {
  background: #00e5ff;
  border-color: #00e5ff;
  box-shadow: 0 0 6px #00e5ff;
}

.back-btn,
.close-btn {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.4);
  color: #f87171;
}

.back-btn.is-hovered,
.back-btn:hover,
.close-btn.is-hovered,
.close-btn:hover {
  background: rgba(239, 68, 68, 0.3) !important;
  border-color: #ef4444 !important;
  box-shadow: 0 0 18px rgba(239, 68, 68, 0.6) !important;
}
</style>
