<template>
  <section class="panel-ban-page">
    <PageHeader title="面板封禁" subtitle="集中管理封禁身份、有效期和命中记录。所有操作继续使用现有权限与审计链路。" eyebrow="Moderation">
      <template #actions>
        <div class="header-actions">
          <StatusBadge v-if="state" :tone="state.lastError ? 'danger' : 'success'" dot>{{ state.lastError ? "状态异常" : "封禁服务正常" }}</StatusBadge>
          <AppButton size="sm" variant="ghost" :loading="refreshing || loading" @click="refreshState">刷新</AppButton>
          <AppButton size="sm" variant="ghost" :loading="reloading" @click="reloadStore">重载列表</AppButton>
          <AppButton size="sm" variant="ghost" :loading="rescanning" @click="rescanNow">扫描在线玩家</AppButton>
        </div>
      </template>
    </PageHeader>

    <StatGrid :items="summaryItems" :loading="loading && !state" />
    <div v-if="pageError || error || state?.lastError" class="notice notice--danger" role="alert">
      <strong>封禁服务异常</strong><span>{{ pageError || error || state?.lastError }}</span>
    </div>

    <div class="ban-workspace">
      <aside class="editor-column">
        <PageCard title="封禁处理" :description="editingId ? '正在修改已有条目，保存后立即生效。' : '选择玩家并设置原因与期限。'" :class="{ 'ban-actions-disabled': !canBan }">
          <form class="ban-form" @submit.prevent="submitDraft">
            <div class="editor-mode" :class="{ 'editor-mode--editing': editingId }">
              <div><span class="section-kicker">{{ editingId ? "EDITING" : "NEW BAN" }}</span><strong>{{ editingId ? "编辑封禁条目" : "创建新封禁" }}</strong></div>
              <StatusBadge :tone="editingId ? 'warning' : 'info'" size="sm">{{ editingId ? "编辑模式" : "新建模式" }}</StatusBadge>
            </div>

            <div class="form-section">
              <div class="section-title"><span class="section-index">01</span><div><strong>选择目标</strong><span>支持玩家名、Steam64 或 EOS ID</span></div></div>
              <div class="field">
                <PlayerSelect v-model="targetPlayerInput" @select="handlePlayerSelect" placeholder="搜索在线玩家或直接粘贴身份 ID" />
              </div>
              <div v-if="draft.name || draft.steamID || draft.eosID" class="selected-identity">
                <strong>{{ draft.name || "未记录玩家名" }}</strong>
                <span v-if="draft.steamID">Steam · {{ draft.steamID }}</span>
                <span v-if="draft.eosID">EOS · {{ draft.eosID }}</span>
              </div>
            </div>

            <div class="form-section">
              <div class="section-title"><span class="section-index">02</span><div><strong>封禁原因</strong><span>该内容会在踢出玩家时展示</span></div></div>
              <label class="field"><textarea v-model.trim="draft.reason" rows="4" placeholder="简明填写违规行为与处理依据" /></label>
            </div>

            <div class="form-section">
              <div class="section-title"><span class="section-index">03</span><div><strong>有效期限</strong><span>选择快捷时长，或自行指定</span></div></div>
              <div class="quick-duration-actions" aria-label="快捷封禁时长">
                <button type="button" @click="setQuickDuration(1)">1 天</button>
                <button type="button" @click="setQuickDuration(3)">3 天</button>
                <button type="button" @click="setQuickDuration(7)">7 天</button>
                <button type="button" @click="setQuickDuration(30)">30 天</button>
              </div>
              <div class="duration-grid">
                <label class="field"><span>时长</span><input v-model.number="draft.durationValue" type="number" min="1" step="1" placeholder="7" /></label>
                <label class="field"><span>单位</span><select v-model="draft.durationUnit"><option value="minutes">分钟</option><option value="hours">小时</option><option value="days">天</option><option value="weeks">周</option></select></label>
              </div>
              <label class="field"><span>精确到期时间</span><input v-model="draft.expiresAt" type="datetime-local" /></label>
              <label class="field"><span>条目状态</span><select v-model="draft.status"><option value="active">有效</option><option value="disabled">禁用</option><option value="expired">已过期</option></select></label>
              <div class="expiry-preview"><span>预计到期</span><strong>{{ expiryPreview.label }}</strong><small>{{ expiryPreview.hint }}</small></div>
            </div>

            <div class="form-actions">
              <AppButton type="submit" :loading="saving" :disabled="!canBan">{{ editingId ? "保存修改" : "确认封禁" }}</AppButton>
              <AppButton type="button" variant="ghost" :disabled="saving" @click="resetDraft">{{ editingId ? "取消编辑" : "清空内容" }}</AppButton>
            </div>
            <p v-if="!canBan" class="permission-hint">当前账户没有封禁管理权限。</p>
          </form>
        </PageCard>
      </aside>

      <main class="list-column">
        <PageCard title="封禁名单" :description="'当前筛选显示 ' + visibleEntries.length + ' 条，共 ' + (state?.totalEntries ?? 0) + ' 条。'">
          <div class="list-toolbar">
            <label class="search-box"><span class="sr-only">搜索封禁名单</span><input v-model.trim="searchText" type="search" placeholder="搜索玩家名、Steam64、EOS 或封禁原因" /></label>
            <div class="status-tabs" role="tablist" aria-label="封禁状态">
              <button v-for="option in statusOptions" :key="option.value" type="button" class="status-tab" :class="{ active: viewStatus === option.value }" @click="viewStatus = option.value">{{ option.label }}</button>
            </div>
          </div>

          <div class="table-wrap">
            <table class="ban-table">
              <thead><tr><th>玩家身份</th><th>封禁原因</th><th>状态与期限</th><th>命中记录</th><th class="action-column">操作</th></tr></thead>
              <tbody>
                <tr v-for="entry in visibleEntries" :key="entry.id" :class="'row--' + entry.status">
                  <td>
                    <div class="identity-cell">
                      <div class="identity-heading"><strong>{{ entry.name || "未记录玩家名" }}</strong><StatusBadge :tone="entryStatusTone(entry.status)" size="sm">{{ entryStatusLabel(entry.status) }}</StatusBadge></div>
                      <button v-if="entry.steamID" type="button" class="identity-id identity-id--steam" title="复制 Steam64" @click="copyTextWithToast(entry.steamID, ui)"><span>STEAM</span><code>{{ entry.steamID }}</code></button>
                      <button v-if="entry.eosID" type="button" class="identity-id identity-id--eos" title="复制 EOS ID" @click="copyTextWithToast(entry.eosID, ui)"><span>EOS</span><code>{{ entry.eosID }}</code></button>
                    </div>
                  </td>
                  <td class="reason-cell"><p :title="entry.reason || '未填写原因'">{{ entry.reason || "未填写原因" }}</p><small>创建人：{{ entry.createdBy || "未知" }}</small></td>
                  <td><div class="expiry-cell"><StatusBadge :tone="entryStatusTone(entry.status)" size="sm">{{ entryStatusLabel(entry.status) }}</StatusBadge><strong :class="{ 'text-danger': entry.status === 'active' && entry.expiresInMs < 86400000 }">{{ entry.expiresInLabel }}</strong><span>{{ formatTime(entry.expiresAt) }}</span></div></td>
                  <td>
                    <div class="hit-cell">
                      <span class="hit-count" :class="{ 'hit-count--active': entry.hitCount > 0 }">{{ entry.hitCount }}</span>
                      <div v-if="entry.lastHitAt"><strong>{{ entry.lastHitPlayerName || "未知玩家" }}</strong><span>{{ formatTime(entry.lastHitAt) }}</span></div>
                      <span v-else class="text-muted">尚未命中</span>
                    </div>
                  </td>
                  <td><div class="row-actions">
                    <AppButton size="sm" variant="ghost" :disabled="busyId === entry.id || !canBan" @click="editEntry(entry)">编辑</AppButton>
                    <AppButton v-if="entry.status === 'active'" size="sm" variant="ghost" :disabled="busyId === entry.id || !canBan" @click="setEntryStatus(entry, 'disabled')">停用</AppButton>
                    <AppButton v-else-if="entry.status === 'disabled'" size="sm" variant="ghost" :disabled="busyId === entry.id || !canBan" @click="setEntryStatus(entry, 'active')">启用</AppButton>
                    <AppButton size="sm" variant="ghost" :disabled="busyId === entry.id || !canBan" @click="removeEntry(entry)">删除</AppButton>
                  </div></td>
                </tr>
              </tbody>
            </table>
          </div>
          <EmptyState v-if="!visibleEntries.length && !loading" compact title="没有匹配的封禁条目" description="尝试切换状态筛选或清除搜索关键词。" />
        </PageCard>
      </main>
    </div>

    <PageCard title="封禁活动" description="核对封禁命中和名单变更，便于管理员快速追溯。">
      <template #actions>
        <div class="event-tabs">
          <button type="button" class="event-tab-btn" :class="{ 'event-tab-btn--active': activeEventTab === 'hits' }" @click="activeEventTab = 'hits'">命中历史 <span>{{ recentHitEvents.length }}</span></button>
          <button type="button" class="event-tab-btn" :class="{ 'event-tab-btn--active': activeEventTab === 'events' }" @click="activeEventTab = 'events'">系统事件 <span>{{ recentEvents.length }}</span></button>
        </div>
      </template>
      <div class="activity-list">
        <template v-if="activeEventTab === 'hits'">
          <article v-for="event in recentHitEvents" :key="event.id" class="activity-item" :data-kind="event.kind">
            <StatusBadge :tone="event.kind === 'kick_success' ? 'success' : event.kind === 'kick_failed' ? 'danger' : 'info'" size="sm">{{ event.kind }}</StatusBadge>
            <div><strong>{{ event.playerName || event.entryName || "未知玩家" }}</strong><span>{{ event.matchType ? event.matchType + ": " + event.matchValue : event.reason || "未记录匹配信息" }}</span></div>
            <span>{{ event.serverId || "global" }}</span><time>{{ formatTime(event.at) }}</time>
          </article>
          <EmptyState v-if="!recentHitEvents.length && !loading" compact title="暂无命中历史" description="还没有玩家命中封禁名单。" />
        </template>
        <template v-else>
          <article v-for="event in recentEvents" :key="event.id" class="activity-item" :data-kind="event.kind">
            <StatusBadge :tone="eventTone(event.kind)" size="sm">{{ event.kind }}</StatusBadge>
            <div><strong>{{ event.entryName || event.playerName || event.error || "系统事件" }}</strong><span>{{ event.reason || event.entryId || "未记录补充信息" }}</span></div>
            <span>{{ event.serverId || "global" }}</span><time>{{ formatTime(event.at) }}</time>
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
.panel-ban-page{display:grid;gap:16px;min-width:0}.header-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.notice{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border:1px solid var(--color-border-default);border-radius:12px}.notice strong{flex:none}.notice--danger{border-color:color-mix(in srgb,var(--color-status-danger,var(--color-status-error)) 38%,var(--color-border-default));background:color-mix(in srgb,var(--color-status-danger,var(--color-status-error)) 10%,transparent)}
.ban-workspace{display:grid;grid-template-columns:minmax(340px,400px) minmax(0,1fr);gap:16px;align-items:start}.editor-column,.list-column{min-width:0}.editor-column{position:sticky;top:16px}.ban-form{display:grid;gap:14px}.editor-mode{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid color-mix(in srgb,var(--color-status-info) 28%,var(--color-border-default));border-radius:12px;background:color-mix(in srgb,var(--color-status-info) 7%,transparent)}.editor-mode--editing{border-color:color-mix(in srgb,var(--color-status-warning) 38%,var(--color-border-default));background:color-mix(in srgb,var(--color-status-warning) 8%,transparent)}.editor-mode>div{display:grid;gap:2px}.editor-mode strong{font-size:13px}.section-kicker{color:var(--color-text-muted);font-size:9px;font-weight:800;letter-spacing:.12em}
.form-section{display:grid;gap:10px;padding-top:14px;border-top:1px solid color-mix(in srgb,var(--color-border-default) 80%,transparent)}.section-title{display:flex;align-items:center;gap:9px}.section-title>div{display:grid;gap:1px}.section-title strong{font-size:13px}.section-title div span{color:var(--color-text-muted);font-size:11px}.section-index{display:grid;place-items:center;width:25px;height:25px;flex:none;border-radius:8px;color:var(--color-status-info);background:color-mix(in srgb,var(--color-status-info) 10%,transparent);font-size:10px;font-weight:800}
.field{display:grid;gap:6px;color:var(--color-text-secondary);font-size:11px}.field input,.field textarea,.field select,.search-box input{width:100%;border:1px solid var(--color-border-default);border-radius:10px;outline:none;background:color-mix(in srgb,var(--color-bg-card) 72%,#000 28%);color:var(--color-text-primary);padding:10px 11px;transition:border-color .15s ease,box-shadow .15s ease}.field textarea{resize:vertical;min-height:88px}.field input:focus,.field textarea:focus,.field select:focus,.search-box input:focus{border-color:color-mix(in srgb,var(--color-status-info) 62%,white 38%);box-shadow:0 0 0 3px color-mix(in srgb,var(--color-status-info) 16%,transparent)}
.selected-identity{display:grid;gap:3px;padding:10px 12px;border:1px dashed color-mix(in srgb,var(--color-status-info) 35%,var(--color-border-default));border-radius:10px;background:color-mix(in srgb,var(--color-status-info) 5%,transparent);overflow:hidden}.selected-identity strong{font-size:13px}.selected-identity span{overflow:hidden;color:var(--color-text-muted);font:10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis;white-space:nowrap}
.quick-duration-actions{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.quick-duration-actions button{min-height:34px;border:1px solid var(--color-border-default);border-radius:9px;background:color-mix(in srgb,var(--color-bg-card) 85%,white 15%);color:var(--color-text-secondary);cursor:pointer;font-size:11px;font-weight:700}.quick-duration-actions button:hover{border-color:color-mix(in srgb,var(--color-status-info) 45%,var(--color-border-default));color:var(--color-text-primary)}.duration-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.expiry-preview{display:grid;grid-template-columns:auto 1fr;align-items:baseline;gap:3px 10px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--color-border-default) 75%,transparent);border-radius:10px;background:rgba(255,255,255,.025)}.expiry-preview span{color:var(--color-text-muted);font-size:10px;letter-spacing:.06em;text-transform:uppercase}.expiry-preview strong{font-size:13px;text-align:right}.expiry-preview small{grid-column:1/-1;color:var(--color-text-muted);font-size:10px}.form-actions{display:grid;grid-template-columns:1fr auto;gap:8px}.permission-hint{margin:0;color:var(--color-status-danger);font-size:11px}
.list-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.search-box{flex:1 1 320px;min-width:220px}.status-tabs,.event-tabs{display:flex;align-items:center;gap:4px;padding:3px;border:1px solid color-mix(in srgb,var(--color-border-default) 75%,transparent);border-radius:10px;background:rgba(0,0,0,.14)}.status-tab,.event-tab-btn{border:0;border-radius:7px;background:transparent;color:var(--color-text-muted);cursor:pointer;font-size:11px;font-weight:700;padding:7px 10px;white-space:nowrap}.status-tab:hover,.event-tab-btn:hover{color:var(--color-text-primary)}.status-tab.active,.event-tab-btn--active{background:color-mix(in srgb,var(--color-status-info) 12%,rgba(255,255,255,.03));color:var(--color-status-info);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--color-status-info) 16%,transparent)}.event-tab-btn span{display:inline-grid;place-items:center;min-width:18px;margin-left:3px;padding:1px 4px;border-radius:999px;background:rgba(255,255,255,.06);font-size:9px}
.table-wrap{max-height:690px;overflow:auto;overscroll-behavior:contain;border:1px solid color-mix(in srgb,var(--color-border-default) 72%,transparent);border-radius:12px}.ban-table{width:100%;min-width:940px;border-collapse:separate;border-spacing:0}.ban-table th{position:sticky;top:0;z-index:2;padding:10px 12px;border-bottom:1px solid var(--color-border-default);background:color-mix(in srgb,var(--color-bg-card) 94%,#000 6%);color:var(--color-text-muted);font-size:10px;letter-spacing:.04em;text-align:left;text-transform:uppercase;white-space:nowrap}.ban-table td{padding:12px;border-bottom:1px solid color-mix(in srgb,var(--color-border-default) 72%,transparent);vertical-align:middle}.ban-table tbody tr:last-child td{border-bottom:0}.ban-table tbody tr{transition:background-color .15s ease}.ban-table tbody tr:hover{background:rgba(255,255,255,.018)}.row--disabled{opacity:.67}.row--expired{background:color-mix(in srgb,var(--color-status-warning) 4%,transparent)}.action-column{width:1%}
.identity-cell{display:grid;gap:5px;min-width:215px;max-width:285px}.identity-heading{display:flex;align-items:center;gap:7px}.identity-heading strong{min-width:0;overflow:hidden;color:var(--color-text-primary);font-size:13px;text-overflow:ellipsis;white-space:nowrap}.identity-id{display:flex;align-items:stretch;width:fit-content;max-width:100%;overflow:hidden;padding:0;border:1px solid rgba(255,255,255,.06);border-radius:6px;background:rgba(0,0,0,.18);color:var(--color-text-muted);cursor:pointer}.identity-id span{flex:none;padding:3px 5px;color:#dbeafe;background:rgba(59,130,246,.27);font-size:8px;font-weight:800}.identity-id--eos span{color:#f3e8ff;background:rgba(168,85,247,.27)}.identity-id code{min-width:0;overflow:hidden;padding:3px 6px;color:inherit;font-size:9px;text-overflow:ellipsis}.identity-id:hover{border-color:rgba(255,255,255,.16);color:var(--color-text-primary)}
.reason-cell{min-width:180px;max-width:300px}.reason-cell p{display:-webkit-box;overflow:hidden;margin:0 0 5px;color:var(--color-text-secondary);font-size:12px;line-height:1.45;-webkit-box-orient:vertical;-webkit-line-clamp:2}.reason-cell small{color:var(--color-text-muted);font-size:9px}.expiry-cell{display:grid;gap:3px;min-width:115px}.expiry-cell strong{color:var(--color-status-success);font-size:12px}.expiry-cell span{color:var(--color-text-muted);font-size:10px;white-space:nowrap}.text-danger{color:var(--color-status-danger)!important}.text-muted{color:var(--color-text-muted);font-size:10px}.hit-cell{display:flex;align-items:center;gap:8px;min-width:135px}.hit-cell>div{display:grid;gap:2px}.hit-cell strong{max-width:110px;overflow:hidden;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.hit-cell span{color:var(--color-text-muted);font-size:9px}.hit-count{display:grid;place-items:center;min-width:28px;height:28px;padding:0 6px;border-radius:8px;background:rgba(255,255,255,.045);color:var(--color-text-muted)!important;font-size:11px!important;font-weight:800}.hit-count--active{border:1px solid color-mix(in srgb,var(--color-status-danger) 35%,transparent);background:color-mix(in srgb,var(--color-status-danger) 11%,transparent);color:color-mix(in srgb,var(--color-status-danger) 75%,white)!important}.row-actions{display:flex;gap:3px;justify-content:flex-end;white-space:nowrap}
.activity-list{display:grid;max-height:340px;overflow:auto;overscroll-behavior:contain}.activity-item{display:grid;grid-template-columns:110px minmax(180px,1fr) minmax(90px,150px) 150px;align-items:center;gap:12px;min-height:58px;padding:9px 12px;border-bottom:1px solid color-mix(in srgb,var(--color-border-default) 70%,transparent);border-left:2px solid var(--color-border-default)}.activity-item:last-child{border-bottom:0}.activity-item[data-kind="kick_success"]{border-left-color:var(--color-status-success)}.activity-item[data-kind="kick_failed"]{border-left-color:var(--color-status-danger)}.activity-item[data-kind="expired"]{border-left-color:var(--color-status-warning)}.activity-item>div{display:grid;gap:3px;min-width:0}.activity-item strong,.activity-item span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.activity-item strong{font-size:12px}.activity-item span,.activity-item time{color:var(--color-text-muted);font-size:10px}.activity-item time{text-align:right;white-space:nowrap}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}.table-wrap::-webkit-scrollbar,.activity-list::-webkit-scrollbar{width:7px;height:7px}.table-wrap::-webkit-scrollbar-thumb,.activity-list::-webkit-scrollbar-thumb{border-radius:999px;background:rgba(255,255,255,.1)}.table-wrap::-webkit-scrollbar-track,.activity-list::-webkit-scrollbar-track{background:rgba(0,0,0,.08)}
@media(max-width:1240px){.ban-workspace{grid-template-columns:340px minmax(0,1fr)}.list-toolbar{align-items:stretch;flex-direction:column}.search-box{flex-basis:auto}}@media(max-width:980px){.ban-workspace{grid-template-columns:1fr}.editor-column{position:static}.activity-item{grid-template-columns:100px minmax(0,1fr) 130px}.activity-item>span{display:none}}@media(max-width:640px){.header-actions{justify-content:flex-start}.duration-grid{grid-template-columns:1fr}.quick-duration-actions{grid-template-columns:repeat(2,1fr)}.status-tabs,.event-tabs{width:100%;overflow-x:auto}.status-tab,.event-tab-btn{flex:1 0 auto}.activity-item{grid-template-columns:88px minmax(0,1fr)}.activity-item time{grid-column:2;text-align:left}}
</style>
