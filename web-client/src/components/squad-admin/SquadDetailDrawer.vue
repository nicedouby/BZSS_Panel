<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open && props.squad" class="drawer-root" @click.self="close">
        <aside class="squad-detail-drawer">
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

const props = defineProps<{
  squad: SquadViewModel | null;
  open: boolean;
}>();

const emit = defineEmits<{
  (event: "close"): void;
}>();

const ui = useUiStore();
const actionBusy = ref(false);

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
  document.addEventListener("keydown", handleEscape);
});

onUnmounted(() => {
  document.removeEventListener("keydown", handleEscape);
});
</script>

<style scoped>
.drawer-root {
  position: fixed;
  inset: 0;
  z-index: var(--z-player-drawer);
}

.squad-detail-drawer {
  position: absolute;
  top: 0;
  right: 0;
  height: 100dvh;
  width: 420px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0.008)),
    var(--color-bg-panel);
  border-left: 1px solid var(--color-border-default);
  display: grid;
  grid-template-rows: auto 1fr;
  box-shadow: var(--shadow-lg);
}

.drawer-enter-active,
.drawer-leave-active {
  transition: all 0.2s ease;
}

.drawer-enter-from {
  transform: translateX(100%);
}

.drawer-leave-to {
  transform: translateX(100%);
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
  border-bottom: 1px solid var(--color-border-default);
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.018);
}

.drawer-header.team1-theme {
  background: radial-gradient(circle at 0% 0%, rgba(55, 200, 255, 0.15), transparent 42%);
}

.drawer-header.team2-theme {
  background: radial-gradient(circle at 0% 0%, rgba(255, 155, 69, 0.15), transparent 42%);
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
  background: transparent;
  border: 1px solid var(--color-border-soft);
  color: var(--color-text-muted);
  width: 32px;
  height: 32px;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
}

.drawer-close-button:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.drawer-body {
  padding: var(--spacing-lg);
  overflow-y: auto;
  display: grid;
  gap: var(--spacing-lg);
}

.detail-section {
  display: grid;
  gap: var(--spacing-sm);
  padding: 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.015);
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
  background: rgba(0, 0, 0, 0.1);
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
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
  font-size: 13px;
}

.member-item.leader {
  background: rgba(96, 165, 250, 0.1);
  border: 1px solid rgba(96, 165, 250, 0.2);
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

@media (max-width: 640px) {
  .squad-detail-drawer {
    width: 100vw;
  }
}
</style>
