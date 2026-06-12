<template>
  <section class="bz-page scheduled-broadcast-page">
    <PageHeader
      title="定时广播"
      subtitle="管理自动轮播的消息。首条广播的间隔将同步为全局开始延迟，后续广播依序循环。"
    >
      <template #actions>
        <button type="button" class="bz-btn bz-btn-ghost" :disabled="isFetching" @click="query.refetch()">
          {{ isFetching ? "同步中..." : "刷新数据" }}
        </button>
      </template>
    </PageHeader>

    <section class="bz-card summary-card">
      <div class="bz-card-body compact summary-bar">
        <div class="summary-stats">
          <div class="stat-pill">
            <span class="label">项目总数</span>
            <span class="value">{{ items.length }}</span>
          </div>
          <div class="stat-pill" :data-active="data?.status?.running">
            <span class="label">运行状态</span>
            <span class="value">{{ data?.status?.running ? "运行中" : "已停止" }}</span>
          </div>
          <div class="stat-pill">
            <span class="label">轮询频率</span>
            <span class="value">{{ data?.config?.tickMs ?? "-" }} ms</span>
          </div>
          <div class="stat-pill highlight">
            <span class="label">全局开始延迟</span>
            <span class="value">{{ globalDelaySeconds }} 秒</span>
          </div>
        </div>
        <div class="summary-actions">
          <p class="hint-text">支持通过按钮调整执行顺序。首条广播的间隔会自动同步为全局开始延迟。</p>
          <button type="button" class="bz-btn bz-btn-primary" :disabled="createBusy" @click="createItem">
            {{ createBusy ? "处理中..." : "添加新广播" }}
          </button>
        </div>
      </div>
    </section>

    <section class="bz-card broadcast-panel">
      <DataState class="broadcast-state" :loading="isLoading && !items.length" :error="pageError">
        <div class="broadcast-scroll">
      <div v-if="items.length > 0" class="broadcast-list">
        <article v-for="(item, index) in items" :key="item.id" class="bz-card broadcast-card" :class="{ 'is-disabled': !(drafts[item.id]?.enabled ?? item.enabled) }">
          <!-- 卡片头部：标识与状态 -->
          <header class="item-header">
            <div class="header-main">
              <div class="item-index">#{{ index + 1 }}</div>
              <div class="item-info">
                <div class="item-title-row">
                  <h3 class="item-name">{{ index === 0 ? "首条广播" : "常规广播" }}</h3>
                  <span v-if="index === 0" class="sync-badge">同步全局延迟</span>
                </div>
                <div class="status-row">
                  <span class="bz-badge">下次运行: {{ formatTime(item.nextRunAt) }}</span>
                  <span class="bz-badge">上次运行: {{ formatTime(item.lastRunAt) }}</span>
                  <span class="bz-badge">累计成功: {{ item.runCount ?? 0 }}</span>
                  <span v-if="item.errorCount" class="bz-badge bz-badge-danger">累计失败: {{ item.errorCount }}</span>
                </div>
              </div>
            </div>
            
            <div class="header-side">
              <div class="order-group">
                <button
                  type="button"
                  class="mini-btn"
                  title="上移"
                  :disabled="index === 0 || reorderBusy"
                  @click="moveItem(index, -1)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="mini-btn"
                  title="下移"
                  :disabled="index === items.length - 1 || reorderBusy"
                  @click="moveItem(index, 1)"
                >
                  ↓
                </button>
              </div>
              <div class="divider"></div>
              <label class="enable-toggle">
                <input
                  type="checkbox"
                  :checked="drafts[item.id]?.enabled ?? item.enabled"
                  @change="onToggleEnabled(item.id, ($event.target as HTMLInputElement).checked)"
                />
                <span class="toggle-text">{{ drafts[item.id]?.enabled ?? item.enabled ? "已启用" : "已停用" }}</span>
              </label>
            </div>
          </header>

          <!-- 卡片主体：消息内容 -->
          <div class="item-body">
            <div class="field-label">广播内容</div>
            <textarea
              class="message-editor"
              rows="2"
              maxlength="180"
              :value="drafts[item.id]?.message ?? item.message"
              placeholder="请输入要在服务器中播报的消息内容..."
              @input="setDraft(item.id, 'message', ($event.target as HTMLTextAreaElement).value)"
            />
            <div v-if="item.lastError" class="error-banner">
              最近执行错误：{{ item.lastError }}
            </div>
          </div>

          <!-- 卡片底部：配置与操作 -->
          <footer class="item-footer">
            <div class="settings-group">
              <div class="input-field">
                <span class="label">{{ index === 0 ? "首条间隔 / 全局延迟 (秒)" : "循环间隔 (秒)" }}</span>
                <input
                  class="interval-input"
                  type="number"
                  min="5"
                  max="86400"
                  :value="drafts[item.id]?.intervalSeconds ?? item.intervalSeconds"
                  @input="onIntervalInput(item.id, ($event.target as HTMLInputElement).value)"
                />
              </div>
              <div class="meta-info">
                <div class="meta-item">开始延迟: <span>{{ index === 0 ? (drafts[item.id]?.intervalSeconds ?? item.intervalSeconds) : globalDelaySeconds }}s</span></div>
                <div class="meta-item">更新于: <span>{{ formatTime(item.updatedAt) }}</span></div>
              </div>
            </div>

            <div class="action-group">
              <button type="button" class="bz-btn bz-btn-ghost" @click="runNow(item.id)">立即试运行</button>
              <button type="button" class="bz-btn bz-btn-danger" @click="removeItem(item.id)">删除</button>
              <button type="button" class="bz-btn bz-btn-primary" @click="saveItem(item, index)">保存更改</button>
            </div>
          </footer>
        </article>
      </div>

      <div v-else class="bz-empty">
        <div class="bz-empty-inner">
          <div class="bz-empty-icon">+</div>
          <div class="bz-empty-title">尚未配置定时广播</div>
          <div class="bz-empty-desc">
            您可以添加多条广播消息。系统将按照列表顺序轮流发送，并根据设置的间隔进行等待。
          </div>
          <div class="bz-empty-actions">
            <button type="button" class="bz-btn bz-btn-primary" @click="createItem">添加首条广播</button>
          </div>
        </div>
      </div>
        </div>
      </DataState>
    </section>
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

