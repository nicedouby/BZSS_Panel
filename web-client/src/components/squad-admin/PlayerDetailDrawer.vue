<template>
  <Teleport to="body">
    <Transition :name="transitionName" :appear="true">
      <div v-if="open && props.player" :class="rootClass">
        <div class="drawer-backdrop" @click="close" />
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

            <section v-if="props.player.battleStats" class="detail-section combat-card battle-log-card">
              <div class="detail-section-title">{{ t("player.battleStats", "战绩（battleLog）") }}</div>
              <div class="combat-stats-grid">
                <div class="stat-item combat-stat combat-stat--downs">
                  <span class="stat-label">{{ t("combat.downs", "击倒") }}</span>
                  <strong class="stat-value combat-stat-value">{{ props.player.battleStats.downs }}</strong>
                </div>
                <div class="stat-item combat-stat combat-stat--kills">
                  <span class="stat-label">{{ t("combat.kills", "击杀") }}</span>
                  <strong class="stat-value combat-stat-value">{{ props.player.battleStats.kills }}</strong>
                </div>
                <div class="stat-item combat-stat combat-stat--deaths">
                  <span class="stat-label">{{ t("combat.death", "死亡") }}</span>
                  <strong class="stat-value combat-stat-value">{{ props.player.battleStats.deaths }}</strong>
                </div>
                <div class="stat-item combat-stat combat-stat--tk">
                  <span class="stat-label">{{ t("combat.teamKill", "TK") }}</span>
                  <strong class="stat-value combat-stat-value">{{ props.player.battleStats.tk }}</strong>
                </div>
                <div class="stat-item combat-stat combat-stat--revives">
                  <span class="stat-label">{{ t("combat.revive", "复苏") }}</span>
                  <strong class="stat-value combat-stat-value">{{ props.player.battleStats.revives }}</strong>
                </div>
              </div>
              <div class="combat-stats-label">
                {{ props.player.battleStatsLabel || props.player.battleStatsSource || t("common.source") }}
              </div>
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
                <div class="group-label">时长覆盖 / PLAYTIME OVERRIDE</div>
                <div class="playtime-summary">
                  <div><span>当前有效时长</span><strong>{{ playtimeEffectiveText }}</strong></div>
                  <div><span>Steam 原始时长</span><strong>{{ playtimeSteamText }}</strong></div>
                  <div><span>覆盖状态</span><strong>{{ playtimeOverrideText }}</strong></div>
                  <div><span>来源</span><strong>{{ playtimeSourceText }}</strong></div>
                </div>
                <div class="playtime-edit-row">
                  <input
                    v-model="playtimeOverrideHours"
                    type="number"
                    min="0"
                    step="0.1"
                    :disabled="!canEditPlaytime || playtimeSaving || databaseLoading || !playerDatabaseRecord"
                    placeholder="输入小时数"
                    class="playtime-input"
                  >
                  <button
                    type="button"
                    class="action-button primary"
                    :disabled="!canEditPlaytime || playtimeSaving || databaseLoading || !playerDatabaseRecord"
                    @click="savePlaytimeOverride(false)"
                  >
                    保存覆盖
                  </button>
                  <button
                    type="button"
                    class="action-button secondary"
                    :disabled="!canEditPlaytime || playtimeSaving || databaseLoading || !playerDatabaseRecord"
                    @click="savePlaytimeOverride(true)"
                  >
                    恢复默认
                  </button>
                </div>
                <div v-if="databaseError" class="playtime-note error">{{ databaseError }}</div>
                <div v-else-if="databaseLoading" class="playtime-note">正在加载玩家数据库详情…</div>
                <div v-else class="playtime-note">留空恢复默认，0 代表显式覆盖为 0 小时。</div>
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
import { apiGet, apiPatch } from "../../app/apiClient";
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
  (event: "playtime-updated"): void;
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
const showAdvanced = ref(false);
const showCombatTimeline = ref(false);
const actionBusy = ref(false);
const databaseDetail = ref<any | null>(null);
const databaseLoading = ref(false);
const databaseError = ref("");
const playtimeOverrideHours = ref("");
const playtimeSaving = ref(false);
const loadToken = ref(0);
const canSwitchTeam = computed(() => Boolean(auth.user?.isSuperAdmin || auth.user?.permissions?.includes?.("squad.switch")));
const canEditPlaytime = computed(() => Boolean(auth.user?.isSuperAdmin));
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

