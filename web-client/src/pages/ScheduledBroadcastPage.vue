<template>
  <section class="bz-page scheduled-broadcast-page">
    <PageHeader
      title="定时广播"
      subtitle="首条广播的间隔同时作为全局开始延迟，列表顺序决定执行顺序。"
    >
      <template #actions>
        <button type="button" class="bz-btn bz-btn-ghost" :disabled="isFetching" @click="query.refetch()">
          {{ isFetching ? "同步中..." : "刷新" }}
        </button>
      </template>
    </PageHeader>

    <section class="bz-card">
      <div class="bz-card-body compact create-bar">
        <div class="summary">
          <span class="bz-badge">总条目 {{ items.length }}</span>
          <span class="bz-badge">运行状态 {{ data?.status?.running ? "运行中" : "已停止" }}</span>
          <span class="bz-badge">轮询 {{ data?.config?.tickMs ?? "-" }} ms</span>
          <span class="bz-badge bz-badge-info">全局开始延迟 {{ globalDelaySeconds }} 秒</span>
        </div>
        <div class="create-actions">
          <p class="create-hint">首条间隔自动同步为全局开始延迟，可直接用上下按钮调整广播顺序。</p>
          <button type="button" class="bz-btn bz-btn-primary" :disabled="createBusy" @click="createItem">
            {{ createBusy ? "添加中..." : "添加广播" }}
          </button>
        </div>
      </div>
    </section>

    <DataState :loading="isLoading && !items.length" :error="pageError">
      <div v-if="items.length > 0" class="broadcast-list">
        <article v-for="(item, index) in items" :key="item.id" class="bz-card broadcast-card">
          <div class="broadcast-card-grid">
            <div class="broadcast-side">
              <label class="broadcast-enabled">
                <input
                  type="checkbox"
                  :checked="drafts[item.id]?.enabled ?? item.enabled"
                  @change="onToggleEnabled(item.id, ($event.target as HTMLInputElement).checked)"
                />
                <span>{{ drafts[item.id]?.enabled ?? item.enabled ? "启用" : "停用" }}</span>
              </label>

              <div class="broadcast-order">
                <button
                  type="button"
                  class="order-btn"
                  :disabled="index === 0 || reorderBusy"
                  @click="moveItem(index, -1)"
                >
                  ↑
                </button>
                <span class="order-index">{{ index + 1 }}</span>
                <button
                  type="button"
                  class="order-btn"
                  :disabled="index === items.length - 1 || reorderBusy"
                  @click="moveItem(index, 1)"
                >
                  ↓
                </button>
              </div>
            </div>

            <div class="broadcast-main">
              <div class="broadcast-head">
                <div class="broadcast-labels">
                  <span class="broadcast-rank">{{ index === 0 ? "首条广播" : `第 ${index + 1} 条广播` }}</span>
                  <span v-if="index === 0" class="broadcast-sync-tip">首条间隔 = 全局开始延迟</span>
                </div>
                <div class="broadcast-status-row">
                  <span class="bz-badge">下次 {{ formatTime(item.nextRunAt) }}</span>
                  <span class="bz-badge">上次 {{ formatTime(item.lastRunAt) }}</span>
                  <span class="bz-badge">成功 {{ item.runCount ?? 0 }}</span>
                  <span class="bz-badge bz-badge-danger">失败 {{ item.errorCount ?? 0 }}</span>
                </div>
              </div>

              <label class="broadcast-field broadcast-message">
                <span>广播内容</span>
                <textarea
                  class="inline-textarea"
                  rows="3"
                  maxlength="180"
                  :value="drafts[item.id]?.message ?? item.message"
                  placeholder="请输入广播内容"
                  @input="setDraft(item.id, 'message', ($event.target as HTMLTextAreaElement).value)"
                />
              </label>

              <p v-if="item.lastError" class="broadcast-error">最近错误：{{ item.lastError }}</p>
            </div>

            <div class="broadcast-right">
              <label class="broadcast-field">
                <span>{{ index === 0 ? "首条间隔 / 全局开始延迟（秒）" : "广播间隔（秒）" }}</span>
                <input
                  class="inline-input"
                  type="number"
                  min="5"
                  max="86400"
                  :value="drafts[item.id]?.intervalSeconds ?? item.intervalSeconds"
                  @input="onIntervalInput(item.id, ($event.target as HTMLInputElement).value)"
                />
              </label>

              <div class="broadcast-meta">
                <span>开始延迟：{{ index === 0 ? (drafts[item.id]?.intervalSeconds ?? item.intervalSeconds) : globalDelaySeconds }} 秒</span>
                <span>更新时间：{{ formatTime(item.updatedAt) }}</span>
                <span>创建时间：{{ formatTime(item.createdAt) }}</span>
              </div>

              <div class="broadcast-actions">
                <button type="button" class="bz-btn bz-btn-primary" @click="saveItem(item, index)">保存</button>
                <button type="button" class="bz-btn bz-btn-ghost" @click="runNow(item.id)">立即执行</button>
                <button type="button" class="bz-btn bz-btn-danger" @click="removeItem(item.id)">删除</button>
              </div>
            </div>
          </div>
        </article>
      </div>

      <div v-else class="bz-empty">
        <div class="bz-empty-inner">
          <div class="bz-empty-icon">-</div>
          <div class="bz-empty-title">暂无定时广播</div>
          <div class="bz-empty-desc">
            先添加一条广播，再补充内容与间隔。首条广播的间隔会自动作为全局开始延迟。
          </div>
        </div>
      </div>
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
  reorderScheduledBroadcastItems,
  runScheduledBroadcastNow,
  updateScheduledBroadcastItem,
  type ScheduledBroadcastItem,
} from "../app/scheduledBroadcastApi";
import { useUiStore } from "../stores/ui.store";
import PageHeader from "../components/common/PageHeader.vue";
import DataState from "../components/common/DataState.vue";

