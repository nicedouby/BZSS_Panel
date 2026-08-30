<template>
  <section class="panel-ban-page">
    <PageHeader title="面板封禁" subtitle="创建、检索和维护全局封禁记录。" eyebrow="Moderation">
      <template #actions>
        <div class="header-actions">
          <StatusBadge v-if="state" :tone="state.lastError ? 'danger' : 'success'" dot>{{ state.lastError ? "服务异常" : "服务正常" }}</StatusBadge>
          <AppButton size="sm" variant="ghost" :loading="refreshing || loading" @click="refreshState">刷新</AppButton>
          <AppButton size="sm" variant="ghost" :loading="reloading" @click="reloadStore">重载</AppButton>
          <AppButton size="sm" variant="ghost" :loading="rescanning" @click="rescanNow">扫描在线玩家</AppButton>
        </div>
      </template>
    </PageHeader>

    <StatGrid :items="summaryItems" :loading="loading && !state" />

    <div v-if="pageError || error || state?.lastError" class="notice notice--danger" role="alert">
      <strong>异常</strong><span>{{ pageError || error || state?.lastError }}</span>
    </div>

    <PageCard class="quick-ban-card" :title="editingId ? '编辑封禁' : '快速封禁'" :description="editingId ? '正在修改 ' + editingId : '选择玩家、填写原因并确定有效期。'">
      <form class="quick-ban-form" :class="{ 'ban-actions-disabled': !canBan }" @submit.prevent="submitDraft">
        <div class="quick-ban-primary">
          <div class="field field--player">
            <span>玩家</span>
            <PlayerSelect v-model="targetPlayerInput" @select="handlePlayerSelect" placeholder="玩家名 / Steam64 / EOS ID" />
            <div v-if="draft.name || draft.steamID || draft.eosID" class="identity-preview">
              <strong>{{ draft.name || "未记录玩家名" }}</strong>
              <span>{{ draft.steamID || draft.eosID }}</span>
            </div>
          </div>

          <label class="field field--reason">
            <span>封禁原因</span>
            <textarea v-model.trim="draft.reason" rows="2" placeholder="填写违规行为与处理依据" />
          </label>
        </div>

        <div class="quick-ban-options">
          <div class="duration-block">
            <span class="field-label">封禁时长</span>
            <div class="duration-preset">
              <button type="button" @click="setQuickDuration(1)">1 天</button>
              <button type="button" @click="setQuickDuration(3)">3 天</button>
              <button type="button" @click="setQuickDuration(7)">7 天</button>
              <button type="button" @click="setQuickDuration(30)">30 天</button>
            </div>
          </div>

          <label class="field field--duration">
            <span>自定义</span>
            <div class="inline-fields">
              <input v-model.number="draft.durationValue" type="number" min="1" step="1" />
              <select v-model="draft.durationUnit">
                <option value="minutes">分钟</option>
                <option value="hours">小时</option>
                <option value="days">天</option>
                <option value="weeks">周</option>
              </select>
            </div>
          </label>

          <label class="field field--expiry">
            <span>精确到期</span>
            <input v-model="draft.expiresAt" type="datetime-local" />
          </label>

          <label class="field field--status">
            <span>状态</span>
            <select v-model="draft.status">
              <option value="active">有效</option>
              <option value="disabled">禁用</option>
              <option value="expired">已过期</option>
            </select>
          </label>

          <div class="expiry-summary">
            <span>预计到期</span>
            <strong>{{ expiryPreview.label }}</strong>
            <small>{{ expiryPreview.hint }}</small>
          </div>
        </div>

        <div class="quick-ban-footer">
          <span v-if="!canBan" class="permission-hint">当前账户没有封禁管理权限。</span>
          <span v-else class="form-hint">身份、原因与到期时间确认无误后提交。</span>
          <div class="form-actions">
            <AppButton type="button" variant="ghost" :disabled="saving" @click="resetDraft">{{ editingId ? "取消编辑" : "清空" }}</AppButton>
            <AppButton type="submit" :loading="saving" :disabled="!canBan">{{ editingId ? "保存修改" : "创建封禁" }}</AppButton>
          </div>
        </div>
      </form>
    </PageCard>

    <PageCard class="ban-list-card" title="封禁名单" :description="'显示 ' + visibleEntries.length + ' 条，共 ' + (state?.totalEntries ?? 0) + ' 条。'">
      <div class="list-toolbar">
        <label class="search-box">
          <span class="sr-only">搜索封禁名单</span>
          <input v-model.trim="searchText" type="search" placeholder="搜索玩家名、Steam64、EOS 或封禁原因" />
        </label>
        <div class="status-tabs" role="tablist" aria-label="封禁状态">
          <button v-for="option in statusOptions" :key="option.value" type="button" class="status-tab" :class="{ active: viewStatus === option.value }" @click="viewStatus = option.value">{{ option.label }}</button>
        </div>
      </div>

      <div class="ban-list">
        <article v-for="entry in visibleEntries" :key="entry.id" class="ban-row" :class="'ban-row--' + entry.status">
          <div class="ban-row-status"><StatusBadge :tone="entryStatusTone(entry.status)" size="sm">{{ entryStatusLabel(entry.status) }}</StatusBadge></div>

          <div class="ban-identity">
            <strong>{{ entry.name || "未记录玩家名" }}</strong>
            <button v-if="entry.steamID" type="button" class="identity-id identity-id--steam" title="复制 Steam64" @click="copyTextWithToast(entry.steamID, ui)"><span>STEAM</span><code>{{ entry.steamID }}</code></button>
            <button v-if="entry.eosID" type="button" class="identity-id identity-id--eos" title="复制 EOS ID" @click="copyTextWithToast(entry.eosID, ui)"><span>EOS</span><code>{{ entry.eosID }}</code></button>
          </div>

          <div class="ban-reason">
            <span class="row-label">原因</span>
            <p :title="entry.reason || '未填写原因'">{{ entry.reason || "未填写原因" }}</p>
            <small>{{ entry.createdBy || "未知管理员" }}</small>
          </div>

          <div class="ban-expiry">
            <span class="row-label">剩余时间</span>
            <strong :class="{ 'text-danger': entry.status === 'active' && entry.expiresInMs < 86400000 }">{{ entry.expiresInLabel }}</strong>
            <small>{{ formatTime(entry.expiresAt) }}</small>
          </div>

          <div class="ban-hit">
            <span class="hit-count" :class="{ 'hit-count--active': entry.hitCount > 0 }">{{ entry.hitCount }}</span>
            <div>
              <span class="row-label">命中次数</span>
              <strong v-if="entry.lastHitAt">{{ entry.lastHitPlayerName || "未知玩家" }}</strong>
              <small>{{ entry.lastHitAt ? formatTime(entry.lastHitAt) : "尚未命中" }}</small>
            </div>
          </div>

          <div class="row-actions">
            <AppButton size="sm" variant="ghost" :disabled="busyId === entry.id || !canBan" @click="editEntry(entry)">编辑</AppButton>
            <AppButton v-if="entry.status === 'active'" size="sm" variant="ghost" :disabled="busyId === entry.id || !canBan" @click="setEntryStatus(entry, 'disabled')">停用</AppButton>
            <AppButton v-else-if="entry.status === 'disabled'" size="sm" variant="ghost" :disabled="busyId === entry.id || !canBan" @click="setEntryStatus(entry, 'active')">启用</AppButton>
            <AppButton size="sm" variant="ghost" :disabled="busyId === entry.id || !canBan" @click="removeEntry(entry)">删除</AppButton>
          </div>
        </article>
      </div>

      <EmptyState v-if="!visibleEntries.length && !loading" compact title="没有匹配的封禁条目" description="尝试切换状态或清除搜索关键词。" />
    </PageCard>

    <PageCard class="activity-card" title="最近活动" description="封禁命中与名单变更记录。">
      <template #actions>
        <div class="event-tabs">
          <button type="button" class="event-tab-btn" :class="{ 'event-tab-btn--active': activeEventTab === 'hits' }" @click="activeEventTab = 'hits'">命中 {{ recentHitEvents.length }}</button>
          <button type="button" class="event-tab-btn" :class="{ 'event-tab-btn--active': activeEventTab === 'events' }" @click="activeEventTab = 'events'">系统 {{ recentEvents.length }}</button>
        </div>
      </template>

      <div class="activity-list">
        <template v-if="activeEventTab === 'hits'">
          <article v-for="event in recentHitEvents" :key="event.id" class="activity-row" :data-kind="event.kind">
            <StatusBadge :tone="event.kind === 'kick_success' ? 'success' : event.kind === 'kick_failed' ? 'danger' : 'info'" size="sm">{{ event.kind }}</StatusBadge>
            <strong>{{ event.playerName || event.entryName || "未知玩家" }}</strong>
            <span>{{ event.matchType ? event.matchType + ": " + event.matchValue : event.reason || "未记录匹配信息" }}</span>
            <span>{{ event.serverId || "global" }}</span>
            <time>{{ formatTime(event.at) }}</time>
          </article>
          <EmptyState v-if="!recentHitEvents.length && !loading" compact title="暂无命中历史" description="还没有玩家命中封禁名单。" />
        </template>
        <template v-else>
          <article v-for="event in recentEvents" :key="event.id" class="activity-row" :data-kind="event.kind">
            <StatusBadge :tone="eventTone(event.kind)" size="sm">{{ event.kind }}</StatusBadge>
            <strong>{{ event.entryName || event.playerName || event.error || "系统事件" }}</strong>
            <span>{{ event.reason || event.entryId || "未记录补充信息" }}</span>
            <span>{{ event.serverId || "global" }}</span>
            <time>{{ formatTime(event.at) }}</time>
          </article>
          <EmptyState v-if="!recentEvents.length && !loading" compact title="暂无系统事件" description="系统尚未记录封禁事件。" />
        </template>
      </div>
    </PageCard>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

