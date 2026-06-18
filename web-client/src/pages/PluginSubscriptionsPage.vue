<template>
  <section class="page plugin-subscriptions-page">
        <h1 class="sr-only">插件订阅</h1>

    <WorkspaceToolbar>
      <template #actions>
        <button type="button" class="ghost-btn" :disabled="loading" @click="refreshState(false)">
          {{ loading ? "刷新中.." : "刷新" }}
        </button>
      </template>
    </WorkspaceToolbar><section class="summary-grid">
      <article class="summary-card">
        <span>总条目</span>
        <strong>{{ stats.total }}</strong>
      </article>
      <article class="summary-card">
        <span>已订阅</span>
        <strong>{{ stats.enabled }}</strong>
      </article>
      <article class="summary-card">
        <span>已暂停</span>
        <strong>{{ stats.disabled }}</strong>
      </article>
      <article class="summary-card">
        <span>运行中</span>
        <strong>{{ stats.running }}</strong>
      </article>
    </section>

    <PageCard class="filter-card">
      <div class="filter-head">
        <div>
          <h2 class="card-title">分类视图</h2>
          <p class="card-description">{{ kindMeta(activeKind).subtitle }}</p>
        </div>
        <span class="status-badge" :data-tone="loading ? 'pending' : 'ok'">
          {{ loading ? "同步中" : "已加载" }}
        </span>
      </div>

      <div class="kind-tabs" role="tablist" aria-label="订阅分类">
        <button
          v-for="kind in kinds"
          :key="kind"
          type="button"
          class="kind-tab"
          :class="{ active: activeKind === kind }"
          @click="activeKind = kind"
        >
          <strong>{{ kindMeta(kind).label }}</strong>
          <span>{{ kind === "all" ? subscriptions.length : countByKind(kind) }}</span>
        </button>
      </div>
    </PageCard>

    <div v-if="error" class="error-banner">
      {{ error }}
    </div>

    <section class="groups">
      <PageCard
        v-for="group in visibleGroups"
        :key="group.kind"
        class="group-card"
      >
        <template #header>
          <div class="group-head">
            <div>
              <h2 class="card-title">{{ kindMeta(group.kind).label }}</h2>
              <p class="card-description">{{ kindMeta(group.kind).subtitle }}</p>
            </div>
            <span class="group-count">{{ group.items.length }} 项</span>
          </div>
        </template>

        <div class="table-wrap">
          <table class="subscription-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>ID</th>
                <th>状态</th>
                <th>订阅</th>
                <th>说明</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in group.items" :key="item.id">
                <td>
                  <div class="name-cell">
                    <strong>{{ item.name || item.id }}</strong>
                    <span>{{ kindMeta(item.kind).label }}</span>
                  </div>
                </td>
                <td><code>{{ item.id }}</code></td>
                <td>
                  <span class="status-chip" :data-status="item.status">
                    {{ statusLabel(item.status) }}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    class="switch-button"
                    :class="{ on: item.subscribed }"
                    :disabled="!canManage || pendingIds.has(item.id)"
                    :aria-checked="item.subscribed ? 'true' : 'false'"
                    role="switch"
                    @click="toggleSubscription(item)"
                  >
                    {{ item.subscribed ? "启用" : "关闭" }}
                  </button>
                </td>
                <td class="description-cell">{{ item.description || "-" }}</td>
                <td>{{ formatTime(item.lastUpdatedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </PageCard>
    </section>

    <PageCard v-if="!visibleGroups.length && !loading" class="empty-card">
      <DataState :empty="true" empty-title="没有可显示的条目" empty-text="当前筛选条件下没有匹配项。" />
    </PageCard>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ApiError, apiGet, apiPost } from "../app/apiClient";
import { useAuthStore } from "../stores/auth.store";
import { useUiStore } from "../stores/ui.store";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";
import PageCard from "../components/common/PageCard.vue";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";
import DataState from "../components/common/DataState.vue";
import { t } from "../i18n";

type Kind = "all" | "module" | "plugin" | "web page" | "parser" | "unknown";
type Status = "running" | "stopped" | "unloaded" | "error";

interface SubscriptionItem {
  id: string;
  name: string;
  kind: Exclude<Kind, "all">;
  subscribed: boolean;
  status: Status;
  description: string;
  lastUpdatedAt: string;
}

interface KindMeta {
  label: string;
  subtitle: string;
}

const ui = useUiStore();
const auth = useAuthStore();
const loading = ref(false);
const error = ref("");
const activeKind = ref<Kind>("all");
const lastUpdatedAt = ref("");
const subscriptions = ref<SubscriptionItem[]>([]);
const pendingIds = reactive(new Set<string>());
let refreshTimer: number | null = null;

const kinds: Kind[] = ["all", "module", "plugin", "web page", "parser", "unknown"];

const kindMap: Record<Exclude<Kind, "all">, KindMeta> = {
  module: {
    label: "模块",
    subtitle: "核心能力层，负责订阅事件、维护状态和对外 API。",
  },
  plugin: {
    label: "插件",
    subtitle: "依赖模块事件流工作的扩展能力，通常负责派生处理和输出。",
  },
  "web page": {
    label: "网页",
    subtitle: "前端入口页面，通常由模块 API 提供数据，路由存在但可独立控制展示。",
  },
  parser: {
    label: "解析器",
    subtitle: "负责把原始日志转换为结构化事件的解析层。",
  },
  unknown: {
    label: "其他",
    subtitle: "暂时无法识别类型的条目，通常是历史记录或未标注条目。",
  },
};

const visibleGroups = computed(() => {
  const items = subscriptions.value.filter((item) => activeKind.value === "all" || item.kind === activeKind.value);
  const grouped = new Map<Exclude<Kind, "all">, SubscriptionItem[]>();

  for (const item of items) {
    const bucket = grouped.get(item.kind) ?? [];
    bucket.push(item);
    grouped.set(item.kind, bucket);
  }

  return [...grouped.entries()]
    .map(([kind, items]) => ({ kind, items }))
    .sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind));
});

