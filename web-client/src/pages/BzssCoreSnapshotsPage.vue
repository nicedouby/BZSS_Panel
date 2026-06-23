<template>
  <AppPage full-bleed>
    <AppPageHeader
      title="BZSS-Core 玩家快照"
      subtitle="这里展示 PBI.sav 当前监控状态，以及本轮在 BZSS-Marked 后完成解析的全部玩家数据。"
      :status-items="headerStatusItems"
    >
      <template #actions>
        <button
          type="button"
          class="action-btn primary"
          :disabled="loading"
          @click="fetchData"
        >
          {{ loading ? "刷新中..." : "立即刷新" }}
        </button>
      </template>
    </AppPageHeader>

    <div v-if="error" class="error-banner">
      {{ error }}
    </div>

    <!-- Scrollable content area -->
    <div class="page-content">
      <!-- Status Cards Grid -->
      <StatGrid :items="statItems" />

      <!-- Toolbar -->
      <AppPageToolbar>
        <div class="toolbar-left">
          <input
            v-model.trim="query"
            class="search-input"
            type="text"
            placeholder="搜索玩家名 / GUID / 兵种 / 武器"
          />
        </div>
        <div class="toolbar-right">
          <label class="toggle-label">
            <input v-model="showRaw" type="checkbox" />
            <span>显示原始解析块</span>
          </label>
          <button
            type="button"
            class="action-btn ghost"
            @click="showRawDataPanel = !showRawDataPanel"
          >
            {{ showRawDataPanel ? "隐藏原始数据" : "查看原始数据" }}
          </button>
        </div>
      </AppPageToolbar>

      <!-- Raw Data Panel (Collapsible) -->
      <AppCard
        v-if="showRawDataPanel"
        compact
        title="PBI.sav 原始数据"
        :description="rawDataStatusLabel"
      >
        <template #actions>
          <button type="button" class="action-btn sm" :disabled="rawLoading" @click="fetchRawData">
            {{ rawLoading ? "读取中..." : "读取原始数据" }}
          </button>
        </template>

        <div class="raw-data-content">
          <div v-if="rawError" class="raw-error">{{ rawError }}</div>
          <div class="raw-data-meta">
            <span>路径：{{ rawData?.resolvedPath || payload?.state?.resolvedPath || "--" }}</span>
            <span>字符：{{ rawData?.rawTextLength ?? payload?.state?.rawTextLength ?? 0 }}</span>
            <span>标记：{{ rawData?.markerSeen ? "已看到 BZSS-Marked" : "未完成 / 未看到" }}</span>
          </div>
          <pre class="raw-data-block">{{ rawDataText }}</pre>
        </div>
      </AppCard>

      <!-- Player List Table -->
      <AppCard
        compact
        title="已解析玩家快照列表"
        :description="`本轮快照共解析出 ${filteredPlayers.length} 名玩家`"
        body-mode="fill"
        class="player-list-card"
      >
        <div v-if="filteredPlayers.length > 0" class="table-wrapper" @scroll="handleScroll">
          <AppTable compact>
            <thead>
              <tr>
                <th>ID</th>
                <th>玩家名</th>
                <th>GUID</th>
                <th>小队/所属</th>
                <th>兵种</th>
                <th>血量</th>
                <th>载具</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="player in filteredPlayers"
                :key="player.playerGuid || player.playerName"
                class="clickable-row"
                @click="openDetailDrawer(player)"
              >
                <td>
                  <span class="mono">{{ player.playerId ?? "--" }}</span>
                </td>
                <td>
                  <div class="player-name-cell">
                    <strong class="player-name">{{ player.playerName || "Unknown" }}</strong>
                    <span v-if="player.isAdmin" class="role-badge admin">Admin</span>
                    <span v-if="player.isCommander" class="role-badge commander">CMD</span>
                  </div>
                </td>
                <td>
                  <span class="mono">{{ player.playerGuid || "--" }}</span>
                </td>
                <td>
                  <div class="team-squad-badge">
                    <span class="team-badge" :data-team="player.teamId">T{{ player.teamId ?? "--" }}</span>
                    <span class="squad-badge">S{{ player.squadId ?? "--" }}</span>
                    <span class="ft-badge" v-if="player.ftIndex != null || player.ftPosition != null">
                      FT{{ player.ftIndex ?? "-" }}/{{ player.ftPosition ?? "-" }}
                    </span>
                  </div>
                </td>
                <td>
                  <span class="class-text">{{ player.soldierInfo?.soldierClass || "--" }}</span>
                </td>
                <td>
                  <div class="hp-bar-wrapper">
                    <span class="hp-text">HP {{ player.soldierInfo?.health ?? "--" }}</span>
                    <div class="hp-track">
                      <div
                        class="hp-fill"
                        :class="getHpClass(player.soldierInfo?.health)"
                        :style="{ width: `${Math.min(100, Math.max(0, player.soldierInfo?.health ?? 0))}%` }"
                      ></div>
                    </div>
                  </div>
                </td>
                <td>
                  <span v-if="getVehicleIconInfo(player)" class="vehicle-cell">
                    <template v-if="isVehicleIconImage(getVehicleIconInfo(player)?.icon)">
                      <img
                        class="vehicle-summary-icon"
                        :src="getVehicleIconInfo(player)?.icon || ''"
                        :alt="formatVehicleInfo(player)"
                      >
                    </template>
                    <span v-else class="vehicle-summary-fallback" aria-hidden="true">{{ getVehicleIconInfo(player)?.icon }}</span>
                    <span class="vehicle-name">{{ player.vehicleInfo?.vehicleType }}</span>
                  </span>
                  <span v-else class="mono">--</span>
                </td>
                <td>
                  <button
                    type="button"
                    class="action-btn sm"
                    @click.stop="openDetailDrawer(player)"
                  >
                    详情
                  </button>
                </td>
              </tr>
            </tbody>
          </AppTable>
        </div>

        <div v-else class="empty-state">
          <strong>当前还没有可展示的玩家数据。</strong>
          <p>如果服务端正在写文件，页面会在检测到 `BZSS-Marked` 后自动更新这一轮完整快照。</p>
        </div>
      </AppCard>
    </div>

    <!-- Detail Drawer -->
    <Transition name="drawer">
      <div v-if="selectedPlayer" class="drawer-root" v-backdrop-close="closeDetailDrawer">
        <aside class="drawer-panel">
          <header class="drawer-head">
            <div>
              <h2>{{ selectedPlayer.playerName || "Unknown" }}</h2>
              <p class="mono copyable" title="点击复制 GUID" @click="copyText(selectedPlayer?.playerGuid, 'GUID')">
                {{ selectedPlayer.playerGuid || "--" }}
                <span class="copy-icon">📋</span>
              </p>
            </div>
            <button type="button" class="drawer-close-btn" @click="closeDetailDrawer">关闭</button>
          </header>

          <div class="drawer-content">
            <!-- Badges -->
            <div class="drawer-section">
              <span class="section-title">玩家属性</span>
              <div class="drawer-badges">
                <span class="badge">ID {{ selectedPlayer.playerId ?? "--" }}</span>
                <span class="badge">T{{ selectedPlayer.teamId ?? "--" }}</span>
                <span class="badge">S{{ selectedPlayer.squadId ?? "--" }}</span>
                <span class="badge">FT {{ selectedPlayer.ftIndex ?? "--" }} / {{ selectedPlayer.ftPosition ?? "--" }}</span>
                <span v-if="selectedPlayer.isAdmin" class="badge admin">Admin</span>
                <span v-if="selectedPlayer.isCommander" class="badge commander">CMD</span>
                <span class="badge health">HP {{ selectedPlayer.soldierInfo?.health ?? "--" }}</span>
              </div>
            </div>

            <!-- Soldier details -->
            <div class="drawer-section">
              <span class="section-title">战斗装备</span>
              <div class="detail-grid">
                <div>
                  <span>兵种</span>
                  <strong class="mono">{{ selectedPlayer.soldierInfo?.soldierClass || "--" }}</strong>
                </div>
                <div>
                  <span>武器</span>
                  <strong class="mono">{{ selectedPlayer.soldierInfo?.weaponClass || "--" }}</strong>
                </div>
                <div class="field-wide">
                  <span>弹药/数值</span>
                  <strong class="mono">{{ formatNumberList(selectedPlayer.soldierInfo?.ammoValues ?? []) }}</strong>
                </div>
              </div>
            </div>

            <!-- Vehicle details -->
            <div class="drawer-section">
              <span class="section-title">载具与席位</span>
              <div class="detail-grid">
                <div class="field-wide">
                  <span>载具类型</span>
                  <strong v-if="getVehicleIconInfo(selectedPlayer)" class="mono vehicle-summary">
                    <template v-if="isVehicleIconImage(getVehicleIconInfo(selectedPlayer)?.icon)">
                      <img
                        class="vehicle-summary-icon"
                        :src="getVehicleIconInfo(selectedPlayer)?.icon || ''"
                        :alt="formatVehicleInfo(selectedPlayer)"
                      >
                    </template>
                    <span v-else class="vehicle-summary-fallback" aria-hidden="true">{{ getVehicleIconInfo(selectedPlayer)?.icon }}</span>
                    <span>{{ formatVehicleInfo(selectedPlayer) }}</span>
                  </strong>
                  <strong v-else class="mono">--</strong>
                </div>
                <div class="field-wide">
                  <span>同乘席位玩家</span>
                  <strong class="mono">{{ formatSeatsPlayers(selectedPlayer) }}</strong>
                </div>
              </div>
            </div>

            <!-- Position vectors -->
            <div class="drawer-section">
              <span class="section-title">坐标与朝向</span>
              <div class="vector-container">
                <div class="vector-field" title="点击复制三维坐标" @click="copyVector(selectedPlayer?.soldierInfo?.position, '坐标')">
                  <div class="vector-label-row">
                    <span>三维坐标 Position (X, Y, Z)</span>
                    <span class="copy-hint">点击复制</span>
                  </div>
                  <code class="mono">{{ formatVector(selectedPlayer.soldierInfo?.position) }}</code>
                </div>
                <div class="vector-field" title="点击复制旋转朝向" @click="copyVector(selectedPlayer?.soldierInfo?.rotation, '朝向')">
                  <div class="vector-label-row">
                    <span>朝向 Rotation (Pitch, Yaw, Roll)</span>
                    <span class="copy-hint">点击复制</span>
                  </div>
                  <code class="mono">{{ formatVector(selectedPlayer.soldierInfo?.rotation) }}</code>
                </div>
              </div>
            </div>

            <!-- Scoreboard metrics -->
            <div class="drawer-section">
              <span class="section-title">记分板详情</span>
              <div class="scoreboard-grid">
                <div
                  v-for="item in getScoreboardItems(selectedPlayer)"
                  :key="item.key"
                  class="scoreboard-item"
                >
                  <span>{{ item.label }}</span>
                  <strong>{{ item.value ?? "--" }}</strong>
                </div>
              </div>
            </div>

            <!-- Raw text block -->
            <div class="drawer-section" v-if="showRaw">
              <span class="section-title">原始解析块</span>
              <pre class="raw-block">{{ selectedPlayer.rawText }}</pre>
            </div>
          </div>
        </aside>
      </div>
    </Transition>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from "vue";
