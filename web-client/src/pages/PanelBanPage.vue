<template>
  <AppPage full-bleed class="panel-ban-page">
    <!-- Streamlined Command Header -->
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
        <button type="button" class="btn-compact ghost" :disabled="refreshing || loading" @click="refreshState">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          {{ refreshing ? "刷新中..." : "刷新" }}
        </button>
        <button type="button" class="btn-compact ghost" :disabled="reloading" @click="reloadStore">
          ⚡ {{ reloading ? "重载中..." : "重载" }}
        </button>
        <button type="button" class="btn-compact ghost" :disabled="rescanning" @click="rescanNow">
          🔍 {{ rescanning ? "扫描中..." : "扫描在线" }}
        </button>
      </div>
    </header>

    <!-- Error Notice Bar -->
    <div v-if="pageError || error || state?.lastError" class="notice-bar danger">
      <strong>⚠️ 服务异常状态:</strong>
      <span>{{ pageError || error || state?.lastError }}</span>
    </div>

    <!-- Main Split Layout -->
    <AppSplitLayout class="compact-split">
      <template #left>
        <div class="card-panel list-panel">
          <!-- Toolbar Search & Status Tabs -->
          <div class="panel-toolbar">
            <div class="search-input-wrap">
              <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input v-model.trim="searchText" type="search" placeholder="搜索玩家、Steam64、EOS、原因..." class="search-field">
            </div>
            <div class="status-tab-group">
              <button
                v-for="opt in statusOptions"
                :key="opt.value"
                type="button"
                class="btn-sub"
                :class="{ active: viewStatus === opt.value }"
                @click="viewStatus = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <div class="panel-sub-bar">
            <span class="count-text">显示 {{ visibleEntries.length }} / {{ state?.totalEntries ?? 0 }} 条封禁记录</span>
          </div>

          <!-- Ban Cards Feed -->
          <div v-if="loading && !state" class="empty-state">
            <div class="spinner"></div>
            <span>正在读取封禁数据...</span>
          </div>
          <div v-else-if="!visibleEntries.length" class="empty-state">
            <span>没有匹配的封禁条目</span>
          </div>
          <div v-else class="ban-feed">
            <div
              v-for="entry in visibleEntries"
              :key="entry.id"
              class="ban-card-item"
              :class="{ active: editingId === entry.id, disabled: entry.status === 'disabled', expired: entry.status === 'expired' }"
              @click="editEntry(entry)"
            >
              <!-- Line 1: Status Dot + Player Name + Status Badge + Expiry -->
              <div class="card-head">
                <span class="status-dot" :class="entry.status"></span>
                <strong class="player-name" :title="entry.name">{{ entry.name || "未记录玩家名" }}</strong>
                <span class="status-pill-badge" :class="entry.status">{{ entryStatusLabel(entry.status) }}</span>
                <span class="expiry-badge font-mono" :class="expiryLabelClass(entry)">{{ entry.expiresInLabel }}</span>
              </div>

              <!-- Line 2: Steam64 & EOS Badges -->
              <div class="card-ids" v-if="entry.steamID || entry.eosID">
                <button v-if="entry.steamID" type="button" class="id-badge steam" title="点击复制 Steam64" @click.stop="copyTextWithToast(entry.steamID, ui)">
                  <span class="id-type">STEAM</span>
                  <span class="id-val font-mono">{{ entry.steamID }}</span>
                </button>
                <button v-if="entry.eosID" type="button" class="id-badge eos" title="点击复制 EOS ID" @click.stop="copyTextWithToast(entry.eosID, ui)">
                  <span class="id-type">EOS</span>
                  <span class="id-val font-mono">{{ entry.eosID }}</span>
                </button>
              </div>

              <!-- Line 3: Reason + Hit Counter + Action Icons -->
              <div class="card-foot">
                <div class="reason-text" :title="entry.reason">
                  <span>{{ entry.reason || "未填写原因" }}</span>
                  <em class="admin-by">@{{ entry.createdBy || "system" }}</em>
                </div>

                <div class="foot-actions" @click.stop>
                  <span v-if="entry.hitCount > 0" class="hit-count-pill" title="拦截命中次数">🎯 {{ entry.hitCount }}</span>
                  <button type="button" class="btn-action-icon" title="编辑" :disabled="busyId === entry.id || !canBan" @click="editEntry(entry)">✏️</button>
                  <button v-if="entry.status === 'active'" type="button" class="btn-action-icon" title="停用" :disabled="busyId === entry.id || !canBan" @click="setEntryStatus(entry, 'disabled')">⏸️</button>
                  <button v-else-if="entry.status === 'disabled'" type="button" class="btn-action-icon" title="启用" :disabled="busyId === entry.id || !canBan" @click="setEntryStatus(entry, 'active')">▶️</button>
                  <button type="button" class="btn-action-icon danger" title="删除" :disabled="busyId === entry.id || !canBan" @click="removeEntry(entry)">🗑️</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template #right>
        <div class="card-panel detail-panel">
          <!-- Stage Workspace Tabs -->
          <div class="stage-nav">
            <div class="nav-tabs">
              <button type="button" class="stage-tab-btn" :class="{ active: rightTab === 'form' }" @click="rightTab = 'form'">
                🔨 {{ editingId ? "编辑封禁条目" : "新建封禁规则" }}
              </button>
              <button type="button" class="stage-tab-btn" :class="{ active: rightTab === 'hits' }" @click="rightTab = 'hits'">
                ⚡ 拦截命中历史 ({{ recentHitEvents.length }})
              </button>
              <button type="button" class="stage-tab-btn" :class="{ active: rightTab === 'events' }" @click="rightTab = 'events'">
                📜 系统审计日志 ({{ recentEvents.length }})
              </button>
            </div>

            <button v-if="editingId" type="button" class="btn-compact ghost" @click="resetDraft">取消编辑</button>
          </div>

          <!-- Tab 1: Form Stage -->
          <div v-if="rightTab === 'form'" class="stage-body form-stage">
            <form class="ban-form-box" :class="{ disabled: !canBan }" @submit.prevent="submitDraft">
              <div class="form-header-bar">
                <h3 class="form-title">{{ editingId ? `编辑封禁 (${editingId})` : "新建全局玩家封禁" }}</h3>
                <span v-if="!canBan" class="perm-tag">🔒 缺少操作权限</span>
              </div>

              <!-- Section 1: Player & Reason -->
              <div class="form-section">
                <div class="f-group">
                  <label class="f-label">目标玩家 (选择在线玩家 / 输入 Steam64 / EOS ID)</label>
                  <PlayerSelect v-model="targetPlayerInput" placeholder="输入玩家名 / 7656119... / EOS ID" @select="handlePlayerSelect" />
                  <div v-if="draft.name || draft.steamID || draft.eosID" class="identity-card font-mono">
                    <span class="id-item name">👤 <strong>{{ draft.name || "未记录名称" }}</strong></span>
                    <span v-if="draft.steamID" class="id-item steam">STEAM: {{ draft.steamID }}</span>
                    <span v-if="draft.eosID" class="id-item eos">EOS: {{ draft.eosID }}</span>
                  </div>
                </div>

                <div class="f-group">
                  <div class="f-label-row">
                    <label class="f-label">违规原因与处罚依据</label>
                    <div class="quick-reason-tags">
                      <button type="button" class="btn-reason-tag" @click="applyQuickReason('恶意击杀队友 / TK')">恶意TK</button>
                      <button type="button" class="btn-reason-tag" @click="applyQuickReason('言语攻击 / 辱骂他人')">言语辱骂</button>
                      <button type="button" class="btn-reason-tag" @click="applyQuickReason('开挂作弊 / 使用非法软件')">开挂作弊</button>
                      <button type="button" class="btn-reason-tag" @click="applyQuickReason('恶意挂机 / 破坏战术规则')">破坏规则</button>
                    </div>
                  </div>
                  <textarea v-model.trim="draft.reason" rows="2" placeholder="填写具体违规行为、录像截图凭据或处罚决定..." class="f-textarea"></textarea>
                </div>
              </div>

              <!-- Section 2: Duration & Rules -->
              <div class="form-section grid-2">
                <div class="f-group">
                  <label class="f-label">快捷预设时长</label>
                  <div class="preset-row">
                    <button type="button" class="btn-duration-preset" :class="{ active: draft.durationValue === 1 && draft.durationUnit === 'days' }" @click="setQuickDuration(1)">1天</button>
                    <button type="button" class="btn-duration-preset" :class="{ active: draft.durationValue === 3 && draft.durationUnit === 'days' }" @click="setQuickDuration(3)">3天</button>
                    <button type="button" class="btn-duration-preset" :class="{ active: draft.durationValue === 7 && draft.durationUnit === 'days' }" @click="setQuickDuration(7)">7天</button>
                    <button type="button" class="btn-duration-preset" :class="{ active: draft.durationValue === 30 && draft.durationUnit === 'days' }" @click="setQuickDuration(30)">30天</button>
                    <button type="button" class="btn-duration-preset" :class="{ active: draft.durationValue === 3650 && draft.durationUnit === 'days' }" @click="setQuickDuration(3650)">永久</button>
                  </div>
                </div>

                <div class="f-group">
                  <label class="f-label">自定义数值与单位</label>
                  <div class="custom-duration-row">
                    <input v-model.number="draft.durationValue" type="number" min="1" step="1" class="f-input num">
                    <select v-model="draft.durationUnit" class="f-select">
                      <option value="minutes">分钟</option>
                      <option value="hours">小时</option>
                      <option value="days">天</option>
                      <option value="weeks">周</option>
                    </select>
                  </div>
                </div>
              </div>

              <!-- Section 3: Exact Expiry & Status -->
              <div class="form-section grid-2">
                <div class="f-group">
                  <label class="f-label">精确到期时间 (选填)</label>
                  <input v-model="draft.expiresAt" type="datetime-local" class="f-input date">
                </div>

                <div class="f-group">
                  <label class="f-label">规则初始状态</label>
                  <select v-model="draft.status" class="f-select">
                    <option value="active">🟢 有效 (立即拦截进服)</option>
                    <option value="disabled">⏸️ 禁用 (人工停用保留记录)</option>
                    <option value="expired">🟡 已过期 (存档备查)</option>
                  </select>
                </div>
              </div>

              <!-- Summary & Actions -->
              <div class="expiry-summary-card">
                <div class="sum-left">
                  <span class="sum-lbl">预计封禁到期:</span>
                  <strong class="sum-val font-mono">{{ expiryPreview.label }}</strong>
                </div>
                <span class="sum-hint">({{ expiryPreview.hint }})</span>
              </div>

              <div class="form-action-footer">
                <button type="button" class="btn-compact ghost" :disabled="saving" @click="resetDraft">{{ editingId ? "取消编辑" : "清空重填" }}</button>
                <button type="submit" class="btn-compact accent submit-btn" :disabled="!canBan || saving">
                  {{ saving ? "正在提交..." : editingId ? "💾 保存封禁修改" : "⚡ 立即发布封禁" }}
                </button>
              </div>
            </form>
          </div>

          <!-- Tab 2: Hit History -->
          <div v-else-if="rightTab === 'hits'" class="stage-body activity-stage">
            <div v-if="!recentHitEvents.length" class="empty-state">暂无玩家命中纪录</div>
            <div v-else class="activity-feed">
              <div v-for="event in recentHitEvents" :key="event.id" class="activity-row-card" :data-kind="event.kind">
                <span class="event-tag" :class="event.kind === 'kick_success' ? 'success' : 'danger'">
                  {{ event.kind === 'kick_success' ? '拦截成功' : '拦截失败' }}
                </span>
                <strong class="act-name">{{ event.playerName || event.entryName || "未知玩家" }}</strong>
                <span class="act-info">{{ event.matchType ? event.matchType + ": " + event.matchValue : event.reason || "未记录" }}</span>
                <span class="act-server font-mono">{{ event.serverId || "global" }}</span>
                <time class="act-time font-mono">{{ formatTime(event.at) }}</time>
              </div>
            </div>
          </div>

          <!-- Tab 3: System Logs -->
          <div v-else-if="rightTab === 'events'" class="stage-body activity-stage">
            <div v-if="!recentEvents.length" class="empty-state">暂无系统审计事件</div>
            <div v-else class="activity-feed">
              <div v-for="event in recentEvents" :key="event.id" class="activity-row-card">
                <span class="event-tag info">{{ event.kind }}</span>
                <strong class="act-name">{{ event.entryName || event.playerName || event.error || "系统事件" }}</strong>
                <span class="act-info">{{ event.reason || event.entryId || "补充信息" }}</span>
                <span class="act-server font-mono">{{ event.serverId || "global" }}</span>
                <time class="act-time font-mono">{{ formatTime(event.at) }}</time>
              </div>
            </div>
          </div>
        </div>
      </template>
    </AppSplitLayout>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { apiDelete, apiGet, apiPatch, apiPost } from "../app/apiClient";
