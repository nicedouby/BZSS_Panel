<template>
  <div
    ref="menuRef"
    class="radial-context-menu"
    :class="{ 'has-selected-player': Boolean(selectedPlayer), 'has-kill-error': Boolean(killError) }"
    :style="menuStyle"
    @click.stop
    @pointerdown.stop
    @pointerup.stop
    @pointercancel.stop
    @dblclick.stop
    @wheel.stop
    @contextmenu.prevent.stop
  >
    <!-- Radial Outer Ring Glow -->
    <div class="radial-ring-background"></div>

    <!-- Center Core Hub: Click Center to Exit / Close -->
    <div
      class="radial-center-core font-mono"
      role="button"
      tabindex="0"
      title="点击关闭轮盘"
      @click.stop="handleAction('close')"
      @keydown.enter.prevent.stop="handleAction('close')"
      @keydown.space.prevent.stop="handleAction('close')"
    >
      <template v-if="selectedPlayer">
        <div class="core-tag">CURRENT SELECTED</div>
        <div class="core-selected-name" :title="selectedPlayer.label">{{ selectedPlayer.label }}</div>
        <div class="core-selected-id">
          {{ selectedListPlayersId ? `ID ${selectedListPlayersId}` : "NO LISTPLAYERS ID" }}
        </div>
        <div v-if="killPending" class="core-kill-status">KILLING...</div>
        <div v-else-if="killError" class="core-kill-status is-error" :title="killError">{{ compactKillError }}</div>
        <div v-else class="core-sub-exit">点击退出 ✕</div>
      </template>
      <template v-else>
        <div class="core-tag">COORDS</div>
        <div class="core-coords">
          <span class="gx">X: {{ Math.round(gameX) }}</span>
          <span class="gy">Y: {{ Math.round(gameY) }}</span>
        </div>
        <div class="core-sub-exit">点击退出 ✕</div>
      </template>
    </div>

    <!-- Main Radial Action Buttons (8 Sectors) -->
    <div v-if="!showLayerRing" class="radial-sector-group">
      <!-- 0 deg: Measure -->
      <button
        type="button"
        class="radial-btn"
        style="--angle: 0deg;"
        :title="measurePrimaryLabel"
        @click.stop="handleAction(measureActive ? 'add-point' : 'start-measure')"
      >
        <span class="radial-btn-icon">📏</span>
        <span class="radial-btn-label">{{ measureActive ? "添加点" : "开始测距" }}</span>
      </button>

      <!-- 45 deg: Point Edit Mode -->
      <button
        v-if="canEditCapturePoints"
        type="button"
        class="radial-btn"
        :class="{ 'is-active': capturePointEditMode, 'is-disabled': capturePointCommandPending }"
        style="--angle: 45deg;"
        title="开启/退出点位编辑模式"
        @click.stop="!capturePointCommandPending && handleAction('toggle-capture-point-edit')"
      >
        <span class="radial-btn-icon">⌖</span>
        <span class="radial-btn-label">改点模式</span>
        <span class="active-dot" :class="{ active: capturePointEditMode }"></span>
      </button>

      <!-- 90 deg: Hotspot -->
      <button
        type="button"
        class="radial-btn"
        :class="{ 'is-active': hasCombatHotspot }"
        style="--angle: 90deg;"
        title="计算/更新交战集中热点"
        @click.stop="handleAction('calculate-hotspot')"
      >
        <span class="radial-btn-icon">◎</span>
        <span class="radial-btn-label">交战热点</span>
        <span class="active-dot" :class="{ active: hasCombatHotspot }"></span>
      </button>

      <!-- 135 deg: Focus Here -->
      <button
        type="button"
        class="radial-btn"
        style="--angle: 135deg;"
        title="地图视角聚焦于此"
        @click.stop="handleAction('focus-here')"
      >
        <span class="radial-btn-icon">👁️</span>
        <span class="radial-btn-label">聚焦此处</span>
      </button>

      <!-- 180 deg: Layers Subring Trigger -->
      <button
        type="button"
        class="radial-btn"
        style="--angle: 180deg;"
        title="展开地图图层显示开关"
        @click.stop="showLayerRing = true"
      >
        <span class="radial-btn-icon">🛡️</span>
        <span class="radial-btn-label">图层控制</span>
        <span class="sub-indicator">›</span>
      </button>

      <!-- 225 deg: Clear Measure -->
      <button
        type="button"
        class="radial-btn"
        :class="{ 'is-disabled': !hasPoints }"
        style="--angle: 225deg;"
        title="清空所有测距点"
        @click.stop="hasPoints && handleAction('clear-measure')"
      >
        <span class="radial-btn-icon">🗑️</span>
        <span class="radial-btn-label">清空测距</span>
      </button>

      <!-- 270 deg: Copy Coords -->
      <button
        type="button"
        class="radial-btn"
        style="--angle: 270deg;"
        title="复制世界坐标"
        @click.stop="handleAction('copy-coords')"
      >
        <span class="radial-btn-icon">📋</span>
        <span class="radial-btn-label">复制坐标</span>
      </button>

      <!-- 315 deg: Current-selection action. Player selection replaces redundant close button with Kill. -->
      <button
        v-if="selectedPlayer"
        type="button"
        class="radial-btn kill-btn"
        :class="{ 'is-disabled': !canKillSelectedPlayer || killPending }"
        style="--angle: 315deg;"
        :title="killButtonTitle"
        @click.stop="canKillSelectedPlayer && !killPending && handleAction('kill-selected')"
      >
        <span class="radial-btn-icon">☠</span>
        <span class="radial-btn-label">{{ killPending ? "执行中" : "KILL" }}</span>
      </button>
      <button
        v-else
        type="button"
        class="radial-btn close-btn"
        style="--angle: 315deg;"
        title="关闭轮盘"
        @click.stop="handleAction('close')"
      >
        <span class="radial-btn-icon">✕</span>
        <span class="radial-btn-label">退出轮盘</span>
      </button>
    </div>

    <!-- Sub Radial Ring: Layers Control Submenu (6 sectors) -->
    <div v-else class="radial-sector-group layer-subring">
      <button
        type="button"
        class="radial-btn back-btn"
        style="--angle: 0deg;"
        title="返回主轮盘"
        @click.stop="showLayerRing = false"
      >
        <span class="radial-btn-icon">↩</span>
        <span class="radial-btn-label">返回主盘</span>
      </button>

      <!-- 60 deg: Alive Players -->
      <button
        type="button"
        class="radial-btn"
        :class="{ 'is-active': filterAliveOnly }"
        style="--angle: 60deg;"
        @click.stop="handleAction('toggle-layer-alive')"
      >
        <span class="radial-btn-icon">👥</span>
        <span class="radial-btn-label">仅存活玩家</span>
        <span class="check-box" :class="{ checked: filterAliveOnly }"></span>
      </button>

      <!-- 120 deg: Player Names -->
      <button
        type="button"
        class="radial-btn"
        :class="{ 'is-active': showPlayerNames }"
        style="--angle: 120deg;"
        @click.stop="handleAction('toggle-layer-names')"
      >
        <span class="radial-btn-icon">🏷️</span>
        <span class="radial-btn-label">玩家姓名</span>
        <span class="check-box" :class="{ checked: showPlayerNames }"></span>
      </button>

      <!-- 180 deg: Player Coords -->
      <button
        type="button"
        class="radial-btn"
        :class="{ 'is-active': showPlayerCoords }"
        style="--angle: 180deg;"
        @click.stop="handleAction('toggle-layer-coords')"
      >
        <span class="radial-btn-icon">📍</span>
        <span class="radial-btn-label">玩家坐标</span>
        <span class="check-box" :class="{ checked: showPlayerCoords }"></span>
      </button>

      <!-- 240 deg: FOB Range -->
      <button
        type="button"
        class="radial-btn"
        :class="{ 'is-active': showFobs }"
        style="--angle: 240deg;"
        @click.stop="handleAction('toggle-layer-fobs')"
      >
        <span class="radial-btn-icon">⛺</span>
        <span class="radial-btn-label">FOB 范围</span>
        <span class="check-box" :class="{ checked: showFobs }"></span>
      </button>

      <!-- 300 deg: Capture Zones -->
      <button
        type="button"
        class="radial-btn"
        :class="{ 'is-active': showCaptureZones }"
        style="--angle: 300deg;"
        @click.stop="handleAction('toggle-layer-zones')"
      >
        <span class="radial-btn-icon">🏳️</span>
        <span class="radial-btn-label">点位旗帜</span>
        <span class="check-box" :class="{ checked: showCaptureZones }"></span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { executeBzssCoreCommand } from "../../app/bzssCoreApi";