import {
  fetchBzssCoreRawData,
  fetchBzssCorePlayerInfoList,
  streamBzssCorePlayerInfoList,
  type BzssCorePlayerInfoResponse,
  type BzssCoreRawDataResponse,
  type BzssCoreTrackedPlayerInfo,
} from "../app/bzssCoreApi";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";
import { isVehicleIconImage, resolveVehicleIcon } from "../utils/vehicle-icons";
import { useUiStore } from "../stores/ui.store";
import { copyTextWithToast } from "../utils/clipboard";

import AppPage from "../components/common/AppPage.vue";
import AppPageHeader from "../components/common/AppPageHeader.vue";
import AppPageToolbar from "../components/common/AppPageToolbar.vue";
import AppCard from "../components/common/AppCard.vue";
import AppTable from "../components/common/AppTable.vue";
import StatGrid from "../components/ui/StatGrid.vue";

const payload = ref<BzssCorePlayerInfoResponse | null>(null);
const rawData = ref<BzssCoreRawDataResponse | null>(null);
const loading = ref(false);
const rawLoading = ref(false);
const error = ref("");
const rawError = ref("");
const query = ref("");
const showRaw = ref(false);
const active = ref(true);
const sampleClock = ref(Date.now());
const sampleEvents = ref<number[]>([]);
const isStreaming = ref(false);

