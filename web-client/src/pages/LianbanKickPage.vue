<template>
  <PluginPageShell
    title="联办踢出"
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

    <div class="lianban-kick-layout">
      <LianbanRuntimeDetails :state="state" />
      <LianbanFileList :files="state?.files ?? []" />
    </div>

    <LianbanLastMatch :match="state?.lastMatch" />
    <LianbanEventList :events="state?.recentEvents ?? []" />
  </PluginPageShell>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { apiGet } from "../app/apiClient";
import PluginPageShell from "../features/plugins/PluginPageShell.vue";
import LianbanEventList from "../features/lianban-kick/LianbanEventList.vue";
import LianbanFileList from "../features/lianban-kick/LianbanFileList.vue";
import LianbanLastMatch from "../features/lianban-kick/LianbanLastMatch.vue";
import LianbanRuntimeDetails from "../features/lianban-kick/LianbanRuntimeDetails.vue";
import type { LianbanState } from "../features/lianban-kick/types";
import StatGrid from "../components/ui/StatGrid.vue";
import type { StatItem } from "../components/ui/StatGrid.vue";
import type { StatusTone } from "../components/ui/StatusBadge.vue";
import { formatTime } from "../composables/useDateTimeFormat";
import { usePollingResource } from "../composables/usePollingResource";

type LianbanStateResponse = {
  ok: boolean;
  data: LianbanState | null;
};

const {
  data: state,
  loading,
  refreshing,
  error,
  stale,
  refresh,
} = usePollingResource<LianbanState | null>({
  fetcher: async () => {
    const response = await apiGet<LianbanStateResponse>("/api/plugins/lianban-kick/state");
    return response?.data ?? null;
  },
  intervalMs: 5000,
  immediate: true,
  pauseWhenHidden: true,
  refreshOnActivated: true,
  keepPreviousData: true,
});

const statusLabel = computed(() => {
  if (!state.value) return "未加载";
  if (!state.value.enabled) return "已停用";
  if (!state.value.subscribed) return "未订阅";
  return "运行中";
});

const statusTone = computed<StatusTone>(() => {
  if (!state.value) return "neutral";
  if (!state.value.enabled || !state.value.subscribed) return "warning";
  return state.value.lastError ? "danger" : "success";
});

const summaryItems = computed<StatItem[]>(() => [
  {
    key: "status",
    label: "插件状态",
    value: statusLabel.value,
    description: state.value?.subscribed ? "已订阅" : "未订阅",
    tone: statusTone.value,
  },
  {
    key: "entries",
    label: "联办条目",
    value: state.value?.entries ?? 0,
    description: `${state.value?.files?.length ?? 0} 个文件`,
    tone: "info",
  },
  {
    key: "playersScanned",
    label: "最近扫描人数",
    value: state.value?.playersScanned ?? 0,
    description: formatTime(state.value?.lastScanAt),
    tone: "neutral",
  },
  {
    key: "kickSuccess",
    label: "成功踢出",
    value: state.value?.kickSuccess ?? 0,
    description: `失败 ${state.value?.kickFailed ?? 0} 次`,
    tone: state.value?.kickFailed ? "warning" : "success",
  },
]);
</script>

<style scoped>
.lianban-kick-layout {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: var(--layout-gap-md, 16px);
}

@media (max-width: 900px) {
  .lianban-kick-layout {
    grid-template-columns: 1fr;
  }
}
</style>
