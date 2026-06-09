<template>
  <Teleport to="body">
    <Transition :name="transitionName" :appear="true">
      <div v-if="open && props.squad" :class="rootClass">
        <div class="drawer-backdrop" @click="close" />
        <aside
          :class="panelClass"
          :style="panelStyle"
          role="dialog"
          aria-modal="true"
          :aria-label="props.squad.squadName || 'Squad Detail'"
        >
          <header class="drawer-header" :class="teamColorClass">
            <div class="drawer-header-content">
              <h2 class="drawer-squad-name">{{ props.squad.squadName }}</h2>
              <div class="drawer-header-badges">
                <StatusBadge :tone="natureTone(props.squad.squadNature)">
                  {{ props.squad.squadNatureLabel }}
                </StatusBadge>
                <StatusBadge :tone="props.squad.isLocked ? 'warn' : 'ok'">
                  {{ props.squad.isLocked ? t("common.locked") : t("common.open") }}
                </StatusBadge>
                <StatusBadge tone="idle">Team {{ props.squad.teamId }}</StatusBadge>
                <StatusBadge tone="idle">{{ props.squad.memberCount }} / {{ props.squad.maxMembers }}</StatusBadge>
              </div>
            </div>
            <button type="button" class="drawer-close-button" @click="close" :title="`${t('common.close')} (Esc)`">
              x
            </button>
          </header>

          <div class="drawer-body">
            <!-- 1. SQUAD OVERVIEW -->
            <section class="detail-section info-card">
              <div class="detail-section-title">小队概览 / OVERVIEW</div>
              <div class="stats-grid">
                <div class="stat-item">
                  <span class="stat-label">创建者</span>
                  <strong class="stat-value">{{ props.squad.creatorName || "Unknown" }}</strong>
                </div>
                <div class="stat-item">
                  <span class="stat-label">创建时间</span>
                  <strong class="stat-value">{{ props.squad.createdDisplayText || props.squad.createdAtLabel || "-" }}</strong>
                </div>
                <div class="stat-item">
                  <span class="stat-label">平均时长</span>
                  <strong class="stat-value">{{ props.squad.averagePlaytimeHours ?? "--" }}h</strong>
                </div>
                <div class="stat-item">
                  <span class="stat-label">队长状态</span>
                  <strong class="stat-value" :class="{ 'text-danger': !props.squad.leader }">
                    {{ props.squad.leader ? props.squad.leader.name : "无队长" }}
                  </strong>
                </div>
              </div>
            </section>

            <!-- 2. SQUAD ACTIONS -->
            <section class="detail-section action-center">
              <div class="detail-section-title">{{ t("common.actions") }}</div>
              
              <div class="action-group">
                <div class="group-label">全队指令 / SQUAD COMMANDS</div>
                <div class="squad-actions-grid">
                  <button type="button" class="action-button warn" @click="handleWarnSquad" :disabled="actionBusy">
                    警告全队
                  </button>
                  <button type="button" class="action-button danger" @click="handleDisbandSquad" :disabled="actionBusy">
                    解散小队
                  </button>
                </div>
              </div>
            </section>

            <!-- 3. MEMBER LIST -->
            <section class="detail-section members-section">
              <div class="detail-section-title">成员列表 / MEMBERS ({{ props.squad.memberCount }})</div>
              <div class="member-list">
                <div v-if="props.squad.leader" class="member-item leader">
                  <span class="role-icon">⭐</span>
                  <span class="member-name">{{ props.squad.leader.name }}</span>
                  <span class="member-role">{{ props.squad.leader.role }}</span>
                </div>
                <div v-for="member in props.squad.members" :key="String(member.playerId)" class="member-item">
                  <span class="role-icon">👤</span>
                  <span class="member-name">{{ member.name }}</span>
                  <span class="member-role">{{ member.role }}</span>
                </div>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import type { SquadViewModel } from "../../types/squad-admin.types";
import { useUiStore } from "../../stores/ui.store";
import { warnPlayer, disbandSquad } from "../../app/squadManagementApi";
import StatusBadge from "../common/StatusBadge.vue";
import { t } from "../../i18n";

const props = withDefaults(
  defineProps<{
    squad: SquadViewModel | null;
    open: boolean;
    mode?: "drawer" | "floating";
  }>(),
  {
    squad: null,
    mode: "floating",
  }
);

const emit = defineEmits<{
  (event: "close"): void;
}>();

const ui = useUiStore();
const actionBusy = ref(false);
const viewport = ref({
  width: typeof window !== "undefined" ? window.innerWidth : 1280,
  height: typeof window !== "undefined" ? window.innerHeight : 800,
});
const isFloating = computed(() => props.mode === "floating");
const transitionName = computed(() => (isFloating.value ? "floating-squad" : "drawer"));
const rootClass = computed(() => (isFloating.value ? "floating-window-layer" : "drawer-root"));
const panelClass = computed(() => ({
  "squad-detail-drawer": !isFloating.value,
  "squad-detail-floating": isFloating.value,
}));

