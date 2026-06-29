<template>
  <section class="panel-ban-page">
    <PageHeader
      title="面板封禁"
      subtitle="维护全局封禁列表。玩家加入时按 Steam64 或 EOS 命中后踢出，并附带封禁原因与到期时间。"
      eyebrow="Moderation"
    >
      <template #actions>
        <StatusBadge v-if="state" :tone="state.lastError ? 'danger' : 'success'" dot>
          {{ state.lastError ? "状态异常" : "运行正常" }}
        </StatusBadge>
        <AppButton size="sm" variant="ghost" :loading="refreshing || loading" @click="refreshState">
          刷新
        </AppButton>
        <AppButton size="sm" variant="ghost" :loading="reloading" @click="reloadStore">
          重载
        </AppButton>
        <AppButton size="sm" variant="ghost" :loading="rescanning" @click="rescanNow">
          扫描在线玩家
        </AppButton>
      </template>
    </PageHeader>

    <StatGrid :items="summaryItems" :loading="loading && !state" />

    <div v-if="pageError || error || state?.lastError" class="notice notice--danger">
      <strong>异常</strong>
      <span>{{ pageError || error || state?.lastError }}</span>
    </div>

    <div class="layout">
      <div class="main-column">
        <PageCard title="新增 / 编辑封禁" description="必须填写到期时间。也可以输入时长，由页面自动换算到期时间。">
          <form class="ban-form" @submit.prevent="submitDraft">
            <div class="form-grid">
              <label class="field">
                <span>Steam64</span>
                <input v-model.trim="draft.steamID" type="text" inputmode="numeric" placeholder="7656119..." />
              </label>
              <label class="field">
                <span>EOS</span>
                <input v-model.trim="draft.eosID" type="text" placeholder="EOS-..." />
              </label>
              <label class="field field--wide">
                <span>名称</span>
                <input v-model.trim="draft.name" type="text" placeholder="可选，仅用于显示或名称回退匹配" />
              </label>
              <label class="field field--wide">
                <span>原因</span>
                <textarea v-model.trim="draft.reason" rows="3" placeholder="填写踢出时展示的原因" />
              </label>
              <label class="field">
                <span>状态</span>
                <select v-model="draft.status">
                  <option value="active">有效</option>
                  <option value="disabled">禁用</option>
                  <option value="expired">已过期</option>
                </select>
              </label>
              <label class="field">
                <span>到期时间</span>
                <input v-model="draft.expiresAt" type="datetime-local" />
              </label>
              <label class="field">
                <span>时长值</span>
                <input v-model.number="draft.durationValue" type="number" min="1" step="1" placeholder="例如 7" />
              </label>
              <label class="field">
                <span>时长单位</span>
                <select v-model="draft.durationUnit">
                  <option value="minutes">分钟</option>
                  <option value="hours">小时</option>
                  <option value="days">天</option>
                  <option value="weeks">周</option>
                </select>
              </label>
            </div>

            <div class="form-meta">
              <div class="preview">
                <span class="preview-label">到期预览</span>
                <strong>{{ expiryPreview.label }}</strong>
                <span>{{ expiryPreview.hint }}</span>
              </div>
              <div class="preview">
                <span class="preview-label">当前模式</span>
                <strong>{{ editingId ? "编辑中" : "新建" }}</strong>
                <span>{{ editingId ? `编辑条目 ${editingId}` : "将创建新的封禁条目" }}</span>
              </div>
            </div>

            <div class="form-actions">
              <AppButton type="submit" :loading="saving">
                {{ editingId ? "保存修改" : "创建封禁" }}
              </AppButton>
              <AppButton type="button" variant="ghost" :disabled="saving" @click="resetDraft">
                清空
              </AppButton>
            </div>
          </form>
        </PageCard>

        <PageCard title="封禁列表" description="支持搜索、按状态过滤，以及逐条编辑、禁用、启用和删除。">
          <template #actions>
            <label class="search-box">
              <span>搜索</span>
              <input v-model.trim="searchText" type="search" placeholder="按 Steam64、EOS、名称、原因过滤" />
            </label>
            <div class="status-tabs" role="tablist" aria-label="封禁状态">
              <button
                v-for="option in statusOptions"
                :key="option.value"
                type="button"
                class="status-tab"
                :class="{ active: viewStatus === option.value }"
                @click="viewStatus = option.value"
              >
                {{ option.label }}
              </button>
            </div>
          </template>

          <div class="table-wrap">
            <table class="ban-table">
              <thead>
                <tr>
                  <th>状态</th>
                  <th>身份</th>
                  <th>原因</th>
                  <th>到期</th>
                  <th>命中</th>
                  <th>最近命中</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in visibleEntries" :key="entry.id" :class="`row--${entry.status}`">
                  <td>
                    <StatusBadge :tone="entryStatusTone(entry.status)" size="sm">
                      {{ entryStatusLabel(entry.status) }}
                    </StatusBadge>
                  </td>
                  <td>
                    <div class="identity-cell">
                      <strong>{{ entry.name || entry.identityText || entry.id }}</strong>
                      <span>{{ entry.steamID || "无 Steam64" }}</span>
                      <span>{{ entry.eosID || "无 EOS" }}</span>
                    </div>
                  </td>
                  <td class="reason-cell">{{ entry.reason || "未填写" }}</td>
                  <td>
                    <div class="time-cell">
                      <strong>{{ formatTime(entry.expiresAt) }}</strong>
                      <span>{{ entry.expiresInLabel }}</span>
                    </div>
                  </td>
                  <td>
                    <strong>{{ entry.hitCount }}</strong>
                  </td>
                  <td>
                    <div class="time-cell">
                      <strong>{{ formatTime(entry.lastHitAt) }}</strong>
                      <span>{{ entry.lastHitPlayerName || "暂无" }}</span>
                    </div>
                  </td>
                  <td>
                    <div class="row-actions">
                      <AppButton size="sm" variant="ghost" :disabled="busyId === entry.id" @click="editEntry(entry)">
                        编辑
                      </AppButton>
                      <AppButton
                        v-if="entry.status === 'active'"
                        size="sm"
                        variant="ghost"
                        :disabled="busyId === entry.id"
                        @click="setEntryStatus(entry, 'disabled')"
                      >
                        禁用
                      </AppButton>
                      <AppButton
                        v-else-if="entry.status === 'disabled'"
                        size="sm"
                        variant="ghost"
                        :disabled="busyId === entry.id"
                        @click="setEntryStatus(entry, 'active')"
                      >
                        启用
                      </AppButton>
                      <AppButton size="sm" variant="ghost" :disabled="busyId === entry.id" @click="removeEntry(entry)">
                        删除
                      </AppButton>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <EmptyState
            v-if="!visibleEntries.length && !loading"
            compact
            title="没有匹配的封禁"
            description="当前筛选条件下没有可显示的条目。"
          />
        </PageCard>
      </div>

      <div class="side-column">
        <PageCard title="命中历史" description="展示最近的踢出命中记录。">
          <div class="event-list">
            <article
              v-for="event in recentHitEvents"
              :key="event.id"
              class="event-item"
              :data-kind="event.kind"
            >
              <div class="event-head">
                <StatusBadge :tone="event.kind === 'kick_success' ? 'success' : event.kind === 'kick_failed' ? 'danger' : 'info'" size="sm">
                  {{ event.kind }}
                </StatusBadge>
                <span>{{ formatTime(event.at) }}</span>
              </div>
              <strong>{{ event.playerName || event.entryName || "未知玩家" }}</strong>
              <span>{{ event.serverId || "global" }}</span>
              <span>{{ event.matchType ? `${event.matchType}: ${event.matchValue}` : event.reason || "" }}</span>
            </article>
            <EmptyState
              v-if="!recentHitEvents.length && !loading"
              compact
              title="暂无命中历史"
              description="还没有发生过封禁命中。"
            />
          </div>
        </PageCard>

        <PageCard title="最近事件" description="包含加载、过期、创建、更新和踢出失败等事件。">
          <div class="event-list">
            <article
              v-for="event in recentEvents"
              :key="event.id"
              class="event-item"
              :data-kind="event.kind"
            >
              <div class="event-head">
                <StatusBadge :tone="eventTone(event.kind)" size="sm">
                  {{ event.kind }}
                </StatusBadge>
                <span>{{ formatTime(event.at) }}</span>
              </div>
              <strong>{{ event.entryName || event.playerName || event.error || "系统事件" }}</strong>
              <span>{{ event.serverId || event.entryId || "" }}</span>
              <span v-if="event.reason">{{ event.reason }}</span>
            </article>
            <EmptyState
              v-if="!recentEvents.length && !loading"
              compact
              title="暂无事件"
              description="系统尚未记录事件。"
            />
          </div>
        </PageCard>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";