import PlayerSelect from "../components/common/PlayerSelect.vue";
import AppPage from "../components/common/AppPage.vue";
import AppSplitLayout from "../components/common/AppSplitLayout.vue";
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
const rightTab = ref<"form" | "hits" | "events">("form");

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

  if (/^7\d{16}$/.test(cleanVal)) {
    if (draft.steamID !== cleanVal) {
      draft.steamID = cleanVal;
      draft.eosID = "";
      draft.name = "";
    }
    return;
  }

  if (/^[0-9a-fA-F]{32}$/.test(cleanVal) || cleanVal.toLowerCase().startsWith("eos")) {
    if (draft.eosID !== cleanVal) {
      draft.eosID = cleanVal;
      draft.steamID = "";
      draft.name = "";
    }
    return;
  }

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

function applyQuickReason(text: string) {
  draft.reason = text;
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

const recentHitEvents = computed(() => (state.value?.recentHits ?? []).slice(0, 15));
const recentEvents = computed(() => (state.value?.recentEvents ?? []).slice(0, 15));

const expiryPreview = computed(() => {
  if (draft.expiresAt) {
    return { label: formatDateTimeInput(draft.expiresAt), hint: "优先使用精确到期时间" };
  }
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
  rightTab.value = "form";
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
    resetDraft(); await refresh();
    ui.pushToast({ title: "已提交", message: "封禁条目更新成功", tone: "ok" });
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
    if (editingId.value === entry.id) resetDraft();
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

.notice-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 5px; font-size: 11px; }
.notice-bar.danger { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #fecaca; }

/* Split Layout & Panels */
.compact-split {
  flex: 1;
  min-height: 0;
  grid-template-columns: minmax(340px, 390px) minmax(0, 1fr) !important;
  gap: 6px;
}

.card-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid var(--color-border-soft);
  overflow: hidden;
}

.panel-toolbar { display: flex; align-items: center; gap: 6px; padding: 6px; border-bottom: 1px solid var(--color-border-soft); background: rgba(15, 23, 42, 0.4); }
.search-input-wrap { position: relative; flex: 1; }
.search-icon { position: absolute; left: 6px; top: 50%; transform: translateY(-50%); width: 12px; height: 12px; color: var(--color-text-muted); }

.search-field {
  width: 100%; height: 24px; padding: 0 6px 0 22px; border-radius: 4px; border: 1px solid var(--color-border-soft);
  background: rgba(15, 23, 42, 0.9); color: var(--color-text-primary); font-size: 11px;
}

.status-tab-group { display: flex; gap: 2px; background: rgba(0, 0, 0, 0.3); padding: 2px; border-radius: 4px; }
.btn-sub { padding: 2px 6px; border-radius: 3px; border: 0; background: transparent; color: var(--color-text-muted); font-size: 10px; cursor: pointer; }
.btn-sub.active { background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 600; }

.panel-sub-bar { padding: 3px 6px; background: rgba(0, 0, 0, 0.2); font-size: 10px; color: var(--color-text-muted); border-bottom: 1px solid rgba(255, 255, 255, 0.03); }

/* Left Feed: Crisp 3-Row Card Items */
.ban-feed { flex: 1; overflow-y: auto; padding: 5px; display: flex; flex-direction: column; gap: 5px; scrollbar-gutter: stable; }

.ban-card-item {
  display: flex; flex-direction: column; gap: 4px; padding: 7px 9px; border-radius: 6px;
  background: rgba(15, 23, 42, 0.55); border: 1px solid var(--color-border-soft); cursor: pointer; transition: all 0.15s ease;
}

.ban-card-item:hover { background: rgba(255, 255, 255, 0.035); border-color: rgba(56, 189, 248, 0.3); }
.ban-card-item.active { background: rgba(56, 189, 248, 0.08); border-color: #38bdf8; box-shadow: inset 3px 0 0 #38bdf8; }
.ban-card-item.disabled { opacity: 0.6; }
.ban-card-item.expired { border-left: 3px solid #f59e0b; }

.card-head { display: flex; align-items: center; gap: 5px; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.status-dot.active { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
.status-dot.disabled { background: #94a3b8; }
.status-dot.expired { background: #f59e0b; }

.player-name { font-size: 12px; font-weight: 700; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }

.status-pill-badge { font-size: 8.5px; font-weight: 700; padding: 0 4px; border-radius: 3px; text-transform: uppercase; }
.status-pill-badge.active { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
.status-pill-badge.disabled { background: rgba(148, 163, 184, 0.15); color: #94a3b8; }
.status-pill-badge.expired { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }

.expiry-badge { font-size: 9.5px; margin-left: auto; white-space: nowrap; font-variant-numeric: tabular-nums; }
.text-danger { color: #f87171; }
.text-success { color: #22c55e; }
.text-muted { color: var(--color-text-muted); }

.card-ids { display: flex; gap: 4px; flex-wrap: wrap; }
.id-badge { display: inline-flex; align-items: center; gap: 3px; padding: 1px 4px; border-radius: 3px; border: 1px solid rgba(255, 255, 255, 0.05); background: rgba(0, 0, 0, 0.25); cursor: pointer; font-size: 9px; }
.id-badge.steam { color: #93c5fd; border-color: rgba(59, 130, 246, 0.25); background: rgba(59, 130, 246, 0.1); }
.id-badge.eos { color: #e9d5ff; border-color: rgba(168, 85, 247, 0.25); background: rgba(168, 85, 247, 0.1); }
.id-type { font-weight: 800; font-size: 8px; opacity: 0.8; }
.id-val { opacity: 0.95; }

.card-foot { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.reason-text { font-size: 10px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; display: flex; gap: 4px; }
.admin-by { font-style: normal; color: var(--color-text-muted); font-size: 9px; flex-shrink: 0; }

.foot-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; margin-left: auto; }
.hit-count-pill { font-size: 9px; font-weight: 700; padding: 0 4px; border-radius: 3px; background: rgba(239, 68, 68, 0.15); color: #fecaca; border: 1px solid rgba(239, 68, 68, 0.25); }

.btn-action-icon { width: 20px; height: 20px; border-radius: 3px; border: 0; background: transparent; font-size: 10.5px; cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--color-text-secondary); }
.btn-action-icon:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
.btn-action-icon.danger:hover { background: rgba(239, 68, 68, 0.2); color: #fecaca; }

/* Right Detail Stage Panel */
.detail-panel { display: flex; flex-direction: column; }

.stage-nav { display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; background: rgba(15, 23, 42, 0.8); border-bottom: 1px solid var(--color-border-soft); }
.nav-tabs { display: flex; gap: 2px; }
.stage-tab-btn { padding: 3px 8px; border-radius: 4px; border: 0; background: transparent; color: var(--color-text-muted); font-size: 11px; font-weight: 600; cursor: pointer; }
.stage-tab-btn.active { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }

.stage-body { flex: 1; min-height: 0; overflow: auto; padding: 10px; }

/* Form Stage Box */
.ban-form-box { display: flex; flex-direction: column; gap: 12px; max-width: 780px; }
.ban-form-box.disabled { opacity: 0.5; pointer-events: none; }

.form-header-bar { display: flex; align-items: center; justify-content: space-between; padding-bottom: 6px; border-bottom: 1px solid var(--color-border-soft); }
.form-title { font-size: 13px; font-weight: 800; color: var(--color-text-primary); margin: 0; }
.perm-tag { font-size: 10px; color: #f87171; background: rgba(239, 68, 68, 0.15); padding: 2px 6px; border-radius: 3px; }

.form-section { display: flex; flex-direction: column; gap: 8px; background: rgba(255, 255, 255, 0.015); border: 1px solid var(--color-border-soft); border-radius: 6px; padding: 8px 10px; }
.form-section.grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }

.f-group { display: flex; flex-direction: column; gap: 4px; }
.f-label-row { display: flex; align-items: center; justify-content: space-between; }
.f-label { font-size: 10px; font-weight: 700; color: var(--color-text-muted); }

.quick-reason-tags { display: flex; gap: 3px; }
.btn-reason-tag { padding: 1px 4px; border-radius: 3px; border: 1px solid var(--color-border-soft); background: rgba(255, 255, 255, 0.03); color: #38bdf8; font-size: 9.5px; cursor: pointer; }
.btn-reason-tag:hover { background: rgba(56, 189, 248, 0.15); }

.identity-card { display: flex; gap: 8px; align-items: center; padding: 4px 6px; border-radius: 4px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.2); font-size: 10px; }
.id-item { color: var(--color-text-secondary); }
.id-item.name strong { color: #38bdf8; }

.f-textarea { width: 100%; height: 50px; padding: 6px; border-radius: 4px; border: 1px solid var(--color-border-soft); background: rgba(15, 23, 42, 0.9); color: var(--color-text-primary); font-size: 11px; resize: vertical; }

.preset-row { display: flex; gap: 4px; }
.btn-duration-preset { height: 26px; flex: 1; border-radius: 4px; border: 1px solid var(--color-border-soft); background: rgba(255, 255, 255, 0.03); color: var(--color-text-secondary); font-size: 10.5px; font-weight: 600; cursor: pointer; }
.btn-duration-preset:hover { border-color: #38bdf8; color: #38bdf8; }
.btn-duration-preset.active { background: rgba(56, 189, 248, 0.15); border-color: #38bdf8; color: #38bdf8; }

.custom-duration-row { display: grid; grid-template-columns: 80px 1fr; gap: 4px; }
.f-input, .f-select { height: 26px; padding: 0 6px; border-radius: 4px; border: 1px solid var(--color-border-soft); background: rgba(15, 23, 42, 0.9); color: var(--color-text-primary); font-size: 11px; }

.expiry-summary-card { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; border-radius: 6px; background: rgba(0, 0, 0, 0.3); border: 1px solid var(--color-border-soft); font-size: 11px; }
.sum-left { display: flex; gap: 6px; align-items: center; }
.sum-lbl { color: var(--color-text-muted); }
.sum-val { color: #38bdf8; font-weight: 700; }
.sum-hint { color: var(--color-text-muted); font-size: 10px; }

.form-action-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding-top: 6px; }
.submit-btn { height: 28px; padding: 0 12px; }

/* Activity Stream */
.activity-feed { display: flex; flex-direction: column; gap: 4px; }
.activity-row-card { display: grid; grid-template-columns: 90px minmax(120px, 1fr) minmax(160px, 1.2fr) 90px 120px; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--color-border-soft); font-size: 10.5px; }
.event-tag { font-size: 9px; font-weight: 800; padding: 1px 4px; border-radius: 3px; text-transform: uppercase; text-align: center; }
.event-tag.success { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
.event-tag.danger { background: rgba(239, 68, 68, 0.2); color: #f87171; }
.event-tag.info { background: rgba(56, 189, 248, 0.2); color: #38bdf8; }
.act-name { color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.act-info, .act-server, .act-time { color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9.5px; }

.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 30px; color: var(--color-text-muted); font-size: 11px; text-align: center; }
.spinner { width: 16px; height: 16px; border: 2px solid rgba(56, 189, 248, 0.2); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.btn-compact { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 6px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer; border: 1px solid var(--color-border-default); background: rgba(255, 255, 255, 0.04); color: var(--color-text-secondary); }
.btn-compact .icon { width: 12px; height: 12px; }
.btn-compact:hover { border-color: var(--color-border-hover); color: var(--color-text-primary); background: rgba(255, 255, 255, 0.08); }
.btn-compact.accent { background: rgba(56, 189, 248, 0.15); border-color: rgba(56, 189, 248, 0.3); color: #38bdf8; }
.btn-compact.danger { border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.1); color: #fecaca; }
.btn-compact.ghost { background: transparent; border-color: rgba(255, 255, 255, 0.06); }

@media (max-width: 1000px) {
  .compact-split { grid-template-columns: 1fr !important; }
  .form-section.grid-2 { grid-template-columns: 1fr; }
}
</style>
