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
        <span class="menu-label">撤销上一个测距点</span>
      </li>
      <li
        class="menu-item"
        :class="{ disabled: !hasPoints }"
        @click="hasPoints && handleAction('clear-measure')"
      >
        <span class="menu-icon">🗑️</span>
        <span class="menu-label">清空测距</span>
      </li>
      <li class="menu-item" @click="handleAction('copy-coords')">
        <span class="menu-icon">📋</span>
        <span class="menu-label">复制坐标</span>
      </li>
      <li class="menu-item" @click="handleAction('focus-here')">
        <span class="menu-icon">👁️</span>
        <span class="menu-label">聚焦此处</span>
      </li>

      <div class="menu-divider sub-divider"></div>

      <li class="menu-item disabled">
        <span class="menu-icon">🏳️</span>
        <span class="menu-label">创建标记 <span class="badge">Coming Soon</span></span>
      </li>
      <li class="menu-item disabled">
        <span class="menu-icon">🔭</span>
        <span class="menu-label">区域观察 <span class="badge">暂未支持</span></span>
      </li>
      <li class="menu-item disabled">
        <span class="menu-icon">🔥</span>
        <span class="menu-label">火力范围 <span class="badge">暂未支持</span></span>
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
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "start-measure"): void;
  (e: "add-point"): void;
  (e: "undo-point"): void;
  (e: "clear-measure"): void;
  (e: "copy-coords"): void;
  (e: "focus-here"): void;
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

function handleAction(event: "start-measure" | "add-point" | "undo-point" | "clear-measure" | "copy-coords" | "focus-here") {
  if (event === "start-measure") emit("start-measure");
  else if (event === "add-point") emit("add-point");
  else if (event === "undo-point") emit("undo-point");
  else if (event === "clear-measure") emit("clear-measure");
  else if (event === "copy-coords") emit("copy-coords");
  else if (event === "focus-here") emit("focus-here");
  emit("close");
}
</script>

<style scoped>
.map-floating-panel {
  background: rgba(8, 12, 24, 0.88);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(0, 229, 255, 0.25);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.7), 0 0 15px rgba(0, 229, 255, 0.1);
  border-radius: 4px;
}

.map-context-menu {
  position: absolute;
  width: 220px;
  z-index: 1000;
  padding: 6px 0;
  animation: contextMenuAppear 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
}

@keyframes contextMenuAppear {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(-4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.menu-header {
  padding: 8px 12px 6px;
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
  background: linear-gradient(90deg, rgba(0, 229, 255, 0.2) 0%, rgba(0, 229, 255, 0.05) 100%);
  margin: 6px 0;
}

.sub-divider {
  background: rgba(255, 255, 255, 0.08);
}

.menu-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.menu-item {
  padding: 8px 14px;
  font-size: 12px;
  color: #e2e8f0;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
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

.badge {
  font-size: 8px;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #94a3b8;
  margin-left: 4px;
}

.menu-item.disabled .badge {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.05);
}
</style>