import { apiDelete, apiGet, apiPatch, apiPost } from "../app/apiClient";
import AppButton from "../components/ui/AppButton.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import PageCard from "../components/common/PageCard.vue";
import PageHeader from "../components/common/PageHeader.vue";
import StatGrid from "../components/ui/StatGrid.vue";
import type { StatItem } from "../components/ui/StatGrid.vue";
import StatusBadge from "../components/ui/StatusBadge.vue";
import { formatTime } from "../composables/useDateTimeFormat";
import { usePollingResource } from "../composables/usePollingResource";

type EntryStatus = "active" | "disabled" | "expired";
type StatusView = "all" | EntryStatus;
type DurationUnit = "minutes" | "hours" | "days" | "weeks";

type BanEntry = {
  id: string;
  steamID: string;
  eosID: string;
  name: string;
  reason: string;
  expiresAt: string;
  status: EntryStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  hitCount: number;
  lastHitAt: string;
  lastHitPlayerName: string;
  lastHitServerId: string;
  lastHitMatchType: string;
  lastHitMatchValue: string;
  identityText: string;
  isExpired: boolean;
  isDisabled: boolean;
  isActive: boolean;
  expiresInMs: number;
  expiresInLabel: string;
};

type RecentEvent = {
  id: string;
  kind: string;
  at: string;
  serverId?: string;
  entryId?: string;
  entryName?: string;
  playerName?: string;
  steamID?: string;
  eosID?: string;
  matchType?: string;
  matchValue?: string;
  reason?: string;
  error?: string;
  expiresAt?: string;
};

