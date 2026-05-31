<template>
  <section class="page">
    <PageHeader
      title="定时广播"
      subtitle="建立广播列表，统一设置全局开始延迟，逐条配置广播间隔。"
    >
      <template #actions>
        <button type="button" class="refresh-button" :disabled="isFetching" @click="query.refetch()">
          {{ isFetching ? "同步中..." : "刷新" }}
        </button>
      </template>
    </PageHeader>

    <PageCard compact>
      <form class="create-grid" @submit.prevent="createItem">
        <label>
          <span>全局开始延迟(秒)</span>
          <input
            type="number"
            min="0"
            max="86400"
            :value="globalDelaySeconds"
            @input="setGlobalDelay(($event.target as HTMLInputElement).value)"
          />
        </label>
        <div class="actions">
          <button type="submit" class="primary-button" :disabled="createBusy">
            {{ createBusy ? "添加中..." : "添加广播" }}
          </button>
        </div>
      </form>
    </PageCard>

    <PageCard compact class="summary-card">
      <div class="summary">
        <span>总条目：{{ items.length }}</span>
        <span>运行状态：{{ data?.status?.running ? "运行中" : "已停止" }}</span>
        <span>轮询：{{ data?.config?.tickMs ?? "-" }} ms</span>
      </div>
    </PageCard>

    <DataState
      :loading="isLoading && !items.length"
      :error="pageError"
      :empty="!pageError && !items.length && !isLoading"
      empty-title="暂无定时广播"
      empty-text="先创建一条广播任务，然后它会按间隔自动发送。"
    >
      <PageCard compact class="table-card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>启用</th>
                <th>标题</th>
                <th>广播内容</th>
                <th>间隔(秒)</th>
                <th>下次执行</th>
                <th>最近执行</th>
                <th>统计</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in items" :key="item.id">
                <td>
                  <input
                    type="checkbox"
                    :checked="drafts[item.id]?.enabled ?? item.enabled"
                    @change="onToggleEnabled(item.id, ($event.target as HTMLInputElement).checked)"
                  />
                </td>
                <td>
                  <input
                    class="inline-input"
                    :value="drafts[item.id]?.title ?? item.title"
                    maxlength="60"
                    @input="setDraft(item.id, 'title', ($event.target as HTMLInputElement).value)"
                  />
                </td>
                <td>
                  <textarea
                    class="inline-textarea"
                    rows="2"
                    maxlength="180"
                    :value="drafts[item.id]?.message ?? item.message"
                    @input="setDraft(item.id, 'message', ($event.target as HTMLTextAreaElement).value)"
                  />
                </td>
                <td>
                  <input
                    class="inline-input"
                    type="number"
                    min="5"
                    max="86400"
                    :value="index === 0 ? globalDelaySeconds : (drafts[item.id]?.intervalSeconds ?? item.intervalSeconds)"
                    :disabled="index === 0"
                    @input="setDraft(item.id, 'intervalSeconds', Number(($event.target as HTMLInputElement).value))"
                  />
                </td>
                <td>{{ formatTime(item.nextRunAt) }}</td>
                <td>
                  <div>{{ formatTime(item.lastRunAt) }}</div>
                  <div class="hint" v-if="item.lastError">{{ item.lastError }}</div>
                </td>
                <td>
                  <div>成功 {{ item.runCount ?? 0 }}</div>
                  <div>失败 {{ item.errorCount ?? 0 }}</div>
                </td>
                <td>
                  <div class="row-actions">
                    <button type="button" @click="saveItem(item, index)">保存</button>
                    <button type="button" @click="runNow(item.id)">立即执行</button>
                    <button type="button" class="danger" @click="removeItem(item.id)">删除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </PageCard>
    </DataState>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { renderApiError } from "../app/errors";
import {
  createScheduledBroadcastItem,
  deleteScheduledBroadcastItem,
  getScheduledBroadcastState,
  runScheduledBroadcastNow,
  updateScheduledBroadcastItem,
  type ScheduledBroadcastItem,
} from "../app/scheduledBroadcastApi";
import { useUiStore } from "../stores/ui.store";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import DataState from "../components/common/DataState.vue";