const showRawDataPanel = ref(false);
const selectedPlayer = ref<BzssCoreTrackedPlayerInfo | null>(null);

const isScrolling = ref(false);
let scrollTimeout: number | null = null;
const pendingPayload = ref<BzssCorePlayerInfoResponse | null>(null);

function handleScroll() {
  isScrolling.value = true;
  if (scrollTimeout != null) {
    window.clearTimeout(scrollTimeout);
  }
  scrollTimeout = window.setTimeout(() => {
    isScrolling.value = false;
    scrollTimeout = null;
    if (pendingPayload.value) {
      payload.value = pendingPayload.value;
      pendingPayload.value = null;
    }
  }, 2500);
}

let timer: number | null = null;
let closeStream: (() => void) | null = null;
let sampleClockTimer: number | null = null;

const players = computed(() => payload.value?.players ?? []);
const rawDataText = computed(() => {
  const text = rawData.value?.rawText ?? "";
  if (text) return text;
  if (rawLoading.value) return "正在读取 PBI.sav 原始数据...";
  return "暂无可显示的 PBI.sav 原始数据。";
});

const rawDataStatusLabel = computed(() => {
  const data = rawData.value;
  if (!data) return "直接显示从 PBI.sav 中提取到的 PlayerBaseInfo / SoldierInfo / PlayerScoreboard 原始块。";
  if (data.lastError) return data.lastError;
  if (!data.exists) return "PBI.sav 文件不存在或当前路径无法访问。";
  if (!data.rawText) return "已读取文件，但还没有找到可显示的 BZSS-Core 原始数据块。";
  return `最后读取 ${formatDateTime(data.rawTextUpdatedAt || data.lastReadAt)}，共 ${data.playerCount} 名玩家。`;
});