const playerDatabaseSearchKey = computed(() => {
  return String(props.player?.steamId ?? "").trim()
    || String(props.player?.eosId ?? "").trim()
    || String(props.player?.name ?? "").trim();
});

const playerDatabaseRecord = computed(() => databaseDetail.value?.player ?? null);
const playerDatabaseSummary = computed(() => databaseDetail.value?.summary ?? null);
const effectivePlaytimeSeconds = computed(() => {
  if (!playerDatabaseRecord.value) return null;
  return Number(playerDatabaseSummary.value?.gameSeconds ?? playerDatabaseRecord.value?.game_seconds ?? 0);
});
const steamPlaytimeSeconds = computed(() => {
  if (!playerDatabaseRecord.value) return null;
  return Number(playerDatabaseSummary.value?.steamGameSeconds ?? playerDatabaseRecord.value?.steam_game_seconds ?? 0);
});
const playtimeOverrideSeconds = computed(() => {
  const raw = playerDatabaseSummary.value?.gameSecondsOverride ?? playerDatabaseRecord.value?.game_seconds_override;
  if (raw == null || String(raw).trim() === "") return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
});
const playtimeSourceText = computed(() => {
  if (playtimeOverrideSeconds.value == null) return "Steam 原始时长";
  return "手动覆盖时长";
});
const playtimeEffectiveText = computed(() => formatHours(effectivePlaytimeSeconds.value));
const playtimeSteamText = computed(() => formatHours(steamPlaytimeSeconds.value));
const playtimeOverrideText = computed(() => {
  if (playtimeOverrideSeconds.value == null) return "未覆盖";
  return `${formatHours(playtimeOverrideSeconds.value)}（覆盖）`;
});

watch(
  () => [props.open, playerDatabaseSearchKey.value],
  () => {
    if (!props.open) {
      loadToken.value += 1;
      databaseDetail.value = null;
      databaseError.value = "";
      playtimeOverrideHours.value = "";
      return;
    }
    void loadDatabaseDetail();
  },
  { immediate: true },
);

watch(
  () => playerDatabaseRecord.value?.id,
  () => {
    syncPlaytimeOverrideInput();
  },
);

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

function formatHours(value: unknown) {
  if (value == null || value === "") return "--";
  const seconds = Number(value ?? 0);
  if (!Number.isFinite(seconds) || seconds < 0) return "--";
  return `${(seconds / 3600).toFixed(1)}h`;
}

function formatHoursInput(value: unknown) {
  const seconds = Number(value ?? 0);
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  return Number((seconds / 3600).toFixed(1)).toString();
}

function syncPlaytimeOverrideInput() {
  playtimeOverrideHours.value = playtimeOverrideSeconds.value == null
    ? ""
    : formatHoursInput(playtimeOverrideSeconds.value);
}

async function loadDatabaseDetail() {
  const searchKey = playerDatabaseSearchKey.value;
  databaseError.value = "";
  databaseDetail.value = null;
  syncPlaytimeOverrideInput();

  if (!searchKey) {
    databaseLoading.value = false;
    return;
  }

  const currentToken = ++loadToken.value;
  databaseLoading.value = true;
  try {
    const listResponse = await apiGet<any>(`/api/query/player-database?q=${encodeURIComponent(searchKey)}&limit=1`, {}, { timeoutMs: 5_000 });
    const match = firstDatabasePlayer(listResponse);
    if (!match?.id) {
      if (currentToken === loadToken.value) {
        databaseError.value = "未在玩家数据库中找到该玩家。";
      }
      return;
    }

    const detail = await apiGet<any>(`/api/player-database/detail?id=${encodeURIComponent(String(match.id))}`, {}, { timeoutMs: 5_000 });
    if (currentToken !== loadToken.value) return;
    databaseDetail.value = detail;
    syncPlaytimeOverrideInput();
  } catch (error) {
    if (currentToken !== loadToken.value) return;
    databaseError.value = error instanceof Error ? error.message : "加载玩家数据库详情失败。";
  } finally {
    if (currentToken === loadToken.value) {
      databaseLoading.value = false;
    }
  }
}

