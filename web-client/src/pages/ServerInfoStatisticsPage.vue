<template>
  <section class="page server-info-stats-page">
    <PageHeader
      title="服务器信息统计"
      subtitle="按天保存 ShowServerInfo 派生数据，支持按秒、分钟、小时切换曲线视图。"
    >
      <template #actions>
        <label class="date-field">
          <span>日期</span>
          <input v-model="selectedDate" type="date" @change="handleDateChange">
        </label>
        <button type="button" @click="handleRefresh">
          刷新
        </button>
        <button type="button" :aria-pressed="liveRefresh" @click="liveRefresh = !liveRefresh">
          {{ liveRefresh ? "暂停实时" : "恢复实时" }}
        </button>
      </template>
    </PageHeader>

    <section class="hero-grid">
      <PageCard v-for="card in heroCards" :key="card.key" compact class="hero-card">
        <div class="hero-card-head">
          <span class="hero-icon" :data-tone="card.tone">{{ card.icon }}</span>
          <span class="hero-label">{{ card.label }}</span>
        </div>
        <strong class="hero-value">{{ card.value }}</strong>
        <p class="hero-meta">{{ card.meta }}</p>
      </PageCard>
    </section>

    <section class="metric-grid" aria-label="三项指标概览">
      <PageCard v-for="item in metricCharts" :key="item.key" compact class="metric-card">
        <div class="metric-card-head">
          <div>
            <h2>{{ item.label }}</h2>
            <p>{{ item.meta }}</p>
          </div>
          <strong class="metric-card-value" :data-tone="item.tone">{{ item.value }}</strong>
        </div>

        <div class="chart-shell metric-chart-shell">
          <svg
            v-if="item.chart.points.length"
            class="chart-svg"
            viewBox="0 0 960 340"
            preserveAspectRatio="none"
            role="img"
            :aria-label="`${item.label} · ${chartSubtitle}`"
          >
            <defs>
              <linearGradient :id="`area-fill-${item.key}`" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" :stop-color="item.tone" stop-opacity="0.34" />
                <stop offset="100%" :stop-color="item.tone" stop-opacity="0.02" />
              </linearGradient>
              <linearGradient :id="`line-stroke-${item.key}`" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" :stop-color="item.tone" />
                <stop offset="100%" :stop-color="item.toneSoft" />
              </linearGradient>
            </defs>

            <g class="chart-grid">
              <line
                v-for="line in item.chart.yLines"
                :key="`y-${item.key}-${line.y}`"
                :x1="item.chart.left"
                :y1="line.y"
                :x2="item.chart.width - item.chart.right"
                :y2="line.y"
              />
              <line
                v-for="line in item.chart.xLines"
                :key="`x-${item.key}-${line.x}`"
                :x1="line.x"
                :y1="item.chart.top"
                :x2="line.x"
                :y2="item.chart.height - item.chart.bottom"
              />
            </g>

            <path
              v-if="item.chart.areaPath"
              class="chart-area"
              :d="item.chart.areaPath"
              :fill="`url(#area-fill-${item.key})`"
            />
            <path
              v-if="item.chart.linePath"
              class="chart-line"
              :d="item.chart.linePath"
              fill="none"
              :stroke="`url(#line-stroke-${item.key})`"
            />

            <g v-for="point in item.chart.points" :key="`${item.key}-${point.ts}-${point.sample.at}`">
              <circle
                class="chart-point"
                :class="{ selected: selectedPoint?.sample.at === point.sample.at }"
                :cx="point.x"
                :cy="point.y"
                r="5.5"
                :fill="item.tone"
                @click="selectedPoint = point"
              >
                <title>{{ point.tooltip }}</title>
              </circle>
            </g>

            <g class="chart-axis">
              <text
                v-for="label in item.chart.valueLabels"
                :key="`v-${item.key}-${label.key}`"
                :x="item.chart.left - 12"
                :y="label.y"
                text-anchor="end"
              >
                {{ label.text }}
              </text>
              <text
                v-for="label in item.chart.timeLabels"
                :key="`t-${item.key}-${label.key}`"
                :x="label.x"
                :y="item.chart.height - 14"
                text-anchor="middle"
              >
                {{ label.text }}
              </text>
            </g>
          </svg>

          <div v-else class="chart-empty compact">
            <div class="chart-empty-badge">无曲线</div>
            <h3>当前没有可绘制的数据点</h3>
            <p>尝试切换日期，或者等待插件继续采样该指标。</p>
          </div>
        </div>
      </PageCard>
    </section>

    <DataState
      :loading="loading && !samples.length"
      :error="blockingError"
      :empty="!blockingError && !samples.length && !loading"
      :stale="stale && samples.length > 0"
      stale-text="正在显示最近一次成功拉取到的缓存数据。"
      empty-title="暂无统计数据"
      empty-text="当前选定日期没有可绘制的数据点，或者插件尚未开始采样。"
    >
      <div class="content-grid">
        <PageCard class="chart-card" compact>
          <template #header>
            <div class="chart-header">
              <div>
                <h2>数据曲线</h2>
                <p>
                  {{ chartSubtitle }}
                </p>
              </div>
              <div class="chart-switchers">
                <div class="switcher-group">
                  <button
                    v-for="item in metricOptions"
                    :key="item.key"
                    type="button"
                    class="icon-toggle"
                    :class="{ active: selectedMetric === item.key }"
                    :aria-pressed="selectedMetric === item.key"
                    @click="selectMetric(item.key)"
                  >
                    <span class="icon-toggle-mark">{{ item.icon }}</span>
                    <span>{{ item.label }}</span>
                  </button>
                </div>
                <div class="switcher-group">
                  <button
                    v-for="item in bucketOptions"
                    :key="item.key"
                    type="button"
                    class="icon-toggle compact"
                    :class="{ active: selectedBucket === item.key }"
                    :aria-pressed="selectedBucket === item.key"
                    @click="selectBucket(item.key)"
                  >
                    <span class="icon-toggle-mark">{{ item.icon }}</span>
                    <span>{{ item.label }}</span>
                  </button>
                </div>
              </div>
            </div>
          </template>

          <div class="chart-shell">
            <svg
              v-if="chart.points.length"
              class="chart-svg"
              viewBox="0 0 960 340"
              preserveAspectRatio="none"
              role="img"
              :aria-label="chartSubtitle"
            >
              <defs>
                <linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" :stop-color="chartTone" stop-opacity="0.34" />
                  <stop offset="100%" :stop-color="chartTone" stop-opacity="0.02" />
                </linearGradient>
                <linearGradient id="line-stroke" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" :stop-color="chartTone" />
                  <stop offset="100%" :stop-color="chartToneSoft" />
                </linearGradient>
              </defs>

              <g class="chart-grid">
                <line
                  v-for="line in chart.yLines"
                  :key="`y-${line.y}`"
                  :x1="chart.left"
                  :y1="line.y"
                  :x2="chart.width - chart.right"
                  :y2="line.y"
                />
                <line
                  v-for="line in chart.xLines"
                  :key="`x-${line.x}`"
                  :x1="line.x"
                  :y1="chart.top"
                  :x2="line.x"
                  :y2="chart.height - chart.bottom"
                />
              </g>

              <path
                v-if="chart.areaPath"
                class="chart-area"
                :d="chart.areaPath"
                fill="url(#area-fill)"
              />
              <path
                v-if="chart.linePath"
                class="chart-line"
                :d="chart.linePath"
                fill="none"
                stroke="url(#line-stroke)"
              />

              <g v-for="point in chart.points" :key="`${point.ts}-${point.sample.at}`">
                <circle
                  class="chart-point"
                  :class="{ selected: selectedPoint?.ts === point.ts }"
                  :cx="point.x"
                  :cy="point.y"
                  r="5.5"
                  :fill="chartTone"
                  @click="selectedPoint = point"
                >
                  <title>{{ point.tooltip }}</title>
                </circle>
              </g>

              <g class="chart-axis">
                <text
                  v-for="label in chart.valueLabels"
                  :key="`v-${label.key}`"
                  :x="chart.left - 12"
                  :y="label.y"
                  text-anchor="end"
                >
                  {{ label.text }}
                </text>
                <text
                  v-for="label in chart.timeLabels"
                  :key="`t-${label.key}`"
                  :x="label.x"
                  :y="chart.height - 14"
                  text-anchor="middle"
                >
                  {{ label.text }}
                </text>
              </g>
            </svg>

            <div v-else class="chart-empty">
              <div class="chart-empty-badge">无曲线</div>
              <h3>当前没有可绘制的数据点</h3>
              <p>尝试切换日期，或等待采样器记录新的服务器信息。</p>
            </div>
          </div>
        </PageCard>

        <div class="side-stack">
          <PageCard compact>
            <template #header>
              <div class="side-card-head">
                <div>
                  <h2>选中数据点</h2>
                  <p>点击曲线上的点可查看对应时刻的完整快照。</p>
                </div>
                <span class="status-pill" :data-tone="stale ? 'warn' : 'ok'">
                  {{ stale ? "缓存" : "实时" }}
                </span>
              </div>
            </template>

            <div v-if="selectedPoint" class="detail-grid">
              <div>
                <span>时间</span>
                <strong>{{ formatTime(selectedPoint.sample.at) }}</strong>
              </div>
              <div>
                <span>人数</span>
                <strong>{{ formatMetric(selectedPoint.sample.playerCount, "playerCount") }}</strong>
              </div>
              <div>
                <span>排队</span>
                <strong>{{ formatMetric(selectedPoint.sample.queueCount, "queueCount") }}</strong>
              </div>
              <div>
                <span>TPS</span>
                <strong>{{ formatMetric(selectedPoint.sample.tps, "tps") }}</strong>
              </div>
              <div>
                <span>地图</span>
                <strong>{{ selectedPoint.sample.map || "--" }}</strong>
              </div>
              <div>
                <span>图层</span>
                <strong>{{ selectedPoint.sample.layer || "--" }}</strong>
              </div>
            </div>
            <div v-else class="empty-note">
              还没有选中任何数据点。
            </div>
          </PageCard>

          <PageCard compact>
            <template #header>
              <div class="side-card-head">
                <div>
                  <h2>历史日期</h2>
                  <p>按天查看保存到磁盘的统计文件。</p>
                </div>
              </div>
            </template>

            <div class="date-pills">
              <button
                v-for="date in availableDates.slice().reverse()"
                :key="date"
                type="button"
                class="date-pill"
                :class="{ active: date === selectedDate }"
                @click="selectDate(date)"
              >
                {{ date }}
              </button>
            </div>
          </PageCard>

          <PageCard compact>
            <template #header>
              <div class="side-card-head">
                <div>
                  <h2>今日摘要</h2>
                  <p>当前选定日期的统计概览。</p>
                </div>
              </div>
            </template>

            <div class="summary-stack">
              <div v-for="item in summaryCards" :key="item.key" class="summary-row">
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
              </div>
            </div>
          </PageCard>
        </div>
      </div>
    </DataState>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import DataState from "../components/common/DataState.vue";