const recentSampleEvents = computed(() => {
  const now = sampleClock.value;
  return sampleEvents.value.filter((timestamp) => now - timestamp <= 1000);
});
const sampleRateLabel = computed(() => `${formatDecimal(recentSampleEvents.value.length)} / s`);
const lastSampleLabel = computed(() => {
  const last = sampleEvents.value[sampleEvents.value.length - 1];
  if (!last) return "暂无样本";
  const age = Math.max(0, sampleClock.value - last);
  if (age < 1000) return `${age} ms 前`;
  return `${formatDecimal(age / 1000)} s 前`;
});

const filteredPlayers = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return players.value;
  return players.value.filter((player) => {
    return [
      player.playerName,
      player.playerGuid,
      player.soldierInfo?.soldierClass,
      player.soldierInfo?.weaponClass,
    ].some((value) => String(value ?? "").toLowerCase().includes(needle));
  });
});

const statusLabel = computed(() => {
  const status = String(payload.value?.status ?? "").trim();
  if (status === "ready") return "已完成";
  if (status === "writing") return "写入中";
  if (status === "waiting") return "等待下一轮";
  if (status === "missing") return "文件不存在";
  if (status === "unconfigured") return "未配置路径";
  if (status === "error") return "读取失败";
  return "空闲";
});

