<template>
  <main class="tb-page">
    <section class="tb-card tb-switch-card">
      <header class="tb-header">
        <div>
          <h1>跳边入口</h1>
          <p>统一通过 TeamBalance 模块处理手动跳边执行和记录查询。</p>
        </div>
      </header>

      <form class="tb-form" @submit.prevent="submit">
        <label>
          <span>选择玩家</span>
          <PlayerSelect
            v-model:steamId="steamId"
            v-model:playerName="playerName"
            placeholder="输入玩家名 / SteamID / EOS ID"
          />
        </label>

        <div v-if="playerName || steamId" class="tb-selection-preview">
          <div v-if="playerName">已选玩家 <strong>{{ playerName }}</strong></div>
          <div v-if="steamId">SteamID: <strong class="mono">{{ steamId }}</strong></div>
        </div>

        <button :disabled="submitting || !steamId">
          {{ submitting ? "执行中..." : "执行跳边" }}
        </button>
      </form>

      <pre v-if="result" class="tb-result">{{ result }}</pre>
      <p v-if="error" class="tb-error">{{ error }}</p>
    </section>

    <section class="tb-card tb-records-card">
      <header class="tb-header">
        <div>
          <h2>跳边记录</h2>
          <p>这里显示实际跳边的审计记录。</p>
        </div>
        <button type="button" class="tb-secondary-button" :disabled="loadingRecords" @click="loadRecords">
          {{ loadingRecords ? "刷新中..." : "刷新记录" }}
        </button>
      </header>

      <p v-if="recordsError" class="tb-error">{{ recordsError }}</p>
      <p v-else-if="!records.length" class="tb-empty">暂无跳边记录。</p>

      <div v-else class="tb-record-list">
        <article v-for="record in records" :key="record.id" class="tb-record">
          <div class="tb-record-main">
            <strong>{{ formatRecordTitle(record) }}</strong>
            <span>{{ formatTime(record.timestamp) }}</span>
          </div>

          <div class="tb-record-meta">
            <span>类型: {{ formatRecordType(record) }}</span>
            <span>来源: {{ record.source }}</span>
            <span>执行者: {{ record.executor }}</span>
            <span>结果: {{ record.ok ? "成功" : "失败" }}</span>
          </div>

          <div class="tb-record-detail">
            <span v-if="record.playerName">玩家: {{ record.playerName }}</span>
            <span v-if="record.reason">原因: {{ record.reason }}</span>
            <span v-if="record.message">{{ record.message }}</span>
            <span v-if="record.error">错误: {{ record.error }}</span>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
import PlayerSelect from "../components/common/PlayerSelect.vue";

interface TeamBalanceRecord {
  id: string;
  timestamp: string;
  type?: string;
  action?: string;
  ok: boolean;
  steamId: string;
  playerName: string | null;
  source: string;
  reason: string;
  executor: string;
  error: string;
  message?: string;
}

const steamId = ref("");
const playerName = ref("");
const submitting = ref(false);
const result = ref("");
const error = ref("");
const records = ref<TeamBalanceRecord[]>([]);
const loadingRecords = ref(false);
const recordsError = ref("");

onMounted(() => {
  void loadRecords();
});

async function submit() {
  if (!steamId.value) return;

  submitting.value = true;
  result.value = "";
  error.value = "";

  try {
    const res = await apiPost("/api/tb/force-team-change", {
      steamId: steamId.value,
      playerName: playerName.value,
      source: "web.tb",
      reason: "manual_tb_page",
    });

    result.value = JSON.stringify(res, null, 2);
    await loadRecords();
  } catch (err: any) {
    error.value = String(err?.message || err || "跳边失败");
  } finally {
    submitting.value = false;
  }
}

async function loadRecords() {
  loadingRecords.value = true;
  recordsError.value = "";

  try {
    const res = await apiGet<{ ok?: boolean; records?: TeamBalanceRecord[] }>("/api/tb/records?limit=20");
    records.value = Array.isArray(res?.records) ? res.records : [];
  } catch (err: any) {
    recordsError.value = String(err?.message || err || "记录加载失败");
    records.value = [];
  } finally {
    loadingRecords.value = false;
  }
}

function formatTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatRecordType(record: TeamBalanceRecord) {
  return record.action || record.type || "force_team_change";
}

function formatRecordTitle(record: TeamBalanceRecord) {
  return record.steamId || record.playerName || "Unknown";
}
</script>

<style scoped>
.tb-page {
  padding: 0;
  display: grid;
  gap: 16px;
  color: var(--color-text-primary);
}

.tb-card {
  border: 1px solid var(--color-border-default);
  border-radius: 18px;
  padding: 20px;
  background: var(--theme-panel-highlight), var(--color-bg-card);
  box-shadow: var(--shadow-md), var(--theme-panel-glow);
}

.tb-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.tb-header h1,
.tb-header h2 {
  margin: 0;
  font-size: 22px;
}

.tb-header p {
  margin: 8px 0 0;
  color: var(--color-text-muted);
}

.tb-form {
  display: grid;
  gap: 14px;
  margin-top: 20px;
}

.tb-form label {
  display: grid;
  gap: 6px;
}

.tb-form input {
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--color-border-default);
  border-radius: 10px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.tb-selection-preview {
  display: grid;
  gap: 6px;
  color: var(--color-text-muted);
}

.tb-result {
  margin-top: 16px;
  padding: 12px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-bg-elevated) 86%, transparent);
  white-space: pre-wrap;
}

.tb-error {
  margin-top: 16px;
  color: #ff6b6b;
}

.tb-empty {
  margin-top: 16px;
  color: var(--color-text-muted);
}

.tb-secondary-button,
.tb-form button {
  width: fit-content;
  min-height: 40px;
  padding: 0 16px;
  border-radius: 999px;
  cursor: pointer;
}

.tb-secondary-button,
.tb-form button {
  border: 1px solid var(--color-border-default);
  background: color-mix(in srgb, var(--color-bg-elevated) 86%, transparent);
  color: var(--color-text-primary);
}

.tb-record-list {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.tb-record {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--color-border-default);
  border-radius: 14px;
  background: color-mix(in srgb, var(--color-bg-card) 90%, transparent);
}

.tb-record-main,
.tb-record-meta,
.tb-record-detail {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
}

.tb-record-main span,
.tb-record-meta span,
.tb-record-detail span {
  color: var(--color-text-muted);
}
</style>
