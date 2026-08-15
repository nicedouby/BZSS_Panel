<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open && props.team" class="drawer-root" @click="close">
        <aside class="team-detail-drawer" :style="panelStyle" @click.stop>
          <header class="drawer-header" :class="teamColorClass">
            <div class="drawer-header-content">
              <div class="drawer-header-title-row">
                <img v-if="factionFlagUrl" class="drawer-faction-flag" :src="factionFlagUrl" alt="" />
                <img v-if="unitIconUrl" class="drawer-unit-icon" :src="unitIconUrl" alt="" />
                <div>
                  <h2 class="drawer-team-title">
                    <span class="team-badge">TEAM {{ props.team.teamId }}</span>
                    <span class="team-name">{{ props.team.teamName }}</span>
                  </h2>
                </div>
              </div>

              <div class="drawer-header-badges">
                <StatusBadge tone="idle">
                  在线: {{ props.team.playerCount }} / {{ props.team.maxPlayers }}
                </StatusBadge>
                <StatusBadge :tone="props.team.ticketCount !== null && props.team.ticketCount < 50 ? 'warn' : 'ok'">
                  票数: {{ props.team.ticketCount ?? '--' }}
                </StatusBadge>
                <StatusBadge tone="idle">
                  小队数: {{ props.team.squads.length }}
                </StatusBadge>
              </div>
            </div>

            <button type="button" class="drawer-close-button" @click="close" title="关闭 (Esc)">
              ×
            </button>
          </header>

          <div class="drawer-body">
            <!-- 1. FACTION OVERVIEW -->
            <section class="detail-section info-card">
              <div class="detail-section-title">阵营概览 / FACTION OVERVIEW</div>
              <div class="stats-grid">
                <div class="stat-item">
                  <span class="stat-label">阵营名称</span>
                  <strong class="stat-value" :title="props.team.teamName">{{ props.team.teamName }}</strong>
                </div>
                <div class="stat-item">
                  <span class="stat-label">剩余票数</span>
                  <strong class="stat-value" :class="{ 'text-danger': props.team.ticketCount !== null && props.team.ticketCount <= 0 }">
                    {{ props.team.ticketCount ?? '--' }}
                  </strong>
                </div>
                <div class="stat-item">
                  <span class="stat-label">在线玩家</span>
                  <strong class="stat-value">{{ props.team.playerCount }} / {{ props.team.maxPlayers }}</strong>
                </div>
                <div class="stat-item">
                  <span class="stat-label">小队总数</span>
                  <strong class="stat-value">{{ props.team.squads.length }} 个</strong>
                </div>
                <div class="stat-item">
                  <span class="stat-label">全队均时</span>
                  <strong class="stat-value">{{ teamAveragePlaytimeText }}</strong>
                </div>
                <div class="stat-item">
                  <span class="stat-label">队长均时</span>
                  <strong class="stat-value">{{ teamLeaderAveragePlaytimeText }}</strong>
                </div>
                <div class="stat-item">
                  <span class="stat-label">Steam 公开</span>
                  <strong class="stat-value">{{ props.team.publicPlaytimePlayers }} 人</strong>
                </div>
                <div class="stat-item">
                  <span class="stat-label">Steam 私密</span>
                  <strong class="stat-value">{{ props.team.privatePlaytimePlayers }} 人</strong>
                </div>
              </div>
            </section>

            <!-- 2. FACTION ACTIONS -->
            <section class="detail-section action-center">
              <div class="detail-section-title">阵营指令 / FACTION COMMANDS</div>
              <div class="action-group">
                <div class="team-actions-grid">
                  <button type="button" class="action-button warn" @click="handleWarnTeam" :disabled="actionBusy">
                    <span class="action-btn-icon">⚠️</span>
                    <span>警告 TEAM {{ props.team.teamId }} 全员</span>
                  </button>

                  <button
                    v-if="canEditTickets"
                    type="button"
                    class="action-button default"
                    @click="handleEditTickets"
                    :disabled="actionBusy"
                  >
                    <span class="action-btn-icon">🎟️</span>
                    <span>修改票数</span>
                  </button>
                </div>
              </div>
            </section>

            <!-- 3. SQUADS LIST -->
            <section class="detail-section squads-section">
              <div class="detail-section-title">
                小队概览 / SQUADS ({{ props.team.squads.length }})
              </div>

              <div v-if="props.team.squads.length === 0" class="empty-squads-tip">
                当前阵营暂无小队
              </div>

              <div v-else class="squads-list">
                <div
                  v-for="squad in props.team.squads"
                  :key="squad.squadId ?? squad.squadName"
                  class="squad-card-item"
                  @click="handleSelectSquad(squad)"
                >
                  <div class="squad-info-head">
                    <span class="squad-name-title">
                      <span class="squad-nature-tag" :data-nature="squad.squadNature">
                        {{ squad.squadNatureLabel || '小队' }}
                      </span>
                      <strong>{{ squad.squadName }}</strong>
                    </span>

                    <div class="squad-badges">
                      <StatusBadge :tone="squad.isLocked ? 'warn' : 'ok'">
                        {{ squad.isLocked ? '已锁' : '未锁' }}
                      </StatusBadge>
                      <StatusBadge tone="idle">
                        {{ squad.memberCount }} / {{ squad.maxMembers }} 人
                      </StatusBadge>
                    </div>
                  </div>

                  <div class="squad-info-sub">
                    <span class="squad-leader-name">
                      队长: <strong>{{ squad.leader?.name || '无队长' }}</strong>
                    </span>
                    <span v-if="squad.averagePlaytimeHours !== null" class="squad-avg-time">
                      均时: {{ squad.averagePlaytimeHours }}h
                    </span>
                  </div>
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
import type { TeamViewModel, SquadViewModel } from "../../types/squad-admin.types";
import { useUiStore } from "../../stores/ui.store";
import { warnTarget } from "../../app/squadManagementApi";
import StatusBadge from "../common/StatusBadge.vue";
import { getFlagUrl, 获取战斗群旗帜, getUnitIconUrlByTeamName } from "../../shared/faction-assets/faction-data";

