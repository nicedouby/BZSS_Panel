<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open && props.player" class="drawer-root" @click.self="close">
        <aside class="player-detail-drawer">
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
                <small class="identity-ip-hint">{{ resolveIpError || ipSourceHint }}</small>
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
                <button type="button" class="action-button primary" @click="handleSwitchTeam" :disabled="actionBusy || !canSwitchTeam">
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

            <PlayerCombatTimeline :player="props.player" :server-id="props.serverId" />

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
                <pre v-if="props.player.raw" class="raw-data"><code>{{ JSON.stringify(props.player.raw, null, 2) }}</code></pre>
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
import { resolvePlayerIdentityIp } from "../../app/playerIdentityApi";
import { requestSwitchTeam } from "../../app/teamBalanceApi";
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
const showAdvanced = ref(false);
const resolvedLastIp = ref("");
const resolvingIp = ref(false);
const resolveIpError = ref("");
const lookupToken = ref(0);
const actionBusy = ref(false);
const canSwitchTeam = computed(() => Boolean(auth.user?.isSuperAdmin || auth.user?.permissions?.includes?.("squad.switch")));

const currentIp = computed(() => String(props.player?.ip ?? "").trim());
const displayIp = computed(() => currentIp.value || resolvedLastIp.value.trim());
const ipSearchUrl = computed(() => buildIpSearchUrl(displayIp.value));
const ipEmptyText = computed(() => (resolvingIp.value ? t("common.resolving") : "--"));
const ipSourceHint = computed(() => {
  if (currentIp.value) return t("common.current");
  if (resolvingIp.value) return t("common.resolving");
  if (resolvedLastIp.value.trim()) return t("common.lastKnown");
  return t("common.none");
});

const teamColorClass = computed(() => {
  if (!props.player) return "neutral";
  if (props.player.teamId === 1) return "team1";
  if (props.player.teamId === 2) return "team2";
  return "neutral";
});

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
  const confirmed = await ui.openConfirm({
    title: "确认踢出玩家？",
    message: `确定要将玩家 ${player.name} 踢出服务器吗？`,
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
      reason: "manual_kick",
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

async function handleSwitchTeam() {
  if (!props.player || actionBusy.value || !canSwitchTeam.value) return;
  const confirmed = await ui.openConfirm({
    title: "确认跳边？",
    message: `将玩家 ${props.player.name} 执行跳边操作。`,
    tone: "warn",
  });
  if (!confirmed) return;

  actionBusy.value = true;
  try {
    const res = await requestSwitchTeam({
      anyId: props.player.steamId || props.player.eosId || props.player.name || "",
      playerId: props.player.playerId ?? null,
      steamId: props.player.steamId ?? undefined,
      eosId: props.player.eosId ?? undefined,
      name: props.player.name,
      source: "对局状态手动操作",
      operatorName: auth.user?.username || "",
      reason: "manual_team_balance",
    });
    if (!res.ok) throw new Error(res.message || "跳边执行失败");
    ui.pushToast({ title: "指令已送达", message: `跳边请求已提交：${props.player.name}`, tone: "ok" });
  } catch (e) {
    ui.pushToast({ title: "跳边失败", message: String(e), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

function buildLookupKey() {
  return [
    String(props.player?.steamId ?? "").trim(),
    String(props.player?.eosId ?? "").trim(),
    String(props.player?.name ?? "").trim(),
  ].filter(Boolean).join("|");
}

watch(
  () => [props.open, props.player?.steamId, props.player?.eosId, props.player?.name, props.player?.ip],
  async () => {
    lookupToken.value += 1;

    if (!props.open || !props.player) {
      resolvingIp.value = false;
      resolveIpError.value = "";
      resolvedLastIp.value = "";
      return;
    }

    resolveIpError.value = "";

    if (currentIp.value) {
      resolvedLastIp.value = "";
      resolvingIp.value = false;
      return;
    }

    const lookupKey = buildLookupKey();
    if (!lookupKey) {
      resolvedLastIp.value = "";
      resolvingIp.value = false;
      return;
    }

    resolvedLastIp.value = "";
    resolvingIp.value = true;

    const token = lookupToken.value;
    try {
      const result = await resolvePlayerIdentityIp({
        steamId: props.player.steamId,
        eosId: props.player.eosId,
        name: props.player.name,
      });

      if (token !== lookupToken.value) return;

      resolvedLastIp.value = result.source === "last" ? result.ip : "";
      resolvingIp.value = false;
    } catch {
      if (token !== lookupToken.value) return;
      resolvedLastIp.value = "";
      resolvingIp.value = false;
      resolveIpError.value = t("common.error");
    }
  },
  { immediate: true },
);

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
}

.detail-section {
  display: grid;
  gap: var(--spacing-sm);
  padding: 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-soft);
  background: var(--color-bg-card);
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
  letter-spacing: 0.05em;
}

.stat-value {
  font-size: 14px;
  color: var(--color-text-primary);
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

.advanced-toggle {
  background: transparent;
  border: 0;
  padding: 0;
  text-align: left;
  cursor: pointer;
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

@media (max-width: 640px) {
  .player-detail-drawer {
    width: 100vw;
  }
}
</style>
