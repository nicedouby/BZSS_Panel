<template>
  <section class="logpost-page">
    <header class="hero">
      <div class="hero-copy">
        <p class="eyebrow">LogPost v2</p>
        <h1>日志审计面</h1>
        <p>
          只读查看原始日志、结构化事件、投递状态、安全拦截和缺口记录。
          页面默认读取 v2 目录，旧结构仅作为兼容回退。
        </p>
      </div>
      <div class="hero-metrics">
        <article>
          <span>Source Seq</span>
          <strong>{{ state.sourceState?.seq ?? state.tailerState?.seq ?? 0 }}</strong>
        </article>
        <article>
          <span>Mode</span>
          <strong>{{ state.sourceState?.mode ?? state.tailerState?.mode ?? "live" }}</strong>
        </article>
        <article>
          <span>Gap Count</span>
          <strong>{{ state.gaps.recentGaps.length }}</strong>
        </article>
        <article>
          <span>Outbox</span>
          <strong>{{ state.outbox.total }}</strong>
        </article>
      </div>
    </header>

    <section class="toolbar">
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

      <input v-model="filters.date" type="date">
      <input v-model.trim="filters.q" type="text" placeholder="搜索 raw / hash / event / id">
      <input v-model="filters.start" type="datetime-local">
      <input v-model="filters.end" type="datetime-local">
      <input v-if="activeTab === 'events'" v-model.trim="filters.event" type="text" placeholder="事件名">
      <input v-if="activeTab === 'outbox'" v-model.trim="filters.kind" type="text" placeholder="状态">
      <input v-if="activeTab === 'safety'" v-model.trim="filters.kind" type="text" placeholder="类型">
    </section>

    <p v-if="error" class="error-banner">{{ error }}</p>

    <section v-if="activeTab === 'gaps'" class="panel">
      <div class="panel-head">
        <h2>缺口 / 回放拦截</h2>
        <span class="panel-meta">包含 source seq 跳号、checkpoint 变更和 replay-only 请求</span>
      </div>
      <div v-if="!state.gaps.recentGaps.length" class="empty">暂无 gap 记录。</div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>期望</th>
              <th>实际</th>
              <th>前一事件</th>
              <th>当前事件</th>
              <th>模式</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in state.gaps.recentGaps" :key="`${item.time}-${item.payload?.actualSourceSeq}`">
              <td>{{ formatDate(item.time) }}</td>
              <td>{{ item.payload?.expectedSourceSeq ?? "--" }}</td>
              <td>{{ item.payload?.actualSourceSeq ?? "--" }}</td>
              <td class="mono">{{ item.payload?.previousEventId || "--" }}</td>
              <td class="mono">{{ item.payload?.currentEventId || "--" }}</td>
              <td>{{ item.payload?.sourceMode || "--" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else class="panel">
      <div class="panel-head">
        <h2>{{ activeTitle }}</h2>
        <span class="panel-meta">总计 {{ currentData.total }}，偏移 {{ currentOffset }}</span>
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
              <th>mode</th>
              <th>rawLineHash</th>
              <th>rawLine</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in state.raw.items" :key="`${item.seq}-${item.offset}`">
              <td>{{ item.seq }}</td>
              <td>{{ item.offset }}</td>
              <td>{{ formatDate(item.readAt) }}</td>
              <td>{{ item.sourceMode || "--" }}</td>
              <td class="mono">{{ item.rawLineHash }}</td>
              <td class="mono">{{ item.rawLine }}</td>
            </tr>
          </tbody>
        </table>

        <table v-else-if="activeTab === 'events'">
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>Mode</th>
              <th>Can Trigger</th>
              <th>SourceSeq</th>
              <th>RawLineHash</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in state.events.items" :key="`${item.EventId || item.Time}-${item.Event}`">
              <td>{{ formatDate(item.Time) }}</td>
              <td>{{ item.Event }}</td>
              <td>{{ item.SourceMode || "--" }}</td>
              <td>{{ item.CanTriggerActions || "--" }}</td>
              <td>{{ item.SourceSeq || "--" }}</td>
              <td class="mono">{{ item.RawLineHash || "--" }}</td>
            </tr>
          </tbody>
        </table>

        <table v-else-if="activeTab === 'outbox'">
          <thead>
            <tr>
              <th>Time</th>
              <th>Status</th>
              <th>Event</th>
              <th>Mode</th>
              <th>EventId</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in state.outbox.items" :key="`${item.time}-${item.eventId}-${item.status}`">
              <td>{{ formatDate(item.time) }}</td>
              <td>{{ item.status }}</td>
              <td>{{ item.eventName }}</td>
              <td>{{ item.sourceMode }}</td>
              <td class="mono">{{ item.eventId }}</td>
              <td class="mono">{{ item.error || "--" }}</td>
            </tr>
          </tbody>
        </table>

        <table v-else>
          <thead>
            <tr>
              <th>Time</th>
              <th>Kind</th>
              <th>Mode</th>
              <th>Reason</th>
              <th>EventId</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in state.safety.items" :key="`${item.time}-${item.kind}-${item.eventId}`">
              <td>{{ formatDate(item.time) }}</td>
              <td>{{ item.kind }}</td>
              <td>{{ item.sourceMode || "--" }}</td>
              <td>{{ item.reason || "--" }}</td>
              <td class="mono">{{ item.eventId || "--" }}</td>
              <td class="mono">{{ item.message || "--" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";

type QueryResult = {
  total: number;
  limit: number;
  offset: number;
  items: Array<Record<string, any>>;
};

type GapState = {
  lastSourceSeq: number;
  lastEventId: string;
  recentGaps: Array<Record<string, any>>;
};

const pageSize = 100;
const tabs = [
  { id: "raw", label: "原始日志" },
  { id: "events", label: "结构化事件" },
  { id: "outbox", label: "投递状态" },
  { id: "safety", label: "安全审计" },
  { id: "gaps", label: "缺口" },
];

const activeTab = ref("raw");
const loading = ref(false);
const error = ref("");

const state = reactive<{
  tailerState: Record<string, any>;
  sourceState: Record<string, any>;
  gaps: GapState;
  raw: QueryResult;
  events: QueryResult;
  outbox: QueryResult;
  safety: QueryResult;
}>({
  tailerState: {},
  sourceState: {},
  gaps: { lastSourceSeq: 0, lastEventId: "", recentGaps: [] },
  raw: { total: 0, limit: pageSize, offset: 0, items: [] },
  events: { total: 0, limit: pageSize, offset: 0, items: [] },
  outbox: { total: 0, limit: pageSize, offset: 0, items: [] },
  safety: { total: 0, limit: pageSize, offset: 0, items: [] },
});

const filters = reactive({
  date: new Date().toISOString().slice(0, 10),
  q: "",
  start: "",
  end: "",
  event: "",
  kind: "",
});

const rawOffset = ref(0);
const eventOffset = ref(0);
const outboxOffset = ref(0);
const safetyOffset = ref(0);

const currentData = computed(() => {
  if (activeTab.value === "raw") return state.raw;
  if (activeTab.value === "events") return state.events;
  if (activeTab.value === "outbox") return state.outbox;
  return state.safety;
});

const currentOffset = computed(() => {
  if (activeTab.value === "raw") return rawOffset.value;
  if (activeTab.value === "events") return eventOffset.value;
  if (activeTab.value === "outbox") return outboxOffset.value;
  return safetyOffset.value;
});

const activeTitle = computed(() => {
  const found = tabs.find((tab) => tab.id === activeTab.value);
  return found?.label ?? "日志";
});

watch(
  () => [activeTab.value, filters.date, filters.q, filters.start, filters.end, filters.event, filters.kind],
  () => {
    if (activeTab.value === "raw") rawOffset.value = 0;
    if (activeTab.value === "events") eventOffset.value = 0;
    if (activeTab.value === "outbox") outboxOffset.value = 0;
    if (activeTab.value === "safety") safetyOffset.value = 0;
    void reload();
  },
);

async function reload() {
  loading.value = true;
  error.value = "";
  try {
    const [stateRes, gapRes] = await Promise.all([
      fetchJson("/api/logpost/v2/state"),
      fetchJson("/api/logpost/v2/gaps"),
    ]);
    state.tailerState = stateRes.tailerState ?? {};
    state.sourceState = stateRes.sourceState ?? {};
    state.gaps = gapRes ?? stateRes.gapState ?? state.gaps;

    if (activeTab.value === "raw") {
      state.raw = await fetchJson(buildUrl("raw", rawOffset.value));
    } else if (activeTab.value === "events") {
      state.events = await fetchJson(buildUrl("events", eventOffset.value));
    } else if (activeTab.value === "outbox") {
      state.outbox = await fetchJson(buildUrl("outbox", outboxOffset.value));
    } else if (activeTab.value === "safety") {
      state.safety = await fetchJson(buildUrl("safety", safetyOffset.value));
    }
  } catch (err: any) {
    error.value = err?.message || "加载失败";
  } finally {
    loading.value = false;
  }
}

function buildUrl(kind: "raw" | "events" | "outbox" | "safety", offset: number) {
  const params = new URLSearchParams({
    date: filters.date,
    q: filters.q,
    limit: String(pageSize),
    offset: String(offset),
  });
  if (filters.start) params.set("start", new Date(filters.start).toISOString());
  if (filters.end) params.set("end", new Date(filters.end).toISOString());
  if (kind === "events") params.set("event", filters.event);
  if (kind === "outbox") params.set("kind", filters.kind);
  if (kind === "safety") params.set("kind", filters.kind);
  return `/api/logpost/v2/${kind}?${params.toString()}`;
}

function prevPage() {
  if (activeTab.value === "raw") rawOffset.value = Math.max(0, rawOffset.value - pageSize);
  else if (activeTab.value === "events") eventOffset.value = Math.max(0, eventOffset.value - pageSize);
  else if (activeTab.value === "outbox") outboxOffset.value = Math.max(0, outboxOffset.value - pageSize);
  else if (activeTab.value === "safety") safetyOffset.value = Math.max(0, safetyOffset.value - pageSize);
  void reload();
}

function nextPage() {
  if (activeTab.value === "raw") rawOffset.value += pageSize;
  else if (activeTab.value === "events") eventOffset.value += pageSize;
  else if (activeTab.value === "outbox") outboxOffset.value += pageSize;
  else if (activeTab.value === "safety") safetyOffset.value += pageSize;
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

.hero {
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  padding: 20px;
  border-radius: 20px;
  background:
    radial-gradient(circle at top left, rgba(35, 79, 149, 0.35), transparent 35%),
    linear-gradient(135deg, rgba(13, 18, 28, 0.96), rgba(22, 28, 42, 0.96));
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #f4f7fb;
}

.hero-copy h1 {
  margin: 6px 0 10px;
  font-size: 34px;
  letter-spacing: 0.02em;
}

.hero-copy p {
  margin: 0;
  max-width: 70ch;
  color: rgba(244, 247, 251, 0.8);
}

.eyebrow {
  color: #85c7ff;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 12px;
}

.hero-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.hero-metrics article,
.panel,
.toolbar {
  border: 1px solid var(--color-border-default);
  border-radius: 16px;
  background: var(--color-bg-card);
}

.hero-metrics article {
  padding: 14px;
  background: rgba(255, 255, 255, 0.04);
}

.hero-metrics span,
.panel-meta {
  color: var(--color-text-muted);
  font-size: 12px;
}

.hero-metrics strong {
  display: block;
  margin-top: 6px;
  font-size: 20px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding: 12px;
}

.toolbar input,
.toolbar button,
.tab-btn {
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  border-radius: 10px;
  padding: 8px 10px;
}

.tab-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tab-btn.active {
  background: #17324d;
  border-color: #2d7ff9;
}

.panel {
  padding: 14px;
}

.panel-head,
.pager {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.pager {
  margin: 10px 0 12px;
}

.table-wrap {
  overflow: auto;
  border: 1px solid var(--color-border-soft);
  border-radius: 12px;
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
  z-index: 1;
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

@media (max-width: 980px) {
  .hero {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .hero-metrics {
    grid-template-columns: 1fr;
  }

  .panel-head,
  .pager {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
