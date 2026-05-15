<template>
  <section class="page udp-forwarder-page">
    <PageHeader
      :title="t('udpForwarder.title', 'UDP 转发日志')"
      :subtitle="t('udpForwarder.subtitle', '查看当前进程已转发到 UDP 的事件包，包括战斗、切图、状态与心跳。')"
    >
      <template #actions>
        <button type="button" @click="reload">
          {{ t("common.refresh") }}
        </button>
        <button type="button" :aria-pressed="liveRefresh" @click="liveRefresh = !liveRefresh">
          {{ liveRefresh ? t("common.pause") : t("common.resume") }}
        </button>
      </template>
    </PageHeader>

    <section class="hero-grid">
      <PageCard compact>
        <div class="metric-grid">
          <div class="metric">
            <span>{{ t("udpForwarder.metrics.total", "当前日志") }}</span>
            <strong>{{ formatNumber(total) }}</strong>
          </div>
          <div class="metric">
            <span>{{ t("udpForwarder.metrics.queued", "已入队") }}</span>
            <strong>{{ formatNumber(sender.enqueued ?? 0) }}</strong>
          </div>
          <div class="metric">
            <span>{{ t("udpForwarder.metrics.failed", "失败") }}</span>
            <strong>{{ formatNumber(sender.failed ?? 0) }}</strong>
          </div>
          <div class="metric">
            <span>{{ t("udpForwarder.metrics.oversized", "超包") }}</span>
            <strong>{{ formatNumber(sender.oversized ?? 0) }}</strong>
          </div>
        </div>
      </PageCard>

      <PageCard compact>
        <div class="status-grid">
          <div>
            <span>{{ t("udpForwarder.target", "目标") }}</span>
            <strong>{{ status.target || "--" }}</strong>
          </div>
          <div>
            <span>{{ t("udpForwarder.queue", "队列") }}</span>
            <strong>{{ formatNumber(sender.queueSize ?? 0) }} / {{ formatNumber(sender.maxQueueSize ?? 0) }}</strong>
          </div>
          <div>
            <span>{{ t("udpForwarder.packet", "单包上限") }}</span>
            <strong>{{ formatNumber(sender.maxPacketBytes ?? 0) }} B</strong>
          </div>
          <div>
            <span>{{ t("udpForwarder.updated", "最近转发") }}</span>
            <strong>{{ formatTime(updatedAt) }}</strong>
          </div>
        </div>
      </PageCard>
    </section>

    <PageCard compact>
      <div class="toolbar">
        <select v-model="filters.type">
          <option v-for="item in typeOptions" :key="item.value" :value="item.value">
            {{ item.label }}
          </option>
        </select>
        <input
          v-model="filters.q"
          :placeholder="t('udpForwarder.searchPlaceholder', '搜索类型 / Event ID / 来源 / 地图 / JSON')"
        >
        <button type="button" :disabled="filters.offset === 0" @click="prevPage">
          {{ t("combat.previous") }}
        </button>
        <button type="button" :disabled="!hasNextPage" @click="nextPage">
          {{ t("combat.next") }}
        </button>
      </div>
    </PageCard>

    <DataState
      :loading="loading && !logs.length"
      :error="error"
      :empty="!error && !logs.length && !loading"
      :empty-title="t('udpForwarder.emptyTitle', '暂无转发日志')"
      :empty-text="t('udpForwarder.emptyText', '当前没有可显示的 UDP 转发事件，或筛选条件没有命中。')"
      :stale="stale"
    >
      <div class="content-grid">
        <PageCard class="log-card" compact>
          <div class="summary-line">
            <span>{{ t("udpForwarder.summary.total", "总计 {count}", { count: total }) }}</span>
            <span>{{ t("udpForwarder.summary.offset", "偏移 {offset}", { offset: filters.offset }) }}</span>
            <span>{{ t("udpForwarder.summary.pageSize", "页大小 {count}", { count: filters.limit }) }}</span>
          </div>

          <div class="log-table-wrap">
            <table class="log-table">
              <thead>
                <tr>
                  <th>{{ t("udpForwarder.columns.time", "时间") }}</th>
                  <th>{{ t("udpForwarder.columns.type", "类型") }}</th>
                  <th>{{ t("udpForwarder.columns.eventId", "Event ID") }}</th>
                  <th>{{ t("udpForwarder.columns.source", "来源") }}</th>
                  <th>{{ t("udpForwarder.columns.match", "对局") }}</th>
                  <th>{{ t("udpForwarder.columns.delivery", "投递") }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="log in logs"
                  :key="log.id"
                  :class="{ selected: selectedLog?.id === log.id }"
                  @click="selectedLog = log"
                >
                  <td>{{ formatTime(log.timestamp) }}</td>
                  <td>
                    <StatusBadge :tone="toneForDelivery(log)">{{ log.type }}</StatusBadge>
                  </td>
                  <td class="mono">{{ log.id }}</td>
                  <td>
                    <div class="cell-stack">
                      <strong>{{ log.source?.eventBusEvent || "--" }}</strong>
                      <span class="mono">{{ log.source?.sourceEventId || "--" }}</span>
                    </div>
                  </td>
                  <td>
                    <div class="cell-stack">
                      <strong>{{ log.match?.map || "--" }}</strong>
                      <span class="mono">{{ log.match?.layer || log.match?.gameMode || "--" }}</span>
                    </div>
                  </td>
                  <td>
                    <StatusBadge :tone="log.accepted ? 'ok' : 'error'">
                      {{ log.delivery }}
                    </StatusBadge>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </PageCard>

        <PageCard class="detail-card" compact>
          <template #header>
            <div class="detail-head">
              <div>
                <h2 class="detail-title">{{ t("udpForwarder.detailTitle", "事件详情") }}</h2>
                <p class="detail-subtitle">
                  {{ selectedLog ? selectedLog.id : t("udpForwarder.detailEmpty", "请选择一条日志") }}
                </p>
              </div>
            </div>
          </template>

          <div v-if="selectedLog" class="detail-body">
            <div class="detail-meta">
              <div>
                <span>{{ t("udpForwarder.detail.type", "类型") }}</span>
                <strong>{{ selectedLog.type }}</strong>
              </div>
              <div>
                <span>{{ t("udpForwarder.detail.time", "时间") }}</span>
                <strong>{{ formatTime(selectedLog.timestamp) }}</strong>
              </div>
              <div>
                <span>{{ t("udpForwarder.detail.accepted", "已入队") }}</span>
                <strong>{{ selectedLog.accepted ? t("common.yes") : t("common.no") }}</strong>
              </div>
              <div>
                <span>{{ t("udpForwarder.detail.eventBusEvent", "EventBus 事件") }}</span>
                <strong>{{ selectedLog.source?.eventBusEvent || "--" }}</strong>
              </div>
            </div>

            <pre class="json-block">{{ prettyJson(selectedLog) }}</pre>
          </div>
          <div v-else class="detail-empty">
            {{ t("udpForwarder.detailEmptyHint", "点击左侧任意一行查看完整 JSON 包。") }}
          </div>
        </PageCard>
      </div>
    </DataState>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import DataState from "../components/common/DataState.vue";
import StatusBadge from "../components/common/StatusBadge.vue";
import { t } from "../i18n";

type ForwarderLog = {
  id: string;
  schema?: string;
  serverId?: string;
  type: string;
  timestamp: string;
  source?: {
    plugin?: string;
    eventBusEvent?: string;
    sourceEventId?: string | null;
  };
  match?: {
    matchId?: string | null;
    map?: string | null;
    layer?: string | null;
    gameMode?: string | null;
  };
  payload?: Record<string, unknown>;
  accepted?: boolean;
  delivery?: string;
};

type SenderStats = {
  target?: string;
  started?: boolean;
  queueSize?: number;
  maxQueueSize?: number;
  maxPacketBytes?: number;
  sent?: number;
  failed?: number;
  dropped?: number;
  oversized?: number;
  enqueued?: number;
  lastSentAt?: string | null;
  lastError?: unknown;
  lastDroppedAt?: string | null;
};

type ForwarderState = {
  logs: ForwarderLog[];
  total: number;
  limit: number;
  offset: number;
  type: string;
  search: string;
  updatedAt: string;
  status: {
    target?: string;
    enabled?: boolean;
    started?: boolean;
    sender?: SenderStats;
    state?: {
      lastForwardedAt?: string | null;
    };
  };
};

const state = ref<ForwarderState>({
  logs: [],
  total: 0,
  limit: 100,
  offset: 0,
  type: "all",
  search: "",
  updatedAt: "",
  status: {},
});

const loading = ref(false);
const error = ref("");
const stale = ref(false);
const liveRefresh = ref(true);
const selectedLog = ref<ForwarderLog | null>(null);

const filters = reactive({
  type: "all",
  q: "",
  limit: 100,
  offset: 0,
});

const typeOptions = [
  { value: "all", label: t("udpForwarder.types.all", "全部") },
  { value: "combat.damage", label: t("udpForwarder.types.combatDamage", "combat.damage") },
  { value: "match.map_changed", label: t("udpForwarder.types.mapChanged", "match.map_changed") },
  { value: "server.status", label: t("udpForwarder.types.serverStatus", "server.status") },
  { value: "forwarder.heartbeat", label: t("udpForwarder.types.heartbeat", "forwarder.heartbeat") },
];

let refreshTimer: number | null = null;
let searchTimer: number | null = null;

const logs = computed(() => state.value.logs);
const total = computed(() => state.value.total);
const status = computed(() => state.value.status ?? {});
const sender = computed<SenderStats>(() => status.value.sender ?? {});
const updatedAt = computed(() => state.value.updatedAt || status.value.state?.lastForwardedAt || "");
const hasNextPage = computed(() => filters.offset + filters.limit < total.value);

watch(
  () => [filters.type, filters.limit, filters.offset],
  () => {
    void load();
  },
  { immediate: true },
);

watch(
  () => filters.q,
  () => {
    if (searchTimer != null) {
      window.clearTimeout(searchTimer);
    }

    searchTimer = window.setTimeout(() => {
      filters.offset = 0;
      void load();
    }, 180);
  },
);

onMounted(() => {
  startAutoRefresh();
});

onBeforeUnmount(() => {
  stopAutoRefresh();
});

async function load() {
  loading.value = true;
  error.value = "";

  try {
    const params = new URLSearchParams({
      type: filters.type,
      q: filters.q,
      limit: String(filters.limit),
      offset: String(filters.offset),
    });

    const response = await fetch(`/api/plugins/udp-event-forwarder/state?${params.toString()}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = await response.json();
    state.value = {
      logs: Array.isArray(data.logs) ? data.logs : [],
      total: Number(data.total ?? 0),
      limit: Number(data.limit ?? filters.limit),
      offset: Number(data.offset ?? filters.offset),
      type: String(data.type ?? filters.type),
      search: String(data.search ?? filters.q ?? ""),
      updatedAt: String(data.updatedAt ?? ""),
      status: data.status ?? {},
    };

    stale.value = false;

    if (!selectedLog.value || !state.value.logs.some((item) => item.id === selectedLog.value?.id)) {
      selectedLog.value = state.value.logs[0] ?? null;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("udpForwarder.loadFailed", "加载失败");
    stale.value = true;
  } finally {
    loading.value = false;
  }
}

function reload() {
  void load();
}

function prevPage() {
  filters.offset = Math.max(0, filters.offset - filters.limit);
}

function nextPage() {
  if (!hasNextPage.value) return;
  filters.offset += filters.limit;
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = window.setInterval(() => {
    if (liveRefresh.value) {
      void load();
    }
  }, 2000);
}

function stopAutoRefresh() {
  if (refreshTimer != null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }

  if (searchTimer != null) {
    window.clearTimeout(searchTimer);
    searchTimer = null;
  }
}

function toneForDelivery(log: ForwarderLog) {
  return log.accepted ? "ok" : "error";
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatTime(value: unknown) {
  const text = String(value ?? "");
  if (!text) return "--";

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString("zh-CN");
}

function formatNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("zh-CN").format(number) : "--";
}
</script>

<style scoped>
.udp-forwarder-page {
  gap: 16px;
}

.hero-grid,
.content-grid {
  display: grid;
  gap: 16px;
}

.hero-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.content-grid {
  grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.8fr);
  align-items: start;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.metric,
.status-grid > div {
  border: 1px solid rgba(130, 154, 180, 0.16);
  background: rgba(255, 255, 255, 0.02);
  border-radius: 10px;
  padding: 12px;
}

.metric span,
.status-grid span,
.detail-meta span {
  display: block;
  color: #8a9dad;
  font-size: 12px;
  margin-bottom: 4px;
}

.metric strong,
.status-grid strong,
.detail-meta strong {
  display: block;
  color: #eef5fb;
  font-size: 15px;
  word-break: break-word;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.toolbar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.toolbar input,
.toolbar select {
  min-width: 0;
  border: 1px solid #38414c;
  background: #11171d;
  color: #edf2f4;
  border-radius: 6px;
  padding: 8px 10px;
}

.toolbar input {
  flex: 1 1 260px;
}

.summary-line {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  color: #9aa7b2;
  font-size: 12px;
  margin-bottom: 12px;
}

.log-table-wrap {
  overflow: auto;
  max-height: calc(100vh - 330px);
  border: 1px solid rgba(130, 154, 180, 0.12);
  border-radius: 10px;
}

.log-table {
  width: 100%;
  border-collapse: collapse;
}

.log-table th,
.log-table td {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(130, 154, 180, 0.12);
  text-align: left;
  vertical-align: top;
  font-size: 13px;
}

.log-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #171d23;
  color: #aebdca;
  font-size: 12px;
}

.log-table tbody tr {
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.log-table tbody tr:hover,
.log-table tbody tr.selected {
  background: rgba(96, 165, 250, 0.08);
}

.cell-stack {
  display: grid;
  gap: 2px;
}

.cell-stack span {
  color: #8a9dad;
  font-size: 12px;
}

.mono {
  font-family: Consolas, "SFMono-Regular", monospace;
}

.detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.detail-title {
  margin: 0;
  font-size: 16px;
}

.detail-subtitle {
  margin: 6px 0 0;
  color: #8a9dad;
  font-size: 12px;
  word-break: break-all;
}

.detail-body {
  display: grid;
  gap: 14px;
}

.detail-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.json-block {
  margin: 0;
  padding: 14px;
  border: 1px solid rgba(130, 154, 180, 0.16);
  border-radius: 10px;
  background: #0f141b;
  color: #dce7ef;
  overflow: auto;
  max-height: 56vh;
  font-size: 12px;
  line-height: 1.55;
}

.detail-empty {
  color: #8a9dad;
  font-size: 13px;
  padding: 16px 0 4px;
}

@media (max-width: 1120px) {
  .hero-grid,
  .content-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 780px) {
  .metric-grid,
  .status-grid,
  .detail-meta {
    grid-template-columns: 1fr;
  }
}
</style>
