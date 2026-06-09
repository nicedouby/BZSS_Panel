<template>
  <section class="page lianban-kick-page">
    <PageHeader
      eyebrow="Plugin"
      title="联办踢出"
      subtitle="查看联办名单是否已加载、当前扫描状态，以及最近自动踢出记录。这个页面只读，不修改名单文件。"
    >
      <template #actions>
        <div class="header-actions">
          <span class="status-pill" :data-tone="statusTone">{{ statusLabel }}</span>
          <button type="button" class="ghost-btn" :disabled="loading" @click="refreshState">
            {{ loading ? "刷新中..." : "刷新" }}
          </button>
        </div>
      </template>
    </PageHeader>

    <div v-if="error" class="banner error">{{ error }}</div>

    <div class="summary-grid">
      <article class="summary-card">
        <span>插件状态</span>
        <strong>{{ statusLabel }}</strong>
        <em>{{ state?.subscribed ? "已订阅" : "未订阅" }}</em>
      </article>
      <article class="summary-card">
        <span>联办条目</span>
        <strong>{{ state?.entries ?? 0 }}</strong>
        <em>{{ state?.files?.length ?? 0 }} 个文件</em>
      </article>
      <article class="summary-card">
        <span>最近扫描人数</span>
        <strong>{{ state?.playersScanned ?? 0 }}</strong>
        <em>{{ formatTime(state?.lastScanAt) }}</em>
      </article>
      <article class="summary-card">
        <span>成功踢出</span>
        <strong>{{ state?.kickSuccess ?? 0 }}</strong>
        <em>失败 {{ state?.kickFailed ?? 0 }} 次</em>
      </article>
    </div>

    <div class="content-grid">
      <PageCard title="当前状态" description="确认插件是否真正运行，以及当前读取的名单目录和最近一次动作。">
        <dl class="detail-grid">
          <div>
            <dt>启用</dt>
            <dd>{{ yesNo(state?.enabled) }}</dd>
          </div>
          <div>
            <dt>订阅</dt>
            <dd>{{ yesNo(state?.subscribed) }}</dd>
          </div>
          <div>
            <dt>名单目录</dt>
            <dd>{{ state?.directory || "-" }}</dd>
          </div>
          <div>
            <dt>名单缓存</dt>
            <dd>{{ formatDuration(state?.cacheMs) }}</dd>
          </div>
          <div>
            <dt>失败冷却</dt>
            <dd>{{ formatDuration(state?.retryCooldownMs) }}</dd>
          </div>
          <div>
            <dt>最近加载</dt>
            <dd>{{ formatTime(state?.lastLoadedAt) }}</dd>
          </div>
          <div>
            <dt>最近踢出</dt>
            <dd>{{ formatTime(state?.lastKickAt) }}</dd>
          </div>
          <div>
            <dt>最后错误</dt>
            <dd class="error-text">{{ state?.lastError || "-" }}</dd>
          </div>
        </dl>

        <div class="last-match">
          <h3>最近命中</h3>
          <p v-if="!state?.lastMatch" class="empty-state">还没有命中记录。</p>
          <dl v-else class="detail-grid">
            <div>
              <dt>玩家</dt>
              <dd>{{ state.lastMatch.playerName || "-" }}</dd>
            </div>
            <div>
              <dt>SteamID</dt>
              <dd>{{ state.lastMatch.steamID || "-" }}</dd>
            </div>
            <div>
              <dt>EOSID</dt>
              <dd>{{ state.lastMatch.eosID || "-" }}</dd>
            </div>
            <div>
              <dt>匹配方式</dt>
              <dd>{{ state.lastMatch.matchType || "-" }}</dd>
            </div>
            <div>
              <dt>匹配值</dt>
              <dd>{{ state.lastMatch.matchValue || "-" }}</dd>
            </div>
            <div>
              <dt>时间</dt>
              <dd>{{ formatTime(state.lastMatch.at) }}</dd>
            </div>
          </dl>
        </div>
      </PageCard>

      <PageCard title="名单文件" description="这里只显示当前已加载的文件名，具体内容仍以联办目录中的文件为准。">
        <p v-if="!state?.files?.length" class="empty-state">当前没有读取到名单文件。</p>
        <ul v-else class="file-list">
          <li v-for="file in state.files" :key="file">{{ file }}</li>
        </ul>
      </PageCard>
    </div>

    <PageCard title="最近事件" description="用于快速确认这个插件到底有没有在工作。">
      <p v-if="!state?.recentEvents?.length" class="empty-state">当前没有事件记录。</p>
      <div v-else class="event-list">
        <article v-for="event in state.recentEvents" :key="event.id" class="event-item">
          <div class="event-item__head">
            <strong>{{ event.kind }}</strong>
            <span>{{ formatTime(event.at) }}</span>
          </div>
          <dl class="event-item__grid">
            <div v-if="event.playerName">
              <dt>玩家</dt>
              <dd>{{ event.playerName }}</dd>
            </div>
            <div v-if="event.steamID">
              <dt>SteamID</dt>
              <dd>{{ event.steamID }}</dd>
            </div>
            <div v-if="event.eosID">
              <dt>EOSID</dt>
              <dd>{{ event.eosID }}</dd>
            </div>
            <div v-if="event.matchType">
              <dt>匹配</dt>
              <dd>{{ event.matchType }}</dd>
            </div>
            <div v-if="event.playersScanned != null">
              <dt>扫描人数</dt>
              <dd>{{ event.playersScanned }}</dd>
            </div>
            <div v-if="event.entries != null">
              <dt>条目数</dt>
              <dd>{{ event.entries }}</dd>
            </div>
            <div v-if="event.error">
              <dt>错误</dt>
              <dd class="error-text">{{ event.error }}</dd>
            </div>
          </dl>
        </article>
      </div>
    </PageCard>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { apiGet } from "../app/apiClient";
