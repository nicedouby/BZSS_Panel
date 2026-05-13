<template>
  <div class="squad-order-page">
    <header class="squad-order-header">
      <div>
        <h1>建队顺序</h1>
        <p>当前对局：{{ data?.matchId || "Unknown" }}</p>
      </div>

      <button class="refresh-button" :disabled="query.isFetching.value" @click="refetch">
        {{ query.isFetching.value ? "刷新中..." : "刷新" }}
      </button>
    </header>

    <section class="squad-order-summary">
      <span>当前小队：{{ data?.count ?? 0 }}</span>
      <span>更新时间：{{ updatedAtLabel }}</span>
    </section>

    <section class="squad-order-table-wrap">
      <table class="squad-order-table">
        <thead>
          <tr>
            <th>顺序</th>
            <th>队伍</th>
            <th>小队ID</th>
            <th>小队名</th>
            <th>队长</th>
            <th>人数</th>
            <th>锁定</th>
            <th>建立时间</th>
            <th>来源</th>
            <th>状态</th>
          </tr>
        </thead>

        <tbody>
          <tr v-for="squad in orderedSquads" :key="squad.lifecycleId">
            <td class="order-cell">#{{ squad.order }}</td>
            <td>Team {{ squad.teamId }}</td>
            <td>Squad {{ squad.squadId }}</td>
            <td>{{ squad.squadName || "-" }}</td>
            <td>{{ squad.leaderName || squad.creatorName || "-" }}</td>
            <td>{{ squad.memberCount ?? "-" }}</td>
            <td>{{ squad.locked ? "是" : "否" }}</td>
            <td>
              <span>{{ squad.createdAtLabel || "--:--:--" }}</span>
              <small>{{ squad.createdDisplayText || "" }}</small>
            </td>
            <td>
              <span :class="['source-chip', squad.creationSource === 'LOG' ? 'source-log' : 'source-rcon']">
                {{ squad.sourceLabel || "-" }}
              </span>
            </td>
            <td>{{ squad.status }}</td>
          </tr>

          <tr v-if="!orderedSquads.length">
            <td colspan="10" class="empty-cell">
              暂无小队生命周期数据。等待 ListSquads 刷新或小队创建日志。
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiGet } from "../app/apiClient";

const query = useQuery({
  queryKey: ["squad-lifecycle-order"],
  queryFn: async () => apiGet<any>("/api/squad-lifecycle/order"),
  refetchInterval: 3000,
  refetchOnWindowFocus: false,
});

const data = computed(() => query.data.value ?? null);
const orderedSquads = computed(() => data.value?.orderedSquads ?? []);

const updatedAtLabel = computed(() => {
  const value = data.value?.updatedAt;
  if (!value) return "--:--:--";

  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) return "--:--:--";

  return new Date(parsed).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
});

function refetch() {
  void query.refetch();
}
</script>

<style scoped>
.squad-order-page {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 12px;
  height: 100%;
  min-height: 0;
  padding: 16px;
  color: var(--color-text-primary);
  background: var(--app-background, var(--color-bg-page));
}

.squad-order-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}

.squad-order-header h1 {
  margin: 0;
  font-size: 22px;
}

.squad-order-header p {
  margin: 4px 0 0;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.refresh-button {
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}

.squad-order-summary {
  display: flex;
  gap: 16px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.squad-order-table-wrap {
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  background: var(--color-bg-card);
}

.squad-order-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.squad-order-table th,
.squad-order-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border-soft);
  text-align: left;
  white-space: nowrap;
}

.squad-order-table th {
  position: sticky;
  top: 0;
  background: var(--color-bg-elevated);
  z-index: 1;
  color: var(--color-text-secondary);
  font-weight: 700;
}

.order-cell {
  font-weight: 800;
}

.source-chip {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--color-border-soft);
  font-size: 12px;
}

.source-log {
  color: var(--color-status-success);
}

.source-rcon {
  color: var(--color-status-warning);
}

td small {
  display: block;
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: 11px;
}

.empty-cell {
  text-align: center;
  color: var(--color-text-muted);
  padding: 24px;
}
</style>