type DraftItem = {
  message: string;
  intervalSeconds: number;
  enabled: boolean;
};

const ui = useUiStore();
const createBusy = ref(false);
const reorderBusy = ref(false);
const drafts = reactive<Record<string, DraftItem>>({});
const dirtyDrafts = reactive<Record<string, boolean>>({});

const query = useQuery({
  queryKey: ["scheduled-broadcast-state"],
  queryFn: getScheduledBroadcastState,
  placeholderData: (previousData) => previousData,
  refetchInterval: 2000,
  refetchIntervalInBackground: false,
});

const data = computed(() => query.data.value ?? null);
const items = computed(() => (data.value?.items ?? []).slice().sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0)));
const globalDelaySeconds = computed(() => {
  const first = items.value[0];
  if (!first) return 10;
  return clampInt(drafts[first.id]?.intervalSeconds ?? first.intervalSeconds ?? first.delaySeconds, 5, 86400, 10);
});
const pageError = computed(() => (query.error.value ? renderApiError(query.error.value, "加载定时广播失败。") : ""));
const isLoading = computed(() => query.isLoading.value);
const isFetching = computed(() => query.isFetching.value);

watch(
  items,
  (nextItems) => {
    const knownIds = new Set(nextItems.map((item) => item.id));

    for (const item of nextItems) {
      if (!drafts[item.id]) {
        drafts[item.id] = {
          message: item.message ?? "",
          intervalSeconds: item.intervalSeconds ?? 300,
          enabled: Boolean(item.enabled),
        };
        dirtyDrafts[item.id] = false;
        continue;
      }

      if (dirtyDrafts[item.id]) {
        continue;
      }

      drafts[item.id] = {
        message: item.message ?? "",
        intervalSeconds: item.intervalSeconds ?? 300,
        enabled: Boolean(item.enabled),
      };
    }

    for (const id of Object.keys(drafts)) {
      if (!knownIds.has(id)) {
        delete drafts[id];
        delete dirtyDrafts[id];
      }
    }
  },
  { immediate: true },
);