import { useAuthStore } from "../../stores/auth.store";
import {
  type TacticalMapCurrentSelection,
  useTacticalMapCurrentSelection,
} from "../../composables/tacticalMapSelection";

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

  // Current selected tactical object. TacticalMapPage can pass this explicitly;
  // the shared selection state remains the compatibility/default source.
  currentSelected?: TacticalMapCurrentSelection;

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

const authStore = useAuthStore();
const sharedSelection = useTacticalMapCurrentSelection();
const menuRef = ref<HTMLElement | null>(null);
const showLayerRing = ref(false);
const killPending = ref(false);
const killError = ref("");

const offsetLeft = ref(props.x);
const offsetTop = ref(props.y);

const MENU_RADIUS = 140;
const MENU_EDGE_GAP = 10;

const effectiveCurrentSelected = computed<TacticalMapCurrentSelection>(() => (
  props.currentSelected !== undefined
    ? props.currentSelected
    : sharedSelection.currentSelected.value
));
const selectedPlayer = computed(() => (
  effectiveCurrentSelected.value?.type === "player" ? effectiveCurrentSelected.value : null
));
const selectedListPlayersId = computed(() => {
  const text = String(selectedPlayer.value?.listPlayersId ?? "").trim();
  return /^\d+$/.test(text) ? text : "";
});
const hasBzssCorePermission = computed(() => Boolean(
  authStore.user?.isSuperAdmin || authStore.user?.permissions?.includes("bzss_core.use"),
));
const canKillSelectedPlayer = computed(() => Boolean(
  selectedPlayer.value && selectedListPlayersId.value && hasBzssCorePermission.value,
));
const killButtonTitle = computed(() => {
  if (!selectedPlayer.value) return "当前未选中玩家";
  if (!selectedListPlayersId.value) return `${selectedPlayer.value.label} 没有 ListPlayers ID，禁止执行 Kill`;
  if (!hasBzssCorePermission.value) return "缺少 bzss_core.use 权限";
  if (killPending.value) return `正在执行 Kill:${selectedListPlayersId.value}`;
  return `Kill:${selectedListPlayersId.value} · ${selectedPlayer.value.label}`;
});
const compactKillError = computed(() => {
  const text = String(killError.value ?? "").trim();
  if (!text) return "KILL FAILED";
  return text.length > 18 ? `${text.slice(0, 15)}...` : text;
});

