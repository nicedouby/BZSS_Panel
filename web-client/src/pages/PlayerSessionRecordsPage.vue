<template>
  <AppPage full-bleed>
    <AppPageHeader
      title="进出服记录"
      subtitle="实时记录并审计所有玩家进服与退服的详细历史日志事件。"
      :status-items="headerStatusItems"
    >
      <template #actions>
        <button
          v-if="canClear"
          type="button"
          class="action-btn danger"
          :disabled="busy"
          @click="clearRecords"
        >
          {{ busy ? "清理中.." : "清空记录" }}
        </button>
      </template>
    </AppPageHeader>

    <div v-if="error" class="error-banner">
      {{ error }}
    </div>
    <div v-if="info" class="info-banner">
      {{ info }}
    </div>

    <!-- Scrollable content area -->
    <div class="page-content">
      <!-- Statistics Summary -->
      <StatGrid :items="statItems" :loading="loading" />

      <!-- Filters & Refresh Options Toolbar -->
      <AppPageToolbar>
        <div class="toolbar-left">
          <select v-model="kindFilter" class="filter-select">
            <option value="all">全部记录</option>
            <option value="join">仅看加入 (Join)</option>
            <option value="leave">仅看离开 (Leave)</option>
          </select>
          <input
            v-model.trim="playerFilter"
            type="text"
            class="filter-input search-input"
            placeholder="搜索玩家名..."
          />
          <input
            v-model.trim="serverFilter"
            type="text"
            class="filter-input server-input"
            placeholder="搜索 ServerID..."
          />
          <select v-model.number="limit" class="filter-select limit-select" @change="loadState">
            <option :value="50">50 条</option>
            <option :value="100">100 条</option>
            <option :value="200">200 条</option>
            <option :value="500">500 条</option>
          </select>
        </div>
        <div class="toolbar-right">
          <button type="button" class="action-btn" :disabled="loading" @click="loadState">
            {{ loading ? "刷新中.." : "立即刷新" }}
          </button>
          <button
            type="button"
            class="action-btn"
            :class="{ active: autoRefresh }"
            @click="toggleAutoRefresh"
          >
            {{ autoRefresh ? "自动刷新: 开启" : "开启自动刷新" }}
          </button>
        </div>
      </AppPageToolbar>

      <!-- Records Split Grid -->
      <AppCard
        compact
        title="最近进退服审计日志"
        description="实时审计并由新到旧排列展示进服和退服的玩家明细记录"
        body-mode="fill"
        class="sessions-card"
      >
        <div class="session-columns" :class="'columns-' + kindFilter">
          <!-- Join Records -->
          <section v-if="kindFilter === 'all' || kindFilter === 'join'" class="session-panel join-panel">
            <header class="session-panel-header">
              <div>
                <h3>进服记录 (Join)</h3>
                <p>当前过滤出 {{ joinRecords.length }} 条</p>
              </div>
              <span class="badge badge-ok">JOIN</span>
            </header>

            <div class="table-container" @scroll="handleScroll">
              <AppTable v-if="joinRecords.length" compact>
                <thead>
                  <tr>
                    <th style="width: 160px;">发生时间</th>
                    <th>玩家信息</th>
                    <th style="width: 110px;">服务器</th>
                    <th>网络与系统标识 (点击复制)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in joinRecords" :key="item.id">
                    <td class="time-col">{{ formatTime(item.at || item.time) }}</td>
                    <td class="player-col">
                      <strong class="player-name">{{ item.playerName || "-" }}</strong>
                      <span v-if="item.lianban?.matched" class="lianban-badge">被联办</span>
                      <div class="event-desc" v-if="item.eventName">{{ item.eventName }}</div>
                      <div v-if="item.lianban?.matched" class="lianban-desc">
                        命中 {{ item.lianban.matchKey }}: {{ item.lianban.matchedValue }}
                      </div>
                    </td>
                    <td class="server-col">
                      <span class="server-badge">{{ item.serverId || "未知" }}</span>
                    </td>
                    <td
                      class="extra-col copyable"
                      title="点击复制标识码"
                      @click="copyText(item.ip || item.steam64Id || item.eosId, '标识码')"
                    >
                      <span class="mono">{{ item.ip || item.steam64Id || item.eosId || "-" }}</span>
                      <span class="copy-icon">📋</span>
                    </td>
                  </tr>
                </tbody>
              </AppTable>
              <div v-else class="empty-list">暂无进服记录</div>
            </div>
          </section>

          <!-- Leave Records -->
          <section v-if="kindFilter === 'all' || kindFilter === 'leave'" class="session-panel leave-panel">
            <header class="session-panel-header">
              <div>
                <h3>退服记录 (Leave)</h3>
                <p>当前过滤出 {{ leaveRecords.length }} 条</p>
              </div>
              <span class="badge badge-warn">LEAVE</span>
            </header>

            <div class="table-container" @scroll="handleScroll">
              <AppTable v-if="leaveRecords.length" compact>
                <thead>
                  <tr>
                    <th style="width: 160px;">发生时间</th>
                    <th>玩家信息</th>
                    <th style="width: 110px;">服务器</th>
                    <th>网络与系统标识 (点击复制)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in leaveRecords" :key="item.id">
                    <td class="time-col">{{ formatTime(item.at || item.time) }}</td>
                    <td class="player-col">
                      <strong class="player-name">{{ item.playerName || "-" }}</strong>
                      <span v-if="item.lianban?.matched" class="lianban-badge">被联办</span>
                      <div class="event-desc" v-if="item.eventName">{{ item.eventName }}</div>
                      <div v-if="item.lianban?.matched" class="lianban-desc">
                        命中 {{ item.lianban.matchKey }}: {{ item.lianban.matchedValue }}
                      </div>
                    </td>
                    <td class="server-col">
                      <span class="server-badge">{{ item.serverId || "未知" }}</span>
                    </td>
                    <td
                      class="extra-col copyable"
                      title="点击复制标识码"
                      @click="copyText(item.ip || item.steam64Id || item.eosId, '标识码')"
                    >
                      <span class="mono">{{ item.ip || item.steam64Id || item.eosId || "-" }}</span>
                      <span class="copy-icon">📋</span>
                    </td>
                  </tr>
                </tbody>
              </AppTable>
              <div v-else class="empty-list">暂无退服记录</div>
            </div>
          </section>
        </div>
      </AppCard>
    </div>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";