import { apiGet } from "../app/apiClient";
import { useServerStore } from "../stores/server.store";

type MetricKey = "playerCount" | "queueCount" | "tps";
type BucketKey = "second" | "minute" | "hour";

type ServerInfoSample = {
  at: string;
  sourceAt?: string | null;
  serverId?: string;
  playerCount?: number | null;
  queueCount?: number | null;
  tps?: number | null;
  tpsStatus?: string | null;
  maxPlayers?: number | null;
  map?: string;
  layer?: string;
  mode?: string;
  matchState?: string;
};

type ServerInfoSummary = {
  sampleCount: number;
  firstAt?: string | null;
  lastAt?: string | null;
  latest?: ServerInfoSample | null;
  playerCountMin?: number | null;
  playerCountMax?: number | null;
  playerCountAvg?: number | null;
  queueCountMin?: number | null;
  queueCountMax?: number | null;
  queueCountAvg?: number | null;
  tpsMin?: number | null;
  tpsMax?: number | null;
  tpsAvg?: number | null;
};

type ServerInfoDay = {
  serverId: string;
  date: string;
  samples: ServerInfoSample[];
  summary: ServerInfoSummary;
  updatedAt?: string;
};

type ServerInfoState = {
  ok: boolean;
  plugin: string;
  serverId: string;
  date: string;
  availableDates: string[];
  day: ServerInfoDay;
  summary: ServerInfoSummary;
  latest?: ServerInfoSample | null;
  updatedAt?: string;
  liveSnapshot?: ServerInfoSample | null;
};

