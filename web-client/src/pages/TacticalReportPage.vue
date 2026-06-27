<template>
  <PluginPageShell
    title="战术报点"
    :status-label="statusLabel"
    :status-tone="statusTone"
    :loading="loading"
    :refreshing="refreshing"
    :error="error"
    :stale="stale"
    :enabled="state?.enabled"
    @refresh="refresh"
  >
    <template #actions>
      <RouterLink class="btn ghost" to="/plugins/tactical-report/config">进入配置</RouterLink>
    </template>

    <template #summary>
      <StatGrid :items="summaryItems" :loading="loading && !state" />
    </template>

    <div class="report-grid">
      <PageCard title="基础状态" description="插件状态、触发词与冷却参数。">
        <dl class="meta-list">
          <div><dt>启用</dt><dd>{{ state?.enabled ? "是" : "否" }}</dd></div>
          <div><dt>触发词</dt><dd>{{ state?.config?.triggerText ?? "ZSBD" }}</dd></div>
          <div><dt>玩家冷却</dt><dd>{{ state?.config?.playerCooldownSeconds ?? 10 }}s</dd></div>
          <div><dt>/help 冷却</dt><dd>{{ state?.config?.helpGlobalCooldownSeconds ?? 30 }}s</dd></div>
          <div><dt>最大长度</dt><dd>{{ state?.config?.maxMessageLength ?? 120 }}</dd></div>
          <div><dt>RCON 并发</dt><dd>{{ state?.config?.rconPoolSize ?? 6 }}</dd></div>
        </dl>
      </PageCard>

      <PageCard title="默认快捷报点" description="查看 /1 到 /9 的默认内容。">
        <table class="table">
          <thead>
            <tr>
              <th>代码</th>
              <th>内容</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="code in codeKeys" :key="code">
              <td>{{ code }}</td>
              <td>{{ state?.config?.defaultCodes?.[code] ?? "" }}</td>
            </tr>
          </tbody>
        </table>
      </PageCard>
    </div>

    <div class="report-grid secondary">
      <PageCard title="玩家自定义码" description="当前玩家保存的 /10+ 快捷报点。">
        <table class="table">
          <thead>
            <tr>
              <th>玩家</th>
              <th>SteamID</th>
              <th>代码</th>
              <th>内容</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in userCodeRows" :key="row.key">
              <td>{{ row.playerName }}</td>
              <td>{{ row.steamId }}</td>
              <td>{{ row.code }}</td>
              <td>{{ row.message }}</td>
            </tr>
            <tr v-if="!userCodeRows.length">
              <td colspan="4" class="empty-state">暂无自定义码</td>
            </tr>
          </tbody>
        </table>
      </PageCard>

      <PageCard title="最近日志" description="最近的战术报点、帮助、保存与拒绝记录。">
        <table class="table">
          <thead>
            <tr>
              <th>时间</th>
              <th>玩家</th>
              <th>阵营</th>
              <th>内容</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in recentLogs" :key="item.id">
              <td>{{ formatTime(item.at) }}</td>
              <td>{{ item.playerName || item.steamId || "-" }}</td>
              <td>{{ item.teamName || item.teamId || "-" }}</td>
              <td>{{ item.message || item.reportText || item.reason || "-" }}</td>
              <td>{{ item.kind }}</td>
            </tr>
            <tr v-if="!recentLogs.length">
              <td colspan="5" class="empty-state">暂无日志</td>
            </tr>
          </tbody>
        </table>
      </PageCard>
    </div>
  </PluginPageShell>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";

import { apiGet } from "../app/apiClient";
import PluginPageShell from "../features/plugins/PluginPageShell.vue";
import PageCard from "../components/common/PageCard.vue";
import StatGrid from "../components/ui/StatGrid.vue";
import type { StatItem } from "../components/ui/StatGrid.vue";
import type { StatusTone } from "../components/ui/StatusBadge.vue";
import { formatTime } from "../composables/useDateTimeFormat";
import { usePollingResource } from "../composables/usePollingResource";

type TacticalReportState = {
  enabled: boolean;
  config: {
    triggerText: string;
    playerCooldownSeconds: number;
    helpGlobalCooldownSeconds: number;
    maxMessageLength: number;
    rconPoolSize?: number;
    defaultCodes: Record<string, string>;
  };
  triggerCount: number;
  reportCount: number;
  helpCount: number;
  setCount: number;
  rejectedCount: number;
  lastReportAt: string;
  lastHelpAt: string;
  recentRecords: Array<{
    id: string;
    at: string;
    kind: string;
    playerName?: string;
    steamId?: string;
    teamName?: string;
    teamId?: number;
    code?: string;
    sourceCode?: string;
    message?: string;
    reportText?: string;
    reason?: string;
  }>;
  userCodes: Record<string, Record<string, string>>;
};

const codeKeys = ["/1", "/2", "/3", "/4", "/5", "/6", "/7", "/8", "/9"];

const { data: state, loading, refreshing, error, stale, refresh } = usePollingResource<TacticalReportState | null>({
  fetcher: async () => {
    const response = await apiGet<{ ok: boolean; data: TacticalReportState | null }>("/api/plugins/tactical-report/state");
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
  { key: "trigger", label: "触发词", value: state.value?.config?.triggerText ?? "ZSBD", description: "大小写不敏感", tone: "info" },
  { key: "reports", label: "报点次数", value: state.value?.reportCount ?? 0, description: formatTime(state.value?.lastReportAt), tone: "success" },
  { key: "help", label: "/help 次数", value: state.value?.helpCount ?? 0, description: formatTime(state.value?.lastHelpAt), tone: "info" },
  { key: "set", label: "/set 次数", value: state.value?.setCount ?? 0, description: "个人快捷码保存次数", tone: "neutral" },
]);

const userCodeRows = computed(() => {
  const entries: Array<{ key: string; playerName: string; steamId: string; code: string; message: string }> = [];
  const userCodes = state.value?.userCodes ?? {};
  for (const [steamId, codes] of Object.entries(userCodes)) {
    for (const [code, message] of Object.entries(codes ?? {})) {
      entries.push({
        key: `${steamId}:${code}`,
        playerName: steamId,
        steamId,
        code,
        message,
      });
    }
  }
  return entries.sort((a, b) => a.steamId.localeCompare(b.steamId) || a.code.localeCompare(b.code));
});

const recentLogs = computed(() => state.value?.recentRecords ?? []);
</script>

<style scoped>
.report-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.secondary {
  margin-top: 16px;
}

.meta-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
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

@media (max-width: 1100px) {
  .report-grid {
    grid-template-columns: 1fr;
  }
}
</style>