const stats = computed(() => {
  const total = subscriptions.value.length;
  const enabled = subscriptions.value.filter((item) => item.subscribed).length;
  const running = subscriptions.value.filter((item) => item.status === "running").length;
  return {
    total,
    enabled,
    disabled: total - enabled,
    running,
  };
});

const canManage = computed(() => Boolean(
  auth.user?.isSuperAdmin === true
  || auth.user?.permissions?.includes("settings.manage"),
));

onMounted(() => {
  void refreshState(false);
  refreshTimer = window.setInterval(() => {
    if (canAutoRefreshNow()) void refreshState(true);
  }, 4000);
});

onBeforeUnmount(() => {
  if (refreshTimer != null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
});

async function refreshState(silent = false) {
  loading.value = true;
  try {
    const data = await apiGet<{ subscriptions?: SubscriptionItem[]; lastUpdatedAt?: string }>("/api/plugin-subscriptions/state");
    subscriptions.value = Array.isArray(data.subscriptions) ? data.subscriptions : [];
    lastUpdatedAt.value = String(data.lastUpdatedAt ?? "");
    error.value = "";
    if (!silent) {
      ui.pushToast({
        title: t("common.updated"),
        message: lastUpdatedAt.value ? `已同步 ${formatTime(lastUpdatedAt.value)}` : "已同步订阅状态。",
        tone: "ok",
      });
    }
  } catch (err) {
    const message = formatApiError(err, "读取订阅状态失败");
    if (!silent) {
      error.value = message;
      ui.pushToast({
        title: t("common.error"),
        message,
        tone: "error",
      });
    }
  } finally {
    loading.value = false;
  }
}

async function toggleSubscription(item: SubscriptionItem) {
  if (!canManage.value || pendingIds.has(item.id)) return;

  const next = !item.subscribed;
  pendingIds.add(item.id);
  error.value = "";

  try {
    const response = await apiPost<{ success?: boolean; subscribed?: boolean; message?: string }>("/api/plugin-subscriptions/set", {
      id: item.id,
      subscribed: next,
    });

    if (!response.success) {
      throw new Error(response.message || "切换失败");
    }

    const nextSubscribed = Boolean(response.subscribed ?? next);
    item.subscribed = nextSubscribed;
    subscriptions.value = [...subscriptions.value];
    ui.pushToast({
      title: t("common.updated"),
      message: `${item.name || item.id} 已${nextSubscribed ? "启用" : "关闭"}`,
      tone: "ok",
    });
    await refreshState(true);
  } catch (err) {
    const message = formatApiError(err, `更新 ${item.id} 失败`);
    error.value = message;
    ui.pushToast({
      title: t("common.error"),
      message,
      tone: "error",
    });
  } finally {
    pendingIds.delete(item.id);
  }
}

function countByKind(kind: Exclude<Kind, "all">) {
  return subscriptions.value.filter((item) => item.kind === kind).length;
}

function kindMeta(kind: Kind): KindMeta {
  if (kind === "all") {
    return {
      label: "全部",
      subtitle: "查看所有已登记的模块、插件与网页入口。",
    };
  }
  return kindMap[kind];
}

function statusLabel(status: Status) {
  if (status === "running") return "运行中";
  if (status === "stopped") return "已停止";
  if (status === "unloaded") return "未加载";
  if (status === "error") return "错误";
  return t("common.unknown");
}

function kindOrder(kind: Exclude<Kind, "all">) {
  return {
    module: 0,
    plugin: 1,
    "web page": 2,
    parser: 3,
    unknown: 4,
  }[kind];
}

function formatTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("zh-CN", { hour12: false });
}

