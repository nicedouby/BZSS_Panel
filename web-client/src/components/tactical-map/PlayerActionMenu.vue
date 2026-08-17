<template>
  <div
    ref="menuRef"
    class="player-action-radial map-floating-panel"
    :class="[`tone-${tone}`, { 'has-error': Boolean(killError) }]"
    :style="menuStyle"
    @click.stop
    @pointerdown.stop
    @pointerup.stop
    @pointercancel.stop
    @dblclick.stop
    @wheel.stop
    @contextmenu.prevent.stop
  >
    <div class="radial-ring-background"></div>

    <div
      class="radial-center-core font-mono"
      role="button"
      tabindex="0"
      title="点击关闭玩家命令盘"
      @click.stop="emit('close')"
      @keydown.enter.prevent.stop="emit('close')"
      @keydown.space.prevent.stop="emit('close')"
    >
      <div class="core-tag">PLAYER</div>
      <div class="core-player-name" :title="displayPlayerName">{{ displayPlayerName }}</div>
      <div class="core-player-id">{{ rconPlayerId ? `ID ${rconPlayerId}` : "NO RCON ID" }}</div>
      <div v-if="killPending" class="core-status">KILLING...</div>
      <div v-else-if="killError" class="core-status core-status-error" :title="killError">{{ killError }}</div>
      <div v-else class="core-sub-exit">点击退出 ✕</div>
    </div>

    <div class="radial-sector-group">
      <button
        type="button"
        class="radial-btn"
        style="--angle: 0deg;"
        title="聚焦到玩家"
        @click.stop="handleAction('focus')"
      >
        <span class="radial-btn-icon">👁</span>
        <span class="radial-btn-label">聚焦</span>
      </button>

      <button
        type="button"
        class="radial-btn"
        style="--angle: 45deg;"
        title="打开玩家资料"
        @click.stop="handleAction('open-profile')"
      >
        <span class="radial-btn-icon">👤</span>
        <span class="radial-btn-label">资料</span>
      </button>

      <button
        type="button"
        class="radial-btn"
        style="--angle: 90deg;"
        title="复制玩家坐标"
        @click.stop="handleAction('copy-coords')"
      >
        <span class="radial-btn-icon">📋</span>
        <span class="radial-btn-label">坐标</span>
      </button>

      <button
        type="button"
        class="radial-btn"
        style="--angle: 135deg;"
        title="从该玩家位置开始测距"
        @click.stop="handleAction('start-measure')"
      >
        <span class="radial-btn-icon">📏</span>
        <span class="radial-btn-label">测距</span>
      </button>

      <button
        type="button"
        class="radial-btn admin-action"
        :class="{ 'is-disabled': !canUseAdminAction }"
        style="--angle: 180deg;"
        :title="adminDisabledReason || '警告玩家'"
        @click.stop="handleAction('warn')"
      >
        <span class="radial-btn-icon">⚠</span>
        <span class="radial-btn-label">警告</span>
      </button>

      <button
        type="button"
        class="radial-btn danger-action"
        :class="{ 'is-disabled': !canKill || killPending }"
        style="--angle: 225deg;"
        :title="killButtonTitle"
        @click.stop="handleAction('kill')"
      >
        <span class="radial-btn-icon">☠</span>
        <span class="radial-btn-label">{{ killPending ? "执行中" : "击杀" }}</span>
      </button>

      <button
        type="button"
        class="radial-btn admin-action"
        :class="{ 'is-disabled': !canUseAdminAction }"
        style="--angle: 270deg;"
        :title="adminDisabledReason || '踢出玩家'"
        @click.stop="handleAction('kick')"
      >
        <span class="radial-btn-icon">✕</span>
        <span class="radial-btn-label">踢出</span>
      </button>

      <button
        type="button"
        class="radial-btn admin-action"
        :class="{ 'is-disabled': !canUseAdminAction }"
        style="--angle: 315deg;"
        :title="adminDisabledReason || '强制换队'"
        @click.stop="handleAction('force-team')"
      >
        <span class="radial-btn-icon">↔</span>
        <span class="radial-btn-label">换队</span>
      </button>
    </div>

    <div v-if="linkConfidence" class="radial-link-meta font-mono" :title="linkReason">
      {{ linkConfidenceText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { BzssCoreTrackedPlayerInfo } from "../../app/bzssCoreApi";
import { killPlayer } from "../../app/squadManagementApi";
import { isInputElement } from "../../utils/keyboard";

const props = defineProps<{
  player: BzssCoreTrackedPlayerInfo;
  x: number;
  y: number;
  tone: "friendly" | "enemy" | "neutral";
  canManage?: boolean;
  rconPlayer?: any;
  linkConfidence?: "exact" | "strong" | "weak" | "none";
  linkReason?: string;
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
const killPending = ref(false);
const killError = ref("");

const MENU_RADIUS = 140;
const MENU_EDGE_GAP = 10;

const menuStyle = computed(() => ({
  left: `${offsetLeft.value}px`,
  top: `${offsetTop.value}px`,
}));

const displayPlayerName = computed(() => {
  return String(
    props.player?.playerName
    || (props.player as any)?.identity?.name
    || (props.player as any)?.name
    || props.rconPlayer?.name
    || "Unknown Player",
  ).trim() || "Unknown Player";
});

const rconPlayerId = computed(() => normalizeListPlayersId(
  props.rconPlayer?.playerId
  ?? props.rconPlayer?.playerID,
));

const canUseAdminAction = computed(() => Boolean(props.canManage && props.rconPlayer));
const canKill = computed(() => Boolean(canUseAdminAction.value && rconPlayerId.value));
const adminDisabledReason = computed(() => {
  if (!props.rconPlayer) return "未关联到当前 ListPlayers 玩家";
  if (!props.canManage) return "当前账号没有管理权限";
  return "";
});
const killButtonTitle = computed(() => {
  if (!props.rconPlayer) return "未关联到当前 ListPlayers 玩家";
  if (!rconPlayerId.value) return "当前玩家没有 ListPlayers ID，禁止执行 Kill";
  if (!props.canManage) return "当前账号没有管理权限";
  if (killPending.value) return "正在执行 Kill:X";
  return `单击立即击杀 ${displayPlayerName.value} · Kill:${rconPlayerId.value}`;
});

const linkConfidenceText = computed(() => {
  const confidence = props.linkConfidence ?? "none";
  if (confidence === "exact") return "LINK EXACT";
  if (confidence === "strong") return "LINK STRONG";
  if (confidence === "weak") return "LINK WEAK";
  return "UNLINKED";
});

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
  if (isInputElement(event.target)) return;
  if (event.key === "Escape") emit("close");
}

function onViewportResize() {
  syncMenuPosition();
}

watch(
  () => [props.x, props.y, props.player] as const,
  () => {
    killError.value = "";
    nextTick(syncMenuPosition);
  },
);

onMounted(() => {
  nextTick(syncMenuPosition);
  window.addEventListener("keydown", onDocumentKeyDown);
  window.addEventListener("resize", onViewportResize);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onDocumentKeyDown);
  window.removeEventListener("resize", onViewportResize);
});

function handleAction(event: "open-profile" | "focus" | "copy-coords" | "start-measure" | "warn" | "kill" | "kick" | "force-team") {
  if (event === "kill") {
    if (canKill.value && !killPending.value) void executeKill();
    return;
  }

  if (event === "warn" || event === "kick" || event === "force-team") {
    if (!canUseAdminAction.value) return;
  }

  if (event === "open-profile") emit("open-profile");
  else if (event === "focus") emit("focus");
  else if (event === "copy-coords") emit("copy-coords");
  else if (event === "start-measure") emit("start-measure");
  else if (event === "warn") emit("warn");
  else if (event === "kick") emit("kick");
  else if (event === "force-team") emit("force-team");

  emit("close");
}

async function executeKill() {
  const targetPlayerId = rconPlayerId.value;
  if (!targetPlayerId || killPending.value) return;

  killPending.value = true;
  killError.value = "";

  try {
    const result = await killPlayer({
      targetPlayerId,
      targetName: String(props.rconPlayer?.name ?? displayPlayerName.value).trim(),
      targetSteamId: String(props.rconPlayer?.steamId ?? props.rconPlayer?.steamID ?? "").trim() || undefined,
      targetEosId: String(props.rconPlayer?.eosId ?? props.rconPlayer?.eosID ?? "").trim() || undefined,
      reason: "tactical_map_radial_kill",
      source: "web.tacticalMap.playerActionMenu",
      system: false,
    });

    if (!result?.success) {
      killError.value = formatKillError(result);
      return;
    }

    emit("close");
  } catch (error) {
    killError.value = compactError(error instanceof Error ? error.message : "Kill 请求失败");
  } finally {
    killPending.value = false;
  }
}

function normalizeListPlayersId(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? text : "";
}

function compactError(value: string) {
  const text = String(value ?? "").trim();
  if (!text) return "KILL FAILED";
  if (text === "MissingListPlayersPlayerId" || text === "missing_list_players_player_id") return "NO PLAYER ID";
  return text.length > 18 ? `${text.slice(0, 15)}...` : text;
}

function formatKillError(result: any): string {
  return compactError(String(
    result?.message
    ?? result?.error
    ?? result?.skipReason
    ?? "Kill failed",
  ));
}
</script>

<style scoped>
.player-action-radial {
  position: absolute;
  width: 280px;
  height: 280px;
  transform: translate(-50%, -50%);
  z-index: 1100;
  user-select: none;
  touch-action: none;
  animation: radialPopIn 0.18s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

@keyframes radialPopIn {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.62) rotate(-12deg);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1) rotate(0deg);
  }
}