type PanelBanState = {
  enabled: boolean;
  subscribed: boolean;
  dataDir: string;
  filePath: string;
  cacheMs: number;
  retryCooldownMs: number;
  matchNameFallback: boolean;
  lastLoadedAt: string;
  lastScanAt: string;
  lastKickAt: string;
  lastError: string;
  kickAttempts: number;
  kickSuccess: number;
  kickFailed: number;
  totalEntries: number;
  activeEntries: number;
  disabledEntries: number;
  expiredEntries: number;
  lastMatch: null | {
    playerName: string;
    steamID: string;
    eosID: string;
    entryId: string;
    matchType: string;
    matchValue: string;
    at: string;
    reason: string;
    expiresAt: string;
  };
  entries: BanEntry[];
  recentHits: RecentEvent[];
  recentEvents: RecentEvent[];
};

type ApiResponse<T> = {
  ok: boolean;
  data: T;
};

const pageError = ref("");
const saving = ref(false);
const reloading = ref(false);
const rescanning = ref(false);
const busyId = ref("");
const viewStatus = ref<StatusView>("all");
const searchText = ref("");
const editingId = ref("");
const draft = reactive({
  steamID: "",
  eosID: "",
  name: "",
  reason: "",
  expiresAt: "",
  durationValue: 7,
  durationUnit: "days" as DurationUnit,
  status: "active" as EntryStatus,
});