type ChartPoint = {
  ts: number;
  x: number;
  y: number;
  value: number | null;
  sample: ServerInfoSample;
  tooltip: string;
};

type ChartLabel = {
  key: string;
  x: number;
  text: string;
};

type ChartYLabel = {
  key: string;
  y: number;
  text: string;
};

type MetricChart = {
  key: MetricKey;
  label: string;
  icon: string;
  tone: string;
  toneSoft: string;
  value: string;
  meta: string;
  chart: ReturnType<typeof buildChart>;
};

const server = useServerStore();

const loading = ref(false);
const stale = ref(false);
const liveRefresh = ref(true);
const selectedDate = ref(currentDateKey());
const selectedMetric = ref<MetricKey>("playerCount");
const selectedBucket = ref<BucketKey>("minute");
const selectedPoint = ref<ChartPoint | null>(null);
const errorMessage = ref("");
const availableDates = ref<string[]>([]);
const state = ref<ServerInfoState | null>(null);

let refreshTimer: number | null = null;

const samples = computed(() => state.value?.day.samples ?? []);
const summary = computed(() => state.value?.summary ?? state.value?.day.summary ?? emptySummary());
const latestSample = computed(() => state.value?.liveSnapshot ?? state.value?.latest ?? summary.value.latest ?? samples.value.at(-1) ?? null);
const serverLabel = computed(() => String(server.snapshot.serverName ?? server.snapshot.name ?? "服务器"));