.radial-ring-background {
  position: absolute;
  inset: 20px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(15, 23, 42, 0.88) 0%, rgba(8, 12, 24, 0.96) 70%);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1.5px solid rgba(0, 229, 255, 0.35);
  box-shadow: 0 0 40px rgba(0, 0, 0, 0.85), inset 0 0 25px rgba(0, 229, 255, 0.12);
  pointer-events: none;
}

.tone-friendly .radial-ring-background {
  border-color: rgba(55, 200, 255, 0.42);
}

.tone-enemy .radial-ring-background {
  border-color: rgba(255, 91, 110, 0.42);
}

.player-action-radial.has-error .radial-ring-background {
  box-shadow: 0 0 40px rgba(0, 0, 0, 0.85), inset 0 0 28px rgba(239, 68, 68, 0.22);
}

.radial-center-core {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 92px;
  height: 92px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.97);
  border: 1.5px solid #00e5ff;
  box-shadow: 0 0 15px rgba(0, 229, 255, 0.38), inset 0 0 10px rgba(0, 229, 255, 0.18);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 10;
  outline: none;
  padding: 7px;
  transition: all 0.18s ease;
}

.radial-center-core:hover,
.radial-center-core:focus-visible {
  transform: translate(-50%, -50%) scale(1.06);
  background: rgba(239, 68, 68, 0.18);
  border-color: #ef4444;
  box-shadow: 0 0 22px rgba(239, 68, 68, 0.5);
}

