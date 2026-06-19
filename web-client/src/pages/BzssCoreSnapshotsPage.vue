<template>
  <section class="bzss-page">
    <header class="page-hero">
      <div>
        <h1>BZSS-Core 玩家快照</h1>
        <p>这里展示 `PBI.sav` 当前监控状态，以及本轮在 `BZSS-Marked` 后完成解析的全部玩家数据。</p>
      </div>
      <div class="hero-actions">
        <button type="button" class="refresh-btn" :disabled="loading" @click="fetchData">
          {{ loading ? "刷新中..." : "立即刷新" }}
        </button>
      </div>
    </header>

    <div v-if="error" class="error-banner">
      {{ error }}
    </div>

    <section class="status-grid">
      <article class="status-card">
        <span class="status-label">状态</span>
        <strong :data-status="payload?.status || 'idle'" class="status-value">{{ statusLabel }}</strong>
        <small>{{ statusDetail }}</small>
      </article>
      <article class="status-card">
        <span class="status-label">已解析玩家</span>
        <strong class="status-value">{{ players.length }}</strong>
        <small>仅统计本轮完整写入后数据</small>
      </article>
      <article class="status-card">
        <span class="status-label">文件大小</span>
        <strong class="status-value">{{ formatBytes(payload?.state?.fileSize ?? 0) }}</strong>
        <small>{{ formatDateTime(payload?.state?.lastReadAt) }}</small>
      </article>
      <article class="status-card status-card--wide">
        <span class="status-label">监控文件</span>
        <strong class="status-value status-path">{{ payload?.state?.resolvedPath || "--" }}</strong>
        <small>Configured: {{ payload?.state?.configuredPath || "--" }}</small>
      </article>
    </section>

    <section class="toolbar">
      <input
        v-model.trim="query"
        class="search-input"
        type="text"
        placeholder="搜索玩家名 / GUID / 兵种 / 武器"
      />
      <label class="toggle">
        <input v-model="showRaw" type="checkbox" />
        <span>显示原始块</span>
      </label>
    </section>

    <section v-if="filteredPlayers.length > 0" class="player-list">
      <article v-for="player in filteredPlayers" :key="player.playerGuid || player.playerName" class="player-card">
        <header class="player-head">
          <div>
            <h2>{{ player.playerName || "Unknown" }}</h2>
            <p class="mono">{{ player.playerGuid || "--" }}</p>
          </div>
          <div class="head-badges">
            <span class="badge">T{{ player.teamId ?? "--" }}</span>
            <span class="badge">S{{ player.squadId ?? "--" }}</span>
            <span class="badge health">HP {{ player.soldierInfo?.health ?? "--" }}</span>
          </div>
        </header>

        <div class="player-grid">
          <div class="field">
            <span>兵种</span>
            <strong class="mono">{{ player.soldierInfo?.soldierClass || "--" }}</strong>
          </div>
          <div class="field">
            <span>武器</span>
            <strong class="mono">{{ player.soldierInfo?.weaponClass || "--" }}</strong>
          </div>
          <div class="field">
            <span>弹药/数值</span>
            <strong class="mono">{{ formatNumberList(player.soldierInfo?.ammoValues ?? []) }}</strong>
          </div>
          <div class="field">
            <span>记分板</span>
            <strong class="mono">{{ formatNumberList(compactScoreboard(player.playerScoreboard?.numericValues)) }}</strong>
          </div>
          <div class="field field--wide">
            <span>坐标</span>
            <strong class="mono">{{ formatVector(player.soldierInfo?.position) }}</strong>
          </div>
          <div class="field field--wide">
            <span>朝向</span>
            <strong class="mono">{{ formatVector(player.soldierInfo?.rotation) }}</strong>
          </div>
        </div>

        <details v-if="showRaw" class="raw-wrap">
          <summary>查看原始解析块</summary>
          <pre>{{ player.rawText }}</pre>
        </details>
      </article>
    </section>

    <section v-else class="empty-state">
      <strong>当前还没有可展示的玩家数据。</strong>
      <p>如果服务端正在写文件，页面会在检测到 `BZSS-Marked` 后自动更新这一轮完整快照。</p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from "vue";
import { fetchBzssCorePlayerInfoList, type BzssCorePlayerInfoResponse, type BzssCoreTrackedPlayerInfo } from "../app/bzssCoreApi";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";

const payload = ref<BzssCorePlayerInfoResponse | null>(null);
const loading = ref(false);
const error = ref("");
const query = ref("");
const showRaw = ref(false);
const active = ref(true);
let timer: number | null = null;

const players = computed(() => payload.value?.players ?? []);
const filteredPlayers = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return players.value;
  return players.value.filter((player) => {
    return [
      player.playerName,
      player.playerGuid,
      player.soldierInfo?.soldierClass,
      player.soldierInfo?.weaponClass,
    ].some((value) => String(value ?? "").toLowerCase().includes(needle));
  });
});

const statusLabel = computed(() => {
  const status = String(payload.value?.status ?? "").trim();
  if (status === "ready") return "已完成";
  if (status === "writing") return "写入中";
  if (status === "waiting") return "等待下一轮";
  if (status === "missing") return "文件不存在";
  if (status === "unconfigured") return "未配置路径";
  if (status === "error") return "读取失败";
  return "空闲";
});

const statusDetail = computed(() => {
  const state = payload.value?.state;
  if (!state) return "--";
  if (state.lastError) return state.lastError;
  if (state.lastCompletedAt) return `最后完成: ${formatDateTime(state.lastCompletedAt)}`;
  if (state.lastReadAt) return `最后读取: ${formatDateTime(state.lastReadAt)}`;
  return "--";
});

