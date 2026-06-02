<template>
  <section class="page">
    <PageHeader title="快照录制" subtitle="对局结束时自动记录的本地快照列表，支持手动补录。">
      <template #actions>
        <button type="button" class="action-btn ghost" @click="loadList" :disabled="loading">
          {{ loading ? "刷新中..." : "刷新列表" }}
        </button>
        <button type="button" class="action-btn primary" @click="handleManualSnapshot" :disabled="busy">
          {{ busy ? "录制中..." : "手动录制快照" }}
        </button>
      </template>
    </PageHeader>

    <PageCard compact>
      <div class="summary-row">
        <div class="summary-pill">记录数 {{ snapshots.length }}</div>
        <div class="summary-pill" v-if="lastLoadedAt">更新于 {{ lastLoadedAt }}</div>
        <div class="summary-pill tone-warn" v-if="errorMessage">{{ errorMessage }}</div>
      </div>

      <div v-if="loading" class="empty-state">正在加载快照列表...</div>
      <div v-else-if="snapshots.length === 0" class="empty-state">暂无录制记录</div>
      <div v-else class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>录制时间</th>
              <th>大小</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="snapshot in snapshotsView" :key="snapshot.id">
              <td>
                <strong>{{ snapshot.name }}</strong>
                <div class="snapshot-file">{{ snapshot.id }}</div>
              </td>
              <td>{{ formatDate(snapshot.createdAt) }}</td>
              <td>{{ formatSize(snapshot.size) }}</td>
              <td>
                <button type="button" class="action-btn sm" @click="viewJson(snapshot.id)">查看 JSON</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </PageCard>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
import { useUiStore } from "../stores/ui.store";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";

interface MatchSnapshotItem {
  id: string;
  name: string;
  createdAt: string;
  size: number;
}

const ui = useUiStore();
const snapshots = ref<MatchSnapshotItem[]>([]);
const loading = ref(true);
const busy = ref(false);
const errorMessage = ref("");
const lastLoadedAt = ref("");

const sortedSnapshots = computed(() => [...snapshots.value].sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt))));

async function loadList() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const response = await apiGet<MatchSnapshotItem[] | { ok?: boolean; data?: MatchSnapshotItem[] }>("/api/match-snapshot/list");
    const list = Array.isArray(response)
      ? response
      : Array.isArray((response as { data?: MatchSnapshotItem[] } | null | undefined)?.data)
        ? (response as { data?: MatchSnapshotItem[] }).data ?? []
        : [];
    snapshots.value = list;
    lastLoadedAt.value = new Date().toLocaleString();
  } catch (error) {
    errorMessage.value = String(error instanceof Error ? error.message : error);
    ui.pushToast({ title: "加载失败", message: errorMessage.value, tone: "error" });
    snapshots.value = [];
  } finally {
    loading.value = false;
  }
}

async function handleManualSnapshot() {
  busy.value = true;
  errorMessage.value = "";
  try {
    await apiPost("/api/match-snapshot/capture", {});
    ui.pushToast({ title: "已录制", message: "快照已保存到本地文件", tone: "ok" });
    await loadList();
  } catch (error) {
    errorMessage.value = String(error instanceof Error ? error.message : error);
    ui.pushToast({ title: "录制失败", message: errorMessage.value, tone: "error" });
  } finally {
    busy.value = false;
  }
}

function viewJson(id: string) {
  window.open(`/api/match-snapshot/view?id=${encodeURIComponent(id)}`, "_blank", "noopener,noreferrer");
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatSize(value: number) {
  const size = Number(value ?? 0);
  if (!Number.isFinite(size) || size <= 0) return "0 KB";
  return `${(size / 1024).toFixed(2)} KB`;
}

const snapshotsView = computed(() => sortedSnapshots.value);

onMounted(loadList);
</script>

<style scoped>
.page {
  display: grid;
  gap: var(--spacing-lg);
  padding: var(--spacing-lg);
}

.summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.summary-pill {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary);
  font-size: 12px;
}

.summary-pill.tone-warn {
  border-color: rgba(245, 158, 11, 0.24);
  color: var(--color-status-warning);
  background: rgba(245, 158, 11, 0.08);
}

.table-container {
  overflow-x: auto;
}

.empty-state {
  padding: 24px 16px;
  text-align: center;
  color: var(--color-text-muted);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th,
.data-table td {
  padding: var(--spacing-md);
  text-align: left;
  border-bottom: 1px solid var(--color-border-soft);
  vertical-align: top;
}

.data-table th {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
}

.snapshot-file {
  margin-top: 4px;
  font-size: 11px;
  color: var(--color-text-muted);
}

.action-btn {
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
}

.action-btn.primary {
  background: var(--color-status-info);
  border-color: var(--color-status-info);
  color: #fff;
}

.action-btn.ghost {
  background: rgba(255, 255, 255, 0.03);
}

.action-btn.sm {
  padding: 4px 8px;
  font-size: 11px;
}
</style>
