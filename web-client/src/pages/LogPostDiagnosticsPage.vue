<template>
  <main class="logpost-diagnostics-page">
    <header class="page-header panel">
      <div>
        <p class="eyebrow">INGESTION PIPELINE</p>
        <h1>LogPost 摄取诊断</h1>
        <p class="subtitle">定位 Squad.log → Python → JSONL/UDP → Node EventBus 各阶段的吞吐、积压和阻塞。</p>
      </div>
      <div class="header-status">
        <span class="status-pill" :class="`status-${latest?.status ?? 'unknown'}`">
          {{ statusLabel(latest?.status) }}
        </span>
        <span class="sample-time">{{ formatTime(latest?.sampledAt) }}</span>
        <button type="button" class="refresh-button" :disabled="loading" @click="refresh">
          {{ loading ? "刷新中" : "立即刷新" }}
        </button>
      </div>
    </header>

    <section v-if="error" class="error-banner panel">
      <strong>诊断数据读取失败</strong>
      <span>{{ error }}</span>
    </section>

    <template v-if="latest">
      <section class="headline panel" :class="`headline-${latest.status}`">
        <div>
          <span>当前判断</span>
          <strong>{{ latest.headline }}</strong>
        </div>
        <div class="headline-metrics">
          <MetricValue label="源日志积压" :value="formatBytes(latest.pipeline?.parser?.backlogBytes)" />
          <MetricValue label="FileBridge 积压" :value="formatBytes(latest.pipeline?.fileBridge?.backlogBytes)" />
          <MetricValue label="Node P95" :value="formatMs(latest.pipeline?.node?.eventLoopP95Ms)" />
        </div>
      </section>

      <section class="pipeline-grid">
        <article class="stage-card panel">
          <div class="stage-title"><span>01</span><strong>Squad.log 输入</strong></div>
          <MetricRow label="文件大小" :value="formatBytes(latest.pipeline?.sourceFile?.sizeBytes)" />
          <MetricRow label="生成速率" :value="formatRate(latest.pipeline?.sourceFile?.producedBytesPerSec)" />
          <MetricRow label="最后修改" :value="formatTime(latest.pipeline?.sourceFile?.modifiedAt)" />
          <p class="path" :title="latest.pipeline?.sourceFile?.path">{{ latest.pipeline?.sourceFile?.path || "未找到" }}</p>
        </article>

        <article class="stage-card panel" :class="stageClass('python')">
          <div class="stage-title"><span>02</span><strong>Python TailReader / Parser</strong></div>
          <MetricRow label="进程状态" :value="latest.pipeline?.parser?.status || 'unknown'" />
          <MetricRow label="消费速率" :value="formatRate(latest.pipeline?.parser?.consumedBytesPerSec)" />
          <MetricRow label="源文件积压" :value="formatBytes(latest.pipeline?.parser?.backlogBytes)" />
          <MetricRow label="预计追平" :value="formatSeconds(latest.pipeline?.parser?.backlogSeconds)" />
          <MetricRow label="CPU" :value="formatPercent(latest.pipeline?.parser?.process?.cpuPercent)" />
          <MetricRow label="内存" :value="formatBytes(latest.pipeline?.parser?.process?.workingSetBytes)" />
          <MetricRow label="磁盘写入" :value="formatRate(latest.pipeline?.parser?.process?.writeBytesPerSec)" />
        </article>

        <article class="stage-card panel">
          <div class="stage-title"><span>03</span><strong>LogPost 文件输出</strong></div>
          <MetricRow label="all.jsonl 大小" :value="formatBytes(latest.pipeline?.output?.sizeBytes)" />
          <MetricRow label="输出速率" :value="formatRate(latest.pipeline?.output?.producedBytesPerSec)" />
          <MetricRow label="原始日志副本" :value="String(latest.pipeline?.output?.writeAmplification?.rawCopiesPerLine ?? '--')" />
          <MetricRow label="单事件预计写入" :value="String(latest.pipeline?.output?.writeAmplification?.matchedEventWrites ?? '--')" />
          <p class="path" :title="latest.pipeline?.output?.path">{{ latest.pipeline?.output?.path || "未找到" }}</p>
        </article>

        <article class="stage-card panel" :class="stageClass('fileBridge')">
          <div class="stage-title"><span>04</span><strong>Node FileBridge</strong></div>
          <MetricRow label="消费速率" :value="formatRate(latest.pipeline?.fileBridge?.consumedBytesPerSec)" />
          <MetricRow label="积压" :value="formatBytes(latest.pipeline?.fileBridge?.backlogBytes)" />
          <MetricRow label="预计追平" :value="formatSeconds(latest.pipeline?.fileBridge?.backlogSeconds)" />
          <MetricRow label="最近单轮耗时" :value="formatMs(latest.pipeline?.fileBridge?.lastTickDurationMs)" />
          <MetricRow label="重叠轮询跳过" :value="String(latest.pipeline?.fileBridge?.overlappingTickSkips ?? 0)" />
          <MetricRow label="理论读取上限" :value="formatRate(latest.pipeline?.fileBridge?.theoreticalMaxBytesPerSec)" />
        </article>

        <article class="stage-card panel" :class="stageClass('udp')">
          <div class="stage-title"><span>05</span><strong>UDP 投递</strong></div>
          <MetricRow label="数据包速率" :value="formatPerSecond(latest.pipeline?.udp?.packetsPerSec)" />
          <MetricRow label="带宽" :value="formatRate(latest.pipeline?.udp?.bytesPerSec)" />
          <MetricRow label="累计接收" :value="String(latest.pipeline?.udp?.packetsReceived ?? 0)" />
          <MetricRow label="无效 JSON" :value="String(latest.pipeline?.udp?.invalidJson ?? 0)" />
          <MetricRow label="超大数据包" :value="String(latest.pipeline?.udp?.oversizedMessages ?? 0)" />
          <MetricRow label="BZSS 玩家分块" :value="String(latest.pipeline?.udp?.bzssCoreChunks ?? 0)" />
        </article>

        <article class="stage-card panel" :class="stageClass('node')">
          <div class="stage-title"><span>06</span><strong>EventBus / Node 主线程</strong></div>
          <MetricRow label="事件消费速率" :value="formatPerSecond(latest.pipeline?.delivery?.eventsPerSec)" />
          <MetricRow label="事件序号缺口" :value="String(latest.pipeline?.delivery?.metrics?.eventGapCount ?? 0)" />
          <MetricRow label="事件延迟 P95" :value="formatMs(latest.pipeline?.delivery?.metrics?.p95EventLatencyMs)" />
          <MetricRow label="事件循环 P95" :value="formatMs(latest.pipeline?.node?.eventLoopP95Ms)" />
          <MetricRow label="事件循环最大" :value="formatMs(latest.pipeline?.node?.eventLoopMaxMs)" />
          <MetricRow label="Node RSS" :value="formatBytes(latest.pipeline?.node?.rssBytes)" />
        </article>
      </section>

      <section class="diagnosis-layout">
        <article class="panel diagnosis-panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">BOTTLENECK ANALYSIS</p>
              <h2>瓶颈判断</h2>
            </div>
            <span>{{ latest.bottlenecks?.length ?? 0 }} 项</span>
          </div>

          <div v-if="!latest.bottlenecks?.length" class="empty-state">
            当前采样没有发现持续积压、序号缺口或主线程阻塞。
          </div>
          <div v-else class="bottleneck-list">
            <article
              v-for="item in latest.bottlenecks"
              :key="`${item.stage}-${item.title}`"
              class="bottleneck-item"
              :class="`severity-${item.severity}`"
            >
              <div class="bottleneck-head">
                <span>{{ item.severity === "critical" ? "严重" : "警告" }}</span>
                <strong>{{ item.title }}</strong>
                <code>{{ item.stage }}</code>
              </div>
              <p>{{ item.evidence }}</p>
              <div class="recommendation">{{ item.recommendation }}</div>
            </article>
          </div>
        </article>

        <article class="panel amplification-panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">WRITE AMPLIFICATION</p>
              <h2>写入放大</h2>
            </div>
          </div>
          <div class="amplification-score">
            <div><span>每条原始日志副本</span><strong>{{ latest.pipeline?.output?.writeAmplification?.rawCopiesPerLine ?? "--" }}</strong></div>
            <div><span>每个匹配事件写入</span><strong>{{ latest.pipeline?.output?.writeAmplification?.matchedEventWrites ?? "--" }}</strong></div>
          </div>
          <ul>
            <li v-for="note in latest.pipeline?.output?.writeAmplification?.notes ?? []" :key="note">{{ note }}</li>
          </ul>
        </article>
      </section>

      <section class="panel history-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">LAST {{ history.length }} SAMPLES</p>
            <h2>吞吐与积压趋势</h2>
          </div>
          <span>采样周期 {{ state?.sampleIntervalMs ?? 1000 }}ms</span>
        </div>

        <div class="trend-grid">
          <TrendChart
            title="源日志：生成 vs Python 消费"
            :history="history"
            first-key="sourceProducedBytesPerSec"
            second-key="parserConsumedBytesPerSec"
            first-label="生成"
            second-label="消费"
            value-type="rate"
          />
          <TrendChart
            title="LogPost：输出 vs FileBridge 消费"
            :history="history"
            first-key="outputProducedBytesPerSec"
            second-key="bridgeConsumedBytesPerSec"
            first-label="输出"
            second-label="消费"
            value-type="rate"
          />
          <TrendChart
            title="积压趋势"
            :history="history"
            first-key="sourceBacklogBytes"
            second-key="bridgeBacklogBytes"
            first-label="源日志"
            second-label="FileBridge"
            value-type="bytes"
          />
          <TrendChart
            title="运行压力"
            :history="history"
            first-key="eventLoopP95Ms"
            second-key="parserCpuPercent"
            first-label="Node P95 ms"
            second-label="Python CPU %"
            value-type="number"
          />
        </div>
      </section>

      <details class="panel path-panel">
        <summary>诊断路径与原始状态</summary>
        <dl>
          <template v-for="(value, key) in state?.paths ?? {}" :key="key">
            <dt v-if="key !== 'parserConfig'">{{ key }}</dt>
            <dd v-if="key !== 'parserConfig'">{{ value }}</dd>
          </template>
        </dl>
      </details>
    </template>

    <section v-else-if="loading" class="loading-state panel">正在建立第一组 LogPost 诊断样本……</section>
  </main>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref } from "vue";

