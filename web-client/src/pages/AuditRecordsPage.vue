<template>
  <AppPage class="audit-records-page" full-bleed>
        <h1 class="sr-only">操作记录</h1>

    <WorkspaceToolbar>
      <div class="toolbar-status">
        <AppStatusBadge v-for="item in statusItems" :key="item.label" :tone="item.tone ?? 'idle'">
          {{ item.label }}
        </AppStatusBadge>
      </div>

      <template #actions>
        <button class="toolbar-button" type="button" :disabled="loading" @click="fetchRecords">
          刷新
        </button>
      </template>
    </WorkspaceToolbar><section class="filter-bar" aria-label="审计筛选">
      <label>
        <span>操作人</span>
        <input v-model.trim="filters.actor" type="search" placeholder="username" @keyup.enter="fetchRecords" />
      </label>
      <label>
        <span>操作类型</span>
        <select v-model="filters.action" @change="fetchRecords">
          <option value="">全部</option>
          <option v-for="action in actionOptions" :key="action" :value="action">{{ action }}</option>
        </select>
      </label>
      <label>
        <span>结果</span>
        <select v-model="filters.result" @change="fetchRecords">
          <option value="">全部</option>
          <option v-for="result in resultOptions" :key="result" :value="result">{{ resultLabel(result) }}</option>
        </select>
      </label>
      <label>
        <span>玩家</span>
        <input v-model.trim="filters.playerName" type="search" placeholder="名称" @keyup.enter="fetchRecords" />
      </label>
      <label>
        <span>SteamID</span>
        <input v-model.trim="filters.steamId" type="search" placeholder="7656..." @keyup.enter="fetchRecords" />
      </label>
      <label>
        <span>IP</span>
        <input v-model.trim="filters.clientIp" type="search" placeholder="client ip" @keyup.enter="fetchRecords" />
      </label>
      <label>
        <span>Request ID</span>
        <input v-model.trim="filters.requestId" type="search" placeholder="audit_..." @keyup.enter="fetchRecords" />
      </label>
      <button class="toolbar-button primary" type="button" :disabled="loading" @click="fetchRecords">
        查询
      </button>
    </section>

    <section class="table-region">
      <AppTable compact>
        <thead>
          <tr>
            <th>时间</th>
            <th>操作人</th>
            <th>操作</th>
            <th>目标</th>
            <th>位置</th>
            <th>服务器</th>
            <th>IP</th>
            <th>结果</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="8" class="empty-cell">加载中</td>
          </tr>
          <tr v-else-if="errorMessage">
            <td colspan="8" class="empty-cell danger">{{ errorMessage }}</td>
          </tr>
          <tr v-else-if="!records.length">
            <td colspan="8" class="empty-cell">暂无操作记录</td>
          </tr>
          <template v-else>
            <tr
              v-for="record in records"
              :key="record.id"
              class="record-row"
              @click="selected = record"
            >
              <td>{{ formatTime(record.createdAtMs) }}</td>
              <td>
                <strong>{{ record.actorUsername || "unknown" }}</strong>
                <small>{{ record.actorRole || record.actorType }}</small>
              </td>
              <td>{{ actionLabel(record.action) }}</td>
              <td>{{ targetLabel(record) }}</td>
              <td>{{ sourcePageLabel(record.sourcePage) }}</td>
              <td>{{ record.serverName || record.serverId || "-" }}</td>
              <td>{{ record.clientIp || "-" }}</td>
              <td>
                <span class="result-pill" :data-result="record.result">{{ resultLabel(record.result) }}</span>
              </td>
            </tr>
          </template>
        </tbody>
      </AppTable>
    </section>

    <div v-if="selected" class="detail-backdrop" @click.self="selected = null">
      <aside class="detail-drawer" role="dialog" aria-modal="true">
        <header>
          <div>
            <p>操作详情</p>
            <h2>{{ actionLabel(selected.action) }}</h2>
          </div>
          <button class="icon-button" type="button" aria-label="关闭" @click="selected = null">×</button>
        </header>

        <dl class="detail-grid">
          <div><dt>Request ID</dt><dd>{{ selected.requestId }}</dd></div>
          <div><dt>请求路径</dt><dd>{{ selected.requestMethod }} {{ selected.requestRoute }}</dd></div>
          <div><dt>操作人</dt><dd>{{ selected.actorUsername }} / {{ selected.actorRole || selected.actorType }}</dd></div>
          <div><dt>权限组快照</dt><dd>{{ selected.actorGroups?.join(", ") || "-" }}</dd></div>
          <div><dt>耗时</dt><dd>{{ selected.durationMs == null ? "-" : `${selected.durationMs}ms` }}</dd></div>
          <div><dt>错误</dt><dd>{{ selected.errorCode || "-" }} {{ selected.errorMessage || "" }}</dd></div>
        </dl>

        <section class="json-panel">
          <h3>操作参数</h3>
          <pre>{{ prettyJson(selected.parameters) }}</pre>
        </section>
        <section class="json-panel">
          <h3>目标快照</h3>
          <pre>{{ prettyJson(selected.targetData) }}</pre>
        </section>
        <section class="json-panel">
          <h3>执行结果</h3>
          <pre>{{ prettyJson(selected.resultData) }}</pre>
        </section>
      </aside>
    </div>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";

