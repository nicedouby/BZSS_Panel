<template>
  <AppPage full-bleed class="panel-ban-page">
    <!-- Streamlined Top Command Header -->
    <header class="page-cmd-header">
      <div class="header-left">
        <h1 class="page-title">面板封禁</h1>
        <div class="kpi-inline-group">
          <span class="kpi-tag" :class="state?.lastError ? 'danger' : 'emerald'">
            <span class="dot"></span>
            {{ state?.lastError ? "服务异常" : "服务正常" }}
          </span>
          <span class="kpi-tag cyan">
            <span class="dot"></span>
            总条目 <strong>{{ state?.totalEntries ?? 0 }}</strong>
          </span>
          <span class="kpi-tag emerald">
            <span class="dot"></span>
            有效 <strong>{{ state?.activeEntries ?? 0 }}</strong>
          </span>
          <span class="kpi-tag amber">
            <span class="dot"></span>
            已过期 <strong>{{ state?.expiredEntries ?? 0 }}</strong>
          </span>
          <span class="kpi-tag neutral">
            <span class="dot"></span>
            已禁用 <strong>{{ state?.disabledEntries ?? 0 }}</strong>
          </span>
          <span class="kpi-tag purple">
            <span class="dot"></span>
            命中 <strong>{{ state?.kickSuccess ?? 0 }}</strong>
          </span>
        </div>
      </div>

      <div class="header-right">
        <button type="button" class="btn-compact accent" :disabled="!canBan" @click="openCreateForm">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v16m8-8H4"/></svg>
          新建封禁
        </button>
        <button type="button" class="btn-compact ghost" :disabled="refreshing || loading" @click="refreshState">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          {{ refreshing ? "刷新中..." : "刷新" }}
        </button>
        <button type="button" class="btn-compact ghost" :disabled="reloading" @click="reloadStore">
          ⚡ {{ reloading ? "重载中..." : "重载" }}
        </button>
        <button type="button" class="btn-compact ghost" :disabled="rescanning" @click="rescanNow">
          🔍 {{ rescanning ? "扫描在线" : "扫描在线" }}
        </button>
      </div>
    </header>

    <!-- Error Notice Bar -->
    <div v-if="pageError || error || state?.lastError" class="notice-bar danger">
      <strong>⚠️ 服务异常状态:</strong>
      <span>{{ pageError || error || state?.lastError }}</span>
    </div>

    <!-- Collapsible Ban Creator / Editor Console Drawer -->
    <div v-if="showForm" class="ban-form-drawer">
      <div class="drawer-header">
        <div class="dh-title">
          <h3>{{ editingId ? `编辑封禁条目 (${editingId})` : "新建全局封禁规则" }}</h3>
          <span v-if="!canBan" class="perm-warning">🔒 缺少操作权限</span>
        </div>
        <button type="button" class="btn-close" title="关闭" @click="closeForm">✕</button>
      </div>

      <form class="drawer-form" :class="{ disabled: !canBan }" @submit.prevent="submitDraft">
        <div class="form-grid-3">
          <!-- Col 1: Target Player Select -->
          <div class="f-col">
            <label class="f-label">目标玩家 (在线玩家 / Steam64 / EOS ID)</label>
            <PlayerSelect v-model="targetPlayerInput" placeholder="输入玩家名 / 7656119... / EOS ID" @select="handlePlayerSelect" />
            <div v-if="draft.name || draft.steamID || draft.eosID" class="identity-card font-mono">
              <span class="id-name">👤 <strong>{{ draft.name || "未记录名称" }}</strong></span>
              <span v-if="draft.steamID" class="id-steam">S: {{ draft.steamID }}</span>
              <span v-if="draft.eosID" class="id-eos">EOS: {{ draft.eosID }}</span>
            </div>
          </div>

          <!-- Col 2: Reason & Quick Tags -->
          <div class="f-col col-span-2">
            <div class="f-label-row">
              <label class="f-label">违规原因描述</label>
              <div class="quick-reason-tags">
                <button type="button" class="btn-reason-tag" @click="applyQuickReason('恶意击杀队友 / TK')">恶意TK</button>
                <button type="button" class="btn-reason-tag" @click="applyQuickReason('言语攻击 / 辱骂他人')">言语辱骂</button>
                <button type="button" class="btn-reason-tag" @click="applyQuickReason('开挂作弊 / 使用非法软件')">开挂作弊</button>
                <button type="button" class="btn-reason-tag" @click="applyQuickReason('恶意挂机 / 破坏战术规则')">破坏规则</button>
              </div>
            </div>
            <textarea v-model.trim="draft.reason" rows="2" placeholder="填写违规行为描述与处理凭据..." class="f-textarea"></textarea>
          </div>
        </div>

        <div class="form-grid-4">
          <div class="f-col">
            <label class="f-label">快捷预设时长</label>
            <div class="preset-row">
              <button type="button" class="btn-preset" :class="{ active: draft.durationValue === 1 && draft.durationUnit === 'days' }" @click="setQuickDuration(1)">1天</button>
              <button type="button" class="btn-preset" :class="{ active: draft.durationValue === 3 && draft.durationUnit === 'days' }" @click="setQuickDuration(3)">3天</button>
              <button type="button" class="btn-preset" :class="{ active: draft.durationValue === 7 && draft.durationUnit === 'days' }" @click="setQuickDuration(7)">7天</button>
              <button type="button" class="btn-preset" :class="{ active: draft.durationValue === 30 && draft.durationUnit === 'days' }" @click="setQuickDuration(30)">30天</button>
              <button type="button" class="btn-preset" :class="{ active: draft.durationValue === 3650 && draft.durationUnit === 'days' }" @click="setQuickDuration(3650)">永久</button>
            </div>
          </div>

          <div class="f-col">
            <label class="f-label">自定义数值与单位</label>
            <div class="inline-inputs">
              <input v-model.number="draft.durationValue" type="number" min="1" step="1" class="f-input num">
              <select v-model="draft.durationUnit" class="f-select">
                <option value="minutes">分钟</option>
                <option value="hours">小时</option>
                <option value="days">天</option>
                <option value="weeks">周</option>
              </select>
            </div>
          </div>

          <div class="f-col">
            <label class="f-label">精确到期时间 (选填)</label>
            <input v-model="draft.expiresAt" type="datetime-local" class="f-input date">
          </div>

          <div class="f-col">
            <label class="f-label">初始状态</label>
            <select v-model="draft.status" class="f-select">
              <option value="active">🟢 有效 (拦截进服)</option>
              <option value="disabled">⏸️ 禁用 (人工停用)</option>
              <option value="expired">🟡 已过期 (存档)</option>
            </select>
          </div>
        </div>

        <div class="drawer-foot">
          <div class="expiry-preview-banner">
            <span>预计到期:</span>
            <strong class="sum-val font-mono">{{ expiryPreview.label }}</strong>
            <small>({{ expiryPreview.hint }})</small>
          </div>

          <div class="foot-actions">
            <button type="button" class="btn-compact ghost" :disabled="saving" @click="closeForm">取消</button>
            <button type="submit" class="btn-compact accent" :disabled="!canBan || saving">
              {{ saving ? "正在提交..." : editingId ? "💾 保存封禁修改" : "⚡ 立即发布封禁" }}
            </button>
          </div>
        </div>
      </form>
    </div>

    <!-- Main Full-Width Ban Dashboard Workspace -->
    <div class="ban-workspace-card">
      <!-- Main Workspace Control Bar -->
      <div class="workspace-toolbar">
        <div class="view-mode-tabs">
          <button type="button" class="mode-tab-btn" :class="{ active: activeViewTab === 'bans' }" @click="activeViewTab = 'bans'">
            📋 封禁名单 ({{ visibleEntries.length }})
          </button>
          <button type="button" class="mode-tab-btn" :class="{ active: activeViewTab === 'hits' }" @click="activeViewTab = 'hits'">
            ⚡ 拦截命中历史 ({{ recentHitEvents.length }})
          </button>
          <button type="button" class="mode-tab-btn" :class="{ active: activeViewTab === 'events' }" @click="activeViewTab = 'events'">
            📜 系统审计日志 ({{ recentEvents.length }})
          </button>
        </div>

        <div v-if="activeViewTab === 'bans'" class="toolbar-right">
          <div class="search-input-wrap">
            <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input v-model.trim="searchText" type="search" placeholder="搜索玩家名、Steam64、EOS ID、原因、管理员..." class="search-field">
          </div>

          <div class="status-tab-group">
            <button v-for="opt in statusOptions" :key="opt.value" type="button" class="btn-sub" :class="{ active: viewStatus === opt.value }" @click="viewStatus = opt.value">
              {{ opt.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- Content Area 1: Ban Directory Data Table -->
      <div v-if="activeViewTab === 'bans'" class="table-container">
        <div v-if="loading && !state" class="empty-state">
          <div class="spinner"></div>
          <span>正在加载封禁名单...</span>
        </div>
        <div v-else-if="!visibleEntries.length" class="empty-state">
          <span>没有匹配的封禁条目</span>
        </div>
        <AppTable v-else compact class="ban-table">
          <thead>
            <tr>
              <th style="width: 70px;">状态</th>
              <th style="width: 150px;">玩家名称</th>
              <th style="width: 240px;">Steam64 / EOS 凭证</th>
              <th>违规原因描述</th>
              <th style="width: 140px;">剩余到期时间</th>
              <th style="width: 80px;">命中</th>
              <th style="width: 110px; text-align: right;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in visibleEntries" :key="entry.id" :class="{ 'row-disabled': entry.status === 'disabled', 'row-expired': entry.status === 'expired' }">
              <td>
                <span class="status-pill-tag" :class="entry.status">
                  <span class="dot"></span>
                  {{ entryStatusLabel(entry.status) }}
                </span>
              </td>

              <td class="player-cell">
                <strong class="p-name" :title="entry.name">{{ entry.name || "未记录玩家名" }}</strong>
              </td>

              <td class="ids-cell">
                <div class="ids-wrap">
                  <button v-if="entry.steamID" type="button" class="id-badge steam" title="点击复制 Steam64" @click.stop="copyTextWithToast(entry.steamID, ui)">
                    <span class="lbl">S</span>
                    <span class="val font-mono">{{ entry.steamID }}</span>
                  </button>
                  <button v-if="entry.eosID" type="button" class="id-badge eos" title="点击复制 EOS ID" @click.stop="copyTextWithToast(entry.eosID, ui)">
                    <span class="lbl">EOS</span>
                    <span class="val font-mono">{{ entry.eosID }}</span>
                  </button>
                </div>
              </td>

              <td class="reason-cell">
                <span class="r-text" :title="entry.reason">{{ entry.reason || "未填写原因" }}</span>
                <span class="r-by">@{{ entry.createdBy || "system" }}</span>
              </td>

              <td class="expiry-cell font-mono">
                <span :class="expiryLabelClass(entry)">{{ entry.expiresInLabel }}</span>
              </td>

              <td class="hit-cell font-mono">
                <span v-if="entry.hitCount > 0" class="hit-badge">🎯 {{ entry.hitCount }}</span>
                <span v-else class="text-muted">-</span>
              </td>

              <td class="actions-cell">
                <div class="action-btns">
                  <button type="button" class="btn-icon-sm" title="编辑封禁" :disabled="busyId === entry.id || !canBan" @click="editEntry(entry)">✏️</button>
                  <button v-if="entry.status === 'active'" type="button" class="btn-icon-sm" title="停用" :disabled="busyId === entry.id || !canBan" @click="setEntryStatus(entry, 'disabled')">⏸️</button>
                  <button v-else-if="entry.status === 'disabled'" type="button" class="btn-icon-sm" title="启用" :disabled="busyId === entry.id || !canBan" @click="setEntryStatus(entry, 'active')">▶️</button>
                  <button type="button" class="btn-icon-sm danger" title="删除" :disabled="busyId === entry.id || !canBan" @click="removeEntry(entry)">🗑️</button>
                </div>
              </td>
            </tr>
          </tbody>
        </AppTable>
      </div>

      <!-- Content Area 2: Hit History Data Table -->
      <div v-else-if="activeViewTab === 'hits'" class="table-container">
        <div v-if="!recentHitEvents.length" class="empty-state">暂无玩家命中纪录</div>
        <AppTable v-else compact class="ban-table">
          <thead>
            <tr>
              <th style="width: 100px;">结果</th>
              <th style="width: 160px;">玩家</th>
              <th>匹配法则 / 原因</th>
              <th style="width: 120px;">服务器</th>
              <th style="width: 150px;">拦截时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in recentHitEvents" :key="event.id">
              <td>
                <span class="status-pill-tag" :class="event.kind === 'kick_success' ? 'active' : 'expired'">
                  {{ event.kind === 'kick_success' ? '成功' : '失败' }}
                </span>
              </td>
              <td><strong>{{ event.playerName || event.entryName || "未知玩家" }}</strong></td>
              <td>{{ event.matchType ? event.matchType + ": " + event.matchValue : event.reason || "未记录" }}</td>
              <td class="font-mono text-muted">{{ event.serverId || "global" }}</td>
              <td class="font-mono text-muted">{{ formatTime(event.at) }}</td>
            </tr>
          </tbody>
        </AppTable>
      </div>

      <!-- Content Area 3: System Event Data Table -->
      <div v-else-if="activeViewTab === 'events'" class="table-container">
        <div v-if="!recentEvents.length" class="empty-state">暂无系统审计事件</div>
        <AppTable v-else compact class="ban-table">
          <thead>
            <tr>
              <th style="width: 110px;">事件类型</th>
              <th style="width: 180px;">目标条目 / 玩家</th>
              <th>事件描述</th>
              <th style="width: 120px;">服务器</th>
              <th style="width: 150px;">发生时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in recentEvents" :key="event.id">
              <td><span class="status-pill-tag active">{{ event.kind }}</span></td>
              <td><strong>{{ event.entryName || event.playerName || event.error || "系统事件" }}</strong></td>
              <td>{{ event.reason || event.entryId || "补充信息" }}</td>
              <td class="font-mono text-muted">{{ event.serverId || "global" }}</td>
              <td class="font-mono text-muted">{{ formatTime(event.at) }}</td>
            </tr>
          </tbody>
        </AppTable>
      </div>
    </div>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { apiDelete, apiGet, apiPatch, apiPost } from "../app/apiClient";
import PlayerSelect from "../components/common/PlayerSelect.vue";
import AppPage from "../components/common/AppPage.vue";
import AppTable from "../components/common/AppTable.vue";
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
  id: string; steamID: string; eosID: string; name: string; reason: string;
  expiresAt: string; status: EntryStatus; createdAt: string; createdBy: string;
  updatedAt: string; hitCount: number; lastHitAt: string; lastHitPlayerName: string;
  lastHitServerId: string; lastHitMatchType: string; lastHitMatchValue: string;
  identityText: string; isExpired: boolean; isDisabled: boolean; isActive: boolean;
  expiresInMs: number; expiresInLabel: string;
};

type RecentEvent = {
  id: string; kind: string; at: string; serverId?: string; entryId?: string;
  entryName?: string; playerName?: string; steamID?: string; eosID?: string;
  matchType?: string; matchValue?: string; reason?: string; error?: string; expiresAt?: string;
};

type PanelBanState = {
  enabled: boolean; subscribed: boolean; dataDir: string; filePath: string; cacheMs: number;
  retryCooldownMs: number; matchNameFallback: boolean; lastLoadedAt: string; lastScanAt: string;
  lastKickAt: string; lastError: string; kickAttempts: number; kickSuccess: number; kickFailed: number;
  totalEntries: number; activeEntries: number; disabledEntries: number; expiredEntries: number;
  lastMatch: null | { playerName: string; steamID: string; eosID: string; entryId: string; matchType: string; matchValue: string; at: string; reason: string; expiresAt: string };
  entries: BanEntry[]; recentHits: RecentEvent[]; recentEvents: RecentEvent[];
};

type ApiResponse<T> = { ok: boolean; data: T };

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
const showForm = ref(false);
const activeViewTab = ref<"bans" | "hits" | "events">("bans");

const draft = reactive({
  steamID: "", eosID: "", name: "", reason: "", expiresAt: "",
  durationValue: 7, durationUnit: "days" as DurationUnit, status: "active" as EntryStatus,
});

watch(targetPlayerInput, (val) => {
  const cleanVal = val.trim();
  if (!cleanVal) { draft.steamID = ""; draft.eosID = ""; draft.name = ""; return; }
  if (cleanVal === draft.name || cleanVal === draft.steamID || cleanVal === draft.eosID) return;

  if (/^7\d{16}$/.test(cleanVal)) {
    if (draft.steamID !== cleanVal) { draft.steamID = cleanVal; draft.eosID = ""; draft.name = ""; }
    return;
  }
  if (/^[0-9a-fA-F]{32}$/.test(cleanVal) || cleanVal.toLowerCase().startsWith("eos")) {
    if (draft.eosID !== cleanVal) { draft.eosID = cleanVal; draft.steamID = ""; draft.name = ""; }
    return;
  }
  if (draft.name !== cleanVal) { draft.name = cleanVal; draft.steamID = ""; draft.eosID = ""; }
});

function openCreateForm() {
  resetDraft();
  showForm.value = true;
}

function closeForm() {
  resetDraft();
  showForm.value = false;
}

function setQuickDuration(days: number) {
  draft.durationValue = days;
  draft.durationUnit = "days";
}

function applyQuickReason(text: string) {
  draft.reason = text;
}

function handlePlayerSelect(player: any) {
  draft.steamID = player.steam_id || player.steamID || player.steamId || "";
  draft.eosID = player.eos_id || player.eosID || player.eosId || "";
  draft.name = player.current_name || player.name || "";
  targetPlayerInput.value = draft.name || draft.steamID || draft.eosID || "";
}

const { data: state, loading, refreshing, error, refresh } = usePollingResource<PanelBanState | null>({
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
      entry.id, entry.steamID, entry.eosID, entry.name, entry.reason, entry.createdBy,
      entry.lastHitPlayerName, entry.lastHitServerId, entry.lastHitMatchType, entry.lastHitMatchValue,
    ].join(" ").toLowerCase();
    return haystack.includes(search);
  });
});

