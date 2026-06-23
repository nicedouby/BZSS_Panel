<template>
  <PluginPageShell
    title="联办文模块"
    :status-label="statusLabel"
    :status-tone="statusTone"
    :loading="loading"
    :refreshing="refreshing"
    :error="error"
    :stale="stale"
    :enabled="state?.enabled"
    :subscribed="state?.subscribed"
    @refresh="refresh"
  >
    <template #summary>
      <StatGrid :items="summaryItems" :loading="loading && !state" />
    </template>

    <div class="lianban-grid">
      <PageCard title="扫描状态" description="读取 Ban 目录并构建 SteamID / EOSID 索引。">
        <dl class="meta-list">
          <div><dt>目录</dt><dd>{{ state?.banDir || "Ban" }}</dd></div>
          <div><dt>最近扫描</dt><dd>{{ formatTime(state?.lastScanAt) }}</dd></div>
          <div><dt>最近加入</dt><dd>{{ formatTime(state?.lastJoinAt) }}</dd></div>
          <div><dt>最近命中</dt><dd>{{ formatTime(state?.lastMatchAt) }}</dd></div>
        </dl>
        <div v-if="state?.scanError" class="error-banner">{{ state.scanError }}</div>
      </PageCard>

      <PageCard title="最近命中" description="仅记录展示，不自动踢出或警告。">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>玩家</th>
                <th>SteamID</th>
                <th>EOSID</th>
                <th>命中方式</th>
                <th>文件</th>
                <th>行号</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in recentMatches" :key="item.id">
                <td>{{ formatTime(item.at) }}</td>
                <td>{{ item.playerName || "-" }}</td>
                <td class="mono">{{ item.steamID || "-" }}</td>
                <td class="mono">{{ item.eosID || "-" }}</td>
                <td>{{ item.matchKey ? `${item.matchKey}: ${item.matchedValue}` : "-" }}</td>
                <td>{{ item.fileName || "-" }}</td>
                <td>{{ item.lineNumber || "-" }}</td>
              </tr>
              <tr v-if="!recentMatches.length">
                <td colspan="7" class="empty-state">暂无命中</td>
              </tr>
            </tbody>
          </table>
        </div>
      </PageCard>
    </div>

    <PageCard title="载入文件" description="扫描 Ban 目录下的配置文件。">
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>文件</th>
              <th>记录数</th>
              <th>错误</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in loadedFiles" :key="item.filePath || item.fileName">
              <td>{{ item.fileName || "-" }}</td>
              <td>{{ item.recordCount || 0 }}</td>
              <td>{{ item.error || "-" }}</td>
            </tr>
            <tr v-if="!loadedFiles.length">
              <td colspan="3" class="empty-state">暂无文件</td>
            </tr>
          </tbody>
        </table>
      </div>
    </PageCard>
  </PluginPageShell>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { apiGet } from "../app/apiClient";
import PluginPageShell from "../components/domain/plugin/PluginPageShell.vue";
import PageCard from "../components/common/PageCard.vue";
import StatGrid from "../components/ui/StatGrid.vue";
import type { StatItem } from "../components/ui/StatGrid.vue";
import type { StatusTone } from "../components/ui/StatusBadge.vue";
import { formatTime } from "../composables/useDateTimeFormat";
import { usePollingResource } from "../composables/usePollingResource";

type LianbanKickState = {
  enabled: boolean;
  subscribed: boolean;
  banDir: string;
  historyLimit: number;
  totalRecords: number;
  totalFiles: number;
  lastScanAt: string;
  lastJoinAt: string;
  lastMatchAt: string;
  scanError: string;
  joinEventCount: number;
  matchedCount: number;
  recentJoins: Array<Record<string, any>>;
  recentMatches: Array<{
    id: string;
    at: string;
    playerName?: string;
    steamID?: string;
    eosID?: string;
    matchKey?: string;
    matchedValue?: string;
    fileName?: string;
    filePath?: string;
    lineNumber?: number;
    lineText?: string;
  }>;
  loadedFiles: Array<{
    fileName?: string;
    filePath?: string;
    recordCount?: number;
    error?: string;
  }>;
};

const { data: state, loading, refreshing, error, stale, refresh } = usePollingResource<LianbanKickState | null>({
  fetcher: async () => {
    const response = await apiGet<{ ok: boolean; data: LianbanKickState | null }>("/api/plugins/lianban-kick/state");
    return response?.data ?? null;
  },
  intervalMs: 5000,
  immediate: true,
  pauseWhenHidden: true,
  refreshOnActivated: true,
  keepPreviousData: true,
});

const statusLabel = computed(() => (state.value?.enabled ? "运行中" : "已停用"));
const statusTone = computed<StatusTone>(() => (state.value?.enabled ? "success" : "warning"));

const summaryItems = computed<StatItem[]>(() => [
  { key: "files", label: "文件数", value: state.value?.totalFiles ?? 0, description: "已扫描 Ban 目录", tone: "info" },
  { key: "records", label: "记录数", value: state.value?.totalRecords ?? 0, description: "已解析联办条目", tone: "neutral" },
  { key: "joins", label: "加入事件", value: state.value?.joinEventCount ?? 0, description: "已处理玩家加入事件", tone: "info" },
  { key: "matches", label: "命中次数", value: state.value?.matchedCount ?? 0, description: "最近触发的联办命中", tone: "danger" },
]);

const recentMatches = computed(() => state.value?.recentMatches ?? []);
const loadedFiles = computed(() => state.value?.loadedFiles ?? []);
</script>

<style scoped>
.lianban-grid {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: 16px;
  margin-bottom: 16px;
}

.meta-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.meta-list dt {
  font-size: 12px;
  color: var(--color-text-muted);
}

.meta-list dd {
  margin: 4px 0 0;
}

.table-wrap {
  overflow: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
}

.table th,
.table td {
  border-bottom: 1px solid var(--color-border-soft);
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
}

.table th {
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 600;
}

.empty-state {
  color: var(--color-text-muted);
  text-align: center;
  padding: 18px 0;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

@media (max-width: 1100px) {
  .lianban-grid {
    grid-template-columns: 1fr;
  }
}
</style>
