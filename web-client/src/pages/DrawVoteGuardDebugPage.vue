<template>
  <section class="page-shell">
    <PageHeader
      eyebrow="Plugin Debug"
      title="平局投票阶段提示"
      subtitle="监听 round.match_winner 平局事件，延迟 25 秒后广播“投票阶段禁止带节奏。”"
    >
      <template #actions>
        <button type="button" class="btn ghost" :disabled="loading" @click="loadState">
          {{ loading ? "刷新中..." : "刷新状态" }}
        </button>
        <button type="button" class="btn" :disabled="busy" @click="simulateNow(false)">
          {{ busy ? "执行中..." : "模拟触发(立即)" }}
        </button>
        <button type="button" class="btn ghost" :disabled="busy" @click="simulateNow(true)">
          {{ busy ? "执行中..." : "模拟触发(延迟25秒)" }}
        </button>
      </template>
    </PageHeader>

    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="info" class="banner info">{{ info }}</div>

    <div class="cards-grid">
      <PageCard title="运行状态" description="插件、订阅和延迟参数" compact>
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
            <strong>{{ state?.delaySeconds ?? 25 }} 秒</strong>
          </div>
          <div class="metric">
            <span class="label">待发送</span>
            <strong>{{ state?.pendingCount ?? 0 }}</strong>
          </div>
        </div>

        <dl class="detail-list">
          <div>
            <dt>累计触发</dt>
            <dd>{{ state?.triggerCount ?? 0 }}</dd>
          </div>
          <div>
            <dt>累计广播</dt>
            <dd>{{ state?.broadcastCount ?? 0 }}</dd>
          </div>
          <div>
            <dt>最近触发</dt>
            <dd>{{ formatTime(state?.lastTriggerAt) }}</dd>
          </div>
          <div>
            <dt>最近广播</dt>
            <dd>{{ formatTime(state?.lastBroadcastAt) }}</dd>
          </div>
          <div class="full-row">
            <dt>广播内容</dt>
            <dd>{{ state?.broadcastMessage || "投票阶段禁止带节奏。" }}</dd>
          </div>
          <div class="full-row">
            <dt>最近错误</dt>
            <dd>{{ state?.lastError || "无" }}</dd>
          </div>
        </dl>
      </PageCard>

      <PageCard title="调试操作" description="手动模拟事件触发与历史清理" compact>
        <div class="ops-box">
          <label class="label" for="map-input">模拟地图名</label>
          <input id="map-input" v-model.trim="mapName" type="text" class="input" placeholder="例如：Sumari Bala" />

          <label class="label" for="winner-input">模拟 winner 字段</label>
          <input id="winner-input" v-model.trim="winnerText" type="text" class="input" placeholder="默认 draw" />

          <div class="actions-row">
            <button type="button" class="btn danger" :disabled="busy" @click="clearHistory">
              清空历史
            </button>
          </div>
        </div>
      </PageCard>
    </div>

    <PageCard title="最近事件" description="用于追踪触发和广播链路" compact>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>结果</th>
              <th>原因</th>
              <th>地图</th>
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
              <td class="truncate">{{ item.reason || "-" }}</td>
              <td class="truncate">{{ item.event?.mapName || "-" }}</td>
              <td class="truncate">{{ describeItem(item) }}</td>
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

type DebugItem = {
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
    mapName?: string;
    winner?: string;
  };
  result?: {
    errorMessage?: string;
    skipReason?: string;
  };
};

const loading = ref(false);
const busy = ref(false);
const error = ref("");
const info = ref("");
const state = ref<any>(null);

const mapName = ref("Sumari Bala");
const winnerText = ref("draw");

const history = computed<DebugItem[]>(() => Array.isArray(state.value?.history) ? state.value.history : []);

onMounted(() => {
  void loadState();
});

async function loadState() {
  loading.value = true;
  error.value = "";

  try {
    const response = await apiGet<{ ok: boolean; data: any }>("/api/plugins/draw-vote-guard/state");
    state.value = response.data ?? null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function simulateNow(applyDelay: boolean) {
  busy.value = true;
  error.value = "";
  info.value = "";

  try {
    await apiPost("/api/plugins/draw-vote-guard/simulate", {
      winner: winnerText.value || "draw",
      mapName: mapName.value || "UnknownMap",
      applyDelay,
    });

    info.value = applyDelay
      ? "已模拟触发，广播将在延迟时间后发送。"
      : "已模拟触发并立即执行广播。";

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
    await apiPost("/api/plugins/draw-vote-guard/clear", {});
    info.value = "历史记录已清空。";
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

function describeItem(item: DebugItem) {
  if (item.kind === "trigger") {
    const delayText = Number.isFinite(Number(item.delayMs)) ? `延迟 ${Math.floor(Number(item.delayMs) / 1000)} 秒` : "";
    return `${item.message ?? ""} ${delayText}`.trim() || "触发事件";
  }

  if (item.kind === "broadcast") {
    return item.result?.errorMessage || item.result?.skipReason || item.errorMessage || item.message || "已执行广播";
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
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
  padding: 10px 12px;
  outline: none;
}

.actions-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 2px;
}

.btn {
  border: 1px solid var(--color-status-info);
  background: var(--color-status-info);
  color: #fff;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.btn.ghost {
  border-color: var(--color-border-soft);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-primary);
}

.btn.danger {
  border-color: var(--color-status-danger);
  background: var(--color-status-danger);
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.banner {
  border-radius: 12px;
  padding: 10px 12px;
  border: 1px solid transparent;
  font-size: 13px;
}

.banner.error {
  color: #fecaca;
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.3);
}

.banner.info {
  color: #bfdbfe;
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.3);
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
  text-align: left;
  border-bottom: 1px solid var(--color-border-soft);
  font-size: 13px;
}

.data-table th {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
}

.pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  border: 1px solid transparent;
}

.pill.ok {
  color: #bbf7d0;
  background: rgba(34, 197, 94, 0.16);
  border-color: rgba(34, 197, 94, 0.35);
}

.pill.skip {
  color: #fde68a;
  background: rgba(250, 204, 21, 0.16);
  border-color: rgba(250, 204, 21, 0.35);
}

.pill.error {
  color: #fecaca;
  background: rgba(239, 68, 68, 0.16);
  border-color: rgba(239, 68, 68, 0.35);
}

.empty-cell {
  text-align: center;
  color: var(--color-text-muted);
}

.truncate {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 960px) {
  .cards-grid {
    grid-template-columns: 1fr;
  }

  .metric-grid,
  .detail-list {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .page-shell {
    gap: 10px;
    padding: 10px;
  }

  .metric,
  .detail-list > div {
    min-width: 0;
  }

  .detail-list dd {
    overflow-wrap: anywhere;
  }
}
</style>
