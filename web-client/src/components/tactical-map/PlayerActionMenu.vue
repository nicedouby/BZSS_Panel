<template>
  <div
    ref="menuRef"
    class="player-action-menu map-floating-panel"
    :class="`tone-${tone}`"
    :style="menuStyle"
    @click.stop
    @contextmenu.prevent.stop
  >
    <div class="menu-header font-mono">
      <div class="header-title">PLAYER COMMANDS</div>
      <div class="player-label">{{ player.playerName || 'Unknown Player' }}</div>
    </div>

    <div class="menu-divider"></div>

    <ul class="menu-list">
      <li class="menu-item" @click="handleAction('open-profile')">
        <span class="menu-icon">👤</span>
        <span class="menu-label">打开个人资料</span>
      </li>
      <li class="menu-item" @click="handleAction('focus')">
        <span class="menu-icon">👁️</span>
        <span class="menu-label">聚焦到玩家</span>
      </li>
      <li class="menu-item" @click="handleAction('copy-coords')">
        <span class="menu-icon">📋</span>
        <span class="menu-label">复制坐标</span>
      </li>
      <li class="menu-item" @click="handleAction('start-measure')">
        <span class="menu-icon">📏</span>
        <span class="menu-label">从这里开始测距</span>
      </li>

      <div class="menu-divider sub-divider"></div>

      <li class="menu-item disabled">
        <span class="menu-icon">⚙️</span>
        <span class="menu-label">查看 Core 信息 <span class="badge">Coming Soon</span></span>
      </li>
      <li
        class="menu-item"
        :class="{ disabled: !canManage || !rconPlayer }"
        @click="handleAction('warn')"
      >
        <span class="menu-icon">⚠️</span>
        <span class="menu-label">
          警告玩家 (Warn)
          <span v-if="!rconPlayer" class="badge">未关联对局</span>
          <span v-else-if="!canManage" class="badge">无权限</span>
        </span>
      </li>
      <li
        class="menu-item"
        :class="{ disabled: !canManage || !rconPlayer }"
        @click="handleAction('kick')"
      >
        <span class="menu-icon">❌</span>
        <span class="menu-label">
          踢出玩家 (Kick)
          <span v-if="!rconPlayer" class="badge">未关联对局</span>
          <span v-else-if="!canManage" class="badge">无权限</span>
        </span>
      </li>
      <li
        class="menu-item"
        :class="{ disabled: !canManage || !rconPlayer }"
        @click="handleAction('force-team')"
      >
        <span class="menu-icon">🔁</span>
        <span class="menu-label">
          强制换队
          <span v-if="!rconPlayer" class="badge">未关联对局</span>
          <span v-else-if="!canManage" class="badge">无权限</span>
        </span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import type { BzssCoreTrackedPlayerInfo } from "../../app/bzssCoreApi";

const props = defineProps<{
  player: BzssCoreTrackedPlayerInfo;
  x: number;
  y: number;
  tone: "friendly" | "enemy" | "neutral";
  canManage?: boolean;
  rconPlayer?: any;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "open-profile"): void;
  (e: "focus"): void;
  (e: "copy-coords"): void;
  (e: "start-measure"): void;
  (e: "warn"): void;
  (e: "kick"): void;
  (e: "force-team"): void;
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

function handleAction(event: "open-profile" | "focus" | "copy-coords" | "start-measure" | "warn" | "kick" | "force-team") {
  if (event === "open-profile") emit("open-profile");
  else if (event === "focus") emit("focus");
  else if (event === "copy-coords") emit("copy-coords");
  else if (event === "start-measure") emit("start-measure");
  else if (event === "warn" && props.canManage && props.rconPlayer) emit("warn");
  else if (event === "kick" && props.canManage && props.rconPlayer) emit("kick");
  else if (event === "force-team" && props.canManage && props.rconPlayer) emit("force-team");
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

.player-action-menu {
  position: absolute;
  width: 220px;
  z-index: 1000;
  padding: 6px 0;
  animation: actionMenuAppear 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
}

@keyframes actionMenuAppear {
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

.player-label {
  font-size: 13px;
  color: #ffffff;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

/* Tone styling overrides */
.tone-friendly {
  border-color: rgba(55, 200, 255, 0.35);
}

.tone-friendly .menu-item:hover:not(.disabled)::before {
  background: #37c8ff;
  box-shadow: 0 0 8px #37c8ff;
}

.tone-friendly .menu-item:hover:not(.disabled) {
  background: rgba(55, 200, 255, 0.12);
}

.tone-friendly .header-title {
  color: rgba(55, 200, 255, 0.7);
}

.tone-enemy {
  border-color: rgba(255, 91, 110, 0.35);
}

.tone-enemy .menu-item:hover:not(.disabled)::before {
  background: #ff5b6e;
  box-shadow: 0 0 8px #ff5b6e;
}

.tone-enemy .menu-item:hover:not(.disabled) {
  background: rgba(255, 91, 110, 0.12);
}

.tone-enemy .header-title {
  color: rgba(255, 91, 110, 0.7);
}
</style>
