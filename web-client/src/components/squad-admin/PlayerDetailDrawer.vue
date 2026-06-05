<template>
  <Teleport to="body">
    <Transition :name="transitionName">
      <div v-if="open && props.player" :class="rootClass" @click.self="close">
        <aside
          :class="panelClass"
          :style="panelStyle"
          role="dialog"
          aria-modal="true"
          :aria-label="props.player.name || t('player.player')"
        >
          <header class="drawer-header">
            <div class="drawer-header-content">
              <h2 class="drawer-player-name">{{ props.player.name }}</h2>
              <div class="drawer-header-badges">
                <StatusBadge :tone="props.player.isOnline ? 'ok' : 'idle'">
                  {{ props.player.isOnline ? t("common.online") : t("common.offline") }}
                </StatusBadge>
                <StatusBadge v-if="props.player.isLeader" tone="ok">{{ t("match.squadLeader") }}</StatusBadge>
              </div>
            </div>
            <button type="button" class="drawer-close-button" @click="close" :title="`${t('common.close')} (Esc)`">
              x
            </button>
          </header>

          <div class="drawer-body">
            <div v-if="props.notice" class="detail-notice">
              {{ props.notice }}
            </div>

            <!-- 1. IDENTITY BLOCK -->
            <section class="detail-section identity-hero">
              <div class="identity-grid">
                <CopyableValue :label="t('player.steamId')" :value="props.player.steamId" :truncate="32" />
                <CopyableValue :label="t('player.eosId')" :value="props.player.eosId" :truncate="32" />
              </div>
              <div class="identity-ip-block">
                <CopyableValue
                  :label="t('player.ip')"
                  :value="displayIp"
                  :href="ipSearchUrl"
                  :empty-text="ipEmptyText"
                />
                <small class="identity-ip-hint">{{ ipSourceHint }}</small>
              </div>
            </section>

            <!-- 2. SESSION INFO GRID -->
            <section class="detail-section info-card">
              <div class="detail-section-title">{{ t("player.currentMatch") }}</div>
              <div class="stats-grid">
                <div class="stat-item">
                  <span class="stat-label">{{ t("player.role") }}</span>
                  <strong class="stat-value">{{ displayRole(props.player.role) }}</strong>
                </div>
                <div class="stat-item">
                  <span class="stat-label">{{ t("player.team") }}</span>
                  <strong class="stat-value" :class="teamColorClass">
                    Team {{ props.player.teamId ?? "?" }}
                  </strong>
                </div>
                <div class="stat-item">
                  <span class="stat-label">{{ t("player.squad") }}</span>
                  <strong class="stat-value">
                    <span v-if="props.player.squadId != null" class="player-squad-badge">#{{ props.player.squadId }}</span>
                    {{ props.player.squadId ? `Squad ${props.player.squadId}` : t("match.unassigned") }}
                  </strong>
                </div>
                <div class="stat-item">
                  <span class="stat-label">{{ t("player.playerId") }}</span>
                  <strong class="stat-value">#{{ props.player.playerId ?? "-" }}</strong>
                </div>
                <div v-if="props.player.playtimeHours" class="stat-item">
                  <span class="stat-label">{{ t("player.steamTime") }}</span>
                  <strong class="stat-value">{{ props.player.playtimeHours }}h</strong>
                </div>
                <div class="stat-item">
                  <span class="stat-label">{{ t("player.leader") }}</span>
                  <strong class="stat-value">{{ props.player.isLeader ? t("common.yes") : t("common.no") }}</strong>
                </div>
              </div>
            </section>

            <section class="detail-section combat-card">
              <div class="detail-section-title">{{ t("player.combatStats", "战绩") }}</div>
              <div class="combat-stats-grid">
                <div class="stat-item combat-stat combat-stat--downs">
                  <span class="stat-label">{{ t("combat.downs", "击倒") }}</span>
                  <strong class="stat-value combat-stat-value">{{ props.player.combatStats.downs }}</strong>
                </div>
                <div class="stat-item combat-stat combat-stat--kills">
                  <span class="stat-label">{{ t("combat.kills", "击杀") }}</span>
                  <strong class="stat-value combat-stat-value">{{ props.player.combatStats.kills }}</strong>
                </div>
                <div class="stat-item combat-stat combat-stat--deaths">
                  <span class="stat-label">{{ t("combat.death", "死亡") }}</span>
                  <strong class="stat-value combat-stat-value">{{ props.player.combatStats.deaths }}</strong>
                </div>
                <div class="stat-item combat-stat combat-stat--tk">
                  <span class="stat-label">{{ t("combat.teamKill", "TK") }}</span>
                  <strong class="stat-value combat-stat-value">{{ props.player.combatStats.tk }}</strong>
                </div>
                <div class="stat-item combat-stat combat-stat--revives">
                  <span class="stat-label">{{ t("combat.revive", "复苏") }}</span>
                  <strong class="stat-value combat-stat-value">{{ props.player.combatStats.revives }}</strong>
                </div>
              </div>
              <div class="combat-stats-label">{{ props.player.statsLabel }}</div>
            </section>

            <section class="detail-section combat-history-section">
              <button
                type="button"
                class="detail-section-title advanced-toggle"
                @click="showCombatTimeline = !showCombatTimeline"
              >
                {{ showCombatTimeline ? "▼" : "▶" }} 个人战斗记录
              </button>
              <div v-if="showCombatTimeline" class="combat-history-content">
                <PlayerCombatTimeline :player="props.player" :server-id="props.serverId" />
              </div>
            </section>

            <!-- 3. ACTION CONTROL CENTER -->
            <section class="detail-section action-center">
              <div class="detail-section-title">{{ t("common.actions") }}</div>
              
              <div class="action-group">
                <div class="group-label">管理指令 / COMMANDS</div>
                <div class="player-actions-grid">
                  <button type="button" class="action-button warn" @click="handleWarn" :disabled="actionBusy">
                    {{ t("player.warn") }}
                  </button>
                  <button type="button" class="action-button danger" @click="handleKick" :disabled="actionBusy">
                    {{ t("player.kick") }}
                  </button>
                  <button type="button" class="action-button danger" @click="handleRemove" :disabled="actionBusy">
                    {{ t("player.removeFromSquad") }}
                  </button>
                </div>
              </div>

              <div class="action-group">
                <div class="group-label">队伍调度 / TEAM BALANCE</div>
                <button type="button" class="action-button primary" @click="handleForceTeamChange" :disabled="actionBusy || !canSwitchTeam">
                  跳边
                </button>
              </div>

              <div class="action-group">
                <div class="group-label">数据与工具 / TOOLS</div>
                <button type="button" class="action-button primary" @click="openDatabase">
                  {{ t("player.openDatabase") }}
                </button>
                <div class="secondary-actions-row">
                  <button
                    type="button"
                    class="action-button secondary"
                    @click="copyValue(props.player.steamId, t('player.steamId'))"
                    :disabled="!props.player.steamId"
                  >
                    {{ t("player.copySteamId") }}
                  </button>
                  <button
                    type="button"
                    class="action-button secondary"
                    @click="copyValue(props.player.eosId, t('player.eosId'))"
                    :disabled="!props.player.eosId"
                  >
                    {{ t("player.copyEosId") }}
                  </button>
                </div>
                <button
                  type="button"
                  class="action-button secondary"
                  @click="copyValue(displayIp, t('player.ip'))"
                  :disabled="!displayIp"
                >
                  {{ t("player.copyIp") }}
                </button>
              </div>
            </section>

            <section class="detail-section advanced-section">
              <button type="button" class="detail-section-title advanced-toggle" @click="showAdvanced = !showAdvanced">
                {{ showAdvanced ? "▼" : "▶" }} {{ t("player.advanced") }}
              </button>
              <div v-if="showAdvanced" class="advanced-content">
                <div class="detail-rows">
                  <div class="detail-row">
                    <span class="detail-label">{{ t("common.source") }}</span>
                    <span class="detail-value">{{ props.player.source || t("common.unknown") }}</span>
                  </div>
                  <div v-if="props.player.controller" class="detail-row">
                    <span class="detail-label">{{ t("player.controller") }}</span>
                    <span class="detail-value ellipsis">{{ props.player.controller }}</span>
                  </div>
                </div>
                <pre v-if="rawDataText" class="raw-data"><code>{{ rawDataText }}</code></pre>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRouter } from "vue-router";