const {
  data: state,
  loading,
  refreshing,
  error,
  refresh,
} = usePollingResource<PanelBanState | null>({
  fetcher: async () => {
    const response = await apiGet<ApiResponse<PanelBanState | null>>("/api/plugins/panel-ban/state");
    return response?.data ?? null;
  },
  intervalMs: 5000,
  immediate: true,
  pauseWhenHidden: true,
  refreshOnActivated: true,
  keepPreviousData: true,
});

const summaryItems = computed<StatItem[]>(() => {
  const current = state.value;
  return [
    {
      key: "total",
      label: "总条目",
      value: current?.totalEntries ?? 0,
      description: "包含有效、禁用和已过期记录",
      tone: "info",
    },
    {
      key: "active",
      label: "有效",
      value: current?.activeEntries ?? 0,
      description: "当前会拦截进服的封禁",
      tone: "success",
    },
    {
      key: "expired",
      label: "已过期",
      value: current?.expiredEntries ?? 0,
      description: "过期后保留用于审计",
      tone: "warning",
    },
    {
      key: "disabled",
      label: "已禁用",
      value: current?.disabledEntries ?? 0,
      description: "人工停用但仍保留记录",
      tone: "neutral",
    },
    {
      key: "hits",
      label: "命中次数",
      value: current?.kickSuccess ?? 0,
      description: `尝试 ${current?.kickAttempts ?? 0} / 失败 ${current?.kickFailed ?? 0}`,
      tone: "info",
    },
  ];
});

const statusOptions: Array<{ value: StatusView; label: string }> = [
  { value: "all", label: "全部" },
  { value: "active", label: "有效" },
  { value: "disabled", label: "禁用" },
  { value: "expired", label: "已过期" },
];

const visibleEntries = computed(() => {
  const entries = state.value?.entries ?? [];
  const status = viewStatus.value;
  const search = searchText.value.trim().toLowerCase();

  return entries.filter((entry) => {
    if (status !== "all" && entry.status !== status) return false;
    if (!search) return true;
    const haystack = [
      entry.id,
      entry.steamID,
      entry.eosID,
      entry.name,
      entry.reason,
      entry.createdBy,
      entry.lastHitPlayerName,
      entry.lastHitServerId,
      entry.lastHitMatchType,
      entry.lastHitMatchValue,
    ].join(" ").toLowerCase();
    return haystack.includes(search);
  });
});

const recentHitEvents = computed(() => (state.value?.recentHits ?? []).slice(0, 12));
const recentEvents = computed(() => (state.value?.recentEvents ?? []).slice(0, 12));

const expiryPreview = computed(() => {
  if (draft.expiresAt) {
    return {
      label: formatDateTimeInput(draft.expiresAt),
      hint: "优先使用到期时间字段",
    };
  }

  const ms = durationToMs(draft.durationValue, draft.durationUnit);
  if (!ms) {
    return {
      label: "未设置",
      hint: "填写到期时间或时长后再提交",
    };
  }

  const target = new Date(Date.now() + ms);
  return {
    label: target.toLocaleString(),
    hint: `按 ${draft.durationValue} ${durationUnitLabel(draft.durationUnit)} 自动换算`,
  };
});

function formatDateTimeInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return date.toLocaleString();
}

function durationToMs(value: number, unit: DurationUnit) {
  const amount = Number(value ?? 0) || 0;
  if (amount <= 0) return 0;
  const factor = {
    minutes: 60_000,
    hours: 3_600_000,
    days: 86_400_000,
    weeks: 7 * 86_400_000,
  }[unit];
  return Math.max(0, Math.floor(amount * factor));
}

function durationUnitLabel(unit: DurationUnit) {
  return {
    minutes: "分钟",
    hours: "小时",
    days: "天",
    weeks: "周",
  }[unit];
}

