<template>
  <section class="page-shell">
    <PageHeader
      eyebrow="Plugin Debug"
      title="入服欢迎警告"
      subtitle="显示玩家加入事件、15 秒延迟任务和警告发送结果，帮助确认插件是否生效。"
    >
      <template #actions>
        <button type="button" class="btn ghost" :disabled="loading" @click="loadState(true)">
          {{ loading ? "刷新中..." : "刷新状态" }}
        </button>
        <button type="button" :class="['btn', autoRefresh ? 'primary' : 'ghost']" @click="toggleAutoRefresh">
          {{ autoRefresh ? "⏸ 停止自动刷新" : "▶ 自动刷新中" }}
        </button>
        <button type="button" class="btn" :disabled="busy" @click="simulateJoin">
          {{ busy ? "执行中..." : "模拟加入" }}
        </button>
        <button type="button" class="btn danger" :disabled="busy" @click="clearHistory">
          清空记录
        </button>
      </template>
    </PageHeader>

    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="info" class="banner info">{{ info }}</div>

    <div class="cards-grid">
      <PageCard title="运行状态" description="插件状态和累计统计" compact>
        <div class="metric-grid">
          <div class="metric">
            <span class="label">插件状态</span>
            <strong>{{ state?.enabled ? "已启用" : "已禁用" }}</strong>
          </div>
          <div class="metric">
            <span class="label">订阅状态</span>
            <strong>{{ state?.subscribed ? "已订阅" : "未订阅" }}</strong>
          </div>
          <div class="metric">
            <span class="label">延迟</span>
            <strong>{{ Number(state?.delayMs ?? 0) / 1000 }} 秒</strong>
          </div>
          <div class="metric">
            <span class="label">待发送</span>
            <strong>{{ state?.pendingCount ?? 0 }}</strong>
          </div>
        </div>

        <dl class="detail-list">
          <div>
            <dt>加入事件次数</dt>
            <dd>{{ state?.joinEventCount ?? 0 }}</dd>
          </div>
          <div>
            <dt>已调度次数</dt>
            <dd>{{ state?.scheduledCount ?? 0 }}</dd>
          </div>
          <div>
            <dt>发送成功</dt>
            <dd>{{ state?.warnSuccessCount ?? 0 }}</dd>
          </div>
          <div>
            <dt>发送失败</dt>
            <dd>{{ state?.warnFailedCount ?? 0 }}</dd>
          </div>
          <div>
            <dt>最近加入</dt>
            <dd>{{ formatTime(state?.lastJoinAt) }}</dd>
          </div>
          <div>
            <dt>最近发送</dt>
            <dd>{{ formatTime(state?.lastWarnAt) }}</dd>
          </div>
          <div class="full-row">
            <dt>欢迎内容</dt>
            <dd>{{ state?.message || "欢迎来到 步战鼠鼠" }}</dd>
          </div>
          <div class="full-row">
            <dt>最近错误</dt>
            <dd>{{ state?.lastError || "无" }}</dd>
          </div>
        </dl>
      </PageCard>

      <PageCard title="调试参数" description="用于手动模拟一次玩家加入" compact>
        <div class="ops-box">
          <label class="label" for="player-name-input">玩家名</label>
          <input id="player-name-input" v-model.trim="playerName" type="text" class="input" placeholder="例如：MousePlayer" />

          <label class="label" for="server-id-input">ServerID (可选)</label>
          <input id="server-id-input" v-model.trim="serverId" type="text" class="input" placeholder="例如：BZSS_Main" />

          <p class="muted">点击"模拟加入"会走真实插件流程：先入队，延迟后调用 AdminWarn。</p>
        </div>
      </PageCard>
    </div>

    <PageCard title="系统收到的事件（诊断）" description="列出最近接收到的所有 join 相关事件，便于诊断事件捕获问题" compact>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>事件名</th>
              <th>玩家名</th>
              <th>服务器</th>
              <th>事件ID</th>
              <th>数据源</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!recentEvents.length">
              <td colspan="6" class="empty-cell">暂无事件（等待真实玩家加入或点击"模拟加入"）</td>
            </tr>
            <tr v-for="item in recentEvents" :key="item.id">
              <td>{{ formatTime(item.at) }}</td>
              <td class="truncate"><strong>{{ item.eventName || "-" }}</strong></td>
              <td class="truncate">{{ item.playerName || "-" }}</td>
              <td class="truncate">{{ item.serverId || "-" }}</td>
              <td class="truncate">{{ item.eventId || "-" }}</td>
              <td>
                <span v-if="item.hasPayload" class="pill ok">payload</span>
                <span v-if="item.hasParams" class="pill ok">params</span>
                <span v-if="item.hasParamMap" class="pill ok">paramMap</span>
                <span v-if="!item.hasPayload && !item.hasParams && !item.hasParamMap" class="pill skip">无</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </PageCard>

    <PageCard title="最近调用记录" description="包含 join 调度和 warn 发送记录" compact>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>结果</th>
              <th>玩家</th>
              <th>事件</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!history.length">
              <td colspan="6" class="empty-cell">暂无记录</td>
            </tr>
            <tr v-for="item in history" :key="item.id">
              <td>{{ formatTime(item.at) }}</td>
              <td>{{ item.kind || "-" }}</td>
              <td>
                <span :class="['pill', item.success ? 'ok' : item.skipped ? 'skip' : 'error']">
                  {{ item.success ? "成功" : item.skipped ? "跳过" : "失败" }}
                </span>
              </td>
              <td class="truncate">{{ item.event?.playerName || "-" }}</td>
              <td class="truncate">{{ item.event?.eventName || "-" }}</td>
              <td class="truncate">{{ describeItem(item) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </PageCard>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";

type HistoryItem = {
  id: string;
  at: string;
  kind?: string;
  success?: boolean;
  skipped?: boolean;
  reason?: string;
  message?: string;
  delayMs?: number;
  errorMessage?: string;
  event?: {
    eventName?: string;
    playerName?: string;
    serverId?: string;
  };
  result?: {
    errorMessage?: string;
    skipReason?: string;
  };
};

type RecentEvent = {
  id: string;
  at: string;
  eventName: string;
  eventId: string;
  serverId: string;
  playerName: string;
  hasPayload: boolean;
  hasParams: boolean;
  hasParamMap: boolean;
};

const loading = ref(false);
const busy = ref(false);
const error = ref("");
const info = ref("");
const state = ref<any>(null);
const autoRefresh = ref(true);
let autoRefreshTimer: number | null = null;

const playerName = ref("DebugPlayer");
const serverId = ref("");

const history = computed<HistoryItem[]>(() => (Array.isArray(state.value?.history) ? state.value.history : []));
const recentEvents = computed<RecentEvent[]>(() => (Array.isArray(state.value?.recentEvents) ? state.value.recentEvents : []));

onMounted(() => {
  void loadState();
  document.addEventListener("visibilitychange", handleVisibilityChange);
  setupAutoRefresh();
});

onUnmounted(() => {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  document.removeEventListener("visibilitychange", handleVisibilityChange);
});

function handleVisibilityChange() {
  setupAutoRefresh();
}

function getRefreshIntervalMs() {
  if (typeof document !== "undefined" && document.hidden) return 10_000;
  return 2_000;
}

function setupAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  if (!autoRefresh.value) return;

  autoRefreshTimer = window.setInterval(() => {
    void loadState();
  }, getRefreshIntervalMs());
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value;
  setupAutoRefresh();
}

async function loadState(force = false) {
  if (loading.value && !force) return;
  loading.value = true;
  error.value = "";

  try {
    const response = await apiGet<{ ok: boolean; data: any }>("/api/plugins/welcome-join-warning/state");
    state.value = response.data ?? null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function simulateJoin() {
  busy.value = true;
  error.value = "";
  info.value = "";

  try {
    await apiPost("/api/plugins/welcome-join-warning/simulate", {
      playerName: playerName.value || "DebugPlayer",
      serverId: serverId.value || undefined,
    });

    info.value = "已模拟玩家加入，等待 15 秒后可看到发送记录。";
    await loadState(true);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function clearHistory() {
  busy.value = true;
  error.value = "";
  info.value = "";

  try {
    await apiPost("/api/plugins/welcome-join-warning/clear", {});
    info.value = "记录已清空。";
    await loadState(true);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

function formatTime(value: string | number | null | undefined) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function describeItem(item: HistoryItem) {
  const delayText = Number.isFinite(Number(item.delayMs)) ? `延迟 ${Math.floor(Number(item.delayMs) / 1000)} 秒` : "";
  if (item.kind === "join") {
    return `${item.reason || "join"} ${delayText}`.trim();
  }
  if (item.kind === "warn") {
    return item.result?.errorMessage || item.result?.skipReason || item.errorMessage || item.reason || "warn";
  }
  return item.reason || "-";
}
</script>

<style scoped>
.page-shell {
  display: grid;
  gap: 18px;
  padding: 18px;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.metric {
  border: 1px solid var(--color-border-soft);
  border-radius: 14px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.03);
  display: grid;
  gap: 6px;
}

.label,
dt {
  font-size: 11px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.metric strong {
  font-size: 16px;
}

.detail-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.detail-list > div {
  border-top: 1px solid var(--color-border-soft);
  padding-top: 10px;
}

.detail-list .full-row {
  grid-column: 1 / -1;
}

.detail-list dt,
.detail-list dd {
  margin: 0;
}

.detail-list dd {
  margin-top: 6px;
  color: var(--color-text-primary);
  word-break: break-word;
}

.ops-box {
  display: grid;
  gap: 10px;
}

.input {
  width: 100%;
  min-height: 40px;
  border-radius: 12px;
  border: 1px solid var(--color-border-soft);
  padding: 8px 12px;
  background: rgba(20, 26, 36, 0.45);
  color: var(--color-text-primary);
}

.table-wrap {
  overflow: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 800px;
}

.data-table th,
.data-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border-soft);
  text-align: left;
  vertical-align: top;
  font-size: 12px;
}

.data-table th {
  color: var(--color-text-secondary);
  font-weight: 600;
}

.empty-cell {
  color: var(--color-text-muted);
  text-align: center;
  padding: 20px !important;
}

.truncate {
  max-width: 180px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.banner {
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 13px;
}

.banner.error {
  border: 1px solid rgba(248, 113, 113, 0.35);
  background: rgba(248, 113, 113, 0.12);
  color: rgb(254, 202, 202);
}

.banner.info {
  border: 1px solid rgba(56, 189, 248, 0.35);
  background: rgba(56, 189, 248, 0.12);
  color: rgb(186, 230, 253);
}

.pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  border: 1px solid transparent;
  margin-right: 4px;
}

.pill.ok {
  border-color: rgba(74, 222, 128, 0.5);
  color: rgb(134, 239, 172);
}

.pill.skip {
  border-color: rgba(250, 204, 21, 0.5);
  color: rgb(253, 224, 71);
}

.pill.error {
  border-color: rgba(248, 113, 113, 0.5);
  color: rgb(252, 165, 165);
}

.btn {
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.btn.ghost {
  border-color: transparent;
  background: transparent;
}

.btn.primary {
  border-color: rgba(96, 165, 250, 0.5);
  background: rgba(96, 165, 250, 0.15);
  color: rgb(186, 230, 253);
}

.btn.danger {
  border-color: rgba(248, 113, 113, 0.5);
  color: rgb(252, 165, 165);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.muted {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 0;
}

@media (max-width: 980px) {
  .cards-grid {
    grid-template-columns: 1fr;
  }

  .detail-list {
    grid-template-columns: 1fr;
  }
}
</style>