.core-tag {
  font-size: 8px;
  color: rgba(0, 229, 255, 0.72);
  letter-spacing: 1px;
}

.core-player-name {
  width: 76px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  font-size: 10px;
  font-weight: 800;
  color: #f8fafc;
  margin-top: 2px;
}

.core-player-id {
  margin-top: 2px;
  font-size: 8px;
  font-weight: 800;
  color: #94a3b8;
}

.core-sub-exit,
.core-status {
  margin-top: 3px;
  font-size: 7px;
  font-weight: 800;
  color: #f87171;
  max-width: 76px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.core-status:not(.core-status-error) {
  color: #fbbf24;
}

.core-status-error {
  color: #fb7185;
}

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
  background: rgba(15, 23, 42, 0.94);
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
  box-shadow: 0 0 20px rgba(0, 229, 255, 0.65);
  transform: rotate(var(--angle)) translateY(-106px) rotate(calc(-1 * var(--angle))) scale(1.16);
  z-index: 5;
}

.radial-btn.danger-action {
  color: #fecaca;
  border-color: rgba(239, 68, 68, 0.38);
}

.radial-btn.danger-action:hover:not(.is-disabled) {
  background: rgba(127, 29, 29, 0.88);
  border-color: #ef4444;
  color: #ffffff;
  box-shadow: 0 0 24px rgba(239, 68, 68, 0.78);
}

.radial-btn.is-disabled {
  opacity: 0.38;
  cursor: not-allowed;
  filter: grayscale(0.85);
}

.radial-btn-icon {
  font-size: 16px;
  line-height: 1;
}

.radial-btn-label {
  margin-top: 4px;
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
  white-space: nowrap;
}

.radial-link-meta {
  position: absolute;
  left: 50%;
  bottom: 1px;
  transform: translateX(-50%);
  font-size: 8px;
  letter-spacing: 0.8px;
  color: rgba(148, 163, 184, 0.75);
  pointer-events: none;
}
</style>