const recentHitEvents = computed(() => (state.value?.recentHits ?? []).slice(0, 20));
const recentEvents = computed(() => (state.value?.recentEvents ?? []).slice(0, 20));

const expiryPreview = computed(() => {
  if (draft.expiresAt) return { label: formatDateTimeInput(draft.expiresAt), hint: "优先使用精确到期时间" };
  const ms = durationToMs(draft.durationValue, draft.durationUnit);
  if (!ms) return { label: "未设置", hint: "填写到期时间或选择有效时长" };
  const target = new Date(Date.now() + ms);
  return { label: target.toLocaleString(), hint: `按 ${draft.durationValue}${durationUnitLabel(draft.durationUnit)} 自动计算` };
});

function formatDateTimeInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return date.toLocaleString();
}

function durationToMs(value: number, unit: DurationUnit) {
  const amount = Number(value ?? 0) || 0;
  if (amount <= 0) return 0;
  const factor = { minutes: 60_000, hours: 3_600_000, days: 86_400_000, weeks: 7 * 86_400_000 }[unit];
  return Math.max(0, Math.floor(amount * factor));
}

function durationUnitLabel(unit: DurationUnit) {
  return { minutes: "分钟", hours: "小时", days: "天", weeks: "周" }[unit];
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

function pushPageError(message: string) { pageError.value = message; }

async function refreshState() {
  pageError.value = "";
  try { await refresh(); } catch (err) { pushPageError(err instanceof Error ? err.message : String(err)); }
}

async function reloadStore() {
  reloading.value = true; pageError.value = "";
  try {
    await apiPost<ApiResponse<PanelBanState | null>>("/api/plugins/panel-ban/reload", {});
    await refresh();
  } catch (err) { pushPageError(err instanceof Error ? err.message : String(err)); }
  finally { reloading.value = false; }
}

async function rescanNow() {
  rescanning.value = true; pageError.value = "";
  try {
    await apiPost<ApiResponse<PanelBanState | null>>("/api/plugins/panel-ban/rescan", {});
    await refresh();
  } catch (err) { pushPageError(err instanceof Error ? err.message : String(err)); }
  finally { rescanning.value = false; }
}

function resetDraft() {
  editingId.value = ""; draft.steamID = ""; draft.eosID = ""; draft.name = ""; draft.reason = "";
  draft.expiresAt = ""; draft.durationValue = 7; draft.durationUnit = "days"; draft.status = "active";
  targetPlayerInput.value = "";
}

function editEntry(entry: BanEntry) {
  editingId.value = entry.id; draft.steamID = entry.steamID; draft.eosID = entry.eosID; draft.name = entry.name;
  draft.reason = entry.reason; draft.expiresAt = localDateTimeValue(entry.expiresAt);
  draft.durationValue = 7; draft.durationUnit = "days"; draft.status = entry.status;
  targetPlayerInput.value = entry.name || entry.steamID || entry.eosID || "";
  showForm.value = true;
}

async function submitDraft() {
  pageError.value = "";
  if (!draft.steamID && !draft.eosID && !draft.name) {
    pushPageError("Steam64、EOS 或名称至少需要填写一项。"); return;
  }
  const expiresAt = resolveDraftExpiry();
  if (!expiresAt) { pushPageError("请填写到期时间，或提供有效时长。"); return; }

  const payload = { steamID: draft.steamID, eosID: draft.eosID, name: draft.name, reason: draft.reason, expiresAt, status: draft.status };
  saving.value = true;
  try {
    if (editingId.value) {
      await apiPatch<ApiResponse<BanEntry>>(`/api/plugins/panel-ban/entries/${encodeURIComponent(editingId.value)}`, payload);
    } else {
      await apiPost<ApiResponse<BanEntry>>("/api/plugins/panel-ban/entries", payload);
    }
    resetDraft(); showForm.value = false; await refresh();
    ui.pushToast({ title: "已提交", message: "封禁规则发布成功", tone: "ok" });
  } catch (err) { pushPageError(err instanceof Error ? err.message : String(err)); }
  finally { saving.value = false; }
}

async function setEntryStatus(entry: BanEntry, status: EntryStatus) {
  busyId.value = entry.id; pageError.value = "";
  try {
    await apiPatch<ApiResponse<BanEntry>>(`/api/plugins/panel-ban/entries/${encodeURIComponent(entry.id)}`, { status, expiresAt: entry.expiresAt });
    await refresh();
  } catch (err) { pushPageError(err instanceof Error ? err.message : String(err)); }
  finally { busyId.value = ""; }
}

async function removeEntry(entry: BanEntry) {
  const confirmed = await ui.openConfirm({
    title: "确认删除",
    message: `确认彻底删除封禁条目 ${entry.name || entry.id} 吗？`,
    confirmText: "确认删除", cancelText: "取消", tone: "warn",
  });
  if (!confirmed) return;

  busyId.value = entry.id; pageError.value = "";
  try {
    await apiDelete<ApiResponse<BanEntry>>(`/api/plugins/panel-ban/entries/${encodeURIComponent(entry.id)}`);
    if (editingId.value === entry.id) { resetDraft(); showForm.value = false; }
    await refresh();
    ui.pushToast({ title: "已删除", message: `封禁条目 ${entry.name || entry.id} 已删除。`, tone: "ok" });
  } catch (err) { pushPageError(err instanceof Error ? err.message : String(err)); }
  finally { busyId.value = ""; }
}

function entryStatusLabel(status: EntryStatus) {
  if (status === "active") return "有效";
  if (status === "disabled") return "禁用";
  return "已过期";
}

function expiryLabelClass(entry: BanEntry) {
  if (entry.status !== "active") return "text-muted";
  if (entry.expiresInMs && entry.expiresInMs < 86_400_000) return "text-danger";
  return "text-success";
}
</script>

<style scoped>
.panel-ban-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 6px;
}