import { apiDelete, apiGet, apiPatch, apiPost } from "../app/apiClient";
import AppButton from "../components/ui/AppButton.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import PageCard from "../components/common/PageCard.vue";
import PageHeader from "../components/common/PageHeader.vue";
import StatGrid from "../components/ui/StatGrid.vue";
import type { StatItem } from "../components/ui/StatGrid.vue";
import StatusBadge from "../components/ui/StatusBadge.vue";
import PlayerSelect from "../components/common/PlayerSelect.vue";
import { formatTime } from "../composables/useDateTimeFormat";
import { usePollingResource } from "../composables/usePollingResource";
import { copyTextWithToast } from "../utils/clipboard";
import { hasPermission } from "../shared/web-page-permissions.js";
import { useUiStore } from "../stores/ui.store";
import { useAuthStore } from "../stores/auth.store";

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

const ui = useUiStore();
const auth = useAuthStore();
const canBan = computed(() => Boolean(auth.user?.isSuperAdmin)
  || hasPermission(auth.user?.permissions ?? [], "panel_ban.ban")
  || hasPermission(auth.user?.permissions ?? [], "panel_ban.manage"));
const pageError = ref("");
const saving = ref(false);
const reloading = ref(false);
const rescanning = ref(false);
const busyId = ref("");
const viewStatus = ref<StatusView>("all");
const searchText = ref("");
const editingId = ref("");
const targetPlayerInput = ref("");
const activeEventTab = ref<"hits" | "events">("hits");

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

