<template>
  <section class="page-shell">
        <h1 class="sr-only">进退服记录</h1>

    <WorkspaceToolbar>
      <template #actions>
        <button type="button" class="btn ghost" :disabled="loading" @click="loadState">
          {{ loading ? "刷新中.." : "刷新" }}
        </button>
        <button type="button" :class="['btn', autoRefresh ? 'primary' : 'ghost']" @click="toggleAutoRefresh">
          {{ autoRefresh ? "自动刷新中" : "开启自动刷新" }}
        </button>
        <button type="button" class="btn danger" :disabled="busy || !canClear" @click="clearRecords">
          {{ busy ? "清理中.." : "清空记录" }}
        </button>
      </template>
    </WorkspaceToolbar><div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="info" class="banner info">{{ info }}</div>

    <div class="cards-grid">
      <PageCard title="总体状态" description="累计统计与在线估算" compact>
        <div class="metric-grid">
          <div class="metric">
            <span class="label">模块状态</span>
            <strong>{{ state?.enabled ? "已启用" : "已禁用" }}</strong>
          </div>
          <div class="metric">
            <span class="label">当前在线估算</span>
            <strong>{{ state?.onlineCount ?? 0 }}</strong>
          </div>
          <div class="metric">
            <span class="label">累计加入</span>
            <strong>{{ state?.joinCount ?? 0 }}</strong>
          </div>
          <div class="metric">
            <span class="label">累计离开</span>
            <strong>{{ state?.leaveCount ?? 0 }}</strong>
          </div>
          <div class="metric">
            <span class="label">记录总数</span>
            <strong>{{ state?.totalCount ?? 0 }}</strong>
          </div>
          <div class="metric">
            <span class="label">保留上限</span>
            <strong>{{ state?.maxRecords ?? 0 }}</strong>
          </div>
        </div>

        <dl class="detail-list">
          <div>
            <dt>最近加入</dt>
            <dd>{{ formatTime(state?.lastJoinAt) }}</dd>
          </div>
          <div>
            <dt>最近离开</dt>
            <dd>{{ formatTime(state?.lastLeaveAt) }}</dd>
          </div>
        </dl>
      </PageCard>

      <PageCard title="过滤" description="只看你关心的记录" compact>
        <div class="filters">
          <label class="label" for="kind-select">类型</label>
          <select id="kind-select" v-model="kindFilter" class="input">
            <option value="all">全部</option>
            <option value="join">加入</option>
            <option value="leave">离开</option>
          </select>

          <label class="label" for="player-filter">玩家名包含</label>
          <input id="player-filter" v-model.trim="playerFilter" type="text" class="input" placeholder="例如 Mouse" />

          <label class="label" for="server-filter">ServerID</label>
          <input id="server-filter" v-model.trim="serverFilter" type="text" class="input" placeholder="例如 BZSS_Main" />

          <label class="label" for="limit-select">显示条数</label>
          <select id="limit-select" v-model.number="limit" class="input" @change="loadState">
            <option :value="50">50</option>
            <option :value="100">100</option>
            <option :value="200">200</option>
            <option :value="500">500</option>
          </select>
        </div>
      </PageCard>
    </div>

    <PageCard title="最近进退服记录" description="按时间倒序" compact>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>玩家</th>
              <th>EOS ID</th>
              <th>Steam64</th>
              <th>IP</th>
              <th>服务器</th>
              <th>事件名</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!filteredRecords.length">
              <td colspan="8" class="empty-cell">暂无记录</td>
            </tr>
            <tr v-for="item in filteredRecords" :key="item.id">
              <td>{{ formatTime(item.at || item.time) }}</td>
              <td>
                <span :class="['pill', item.kind === 'join' ? 'ok' : 'warn']">
                  {{ item.kind === "join" ? "加入" : "离开" }}
                </span>
              </td>
              <td class="truncate">{{ item.playerName || "-" }}</td>
              <td class="truncate">{{ item.eosId || "-" }}</td>
              <td class="truncate">{{ item.steam64Id || "-" }}</td>
              <td>{{ item.ip || "-" }}</td>
              <td class="truncate">{{ item.serverId || "-" }}</td>
              <td class="truncate">{{ item.eventName || "-" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </PageCard>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
import { useAuthStore } from "../stores/auth.store";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";
import PageCard from "../components/common/PageCard.vue";

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
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const info = ref("");
const state = ref<SessionState | null>(null);

const autoRefresh = ref(true);
let autoRefreshTimer: number | null = null;

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

  return rows.filter((item) => {
    if (byKind !== "all" && item.kind !== byKind) return false;
    if (byPlayer && !String(item.playerName ?? "").toLowerCase().includes(byPlayer)) return false;
    if (byServer && String(item.serverId ?? "").toLowerCase() !== byServer) return false;
    return true;
  });
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
});

