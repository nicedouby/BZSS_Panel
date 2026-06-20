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
    <template #summary>
      <StatGrid :items="summaryItems" :loading="loading && !state" />
    </template>

    <div class="report-layout">
      <PageCard title="配置预览" description="查看当前触发词、冷却与预设快捷内容。">
        <dl class="meta-list">
          <div><dt>触发词</dt><dd>{{ state?.config?.triggerText ?? "ZSBD" }}</dd></div>
          <div><dt>个人冷却</dt><dd>{{ state?.config?.playerCooldownSeconds ?? 10 }}s</dd></div>
          <div><dt>/help 冷却</dt><dd>{{ state?.config?.helpGlobalCooldownSeconds ?? 30 }}s</dd></div>
          <div><dt>最大长度</dt><dd>{{ state?.config?.maxMessageLength ?? 120 }}</dd></div>
        </dl>
      </PageCard>

      <PageCard title="最近记录" description="展示触发、帮助、保存与拒绝记录。">
        <div class="record-list">
          <article v-for="item in state?.recentRecords ?? []" :key="item.id" class="record-card">
            <div class="record-head">
              <strong>{{ item.kind }}</strong>
              <span>{{ formatTime(item.at) }}</span>
            </div>
            <div class="record-body">{{ item.message || item.reportText || item.reason || "-" }}</div>
            <div class="record-foot">
              <span>{{ item.playerName || item.steamId || "-" }}</span>
              <span v-if="item.code">{{ item.code }}</span>
              <span v-if="item.sourceCode">{{ item.sourceCode }}</span>
            </div>
          </article>
          <div v-if="!(state?.recentRecords ?? []).length" class="empty-state">暂无记录</div>
        </div>
      </PageCard>
    </div>
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

type TacticalReportState = {
  enabled: boolean;
  config: {
    triggerText: string;
    playerCooldownSeconds: number;
    helpGlobalCooldownSeconds: number;
    maxMessageLength: number;
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
    code?: string;
    sourceCode?: string;
    message?: string;
    reportText?: string;
    reason?: string;
  }>;
};

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
  { key: "set", label: "/set 次数", value: state.value?.setCount ?? 0, description: "个人快捷码保存", tone: "neutral" },
]);
</script>

<style scoped>
.report-layout {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: 16px;
}

.meta-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.record-list {
  display: grid;
  gap: 10px;
}

.record-card {
  border: 1px solid var(--color-border-soft);
  border-radius: 12px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
}

.record-head,
.record-foot {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.record-body {
  margin: 8px 0;
  white-space: pre-wrap;
}
</style>