function setDraft(id: string, key: keyof DraftItem, value: string | number | boolean) {
  if (!drafts[id]) return;
  dirtyDrafts[id] = true;
  if (key === "intervalSeconds") {
    drafts[id][key] = Number.isFinite(Number(value)) ? Number(value) : drafts[id][key];
    return;
  }
  if (key === "enabled") {
    drafts[id][key] = Boolean(value);
    return;
  }
  drafts[id][key] = String(value);
}

function onIntervalInput(id: string, value: string) {
  if (!drafts[id]) return;
  const fallback = drafts[id].intervalSeconds;
  const nextValue = clampInt(value, 5, 86400, fallback);
  drafts[id].intervalSeconds = nextValue;
}

async function createItem() {
  createBusy.value = true;
  try {
    const initialDelay = globalDelaySeconds.value;
    await createScheduledBroadcastItem({
      message: "",
      delaySeconds: initialDelay,
      intervalSeconds: items.value.length ? 300 : initialDelay,
    });

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
    const nextInterval = clampInt(draft.intervalSeconds, 5, 86400, item.intervalSeconds);
    const nextDelay = index === 0 ? nextInterval : globalDelaySeconds.value;

    await updateScheduledBroadcastItem(item.id, {
      message,
      intervalSeconds: nextInterval,
      delaySeconds: nextDelay,
      enabled: Boolean(draft.enabled),
      resetSchedule: true,
    });

    if (index === 0) {
      await syncFollowerDelays(nextInterval, item.id);
    }

    dirtyDrafts[item.id] = false;
    ui.pushToast({ title: "保存成功", message: "该条广播配置已更新。", tone: "ok" });
    await query.refetch();
  } catch (error) {
    ui.pushToast({ title: "保存失败", message: error instanceof Error ? error.message : String(error), tone: "error" });
  }
}

async function onToggleEnabled(id: string, checked: boolean) {
  if (!drafts[id]) return;
  dirtyDrafts[id] = true;
  drafts[id].enabled = checked;
  try {
    const index = items.value.findIndex((item) => item.id === id);
    const patch: Partial<{ enabled: boolean; delaySeconds: number; intervalSeconds: number; resetSchedule: boolean }> = {
      enabled: checked,
      resetSchedule: true,
    };
    if (checked) {
      patch.delaySeconds = globalDelaySeconds.value;
      if (index === 0) {
        patch.intervalSeconds = globalDelaySeconds.value;
      }
    }

    await updateScheduledBroadcastItem(id, patch);
    dirtyDrafts[id] = false;
    await query.refetch();
  } catch (error) {
    dirtyDrafts[id] = false;
    ui.pushToast({ title: "更新失败", message: error instanceof Error ? error.message : String(error), tone: "error" });
  }
}