const REFRESH_INTERVAL_MS = 5000;
const TIME_CACHE_MAX = 4000;
const timeCache = new Map<number, string>();

const query = useQuery({
  queryKey: ["scheduled-broadcast-state"],
  queryFn: getScheduledBroadcastState,
  placeholderData: (previousData) => previousData,
  refetchInterval: REFRESH_INTERVAL_MS,
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

      const nextMessage = item.message ?? "";
      const nextIntervalSeconds = item.intervalSeconds ?? 300;
      const nextEnabled = Boolean(item.enabled);

      const draft = drafts[item.id];
      if (draft.message !== nextMessage) draft.message = nextMessage;
      if (draft.intervalSeconds !== nextIntervalSeconds) draft.intervalSeconds = nextIntervalSeconds;
      if (draft.enabled !== nextEnabled) draft.enabled = nextEnabled;
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
  const cached = timeCache.get(num);
  if (cached) return cached;
  const formatted = new Date(num).toLocaleString();
  timeCache.set(num, formatted);
  if (timeCache.size > TIME_CACHE_MAX) timeCache.clear();
  return formatted;
}
</script>

<style scoped>
.scheduled-broadcast-page {
  height: 100%;
  min-height: 0;
  max-width: 1400px;
  overflow: hidden;
  grid-template-rows: auto auto minmax(0, 1fr);
}

.broadcast-panel {
  min-height: 0;
  height: 100%;
  overflow: hidden;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
}

.broadcast-state {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
  height: 100%;
}

.broadcast-scroll {
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
}

/* Summary Bar */
.summary-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}