const statusDetail = computed(() => {
  const state = payload.value?.state;
  if (!state) return "--";
  if (state.lastError) return state.lastError;
  if (state.lastCompletedAt) return `最后完成: ${formatDateTime(state.lastCompletedAt)}`;
  if (state.lastReadAt) return `最后读取: ${formatDateTime(state.lastReadAt)}`;
  return "--";
});

// AppPageHeader dynamic status badges
const headerStatusItems = computed(() => {
  const items: Array<{ label: string; tone?: "ok" | "warn" | "error" | "idle" }> = [];

  if (isStreaming.value) {
    items.push({ label: `SSE 实时流: ${sampleRateLabel.value}`, tone: "ok" });
  } else {
    items.push({ label: "轮询模式", tone: "warn" });
  }

  if (sampleEvents.value.length > 0) {
    items.push({ label: `最近接收: ${lastSampleLabel.value}`, tone: "idle" });
  } else {
    items.push({ label: "无实时数据流", tone: "idle" });
  }

  return items;
});

// StatGrid items
const statItems = computed(() => {
  const status = payload.value?.status || "idle";
  let tone: "neutral" | "info" | "success" | "warning" | "danger" = "neutral";
  if (status === "ready") tone = "success";
  else if (status === "writing") tone = "warning";
  else if (["error", "missing", "unconfigured"].includes(status)) tone = "danger";
  else if (status === "waiting") tone = "info";

  return [
    {
      key: "status",
      label: "监控状态",
      value: statusLabel.value,
      description: statusDetail.value,
      tone,
    },
    {
      key: "playersCount",
      label: "已解析玩家",
      value: players.value.length,
      description: "本轮完整写入后数据",
      tone: "neutral" as const,
    },
    {
      key: "fileSize",
      label: "PBI.sav 文件大小",
      value: formatBytes(payload.value?.state?.fileSize ?? 0),
      description: payload.value?.state?.lastReadAt ? `读取于: ${formatDateTime(payload.value.state.lastReadAt)}` : "--",
      tone: "neutral" as const,
    },
    {
      key: "filePath",
      label: "监控文件路径",
      value: payload.value?.state?.resolvedPath || "--",
      description: `配置: ${payload.value?.state?.configuredPath || "--"}`,
      tone: "neutral" as const,
    },
  ];
});

const ui = useUiStore();

function openDetailDrawer(player: BzssCoreTrackedPlayerInfo) {
  selectedPlayer.value = player;
}

function closeDetailDrawer() {
  selectedPlayer.value = null;
}

async function copyText(text: string | null | undefined, label: string) {
  if (!text) return;
  await copyTextWithToast(text, ui, {
    label,
    successMessage: `已复制 ${label} 到剪贴板`,
    errorMessage: `复制 ${label} 失败`,
  });
}

async function copyVector(vector: BzssCoreTrackedPlayerInfo["soldierInfo"]["position"], label: string) {
  if (!vector) return;
  const text = `X=${vector.x ?? 0} Y=${vector.y ?? 0} Z=${vector.z ?? 0}`;
  await copyText(text, label);
}

function getHpClass(health: number | null | undefined) {
  const hp = health ?? 0;
  if (hp > 50) return "hp-good";
  if (hp > 20) return "hp-warning";
  return "hp-danger";
}

async function fetchData() {
  if (!active.value) return;
  loading.value = true;
  error.value = "";
  try {
    const [nextPayload] = await Promise.all([
      fetchBzssCorePlayerInfoList(),
      fetchRawData(),
    ]);
    payload.value = nextPayload;
    recordSample();
  } catch (err: any) {
    error.value = err?.message ?? "加载 BZSS-Core 玩家快照失败。";
  } finally {
    loading.value = false;
  }
}