const menuStyle = computed(() => {
  return {
    left: `${offsetLeft.value}px`,
    top: `${offsetTop.value}px`,
  };
});

const measurePrimaryLabel = computed(() => props.measureActive ? "重新从此处测距" : "从此处开始测距");

function clampMenuAxis(value: number, availableSize: number) {
  const minimum = MENU_RADIUS + MENU_EDGE_GAP;
  const maximum = availableSize - MENU_RADIUS - MENU_EDGE_GAP;
  if (maximum < minimum) return Math.max(0, availableSize / 2);
  return Math.max(minimum, Math.min(maximum, value));
}

function syncMenuPosition() {
  const menu = menuRef.value;
  if (!menu) return;

  const parentRect = menu.parentElement?.getBoundingClientRect();
  const width = parentRect?.width || window.innerWidth;
  const height = parentRect?.height || window.innerHeight;

  offsetLeft.value = clampMenuAxis(props.x, width);
  offsetTop.value = clampMenuAxis(props.y, height);
}

function onDocumentKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;

  if (showLayerRing.value) {
    showLayerRing.value = false;
    return;
  }

  emit("close");
}

function onViewportResize() {
  syncMenuPosition();
}

watch(
  () => [props.x, props.y, props.gameX, props.gameY] as const,
  () => {
    // A second right-click reuses this component instance. Reset the wheel and
    // recalculate its clamped screen position instead of leaving it at the old point.
    showLayerRing.value = false;
    killError.value = "";
    nextTick(syncMenuPosition);
  },
);

watch(effectiveCurrentSelected, () => {
  killError.value = "";
});

onMounted(() => {
  nextTick(syncMenuPosition);
  window.addEventListener("keydown", onDocumentKeyDown);
  window.addEventListener("resize", onViewportResize);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onDocumentKeyDown);
  window.removeEventListener("resize", onViewportResize);
});

async function executeSelectedPlayerKill() {
  const target = selectedPlayer.value;
  const playerId = selectedListPlayersId.value;
  if (!target || !playerId || !hasBzssCorePermission.value || killPending.value) return;

  killPending.value = true;
  killError.value = "";
  try {
    const result = await executeBzssCoreCommand({
      directive: "Kill",
      parameter: playerId,
    });
    if (!result?.ok) {
      throw new Error(String(result?.message ?? `Kill:${playerId} 执行失败`));
    }
    emit("close");
  } catch (error) {
    killError.value = error instanceof Error ? error.message : String(error ?? "Kill 执行失败");
  } finally {
    killPending.value = false;
  }
}

