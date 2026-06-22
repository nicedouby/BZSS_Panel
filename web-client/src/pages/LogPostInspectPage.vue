<template>
  <section class="logpost-page">
    <div class="page-header">
      <div>
        <h1>LogPost 审计面</h1>
        <p>同时检查原始日志、结构化事件和 source_seq 缺口，不再只看解析结果。</p>
      </div>
      <div class="header-actions">
        <input v-model="filters.date" type="date">
        <button type="button" @click="reload" :disabled="loading">{{ loading ? "刷新中..." : "刷新" }}</button>
      </div>
    </div>

    <div class="summary-grid">
      <article class="summary-card">
        <span>最近 source_seq</span>
        <strong>{{ state.gaps.lastSourceSeq || 0 }}</strong>
      </article>
      <article class="summary-card danger">
        <span>缺口记录</span>
        <strong>{{ state.gaps.recentGaps.length }}</strong>
      </article>
      <article class="summary-card">
        <span>Tailer Offset</span>
        <strong>{{ state.tailerState.offset || 0 }}</strong>
      </article>
      <article class="summary-card">
        <span>Tailer Seq</span>
        <strong>{{ state.tailerState.seq || 0 }}</strong>
      </article>
    </div>

    <div class="toolbar">
      <div class="tab-row">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="tab-btn"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>
      <input v-model.trim="filters.q" type="text" placeholder="搜索 raw / hash / event / seq">
      <input v-model="filters.start" type="datetime-local">
      <input v-model="filters.end" type="datetime-local">
      <input v-if="activeTab === 'events'" v-model.trim="filters.event" type="text" placeholder="Event 名称">
    </div>

    <p v-if="error" class="error-banner">{{ error }}</p>

    <div v-if="activeTab === 'gaps'" class="panel">
      <div class="panel-head">
        <h2>缺口检测</h2>
      </div>
      <div v-if="!state.gaps.recentGaps.length" class="empty">当前没有记录到 `LOGPOST_GAP_DETECTED`。</div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>期望</th>
              <th>实际</th>
              <th>前一事件</th>
              <th>当前事件</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in state.gaps.recentGaps" :key="`${item.time}-${item.payload?.actualSourceSeq}`">
              <td>{{ formatDate(item.time) }}</td>
              <td>{{ item.payload?.expectedSourceSeq }}</td>
              <td>{{ item.payload?.actualSourceSeq }}</td>
              <td class="mono">{{ item.payload?.previousEventId || "--" }}</td>
              <td class="mono">{{ item.payload?.currentEventId || "--" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-else class="panel">
      <div class="panel-head">
        <h2>{{ activeTab === "raw" ? "原始日志" : "结构化事件" }}</h2>
        <div class="panel-meta">
          <span>总计 {{ currentData.total }}</span>
          <span>偏移 {{ currentOffset }}</span>
        </div>
      </div>
      <div class="pager">
        <button type="button" @click="prevPage" :disabled="currentOffset <= 0">上一页</button>
        <button type="button" @click="nextPage" :disabled="currentOffset + pageSize >= currentData.total">下一页</button>
      </div>
      <div v-if="!currentData.items.length" class="empty">没有命中记录。</div>
      <div v-else class="table-wrap">
        <table v-if="activeTab === 'raw'">
          <thead>
            <tr>
              <th>seq</th>
              <th>offset</th>
              <th>readAt</th>
              <th>logTime</th>
              <th>rawLineHash</th>
              <th>rawLine</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in state.raw.items" :key="`${item.seq}-${item.offset}`">
              <td>{{ item.seq }}</td>
              <td>{{ item.offset }}</td>
              <td>{{ formatDate(item.readAt) }}</td>
              <td>{{ item.logTime || "--" }}</td>
              <td class="mono">{{ item.rawLineHash }}</td>
              <td class="mono">{{ item.rawLine }}</td>
            </tr>
          </tbody>
        </table>
        <table v-else>
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>SourceSeq</th>
              <th>SourceOffset</th>
              <th>RawLineHash</th>
              <th>Raw</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in state.events.items" :key="`${item.Time}-${item.Event}-${item.SourceSeq}`">
              <td>{{ formatDate(item.Time) }}</td>
              <td>{{ item.Event }}</td>
              <td>{{ item.SourceSeq || "--" }}</td>
              <td>{{ item.SourceOffset || "--" }}</td>
              <td class="mono">{{ item.RawLineHash || "--" }}</td>
              <td class="mono">{{ item.Raw || "--" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";

type GapState = {
  lastSourceSeq: number;
  lastEventId: string;
  recentGaps: Array<Record<string, any>>;
};

type QueryResult = {
  total: number;
  limit: number;
  offset: number;
  items: Array<Record<string, any>>;
};

const pageSize = 100;
const tabs = [
  { id: "raw", label: "原始日志" },
  { id: "events", label: "结构化事件" },
  { id: "gaps", label: "缺口检测" },
];

const activeTab = ref("raw");
const loading = ref(false);
const error = ref("");
const state = reactive<{
  tailerState: Record<string, any>;
  gaps: GapState;
  raw: QueryResult;
  events: QueryResult;
}>({
  tailerState: {},
  gaps: { lastSourceSeq: 0, lastEventId: "", recentGaps: [] },
  raw: { total: 0, limit: pageSize, offset: 0, items: [] },
  events: { total: 0, limit: pageSize, offset: 0, items: [] },
});

const filters = reactive({
  date: new Date().toISOString().slice(0, 10),
  q: "",
  start: "",
  end: "",
  event: "",
});

const rawOffset = ref(0);
const eventOffset = ref(0);

const currentData = computed(() => (activeTab.value === "raw" ? state.raw : state.events));
const currentOffset = computed(() => (activeTab.value === "raw" ? rawOffset.value : eventOffset.value));

watch(
  () => [activeTab.value, filters.date, filters.q, filters.start, filters.end, filters.event],
  () => {
    if (activeTab.value === "raw") rawOffset.value = 0;
    if (activeTab.value === "events") eventOffset.value = 0;
    void reload();
  },
);

async function reload() {
  loading.value = true;
  error.value = "";
  try {
    const [stateRes, gapRes] = await Promise.all([
      fetchJson("/api/logpost/state"),
      fetchJson("/api/logpost/gaps"),
    ]);
    state.tailerState = stateRes.tailerState ?? {};
    state.gaps = gapRes ?? stateRes.gapState ?? state.gaps;

    if (activeTab.value === "raw") {
      state.raw = await fetchJson(buildRawUrl());
    } else if (activeTab.value === "events") {
      state.events = await fetchJson(buildEventsUrl());
    }
  } catch (err: any) {
    error.value = err?.message || "加载失败";
  } finally {
    loading.value = false;
  }
}

function buildRawUrl() {
  const params = new URLSearchParams({
    date: filters.date,
    q: filters.q,
    limit: String(pageSize),
    offset: String(rawOffset.value),
  });
  if (filters.start) params.set("start", new Date(filters.start).toISOString());
  if (filters.end) params.set("end", new Date(filters.end).toISOString());
  return `/api/logpost/raw?${params.toString()}`;
}

function buildEventsUrl() {
  const params = new URLSearchParams({
    date: filters.date,
    q: filters.q,
    event: filters.event,
    limit: String(pageSize),
    offset: String(eventOffset.value),
  });
  if (filters.start) params.set("start", new Date(filters.start).toISOString());
  if (filters.end) params.set("end", new Date(filters.end).toISOString());
  return `/api/logpost/events?${params.toString()}`;
}

function prevPage() {
  if (activeTab.value === "raw") {
    rawOffset.value = Math.max(0, rawOffset.value - pageSize);
  } else if (activeTab.value === "events") {
    eventOffset.value = Math.max(0, eventOffset.value - pageSize);
  }
  void reload();
}

function nextPage() {
  if (activeTab.value === "raw") {
    rawOffset.value += pageSize;
  } else if (activeTab.value === "events") {
    eventOffset.value += pageSize;
  }
  void reload();
}

function formatDate(value: unknown) {
  const text = String(value ?? "");
  if (!text) return "--";
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString("zh-CN") : text;
}

async function fetchJson(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

onMounted(() => {
  void reload();
});
</script>

<style scoped>
.logpost-page {
  padding: 20px;
  display: grid;
  gap: 16px;
}

.page-header,
.toolbar,
.panel-head,
.pager,
.summary-grid {
  display: flex;
  gap: 12px;
}

.page-header,
.panel-head {
  justify-content: space-between;
  align-items: flex-start;
}

.header-actions,
.tab-row,
.pager {
  display: flex;
  gap: 8px;
  align-items: center;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.summary-card,
.panel {
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  background: var(--color-bg-card);
}

.summary-card {
  padding: 14px;
}

.summary-card span,
.panel-meta {
  color: var(--color-text-muted);
  font-size: 12px;
}

.summary-card strong {
  display: block;
  margin-top: 6px;
  font-size: 18px;
}

.summary-card.danger strong {
  color: #d9485f;
}

.toolbar {
  flex-wrap: wrap;
}

.toolbar input,
.toolbar button,
.tab-btn {
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  border-radius: 8px;
  padding: 8px 10px;
}

.tab-btn.active {
  background: #17324d;
  border-color: #2d7ff9;
}

.panel {
  padding: 14px;
}

.table-wrap {
  overflow: auto;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

th,
td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid var(--color-border-soft);
  vertical-align: top;
}

th {
  position: sticky;
  top: 0;
  background: var(--color-bg-elevated);
}

.mono {
  font-family: Consolas, "SFMono-Regular", monospace;
  word-break: break-all;
}

.empty,
.error-banner {
  color: var(--color-text-muted);
  padding: 12px 0;
}

.error-banner {
  color: #d9485f;
}

@media (max-width: 1100px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