type DiagnosticState = Record<string, any>;

const state = ref<DiagnosticState | null>(null);
const loading = ref(false);
const error = ref("");
let timer: number | null = null;
let controller: AbortController | null = null;

const latest = computed(() => state.value?.latest ?? null);
const history = computed(() => Array.isArray(state.value?.history) ? state.value.history : []);

const MetricRow = defineComponent({
  props: { label: String, value: String },
  setup(props) {
    return () => h("div", { class: "metric-row" }, [
      h("span", props.label),
      h("strong", props.value || "--"),
    ]);
  },
});

const MetricValue = defineComponent({
  props: { label: String, value: String },
  setup(props) {
    return () => h("div", { class: "metric-value" }, [
      h("span", props.label),
      h("strong", props.value || "--"),
    ]);
  },
});

const TrendChart = defineComponent({
  props: {
    title: { type: String, required: true },
    history: { type: Array as () => any[], required: true },
    firstKey: { type: String, required: true },
    secondKey: { type: String, required: true },
    firstLabel: { type: String, required: true },
    secondLabel: { type: String, required: true },
    valueType: { type: String, default: "number" },
  },
  setup(props) {
    const values = computed(() => props.history.flatMap((item) => [numberValue(item?.[props.firstKey]), numberValue(item?.[props.secondKey])]));
    const maxValue = computed(() => Math.max(1, ...values.value));
    const points = (key: string) => props.history.map((item, index) => {
      const width = 300;
      const height = 96;
      const x = props.history.length <= 1 ? 0 : (index / (props.history.length - 1)) * width;
      const y = height - (numberValue(item?.[key]) / maxValue.value) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const latestValue = (key: string) => {
      const value = props.history.at(-1)?.[key];
      if (props.valueType === "bytes") return formatBytes(value);
      if (props.valueType === "rate") return formatRate(value);
      return numberValue(value).toFixed(1);
    };
    return () => h("article", { class: "trend-card" }, [
      h("div", { class: "trend-title" }, props.title),
      h("svg", { viewBox: "0 0 300 96", preserveAspectRatio: "none", role: "img", "aria-label": props.title }, [
        h("polyline", { class: "trend-line trend-line-first", points: points(props.firstKey), fill: "none" }),
        h("polyline", { class: "trend-line trend-line-second", points: points(props.secondKey), fill: "none" }),
      ]),
      h("div", { class: "trend-legend" }, [
        h("span", { class: "legend-first" }, `${props.firstLabel} ${latestValue(props.firstKey)}`),
        h("span", { class: "legend-second" }, `${props.secondLabel} ${latestValue(props.secondKey)}`),
      ]),
    ]);
  },
});

async function refresh() {
  if (loading.value) return;
  loading.value = true;
  controller?.abort();
  controller = new AbortController();
  const timeout = window.setTimeout(() => controller?.abort("timeout"), 4000);
  try {
    const response = await fetch("/api/modules/logpost-diagnostics/state", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.value = payload?.data ?? payload;
    error.value = "";
  } catch (reason) {
    if ((reason as any)?.name !== "AbortError") {
      error.value = reason instanceof Error ? reason.message : "未知错误";
    }
  } finally {
    window.clearTimeout(timeout);
    loading.value = false;
  }
}

function stageClass(stage: string) {
  const bottlenecks = latest.value?.bottlenecks ?? [];
  const related = bottlenecks.find((item: any) => {
    const value = String(item?.stage ?? "");
    if (stage === "python") return value.startsWith("python");
    if (stage === "fileBridge") return value.includes("file-bridge");
    if (stage === "node") return value.includes("node-main-thread");
    if (stage === "udp") return value === "udp" || value === "transport";
    return false;
  });
  return related ? `stage-${related.severity}` : "";
}

function statusLabel(value: unknown) {
  if (value === "critical") return "严重瓶颈";
  if (value === "warning") return "存在风险";
  if (value === "healthy") return "运行正常";
  return "等待采样";
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function formatBytes(value: unknown) {
  const bytes = numberValue(value);
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

function formatRate(value: unknown) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  return `${formatBytes(value)}/s`;
}

function formatPerSecond(value: unknown) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  return `${Number(value).toFixed(1)}/s`;
}

function formatMs(value: unknown) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  return `${Number(value).toFixed(1)} ms`;
}

function formatPercent(value: unknown) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  return `${Number(value).toFixed(1)}%`;
}

function formatSeconds(value: unknown) {
  if (value == null || !Number.isFinite(Number(value))) return "无法追平";
  const seconds = Number(value);
  if (seconds < 1) return "<1 秒";
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  return `${(seconds / 60).toFixed(1)} 分钟`;
}

function formatTime(value: unknown) {
  const date = new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) return "--";
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

onMounted(() => {
  void refresh();
  timer = window.setInterval(() => void refresh(), 1000);
});

onBeforeUnmount(() => {
  if (timer != null) window.clearInterval(timer);
  controller?.abort("page-unmounted");
});
</script>

<style scoped>
.logpost-diagnostics-page {
  min-height: 100%;
  padding: 16px;
  display: grid;
  gap: 14px;
  color: var(--color-text-primary);
}

.panel {
  border: 1px solid var(--color-border-soft);
  border-radius: 14px;
  background: var(--color-bg-card);
  box-shadow: var(--shadow-sm);
}

.page-header {
  padding: 18px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.eyebrow {
  margin: 0 0 5px;
  color: var(--color-brand-primary);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .18em;
}

h1, h2, p { margin-top: 0; }
h1 { margin-bottom: 6px; font-size: 24px; }
h2 { margin-bottom: 0; font-size: 17px; }
.subtitle { margin-bottom: 0; color: var(--color-text-muted); font-size: 13px; }

.header-status { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
.status-pill { padding: 6px 10px; border-radius: 999px; border: 1px solid var(--color-border-soft); font-size: 12px; font-weight: 800; }
.status-healthy { color: var(--color-status-success); background: color-mix(in srgb, var(--color-status-success) 12%, transparent); }
.status-warning { color: var(--color-status-warning); background: color-mix(in srgb, var(--color-status-warning) 12%, transparent); }
.status-critical { color: var(--color-status-danger); background: color-mix(in srgb, var(--color-status-danger) 12%, transparent); }
.sample-time { color: var(--color-text-muted); font-variant-numeric: tabular-nums; font-size: 12px; }
.refresh-button { min-height: 34px; padding: 0 12px; border: 1px solid var(--color-border-default); border-radius: 9px; background: var(--color-bg-elevated); color: var(--color-text-primary); cursor: pointer; }
.refresh-button:disabled { opacity: .55; cursor: wait; }

.error-banner { padding: 12px 14px; display: flex; gap: 10px; color: var(--color-status-danger); }
.headline { padding: 14px 18px; display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.headline > div:first-child { display: grid; gap: 4px; }
.headline > div:first-child span { color: var(--color-text-muted); font-size: 11px; }
.headline > div:first-child strong { font-size: 17px; }
.headline-warning { border-color: color-mix(in srgb, var(--color-status-warning) 40%, var(--color-border-soft)); }
.headline-critical { border-color: color-mix(in srgb, var(--color-status-danger) 46%, var(--color-border-soft)); }
.headline-metrics { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
.metric-value { min-width: 110px; padding: 8px 10px; border-radius: 10px; background: var(--color-bg-elevated); display: grid; gap: 2px; }
.metric-value span { color: var(--color-text-muted); font-size: 10px; }
.metric-value strong { font-size: 14px; font-variant-numeric: tabular-nums; }

.pipeline-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.stage-card { padding: 14px; min-width: 0; }
.stage-warning { border-color: color-mix(in srgb, var(--color-status-warning) 44%, var(--color-border-soft)); }
.stage-critical { border-color: color-mix(in srgb, var(--color-status-danger) 52%, var(--color-border-soft)); }
.stage-title { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.stage-title span { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 7px; background: var(--color-bg-elevated); color: var(--color-brand-primary); font-size: 10px; font-weight: 900; }
.stage-title strong { font-size: 13px; }
:deep(.metric-row) { min-height: 28px; display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--color-border-soft); }
:deep(.metric-row span) { color: var(--color-text-muted); font-size: 11px; }
:deep(.metric-row strong) { text-align: right; font-size: 12px; font-variant-numeric: tabular-nums; }
.path { margin: 10px 0 0; color: var(--color-text-disabled); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.diagnosis-layout { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, .8fr); gap: 12px; }
.diagnosis-panel, .amplification-panel, .history-panel, .path-panel { padding: 16px; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.section-heading > span { color: var(--color-text-muted); font-size: 11px; }
.bottleneck-list { display: grid; gap: 9px; }
.bottleneck-item { padding: 11px 12px; border: 1px solid var(--color-border-soft); border-radius: 11px; background: var(--color-bg-elevated); }
.bottleneck-item.severity-warning { border-left: 3px solid var(--color-status-warning); }
.bottleneck-item.severity-critical { border-left: 3px solid var(--color-status-danger); }
.bottleneck-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bottleneck-head > span { color: var(--color-text-muted); font-size: 10px; }
.bottleneck-head strong { flex: 1; font-size: 13px; }
.bottleneck-head code { color: var(--color-text-disabled); font-size: 9px; }
.bottleneck-item p { margin: 7px 0; color: var(--color-text-secondary); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; }
.recommendation { color: var(--color-text-muted); font-size: 11px; line-height: 1.5; }
.empty-state, .loading-state { padding: 22px; text-align: center; color: var(--color-text-muted); }
.amplification-score { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.amplification-score div { padding: 12px; border-radius: 10px; background: var(--color-bg-elevated); display: grid; gap: 4px; }
.amplification-score span { color: var(--color-text-muted); font-size: 10px; }
.amplification-score strong { font-size: 22px; }
.amplification-panel ul { margin: 12px 0 0; padding-left: 18px; color: var(--color-text-muted); font-size: 11px; line-height: 1.6; }

.trend-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
:deep(.trend-card) { min-width: 0; padding: 11px; border: 1px solid var(--color-border-soft); border-radius: 11px; background: var(--color-bg-elevated); }
:deep(.trend-title) { margin-bottom: 7px; color: var(--color-text-secondary); font-size: 11px; font-weight: 700; }
:deep(.trend-card svg) { width: 100%; height: 96px; display: block; overflow: visible; background: linear-gradient(to bottom, transparent 49%, var(--color-border-soft) 50%, transparent 51%); }
:deep(.trend-line) { vector-effect: non-scaling-stroke; stroke-width: 1.8; }
:deep(.trend-line-first) { stroke: var(--color-brand-primary); }
:deep(.trend-line-second) { stroke: var(--color-brand-secondary); }
:deep(.trend-legend) { margin-top: 7px; display: flex; justify-content: space-between; gap: 8px; color: var(--color-text-muted); font-size: 9px; font-variant-numeric: tabular-nums; }
:deep(.legend-first)::before, :deep(.legend-second)::before { content: ""; display: inline-block; width: 7px; height: 2px; margin-right: 4px; vertical-align: middle; }
:deep(.legend-first)::before { background: var(--color-brand-primary); }
:deep(.legend-second)::before { background: var(--color-brand-secondary); }

.path-panel summary { cursor: pointer; color: var(--color-text-secondary); font-size: 12px; font-weight: 700; }
.path-panel dl { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 7px 12px; margin: 14px 0 0; }
.path-panel dt { color: var(--color-text-muted); font-size: 10px; }
.path-panel dd { margin: 0; color: var(--color-text-secondary); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; overflow-wrap: anywhere; }

@media (max-width: 1180px) {
  .pipeline-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .diagnosis-layout { grid-template-columns: 1fr; }
}

@media (max-width: 760px) {
  .logpost-diagnostics-page { padding: 10px; }
  .page-header, .headline { align-items: flex-start; flex-direction: column; }
  .header-status, .headline-metrics { justify-content: flex-start; }
  .pipeline-grid, .trend-grid { grid-template-columns: 1fr; }
  .path-panel dl { grid-template-columns: 1fr; }
}
</style>