.summary-stats {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.stat-pill {
  display: flex;
  flex-direction: column;
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-soft);
  border-radius: 12px;
  min-width: 100px;
}

.stat-pill .label {
  font-size: 11px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 2px;
}

.stat-pill .value {
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.stat-pill[data-active="true"] .value {
  color: var(--color-status-online);
}

.stat-pill.highlight {
  border-color: var(--color-border-highlight);
  background: rgba(96, 165, 250, 0.08);
}

.summary-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.hint-text {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-muted);
  max-width: 320px;
  line-height: 1.4;
}

/* Broadcast List */
.broadcast-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
}

.broadcast-card {
  transition: opacity 0.3s ease, transform 0.3s ease;
  display: flex;
  flex-direction: column;
}

.broadcast-card.is-disabled {
  opacity: 0.7;
}

/* Item Header */
.item-header {
  padding: 16px 20px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.015);
}

.header-main {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.item-index {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-default);
  border-radius: 10px;
  font-weight: 800;
  color: var(--color-text-secondary);
  font-size: 14px;
}

.item-info {
  display: grid;
  gap: 6px;
}

.item-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.item-name {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.sync-badge {
  font-size: 11px;
  padding: 2px 8px;
  background: rgba(96, 165, 250, 0.15);
  color: #60a5fa;
  border-radius: 6px;
  font-weight: 600;
}

.status-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.header-side {
  display: flex;
  align-items: center;
  gap: 16px;
}

.order-group {
  display: flex;
  gap: 4px;
}

.mini-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 6px;
  font-size: 12px;
  display: grid;
  place-items: center;
}

.divider {
  width: 1px;
  height: 24px;
  background: var(--color-border-soft);
}

.enable-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.enable-toggle input {
  width: 16px;
  height: 16px;
  margin: 0;
  cursor: pointer;
}

.toggle-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

/* Item Body */
.item-body {
  padding: 16px 20px;
  display: grid;
  gap: 10px;
}

.field-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.message-editor {
  width: 100%;
  min-height: 80px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  padding: 12px 14px;
  color: var(--color-text-primary);
  font-size: 15px;
  line-height: 1.5;
  resize: vertical;
}

.message-editor:focus {
  border-color: var(--color-border-highlight);
  background: var(--color-bg-panel);
}

.error-banner {
  padding: 8px 12px;
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid rgba(248, 113, 113, 0.2);
  border-radius: 8px;
  color: #fca5a5;
  font-size: 12px;
}

/* Item Footer */
.item-footer {
  padding: 16px 20px;
  background: rgba(255, 255, 255, 0.01);
  border-top: 1px solid var(--color-border-soft);
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 20px;
  flex-wrap: wrap;
}

.settings-group {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}

.input-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-field .label {
  font-size: 11px;
  color: var(--color-text-muted);
}

.interval-input {
  width: 120px;
  height: 36px;
  padding: 0 10px;
  font-weight: 700;
}

.meta-info {
  display: grid;
  gap: 4px;
}

.meta-item {
  font-size: 11px;
  color: var(--color-text-muted);
}

.meta-item span {
  color: var(--color-text-secondary);
  margin-left: 4px;
}

.action-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

@media (max-width: 900px) {
  .summary-bar {
    flex-direction: column;
    align-items: stretch;
  }
  
  .summary-actions {
    flex-direction: column;
    align-items: stretch;
  }
  
  .hint-text {
    max-width: none;
    text-align: center;
  }
  
  .item-header {
    flex-direction: column;
    gap: 16px;
  }
  
  .header-side {
    width: 100%;
    justify-content: space-between;
  }
  
  .item-footer {
    flex-direction: column;
    align-items: stretch;
  }
  
  .settings-group {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
  }
  
  .interval-input {
    width: 100%;
  }
  
  .action-group {
    justify-content: flex-end;
  }
}
</style>