function firstDatabasePlayer(response: any) {
  return response?.items?.[0] ?? response?.players?.[0] ?? response?.rows?.[0] ?? null;
}

async function savePlaytimeOverride(clear = false) {
  if (!canEditPlaytime.value || !playerDatabaseRecord.value?.id || playtimeSaving.value) return;

  let gameHours: number | null = null;
  if (!clear) {
    const raw = String(playtimeOverrideHours.value ?? "").trim();
    if (!raw) {
      gameHours = null;
    } else {
      const numeric = Number(raw);
      if (!Number.isFinite(numeric) || numeric < 0) {
        ui.pushToast({
          title: "保存失败",
          message: "请输入大于等于 0 的小时数，或留空恢复默认。",
          tone: "error",
        });
        return;
      }
      gameHours = numeric;
    }
  }

  playtimeSaving.value = true;
  try {
    const result = await apiPatch<any>(`/api/db/players/${encodeURIComponent(String(playerDatabaseRecord.value.id))}/playtime`, {
      gameHours,
    });
    if (!result?.ok) throw new Error(result?.message || "保存失败");
    databaseDetail.value = result.data ?? databaseDetail.value;
    syncPlaytimeOverrideInput();
    emit("playtime-updated");
    ui.pushToast({
      title: "已更新时长",
      message: playtimeOverrideSeconds.value == null ? "已恢复为默认 Steam 时长" : `已覆盖为 ${formatHours(playtimeOverrideSeconds.value)}`,
      tone: "ok",
    });
  } catch (error) {
    ui.pushToast({
      title: "保存失败",
      message: error instanceof Error ? error.message : String(error),
      tone: "error",
    });
  } finally {
    playtimeSaving.value = false;
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

.player-detail-drawer {
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

.player-detail-floating {
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
.drawer-enter-active .player-detail-drawer,
.drawer-leave-active .player-detail-drawer {
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform;
}

.drawer-enter-from .player-detail-drawer,
.drawer-leave-to .player-detail-drawer {
  transform: translateX(100%);
}

/* Floating Window Fade/Scale/Slide */
.floating-player-enter-active .drawer-backdrop,
.floating-player-leave-active .drawer-backdrop {
  transition: opacity 0.24s cubic-bezier(0.16, 1, 0.3, 1);
}

.floating-player-enter-from .drawer-backdrop,
.floating-player-leave-to .drawer-backdrop {
  opacity: 0;
}

.floating-player-enter-active .player-detail-floating,
.floating-player-leave-active .player-detail-floating {
  transition: opacity 0.32s cubic-bezier(0.16, 1, 0.3, 1), transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform, opacity;
  backface-visibility: hidden;
  transform-style: preserve-3d;
}

.floating-player-enter-from .player-detail-floating,
.floating-player-leave-to .player-detail-floating {
  opacity: 0 !important;
  transform: translate(-50%, -46%) scale(0.96) !important;
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacing-sm);
  padding: 12px var(--spacing-md) 11px;
  border-bottom: 1px solid var(--color-border-soft);
  flex-shrink: 0;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.01)),
    var(--color-bg-elevated);
}

.drawer-header-content {
  display: grid;
  gap: 5px;
  min-width: 0;
  flex: 1;
}

.drawer-player-name {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: -0.01em;
}

.drawer-header-badges {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.drawer-close-button {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-soft);
  color: var(--color-text-muted);
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  flex-shrink: 0;
  font-size: 13px;
  display: grid;
  place-items: center;
  transition: all 0.14s ease;
}

.drawer-close-button:hover {
  background: rgba(248, 113, 113, 0.12);
  border-color: rgba(248, 113, 113, 0.35);
  color: #fca5a5;
}

.drawer-body {
  padding: 12px 14px;
  overflow-y: auto;
  display: grid;
  gap: 10px;
  overscroll-behavior: contain;
}

.detail-notice {
  border: 1px solid rgba(251, 191, 36, 0.28);
  background: rgba(251, 191, 36, 0.08);
  color: #f5d37a;
  border-radius: var(--radius-md);
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
}

.detail-section {
  display: grid;
  gap: 8px;
  padding: 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-soft);
  background: var(--color-bg-card);
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
  gap: 10px;
  margin-top: 2px;
}

