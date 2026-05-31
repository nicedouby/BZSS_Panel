<template>
  <section class="page-shell">
    <PageHeader
      eyebrow="Plugin Debug"
      title="PJSC 平均时长"
      subtitle="监听聊天中的 pjsc 触发词，按当前对局计算 team1 / team2 的平均时长和小队长平均时长，并通过广播输出。"
    >
      <template #actions>
        <button type="button" class="btn ghost" @click="loadState" :disabled="loading">
          {{ loading ? "刷新中..." : "刷新状态" }}
        </button>
        <button type="button" class="btn" @click="broadcastNow" :disabled="busy">
          {{ busy ? "执行中..." : "手动广播" }}
        </button>
      </template>
    </PageHeader>

    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="info" class="banner info">{{ info }}</div>

    <div class="hero-grid">
      <PageCard title="触发状态" description="插件运行状态与最近一次触发信息" compact>
        <div class="metric-grid">
          <div class="metric">
            <span class="label">启用状态</span>
            <strong>{{ state?.enabled ? "已启用" : "已禁用" }}</strong>
          </div>
          <div class="metric">
            <span class="label">触发词</span>
            <strong>{{ state?.triggerKeyword || "pjsc" }}</strong>
          </div>
          <div class="metric">
            <span class="label">触发次数</span>
            <strong>{{ state?.triggerCount ?? 0 }}</strong>
          </div>
          <div class="metric">
            <span class="label">广播次数</span>
            <strong>{{ state?.broadcastCount ?? 0 }}</strong>
          </div>
        </div>

        <dl class="detail-list">
          <div>
            <dt>最近触发</dt>
            <dd>{{ formatTime(state?.lastTriggerAt) }}</dd>
          </div>
          <div>
            <dt>最近广播</dt>
            <dd>{{ formatTime(state?.lastBroadcastAt) }}</dd>
          </div>
          <div>
            <dt>最近消息</dt>
            <dd class="truncate">{{ state?.lastMessage || "暂无" }}</dd>
          </div>
          <div>
            <dt>最近错误</dt>
            <dd class="truncate">{{ state?.lastError || "无" }}</dd>
          </div>
        </dl>
      </PageCard>

      <PageCard title="模拟触发" description="输入一条聊天消息，点击后会按真实流程执行一次触发与广播" compact>
        <div class="simulate-box">
          <input v-model="messageText" type="text" class="input" placeholder="输入包含 pjsc 的聊天内容">
          <div class="actions-row">
            <button type="button" class="btn" @click="simulateTrigger" :disabled="busy">
              模拟触发
            </button>
            <button type="button" class="btn ghost" @click="clearHistory" :disabled="busy">
              清空记录
            </button>
          </div>
        </div>
      </PageCard>
    </div>

    <div class="team-grid">
      <PageCard title="当前计算结果" description="基于当前对局快照与 playtime 缓存计算的结果" compact>
        <div v-if="!teams.length" class="empty-state">暂无可展示的计算结果，请先触发一次或刷新状态。</div>
        <div v-else class="team-cards">
          <article v-for="team in teams" :key="team.teamID" class="team-card">
            <div class="team-head">
              <h3>team{{ team.teamID }}</h3>
              <span>{{ team.playerCount }} 人</span>
            </div>
            <div class="stat-row">
              <span>平均时长</span>
              <strong>{{ formatHours(team.averageHours) }}</strong>
            </div>
            <div class="stat-row">
              <span>小队长平均时长</span>
              <strong>{{ formatHours(team.leaderAverageHours) }}</strong>
            </div>
            <div class="stat-row muted">
              <span>小队长数量</span>
              <strong>{{ team.leaderCount }}</strong>
            </div>
          </article>
        </div>
      </PageCard>

      <PageCard title="广播预览" description="最终会发送给广播模块的文本" compact>
        <pre class="preview">{{ summaryMessage || "暂无预览" }}</pre>
      </PageCard>
    </div>

    <PageCard title="最近事件" description="保存最近的触发与广播记录，便于验证事件链路" compact>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>结果</th>
              <th>消息</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!history.length">
              <td colspan="5" class="empty-cell">暂无记录</td>
            </tr>
            <tr v-for="item in history" :key="item.id">
              <td>{{ formatTime(item.at) }}</td>
              <td>{{ item.kind }}</td>
              <td>
                <span :class="['pill', item.success ? 'ok' : item.skipped ? 'skip' : 'error']">
                  {{ item.success ? "成功" : item.skipped ? "跳过" : "失败" }}
                </span>
              </td>
              <td class="truncate">{{ item.message || item.reason || "-" }}</td>
              <td class="truncate">{{ describeHistoryItem(item) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </PageCard>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";

type TeamSummary = {
  teamID: number;
  playerCount: number;
  leaderCount: number;
  averageHours: number | null;
  leaderAverageHours: number | null;
};

type PjscHistoryItem = {
  id: string;
  at: string;
  kind: string;
  success?: boolean;
  skipped?: boolean;
  message?: string;
  reason?: string;
  summary?: { message?: string };
};

const loading = ref(false);
const busy = ref(false);
const error = ref("");
const info = ref("");
const state = ref<any>(null);
const messageText = ref("pjsc");

const teams = computed<TeamSummary[]>(() => Array.isArray(state.value?.lastSummary?.teams) ? state.value.lastSummary.teams : []);
const history = computed<PjscHistoryItem[]>(() => Array.isArray(state.value?.history) ? state.value.history : []);
const summaryMessage = computed(() => String(state.value?.lastSummary?.message ?? "").trim());

onMounted(() => {
  void loadState();
});

async function loadState() {
  loading.value = true;
  error.value = "";

  try {
    const response = await apiGet<{ ok: boolean; data: any }>("/api/plugins/pjsc-average-duration/state");
    state.value = response.data ?? null;
    info.value = "";
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function simulateTrigger() {
  busy.value = true;
  error.value = "";
  info.value = "";

  try {
    await apiPost("/api/plugins/pjsc-average-duration/simulate", {
      message: messageText.value,
      playerName: "debug-user",
      steamID: "76561198000000000",
      teamID: 1,
      squadID: 1,
    });
    info.value = "已模拟触发一次广播。";
    await loadState();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function broadcastNow() {
  busy.value = true;
  error.value = "";
  info.value = "";

  try {
    await apiPost("/api/plugins/pjsc-average-duration/broadcast", {
      reason: "manual_debug",
    });
    info.value = "已执行一次手动广播。";
    await loadState();
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
    await apiPost("/api/plugins/pjsc-average-duration/clear", {});
    info.value = "记录已清空。";
    await loadState();
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

function formatHours(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return "暂无数据";
  return `${Number(value).toFixed(1)}h`;
}

function describeHistoryItem(item: PjscHistoryItem) {
  if (item.kind === "trigger") {
    return `触发词命中：${item.message ?? "-"}`;
  }
  if (item.kind === "broadcast") {
    return item.summary?.message || "已广播当前计算结果";
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

.hero-grid,
.team-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
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
  gap: 12px;
  margin: 0;
}

.detail-list > div {
  border-top: 1px solid var(--color-border-soft);
  padding-top: 12px;
}

.detail-list dt,
.detail-list dd {
  margin: 0;
}

.detail-list dd {
  margin-top: 6px;
  color: var(--color-text-primary);
}

.simulate-box {
  display: grid;
  gap: 12px;
}

.input {
  width: 100%;
  min-height: 42px;
  border-radius: 12px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
  padding: 10px 12px;
  outline: none;
}

.actions-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.btn {
  border: 0;
  border-radius: 10px;
  padding: 10px 14px;
  background: var(--color-status-info);
  color: white;
  font-weight: 700;
  cursor: pointer;
}

.btn.ghost {
  background: transparent;
  border: 1px solid var(--color-border-soft);
  color: var(--color-text-primary);
}

.btn:disabled {
  cursor: wait;
  opacity: 0.7;
}

.team-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.team-card {
  border: 1px solid var(--color-border-soft);
  border-radius: 14px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.03);
  display: grid;
  gap: 10px;
}

.team-head,
.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.team-head h3 {
  margin: 0;
}

.team-head span,
.stat-row span {
  color: var(--color-text-muted);
}

.stat-row strong {
  font-size: 15px;
}

.stat-row.muted strong {
  color: var(--color-text-secondary);
}

.preview {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-text-primary);
  min-height: 120px;
  line-height: 1.6;
}

.table-wrap {
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th,
.data-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border-soft);
  text-align: left;
  vertical-align: top;
}

.data-table th {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
}

.empty-state,
.empty-cell {
  color: var(--color-text-muted);
  text-align: center;
}

.truncate {
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 700;
}

.pill.ok {
  background: rgba(54, 179, 126, 0.18);
  color: #6ff0b7;
}

.pill.skip {
  background: rgba(255, 196, 0, 0.18);
  color: #ffd97a;
}

.pill.error {
  background: rgba(244, 91, 105, 0.18);
  color: #ff9aaa;
}

.banner {
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 13px;
}

.banner.error {
  background: rgba(244, 91, 105, 0.15);
  color: #ffb3bc;
}

.banner.info {
  background: rgba(72, 149, 239, 0.15);
  color: #b8d8ff;
}

@media (max-width: 1200px) {
  .hero-grid,
  .team-grid,
  .team-cards,
  .metric-grid,
  .detail-list {
    grid-template-columns: 1fr;
  }
}
</style>