import type { PlayerDetailViewModel } from "../../types/squad-admin.types";
import { useUiStore } from "../../stores/ui.store";
import { copyTextWithToast } from "../../utils/clipboard";
import { goToPlayerDatabaseSearch } from "../../utils/player-database";
import { forceTeamChange } from "../../app/teamBalanceApi";
import { warnPlayer, kickPlayer, removePlayerFromSquad } from "../../app/squadManagementApi";
import StatusBadge from "../common/StatusBadge.vue";
import CopyableValue from "./CopyableValue.vue";
import PlayerCombatTimeline from "./PlayerCombatTimeline.vue";
import { useAuthStore } from "../../stores/auth.store";
import { t } from "../../i18n";

const props = withDefaults(
  defineProps<{
    player: PlayerDetailViewModel | null;
    open: boolean;
    serverId?: string | null;
    mode?: "drawer" | "floating";
    anchorX?: number | null;
    anchorY?: number | null;
    notice?: string | null;
  }>(),
  {
    player: null,
  },
);

const emit = defineEmits<{
  (event: "close"): void;
}>();

const ui = useUiStore();
const auth = useAuthStore();
const router = useRouter();
const viewport = ref({
  width: typeof window !== "undefined" ? window.innerWidth : 1280,
  height: typeof window !== "undefined" ? window.innerHeight : 800,
});
const isFloating = computed(() => props.mode === "floating");
const transitionName = computed(() => (isFloating.value ? "floating-player" : "drawer"));
const rootClass = computed(() => (isFloating.value ? "floating-window-layer" : "drawer-root"));
const panelClass = computed(() => ({
  "player-detail-drawer": !isFloating.value,
  "player-detail-floating": isFloating.value,
}));
const panelStyle = computed(() => {
  if (!isFloating.value) return undefined;

  const compactViewport = viewport.value.width < 920 || viewport.value.height < 760;
  if (compactViewport) {
    return {
      left: "12px",
      top: "12px",
      width: "calc(100vw - 24px)",
      maxHeight: "calc(100vh - 24px)",
      transform: "none",
    };
  }

  const panelWidth = Math.min(480, Math.max(380, Math.round(viewport.value.width * 0.34)));

  return {
    left: "12px",
    top: "12px",
    width: `${panelWidth}px`,
    maxHeight: `${Math.max(320, viewport.value.height - 48)}px`,
    transform: "none",
  };
});
const showAdvanced = ref(false);
const showCombatTimeline = ref(false);
const actionBusy = ref(false);
const canSwitchTeam = computed(() => Boolean(auth.user?.isSuperAdmin || auth.user?.permissions?.includes?.("squad.switch")));
const updateViewport = () => {
  viewport.value = {
    width: window.innerWidth,
    height: window.innerHeight,
  };
};

