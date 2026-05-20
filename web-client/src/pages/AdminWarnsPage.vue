<template>
  <section class="page">
    <PageHeader title="警告记录（当前进程内存）" subtitle="仅保留当前进程内存中的短期 AdminWarn 记录，进程重启后会清空。" />

    <PageCard compact>
      <div class="toolbar">
        <input v-model="filters.targetName" placeholder="目标玩家">
        <input v-model="filters.sourceModule" placeholder="来源模块">
        <select v-model="filters.success">
          <option value="">全部结果</option>
          <option value="true">成功</option>
          <option value="false">失败</option>
        </select>
        <select v-model="filters.skipped">
          <option value="">全部跳过状态</option>
          <option value="true">已跳过</option>
          <option value="false">未跳过</option>
        </select>
        <select v-model="filters.limit">
          <option :value="100">100</option>
          <option :value="200">200</option>
          <option :value="500">500</option>
        </select>
        <button type="button" @click="query.refetch()">{{ t("common.refresh") }}</button>
      </div>
    </PageCard>

    <DataState
      :loading="query.isLoading.value && !records.length"
      :error="pageError"
      :empty="!pageError && !records.length && !query.isLoading.value"
      empty-title="暂无警告记录"
      empty-text="当前筛选条件下没有 AdminWarn 记录。"
    >
      <div class="warn-scroll">
        <PageCard compact>
          <div class="summary">
            <span>共 {{ data?.total ?? records.length }} 条</span>
            <span v-if="data?.config">最大 {{ data.config.maxRecords }} 条</span>
            <span v-if="data?.config">TTL {{ Math.round((data.config.ttlMs ?? 0) / 60000) }} 分钟</span>
          </div>
        </PageCard>

        <PageCard compact>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>来源模块</th>
                  <th>原因</th>
                  <th>目标玩家</th>
                  <th>消息</th>
                  <th>成功</th>
                  <th>跳过</th>
                  <th>跳过原因</th>
                  <th>错误信息</th>
                  <th>关联事件 ID</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in records" :key="item.id">
                  <td>{{ formatTime(item.createdAt) }}</td>
                  <td>{{ item.sourceModule || "-" }}</td>
                  <td>{{ item.reason || "-" }}</td>
                  <td>{{ item.targetName || "-" }}</td>
                  <td class="message-cell">{{ item.message || "-" }}</td>
                  <td>{{ item.success ? "是" : "否" }}</td>
                  <td>{{ item.skipped ? "是" : "否" }}</td>
                  <td>{{ item.skipReason || "-" }}</td>
                  <td class="message-cell">{{ item.errorMessage || "-" }}</td>
                  <td class="id-cell">{{ item.relatedEventId || "-" }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </PageCard>
      </div>
    </DataState>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiGet } from "../app/apiClient";
import { renderApiError } from "../app/errors";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import DataState from "../components/common/DataState.vue";
import { t } from "../i18n";

const filters = reactive({
  targetName: "",
  sourceModule: "",
  success: "",
  skipped: "",
  limit: 200,
});

const query = useQuery({
  queryKey: computed(() => [
    "admin-warns",
    filters.targetName,
    filters.sourceModule,
    filters.success,
    filters.skipped,
    filters.limit,
  ]),
  queryFn: async () => {
    const params = new URLSearchParams({
      limit: String(filters.limit),
      targetName: filters.targetName,
      sourceModule: filters.sourceModule,
    });
    if (filters.success) params.set("success", filters.success);
    if (filters.skipped) params.set("skipped", filters.skipped);
    return apiGet<{
      records: Array<any>;
      total: number;
      config?: {
        maxRecords?: number;
        ttlMs?: number;
      } | null;
    }>(`/api/admin-warns/recent?${params.toString()}`);
  },
  placeholderData: (previousData) => previousData,
  refetchInterval: 3000,
  refetchIntervalInBackground: false,
});

const data = computed(() => query.data.value ?? null);
const records = computed(() => data.value?.records ?? []);
const pageError = computed(() => query.error.value ? renderApiError(query.error.value, "加载警告记录失败。") : "");

function formatTime(value: unknown) {
  const number = Number(value ?? 0);
  if (Number.isFinite(number) && number > 0) {
    return new Date(number).toLocaleString();
  }
  return String(value ?? "");
}
</script>

<style scoped>
.page {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.toolbar,
.summary {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.toolbar input,
.toolbar select {
  min-width: 0;
  border: 1px solid #38414c;
  background: #11171d;
  color: #edf2f4;
  border-radius: 6px;
  padding: 7px 10px;
  min-height: 34px;
}

.warn-scroll {
  display: grid;
  gap: 12px;
  min-height: 0;
  height: 100%;
  overflow: auto;
  padding-right: 4px;
}

.summary {
  color: #a5b0b8;
  font-size: 12px;
}

.table-wrap {
  overflow: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid #26303a;
  vertical-align: top;
  white-space: nowrap;
}

th {
  color: #98a5af;
  font-size: 11px;
  font-weight: 600;
}

.message-cell,
.id-cell {
  white-space: normal;
  min-width: 180px;
}
</style>