const panelStyle = computed(() => {
  if (!isFloating.value) return undefined;

  const compactViewport = viewport.value.width < 920 || viewport.value.height < 760;
  if (compactViewport) {
    return {
      left: "50%",
      top: "50%",
      width: "calc(100vw - 24px)",
      maxHeight: "calc(100vh - 24px)",
      transform: "translate(-50%, -50%)",
    };
  }

  const panelWidth = Math.min(480, Math.max(380, Math.round(viewport.value.width * 0.34)));

  return {
    left: "50%",
    top: "50%",
    width: `${panelWidth}px`,
    maxHeight: `${Math.max(320, viewport.value.height - 48)}px`,
    transform: "translate(-50%, -50%)",
  };
});

const updateViewport = () => {
  viewport.value = {
    width: window.innerWidth,
    height: window.innerHeight,
  };
};

const teamColorClass = computed(() => {
  if (!props.squad) return "";
  return props.squad.teamId === 1 ? "team1-theme" : "team2-theme";
});

function close() {
  emit("close");
}

function natureTone(nature: SquadViewModel["squadNature"]): "ok" | "warn" | "idle" {
  if (nature === "vehicle") return "warn";
  if (nature === "infantry" || nature === "support") return "ok";
  return "idle";
}

function handleEscape(e: KeyboardEvent) {
  if (e.key === "Escape" && props.open) {
    close();
  }
}

async function handleWarnSquad() {
  const squad = props.squad;
  if (!squad || actionBusy.value) return;
  const message = await ui.openWarnPrompt({
    title: "警告全队",
    targetName: `${squad.squadName} (全体成员)`,
    defaultMessage: "请遵守服务器规则",
  });
  if (message === null) return;
  if (actionBusy.value || !props.squad) return;

  actionBusy.value = true;
  try {
    const allPlayers = [];
    if (squad.leader) allPlayers.push(squad.leader);
    allPlayers.push(...squad.members);

    const promises = allPlayers.map(p => warnPlayer({
      targetName: p.name,
      targetSteamId: p.steamId ?? undefined,
      targetEosId: p.eosId ?? undefined,
      message: message.trim(),
      reason: "manual_squad_warn",
      sourceModule: "web.squadAdmin",
    }));

    const results = await Promise.all(promises);
    const successCount = results.filter(r => r.success).length;
    
    ui.pushToast({ 
      title: "警告已下达", 
      message: `已向 ${successCount}/${allPlayers.length} 名成员发送警告`, 
      tone: successCount > 0 ? "ok" : "error" 
    });
  } catch (e) {
    ui.pushToast({ title: "指令失败", message: String(e), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

async function handleDisbandSquad() {
  const squad = props.squad;
  if (!squad || actionBusy.value) return;
  if (squad.teamId == null || squad.squadId == null) {
    ui.pushToast({ title: "操作失败", message: "缺少 teamId 或 squadId，无法解散小队。", tone: "error" });
    return;
  }
  const confirmed = await ui.openConfirm({
    title: "确认解散小队？",
    message: `确定要强制解散 ${squad.squadName} 吗？`,
    tone: "error",
  });
  if (!confirmed) return;
  if (actionBusy.value) return;

  actionBusy.value = true;
  try {
    const res = await disbandSquad({
      teamId: squad.teamId,
      squadId: squad.squadId,
      reason: "manual_disband",
      source: "web.squadAdmin",
    });
    if (!res.ok) throw new Error(res.message || "解散执行失败");
    ui.pushToast({ title: "指令已送达", message: "小队解散请求已处理", tone: "ok" });
    close();
  } catch (e) {
    ui.pushToast({ title: "操作失败", message: String(e), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

onMounted(() => {
  window.addEventListener("resize", updateViewport);
  document.addEventListener("keydown", handleEscape);
});

onUnmounted(() => {
  window.removeEventListener("resize", updateViewport);
  document.removeEventListener("keydown", handleEscape);
});
</script>

<style scoped>
.drawer-root {
  position: fixed;
  inset: 0;
  z-index: var(--z-player-drawer);
}

.floating-window-layer {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-player-drawer) + 1);
}

.drawer-backdrop {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: transparent;
}

.floating-window-layer .drawer-backdrop {
  background:
    radial-gradient(circle at 20% 18%, rgba(96, 165, 250, 0.14), transparent 28%),
    radial-gradient(circle at 80% 10%, rgba(34, 197, 94, 0.08), transparent 26%),
    rgba(8, 12, 16, 0.65);
}

.squad-detail-drawer {
  position: absolute;
  top: 0;
  right: 0;
  height: 100dvh;
  width: 420px;
  z-index: 2;
  background: var(--color-bg-panel);
  border-left: 1px solid var(--color-border-default);
  display: grid;
  grid-template-rows: auto 1fr;
  box-shadow: var(--shadow-lg);
}

.squad-detail-floating {
  position: fixed;
  z-index: 2;
  width: min(480px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow: hidden;
  border-radius: 22px;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  background:
    linear-gradient(145deg, rgba(55, 200, 255, 0.06), rgba(168, 85, 247, 0.04)),
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.025)), rgba(255, 255, 255, 0.008)),
    var(--color-bg-panel);
  border: 1px solid rgba(140, 160, 200, 0.28);
  display: grid;
  grid-template-rows: auto 1fr;
  box-shadow:
    0 32px 80px rgba(0, 0, 0, 0.52),
    0 8px 24px rgba(0, 0, 0, 0.32),
    0 0 0 1px rgba(255, 255, 255, 0.03) inset;
  backdrop-filter: blur(28px) saturate(1.4);
}

/* Transition Animations */

/* Drawer Slide In */
.drawer-enter-active .squad-detail-drawer,
.drawer-leave-active .squad-detail-drawer {
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform;
}

.drawer-enter-from .squad-detail-drawer,
.drawer-leave-to .squad-detail-drawer {
  transform: translateX(100%);
}

/* Floating Window Fade/Scale/Slide */
.floating-squad-enter-active .drawer-backdrop,
.floating-squad-leave-active .drawer-backdrop {
  transition: opacity 0.24s cubic-bezier(0.16, 1, 0.3, 1);
}

.floating-squad-enter-from .drawer-backdrop,
.floating-squad-leave-to .drawer-backdrop {
  opacity: 0;
}

.floating-squad-enter-active .squad-detail-floating,
.floating-squad-leave-active .squad-detail-floating {
  transition: opacity 0.32s cubic-bezier(0.16, 1, 0.3, 1), transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform, opacity;
  backface-visibility: hidden;
  transform-style: preserve-3d;
}

.floating-squad-enter-from .squad-detail-floating,
.floating-squad-leave-to .squad-detail-floating {
  opacity: 0 !important;
  transform: translate(-50%, -46%) scale(0.96) !important;
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
  border-bottom: 1px solid var(--color-border-default);
  flex-shrink: 0;
  background: var(--color-bg-elevated);
}

.drawer-header.team1-theme {
  background: var(--color-bg-elevated);
  box-shadow: inset 0 3px 0 rgba(55, 200, 255, 0.7);
}

.drawer-header.team2-theme {
  background: var(--color-bg-elevated);
  box-shadow: inset 0 3px 0 rgba(255, 155, 69, 0.7);
}

.drawer-header-content {
  display: grid;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.drawer-squad-name {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: 800;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-header-badges {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.drawer-close-button {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-soft);
  color: var(--color-text-muted);
  width: 32px;
  height: 32px;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  font-size: 14px;
  transition: all 0.14s ease;
}

.drawer-close-button:hover {
  background: rgba(248, 113, 113, 0.12);
  border-color: rgba(248, 113, 113, 0.35);
  color: #fca5a5;
}

.drawer-body {
  padding: var(--spacing-lg);
  overflow-y: auto;
  display: grid;
  gap: var(--spacing-lg);
  overscroll-behavior: contain;
}

.drawer-body::-webkit-scrollbar {
  width: 5px;
}

.drawer-body::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.22);
}

.drawer-body::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.38);
}

.detail-section {
  display: grid;
  gap: var(--spacing-sm);
  padding: 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-soft);
  background: var(--color-bg-card);
}

.detail-section-title {
  font-size: var(--font-size-sm);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
  margin-bottom: 4px;
}

.info-card {
  background: var(--color-bg-card);
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 4px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.stat-value {
  font-size: 14px;
  color: var(--color-text-primary);
}

.text-danger {
  color: #ef4444;
}

/* ACTION CENTER */
.action-center {
  gap: 20px;
}

.action-group {
  display: grid;
  gap: 10px;
}

.group-label {
  font-size: 10px;
  font-weight: 800;
  color: var(--color-text-muted);
  opacity: 0.6;
}

.squad-actions-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-sm);
}