type DraftItem = {
  title: string;
  message: string;
  intervalSeconds: number;
  delaySeconds: number;
  enabled: boolean;
};

const ui = useUiStore();
const createBusy = ref(false);
const globalDelaySeconds = ref(10);
const globalDelayTouched = ref(false);

const drafts = reactive<Record<string, DraftItem>>({});

const query = useQuery({
  queryKey: ["scheduled-broadcast-state"],
  queryFn: getScheduledBroadcastState,
  placeholderData: (previousData) => previousData,
  refetchInterval: 2000,
  refetchIntervalInBackground: false,
});

const data = computed(() => query.data.value ?? null);
const items = computed(() => (data.value?.items ?? []).slice().sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0)));
const pageError = computed(() => (query.error.value ? renderApiError(query.error.value, "加载定时广播失败。") : ""));
const isLoading = computed(() => query.isLoading.value);
const isFetching = computed(() => query.isFetching.value);

watch(
  items,
  (nextItems) => {
    const knownIds = new Set(nextItems.map((item) => item.id));
    if (!globalDelayTouched.value) {
      const firstDelay = Number(nextItems[0]?.delaySeconds);
      globalDelaySeconds.value = Number.isFinite(firstDelay) ? Math.max(0, Math.floor(firstDelay)) : 10;
    }

    for (const item of nextItems) {
      drafts[item.id] = {
        title: item.title ?? "",
        message: item.message ?? "",
        intervalSeconds: item.intervalSeconds ?? 300,
        delaySeconds: item.delaySeconds ?? 10,
        enabled: Boolean(item.enabled),
      };
    }

    for (const id of Object.keys(drafts)) {
      if (!knownIds.has(id)) {
        delete drafts[id];
      }
    }
  },
  { immediate: true },
);

function setGlobalDelay(value: string) {
  globalDelayTouched.value = true;
  globalDelaySeconds.value = clampInt(value, 0, 86400, globalDelaySeconds.value);
}

function setDraft(id: string, key: keyof DraftItem, value: string | number | boolean) {
  if (!drafts[id]) return;
  if (key === "intervalSeconds" || key === "delaySeconds") {
    drafts[id][key] = Number.isFinite(Number(value)) ? Number(value) : drafts[id][key];
    return;
  }
  if (key === "enabled") {
    drafts[id][key] = Boolean(value);
    return;
  }
  drafts[id][key] = String(value);
}

async function createItem() {
  createBusy.value = true;
  try {
    const initialDelay = clampInt(globalDelaySeconds.value, 0, 86400, 10);
    const payload: { message: string; delaySeconds: number; intervalSeconds?: number } = {
      message: "",
      delaySeconds: initialDelay,
    };
    if (!items.value.length) {
      payload.intervalSeconds = Math.max(5, initialDelay);
    }
    await createScheduledBroadcastItem(payload);

    ui.pushToast({ title: "添加成功", message: "已生成空白广播模板，请补充内容后保存。", tone: "ok" });
    await query.refetch();
  } catch (error) {
    ui.pushToast({ title: "添加失败", message: error instanceof Error ? error.message : String(error), tone: "error" });
  } finally {
    createBusy.value = false;
  }
}

async function saveItem(item: ScheduledBroadcastItem, index: number) {
  const draft = drafts[item.id];
  if (!draft) return;

  const message = String(draft.message ?? "").trim();
  if (!message) {
    ui.pushToast({ title: "保存失败", message: "广播内容不能为空。", tone: "warn" });
    return;
  }

  try {
    const nextInterval = index === 0
      ? Math.max(5, clampInt(globalDelaySeconds.value, 0, 86400, item.intervalSeconds))
      : clampInt(draft.intervalSeconds, 5, 86400, item.intervalSeconds);

    await updateScheduledBroadcastItem(item.id, {
      title: String(draft.title ?? "").trim(),
      message,
      intervalSeconds: nextInterval,
      delaySeconds: clampInt(globalDelaySeconds.value, 0, 86400, item.delaySeconds),
      enabled: Boolean(draft.enabled),
      resetSchedule: true,
    });
    ui.pushToast({ title: "保存成功", message: "该条广播配置已更新。", tone: "ok" });
    await query.refetch();
  } catch (error) {
    ui.pushToast({ title: "保存失败", message: error instanceof Error ? error.message : String(error), tone: "error" });
  }
}

