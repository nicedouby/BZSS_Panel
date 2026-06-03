<template>
  <section class="page">
    <PageHeader
      title="广播模块"
      subtitle="包含警告与广播两个子功能。警告会针对单个玩家发送，广播则面向全服发送消息。"
    >
      <template #actions>
        <button type="button" class="refresh-button" :disabled="isFetching" @click="query.refetch()">
          {{ isFetching ? "同步中..." : t("common.refresh") }}
        </button>
      </template>
    </PageHeader>

    <PageCard compact class="tab-card">
      <div class="tab-strip" role="tablist" aria-label="广播模块功能切换">
        <button
          type="button"
          class="tab-button"
          :class="{ active: activeTab === 'warning' }"
          :aria-pressed="activeTab === 'warning'"
          @click="activeTab = 'warning'"
        >
          警告
        </button>
        <button
          type="button"
          class="tab-button"
          :class="{ active: activeTab === 'broadcast' }"
          :aria-pressed="activeTab === 'broadcast'"
          @click="activeTab = 'broadcast'"
        >
          广播
        </button>
      </div>
    </PageCard>

    <PageCard compact class="form-card">
      <div v-if="activeTab === 'warning'" class="form-grid">
        <label>
          <span>目标玩家</span>
          <input v-model="warningForm.targetName" type="text" placeholder="玩家名称" />
        </label>
        <label>
          <span>Steam ID</span>
          <input v-model="warningForm.targetSteamId" type="text" placeholder="可选" />
        </label>
        <label>
          <span>EOS ID</span>
          <input v-model="warningForm.targetEosId" type="text" placeholder="可选" />
        </label>
        <label class="wide">
          <span>警告内容</span>
          <textarea v-model="warningForm.message" rows="4" placeholder="请输入警告内容"></textarea>
        </label>
        <label class="wide">
          <span>原因</span>
          <input v-model="warningForm.reason" type="text" placeholder="manual_warn" />
        </label>
        <label class="wide">
          <span>来源模块</span>
          <input v-model="warningForm.sourceModule" type="text" placeholder="web.broadcastModule" />
        </label>
        <div class="actions wide">
          <button type="button" class="primary-button" :disabled="warningBusy" @click="sendWarning">
            {{ warningBusy ? "发送中..." : "发送警告" }}
          </button>
        </div>
      </div>

      <div v-else class="form-grid">
        <label class="wide">
          <span>广播内容</span>
          <textarea v-model="broadcastForm.message" rows="5" placeholder="请输入广播内容"></textarea>
        </label>
        <label class="wide">
          <span>原因</span>
          <input v-model="broadcastForm.reason" type="text" placeholder="manual_broadcast" />
        </label>
        <label class="wide">
          <span>来源模块</span>
          <input v-model="broadcastForm.sourceModule" type="text" placeholder="web.broadcastModule" />
        </label>
        <div class="actions wide">
          <button type="button" class="primary-button" :disabled="broadcastBusy" @click="sendBroadcast">
            {{ broadcastBusy ? "发送中..." : "发送广播" }}
          </button>
        </div>
      </div>
    </PageCard>

    <PageCard compact class="summary-card">
      <div class="summary">
        <span>当前模式：{{ activeTabLabel }}</span>
        <span>总计：{{ data?.total ?? records.length }} 条</span>
        <span v-if="data?.config">最大保留：{{ data.config.maxRecords ?? "-" }} 条</span>
        <span v-if="data?.config">TTL：{{ formatMinutes(data.config.ttlMs) }}</span>
        <span v-if="data?.config && !data.config.enabled">模块已禁用</span>
      </div>
    </PageCard>

    <PageCard compact class="filter-card">
      <div v-if="activeTab === 'warning'" class="toolbar">
        <input v-model="warningFilters.targetName" placeholder="按目标玩家筛选" />
        <input v-model="warningFilters.sourceModule" placeholder="来源模块" />
        <input v-model="warningFilters.reason" placeholder="原因" />
        <select v-model="warningFilters.success">
          <option value="">全部结果</option>
          <option value="true">成功</option>
          <option value="false">失败</option>
        </select>
        <select v-model="warningFilters.skipped">
          <option value="">全部状态</option>
          <option value="true">已跳过</option>
          <option value="false">未跳过</option>
        </select>
        <select v-model="warningFilters.limit">
          <option :value="50">50</option>
          <option :value="100">100</option>
          <option :value="200">200</option>
          <option :value="500">500</option>
        </select>
        <button type="button" @click="resetFilters">清空筛选</button>
      </div>

      <div v-else class="toolbar">
        <input v-model="broadcastFilters.sourceModule" placeholder="来源模块" />
        <input v-model="broadcastFilters.reason" placeholder="原因" />
        <select v-model="broadcastFilters.success">
          <option value="">全部结果</option>
          <option value="true">成功</option>
          <option value="false">失败</option>
        </select>
        <select v-model="broadcastFilters.skipped">
          <option value="">全部状态</option>
          <option value="true">已跳过</option>
          <option value="false">未跳过</option>
        </select>
        <select v-model="broadcastFilters.limit">
          <option :value="50">50</option>
          <option :value="100">100</option>
          <option :value="200">200</option>
          <option :value="500">500</option>
        </select>
        <button type="button" @click="resetFilters">清空筛选</button>
      </div>
    </PageCard>

    <DataState
      :loading="isLoading && !records.length"
      :error="pageError"
      :empty="!pageError && !records.length && !isLoading"
      empty-title="暂无记录"
      empty-text="当前筛选条件下没有可显示的记录。"
    >
      <PageCard compact class="table-card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>来源模块</th>
                <th>原因</th>
                <th v-if="activeTab === 'warning'">目标玩家</th>
                <th>消息</th>
                <th>结果</th>
                <th>跳过</th>
                <th>跳过原因</th>
                <th>错误信息</th>
                <th>关联事件 ID</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in records" :key="item.id">
                <td>{{ formatTime(item.createdAt) }}</td>
                <td>{{ item.sourceModule || "-" }}</td>
                <td>{{ item.reason || "-" }}</td>
                <td v-if="activeTab === 'warning'">{{ item.targetName || "-" }}</td>
                <td class="message-cell">{{ item.message || "-" }}</td>
                <td>
                  <span class="result-chip" :data-tone="item.success ? 'ok' : 'error'">
                    {{ item.success ? "成功" : "失败" }}
                  </span>
                </td>
                <td>
                  <span class="result-chip" :data-tone="item.skipped ? 'warn' : 'idle'">
                    {{ item.skipped ? "已跳过" : "未跳过" }}
                  </span>
                </td>
                <td>{{ item.skipReason || "-" }}</td>
                <td class="message-cell">{{ item.errorMessage || "-" }}</td>
                <td class="id-cell">{{ item.relatedEventId || "-" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </PageCard>
    </DataState>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiGet } from "../app/apiClient";
import { broadcastMessage, warnPlayer } from "../app/squadManagementApi";
import { renderApiError } from "../app/errors";
import { useUiStore } from "../stores/ui.store";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import DataState from "../components/common/DataState.vue";
import { t } from "../i18n";

type TabKind = "warning" | "broadcast";

interface ModuleRecord {
  id: string;
  kind?: string;
  createdAt?: number;
  sourceModule?: string;
  reason?: string;
  targetName?: string;
  message?: string;
  success?: boolean;
  skipped?: boolean;
  skipReason?: string;
  errorMessage?: string;
  relatedEventId?: string;
}

interface ModuleRecentResponse {
  records: ModuleRecord[];
  total: number;
  config?: {
    enabled?: boolean;
    maxRecords?: number;
    ttlMs?: number;
  } | null;
}

const ui = useUiStore();
const activeTab = ref<TabKind>("warning");
const warningBusy = ref(false);
const broadcastBusy = ref(false);

const warningForm = reactive({
  targetName: "",
  targetSteamId: "",
  targetEosId: "",
  message: "",
  reason: "manual_warn",
  sourceModule: "web.broadcastModule",
});

const broadcastForm = reactive({
  message: "",
  reason: "manual_broadcast",
  sourceModule: "web.broadcastModule",
});

const warningFilters = reactive({
  targetName: "",
  sourceModule: "",
  reason: "",
  success: "",
  skipped: "",
  limit: 200,
});

const broadcastFilters = reactive({
  targetName: "",
  sourceModule: "",
  reason: "",
  success: "",
  skipped: "",
  limit: 200,
});

const REFRESH_INTERVAL_MS = 8000;
const TIME_CACHE_MAX = 4000;
const timeCache = new Map<number, string>();

const query = useQuery({
  queryKey: computed(() => [
    "broadcast-module",
    activeTab.value,
    activeTab.value === "warning" ? warningFilters.targetName : "",
    activeTab.value === "warning" ? warningFilters.sourceModule : broadcastFilters.sourceModule,
    activeTab.value === "warning" ? warningFilters.reason : broadcastFilters.reason,
    activeTab.value === "warning" ? warningFilters.success : broadcastFilters.success,
    activeTab.value === "warning" ? warningFilters.skipped : broadcastFilters.skipped,
    activeTab.value === "warning" ? warningFilters.limit : broadcastFilters.limit,
  ]),
  queryFn: async () => {
    const filters = activeTab.value === "warning" ? warningFilters : broadcastFilters;
    const params = new URLSearchParams({
      kind: activeTab.value,
      limit: String(filters.limit),
    });

    if (activeTab.value === "warning" && filters.targetName.trim()) {
      params.set("targetName", filters.targetName.trim());
    }
    if (filters.sourceModule.trim()) {
      params.set("sourceModule", filters.sourceModule.trim());
    }
    if (filters.reason.trim()) {
      params.set("reason", filters.reason.trim());
    }
    if (filters.success) {
      params.set("success", filters.success);
    }
    if (filters.skipped) {
      params.set("skipped", filters.skipped);
    }

    return apiGet<ModuleRecentResponse>(`/api/admin-warns/recent?${params.toString()}`);
  },
  placeholderData: (previousData) => previousData,
  refetchInterval: REFRESH_INTERVAL_MS,
  refetchIntervalInBackground: false,
});

const data = computed(() => query.data.value ?? null);
const records = computed(() => data.value?.records ?? []);
const pageError = computed(() => (query.error.value ? renderApiError(query.error.value, "加载广播记录失败。") : ""));
const activeTabLabel = computed(() => (activeTab.value === "warning" ? "警告" : "广播"));
const isFetching = computed(() => query.isFetching.value);
const isLoading = computed(() => query.isLoading.value);

async function sendWarning() {
  const targetName = warningForm.targetName.trim();
  const message = warningForm.message.trim();
  if (!targetName || !message) {
    ui.pushToast({ title: "无法发送", message: "请先填写目标玩家和警告内容。", tone: "warn" });
    return;
  }

  warningBusy.value = true;
  try {
    const result = await warnPlayer({
      targetName,
      targetSteamId: warningForm.targetSteamId.trim() || undefined,
      targetEosId: warningForm.targetEosId.trim() || undefined,
      message,
      reason: warningForm.reason.trim() || "manual_warn",
      sourceModule: warningForm.sourceModule.trim() || "web.broadcastModule",
    });
    if (!result.success) {
      throw new Error(result.errorMessage || result.message || "警告发送失败。");
    }
    warningForm.message = "";
    ui.pushToast({ title: "已发送警告", message: `目标玩家：${targetName}`, tone: "ok" });
    await query.refetch();
  } catch (error) {
    ui.pushToast({ title: "警告失败", message: error instanceof Error ? error.message : String(error), tone: "error" });
  } finally {
    warningBusy.value = false;
  }
}

async function sendBroadcast() {
  const message = broadcastForm.message.trim();
  if (!message) {
    ui.pushToast({ title: "无法发送", message: "请先填写广播内容。", tone: "warn" });
    return;
  }

  broadcastBusy.value = true;
  try {
    const result = await broadcastMessage({
      message,
      reason: broadcastForm.reason.trim() || "manual_broadcast",
      sourceModule: broadcastForm.sourceModule.trim() || "web.broadcastModule",
    });
    if (!result.success) {
      throw new Error(result.errorMessage || result.message || "广播发送失败。");
    }
    broadcastForm.message = "";
    ui.pushToast({ title: "已发送广播", message: "全服广播请求已送达。", tone: "ok" });
    await query.refetch();
  } catch (error) {
    ui.pushToast({ title: "广播失败", message: error instanceof Error ? error.message : String(error), tone: "error" });
  } finally {
    broadcastBusy.value = false;
  }
}

function resetFilters() {
  if (activeTab.value === "warning") {
    warningFilters.targetName = "";
    warningFilters.sourceModule = "";
    warningFilters.reason = "";
    warningFilters.success = "";
    warningFilters.skipped = "";
    warningFilters.limit = 200;
    return;
  }

  broadcastFilters.sourceModule = "";
  broadcastFilters.reason = "";
  broadcastFilters.success = "";
  broadcastFilters.skipped = "";
  broadcastFilters.limit = 200;
}

function formatTime(value: unknown) {
  const number = Number(value ?? 0);
  if (Number.isFinite(number) && number > 0) {
    const cached = timeCache.get(number);
    if (cached) return cached;
    const formatted = new Date(number).toLocaleString();
    timeCache.set(number, formatted);
    if (timeCache.size > TIME_CACHE_MAX) timeCache.clear();
    return formatted;
  }
  return String(value ?? "-");
}

function formatMinutes(value: unknown) {
  const ms = Number(value ?? 0);
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  return `${Math.round(ms / 60000)} 分钟`;
}
</script>

<style scoped>
.page {
  display: grid;
  grid-template-rows: auto auto auto auto minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.tab-card,
.form-card,
.summary-card,
.filter-card,
.table-card {
  min-width: 0;
}

.tab-strip {
  display: inline-flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tab-button {
  min-height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid #31404f;
  background: #11171d;
  color: #d7e1ea;
  font-size: 13px;
  font-weight: 600;
}

.tab-button.active {
  border-color: rgba(96, 165, 250, 0.45);
  background: rgba(96, 165, 250, 0.12);
  color: #f4f8fb;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.form-grid label {
  display: grid;
  gap: 6px;
  color: #d6dee6;
  font-size: 12px;
}

.form-grid .wide {
  grid-column: 1 / -1;
}

.form-grid input,
.form-grid textarea,
.toolbar input,
.toolbar select {
  width: 100%;
  min-width: 0;
  border: 1px solid #38414c;
  background: #11171d;
  color: #edf2f4;
  border-radius: 8px;
  padding: 8px 10px;
  min-height: 36px;
}

.form-grid textarea {
  resize: vertical;
  min-height: 100px;
}

.actions {
  display: flex;
  justify-content: flex-end;
}

.primary-button,
.refresh-button,
.toolbar button {
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid #31404f;
  border-radius: 8px;
  background: #16202a;
  color: #edf2f4;
}

.primary-button {
  border-color: rgba(96, 165, 250, 0.45);
  background: linear-gradient(180deg, rgba(96, 165, 250, 0.18), rgba(96, 165, 250, 0.08));
}

.toolbar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.summary {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
  color: #a5b0b8;
  font-size: 12px;
}

.table-wrap {
  overflow: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid #26303a;
  vertical-align: top;
  white-space: nowrap;
}

th {
  color: #98a5af;
  font-size: 11px;
  font-weight: 600;
}

.message-cell,
.id-cell {
  white-space: normal;
  min-width: 180px;
}

.result-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid #32404d;
  background: #10171d;
  color: #dbe2e8;
  font-size: 11px;
}

.result-chip[data-tone="ok"] {
  border-color: rgba(74, 222, 128, 0.35);
  background: rgba(74, 222, 128, 0.08);
}

.result-chip[data-tone="warn"] {
  border-color: rgba(251, 191, 36, 0.35);
  background: rgba(251, 191, 36, 0.08);
}

.result-chip[data-tone="error"] {
  border-color: rgba(248, 113, 113, 0.35);
  background: rgba(248, 113, 113, 0.08);
}

.result-chip[data-tone="idle"] {
  color: #9aa7b2;
}

@media (max-width: 1100px) {
  .form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