import { apiGet } from "../app/apiClient";
import AppPage from "../components/common/AppPage.vue";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";
import AppStatusBadge from "../components/common/AppStatusBadge.vue";
import AppTable from "../components/common/AppTable.vue";

interface AuditRecord {
  id: number;
  requestId: string;
  action: string;
  category: string;
  actorType: string;
  actorUsername: string;
  actorRole: string;
  actorGroups: string[];
  sourcePage: string;
  requestMethod: string;
  requestRoute: string;
  clientIp: string;
  serverId: string;
  serverName: string;
  targetType: string;
  targetId: string;
  targetName: string;
  targetData: any;
  parameters: any;
  resultData: any;
  result: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAtMs: number;
  durationMs: number | null;
}

const records = ref<AuditRecord[]>([]);
const selected = ref<AuditRecord | null>(null);
const loading = ref(false);
const errorMessage = ref("");
const total = ref(0);
const filters = reactive({
  actor: "",
  action: "",
  result: "",
  playerName: "",
  steamId: "",
  clientIp: "",
  requestId: "",
});

const actionOptions = [
  "playtime.refresh.smart",
  "playtime.refresh.force",
  "player.switch_team",
  "player.warn",
  "player.remove_from_squad",
  "server.broadcast",
  "tank_battle.execute",
  "rcon.command.execute",
];

const resultOptions = ["success", "failed", "partial", "forbidden", "invalid", "accepted", "running", "cancelled"];

const statusItems = computed(() => [
  { label: `${total.value} 条`, tone: "idle" as const },
  { label: loading.value ? "同步中" : "已加载", tone: loading.value ? "warn" as const : "ok" as const },
]);

async function fetchRecords() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const query = new URLSearchParams();
    query.set("limit", "200");
    for (const [key, value] of Object.entries(filters)) {
      if (String(value).trim()) query.set(key, String(value).trim());
    }
    const response = await apiGet<{ ok: boolean; items: AuditRecord[]; total: number }>(`/api/audit/records?${query.toString()}`);
    records.value = response.items ?? [];
    total.value = Number(response.total ?? records.value.length);
  } catch (error: any) {
    errorMessage.value = error?.message ?? "加载失败";
  } finally {
    loading.value = false;
  }
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    "playtime.refresh.smart": "智能刷新玩家时长",
    "playtime.refresh.force": "强制刷新全部玩家时长",
    "player.switch_team": "玩家跳边",
    "player.warn": "警告玩家",
    "player.remove_from_squad": "移出小队",
    "server.broadcast": "全服广播",
    "tank_battle.execute": "坦克大战执行",
    "rcon.command.execute": "手动 RCON 指令",
    reserve_slot_management: "预留位管理",
  };
  return labels[action] ?? action;
}