watch(targetPlayerInput, (val) => {
  const cleanVal = val.trim();
  if (!cleanVal) {
    draft.steamID = "";
    draft.eosID = "";
    draft.name = "";
    return;
  }

  if (cleanVal === draft.name || cleanVal === draft.steamID || cleanVal === draft.eosID) {
    return;
  }

  // 17-digit numeric string starting with 7 (Steam64)
  if (/^7\d{16}$/.test(cleanVal)) {
    if (draft.steamID !== cleanVal) {
      draft.steamID = cleanVal;
      draft.eosID = "";
      draft.name = "";
    }
    return;
  }

  // EOS ID checks: 32 hex chars or starts with "eos"
  if (/^[0-9a-fA-F]{32}$/.test(cleanVal) || cleanVal.toLowerCase().startsWith("eos")) {
    if (draft.eosID !== cleanVal) {
      draft.eosID = cleanVal;
      draft.steamID = "";
      draft.name = "";
    }
    return;
  }

  // Fallback: Name
  if (draft.name !== cleanVal) {
    draft.name = cleanVal;
    draft.steamID = "";
    draft.eosID = "";
  }
});

function setQuickDuration(days: number) {
  draft.durationValue = days;
  draft.durationUnit = "days";
}

function handlePlayerSelect(player: any) {
  draft.steamID = player.steam_id || player.steamID || player.steamId || "";
  draft.eosID = player.eos_id || player.eosID || player.eosId || "";
  draft.name = player.current_name || player.name || "";
  targetPlayerInput.value = draft.name || draft.steamID || draft.eosID || "";
}

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
  targetPlayerInput.value = "";
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
  targetPlayerInput.value = entry.name || entry.steamID || entry.eosID || "";
  
  if (typeof window !== "undefined") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
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