const metricOptions: Array<{ key: MetricKey; label: string; icon: string }> = [
  { key: "playerCount", label: "人数", icon: "👥" },
  { key: "queueCount", label: "排队", icon: "⏳" },
  { key: "tps", label: "TPS", icon: "⚡" },
];

const bucketOptions: Array<{ key: BucketKey; label: string; icon: string }> = [
  { key: "second", label: "秒", icon: "1s" },
  { key: "minute", label: "分", icon: "1m" },
  { key: "hour", label: "时", icon: "1h" },
];

const chart = computed(() => buildChart(samples.value, selectedMetric.value, selectedBucket.value));
const chartTone = computed(() => metricTone(selectedMetric.value));
const chartToneSoft = computed(() => metricToneSoft(selectedMetric.value));
const chartSubtitle = computed(() => {
  const metric = metricOptions.find((item) => item.key === selectedMetric.value)?.label ?? "人数";
  const bucket = bucketOptions.find((item) => item.key === selectedBucket.value)?.label ?? "分钟";
  return `${selectedDate.value} · ${metric} · ${bucket}级采样`;
});

const metricCharts = computed<MetricChart[]>(() => {
  const latest = latestSample.value;
  return metricOptions.map((item) => {
    const chart = buildChart(samples.value, item.key, selectedBucket.value);
    return {
      key: item.key,
      label: item.label,
      icon: item.icon,
      tone: metricTone(item.key),
      toneSoft: metricToneSoft(item.key),
      value: formatMetric(latest?.[item.key] ?? summary.value.latest?.[item.key] ?? null, item.key),
      meta: metricMetaText(item.key),
      chart,
    };
  });
});

const heroCards = computed(() => {
  const latest = latestSample.value;
  return [
    {
      key: "playerCount",
      label: "最新人数",
      icon: "👥",
      tone: "player",
      value: formatMetric(latest?.playerCount ?? summary.value.latest?.playerCount ?? null, "playerCount"),
      meta: `峰值 ${formatMetric(summary.value.playerCountMax ?? null, "playerCount")} · 均值 ${formatMetric(summary.value.playerCountAvg ?? null, "playerCount")}`,
    },
    {
      key: "queueCount",
      label: "最新排队",
      icon: "⏳",
      tone: "queue",
      value: formatMetric(latest?.queueCount ?? summary.value.latest?.queueCount ?? null, "queueCount"),
      meta: `峰值 ${formatMetric(summary.value.queueCountMax ?? null, "queueCount")} · 均值 ${formatMetric(summary.value.queueCountAvg ?? null, "queueCount")}`,
    },
    {
      key: "tps",
      label: "最新 TPS",
      icon: "⚡",
      tone: "tps",
      value: formatMetric(latest?.tps ?? summary.value.latest?.tps ?? null, "tps"),
      meta: `最高 ${formatMetric(summary.value.tpsMax ?? null, "tps")} · 平均 ${formatMetric(summary.value.tpsAvg ?? null, "tps")}`,
    },
    {
      key: "sampleCount",
      label: "采样点",
      icon: "▣",
      tone: "neutral",
      value: formatNumber(summary.value.sampleCount ?? 0),
      meta: `${summary.value.firstAt ? `从 ${formatTime(summary.value.firstAt)}` : "尚未开始采样"}`,
    },
  ];
});