async function onToggleEnabled(id: string, checked: boolean) {
  if (!drafts[id]) return;
  drafts[id].enabled = checked;
  try {
    const index = items.value.findIndex((item) => item.id === id);
    const patch: Partial<{ enabled: boolean; delaySeconds: number; intervalSeconds: number; resetSchedule: boolean }> = {
      enabled: checked,
      resetSchedule: true,
    };
    if (checked) {
      patch.delaySeconds = clampInt(globalDelaySeconds.value, 0, 86400, drafts[id].delaySeconds);
      if (index === 0) {
        patch.intervalSeconds = Math.max(5, patch.delaySeconds);
      }
    }

    await updateScheduledBroadcastItem(id, {
      ...patch,
    });
    await query.refetch();
  } catch (error) {
    ui.pushToast({ title: "更新失败", message: error instanceof Error ? error.message : String(error), tone: "error" });
  }
}

async function runNow(id: string) {
  try {
    const result = await runScheduledBroadcastNow(id, "manual_run");
    if (!result?.result?.success) {
      throw new Error(result?.result?.errorMessage || "执行失败");
    }
    ui.pushToast({ title: "执行成功", message: "广播已立即触发。", tone: "ok" });
    await query.refetch();
  } catch (error) {
    ui.pushToast({ title: "执行失败", message: error instanceof Error ? error.message : String(error), tone: "error" });
  }
}

async function removeItem(id: string) {
  if (!window.confirm("确定删除这条定时广播吗？")) return;
  try {
    await deleteScheduledBroadcastItem(id);
    ui.pushToast({ title: "已删除", message: "该条广播已移除。", tone: "ok" });
    await query.refetch();
  } catch (error) {
    ui.pushToast({ title: "删除失败", message: error instanceof Error ? error.message : String(error), tone: "error" });
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function formatTime(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "-";
  return new Date(num).toLocaleString();
}
</script>

<style scoped>
.page {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.create-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  align-items: flex-end;
}

.create-grid label {
  display: grid;
  gap: 6px;
  color: #d6dee6;
  font-size: 12px;
}

.create-grid .wide {
  grid-column: 1 / -1;
}

.create-grid .actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.create-grid input,
.create-grid textarea,
.inline-input,
.inline-textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid #38414c;
  background: #11171d;
  color: #edf2f4;
  border-radius: 8px;
  padding: 8px 10px;
  min-height: 36px;
}

.inline-textarea {
  min-height: 70px;
  resize: vertical;
}

.toggle-label {
  align-items: center;
}

.actions {
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
}

.primary-button,
.refresh-button,
.row-actions button {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid #31404f;
  border-radius: 8px;
  background: #16202a;
  color: #edf2f4;
}

.primary-button {
  border-color: rgba(96, 165, 250, 0.45);
  background: linear-gradient(180deg, rgba(96, 165, 250, 0.18), rgba(96, 165, 250, 0.08));
}

.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  color: #d5dee7;
  font-size: 13px;
}

.table-card {
  min-height: 0;
}

.table-wrap {
  overflow: auto;
  max-height: 100%;
}

table {
  width: 100%;
  border-collapse: collapse;
  min-width: 1080px;
}

th,
td {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 10px;
  text-align: left;
  vertical-align: top;
  font-size: 12px;
}

.hint {
  margin-top: 4px;
  color: #fda4af;
}

.row-actions {
  display: grid;
  gap: 8px;
}

.row-actions .danger {
  border-color: rgba(248, 113, 113, 0.45);
  color: #fecaca;
}

@media (max-width: 960px) {
  .create-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