.action-button {
  width: 100%;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  border-radius: 6px;
  transition: all 0.2s;
  cursor: pointer;
}

.action-button.warn {
  border: 1px solid rgba(251, 191, 36, 0.3);
  color: #fef3c7;
  background: rgba(120, 53, 15, 0.2);
}

.action-button.danger {
  border: 1px solid rgba(248, 113, 113, 0.3);
  color: #fecaca;
  background: rgba(127, 29, 29, 0.2);
}

.action-button:hover:not(:disabled) {
  filter: brightness(1.2);
  transform: translateY(-1px);
}

.action-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* MEMBERS */
.member-list {
  display: grid;
  gap: 6px;
}

.member-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--color-bg-elevated);
  border-radius: 6px;
  font-size: 13px;
}

.member-item.leader {
  background: var(--color-bg-elevated);
  border: 1px solid rgba(96, 165, 250, 0.22);
}

.role-icon {
  font-size: 12px;
  opacity: 0.7;
}

.member-name {
  flex: 1;
  font-weight: 600;
  color: var(--color-text-primary);
}

.member-role {
  font-size: 11px;
  color: var(--color-text-muted);
}

@media (max-width: 900px), (max-height: 760px) {
  .squad-detail-drawer {
    width: 100vw;
  }

  .squad-detail-floating {
    width: calc(100vw - 24px);
    max-height: calc(100vh - 24px);
  }
}
</style>