const summaryCards = computed(() => {
  const latest = latestSample.value;
  return [
    { key: "server", label: "服务器", value: serverLabel.value },
    { key: "last", label: "最新记录", value: latest ? formatTime(latest.at) : "--" },
    { key: "map", label: "当前地图", value: latest?.map || "--" },
    { key: "layer", label: "当前图层", value: latest?.layer || "--" },
    { key: "mode", label: "游戏模式", value: latest?.mode || latest?.matchState || "--" },
    { key: "range", label: "覆盖区间", value: summary.value.firstAt && summary.value.lastAt ? `${formatTime(summary.value.firstAt)} - ${formatTime(summary.value.lastAt)}` : "--" },
  ];
});

const blockingError = computed(() => {
  if (!errorMessage.value) return "";
  if (samples.value.length > 0) return "";
  return errorMessage.value;
});

onMounted(() => {
  void loadState();
  refreshTimer = window.setInterval(() => {
    if (!liveRefresh.value) return;
    if (selectedDate.value !== currentDateKey()) return;
    void loadState({ silent: true });
  }, 5000);
});

onBeforeUnmount(() => {
  if (refreshTimer != null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
});

async function loadState({ silent = false } = {}) {
  loading.value = true;

  try {
    const serverId = String(server.snapshot.serverId ?? "").trim();
    const params = new URLSearchParams();
    if (serverId) params.set("serverId", serverId);
    if (selectedDate.value) params.set("date", selectedDate.value);

    const response = await apiGet<ServerInfoState>(`/api/plugins/server-info-statistics/state?${params.toString()}`);
    state.value = response;
    availableDates.value = response.availableDates ?? [];
    selectedDate.value = response.date || selectedDate.value;

    const nextSamples = response.day?.samples ?? [];
    selectedPoint.value = selectPreferredPoint(nextSamples, selectedPoint.value);
    stale.value = false;
    errorMessage.value = "";
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "加载服务器信息统计失败";
    if (samples.value.length > 0) {
      stale.value = true;
      errorMessage.value = message;
    } else if (!silent) {
      errorMessage.value = message;
    }
  } finally {
    loading.value = false;
  }
}

function handleRefresh() {
  void loadState();
}

function handleDateChange() {
  void loadState();
}

function selectMetric(metric: MetricKey) {
  selectedMetric.value = metric;
  selectedPoint.value = null;
}

function selectBucket(bucket: BucketKey) {
  selectedBucket.value = bucket;
  selectedPoint.value = null;
}

function selectDate(date: string) {
  selectedDate.value = date;
  selectedPoint.value = null;
  void loadState();
}

function selectPreferredPoint(samplesList: ServerInfoSample[], previous: ChartPoint | null) {
  if (!samplesList.length) return null;

  const preferredAt = previous?.sample?.at;
  if (preferredAt) {
    const match = samplesList.find((sample) => sample.at === preferredAt);
    if (match) {
      const series = buildChart(samplesList, selectedMetric.value, selectedBucket.value);
      return series.points.find((point) => point.sample.at === match.at) ?? null;
    }
  }

  const series = buildChart(samplesList, selectedMetric.value, selectedBucket.value);
  return series.points.at(-1) ?? null;
}

function buildChart(samplesList: ServerInfoSample[], metric: MetricKey, bucket: BucketKey) {
  const byBucket = new Map<number, ServerInfoSample>();

  for (const sample of samplesList) {
    const ts = Date.parse(sample.at);
    if (!Number.isFinite(ts)) continue;
    const bucketTs = truncateTimestamp(ts, bucket);
    byBucket.set(bucketTs, sample);
  }

  const ordered = [...byBucket.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([ts, sample]) => ({
      ts,
      sample,
      value: metricValue(sample, metric),
    }));

  const width = 960;
  const height = 340;
  const left = 64;
  const right = 24;
  const top = 22;
  const bottom = 34;
  const plotWidth = Math.max(1, width - left - right);
  const plotHeight = Math.max(1, height - top - bottom);

  const values = ordered.map((item) => item.value).filter((value): value is number => Number.isFinite(value));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const padding = max === min ? Math.max(1, Math.abs(max) * 0.15 || 1) : 0;
  const scaleMin = min - padding;
  const scaleMax = max + padding;

  const points = ordered.map((item, index) => {
    const ratio = ordered.length === 1 ? 0.5 : index / Math.max(1, ordered.length - 1);
    const x = left + ratio * plotWidth;
    const yRatio = normalizeScale(item.value, scaleMin, scaleMax);
    const y = top + (1 - yRatio) * plotHeight;
    return {
      ts: item.ts,
      x,
      y,
      value: item.value,
      sample: item.sample,
      tooltip: buildPointTooltip(item.sample, item.value, metric),
    };
  });

  const linePath = points.length
    ? `M ${points.map((point) => `${round(point.x)} ${round(point.y)}`).join(" L ")}`
    : "";
  const areaPath = points.length
    ? `${linePath} L ${round(points.at(-1)?.x ?? left)} ${height - bottom} L ${round(points[0]?.x ?? left)} ${height - bottom} Z`
    : "";

  const xLabels = buildTimeLabels(points, bucket, width, left, right, top, bottom);
  const yLabels = buildValueLabels(scaleMin, scaleMax, height, top, bottom);

  return {
    width,
    height,
    left,
    right,
    top,
    bottom,
    points,
    linePath,
    areaPath,
    xLines: buildVerticalGuides(xLabels),
    yLines: buildHorizontalGuides(yLabels),
    timeLabels: xLabels,
    valueLabels: yLabels,
  };
}

function buildTimeLabels(points: Array<{ x: number; sample: ServerInfoSample; ts: number }>, bucket: BucketKey, width: number, left: number, right: number, top: number, bottom: number) {
  if (!points.length) return [];
  if (points.length === 1) {
    return [{
      key: String(points[0].ts),
      x: points[0].x,
      text: formatBucketLabel(points[0].sample.at, bucket),
    }];
  }

  const anchors = new Set<number>([0, Math.floor(points.length / 2), points.length - 1]);
  const labels = [...anchors].map((index) => ({
    key: String(points[index].ts),
    x: points[index].x,
    text: formatBucketLabel(points[index].sample.at, bucket),
  }));

  return labels;
}

function buildValueLabels(min: number, max: number, height: number, top: number, bottom: number) {
  const labels: ChartYLabel[] = [];
  const steps = 4;
  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    const value = max - (max - min) * ratio;
    const y = top + ratio * (height - top - bottom);
    labels.push({
      key: `${index}-${value}`,
      y,
      text: formatAxisValue(value),
    });
  }
  return labels;
}

