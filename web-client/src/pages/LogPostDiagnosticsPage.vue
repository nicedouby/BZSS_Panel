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
        <article
          v-for="stage in stageCards"
          :key="stage.id"
          class="stage-card panel"
          :class="stage.cssClass"
        >
          <div class="stage-title">
            <span>{{ stage.number }}</span>
            <strong>{{ stage.title }}</strong>
          </div>
          <div v-for="row in stage.rows" :key="row.label" class="metric-row">
            <span>{{ row.label }}</span>
            <strong>{{ row.value }}</strong>
          </div>
          <p v-if="stage.path" class="path" :title="stage.path">{{ stage.path }}</p>
        </article>
      </section>

      <section v-if="pythonTimingRows.length" class="panel timing-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">PYTHON STAGE TIMING</p>
            <h2>Python 阶段耗时</h2>
          </div>
          <span>最大单行 {{ formatMs(latest.pipeline?.parser?.maxLineProcessMs) }}</span>
        </div>
        <div class="timing-grid">
          <div v-for="item in pythonTimingRows" :key="item.key" class="timing-item">
            <div>
              <span>{{ item.label }}</span>
              <strong>{{ formatPercent(item.share * 100) }}</strong>
            </div>
            <div class="timing-track"><span :style="{ width: `${Math.min(100, item.share * 100)}%` }" /></div>
            <small>{{ formatMs(item.durationMs) }}</small>
          </div>
        </div>
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
            <div>
              <span>每条原始日志副本</span>
              <strong>{{ latest.pipeline?.output?.writeAmplification?.rawCopiesPerLine ?? "--" }}</strong>
            </div>
            <div>
              <span>每个匹配事件写入</span>
              <strong>{{ latest.pipeline?.output?.writeAmplification?.matchedEventWrites ?? "--" }}</strong>
            </div>
          </div>
          <ul>
            <li v-for="note in latest.pipeline?.output?.writeAmplification?.notes ?? []" :key="note">{{ note }}</li>
          </ul>
        </article>
      </section>

      <section class="panel history-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">LAST {{ historyRows.length }} SAMPLES</p>
            <h2>最近吞吐与积压</h2>
          </div>
          <span>采样周期 {{ state?.sampleIntervalMs ?? 1000 }}ms</span>
        </div>
        <div class="history-table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>源生成</th>
                <th>Python 消费</th>
                <th>源积压</th>
                <th>FileBridge 积压</th>
                <th>Node P95</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in historyRows" :key="row.sampledAt">
                <td>{{ formatTime(row.sampledAt) }}</td>
                <td>{{ formatRate(row.sourceProducedBytesPerSec) }}</td>
                <td>{{ formatRate(row.parserConsumedBytesPerSec) }}</td>
                <td>{{ formatBytes(row.sourceBacklogBytes) }}</td>
                <td>{{ formatBytes(row.bridgeBacklogBytes) }}</td>
                <td>{{ formatMs(row.eventLoopP95Ms) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <details class="panel path-panel">
        <summary>诊断路径与原始状态</summary>
        <dl>
          <template v-for="entry in pathEntries" :key="entry.key">
            <dt>{{ entry.key }}</dt>
            <dd>{{ entry.value }}</dd>
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
type MetricRowData = { label: string; value: string };
type StageCard = {
  id: string;
  number: string;
  title: string;
  rows: MetricRowData[];
  path?: string;
  cssClass?: string;
};

const state = ref<DiagnosticState | null>(null);
const loading = ref(false);
const error = ref("");
let timer: number | null = null;
let controller: AbortController | null = null;

const latest = computed(() => state.value?.latest ?? null);
const history = computed<any[]>(() => Array.isArray(state.value?.history) ? state.value.history : []);
const historyRows = computed(() => history.value.slice(-30).reverse());
const pathEntries = computed(() => Object.entries(state.value?.paths ?? {})
  .filter(([key]) => key !== "parserConfig")
  .map(([key, value]) => ({ key, value: formatPathValue(value) })));

const stageCards = computed<StageCard[]>(() => {
  const pipeline = latest.value?.pipeline ?? {};
  return [
    {
      id: "source",
      number: "01",
      title: "Squad.log 输入",
      rows: [
        { label: "文件大小", value: formatBytes(pipeline.sourceFile?.sizeBytes) },
        { label: "生成速率", value: formatRate(pipeline.sourceFile?.producedBytesPerSec) },
        { label: "最后修改", value: formatTime(pipeline.sourceFile?.modifiedAt) },
      ],
      path: pipeline.sourceFile?.path || "未找到",
    },
    {
      id: "python",
      number: "02",
      title: "Python TailReader / Parser",
      rows: [
        { label: "进程状态", value: String(pipeline.parser?.status ?? "unknown") },
        { label: "消费速率", value: formatRate(pipeline.parser?.consumedBytesPerSec) },
        { label: "源文件积压", value: formatBytes(pipeline.parser?.backlogBytes) },
        { label: "预计追平", value: formatSeconds(pipeline.parser?.backlogSeconds) },
        { label: "每秒处理行", value: formatPerSecond(pipeline.parser?.linesProcessedPerSec) },
        { label: "CPU", value: formatPercent(pipeline.parser?.process?.cpuPercent) },
        { label: "内存", value: formatBytes(pipeline.parser?.process?.workingSetBytes) },
        { label: "磁盘写入", value: formatRate(pipeline.parser?.process?.writeBytesPerSec) },
      ],
      cssClass: stageClass("python"),
    },
    {
      id: "output",
      number: "03",
      title: "LogPost 文件输出",
      rows: [
        { label: "all.jsonl 大小", value: formatBytes(pipeline.output?.sizeBytes) },
        { label: "输出速率", value: formatRate(pipeline.output?.producedBytesPerSec) },
        { label: "原始日志副本", value: String(pipeline.output?.writeAmplification?.rawCopiesPerLine ?? "--") },
        { label: "单事件预计写入", value: String(pipeline.output?.writeAmplification?.matchedEventWrites ?? "--") },
      ],
      path: pipeline.output?.path || "未找到",
    },
    {
      id: "bridge",
      number: "04",
      title: "Node FileBridge",
      rows: [
        { label: "消费速率", value: formatRate(pipeline.fileBridge?.consumedBytesPerSec) },
        { label: "积压", value: formatBytes(pipeline.fileBridge?.backlogBytes) },
        { label: "预计追平", value: formatSeconds(pipeline.fileBridge?.backlogSeconds) },
        { label: "最近单轮耗时", value: formatMs(pipeline.fileBridge?.lastTickDurationMs) },
        { label: "重叠轮询跳过", value: String(pipeline.fileBridge?.overlappingTickSkips ?? 0) },
        { label: "理论读取上限", value: formatRate(pipeline.fileBridge?.theoreticalMaxBytesPerSec) },
      ],
      cssClass: stageClass("fileBridge"),
    },
    {
      id: "udp",
      number: "05",
      title: "UDP 投递",
      rows: [
        { label: "数据包速率", value: formatPerSecond(pipeline.udp?.packetsPerSec) },
        { label: "带宽", value: formatRate(pipeline.udp?.bytesPerSec) },
        { label: "累计接收", value: String(pipeline.udp?.packetsReceived ?? 0) },
        { label: "无效 JSON", value: String(pipeline.udp?.invalidJson ?? 0) },
        { label: "超大数据包", value: String(pipeline.udp?.oversizedMessages ?? 0) },
        { label: "BZSS 玩家分块", value: String(pipeline.udp?.bzssCoreChunks ?? 0) },
      ],
      cssClass: stageClass("udp"),
    },
    {
      id: "node",
      number: "06",
      title: "EventBus / Node 主线程",
      rows: [
        { label: "事件消费速率", value: formatPerSecond(pipeline.delivery?.eventsPerSec) },
        { label: "事件序号缺口", value: String(pipeline.delivery?.metrics?.eventGapCount ?? 0) },
        { label: "事件延迟 P95", value: formatMs(pipeline.delivery?.metrics?.p95EventLatencyMs) },
        { label: "事件循环 P95", value: formatMs(pipeline.node?.eventLoopP95Ms) },
        { label: "事件循环最大", value: formatMs(pipeline.node?.eventLoopMaxMs) },
        { label: "Node RSS", value: formatBytes(pipeline.node?.rssBytes) },
      ],
      cssClass: stageClass("node"),
    },
  ];
});

const pythonTimingRows = computed(() => {
  const shares = latest.value?.pipeline?.parser?.stageShare ?? {};
  const durations = latest.value?.pipeline?.parser?.stageDurationsMs ?? {};
  const definitions = [
    ["read", "TailReader 读取", "tail_read"],
    ["parse", "解析", "bzss_parse"],
    ["fileIo", "文件落盘", "raw_archive_write"],
    ["udp", "UDP 发送", "udp_send"],
    ["other", "其他同步工作", "process_total"],
  ] as const;
  return definitions
    .map(([key, label, durationKey]) => ({
      key,
      label,
      share: numberValue(shares[key]),
      durationMs: numberValue(durations[durationKey]),
    }))
    .filter((item) => item.share > 0 || item.durationMs > 0);
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
    if ((reason as { name?: string })?.name !== "AbortError") {
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

function formatPathValue(value: unknown) {
  if (value == null) return "--";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatBytes(value: unknown) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
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
  overflow: auto;
}
.panel {
  border: 1px solid var(--color-border-soft);
  border-radius: 14px;
  background: var(--color-bg-card);
  box-shadow: var(--shadow-sm);
}
.page-header,
.headline,
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.page-header { padding: 18px 20px; }
.headline { padding: 14px 18px; }
.eyebrow { margin: 0 0 5px; color: var(--color-brand-primary); font-size: 10px; font-weight: 800; letter-spacing: .18em; }
h1, h2, p { margin-top: 0; }
h1 { margin-bottom: 6px; font-size: 24px; }
h2 { margin-bottom: 0; font-size: 17px; }
.subtitle { margin-bottom: 0; color: var(--color-text-muted); font-size: 13px; }
.header-status, .headline-metrics { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
.status-pill { padding: 6px 10px; border-radius: 999px; border: 1px solid var(--color-border-soft); font-size: 12px; font-weight: 800; }
.status-healthy { color: var(--color-status-success); }
.status-warning { color: var(--color-status-warning); }
.status-critical { color: var(--color-status-danger); }
.sample-time { color: var(--color-text-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.refresh-button { min-height: 34px; padding: 0 12px; border: 1px solid var(--color-border-default); border-radius: 9px; background: var(--color-bg-elevated); color: var(--color-text-primary); cursor: pointer; }
.refresh-button:disabled { opacity: .55; cursor: wait; }
.error-banner { padding: 12px 14px; display: flex; gap: 10px; color: var(--color-status-danger); }
.headline > div:first-child { display: grid; gap: 4px; }
.headline > div:first-child span { color: var(--color-text-muted); font-size: 11px; }
.headline > div:first-child strong { font-size: 17px; }
.headline-warning { border-color: color-mix(in srgb, var(--color-status-warning) 40%, var(--color-border-soft)); }
.headline-critical { border-color: color-mix(in srgb, var(--color-status-danger) 46%, var(--color-border-soft)); }
.metric-value { min-width: 110px; padding: 8px 10px; border-radius: 10px; background: var(--color-bg-elevated); display: grid; gap: 2px; }
.metric-value span { color: var(--color-text-muted); font-size: 10px; }
.metric-value strong { font-size: 14px; font-variant-numeric: tabular-nums; }
.pipeline-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.stage-card { min-width: 0; padding: 14px; }
.stage-warning { border-color: color-mix(in srgb, var(--color-status-warning) 44%, var(--color-border-soft)); }
.stage-critical { border-color: color-mix(in srgb, var(--color-status-danger) 52%, var(--color-border-soft)); }
.stage-title { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.stage-title span { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 7px; background: var(--color-bg-elevated); color: var(--color-brand-primary); font-size: 10px; font-weight: 900; }
.stage-title strong { font-size: 13px; }
.metric-row { min-height: 28px; display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--color-border-soft); }
.metric-row span { color: var(--color-text-muted); font-size: 11px; }
.metric-row strong { text-align: right; font-size: 12px; font-variant-numeric: tabular-nums; }
.path { margin: 10px 0 0; color: var(--color-text-disabled); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.timing-panel, .diagnosis-panel, .amplification-panel, .history-panel, .path-panel { padding: 16px; }
.section-heading { margin-bottom: 12px; }
.section-heading > span { color: var(--color-text-muted); font-size: 11px; }
.timing-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.timing-item { padding: 10px; border-radius: 10px; background: var(--color-bg-elevated); }
.timing-item > div:first-child { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; }
.timing-track { height: 5px; margin: 8px 0; overflow: hidden; border-radius: 999px; background: var(--color-border-soft); }
.timing-track span { display: block; height: 100%; background: var(--color-brand-primary); }
.timing-item small { color: var(--color-text-muted); }
.diagnosis-layout { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, .8fr); gap: 12px; }
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
.history-table-wrap { overflow: auto; }
table { width: 100%; border-collapse: collapse; font-size: 11px; }
th, td { padding: 8px 10px; border-bottom: 1px solid var(--color-border-soft); text-align: right; white-space: nowrap; }
th:first-child, td:first-child { text-align: left; }
th { color: var(--color-text-muted); font-weight: 700; }
td { font-variant-numeric: tabular-nums; }
.path-panel summary { cursor: pointer; color: var(--color-text-secondary); font-size: 12px; font-weight: 700; }
.path-panel dl { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 7px 12px; margin: 14px 0 0; }
.path-panel dt { color: var(--color-text-muted); font-size: 10px; }
.path-panel dd { margin: 0; color: var(--color-text-secondary); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; overflow-wrap: anywhere; }
@media (max-width: 1180px) {
  .pipeline-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .diagnosis-layout { grid-template-columns: 1fr; }
  .timing-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .logpost-diagnostics-page { padding: 10px; }
  .page-header, .headline { align-items: flex-start; flex-direction: column; }
  .header-status, .headline-metrics { justify-content: flex-start; }
  .pipeline-grid, .timing-grid { grid-template-columns: 1fr; }
  .path-panel dl { grid-template-columns: 1fr; }
}
</style>