function handleAction(
  event:
    | "close"
    | "start-measure"
    | "add-point"
    | "undo-point"
    | "clear-measure"
    | "copy-coords"
    | "focus-here"
    | "kill-selected"
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
  let keepOpen = false;

  if (event === "kill-selected") {
    void executeSelectedPlayerKill();
    return;
  }
  if (event === "start-measure") emit("start-measure");
  else if (event === "add-point") emit("add-point");
  else if (event === "undo-point") emit("undo-point");
  else if (event === "clear-measure") emit("clear-measure");
  else if (event === "copy-coords") emit("copy-coords");
  else if (event === "focus-here") emit("focus-here");
  else if (event === "toggle-capture-point-edit") emit("toggle-capture-point-edit");
  else if (event === "calculate-hotspot") emit("calculate-hotspot");
  else if (event === "clear-hotspot") emit("clear-hotspot");
  else if (event === "toggle-layer-alive") {
    emit("toggle-layer", "alive");
    keepOpen = true;
  } else if (event === "toggle-layer-names") {
    emit("toggle-layer", "names");
    keepOpen = true;
  } else if (event === "toggle-layer-coords") {
    emit("toggle-layer", "coords");
    keepOpen = true;
  } else if (event === "toggle-layer-fobs") {
    emit("toggle-layer", "fobs");
    keepOpen = true;
  } else if (event === "toggle-layer-zones") {
    emit("toggle-layer", "zones");
    keepOpen = true;
  } else if (event === "toggle-layer-grid") {
    emit("toggle-layer", "grid");
    keepOpen = true;
  }

  if (!keepOpen) emit("close");
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
  touch-action: none;
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

.radial-context-menu.has-selected-player .radial-ring-background {
  border-color: rgba(248, 113, 113, 0.42);
}

.radial-context-menu.has-kill-error .radial-ring-background {
  box-shadow: 0 0 40px rgba(0, 0, 0, 0.85), inset 0 0 28px rgba(239, 68, 68, 0.22);
}

/* Center Core Hub: Hover to Glow, Click to Exit */
.radial-center-core {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 92px;
  height: 92px;
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
  outline: none;
  padding: 6px;
  box-sizing: border-box;
}

.radial-center-core:hover,
.radial-center-core:focus-visible {
  transform: translate(-50%, -50%) scale(1.08);
  background: rgba(239, 68, 68, 0.2);
  border-color: #ef4444;
  box-shadow: 0 0 22px rgba(239, 68, 68, 0.6);
}

.core-tag {
  font-size: 7px;
  color: rgba(0, 229, 255, 0.7);
  letter-spacing: 0.7px;
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

.core-selected-name {
  width: 76px;
  margin-top: 2px;
  overflow: hidden;
  color: #f8fafc;
  font-size: 9px;
  font-weight: 800;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.core-selected-id {
  width: 78px;
  margin-top: 2px;
  overflow: hidden;
  color: #94a3b8;
  font-size: 7px;
  font-weight: 800;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.core-kill-status {
  width: 76px;
  margin-top: 2px;
  overflow: hidden;
  color: #fbbf24;
  font-size: 7px;
  font-weight: 800;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.core-kill-status.is-error {
  color: #fb7185;
}

.core-sub-exit {
  font-size: 8px;
  color: #f87171;
  font-weight: 700;
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

.radial-btn:hover:not(.is-disabled) {
  background: rgba(0, 229, 255, 0.25);
  border-color: #00e5ff;
  color: #ffffff;
  box-shadow: 0 0 20px rgba(0, 229, 255, 0.7);
  transform: rotate(var(--angle)) translateY(-106px) rotate(calc(-1 * var(--angle))) scale(1.18);
  z-index: 5;
}

.radial-btn.kill-btn {
  background: rgba(69, 10, 10, 0.9);
  border-color: rgba(248, 113, 113, 0.58);
  color: #fecaca;
}

.radial-btn.kill-btn:hover:not(.is-disabled) {
  background: rgba(127, 29, 29, 0.94);
  border-color: #ef4444;
  color: #ffffff;
  box-shadow: 0 0 24px rgba(239, 68, 68, 0.78);
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

.back-btn:hover,
.close-btn:hover {
  background: rgba(239, 68, 68, 0.3) !important;
  border-color: #ef4444 !important;
  box-shadow: 0 0 18px rgba(239, 68, 68, 0.6) !important;
}
</style>