<template>
  <section class="page full-height">
        <h1 class="sr-only">聊天监控</h1>

    <WorkspaceToolbar class="chat-header">
      <div class="filter-group">
        <input
          v-model="filters.query"
          type="text"
          placeholder="搜索玩家名/内容..."
          class="filter-input"
        />
        <select v-model="filters.channel" class="filter-select">
          <option value="all">全部频道</option>
          <option value="ChatAll">公开</option>
          <option value="ChatTeam">阵营</option>
          <option value="ChatSquad">小队</option>
          <option value="ChatAdmin">管理</option>
        </select>
      </div>
      <template #actions>
        <StatusBadge :tone="autoScroll ? 'ok' : 'idle'" @click="autoScroll = !autoScroll">
          {{ autoScroll ? "自动滚动" : "手动滚动" }}
        </StatusBadge>
      </template>
    </WorkspaceToolbar><div class="chat-layout-main">
      <div class="chat-column-left">
        <div class="chat-dashboard-inline">
          <div class="stats-card-mini">
            <div class="card-header">60分钟活跃趋势</div>
            <div ref="chartRef" class="chart-container"></div>
          </div>
        </div>

        <main class="chat-log-area">
          <div class="chat-log-shell">
            <div v-if="filteredHistory.length === 0" class="chat-empty-state">暂无聊天记录</div>
            <RecycleScroller
              v-else
              ref="scrollerRef"
              class="chat-log"
              :items="filteredHistory"
              :item-size="36"
              key-field="seq"
              v-slot="{ item: msg }"
            >
              <article
                class="chat-line"
                :class="[`channel-${msg.channel.toLowerCase()}`]"
              >
                <span class="chat-time">{{ formatTime(msg.time) }}</span>
                <span class="chat-channel">[{{ channelLabels[msg.channel] || msg.channel }}]</span>
                <span class="chat-name" :title="`${msg.name}${msg.steamID ? ' (' + msg.steamID + ')' : ''}`">{{ msg.name }}:</span>
                <span class="chat-message">{{ msg.message }}</span>
              </article>
            </RecycleScroller>
          </div>
        </main>
      </div>

      <aside class="chat-column-right">
        <div class="sidebar-card">
          <div class="card-header">玩家发言频率 (1min)</div>
          <div class="frequency-list">
            <div v-if="playerFrequencies.length === 0" class="empty-hint">暂无活跃发言</div>
            <div
              v-for="p in playerFrequencies"
              :key="p.steamID"
              class="frequency-item"
              :class="{ high: p.count >= 5 }"
            >
              <div class="freq-info">
                <span class="p-name" :title="p.steamID">{{ p.name }}</span>
                <span class="p-count">{{ p.count }} msg/min</span>
              </div>
              <div class="freq-bar-bg">
                <div class="freq-bar-fill" :style="{ width: Math.min(100, p.count * 10) + '%' }"></div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="activeSpammers.length > 0" class="sidebar-card spammers-box">
          <div class="card-header alert">⚠️ 高频警告 (10s)</div>
          <div class="spammer-list">
            <div v-for="s in activeSpammers" :key="s.steamID" class="spammer-item">
              <strong>{{ s.name }}</strong>
              <span>{{ s.count }} msg</span>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <footer class="chat-footer">
      <div class="footer-stats">
        <span>当前显示: {{ filteredHistory.length }} / 总计: {{ history.length }}</span>
      </div>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onActivated, onMounted, onBeforeUnmount, onDeactivated, nextTick, watch } from "vue";
import { echarts } from "../utils/echarts";
import { RecycleScroller } from "vue-virtual-scroller";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";
import StatusBadge from "../components/common/StatusBadge.vue";
import { apiGet } from "../app/apiClient";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";
import { scheduleIdleTask } from "../utils/idle";

interface ChatMessage {
  time: string;
  channel: string;
  name: string;
  message: string;
  steamID: string;
  seq: number;
}

interface StatPoint {
  minute: number;
  count: number;
}

interface PlayerFreq {
  steamID: string;
  name: string;
  count: number;
}

interface Spammer {
  steamID: string;
  name: string;
  count: number;
}

const history = ref<ChatMessage[]>([]);
const stats = ref<StatPoint[]>([]);
const activeSpammers = ref<Spammer[]>([]);
const playerFrequencies = ref<PlayerFreq[]>([]);
const autoScroll = ref(true);
const scrollerRef = ref<any>(null);
const chartRef = ref<HTMLElement | null>(null);
let myChart: echarts.ECharts | null = null;
const active = ref(true);