function formatApiError(err: unknown, fallback: string) {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}
</script>

<style scoped>
.plugin-subscriptions-page {
  display: grid;
  grid-template-rows: auto auto auto auto minmax(0, 1fr);
  gap: 16px;
  padding: 18px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.summary-card {
  border: 1px solid var(--color-border-soft);
  border-radius: 14px;
  padding: 14px 16px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02)),
    rgba(255, 255, 255, 0.02);
  display: grid;
  gap: 4px;
}

.summary-card span,
.card-description,
.group-count {
  color: var(--color-text-muted);
  font-size: 12px;
}

.summary-card strong {
  font-size: 22px;
  line-height: 1.1;
}

.filter-card,
.group-card,
.empty-card {
  min-width: 0;
}

.filter-head,
.group-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.card-title {
  margin: 0;
  font-size: 16px;
}

.card-description {
  margin: 4px 0 0;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 0 12px;
  min-height: 30px;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  font-size: 12px;
  font-weight: 700;
}

.status-badge[data-tone="ok"] {
  color: #9ae6b4;
  background: rgba(34, 197, 94, 0.12);
}

.status-badge[data-tone="pending"] {
  color: #fde68a;
  background: rgba(245, 158, 11, 0.12);
}

.kind-tabs {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.kind-tab {
  border: 1px solid var(--color-border-soft);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  padding: 12px 14px;
  color: var(--color-text-primary);
  display: grid;
  gap: 4px;
  text-align: left;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.kind-tab:hover {
  transform: translateY(-1px);
  border-color: var(--color-border-highlight);
}

.kind-tab.active {
  border-color: rgba(59, 130, 246, 0.42);
  background: rgba(59, 130, 246, 0.1);
}

.kind-tab strong {
  font-size: 13px;
}

.kind-tab span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.error-banner {
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 12px;
  padding: 12px 14px;
  background: rgba(239, 68, 68, 0.08);
  color: #fecaca;
}

.groups {
  display: grid;
  gap: 14px;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
  padding-right: 4px;
}

.table-wrap {
  overflow: auto;
}

.subscription-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 920px;
}

.subscription-table th,
.subscription-table td {
  padding: 12px 10px;
  border-bottom: 1px solid var(--color-border-soft);
  vertical-align: top;
  text-align: left;
}

.subscription-table th {
  font-size: 12px;
  color: var(--color-text-muted);
  font-weight: 700;
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--color-bg-card);
}

.subscription-table td {
  font-size: 13px;
}

.name-cell {
  display: grid;
  gap: 4px;
}

.name-cell span,
.description-cell {
  color: var(--color-text-secondary);
}

.status-chip {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  font-size: 12px;
  font-weight: 700;
}

.status-chip[data-status="running"] {
  color: #9ae6b4;
  background: rgba(34, 197, 94, 0.1);
}

.status-chip[data-status="stopped"] {
  color: #fda4af;
  background: rgba(244, 63, 94, 0.1);
}

.status-chip[data-status="unloaded"] {
  color: #cbd5e1;
}

.status-chip[data-status="error"] {
  color: #fecaca;
  background: rgba(239, 68, 68, 0.1);
}

.switch-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 82px;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.switch-button.on {
  border-color: rgba(34, 197, 94, 0.35);
  background: rgba(34, 197, 94, 0.12);
  color: #bbf7d0;
}

.switch-button:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: var(--color-border-highlight);
}

.switch-button:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

code {
  font-family: Consolas, "Courier New", monospace;
}

@media (max-width: 1100px) {
  .summary-grid,
  .kind-tabs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .plugin-subscriptions-page {
    padding: 14px;
  }

  .summary-grid,
  .kind-tabs {
    grid-template-columns: 1fr;
  }

  .filter-head,
  .group-head {
    flex-direction: column;
  }
}
</style>