function localDateTimeValue(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function resolveDraftExpiry() {
  if (draft.expiresAt) {
    const direct = new Date(draft.expiresAt);
    if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  }
  const durationMs = durationToMs(draft.durationValue, draft.durationUnit);
  if (durationMs > 0) return new Date(Date.now() + durationMs).toISOString();
  return "";
}

function pushPageError(message: string) {
  pageError.value = message;
}

async function refreshState() {
  pageError.value = "";
  try {
    await refresh();
  } catch (err) {
    pushPageError(err instanceof Error ? err.message : String(err));
  }
}

async function reloadStore() {
  reloading.value = true;
  pageError.value = "";
  try {
    await apiPost<ApiResponse<PanelBanState | null>>("/api/plugins/panel-ban/reload", {});
    await refresh();
  } catch (err) {
    pushPageError(err instanceof Error ? err.message : String(err));
  } finally {
    reloading.value = false;
  }
}

async function rescanNow() {
  rescanning.value = true;
  pageError.value = "";
  try {
    await apiPost<ApiResponse<PanelBanState | null>>("/api/plugins/panel-ban/rescan", {});
    await refresh();
  } catch (err) {
    pushPageError(err instanceof Error ? err.message : String(err));
  } finally {
    rescanning.value = false;
  }
}

function resetDraft() {
  editingId.value = "";
  draft.steamID = "";
  draft.eosID = "";
  draft.name = "";
  draft.reason = "";
  draft.expiresAt = "";
  draft.durationValue = 7;
  draft.durationUnit = "days";
  draft.status = "active";
}

function editEntry(entry: BanEntry) {
  editingId.value = entry.id;
  draft.steamID = entry.steamID;
  draft.eosID = entry.eosID;
  draft.name = entry.name;
  draft.reason = entry.reason;
  draft.expiresAt = localDateTimeValue(entry.expiresAt);
  draft.durationValue = 7;
  draft.durationUnit = "days";
  draft.status = entry.status;
}

async function submitDraft() {
  pageError.value = "";

  if (!draft.steamID && !draft.eosID && !draft.name) {
    pushPageError("Steam64、EOS 或名称至少需要填写一项。");
    return;
  }

  const expiresAt = resolveDraftExpiry();
  if (!expiresAt) {
    pushPageError("请填写到期时间，或提供有效时长。");
    return;
  }

  const payload = {
    steamID: draft.steamID,
    eosID: draft.eosID,
    name: draft.name,
    reason: draft.reason,
    expiresAt,
    status: draft.status,
  };

  saving.value = true;
  try {
    if (editingId.value) {
      await apiPatch<ApiResponse<BanEntry>>(`/api/plugins/panel-ban/entries/${encodeURIComponent(editingId.value)}`, payload);
    } else {
      await apiPost<ApiResponse<BanEntry>>("/api/plugins/panel-ban/entries", payload);
    }
    resetDraft();
    await refresh();
  } catch (err) {
    pushPageError(err instanceof Error ? err.message : String(err));
  } finally {
    saving.value = false;
  }
}

async function setEntryStatus(entry: BanEntry, status: EntryStatus) {
  busyId.value = entry.id;
  pageError.value = "";
  try {
    await apiPatch<ApiResponse<BanEntry>>(`/api/plugins/panel-ban/entries/${encodeURIComponent(entry.id)}`, {
      status,
      expiresAt: entry.expiresAt,
    });
    await refresh();
  } catch (err) {
    pushPageError(err instanceof Error ? err.message : String(err));
  } finally {
    busyId.value = "";
  }
}

async function removeEntry(entry: BanEntry) {
  const confirmed = typeof window === "undefined"
    ? true
    : window.confirm(`确认删除封禁条目 ${entry.name || entry.id} 吗？`);
  if (!confirmed) return;

  busyId.value = entry.id;
  pageError.value = "";
  try {
    await apiDelete<ApiResponse<BanEntry>>(`/api/plugins/panel-ban/entries/${encodeURIComponent(entry.id)}`);
    if (editingId.value === entry.id) resetDraft();
    await refresh();
  } catch (err) {
    pushPageError(err instanceof Error ? err.message : String(err));
  } finally {
    busyId.value = "";
  }
}

function entryStatusLabel(status: EntryStatus) {
  if (status === "active") return "有效";
  if (status === "disabled") return "禁用";
  return "已过期";
}

function entryStatusTone(status: EntryStatus) {
  if (status === "active") return "success";
  if (status === "disabled") return "neutral";
  return "warning";
}

function eventTone(kind: string) {
  if (kind.includes("failed") || kind.includes("error")) return "danger";
  if (kind.includes("expired")) return "warning";
  if (kind.includes("created") || kind.includes("updated") || kind.includes("loaded") || kind.includes("match")) {
    return "success";
  }
  return "info";
}
</script>

<style scoped>
.panel-ban-page {
  display: grid;
  gap: 16px;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(300px, 1fr);
  gap: 16px;
  align-items: start;
}

.main-column,
.side-column {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.ban-form {
  display: grid;
  gap: 16px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.field {
  display: grid;
  gap: 6px;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.field--wide {
  grid-column: 1 / -1;
}

.field input,
.field textarea,
.field select,
.search-box input {
  width: 100%;
  border-radius: 12px;
  border: 1px solid var(--color-border-default);
  background: color-mix(in srgb, var(--color-bg-card) 70%, #000 30%);
  color: var(--color-text-primary);
  padding: 10px 12px;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}

.field textarea {
  resize: vertical;
}

.field input:focus,
.field textarea:focus,
.field select:focus,
.search-box input:focus {
  border-color: color-mix(in srgb, var(--color-status-info) 60%, white 40%);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-status-info) 22%, transparent);
}

.form-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.preview {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--color-border-default);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.01));
}