function expiryLabelClass(entry: BanEntry) {
  if (entry.status !== "active") return "text-muted";
  if (entry.expiresInMs && entry.expiresInMs < 86_400_000) {
    return "text-danger-pulse";
  }
  return "text-success-soft";
}
</script>

<style scoped>
.panel-ban-page{display:grid;gap:16px;min-width:0}.header-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.notice{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border:1px solid var(--color-border-default);border-radius:12px}.notice--danger{border-color:color-mix(in srgb,var(--color-status-danger,var(--color-status-error)) 38%,var(--color-border-default));background:color-mix(in srgb,var(--color-status-danger,var(--color-status-error)) 10%,transparent)}
.quick-ban-form{display:grid;gap:14px}.quick-ban-primary{display:grid;grid-template-columns:minmax(280px,.85fr) minmax(360px,1.4fr);gap:14px}.quick-ban-options{display:grid;grid-template-columns:auto 190px minmax(210px,1fr) 120px minmax(180px,.8fr);align-items:end;gap:10px;padding-top:14px;border-top:1px solid color-mix(in srgb,var(--color-border-default) 75%,transparent)}.field{display:grid;align-content:start;gap:6px;min-width:0;color:var(--color-text-secondary);font-size:11px}.field>span,.field-label{color:var(--color-text-muted);font-size:10px;font-weight:700;letter-spacing:.04em}.field input,.field textarea,.field select,.search-box input{width:100%;border:1px solid var(--color-border-default);border-radius:9px;outline:none;background:color-mix(in srgb,var(--color-bg-card) 72%,#000 28%);color:var(--color-text-primary);padding:9px 10px}.field textarea{min-height:64px;resize:vertical}.field input:focus,.field textarea:focus,.field select:focus,.search-box input:focus{border-color:color-mix(in srgb,var(--color-status-info) 60%,white 40%);box-shadow:0 0 0 3px color-mix(in srgb,var(--color-status-info) 15%,transparent)}
.identity-preview{display:flex;align-items:center;gap:8px;min-width:0;padding:6px 9px;border:1px dashed color-mix(in srgb,var(--color-status-info) 30%,var(--color-border-default));border-radius:8px;background:color-mix(in srgb,var(--color-status-info) 5%,transparent)}.identity-preview strong{flex:none;font-size:11px}.identity-preview span{min-width:0;overflow:hidden;color:var(--color-text-muted);font:9px ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis;white-space:nowrap}.duration-block{display:grid;gap:6px}.duration-preset{display:flex;gap:5px}.duration-preset button{height:35px;padding:0 10px;border:1px solid var(--color-border-default);border-radius:8px;background:rgba(255,255,255,.025);color:var(--color-text-secondary);cursor:pointer;font-size:10px;font-weight:700}.duration-preset button:hover{border-color:color-mix(in srgb,var(--color-status-info) 45%,var(--color-border-default));color:var(--color-text-primary)}.inline-fields{display:grid;grid-template-columns:70px 1fr;gap:5px}.expiry-summary{display:grid;grid-template-columns:auto 1fr;align-items:baseline;gap:2px 8px;min-height:55px;padding:8px 10px;border:1px solid color-mix(in srgb,var(--color-border-default) 75%,transparent);border-radius:9px;background:rgba(255,255,255,.02)}.expiry-summary span{color:var(--color-text-muted);font-size:9px}.expiry-summary strong{overflow:hidden;font-size:11px;text-align:right;text-overflow:ellipsis;white-space:nowrap}.expiry-summary small{grid-column:1/-1;color:var(--color-text-muted);font-size:9px}.quick-ban-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:12px;border-top:1px solid color-mix(in srgb,var(--color-border-default) 75%,transparent)}.form-hint,.permission-hint{font-size:10px}.form-hint{color:var(--color-text-muted)}.permission-hint{color:var(--color-status-danger)}.form-actions{display:flex;gap:8px}
.list-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.search-box{flex:1;min-width:240px}.status-tabs,.event-tabs{display:flex;gap:4px;padding:3px;border:1px solid color-mix(in srgb,var(--color-border-default) 75%,transparent);border-radius:9px;background:rgba(0,0,0,.13)}.status-tab,.event-tab-btn{border:0;border-radius:6px;background:transparent;color:var(--color-text-muted);cursor:pointer;font-size:10px;font-weight:700;padding:7px 10px;white-space:nowrap}.status-tab.active,.event-tab-btn--active{background:color-mix(in srgb,var(--color-status-info) 12%,rgba(255,255,255,.03));color:var(--color-status-info)}
.ban-list{display:grid;max-height:640px;overflow:auto;border:1px solid color-mix(in srgb,var(--color-border-default) 72%,transparent);border-radius:11px;overscroll-behavior:contain}.ban-row{display:grid;grid-template-columns:70px minmax(210px,1.05fr) minmax(180px,1.4fr) 130px 160px auto;align-items:center;gap:12px;min-height:82px;padding:11px 12px;border-bottom:1px solid color-mix(in srgb,var(--color-border-default) 72%,transparent);transition:background .15s ease}.ban-row:last-child{border-bottom:0}.ban-row:hover{background:rgba(255,255,255,.018)}.ban-row--disabled{opacity:.65}.ban-row--expired{background:color-mix(in srgb,var(--color-status-warning) 4%,transparent)}.ban-identity,.ban-reason,.ban-expiry{display:grid;gap:4px;min-width:0}.ban-identity>strong{overflow:hidden;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.identity-id{display:flex;width:fit-content;max-width:100%;overflow:hidden;padding:0;border:1px solid rgba(255,255,255,.06);border-radius:5px;background:rgba(0,0,0,.17);color:var(--color-text-muted);cursor:pointer}.identity-id span{flex:none;padding:3px 5px;color:#dbeafe;background:rgba(59,130,246,.25);font-size:8px;font-weight:800}.identity-id--eos span{color:#f3e8ff;background:rgba(168,85,247,.25)}.identity-id code{min-width:0;overflow:hidden;padding:3px 6px;color:inherit;font-size:9px;text-overflow:ellipsis}.row-label{color:var(--color-text-muted);font-size:9px;font-weight:700;text-transform:uppercase}.ban-reason p{display:-webkit-box;overflow:hidden;margin:0;color:var(--color-text-secondary);font-size:11px;line-height:1.4;-webkit-box-orient:vertical;-webkit-line-clamp:2}.ban-reason small,.ban-expiry small,.ban-hit small{color:var(--color-text-muted);font-size:9px}.ban-expiry strong{color:var(--color-status-success);font-size:12px}.text-danger{color:var(--color-status-danger)!important}.ban-hit{display:flex;align-items:center;gap:8px;min-width:0}.ban-hit>div{display:grid;gap:3px;min-width:0}.ban-hit strong{overflow:hidden;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.hit-count{display:grid;place-items:center;min-width:30px;height:30px;padding:0 6px;border-radius:8px;background:rgba(255,255,255,.045);color:var(--color-text-muted);font-size:11px;font-weight:800}.hit-count--active{border:1px solid color-mix(in srgb,var(--color-status-danger) 35%,transparent);background:color-mix(in srgb,var(--color-status-danger) 10%,transparent);color:color-mix(in srgb,var(--color-status-danger) 75%,white)}.row-actions{display:flex;justify-content:flex-end;gap:3px;white-space:nowrap}
.activity-list{display:grid;max-height:270px;overflow:auto}.activity-row{display:grid;grid-template-columns:100px minmax(140px,.7fr) minmax(220px,1.5fr) minmax(80px,.5fr) 145px;align-items:center;gap:12px;min-height:48px;padding:8px 10px;border-bottom:1px solid color-mix(in srgb,var(--color-border-default) 70%,transparent);border-left:2px solid var(--color-border-default)}.activity-row:last-child{border-bottom:0}.activity-row[data-kind="kick_success"]{border-left-color:var(--color-status-success)}.activity-row[data-kind="kick_failed"]{border-left-color:var(--color-status-danger)}.activity-row strong,.activity-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.activity-row strong{font-size:11px}.activity-row span,.activity-row time{color:var(--color-text-muted);font-size:9px}.activity-row time{text-align:right;white-space:nowrap}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}.ban-list::-webkit-scrollbar,.activity-list::-webkit-scrollbar{width:7px}.ban-list::-webkit-scrollbar-thumb,.activity-list::-webkit-scrollbar-thumb{border-radius:999px;background:rgba(255,255,255,.1)}
@media(max-width:1280px){.quick-ban-options{grid-template-columns:1fr 190px minmax(210px,1fr) 110px}.expiry-summary{grid-column:1/-1}.ban-row{grid-template-columns:64px minmax(200px,1fr) minmax(180px,1.2fr) 120px 145px}.row-actions{grid-column:2/-1}.ban-row{min-height:104px}}@media(max-width:900px){.quick-ban-primary{grid-template-columns:1fr}.quick-ban-options{grid-template-columns:1fr 1fr}.duration-block,.expiry-summary{grid-column:1/-1}.ban-row{grid-template-columns:64px minmax(190px,1fr) minmax(150px,1fr)}.ban-expiry,.ban-hit,.row-actions{grid-column:auto}.ban-hit{grid-column:2}.row-actions{grid-column:3;grid-row:2}.activity-row{grid-template-columns:90px minmax(130px,.7fr) minmax(180px,1.2fr) 130px}.activity-row>span:nth-of-type(2){display:none}}@media(max-width:640px){.header-actions{justify-content:flex-start}.quick-ban-options{grid-template-columns:1fr}.duration-block,.expiry-summary{grid-column:auto}.quick-ban-footer,.list-toolbar{align-items:stretch;flex-direction:column}.form-actions{justify-content:flex-end}.status-tabs,.event-tabs{width:100%;overflow:auto}.status-tab,.event-tab-btn{flex:1 0 auto}.ban-row{grid-template-columns:1fr;gap:8px}.ban-row-status,.ban-identity,.ban-reason,.ban-expiry,.ban-hit,.row-actions{grid-column:1;grid-row:auto}.row-actions{justify-content:flex-start}.activity-row{grid-template-columns:86px minmax(0,1fr)}.activity-row>span,.activity-row time{grid-column:2}.activity-row>span:nth-of-type(2){display:none}.activity-row time{text-align:left}}
</style>