import { useAuthStore } from "../stores/auth.store";
import { useUiStore } from "../stores/ui.store";
import { copyTextWithToast } from "../utils/clipboard";

import AppPage from "../components/common/AppPage.vue";
import AppPageHeader from "../components/common/AppPageHeader.vue";
import AppPageToolbar from "../components/common/AppPageToolbar.vue";
import AppCard from "../components/common/AppCard.vue";
import AppTable from "../components/common/AppTable.vue";
import StatGrid from "../components/ui/StatGrid.vue";

type SessionRecord = {
  id: string;
  kind: "join" | "leave";
  at?: string;
  time?: string;
  eventName?: string;
  eventId?: string;
  serverId?: string;
  playerName?: string;
  eosId?: string;
  steam64Id?: string;
  ip?: string;
  lianban?: {
    matched: boolean;
    label: string;
    matchKey?: string;
    matchedValue?: string;
    fileName?: string;
    lineNumber?: number;
    lineText?: string;
  } | null;
  hasPayload?: boolean;
  hasParams?: boolean;
  hasParamMap?: boolean;
};

type SessionState = {
  enabled: boolean;
  maxRecords: number;
  joinCount: number;
  leaveCount: number;
  totalCount: number;
  onlineCount: number;
  lastJoinAt: string;
  lastLeaveAt: string;
  records: SessionRecord[];
};

const auth = useAuthStore();
const ui = useUiStore();

const loading = ref(false);
const busy = ref(false);
const error = ref("");
const info = ref("");
const state = ref<SessionState | null>(null);

const autoRefresh = ref(true);
let autoRefreshTimer: number | null = null;

const isScrolling = ref(false);
let scrollTimeout: number | null = null;

function handleScroll() {
  isScrolling.value = true;
  if (scrollTimeout != null) {
    window.clearTimeout(scrollTimeout);
  }
  scrollTimeout = window.setTimeout(() => {
    isScrolling.value = false;
    scrollTimeout = null;
  }, 2500);
}

const kindFilter = ref<"all" | "join" | "leave">("all");
const playerFilter = ref("");
const serverFilter = ref("");
const limit = ref(200);

const canClear = computed(() => auth.user?.isSuperAdmin === true);
const inFlightNameLookups = new Set<string>();

const filteredRecords = computed<SessionRecord[]>(() => {
  const rows = Array.isArray(state.value?.records) ? state.value.records : [];
  const byKind = kindFilter.value;
  const byPlayer = playerFilter.value.trim().toLowerCase();
  const byServer = serverFilter.value.trim().toLowerCase();

  return rows
    .filter((item) => {
      if (byKind !== "all" && item.kind !== byKind) return false;
      if (byPlayer && !String(item.playerName ?? "").toLowerCase().includes(byPlayer)) return false;
      if (byServer && !String(item.serverId ?? "").toLowerCase().includes(byServer)) return false;
      return true;
    })
    .slice()
    .sort((left, right) => toTimeMs(right) - toTimeMs(left));
});