const channelLabels: Record<string, string> = {
  ChatAll: "公开",
  ChatTeam: "阵营",
  ChatSquad: "小队",
  ChatAdmin: "管理",
};

const filters = reactive({
  query: "",
  channel: "all",
});

const filteredHistory = computed(() => {
  return history.value.filter((msg) => {
    const matchesQuery =
      !filters.query ||
      msg.name.toLowerCase().includes(filters.query.toLowerCase()) ||
      msg.message.toLowerCase().includes(filters.query.toLowerCase());
    const matchesChannel = filters.channel === "all" || msg.channel === filters.channel;
    return matchesQuery && matchesChannel;
  });
});

let inFlight = false;
async function fetchData() {
  if (!active.value || inFlight) return;
  inFlight = true;
  try {
    const [hRes, sRes] = await Promise.all([
      apiGet<{ history: ChatMessage[] }>("/api/chat/history"),
      apiGet<{ timeline: StatPoint[]; spammers: Spammer[]; playerFrequencies: PlayerFreq[] }>("/api/chat/stats"),
    ]);

    if (hRes.history) history.value = hRes.history;
    if (sRes.timeline) {
      stats.value = sRes.timeline;
      updateChart();
    }
    if (sRes.spammers) activeSpammers.value = sRes.spammers;
    if (sRes.playerFrequencies) playerFrequencies.value = sRes.playerFrequencies;
  } catch (e) {
    console.error("Failed to fetch chat data", e);
  } finally {
    inFlight = false;
  }
}

function initChart() {
  if (!chartRef.value) return;
  myChart = echarts.init(chartRef.value, "dark");
  const option = {
    backgroundColor: "transparent",
    tooltip: { trigger: "axis" },
    grid: { left: "10", right: "10", bottom: "0", top: "10", containLabel: false },
    xAxis: {
      type: "category",
      show: false,
      data: [],
    },
    yAxis: { type: "value", show: false },
    series: [
      {
        data: [],
        type: "line",
        smooth: true,
        symbol: "none",
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "#58a6ff" },
            { offset: 1, color: "transparent" },
          ]),
        },
        lineStyle: { color: "#58a6ff", width: 1 },
      },
    ],
  };
  myChart.setOption(option);
}

function updateChart() {
  if (!myChart) return;
  const seriesData = stats.value.map((p) => p.count);
  myChart.setOption({
    xAxis: { data: stats.value.map((p) => p.minute) },
    series: [{ data: seriesData }],
  });
}

function formatTime(iso: string) {
  if (!iso) return "--:--:--";
  return iso.split("T")[1]?.split(".")[0] || iso;
}

function scrollToEnd() {
  if (autoScroll.value && scrollerRef.value?.scrollToItem) {
    scrollerRef.value.scrollToItem(Math.max(filteredHistory.value.length - 1, 0));
  }
}

watch(
  () => filteredHistory.value.length,
  () => {
    nextTick(scrollToEnd);
  },
);

let timer: number | null = null;
const resizeChart = () => myChart?.resize();

function startPolling() {
  if (timer) return;
  timer = window.setInterval(() => {
    if (active.value && canAutoRefreshNow()) void fetchData();
  }, 2000);
}

function stopPolling() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

onMounted(() => {
  scheduleIdleTask(() => {
    if (!active.value) return;
    initChart();
    void fetchData();
  });
  startPolling();
  window.addEventListener("resize", resizeChart);
});

onBeforeUnmount(() => {
  stopPolling();
  window.removeEventListener("resize", resizeChart);
  myChart?.dispose();
});

onActivated(() => {
  active.value = true;
  startPolling();
  void fetchData();
});

onDeactivated(() => {
  active.value = false;
  stopPolling();
});
</script>

<style scoped>
.page.full-height {
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  padding: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 0% 0%, color-mix(in srgb, var(--theme-brand-glow) 90%, transparent), transparent 28%),
    var(--theme-background-flat);
  color: var(--color-text-primary);
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background:
    var(--theme-panel-highlight),
    color-mix(in srgb, var(--color-bg-card) 94%, transparent);
  border-bottom: 1px solid var(--color-border-default);
  flex-shrink: 0;
}