/* Streamlined Single Command Header */
.page-cmd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.header-left { display: flex; align-items: center; gap: 12px; }
.page-title { font-size: 14px; font-weight: 800; color: var(--color-text-primary); margin: 0; }
.kpi-inline-group { display: flex; align-items: center; gap: 6px; }

.kpi-tag {
  display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; padding: 2px 6px; border-radius: 4px;
  background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.05); color: var(--color-text-secondary);
}

.kpi-tag .dot { width: 6px; height: 6px; border-radius: 50%; }
.kpi-tag.cyan .dot { background: #38bdf8; }
.kpi-tag.emerald .dot { background: #22c55e; }
.kpi-tag.amber .dot { background: #f59e0b; }
.kpi-tag.neutral .dot { background: #94a3b8; }
.kpi-tag.purple .dot { background: #a78bfa; }
.kpi-tag.danger .dot { background: #ef4444; }
.kpi-tag strong { color: var(--color-text-primary); font-weight: 700; }

.header-right { display: flex; gap: 6px; }

.notice-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 5px; font-size: 11px; flex-shrink: 0; }
.notice-bar.danger { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #fecaca; }

/* Collapsible Form Drawer */
.ban-form-drawer {
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(56, 189, 248, 0.3);
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  flex-shrink: 0;
  animation: slide-down 0.15s cubic-bezier(0, 0, 0.2, 1);
}

@keyframes slide-down { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }

.drawer-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--color-border-soft); padding-bottom: 4px; }
.dh-title { display: flex; align-items: center; gap: 8px; }
.dh-title h3 { font-size: 12.5px; font-weight: 800; color: var(--color-text-primary); margin: 0; }
.perm-warning { font-size: 10px; color: #f87171; background: rgba(239, 68, 68, 0.15); padding: 1px 5px; border-radius: 3px; }

.btn-close { background: transparent; border: 0; color: var(--color-text-muted); font-size: 12px; cursor: pointer; padding: 2px 6px; border-radius: 3px; }
.btn-close:hover { color: #fff; background: rgba(255, 255, 255, 0.1); }

.drawer-form { display: flex; flex-direction: column; gap: 8px; }
.drawer-form.disabled { opacity: 0.5; pointer-events: none; }

.form-grid-3 { display: grid; grid-template-columns: minmax(240px, 1fr) minmax(360px, 1.8fr); gap: 10px; }
.form-grid-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }

.f-col { display: flex; flex-direction: column; gap: 3px; }
.f-label-row { display: flex; align-items: center; justify-content: space-between; }
.f-label { font-size: 10px; font-weight: 700; color: var(--color-text-muted); }

.quick-reason-tags { display: flex; gap: 3px; }
.btn-reason-tag { padding: 1px 5px; border-radius: 3px; border: 1px solid var(--color-border-soft); background: rgba(255, 255, 255, 0.03); color: #38bdf8; font-size: 9.5px; cursor: pointer; }
.btn-reason-tag:hover { background: rgba(56, 189, 248, 0.15); }

.identity-card { display: flex; gap: 8px; align-items: center; padding: 3px 6px; border-radius: 4px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.2); font-size: 10px; }
.id-name strong { color: #38bdf8; }
.id-steam { color: #93c5fd; }
.id-eos { color: #e9d5ff; }

.f-textarea { width: 100%; height: 42px; padding: 4px 6px; border-radius: 4px; border: 1px solid var(--color-border-soft); background: rgba(15, 23, 42, 0.9); color: var(--color-text-primary); font-size: 11px; resize: vertical; }

.preset-row { display: flex; gap: 3px; }
.btn-preset { height: 24px; flex: 1; border-radius: 3px; border: 1px solid var(--color-border-soft); background: rgba(255, 255, 255, 0.03); color: var(--color-text-secondary); font-size: 10px; font-weight: 600; cursor: pointer; }
.btn-preset:hover { border-color: #38bdf8; color: #38bdf8; }
.btn-preset.active { background: rgba(56, 189, 248, 0.15); border-color: #38bdf8; color: #38bdf8; }

.inline-inputs { display: grid; grid-template-columns: 60px 1fr; gap: 4px; }
.f-input, .f-select { height: 24px; padding: 0 6px; border-radius: 4px; border: 1px solid var(--color-border-soft); background: rgba(15, 23, 42, 0.9); color: var(--color-text-primary); font-size: 10.5px; }

.drawer-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 4px; border-top: 1px solid var(--color-border-soft); }
.expiry-preview-banner { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--color-text-secondary); }
.expiry-preview-banner strong { color: #38bdf8; }
.expiry-preview-banner small { color: var(--color-text-muted); font-size: 9.5px; }

.foot-actions { display: flex; gap: 6px; }

/* Main Full-Width Ban Dashboard Workspace */
.ban-workspace-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid var(--color-border-soft);
  overflow: hidden;
}

.workspace-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px;
  background: rgba(15, 23, 42, 0.8);
  border-bottom: 1px solid var(--color-border-soft);
  gap: 8px;
}

.view-mode-tabs { display: flex; gap: 2px; }

.mode-tab-btn {
  padding: 4px 10px; border-radius: 4px; border: 0; background: transparent; color: var(--color-text-muted); font-size: 11px; font-weight: 700; cursor: pointer;
}
.mode-tab-btn.active { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }

.toolbar-right { display: flex; align-items: center; gap: 6px; }

.search-input-wrap { position: relative; width: 220px; }
.search-icon { position: absolute; left: 6px; top: 50%; transform: translateY(-50%); width: 12px; height: 12px; color: var(--color-text-muted); }

.search-field {
  width: 100%; height: 24px; padding: 0 6px 0 22px; border-radius: 4px; border: 1px solid var(--color-border-soft);
  background: rgba(15, 23, 42, 0.9); color: var(--color-text-primary); font-size: 11px;
}

.status-tab-group { display: flex; gap: 2px; background: rgba(0, 0, 0, 0.3); padding: 2px; border-radius: 4px; }
.btn-sub { padding: 2px 6px; border-radius: 3px; border: 0; background: transparent; color: var(--color-text-muted); font-size: 10px; cursor: pointer; }
.btn-sub.active { background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 600; }

/* Full-Bleed Table Styling */
.table-container { flex: 1; overflow: auto; min-height: 0; }

.ban-table { width: 100%; font-size: 11px; }

.row-disabled { opacity: 0.55; }
.row-expired { background: rgba(245, 158, 11, 0.04); }

.status-pill-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 9.5px; font-weight: 700; padding: 1px 6px; border-radius: 3px; }
.status-pill-tag.active { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
.status-pill-tag.disabled { background: rgba(148, 163, 184, 0.15); color: #94a3b8; }
.status-pill-tag.expired { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
.status-pill-tag .dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }

.player-cell .p-name { color: var(--color-text-primary); font-size: 11.5px; }

.ids-wrap { display: flex; gap: 4px; flex-wrap: wrap; }
.id-badge { display: inline-flex; align-items: center; gap: 3px; padding: 1px 4px; border-radius: 3px; border: 1px solid rgba(255, 255, 255, 0.05); background: rgba(0, 0, 0, 0.25); cursor: pointer; font-size: 9.5px; }
.id-badge.steam { color: #93c5fd; border-color: rgba(59, 130, 246, 0.25); background: rgba(59, 130, 246, 0.1); }
.id-badge.eos { color: #e9d5ff; border-color: rgba(168, 85, 247, 0.25); background: rgba(168, 85, 247, 0.1); }
.id-badge .lbl { font-weight: 800; font-size: 8px; opacity: 0.85; }

.reason-cell { max-width: 300px; }
.r-text { display: inline-block; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-text-secondary); vertical-align: middle; }
.r-by { font-size: 9px; color: var(--color-text-muted); margin-left: 4px; }

.hit-badge { font-size: 9.5px; font-weight: 700; color: #fecaca; background: rgba(239, 68, 68, 0.15); padding: 1px 5px; border-radius: 3px; }

.actions-cell { text-align: right; }
.action-btns { display: flex; align-items: center; justify-content: flex-end; gap: 2px; }

.btn-icon-sm { width: 22px; height: 22px; border-radius: 3px; border: 0; background: transparent; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--color-text-secondary); }
.btn-icon-sm:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
.btn-icon-sm.danger:hover { background: rgba(239, 68, 68, 0.2); color: #fecaca; }

.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 40px; color: var(--color-text-muted); font-size: 11px; text-align: center; }
.spinner { width: 16px; height: 16px; border: 2px solid rgba(56, 189, 248, 0.2); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.btn-compact { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 6px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer; border: 1px solid var(--color-border-default); background: rgba(255, 255, 255, 0.04); color: var(--color-text-secondary); }
.btn-compact .icon { width: 12px; height: 12px; }
.btn-compact:hover { border-color: var(--color-border-hover); color: var(--color-text-primary); background: rgba(255, 255, 255, 0.08); }
.btn-compact.accent { background: rgba(56, 189, 248, 0.15); border-color: rgba(56, 189, 248, 0.3); color: #38bdf8; }
.btn-compact.ghost { background: transparent; border-color: rgba(255, 255, 255, 0.06); }
</style>