const joinRecords = computed(() => filteredRecords.value.filter((item) => item.kind === "join"));
const leaveRecords = computed(() => filteredRecords.value.filter((item) => item.kind === "leave"));

// AppPageHeader dynamic status badges
const headerStatusItems = computed(() => {
  const items: Array<{ label: string; tone?: "ok" | "warn" | "error" | "idle" }> = [];

  if (state.value?.enabled) {
    items.push({ label: "模块: 已启用", tone: "ok" });
  } else {
    items.push({ label: "模块: 已禁用", tone: "warn" });
  }

  if (autoRefresh.value) {
    items.push({ label: "自动刷新: 运行中", tone: "ok" });
  } else {
    items.push({ label: "自动刷新: 已关闭", tone: "idle" });
  }

  items.push({ label: `当前在线估算: ${state.value?.onlineCount ?? 0}`, tone: "idle" });

  return items;
});

// StatGrid items
const statItems = computed(() => {
  return [
    {
      key: "onlineCount",
      label: "当前在线估算",
      value: state.value?.onlineCount ?? 0,
      description: "当前服务器内在线玩家数统计",
      tone: "info" as const,
    },
    {
      key: "joinCount",
      label: "累计加入人数",
      value: state.value?.joinCount ?? 0,
      description: state.value?.lastJoinAt ? `最晚加入: ${formatTime(state.value.lastJoinAt)}` : "--",
      tone: "success" as const,
    },
    {
      key: "leaveCount",
      label: "累计离开人数",
      value: state.value?.leaveCount ?? 0,
      description: state.value?.lastLeaveAt ? `最晚离开: ${formatTime(state.value.lastLeaveAt)}` : "--",
      tone: "warning" as const,
    },
    {
      key: "totalCount",
      label: "记录保留上限",
      value: `${state.value?.totalCount ?? 0} / ${state.value?.maxRecords ?? 0}`,
      description: "历史队列记录大小与上限容量",
      tone: "neutral" as const,
    },
  ];
});

onMounted(() => {
  void loadState();
  setupAutoRefresh();
});