async function fetchRawData() {
  rawLoading.value = true;
  rawError.value = "";
  try {
    rawData.value = await fetchBzssCoreRawData();
  } catch (err: any) {
    rawError.value = err?.message ?? "读取 PBI.sav 原始数据失败。";
  } finally {
    rawLoading.value = false;
  }
}

function scheduleRefresh() {
  clearRefresh();
  timer = window.setTimeout(async () => {
    if (active.value && canAutoRefreshNow() && !closeStream && !isScrolling.value) {
      await fetchData();
    }
    scheduleRefresh();
  }, closeStream ? 1000 : 100);
}

function recordSample() {
  const now = Date.now();
  sampleEvents.value = [...sampleEvents.value, now]
    .filter((timestamp) => now - timestamp <= 5000)
    .slice(-120);
  sampleClock.value = now;
}

function clearRefresh() {
  if (timer != null) {
    window.clearTimeout(timer);
    timer = null;
  }
}

function startStream() {
  if (closeStream || typeof EventSource === "undefined") return;
  isStreaming.value = true;
  closeStream = streamBzssCorePlayerInfoList(
    (data) => {
      if (!active.value) return;
      recordSample();
      error.value = "";
      loading.value = false;

      if (isScrolling.value) {
        pendingPayload.value = data;
      } else {
        payload.value = data;
        pendingPayload.value = null;
      }
    },
    (_err, source) => {
      if (!active.value) return;
      if (source.readyState === EventSource.CLOSED) {
        error.value = "BZSS-Core 实时连接中断，正在使用轮询兜底。";
        stopStream();
        scheduleRefresh();
      }
    },
  );
}

function stopStream() {
  if (!closeStream) return;
  closeStream();
  closeStream = null;
  isStreaming.value = false;
}

function formatDateTime(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDecimal(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// Tick the sample clock periodically to update the lastSample time label
function startSampleClock() {
  if (sampleClockTimer != null) return;
  sampleClockTimer = window.setInterval(() => {
    sampleClock.value = Date.now();
  }, 250);
}

function stopSampleClock() {
  if (sampleClockTimer != null) {
    window.clearInterval(sampleClockTimer);
    sampleClockTimer = null;
  }
}

function formatVector(vector: BzssCoreTrackedPlayerInfo["soldierInfo"]["position"]) {
  if (!vector) return "--";
  return `X=${vector.x ?? "?"}  Y=${vector.y ?? "?"}  Z=${vector.z ?? "?"}`;
}

// Convert numbers array to text
function formatNumberList(values: number[]) {
  return values.length > 0 ? values.join(" / ") : "--";
}

function getScoreboardItems(player: BzssCoreTrackedPlayerInfo) {
  const labeled = player.playerScoreboard?.labeledValues ?? [];
  if (labeled.length > 0) return labeled;
  const labels = [
    ["dataLives", "Data lives"],
    ["numKills", "Num kills"],
    ["numDeaths", "Num death"],
    ["numWoundeds", "Num woundeds"],
    ["numWounds", "Num wounds"],
    ["numTeamKills", "Num TK"],
    ["healPoints", "Heal point"],
    ["revivedPoints", "Revived points"],
    ["teamworkScore", "Team work score"],
    ["objectiveScore", "Objective score"],
    ["combatScore", "Combat score"],
  ];
  const values = player.playerScoreboard?.numericValues ?? [];
  return labels.map(([key, label], index) => ({
    key,
    label,
    value: values[index] ?? null,
  }));
}

function formatVehicleInfo(player: BzssCoreTrackedPlayerInfo) {
  const info = player.vehicleInfo;
  if (!info?.vehicleType) return "--";
  return info.healthText ? `${info.vehicleType} ${info.healthText}` : info.vehicleType;
}

function getVehicleIconInfo(player: BzssCoreTrackedPlayerInfo) {
  const info = player.vehicleInfo;
  if (!info?.vehicleType || info.vehicleType === "None") return null;
  return resolveVehicleIcon(info.vehicleType);
}

function formatSeatsPlayers(player: BzssCoreTrackedPlayerInfo) {
  const seats = player.seatsPlayers ?? [];
  return seats.length > 0 ? seats.join(" / ") : "--";
}

onMounted(async () => {
  startSampleClock();
  await fetchData();
  startStream();
  scheduleRefresh();
});

onActivated(() => {
  active.value = true;
  startStream();
  scheduleRefresh();
});

onDeactivated(() => {
  active.value = false;
  stopStream();
  clearRefresh();
  stopSampleClock();
});

onBeforeUnmount(() => {
  active.value = false;
  stopStream();
  clearRefresh();
  stopSampleClock();
});
</script>

<style scoped>
.page-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 24px;
}

/* Error Banner */
.error-banner {
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(248, 113, 113, 0.35);
  background: rgba(127, 29, 29, 0.28);
  color: #fecaca;
  font-size: 14px;
}

/* Toolbar styling */
.search-input {
  width: 320px;
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.2);
  color: var(--color-text-primary);
  font-size: 13px;
  transition: border-color 0.15s ease;
}