.filter-group {
  display: flex;
  gap: 10px;
  margin-right: 15px;
  flex-wrap: wrap;
}

.filter-input {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 13px;
  width: min(260px, 100%);
  flex: 1 1 180px;
}

.filter-select {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 13px;
}

.chat-layout-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 280px);
  min-height: 0;
}

.chat-column-left {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
}

.chat-column-right {
  background:
    var(--theme-panel-highlight),
    color-mix(in srgb, var(--color-bg-card) 96%, transparent);
  border-left: 1px solid var(--color-border-default);
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  overflow-y: auto;
}

.chat-dashboard-inline {
  padding: 8px 20px;
  background:
    var(--theme-panel-highlight),
    color-mix(in srgb, var(--color-bg-card) 94%, transparent);
  border-bottom: 1px solid var(--color-border-default);
}

.stats-card-mini {
  height: 60px;
}

.chart-container {
  height: 40px;
  width: 100%;
}

.sidebar-card {
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--theme-panel-rim) 85%, transparent), transparent),
    color-mix(in srgb, var(--color-bg-elevated) 92%, transparent);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-sm), var(--theme-panel-glow);
}

.card-header {
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border-soft);
  font-size: 11px;
  color: var(--color-text-muted);
  font-weight: bold;
  text-transform: uppercase;
}

.card-header.alert {
  color: #f85149;
}

.frequency-list {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.frequency-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.freq-info {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}

.p-name {
  color: var(--color-text-primary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 150px;
}

.p-count {
  color: var(--color-text-muted);
}

.freq-bar-bg {
  height: 4px;
  background: color-mix(in srgb, var(--color-bg-hover) 90%, transparent);
  border-radius: 2px;
  overflow: hidden;
}

.freq-bar-fill {
  height: 100%;
  background: #238636;
  transition: width 0.3s ease;
}

.frequency-item.high .p-count {
  color: #f85149;
}

.frequency-item.high .freq-bar-fill {
  background: #f85149;
}

.spammer-list {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.spammer-item {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #f85149;
  padding: 4px;
  background: rgba(248, 81, 73, 0.1);
  border-radius: 4px;
}

.chat-log-area {
  flex: 1 1 auto;
  min-height: 0;
  background: color-mix(in srgb, var(--color-bg-page) 88%, transparent);
  overflow: hidden;
}

.chat-log-shell {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.chat-log {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 16px 16px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 13px;
  line-height: 1.6;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}

.chat-line {
  padding: 3px 0;
  border-bottom: 1px solid var(--color-border-soft);
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.chat-time {
  color: var(--color-text-disabled);
  flex-shrink: 0;
}

.chat-channel {
  font-weight: bold;
  width: 52px;
  flex-shrink: 0;
}

.channel-chatall {
  color: #f85149;
}

.channel-chatteam {
  color: #58a6ff;
}

.channel-chatsquad {
  color: #3fb950;
}

.channel-chatadmin {
  color: #d29922;
}

.chat-name {
  color: var(--color-text-primary);
  font-weight: bold;
  flex-shrink: 0;
  max-width: 120px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-message {
  color: var(--color-text-secondary);
  flex: 1 1 auto;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.chat-footer {
  padding: 6px 20px;
  background:
    var(--theme-panel-highlight),
    color-mix(in srgb, var(--color-bg-card) 94%, transparent);
  border-top: 1px solid var(--color-border-default);
  font-size: 11px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.empty-hint {
  padding: 20px;
  text-align: center;
  color: var(--color-text-disabled);
  font-size: 12px;
}

.chat-empty-state {
  padding: 24px 16px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 13px;
  border: 1px dashed rgba(139, 148, 158, 0.25);
  border-radius: 8px;
  margin: 8px 0;
}

.chat-log-shell,
.chat-log {
  max-height: 100%;
}

@media (max-width: 980px) {
  .chat-header,
  .header-right {
    flex-wrap: wrap;
  }

  .chat-layout-main {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(360px, 1fr) auto;
  }

  .chat-column-right {
    width: auto;
    max-height: 32vh;
    border-left: 0;
    border-top: 1px solid var(--color-border-default);
  }
}

@media (max-width: 620px) {
  .chat-header {
    padding: 10px 12px;
  }

  .filter-group {
    margin-right: 0;
  }

  .filter-input,
  .filter-select {
    flex: 1 1 100%;
  }
}
</style>