function buildVerticalGuides(labels: ChartLabel[]) {
  return labels.map((label) => ({
    x: label.x,
  }));
}

function buildHorizontalGuides(labels: ChartYLabel[]) {
  return labels.map((label) => ({
    y: label.y,
  }));
}

function truncateTimestamp(timestamp: number, bucket: BucketKey) {
  const date = new Date(timestamp);
  if (bucket === "hour") {
    date.setMinutes(0, 0, 0);
  } else if (bucket === "minute") {
    date.setSeconds(0, 0);
  } else {
    date.setMilliseconds(0);
  }
  return date.getTime();
}

function metricValue(sample: ServerInfoSample, metric: MetricKey) {
  const raw = sample[metric];
  if (!Number.isFinite(Number(raw))) return null;
  return Number(raw);
}

function normalizeScale(value: number | null, min: number, max: number) {
  if (value == null || !Number.isFinite(value)) return 0;
  if (max <= min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function buildPointTooltip(sample: ServerInfoSample, value: number | null, metric: MetricKey) {
  return [
    formatTime(sample.at),
    `${metricLabel(metric)}: ${formatMetric(value, metric)}`,
    sample.map ? `地图: ${sample.map}` : "",
    sample.layer ? `图层: ${sample.layer}` : "",
  ].filter(Boolean).join("\n");
}

function metricTone(metric: MetricKey) {
  if (metric === "queueCount") return "#fbbf24";
  if (metric === "tps") return "#34d399";
  return "#5eead4";
}

function metricToneSoft(metric: MetricKey) {
  if (metric === "queueCount") return "#ffd36d";
  if (metric === "tps") return "#7ee8b3";
  return "#82f4e2";
}

function metricLabel(metric: MetricKey) {
  if (metric === "queueCount") return "排队人数";
  if (metric === "tps") return "TPS";
  return "在线人数";
}

function formatMetric(value: unknown, metric: MetricKey) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  if (metric === "tps") return number.toFixed(1);
  return formatNumber(number);
}

function metricMetaText(metric: MetricKey) {
  if (metric === "queueCount") {
    return `峰值 ${formatMetric(summary.value.queueCountMax ?? null, metric)} · 均值 ${formatMetric(summary.value.queueCountAvg ?? null, metric)}`;
  }
  if (metric === "tps") {
    return `最高 ${formatMetric(summary.value.tpsMax ?? null, metric)} · 平均 ${formatMetric(summary.value.tpsAvg ?? null, metric)}`;
  }
  return `峰值 ${formatMetric(summary.value.playerCountMax ?? null, metric)} · 均值 ${formatMetric(summary.value.playerCountAvg ?? null, metric)}`;
}

function formatAxisValue(value: number) {
  return Number.isInteger(value) ? formatNumber(value) : value.toFixed(1);
}

function formatBucketLabel(value: string, bucket: BucketKey) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (bucket === "hour") {
    return `${pad(date.getHours())}:00`;
  }
  if (bucket === "minute") {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function currentDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "--";
  return date.toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("zh-CN").format(number) : "--";
}

function emptySummary(): ServerInfoSummary {
  return {
    sampleCount: 0,
    firstAt: null,
    lastAt: null,
    latest: null,
    playerCountMin: null,
    playerCountMax: null,
    playerCountAvg: null,
    queueCountMin: null,
    queueCountMax: null,
    queueCountAvg: null,
    tpsMin: null,
    tpsMax: null,
    tpsAvg: null,
  };
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
</script>

<style scoped>
.server-info-stats-page {
  gap: 16px;
}

.hero-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.hero-card {
  position: relative;
  overflow: hidden;
}

.hero-card::before {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(94, 234, 212, 0.08), transparent 50%);
  pointer-events: none;
}

.hero-card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.hero-icon {
  width: 38px;
  height: 38px;
  display: inline-grid;
  place-items: center;
  border-radius: 12px;
  font-size: 18px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.hero-icon[data-tone="player"] {
  color: #5eead4;
}

.hero-icon[data-tone="queue"] {
  color: #fbbf24;
}

.hero-icon[data-tone="tps"] {
  color: #34d399;
}

.hero-icon[data-tone="neutral"] {
  color: #93c5fd;
}

.hero-label {
  color: #9aa7b2;
  font-size: 12px;
  letter-spacing: 0.04em;
}

.hero-value {
  display: block;
  font-size: 30px;
  line-height: 1.05;
}

.hero-meta {
  margin: 8px 0 0;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.5;
}

.metric-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.metric-card {
  min-height: 0;
}

.metric-card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.metric-card-head h2 {
  margin: 0;
  font-size: 14px;
}

.metric-card-head p {
  margin: 6px 0 0;
  color: #9aa7b2;
  font-size: 12px;
  line-height: 1.4;
}

.metric-card-value {
  flex: none;
  font-size: 20px;
  line-height: 1;
  padding: 8px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(148, 163, 184, 0.12);
}

.metric-card-value[data-tone="player"] {
  color: #5eead4;
}

.metric-card-value[data-tone="queue"] {
  color: #fbbf24;
}

.metric-card-value[data-tone="tps"] {
  color: #34d399;
}

.metric-chart-shell {
  min-height: 240px;
}

.content-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.75fr);
  min-height: 0;
}