.search-input:focus {
  outline: none;
  border-color: var(--color-border-hover);
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.toggle-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}

.toggle-label input {
  accent-color: var(--color-status-info);
}

/* Table styling */
.player-list-card {
  flex: 1;
  min-height: 0;
}

.table-wrapper {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
}

.clickable-row {
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.player-name-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.player-name {
  font-weight: 600;
  color: var(--color-text-primary);
}

.role-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.role-badge.admin {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.25);
}

.role-badge.commander {
  background: rgba(234, 179, 8, 0.12);
  color: #facc15;
  border: 1px solid rgba(234, 179, 8, 0.25);
}

.team-squad-badge {
  display: flex;
  gap: 4px;
  align-items: center;
}

.team-badge, .squad-badge, .ft-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
}

.team-badge {
  background: rgba(148, 163, 184, 0.12);
  color: #cbd5e1;
}

.team-badge[data-team="1"] {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}

.team-badge[data-team="2"] {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}

.squad-badge {
  background: rgba(168, 85, 247, 0.15);
  color: #c084fc;
}

.ft-badge {
  background: rgba(148, 163, 184, 0.12);
  color: #94a3b8;
}

.class-text {
  font-family: monospace;
  font-size: 13px;
  color: var(--color-text-secondary);
}

/* HP styling */
.hp-bar-wrapper {
  display: flex;
  flex-direction: column;
  width: 80px;
}