const props = defineProps<{
  team: TeamViewModel | null;
  open: boolean;
  canEditTickets?: boolean;
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "warn-team", teamId: number): void;
  (event: "edit-tickets", team: TeamViewModel): void;
  (event: "select-squad", squad: SquadViewModel): void;
}>();

const ui = useUiStore();
const actionBusy = ref(false);

const viewport = ref({
  width: typeof window !== "undefined" ? window.innerWidth : 1280,
  height: typeof window !== "undefined" ? window.innerHeight : 800,
});

const updateViewport = () => {
  viewport.value = {
    width: window.innerWidth,
    height: window.innerHeight,
  };
};

const panelStyle = computed(() => {
  const compactViewport = viewport.value.width < 920 || viewport.value.height < 760;
  if (compactViewport) {
    return {
      width: "calc(100vw - 24px)",
      maxHeight: "calc(var(--app-viewport-height) - 24px)",
    };
  }

  const panelWidth = Math.min(520, Math.max(400, Math.round(viewport.value.width * 0.36)));

  return {
    width: `${panelWidth}px`,
    maxHeight: `${Math.max(340, viewport.value.height - 48)}px`,
  };
});

const teamColorClass = computed(() => {
  if (!props.team) return "";
  return props.team.teamColorType === "team1" ? "team1-theme" : "team2-theme";
});

const factionFlagUrl = computed(() => {
  if (!props.team) return null;
  return getFlagUrl(props.team.factionCode ?? "") ?? 获取战斗群旗帜(props.team.teamName);
});

const unitIconUrl = computed(() => {
  if (!props.team) return null;
  return getUnitIconUrlByTeamName(props.team.teamName);
});

const teamAveragePlaytimeText = computed(() => {
  if (!props.team || props.team.averagePlaytimeHours === null) return "--";
  return `${props.team.averagePlaytimeHours} 小时`;
});

const teamLeaderAveragePlaytimeText = computed(() => {
  if (!props.team || props.team.leaderAveragePlaytimeHours === null) return "--";
  return `${props.team.leaderAveragePlaytimeHours} 小时`;
});

function close() {
  emit("close");
}

function handleEscape(e: KeyboardEvent) {
  if (e.key === "Escape" && props.open) {
    close();
  }
}