const currentIp = computed(() => String(props.player?.ip ?? "").trim());
const displayIp = computed(() => currentIp.value);
const ipSearchUrl = computed(() => buildIpSearchUrl(displayIp.value));
const ipEmptyText = computed(() => "--");
const ipSourceHint = computed(() => t("common.none"));

const teamColorClass = computed(() => {
  if (!props.player) return "neutral";
  if (props.player.teamId === 1) return "team1";
  if (props.player.teamId === 2) return "team2";
  return "neutral";
});
const rawDataText = computed(() => (showAdvanced.value ? safeStringify(props.player?.raw) : ""));

function close() {
  emit("close");
}

function handleEscape(e: KeyboardEvent) {
  if (e.key === "Escape" && props.open) {
    close();
  }
}

async function copyValue(value: string | null | undefined, label: string) {
  if (!value) return;
  await copyTextWithToast(value, ui, {
    label: `${label} ${t("common.copied")}`,
    successMessage: value,
  });
}

function buildIpSearchUrl(value: string | null | undefined) {
  const ip = String(value ?? "").trim();
  if (!ip) return "";
  return `https://www.baidu.com/s?wd=${encodeURIComponent(`IP查询 ${ip}`)}`;
}

function safeStringify(value: unknown) {
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function openDatabase() {
  if (!props.player) return;
  const searchKey = props.player.name || props.player.steamId || props.player.eosId || "";
  if (searchKey) {
    goToPlayerDatabaseSearch(router, searchKey);
  }
}

async function handleWarn() {
  const player = props.player;
  if (!player || actionBusy.value) return;
  const message = await ui.openWarnPrompt({
    title: "发送玩家警告",
    targetName: player.name,
    defaultMessage: "请遵守服务器规则",
  });
  if (message === null) return;
  if (actionBusy.value || !props.player) return;

  actionBusy.value = true;
  try {
    const res = await warnPlayer({
      targetName: player.name,
      targetSteamId: player.steamId ?? undefined,
      targetEosId: player.eosId ?? undefined,
      message: message.trim() || "Admin Warning",
      reason: "manual_warn",
      sourceModule: "web.squadAdmin",
    });
    if (!res.success) throw new Error(res.errorMessage || "警告发送失败");
    ui.pushToast({ title: "已发送警告", message: `玩家: ${player.name}`, tone: "ok" });
  } catch (e) {
    ui.pushToast({ title: "警告失败", message: String(e), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

async function handleKick() {
  const player = props.player;
  if (!player || actionBusy.value) return;

  const reason = window.prompt("请输入踢出原因", "")?.trim();
  if (!reason) {
    ui.pushToast({
      title: "踢出已取消",
      message: "请先填写踢出原因。",
      tone: "warn",
    });
    return;
  }

  const confirmed = await ui.openConfirm({
    title: "确认踢出玩家？",
    message: `确定要将玩家 ${player.name} 踢出服务器吗？\n原因：${reason}`,
    tone: "error",
  });
  if (!confirmed) return;
  if (actionBusy.value || !props.player) return;

  actionBusy.value = true;
  try {
    const res = await kickPlayer({
      playerId: player.playerId ?? undefined,
      anyId: player.steamId || player.eosId || player.name || String(player.playerId ?? ""),
      steamId: player.steamId ?? undefined,
      eosId: player.eosId ?? undefined,
      name: player.name,
      reason,
      source: "web.squadAdmin",
    });
    if (!res.ok) throw new Error(res.message || "踢出执行失败");
    ui.pushToast({ title: "指令已送达", message: "踢出玩家请求已处理", tone: "ok" });
  } catch (e) {
    ui.pushToast({ title: "踢出失败", message: String(e), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

async function handleRemove() {
  const player = props.player;
  if (!player || actionBusy.value) return;
  const confirmed = await ui.openConfirm({
    title: "确认移出小队？",
    message: `确定要将玩家 ${player.name} 移出所在小队吗？`,
    tone: "warn",
  });
  if (!confirmed) return;
  if (actionBusy.value || !props.player) return;

  actionBusy.value = true;
  try {
    const res = await removePlayerFromSquad({
      playerId: player.playerId ?? undefined,
      anyId: player.steamId || player.eosId || player.name || String(player.playerId ?? ""),
      steamId: player.steamId ?? undefined,
      eosId: player.eosId ?? undefined,
      name: player.name,
      reason: "manual_remove",
      source: "web.squadAdmin",
    });
    if (!res.ok) throw new Error(res.message || "移出执行失败");
    ui.pushToast({ title: "指令已送达", message: "玩家移出请求已处理", tone: "ok" });
  } catch (e) {
    ui.pushToast({ title: "移出失败", message: String(e), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

async function handleForceTeamChange() {
  if (!props.player || actionBusy.value || !canSwitchTeam.value) return;
  const confirmed = await ui.openConfirm({
    title: "确认跳边？",
    message: `将玩家 ${props.player.name} 执行跳边操作。`,
    tone: "warn",
  });
  if (!confirmed) return;

  actionBusy.value = true;
  try {
    const res = await forceTeamChange({
      steamId: props.player.steamId ?? undefined,
      playerName: props.player.name,
      source: "对局状态手动操作",
      reason: "manual_team_balance",
      operator: {
        id: auth.user?.id ?? auth.user?.username ?? "",
        name: auth.user?.username ?? "",
        username: auth.user?.username ?? "",
        role: auth.user?.role ?? "",
        isSuperAdmin: Boolean(auth.user?.isSuperAdmin),
        permissions: Array.isArray(auth.user?.permissions) ? auth.user.permissions : [],
      },
    });
    if (!res.ok) throw new Error(res.message || "跳边执行失败");
    ui.pushToast({ title: "指令已送达", message: `跳边请求已提交：${props.player.name}`, tone: "ok" });
  } catch (e) {
    ui.pushToast({ title: "跳边失败", message: String(e), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

function displayRole(role: string | null | undefined) {
  const raw = String(role ?? "").trim();
  if (!raw) return t("role.unknownRole");
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const keyMap: Record<string, string> = {
    squadleader: "role.squadLeader",
    medic: "role.medic",
    heavyantitank: "role.heavyAntiTank",
    lightantitank: "role.lightAntiTank",
    machinegunner: "role.machineGunner",
    automaticrifleman: "role.automaticRifleman",
    engineer: "role.engineer",
    sapper: "role.sapper",
    marksman: "role.marksman",
    sniper: "role.sniper",
    grenadier: "role.grenadier",
    crewman: "role.crewman",
    pilot: "role.pilot",
    rifleman: "role.rifleman",
  };
  const key = keyMap[normalized];
  return key ? t(key, raw) : raw;
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
  background:
    radial-gradient(circle at 20% 18%, rgba(96, 165, 250, 0.14), transparent 28%),
    radial-gradient(circle at 80% 10%, rgba(34, 197, 94, 0.08), transparent 26%),
    rgba(8, 12, 16, 0.42);
  backdrop-filter: blur(6px);
}

.player-detail-drawer {
  position: absolute;
  top: 0;
  right: 0;
  height: 100dvh;
  width: 420px;
  background: var(--color-bg-panel);
  border-left: 1px solid var(--color-border-default);
  display: grid;
  grid-template-rows: auto 1fr;
  box-shadow: var(--shadow-lg);
}

.player-detail-floating {
  position: fixed;
  width: min(480px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow: hidden;
  border-radius: 18px;
  left: 12px;
  top: 12px;
  right: auto;
  bottom: auto;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.01)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-panel);
  border: 1px solid var(--color-border-highlight);
  display: grid;
  grid-template-rows: auto 1fr;
  box-shadow:
    0 24px 72px rgba(0, 0, 0, 0.38),
    0 0 0 1px rgba(255, 255, 255, 0.02) inset;
  backdrop-filter: blur(18px);
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

.floating-player-enter-active,
.floating-player-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.floating-player-enter-from,
.floating-player-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
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

.drawer-header-content {
  display: grid;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.drawer-player-name {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: 700;
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
  overscroll-behavior: contain;
}

.detail-notice {
  border: 1px solid rgba(251, 191, 36, 0.28);
  background: rgba(251, 191, 36, 0.08);
  color: #f5d37a;
  border-radius: var(--radius-md);
  padding: 10px 12px;
  font-size: var(--font-size-sm);
  line-height: 1.5;
}

.detail-section {
  display: grid;
  gap: var(--spacing-sm);
  padding: 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-soft);
  background: var(--color-bg-card);
}

.drawer-body::-webkit-scrollbar {
  width: 10px;
}

.drawer-body::-webkit-scrollbar-thumb {
  border-radius: 999px;
  border: 2px solid transparent;
  background: rgba(148, 163, 184, 0.28);
  background-clip: content-box;
}

.drawer-body::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.42);
  background-clip: content-box;
}

/* 1. IDENTITY HERO */
.identity-hero {
  background: var(--color-bg-card);
  border-color: var(--color-border-default);
}

.identity-grid {
  display: grid;
  gap: var(--spacing-sm);
}

.identity-ip-block {
  margin-top: 4px;
  display: grid;
  gap: 4px;
}

.identity-ip-hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  padding-left: 2px;
}

/* 2. INFO CARD */
.info-card {
  background: var(--color-bg-card);
}

.stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 4px;
}

.combat-card {
  background: linear-gradient(180deg, rgba(96, 165, 250, 0.08), rgba(255, 255, 255, 0.03));
}

.combat-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
  gap: 12px;
}

.combat-stat {
  position: relative;
  overflow: hidden;
  padding: 12px 12px 11px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.45), rgba(15, 23, 42, 0.3));
}

.combat-stat::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  border-radius: 14px 0 0 14px;
  background: var(--combat-accent, rgba(148, 163, 184, 0.5));
}

.combat-stat--downs {
  --combat-accent: #60a5fa;
  border-color: rgba(96, 165, 250, 0.22);
  background: linear-gradient(180deg, rgba(96, 165, 250, 0.11), rgba(15, 23, 42, 0.32));
}

.combat-stat--kills {
  --combat-accent: #f472b6;
  border-color: rgba(244, 114, 182, 0.22);
  background: linear-gradient(180deg, rgba(244, 114, 182, 0.11), rgba(15, 23, 42, 0.32));
}

.combat-stat--deaths {
  --combat-accent: #f59e0b;
  border-color: rgba(245, 158, 11, 0.22);
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.11), rgba(15, 23, 42, 0.32));
}

.combat-stat--tk {
  --combat-accent: #fb7185;
  border-color: rgba(251, 113, 133, 0.24);
  background: linear-gradient(180deg, rgba(127, 29, 29, 0.36), rgba(15, 23, 42, 0.32));
}

.combat-stat--revives {
  --combat-accent: #34d399;
  border-color: rgba(52, 211, 153, 0.22);
  background: linear-gradient(180deg, rgba(52, 211, 153, 0.11), rgba(15, 23, 42, 0.32));
}

.combat-stats-label {
  margin-top: 4px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  line-height: 1.4;
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
  color: var(--combat-accent, var(--color-text-muted));
  opacity: 0.85;
  letter-spacing: 0.05em;
}

.stat-value {
  font-size: 14px;
  color: var(--combat-accent, var(--color-text-primary));
}

.combat-stat-value {
  font-variant-numeric: tabular-nums;
  font-weight: 800;
}

.stat-value.team1 { color: var(--color-team1-primary); }
.stat-value.team2 { color: var(--color-team2-primary); }

.player-squad-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 16px;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 900;
  color: #fff;
  background-color: var(--color-status-info);
  margin-right: 4px;
  vertical-align: middle;
}

/* 3. ACTION CENTER */
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
  margin-bottom: 2px;
}

.detail-section-title {
  font-size: var(--font-size-sm);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
  margin-bottom: 4px;
}

.advanced-toggle {
  background: transparent;
  border: 0;
  padding: 0;
  text-align: left;
  cursor: pointer;
}

.player-actions-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: var(--spacing-sm);
}

.secondary-actions-row {
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

.action-button.primary {
  background: var(--color-status-info);
  border: none;
  color: #fff;
}

.action-button.primary:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.action-button.secondary {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border-soft);
  color: var(--color-text-secondary);
}

.action-button.secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary);
}

.action-button.warn {
  border: 1px solid rgba(251, 191, 36, 0.3);
  color: #fef3c7;
  background: rgba(120, 53, 15, 0.2);
}

.action-button.warn:hover:not(:disabled) {
  background: rgba(146, 64, 14, 0.4);
  border-color: rgba(251, 191, 36, 0.5);
}

.action-button.danger {
  border: 1px solid rgba(248, 113, 113, 0.3);
  color: #fecaca;
  background: rgba(127, 29, 29, 0.2);
}

.action-button.danger:hover:not(:disabled) {
  background: rgba(153, 27, 27, 0.4);
  border-color: rgba(248, 113, 113, 0.5);
}

.action-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.detail-rows {
  display: grid;
  gap: var(--spacing-sm);
}

.detail-row {
  display: flex;
  justify-content: space-between;
  gap: var(--spacing-md);
}

.detail-label { color: var(--color-text-secondary); }
.detail-value { color: var(--color-text-primary); text-align: right; }

.raw-data {
  margin-top: 8px;
  padding: var(--spacing-md);
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.2);
  overflow: auto;
  font-size: 11px;
}

@media (max-width: 900px), (max-height: 760px) {
  .player-detail-drawer {
    width: 100vw;
  }

  .player-detail-floating {
    width: calc(100vw - 24px);
    max-height: calc(100vh - 24px);
  }
}
</style>