.preview-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
}

.preview strong {
  font-size: 14px;
}

.preview span {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.form-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.search-box {
  display: grid;
  gap: 6px;
  min-width: 260px;
}

.search-box span {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.status-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.status-tab {
  border: 1px solid var(--color-border-default);
  background: transparent;
  color: var(--color-text-secondary);
  border-radius: 999px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.status-tab.active {
  color: var(--color-text-primary);
  border-color: color-mix(in srgb, var(--color-status-info) 50%, var(--color-border-default));
  background: color-mix(in srgb, var(--color-status-info) 10%, transparent);
}

.table-wrap {
  overflow: auto;
  margin-top: 12px;
}

.ban-table {
  width: 100%;
  border-collapse: collapse;
}

.ban-table th,
.ban-table td {
  padding: 12px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-default) 80%, transparent);
  vertical-align: top;
}

.ban-table th {
  text-align: left;
  font-size: 12px;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.identity-cell,
.time-cell {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.identity-cell strong,
.time-cell strong {
  font-size: 13px;
}

.identity-cell span,
.time-cell span {
  font-size: 11px;
  color: var(--color-text-muted);
}

.reason-cell {
  max-width: 340px;
  color: var(--color-text-secondary);
}

.row-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.row--disabled {
  opacity: 0.8;
}

.row--expired {
  background: color-mix(in srgb, var(--color-status-warning) 4%, transparent);
}

.event-list {
  display: grid;
  gap: 10px;
}

.event-item {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--color-border-default);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.01));
}

.event-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--color-text-muted);
}

.event-item strong {
  font-size: 13px;
}

.event-item span {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.notice {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--color-border-default);
}

.notice strong {
  flex: none;
}

.notice--danger {
  border-color: color-mix(in srgb, var(--color-status-danger, var(--color-status-error)) 30%, var(--color-border-default));
  background: color-mix(in srgb, var(--color-status-danger, var(--color-status-error)) 10%, transparent);
}

@media (max-width: 1160px) {
  .layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 860px) {
  .form-grid,
  .form-meta {
    grid-template-columns: 1fr;
  }

  .reason-cell {
    max-width: none;
  }
}
</style>