.chart-card,
.side-stack {
  min-height: 0;
}

.side-stack {
  display: grid;
  gap: 16px;
  align-content: start;
}

.chart-header,
.side-card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.chart-header h2,
.side-card-head h2 {
  margin: 0;
  font-size: 16px;
}

.chart-header p,
.side-card-head p {
  margin: 6px 0 0;
  color: #9aa7b2;
  font-size: 12px;
}

.chart-switchers {
  display: grid;
  gap: 8px;
  justify-items: end;
}

.switcher-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.icon-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 11px;
  border-radius: 999px;
  border: 1px solid #374151;
  background: rgba(255, 255, 255, 0.03);
  color: #dce4e8;
}

.icon-toggle:hover {
  border-color: rgba(148, 163, 184, 0.4);
}

.icon-toggle.active {
  border-color: rgba(94, 234, 212, 0.55);
  background: rgba(94, 234, 212, 0.12);
  box-shadow: 0 0 0 1px rgba(94, 234, 212, 0.08) inset;
}

.icon-toggle.compact {
  padding-inline: 10px;
}

.icon-toggle-mark {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  font-size: 12px;
}

.chart-shell {
  min-height: 360px;
}

.chart-svg {
  width: 100%;
  height: auto;
  display: block;
  min-height: 320px;
}