function resultLabel(result: string) {
  const labels: Record<string, string> = {
    success: "成功",
    failed: "失败",
    partial: "部分成功",
    forbidden: "拒绝",
    invalid: "无效",
    accepted: "已接受",
    running: "执行中",
    cancelled: "已取消",
  };
  return labels[result] ?? result;
}

function sourcePageLabel(page: string) {
  const labels: Record<string, string> = {
    match_status: "对局状态",
    squad_management: "小队管理",
    playtime_management: "时长管理",
    tank_battle_dialog: "坦克大战",
    rcon_console: "RCON 控制台",
    permission_management: "权限管理",
    reserve_slot_management: "预留位管理",
  };
  return labels[page] ?? (page || "-");
}

function targetLabel(record: AuditRecord) {
  const name = record.targetName || record.targetData?.targetName || "";
  const id = record.targetId || record.targetData?.targetSteamId || record.targetData?.targetEosId || "";
  if (name && id) return `${name} / ${id}`;
  return name || id || record.targetType || "-";
}

function formatTime(value: number) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function prettyJson(value: any) {
  return JSON.stringify(value ?? null, null, 2);
}

onMounted(fetchRecords);
</script>

<style scoped>
.audit-records-page {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
}

.filter-bar {
  display: grid;
  grid-template-columns: repeat(7, minmax(120px, 1fr)) auto;
  gap: 10px;
  align-items: end;
  min-width: 0;
  padding: 12px;
  border-block: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.02);
}

.filter-bar label {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.filter-bar span {
  font-size: 11px;
  color: var(--color-text-muted);
}

.filter-bar input,
.filter-bar select {
  min-width: 0;
  height: 34px;
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  padding: 0 10px;
}

.toolbar-button,
.icon-button {
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  border-radius: 6px;
  height: 34px;
  padding: 0 12px;
  cursor: pointer;
}

.toolbar-button.primary {
  border-color: rgba(96, 165, 250, 0.45);
  background: rgba(96, 165, 250, 0.14);
}

.table-region {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
}

.record-row {
  cursor: pointer;
}

td strong,
td small {
  display: block;
}

td small {
  margin-top: 3px;
  color: var(--color-text-muted);
}

.empty-cell {
  text-align: center;
  color: var(--color-text-muted);
}

.empty-cell.danger {
  color: var(--color-status-danger);
}

.result-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border-radius: 999px;
  padding: 0 9px;
  font-size: 12px;
  border: 1px solid var(--color-border-soft);
}

.result-pill[data-result="success"] {
  color: var(--color-status-success);
  background: rgba(34, 197, 94, 0.1);
}

.result-pill[data-result="failed"],
.result-pill[data-result="forbidden"] {
  color: var(--color-status-danger);
  background: rgba(239, 68, 68, 0.1);
}

.result-pill[data-result="partial"],
.result-pill[data-result="invalid"] {
  color: var(--color-status-warning);
  background: rgba(245, 158, 11, 0.1);
}

.detail-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.48);
}

.detail-drawer {
  width: min(720px, 100vw);
  height: 100%;
  overflow: auto;
  background: var(--color-bg-panel);
  border-left: 1px solid var(--color-border-default);
  padding: 18px;
  display: grid;
  gap: 16px;
}

.detail-drawer header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.detail-drawer p,
.detail-drawer h2 {
  margin: 0;
}

.detail-drawer p {
  color: var(--color-text-muted);
  font-size: 12px;
}

.detail-drawer h2 {
  margin-top: 4px;
  font-size: 20px;
}

.icon-button {
  width: 34px;
  padding: 0;
  font-size: 20px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.detail-grid div,
.json-panel {
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.025);
  padding: 12px;
  min-width: 0;
}

.detail-grid dt {
  color: var(--color-text-muted);
  font-size: 11px;
}

.detail-grid dd {
  margin: 5px 0 0;
  overflow-wrap: anywhere;
}

.json-panel h3 {
  margin: 0 0 8px;
  font-size: 13px;
}

.json-panel pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--color-text-secondary);
  font-size: 12px;
}

@media (max-width: 1100px) {
  .filter-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .filter-bar,
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>