async function fetchData() {
  if (!active.value) return;
  loading.value = true;
  error.value = "";
  try {
    payload.value = await fetchBzssCorePlayerInfoList();
  } catch (err: any) {
    error.value = err?.message ?? "加载 BZSS-Core 玩家快照失败。";
  } finally {
    loading.value = false;
  }
}

function scheduleRefresh() {
  clearRefresh();
  timer = window.setTimeout(async () => {
    if (active.value && canAutoRefreshNow()) {
      await fetchData();
    }
    scheduleRefresh();
  }, 100);
}

function clearRefresh() {
  if (timer != null) {
    window.clearTimeout(timer);
    timer = null;
  }
}

function formatDateTime(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function formatVector(vector: BzssCoreTrackedPlayerInfo["soldierInfo"]["position"]) {
  if (!vector) return "--";
  return `X=${vector.x ?? "?"}  Y=${vector.y ?? "?"}  Z=${vector.z ?? "?"}`;
}

function compactScoreboard(values: Array<number | null> | undefined) {
  return (values ?? []).filter((value) => value != null) as number[];
}

function formatNumberList(values: number[]) {
  return values.length > 0 ? values.join(" / ") : "--";
}

onMounted(async () => {
  await fetchData();
  scheduleRefresh();
});

onActivated(() => {
  active.value = true;
  scheduleRefresh();
});

onDeactivated(() => {
  active.value = false;
  clearRefresh();
});

onBeforeUnmount(() => {
  active.value = false;
  clearRefresh();
});
</script>

<style scoped>
.bzss-page {
  min-height: 100%;
  padding: 24px;
  background:
    radial-gradient(circle at top left, rgba(34, 197, 94, 0.12), transparent 26%),
    radial-gradient(circle at top right, rgba(14, 165, 233, 0.14), transparent 28%),
    linear-gradient(180deg, #08111f 0%, #0f172a 100%);
  color: #e2e8f0;
}

.page-hero {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 18px;
}

.page-hero h1 {
  margin: 0 0 6px;
  font-size: 30px;
  line-height: 1.1;
}

.page-hero p {
  margin: 0;
  max-width: 820px;
  color: #94a3b8;
}

.refresh-btn {
  border: 0;
  border-radius: 999px;
  padding: 10px 16px;
  font-weight: 700;
  color: #08111f;
  background: linear-gradient(135deg, #38bdf8, #86efac);
  cursor: pointer;
}

.refresh-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.error-banner {
  margin-bottom: 14px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(248, 113, 113, 0.35);
  background: rgba(127, 29, 29, 0.28);
  color: #fecaca;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.status-card {
  padding: 14px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(15, 23, 42, 0.78);
  backdrop-filter: blur(10px);
}

.status-card--wide {
  grid-column: span 2;
}

.status-label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: #94a3b8;
}

.status-value {
  display: block;
  margin-bottom: 6px;
  font-size: 20px;
  color: #f8fafc;
}

.status-value[data-status="ready"] {
  color: #86efac;
}

.status-value[data-status="writing"] {
  color: #facc15;
}

.status-value[data-status="error"],
.status-value[data-status="missing"] {
  color: #fca5a5;
}

.status-card small {
  color: #94a3b8;
}

.status-path {
  font-size: 15px;
  word-break: break-all;
}

.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
}

.search-input {
  flex: 1;
  min-width: 0;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  padding: 12px 14px;
  background: rgba(15, 23, 42, 0.72);
  color: #e2e8f0;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #cbd5e1;
}

.player-list {
  display: grid;
  gap: 14px;
}

.player-card {
  padding: 16px;
  border-radius: 18px;
  border: 1px solid rgba(56, 189, 248, 0.14);
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(2, 6, 23, 0.92));
  box-shadow: 0 18px 36px rgba(2, 6, 23, 0.22);
}

.player-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 14px;
}

.player-head h2 {
  margin: 0 0 4px;
  font-size: 22px;
}

.mono {
  font-family: "Consolas", "SFMono-Regular", monospace;
}

.head-badges {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.badge {
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.14);
  color: #bfdbfe;
  font-size: 12px;
  font-weight: 700;
}

.badge.health {
  background: rgba(34, 197, 94, 0.14);
  color: #bbf7d0;
}

.player-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.field {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(148, 163, 184, 0.08);
}

.field--wide {
  grid-column: 1 / -1;
}

.field span {
  display: block;
  margin-bottom: 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #94a3b8;
}

.field strong {
  overflow-wrap: anywhere;
}

.raw-wrap {
  margin-top: 14px;
}

.raw-wrap summary {
  cursor: pointer;
  color: #7dd3fc;
}

.raw-wrap pre {
  margin: 10px 0 0;
  padding: 12px;
  border-radius: 12px;
  overflow: auto;
  background: rgba(2, 6, 23, 0.8);
  color: #a7f3d0;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-state {
  padding: 24px;
  border-radius: 18px;
  border: 1px dashed rgba(148, 163, 184, 0.28);
  background: rgba(15, 23, 42, 0.55);
  color: #cbd5e1;
}

.empty-state p {
  margin: 8px 0 0;
  color: #94a3b8;
}

@media (max-width: 1100px) {
  .status-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 780px) {
  .bzss-page {
    padding: 16px;
  }

  .page-hero,
  .toolbar,
  .player-head {
    flex-direction: column;
  }

  .status-grid,
  .player-grid {
    grid-template-columns: 1fr;
  }

  .status-card--wide,
  .field--wide {
    grid-column: auto;
  }
}
</style>