.chart-grid line {
  stroke: rgba(148, 163, 184, 0.16);
  stroke-width: 1;
  shape-rendering: crispEdges;
}

.chart-line {
  stroke-width: 3.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 0 10px rgba(94, 234, 212, 0.18));
}

.chart-point {
  cursor: pointer;
  stroke: rgba(7, 11, 16, 0.95);
  stroke-width: 2;
  transition: transform 120ms ease, r 120ms ease, opacity 120ms ease;
}

.chart-point:hover,
.chart-point.selected {
  transform: scale(1.18);
}

.chart-axis text {
  fill: #94a3b8;
  font-size: 11px;
}

.chart-empty {
  min-height: 320px;
  display: grid;
  place-items: center;
  text-align: center;
  border: 1px dashed rgba(148, 163, 184, 0.24);
  border-radius: 18px;
  background:
    radial-gradient(circle at top, rgba(94, 234, 212, 0.08), transparent 45%),
    rgba(255, 255, 255, 0.02);
}

.chart-empty.compact {
  min-height: 220px;
}

.chart-empty-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(94, 234, 212, 0.24);
  color: #5eead4;
  font-size: 12px;
}

.chart-empty h3 {
  margin: 12px 0 0;
}

.chart-empty p {
  margin: 8px 0 0;
  color: #9aa7b2;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.detail-grid span,
.summary-row span {
  display: block;
  color: #9aa7b2;
  font-size: 12px;
  margin-bottom: 4px;
}

.detail-grid strong,
.summary-row strong {
  display: block;
  word-break: break-word;
}

.empty-note {
  color: #9aa7b2;
  font-size: 13px;
  line-height: 1.6;
}

.date-field {
  display: grid;
  gap: 6px;
  font-size: 12px;
  color: #9aa7b2;
}

.date-field input {
  min-width: 144px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #374151;
  background: #0f1418;
  color: #edf2f4;
}

.date-pills {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.date-pill {
  padding: 8px 10px;
  border-radius: 999px;
  border: 1px solid #374151;
  background: rgba(255, 255, 255, 0.02);
  color: #dce4e8;
}

.date-pill.active {
  border-color: rgba(94, 234, 212, 0.48);
  background: rgba(94, 234, 212, 0.1);
}

.summary-stack {
  display: grid;
  gap: 10px;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(148, 163, 184, 0.1);
}

.status-pill {
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(255, 255, 255, 0.03);
}

.status-pill[data-tone="ok"] {
  color: #86efac;
  border-color: rgba(134, 239, 172, 0.24);
}

.status-pill[data-tone="warn"] {
  color: #fbbf24;
  border-color: rgba(251, 191, 36, 0.24);
}

@media (max-width: 1120px) {
  .hero-grid,
  .metric-grid,
  .content-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .chart-header,
  .side-card-head {
    flex-direction: column;
  }

  .chart-switchers {
    justify-items: start;
  }

  .detail-grid {
    grid-template-columns: 1fr;
  }

  .date-field input {
    width: 100%;
  }
}
</style>