.combat-card {
  background: linear-gradient(170deg, rgba(96, 165, 250, 0.07), rgba(168, 85, 247, 0.04), rgba(255, 255, 255, 0.02));
  border-color: rgba(96, 165, 250, 0.15);
}

.combat-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
  gap: 8px;
}

.combat-stat {
  position: relative;
  overflow: hidden;
  padding: 10px 10px 9px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.4), rgba(15, 23, 42, 0.25));
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.combat-stat::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  border-radius: 12px 0 0 12px;
  background: var(--combat-accent, rgba(148, 163, 184, 0.5));
}

.combat-stat--downs {
  --combat-accent: #60a5fa;
  border-color: rgba(96, 165, 250, 0.2);
  background: linear-gradient(160deg, rgba(96, 165, 250, 0.1), rgba(15, 23, 42, 0.28));
}

.combat-stat--kills {
  --combat-accent: #f472b6;
  border-color: rgba(244, 114, 182, 0.2);
  background: linear-gradient(160deg, rgba(244, 114, 182, 0.1), rgba(15, 23, 42, 0.28));
}

.combat-stat--deaths {
  --combat-accent: #f59e0b;
  border-color: rgba(245, 158, 11, 0.2);
  background: linear-gradient(160deg, rgba(245, 158, 11, 0.1), rgba(15, 23, 42, 0.28));
}

.combat-stat--tk {
  --combat-accent: #fb7185;
  border-color: rgba(251, 113, 133, 0.22);
  background: linear-gradient(160deg, rgba(127, 29, 29, 0.3), rgba(15, 23, 42, 0.28));
}

.combat-stat--revives {
  --combat-accent: #34d399;
  border-color: rgba(52, 211, 153, 0.2);
  background: linear-gradient(160deg, rgba(52, 211, 153, 0.1), rgba(15, 23, 42, 0.28));
}

.combat-stats-label {
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: 10px;
  line-height: 1.4;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--combat-accent, var(--color-text-muted));
  opacity: 0.8;
  letter-spacing: 0.06em;
}

.stat-value {
  font-size: 13px;
  font-weight: 700;
  color: var(--combat-accent, var(--color-text-primary));
}

.combat-stat-value {
  font-size: 22px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: 1;
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
  gap: 14px;
}

.action-group {
  display: grid;
  gap: 8px;
}

.group-label {
  font-size: 9px;
  font-weight: 800;
  color: var(--color-text-muted);
  opacity: 0.7;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 1px;
}

.playtime-summary {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
}

.playtime-summary div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.playtime-summary strong {
  color: var(--color-text-primary);
  font-weight: 700;
}

.playtime-edit-row {
  display: grid;
  grid-template-columns: minmax(120px, 160px) 1fr 1fr;
  gap: var(--spacing-sm);
}

.playtime-input {
  height: 38px;
  width: 100%;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border-soft);
  background: var(--color-bg-input);
  color: var(--color-text-primary);
  font-size: 13px;
}

.playtime-note {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.4;
}

.playtime-note.error {
  color: var(--color-status-error);
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
