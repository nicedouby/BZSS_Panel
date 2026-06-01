<template>
  <section class="bz-page scheduled-broadcast-page">
    <PageHeader
      title="定时广播"
      subtitle="建立广播列表，统一设置全局延迟，逐条配置广播间隔。"
    >
      <template #actions>
        <button type="button" class="bz-btn bz-btn-ghost" :disabled="isFetching" @click="query.refetch()">
          {{ isFetching ? "同步中..." : "刷新" }}
        </button>
      </template>
    </PageHeader>

    <section class="bz-card">
      <div class="bz-card-body compact">
        <form class="create-grid" @submit.prevent="createItem">
          <label class="field">
            <span>全局开始延迟（秒）</span>
            <input
              type="number"
              min="0"
              max="86400"
              :value="globalDelaySeconds"
              @input="setGlobalDelay(($event.target as HTMLInputElement).value)"
            />
          </label>
          <div class="actions">
            <button type="submit" class="bz-btn bz-btn-primary" :disabled="createBusy">
              {{ createBusy ? "添加中..." : "添加广播" }}
            </button>
          </div>
        </form>
      </div>
    </section>

    <section class="bz-card">
      <div class="bz-card-body compact">
        <div class="summary">
          <span class="bz-badge">总条目 {{ items.length }}</span>
          <span class="bz-badge">运行状态 {{ data?.status?.running ? "运行中" : "已停止" }}</span>
          <span class="bz-badge">轮询 {{ data?.config?.tickMs ?? "-" }} ms</span>
        </div>
      </div>
    </section>

    <DataState
      :loading="isLoading && !items.length"
      :error="pageError"
    >
      <div v-if="items.length > 0" class="broadcast-list">
        <article v-for="(item, index) in items" :key="item.id" class="bz-card broadcast-card">
          <div class="broadcast-card-grid">
            <label class="broadcast-enabled">
              <input
                type="checkbox"
                :checked="drafts[item.id]?.enabled ?? item.enabled"
                @change="onToggleEnabled(item.id, ($event.target as HTMLInputElement).checked)"
              />
            </label>

            <label class="broadcast-field broadcast-title">
              <span>标题</span>
              <input
                class="inline-input"
                :value="drafts[item.id]?.title ?? item.title"
                maxlength="60"
                placeholder="例如：欢迎提示 / 规则提醒 / QQ群提示"
                @input="setDraft(item.id, 'title', ($event.target as HTMLInputElement).value)"
              />
            </label>

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

            <div class="broadcast-right">
              <label class="broadcast-field">
                <span>间隔（秒）</span>
                <input
                  class="inline-input"
                  type="number"
                  min="5"
                  max="86400"
                  :value="index === 0 ? globalDelaySeconds : (drafts[item.id]?.intervalSeconds ?? item.intervalSeconds)"
                  :disabled="index === 0"
                  @input="setDraft(item.id, 'intervalSeconds', Number(($event.target as HTMLInputElement).value))"
                />
              </label>

              <div class="broadcast-meta">
                <span>下一次：{{ formatTime(item.nextRunAt) }}</span>
                <span>最近一次：{{ formatTime(item.lastRunAt) }}</span>
                <span v-if="item.lastError" class="broadcast-error">最近错误：{{ item.lastError }}</span>
                <div class="broadcast-stats">
                  <span class="bz-badge">成功 {{ item.runCount ?? 0 }}</span>
                  <span class="bz-badge bz-badge-danger">失败 {{ item.errorCount ?? 0 }}</span>
                </div>
              </div>

              <div class="broadcast-actions">
                <button type="button" class="bz-btn bz-btn-primary" @click="saveItem(item, index)">保存</button>
                <button type="button" class="bz-btn bz-btn-ghost" @click="runNow(item.id)">立刻执行</button>
                <button type="button" class="bz-btn bz-btn-danger" @click="removeItem(item.id)">删除</button>
              </div>
            </div>
          </div>
        </article>
      </div>

      <div v-else class="bz-empty">
        <div class="bz-empty-inner">
          <div class="bz-empty-icon">∅</div>
          <div class="bz-empty-title">暂无定时广播</div>
          <div class="bz-empty-desc">
            先创建一条广播任务，然后它会按间隔自动发送。
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
  runScheduledBroadcastNow,
  updateScheduledBroadcastItem,
  type ScheduledBroadcastItem,
} from "../app/scheduledBroadcastApi";
import { useUiStore } from "../stores/ui.store";
import PageHeader from "../components/common/PageHeader.vue";
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

    await updateScheduledBroadcastItem(id, patch);
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
  height: 100%;
  overflow: hidden;
}

.create-grid {
  display: grid;
  grid-template-columns: minmax(200px, 280px) auto;
  gap: 12px;
  align-items: end;
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
  min-height: 84px;
  resize: vertical;
}

.actions {
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
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
  grid-template-columns: 44px minmax(220px, 1fr) minmax(320px, 1.4fr) minmax(260px, 0.95fr);
  gap: 14px;
  align-items: start;
  padding: 16px 18px;
}

.broadcast-enabled {
  display: flex;
  justify-content: center;
  padding-top: 4px;
}

.broadcast-field {
  display: grid;
  gap: 6px;
}

.broadcast-field span {
  color: #8fa2b3;
  font-size: 12px;
}

.broadcast-title {
  min-width: 0;
}

.broadcast-message {
  min-width: 0;
}

.broadcast-right {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.broadcast-meta {
  display: grid;
  gap: 4px;
  color: #a5b0b8;
  font-size: 12px;
  line-height: 1.5;
}

.broadcast-error {
  color: #fda4af;
}

.broadcast-stats {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.broadcast-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.broadcast-actions button {
  width: 100%;
}

@media (max-width: 1300px) {
  .broadcast-card-grid {
    grid-template-columns: 40px 1fr 1fr;
  }

  .broadcast-right {
    grid-column: 1 / -1;
    grid-template-columns: minmax(180px, 220px) 1fr minmax(220px, 260px);
    align-items: start;
  }
}

@media (max-width: 900px) {
  .create-grid {
    grid-template-columns: 1fr;
  }

  .broadcast-card-grid {
    grid-template-columns: 1fr;
  }

  .broadcast-enabled {
    justify-content: flex-start;
  }

  .broadcast-right {
    grid-column: auto;
    grid-template-columns: 1fr;
  }
}
</style>