import PageCard from "../components/common/PageCard.vue";
import PageHeader from "../components/common/PageHeader.vue";

type LianbanEvent = {
  id: string;
  kind: string;
  at: string;
  playerName?: string;
  steamID?: string;
  eosID?: string;
  matchType?: string;
  playersScanned?: number;
  entries?: number;
  error?: string;
};

type LianbanState = {
  enabled: boolean;
  subscribed: boolean;
  directory: string;
  cacheMs: number;
  retryCooldownMs: number;
  lastLoadedAt: string;
  lastScanAt: string;
  lastKickAt: string;
  lastError: string;
  files: string[];
  entries: number;
  playersScanned: number;
  kickAttempts: number;
  kickSuccess: number;
  kickFailed: number;
  lastMatch: Record<string, string> | null;
  recentEvents: LianbanEvent[];
};

const state = ref<LianbanState | null>(null);
const error = ref("");
const loading = ref(false);
let refreshTimer: number | null = null;

const statusLabel = computed(() => {
  if (!state.value) return "未加载";
  if (!state.value.enabled) return "已停用";
  if (!state.value.subscribed) return "未订阅";
  return "运行中";
});

const statusTone = computed(() => {
  if (!state.value) return "muted";
  if (!state.value.enabled || !state.value.subscribed) return "warning";
  return state.value.lastError ? "danger" : "ok";
});

async function refreshState() {
  loading.value = true;
  try {
    const response = await apiGet<{ ok: boolean; data: LianbanState | null }>("/api/plugins/lianban-kick/state");
    state.value = response?.data ?? null;
    error.value = "";
  } catch (err: any) {
    error.value = err?.message || "加载联办踢出状态失败";
  } finally {
    loading.value = false;
  }
}

function formatTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDuration(value?: number) {
  const ms = Number(value ?? 0) || 0;
  if (!ms) return "0 ms";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} s`;
}

function yesNo(value?: boolean) {
  return value ? "是" : "否";
}

onMounted(() => {
  void refreshState();
  refreshTimer = window.setInterval(() => {
    void refreshState();
  }, 5000);
});

onBeforeUnmount(() => {
  if (refreshTimer != null) {
    window.clearInterval(refreshTimer);
  }
});
</script>

<style scoped>
.lianban-kick-page {
  display: grid;
  gap: 16px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--color-border-default);
}

.status-pill[data-tone="ok"] {
  color: var(--color-status-success);
}

.status-pill[data-tone="warning"] {
  color: var(--color-status-warning);
}

.status-pill[data-tone="danger"] {
  color: var(--color-status-danger);
}

.status-pill[data-tone="muted"] {
  color: var(--color-text-muted);
}

.banner {
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--color-border-default);
}

.banner.error {
  color: var(--color-status-danger);
  background: rgba(239, 68, 68, 0.08);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.summary-card {
  display: grid;
  gap: 8px;
  padding: 16px;
  border-radius: 16px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-card);
}

.summary-card span,
.summary-card em {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-style: normal;
}

.summary-card strong {
  font-size: 28px;
  line-height: 1;
}

.content-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 16px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.detail-grid dt,
.event-item__grid dt {
  color: var(--color-text-muted);
  font-size: 12px;
  margin-bottom: 4px;
}

.detail-grid dd,
.event-item__grid dd {
  margin: 0;
  word-break: break-all;
}

.last-match {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--color-border-default);
}

.last-match h3 {
  margin: 0 0 10px;
  font-size: 14px;
}

.file-list {
  margin: 0;
  padding-left: 18px;
}

.file-list li + li {
  margin-top: 8px;
}

.event-list {
  display: grid;
  gap: 12px;
}

.event-item {
  border: 1px solid var(--color-border-default);
  border-radius: 14px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.02);
}

.event-item__head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.event-item__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.empty-state {
  color: var(--color-text-muted);
  margin: 0;
}

.error-text {
  color: var(--color-status-danger);
}

@media (max-width: 900px) {
  .summary-grid,
  .content-grid,
  .detail-grid,
  .event-item__grid {
    grid-template-columns: 1fr;
  }
}
</style>