function setupAutoRefresh() {
  if (autoRefreshTimer != null) {
    window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  if (!autoRefresh.value) return;

  autoRefreshTimer = window.setInterval(() => {
    void loadState();
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

function formatTime(value: string | number | null | undefined) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
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
.page-shell {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  gap: 18px;
  padding: 18px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.metric {
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--line-soft, rgba(255, 255, 255, 0.08));
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.metric .label {
  font-size: 12px;
  opacity: 0.75;
}

.metric strong {
  font-size: 18px;
}

.detail-list {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px 14px;
}

.detail-list dt {
  font-size: 12px;
  opacity: 0.75;
}

.detail-list dd {
  margin: 2px 0 0;
}

.filters {
  display: grid;
  gap: 8px;
}

.label {
  font-size: 12px;
  opacity: 0.78;
}

.input {
  width: 100%;
  border: 1px solid var(--line-soft, rgba(255, 255, 255, 0.12));
  border-radius: 8px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.02);
  color: inherit;
}

.btn {
  border: 1px solid var(--line-soft, rgba(255, 255, 255, 0.16));
  background: rgba(255, 255, 255, 0.02);
  color: inherit;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}

.btn.primary {
  background: rgba(82, 196, 26, 0.18);
  border-color: rgba(82, 196, 26, 0.48);
}

.btn.ghost {
  background: rgba(255, 255, 255, 0.02);
}

.btn.danger {
  background: rgba(255, 77, 79, 0.15);
  border-color: rgba(255, 77, 79, 0.45);
}

.banner {
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13px;
}

.banner.error {
  background: rgba(255, 77, 79, 0.16);
  border: 1px solid rgba(255, 77, 79, 0.34);
}

.banner.info {
  background: rgba(24, 144, 255, 0.14);
  border: 1px solid rgba(24, 144, 255, 0.34);
}

.table-wrap {
  height: 100%;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 1120px;
}

.data-table th,
.data-table td {
  text-align: left;
  padding: 9px 10px;
  border-bottom: 1px solid var(--line-soft, rgba(255, 255, 255, 0.08));
  vertical-align: top;
}

.data-table th {
  font-size: 12px;
  opacity: 0.8;
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--color-bg-card);
}

.truncate {
  max-width: 240px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-cell {
  text-align: center;
  opacity: 0.7;
  padding: 18px 12px;
}

.pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  min-width: 52px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 12px;
  margin-right: 5px;
}

.pill.ok {
  background: rgba(82, 196, 26, 0.16);
  border-color: rgba(82, 196, 26, 0.4);
}

.pill.warn {
  background: rgba(250, 173, 20, 0.16);
  border-color: rgba(250, 173, 20, 0.4);
}

.pill.skip {
  background: rgba(140, 140, 140, 0.14);
  border-color: rgba(140, 140, 140, 0.36);
}

@media (max-width: 1100px) {
  .page-shell {
    padding: 14px;
  }
}
</style>