onUnmounted(() => {
  if (autoRefreshTimer != null) {
    window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  if (scrollTimeout != null) {
    window.clearTimeout(scrollTimeout);
    scrollTimeout = null;
  }
});

function setupAutoRefresh() {
  if (autoRefreshTimer != null) {
    window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  if (!autoRefresh.value) return;

  autoRefreshTimer = window.setInterval(() => {
    if (canAutoRefreshNow() && !isScrolling.value) void loadState();
  }, 2500);
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value;
  setupAutoRefresh();
}

async function loadState() {
  loading.value = true;
  error.value = "";

  try {
    const response = await apiGet<{ ok: boolean; data: SessionState }>(
      `/api/modules/player-session-records/state?limit=${encodeURIComponent(String(limit.value))}`,
    );
    state.value = response.data ?? null;
    void hydrateMissingNames();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function clearRecords() {
  if (!canClear.value) {
    error.value = "只有超级管理员可以清空记录。";
    return;
  }

  const confirmed = await ui.openConfirm({
    title: "确认清空记录吗？",
    message: "此操作会清空当前服务器中全部进服和退服的历史审计日志，清空后数据将无法挽回！",
    confirmText: "确认清空",
    cancelText: "取消",
    tone: "error",
  });
  if (!confirmed) return;

  busy.value = true;
  error.value = "";
  info.value = "";

  try {
    await apiPost("/api/modules/player-session-records/clear", {});
    info.value = "进退服记录已清空。";
    await loadState();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function copyText(text: string | null | undefined, label: string) {
  if (!text || text === "-") return;
  await copyTextWithToast(text, ui, {
    label,
    successMessage: `已复制 ${label} 到剪贴板`,
    errorMessage: `复制 ${label} 失败`,
  });
}

function formatTime(value: string | number | null | undefined) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function toTimeMs(item: SessionRecord) {
  const parsed = Date.parse(String(item.at ?? item.time ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function hydrateMissingNames() {
  const rows = Array.isArray(state.value?.records) ? state.value.records : [];
  await Promise.all(rows.map(async (item) => {
    if (String(item.playerName ?? "").trim()) return;

    const lookupKey = String(item.steam64Id ?? item.eosId ?? "").trim();
    if (!lookupKey || inFlightNameLookups.has(lookupKey)) return;

    inFlightNameLookups.add(lookupKey);
    try {
      const resolvedName = await resolvePlayerNameFromApi(item);
      if (!resolvedName) return;
      item.playerName = resolvedName;
    } finally {
      inFlightNameLookups.delete(lookupKey);
    }
  }));
}

async function resolvePlayerNameFromApi(item: SessionRecord) {
  const searchKeys = [
    String(item.steam64Id ?? "").trim(),
    String(item.eosId ?? "").trim(),
  ].filter(Boolean);

  for (const searchKey of searchKeys) {
    try {
      const params = new URLSearchParams({
        q: searchKey,
        limit: "1",
        sort: "updated_desc",
      });
      const response = await apiGet<any>(`/api/query/player-database?${params.toString()}`);
      const match = response?.items?.[0] ?? response?.players?.[0] ?? null;
      const name = String(match?.current_name ?? match?.name ?? "").trim();
      if (name) return name;
    } catch {
      continue;
    }
  }

  return "";
}
</script>

<style scoped>
.page-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: hidden;
}

.error-banner {
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid rgba(248, 113, 113, 0.35);
  background: rgba(127, 29, 29, 0.28);
  color: #fecaca;
  font-size: 13px;
}

.info-banner {
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid rgba(96, 165, 250, 0.35);
  background: rgba(30, 58, 138, 0.28);
  color: #dbeafe;
  font-size: 13px;
}

/* Toolbar filters styling */
.filter-select, .filter-input {
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.2);
  color: var(--color-text-primary);
  font-size: 13px;
  height: 32px;
  transition: border-color 0.15s ease;
}

.filter-select:focus, .filter-input:focus {
  outline: none;
  border-color: var(--color-border-hover);
}

.search-input {
  width: 180px;
}

.server-input {
  width: 150px;
}

.limit-select {
  width: 90px;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Sessions Card layout */
.sessions-card {
  flex: 1;
  min-height: 0;
}

.session-columns {
  display: grid;
  gap: 16px;
  height: 100%;
  min-height: 0;
}

.session-columns.columns-all {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.session-columns.columns-join,
.session-columns.columns-leave {
  grid-template-columns: 1fr;
}

.session-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  border: 1px solid var(--color-border-soft, rgba(255, 255, 255, 0.05));
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.session-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-soft, rgba(255, 255, 255, 0.05));
  background: rgba(255, 255, 255, 0.01);
  flex-shrink: 0;
}

.session-panel-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.session-panel-header p {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--color-text-muted);
}

.table-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.empty-list {
  display: grid;
  place-items: center;
  height: 100%;
  min-height: 200px;
  padding: 24px;
  color: var(--color-text-muted);
  font-size: 13px;
}

/* Table columns typography */
.time-col {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: var(--color-text-muted);
}

.player-name {
  font-size: 13px;
  color: var(--color-text-primary);
}

.event-desc {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 2px;
}

.lianban-badge {
  display: inline-flex;
  align-items: center;
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(220, 38, 38, 0.16);
  color: #fca5a5;
  font-size: 11px;
  border: 1px solid rgba(248, 113, 113, 0.28);
}

.lianban-desc {
  margin-top: 4px;
  font-size: 11px;
  color: #fda4af;
}

.server-badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.03);
}

/* Copy actions */
.copyable {
  cursor: pointer;
  transition: color 0.15s ease;
}

.copyable:hover {
  color: var(--color-text-primary) !important;
}

.copyable:hover .copy-icon {
  opacity: 1;
}

.copy-icon {
  font-size: 10px;
  margin-left: 6px;
  opacity: 0.5;
  transition: opacity 0.15s ease;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.badge-ok {
  background: rgba(34, 197, 94, 0.12);
  color: #86efac;
  border: 1px solid rgba(34, 197, 94, 0.25);
}

.badge-warn {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.25);
}

/* Action buttons */
.action-btn {
  min-height: 32px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  transition: all 0.15s ease;
}

.action-btn:hover:not(:disabled) {
  border-color: var(--color-border-hover);
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.06);
}

.action-btn.active {
  border-color: rgba(96, 165, 250, 0.35);
  background: rgba(96, 165, 250, 0.12);
  color: var(--color-text-primary);
}

.action-btn.danger {
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.08);
  color: #fecaca;
}

.action-btn.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.16);
  border-color: rgba(239, 68, 68, 0.5);
  color: #fff;
}

@media (max-width: 1100px) {
  .session-columns {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 780px) {
  .filter-select, .filter-input, .search-input, .server-input {
    width: 100%;
  }

  .toolbar-right {
    width: 100%;
    justify-content: space-between;
  }
}
</style>
