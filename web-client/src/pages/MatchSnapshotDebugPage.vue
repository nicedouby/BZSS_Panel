<template>
  <section class="page">
    <PageHeader title="快照录制" subtitle="对局结束时自动记录的所有快照文件 (调试模式开启)">
      <template #actions>
        <button type="button" class="action-btn primary" @click="handleManualSnapshot" :disabled="busy">
          {{ busy ? "捕获中..." : "手动捕获快照" }}
        </button>
      </template>
    </PageHeader>

    <PageCard compact>
      <div class="table-container">
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
            <tr v-if="loading">
              <td colspan="4" class="text-center">正在加载...</td>
            </tr>
            <tr v-else-if="snapshots.length === 0">
              <td colspan="4" class="text-center">暂无录制记录</td>
            </tr>
            <tr v-for="s in snapshots" :key="s.id">
              <td><strong>{{ s.name }}</strong></td>
              <td>{{ new Date(s.createdAt).toLocaleString() }}</td>
              <td>{{ (s.size / 1024).toFixed(2) }} KB</td>
              <td>
                <button type="button" class="action-btn sm" @click="viewJson(s.id)">查看 JSON</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </PageCard>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
import { useUiStore } from "../stores/ui.store";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";

const ui = useUiStore();
const snapshots = ref<any[]>([]);
const loading = ref(true);
const busy = ref(false);

async function loadList() {
  loading.value = true;
  try {
    const res = await apiGet<any>("/api/plugins");
    // Find our plugin and call listSnapshots
    // Actually, we can just call our new endpoint if we added one, 
    // or let the plugin manager handle it.
    // For now, let's use the matchSnapshot API via plugin-manager instance logic 
    // but the frontend doesn't have direct access to plugin instances.
    // We should have added a specific API endpoint.
    
    // I added /api/match-snapshot/list in my thought process but didn't actually implement it in WebServer.
    // Let me fix that.
    const data = await apiGet<any[]>("/api/match-snapshot/list");
    snapshots.value = data || [];
  } catch (e) {
    ui.pushToast({ title: "加载失败", message: String(e), tone: "error" });
  } finally {
    loading.value = false;
  }
}

async function handleManualSnapshot() {
  busy.value = true;
  try {
    await apiPost("/api/match-snapshot/capture", {});
    ui.pushToast({ title: "快照已捕获", message: "数据已保存至服务器", tone: "ok" });
    await loadList();
  } catch (e) {
    ui.pushToast({ title: "捕获失败", message: String(e), tone: "error" });
  } finally {
    busy.value = false;
  }
}

function viewJson(id: string) {
  window.open(`/api/match-snapshot/view?id=${encodeURIComponent(id)}`);
}

onMounted(loadList);
</script>

<style scoped>
.page {
  display: grid;
  gap: var(--spacing-lg);
  padding: var(--spacing-lg);
}

.table-container {
  overflow-x: auto;
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
}

.data-table th {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
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
  border: none;
  color: #fff;
}

.action-btn.sm {
  padding: 4px 8px;
  font-size: 11px;
}

.text-center { text-align: center; }
</style>