async function handleWarnTeam() {
  const team = props.team;
  if (!team || actionBusy.value) return;

  const targetScope = team.teamId === 2 ? "team2" : "team1";
  const label = `TEAM ${team.teamId} (${team.teamName})`;

  const message = await ui.openWarnPrompt({
    title: `AdminWarn ${label}`,
    targetName: label,
    defaultMessage: "请遵守服务器规则",
  });
  if (message === null || !message.trim()) return;

  actionBusy.value = true;
  try {
    const result = await warnTarget({
      targetScope,
      message: message.trim(),
      reason: "manual_team_warn",
      sourceModule: "web.teamDetailDrawer",
    });

    if (!result?.success) {
      throw new Error(result?.errorMessage || "RCON 指令发送失败");
    }

    ui.pushToast({ title: "警告已发送", message: `已向 ${label} 发送警告`, tone: "ok" });
    emit("warn-team", team.teamId);
  } catch (error: any) {
    ui.pushToast({ title: "警告发送失败", message: error?.message || String(error), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

function handleEditTickets() {
  if (props.team) {
    emit("edit-tickets", props.team);
  }
}

function handleSelectSquad(squad: SquadViewModel) {
  emit("select-squad", squad);
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
  background:
    radial-gradient(circle at 20% 18%, rgba(96, 165, 250, 0.14), transparent 28%),
    radial-gradient(circle at 80% 10%, rgba(34, 197, 94, 0.08), transparent 26%),
    rgba(8, 12, 16, 0.42);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.team-detail-drawer {
  position: relative;
  width: min(520px, calc(100vw - 24px));
  max-height: calc(var(--app-viewport-height) - 24px);
  overflow: hidden;
  border-radius: 22px;
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

.drawer-header {
  position: relative;
  padding: 20px 22px 16px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  border-bottom: 1px solid rgba(140, 160, 200, 0.18);
  background: rgba(15, 23, 42, 0.4);
}

.drawer-header.team1-theme {
  border-bottom-color: rgba(59, 130, 246, 0.35);
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(15, 23, 42, 0.4));
}

.drawer-header.team2-theme {
  border-bottom-color: rgba(249, 115, 22, 0.35);
  background: linear-gradient(135deg, rgba(249, 115, 22, 0.15), rgba(15, 23, 42, 0.4));
}

.drawer-header-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.drawer-header-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.drawer-faction-flag {
  height: 32px;
  width: auto;
  object-fit: contain;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.4));
}

.drawer-unit-icon {
  height: 28px;
  width: auto;
  object-fit: contain;
}

.drawer-team-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.3;
}

.team-badge {
  font-size: 12px;
  font-weight: 800;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.12);
  letter-spacing: 0.5px;
}

.team-name {
  color: var(--color-text-main, #f8fafc);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-header-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.drawer-close-button {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.drawer-close-button:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}

.drawer-body {
  padding: 18px 22px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-section {
  background: rgba(15, 23, 42, 0.45);
  border: 1px solid rgba(140, 160, 200, 0.14);
  border-radius: 14px;
  padding: 14px 16px;
}

.detail-section-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: 12px;
  text-transform: uppercase;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}

.stat-value {
  font-size: 14px;
  font-weight: 600;
  color: #f1f5f9;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.text-danger {
  color: #ef4444 !important;
}

.action-center {
  background: rgba(15, 23, 42, 0.55);
}

.team-actions-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.action-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 10px 16px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.action-button.warn {
  background: linear-gradient(135deg, rgba(234, 88, 12, 0.25), rgba(245, 158, 11, 0.2));
  border-color: rgba(245, 158, 11, 0.4);
  color: #fde047;
}

.action-button.warn:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(234, 88, 12, 0.35), rgba(245, 158, 11, 0.3));
  border-color: rgba(245, 158, 11, 0.6);
  box-shadow: 0 0 16px rgba(245, 158, 11, 0.2);
}

.action-button.default {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.15);
  color: #e2e8f0;
}

.action-button.default:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.25);
}

.action-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.squads-section {
  padding-bottom: 12px;
}

.empty-squads-tip {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
  padding: 16px 0;
}

.squads-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.squad-card-item {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.squad-card-item:hover {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(140, 160, 200, 0.3);
  transform: translateY(-1px);
}

.squad-info-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.squad-name-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #f8fafc;
}

.squad-nature-tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: #cbd5e1;
}

.squad-nature-tag[data-nature="vehicle"] {
  background: rgba(245, 158, 11, 0.2);
  color: #fef08a;
}

.squad-badges {
  display: flex;
  align-items: center;
  gap: 6px;
}

.squad-info-sub {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
}

.squad-leader-name strong {
  color: #e2e8f0;
}

/* Drawer transitions */
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.25s ease;
}

.drawer-enter-active .team-detail-drawer,
.drawer-leave-active .team-detail-drawer {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

.drawer-enter-from .team-detail-drawer {
  transform: scale(0.95) translateY(10px);
  opacity: 0;
}

.drawer-leave-to .team-detail-drawer {
  transform: scale(0.95) translateY(10px);
  opacity: 0;
}
</style>