async function runNow(id: string) {
  try {
    const result = await runScheduledBroadcastNow(id, "manual_run");
    if (!result?.result?.success) {
      throw new Error(result?.result?.errorMessage || "执行失败");
    }
    ui.pushToast({ title: "执行成功", message: "广播已立刻触发。", tone: "ok" });
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

async function moveItem(index: number, offset: number) {
  const targetIndex = index + offset;
  if (index < 0 || targetIndex < 0 || targetIndex >= items.value.length) return;

  const reordered = items.value.slice();
  const [moved] = reordered.splice(index, 1);
  reordered.splice(targetIndex, 0, moved);

  const newGlobalDelay = clampInt(
    drafts[reordered[0].id]?.intervalSeconds ?? reordered[0].intervalSeconds,
    5,
    86400,
    10,
  );

  reorderBusy.value = true;
  try {
    await reorderScheduledBroadcastItems(reordered.map((entry) => entry.id));
    await syncGlobalDelayForOrder(reordered, newGlobalDelay);
    ui.pushToast({ title: "顺序已更新", message: "广播顺序和全局开始延迟已同步。", tone: "ok" });
    await query.refetch();
  } catch (error) {
    ui.pushToast({ title: "调序失败", message: error instanceof Error ? error.message : String(error), tone: "error" });
  } finally {
    reorderBusy.value = false;
  }
}

async function syncFollowerDelays(delaySeconds: number, firstId: string) {
  for (const item of items.value) {
    if (item.id === firstId) continue;
    await updateScheduledBroadcastItem(item.id, {
      delaySeconds,
      resetSchedule: true,
    });
  }
}

async function syncGlobalDelayForOrder(orderedItems: ScheduledBroadcastItem[], delaySeconds: number) {
  for (let index = 0; index < orderedItems.length; index += 1) {
    const item = orderedItems[index];
    await updateScheduledBroadcastItem(item.id, {
      delaySeconds,
      intervalSeconds: index === 0 ? delaySeconds : item.intervalSeconds,
      resetSchedule: true,
    });
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
.scheduled-broadcast-page {
  display: grid;
  gap: 12px;
  min-height: 0;
  padding-bottom: 12px;
}

.create-bar {
  display: grid;
  gap: 12px;
}

.create-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.create-hint {
  margin: 0;
  color: #8fa2b3;
  font-size: 12px;
}

.field {
  display: grid;
  gap: 6px;
  color: #d6dee6;
  font-size: 12px;
}

.field span {
  color: #8fa2b3;
}

.field input,
.inline-input,
.inline-textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid #38414c;
  background: #11171d;
  color: #edf2f4;
  border-radius: 10px;
  padding: 8px 10px;
  min-height: 36px;
}

.inline-textarea {
  min-height: 96px;
  resize: vertical;
  line-height: 1.55;
}

.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.broadcast-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.broadcast-card {
  min-height: 0;
}

.broadcast-card-grid {
  display: grid;
  grid-template-columns: 96px minmax(420px, 1.6fr) minmax(260px, 0.9fr);
  gap: 16px;
  align-items: start;
  padding: 16px 18px;
}

.broadcast-side {
  display: grid;
  gap: 12px;
  align-content: start;
}

.broadcast-enabled {
  display: grid;
  gap: 6px;
  justify-items: start;
  color: #d6dee6;
  font-size: 12px;
}

.broadcast-order {
  display: inline-grid;
  grid-template-columns: repeat(3, auto);
  gap: 8px;
  align-items: center;
}

.order-btn {
  width: 28px;
  height: 28px;
  border: 1px solid #38414c;
  border-radius: 8px;
  background: #10161c;
  color: #dce5eb;
  cursor: pointer;
}

.order-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.order-index {
  min-width: 28px;
  text-align: center;
  color: #8fa2b3;
  font-size: 12px;
}

.broadcast-main {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.broadcast-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.broadcast-labels {
  display: grid;
  gap: 4px;
}

.broadcast-rank {
  color: #edf2f4;
  font-size: 15px;
  font-weight: 600;
}

.broadcast-sync-tip {
  color: #7dd3fc;
  font-size: 12px;
}

.broadcast-status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.broadcast-field {
  display: grid;
  gap: 6px;
}

.broadcast-field span {
  color: #8fa2b3;
  font-size: 12px;
}

.broadcast-message {
  min-width: 0;
}

.broadcast-right {
  display: grid;
  gap: 10px;
  min-width: 0;
  align-content: start;
}

.broadcast-meta {
  display: grid;
  gap: 4px;
  color: #a5b0b8;
  font-size: 12px;
  line-height: 1.5;
}

.broadcast-error {
  margin: 0;
  color: #fda4af;
  font-size: 12px;
  line-height: 1.5;
}

.broadcast-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 1300px) {
  .broadcast-card-grid {
    grid-template-columns: 88px 1fr;
  }

  .broadcast-right {
    grid-column: 2;
  }

  .broadcast-head {
    flex-direction: column;
  }
}

@media (max-width: 900px) {
  .create-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .broadcast-card-grid {
    grid-template-columns: 1fr;
  }

  .broadcast-side {
    grid-template-columns: auto auto;
    justify-content: space-between;
    align-items: center;
  }

  .broadcast-right {
    grid-column: auto;
  }
}
</style>
