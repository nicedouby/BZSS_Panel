<template>
  <section class="page full-height">
    <header class="chat-header">
      <div class="header-left">
        <PageHeader title="聊天监控 / Chat Monitor" subtitle="实时聊天过滤与各个玩家频率监控" />
      </div>
      <div class="header-right">
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
        <StatusBadge :tone="autoScroll ? 'ok' : 'idle'" @click="autoScroll = !autoScroll">
          {{ autoScroll ? "自动滚动" : "手动滚动" }}
        </StatusBadge>
      </div>
    </header>

    <div class="chat-layout-main">
      <div class="chat-column-left">
        <div class="chat-dashboard-inline">
          <div class="stats-card-mini">
            <div class="card-header">60分钟活跃趋势</div>
            <div class="chart-container" ref="chartRef"></div>
          </div>
        </div>

        <main class="chat-log-area">
          <div class="chat-log" ref="scrollerRef">
            <article v-for="msg in filteredHistory" :key="msg.seq" class="chat-line" :class="[`channel-${msg.channel.toLowerCase()}`]">
              <span class="chat-time">{{ formatTime(msg.time) }}</span>
              <span class="chat-channel">[{{ msg.channel }}]</span>
              <span class="chat-name" :title="msg.steamID">{{ msg.name }}:</span>
              <span class="chat-message">{{ msg.message }}</span>
            </article>
          </div>
        </main>
      </div>

      <aside class="chat-column-right">
        <div class="sidebar-card">
          <div class="card-header">玩家发言频率 (1min)</div>
          <div class="frequency-list">
            <div v-if="playerFrequencies.length === 0" class="empty-hint">暂无活跃发言</div>
            <div v-for="p in playerFrequencies" :key="p.steamID" class="frequency-item" :class="{ high: p.count >= 5 }">
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

        <div class="sidebar-card spammers-box" v-if="activeSpammers.length > 0">
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
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } from "vue";
import * as echarts from "echarts";
import PageHeader from "../components/common/PageHeader.vue";
import StatusBadge from "../components/common/StatusBadge.vue";
import { apiGet } from "../app/apiClient";

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
const scrollerRef = ref<HTMLElement | null>(null);
const chartRef = ref<HTMLElement | null>(null);
let myChart: echarts.ECharts | null = null;

const filters = reactive({
  query: "",
  channel: "all"
});

const filteredHistory = computed(() => {
  return history.value.filter(msg => {
    const matchesQuery = !filters.query || 
      msg.name.toLowerCase().includes(filters.query.toLowerCase()) || 
      msg.message.toLowerCase().includes(filters.query.toLowerCase());
    const matchesChannel = filters.channel === "all" || msg.channel === filters.channel;
    return matchesQuery && matchesChannel;
  });
});

async function fetchData() {
  try {
    const [hRes, sRes] = await Promise.all([
      apiGet<{ history: ChatMessage[] }>("/api/chat/history"),
      apiGet<{ timeline: StatPoint[], spammers: Spammer[], playerFrequencies: PlayerFreq[] }>("/api/chat/stats")
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
      data: []
    },
    yAxis: { type: "value", show: false },
    series: [{
      data: [],
      type: "line",
      smooth: true,
      symbol: "none",
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "#58a6ff" }, { offset: 1, color: "transparent" }]) },
      lineStyle: { color: "#58a6ff", width: 1 }
    }]
  };
  myChart.setOption(option);
}

function updateChart() {
  if (!myChart) return;
  const seriesData = stats.value.map(p => p.count);
  myChart.setOption({
    xAxis: { data: stats.value.map(p => p.minute) },
    series: [{ data: seriesData }]
  });
}

function formatTime(iso: string) {
  if (!iso) return "--:--:--";
  return iso.split("T")[1]?.split(".")[0] || iso;
}

function scrollToEnd() {
  if (autoScroll.value && scrollerRef.value) {
    scrollerRef.value.scrollTop = scrollerRef.value.scrollHeight;
  }
}

watch(() => filteredHistory.value.length, () => {
  nextTick(scrollToEnd);
});

let timer: number | null = null;
onMounted(() => {
  initChart();
  fetchData();
  timer = window.setInterval(fetchData, 2000);
  window.addEventListener("resize", () => myChart?.resize());
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  myChart?.dispose();
});
</script>

<style scoped>
.page.full-height {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
  background: #0d1117;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  flex-shrink: 0;
}

.filter-group {
  display: flex;
  gap: 10px;
  margin-right: 15px;
}

.filter-input {
  background: #0d1117;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 13px;
  width: 180px;
}

.filter-select {
  background: #0d1117;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 13px;
}

.chat-layout-main {
  flex: 1;
  display: flex;
  min-height: 0;
}

.chat-column-left {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chat-column-right {
  width: 280px;
  background: #161b22;
  border-left: 1px solid #30363d;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  overflow-y: auto;
}

.chat-dashboard-inline {
  padding: 8px 20px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
}

.stats-card-mini {
  height: 60px;
}

.chart-container {
  height: 40px;
  width: 100%;
}

.sidebar-card {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
}

.card-header {
  padding: 8px 12px;
  border-bottom: 1px solid #30363d;
  font-size: 11px;
  color: #8b949e;
  font-weight: bold;
  text-transform: uppercase;
}

.card-header.alert { color: #f85149; }

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
  color: #c9d1d9;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 150px;
}

.p-count { color: #8b949e; }

.freq-bar-bg {
  height: 4px;
  background: #21262d;
  border-radius: 2px;
  overflow: hidden;
}

.freq-bar-fill {
  height: 100%;
  background: #238636;
  transition: width 0.3s ease;
}

.frequency-item.high .p-count { color: #f85149; }
.frequency-item.high .freq-bar-fill { background: #f85149; }

.spammer-list { padding: 8px; display: flex; flex-direction: column; gap: 4px; }
.spammer-item {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #f85149;
  padding: 4px;
  background: rgba(248, 81, 73, 0.1);
  border-radius: 4px;
}

.chat-log-area { flex: 1; min-height: 0; background: #0d1117; }
.chat-log {
  height: 100%;
  overflow-y: auto;
  padding: 8px 16px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 13px;
  line-height: 1.6;
}

.chat-line {
  padding: 3px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.02);
  display: flex;
  gap: 10px;
}

.chat-time { color: #484f58; flex-shrink: 0; }
.chat-channel { font-weight: bold; width: 80px; flex-shrink: 0; }
.channel-chatall { color: #f85149; }
.channel-chatteam { color: #58a6ff; }
.channel-chatsquad { color: #3fb950; }
.channel-chatadmin { color: #d29922; }

.chat-name { color: #c9d1d9; font-weight: bold; flex-shrink: 0; }
.chat-message { color: #edf2f4; word-break: break-all; }

.chat-footer {
  padding: 6px 20px;
  background: #161b22;
  border-top: 1px solid #30363d;
  font-size: 11px;
  color: #8b949e;
  flex-shrink: 0;
}

.empty-hint {
  padding: 20px;
  text-align: center;
  color: #484f58;
  font-size: 12px;
}
</style>