.hp-text {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.hp-track {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 4px;
}

.hp-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.hp-good {
  background: var(--color-status-success, #22c55e);
}

.hp-warning {
  background: var(--color-status-warning, #eab308);
}

.hp-danger {
  background: var(--color-status-danger, #ef4444);
}

/* Vehicle styling */
.vehicle-cell {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.vehicle-summary-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  object-fit: contain;
}

.vehicle-summary-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 12px;
  line-height: 1;
}

.vehicle-name {
  font-family: monospace;
  font-size: 12px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Raw data styling */
.raw-data-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.raw-error {
  padding: 8px 12px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 6px;
  color: #fca5a5;
  font-size: 13px;
}

.raw-data-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
}

.raw-data-meta span {
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-secondary);
  border: 1px solid rgba(255, 255, 255, 0.03);
}

.raw-data-block {
  max-height: 240px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background: rgba(0, 0, 0, 0.25);
  color: #86efac;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Empty state styling */
.empty-state {
  padding: 32px 16px;
  text-align: center;
  color: var(--color-text-muted);
}

.empty-state strong {
  display: block;
  font-size: 14px;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}

.empty-state p {
  margin: 0;
  font-size: 12px;
}

/* Drawer styles */
.drawer-root {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.drawer-panel {
  margin-left: auto;
  width: min(560px, 100vw);
  height: 100vh;
  overflow-y: auto;
  background: var(--color-bg-card, #10161c);
  border-left: 1px solid var(--color-border-default, #26303a);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.5);
}

.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  border-bottom: 1px solid var(--color-border-soft, rgba(255, 255, 255, 0.05));
  padding-bottom: 16px;
}

.drawer-head h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.drawer-head p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--color-text-muted);
}

.copyable {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: color 0.15s ease;
}

.copyable:hover {
  color: var(--color-text-primary);
}

.copy-icon {
  font-size: 10px;
  opacity: 0.6;
}

.drawer-close-btn {
  border: 1px solid var(--color-border-default);
  background: transparent;
  color: var(--color-text-secondary);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.drawer-close-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
  border-color: var(--color-border-hover);
}

.drawer-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.drawer-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  border-left: 2px solid var(--color-status-info);
  padding-left: 8px;
}

.drawer-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.badge {
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.03);
}

.badge.admin {
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
  border-color: rgba(239, 68, 68, 0.2);
}

.badge.commander {
  background: rgba(234, 179, 8, 0.1);
  color: #facc15;
  border-color: rgba(234, 179, 8, 0.2);
}

.badge.health {
  background: rgba(34, 197, 94, 0.1);
  color: #86efac;
  border-color: rgba(34, 197, 94, 0.2);
}

/* Detail grid */
.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.detail-grid > div {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.detail-grid span {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin-bottom: 4px;
}

.detail-grid strong {
  display: block;
  font-size: 14px;
  color: var(--color-text-primary);
}

.field-wide {
  grid-column: span 2;
}

.vehicle-summary {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Position fields */
.vector-container {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.vector-field {
  padding: 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: all 0.15s ease;
}

.vector-field:hover {
  background: rgba(255, 255, 255, 0.02);
  border-color: var(--color-border-soft);
}

.vector-label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.vector-label-row span {
  font-size: 11px;
  color: var(--color-text-muted);
}

.copy-hint {
  font-size: 10px;
  opacity: 0;
  transition: opacity 0.15s ease;
  color: var(--color-status-info);
}

.vector-field:hover .copy-hint {
  opacity: 1;
}

.vector-field code {
  display: block;
  font-size: 13px;
  color: #38bdf8;
  word-break: break-all;
}

/* Scoreboard item list in drawer */
.scoreboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 8px;
}

.scoreboard-item {
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.01);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.scoreboard-item span {
  display: block;
  font-size: 11px;
  color: var(--color-text-muted);
  margin-bottom: 4px;
}

.scoreboard-item strong {
  display: block;
  font-family: monospace;
  font-size: 15px;
  color: var(--color-text-primary);
}

/* Raw block inside drawer */
.raw-block {
  margin: 0;
  padding: 12px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  overflow: auto;
  color: #a7f3d0;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
}

/* General action buttons styling */
.action-btn {
  min-height: 32px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  transition: all 0.15s ease;
}

.action-btn:hover:not(:disabled) {
  border-color: var(--color-border-hover);
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.06);
}

.action-btn.primary {
  background: var(--color-status-info, #3b82f6);
  border-color: var(--color-status-info, #3b82f6);
  color: #fff;
}

.action-btn.primary:hover:not(:disabled) {
  background: #2563eb;
  border-color: #2563eb;
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.3);
}

.action-btn.ghost {
  border-color: transparent;
  background: transparent;
}

.action-btn.ghost:hover {
  background: rgba(255, 255, 255, 0.04);
}

.action-btn.sm {
  min-height: 26px;
  padding: 2px 8px;
  font-size: 12px;
  border-radius: 4px;
}

/* Transitions */
.drawer-enter-active,
.drawer-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(100%);
  opacity: 0.9;
}

@media (max-width: 780px) {
  .search-input {
    width: 100%;
  }

  .toolbar-right {
    width: 100%;
    justify-content: space-between;
  }
}
</style>
