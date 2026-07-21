<template>
  <main class="logpost-diagnostics-page">
    <header class="page-header panel">
      <div class="page-title-block">
        <p class="eyebrow">INGESTION PIPELINE</p>
        <div class="title-row">
          <h1>LogPost 摄取诊断</h1>
          <span class="live-indicator" :class="{ active: Boolean(latest) && !error }">
            <i />实时采样
          </span>
        </div>
        <p class="subtitle">Squad.log → Python Parser → JSONL / UDP → Node EventBus</p>
      </div>

      <div class="header-actions">
        <div class="sample-meta">
          <span>最近采样</span>
          <strong>{{ formatTime(latest?.sampledAt) }}</strong>
        </div>
        <span class="status-pill" :class="`status-${latest?.status ?? 'unknown'}`">
          {{ statusLabel(latest?.status) }}
        </span>
        <button type="button" class="refresh-button" :disabled="loading" @click="refresh">
          <span :class="{ spinning: loading }">↻</span>
          {{ loading ? "刷新中" : "立即刷新" }}
        </button>
      </div>
    </header>

    <section v-if="error" class="error-banner panel">
      <div class="error-icon">!</div>
      <div>
        <strong>诊断数据读取失败</strong>
        <span>{{ error }}</span>
      </div>
    </section>

    <template v-if="latest">
      <section class="overview panel" :class="`overview-${latest.status}`">
        <div class="overview-summary">
          <span class="overview-label">当前判断</span>
          <strong>{{ latest.headline }}</strong>
          <small>{{ throughputSummary }}</small>
        </div>

        <div class="overview-metrics">
          <MetricValue label="源生成" :value="formatRate(latest.pipeline?.sourceFile?.producedBytesPerSec)" />
          <MetricValue label="Python 消费" :value="formatRate(latest.pipeline?.parser?.consumedBytesPerSec)" />
          <MetricValue
            label="源日志积压"
            :value="formatBytes(latest.pipeline?.parser?.backlogBytes)"
            :tone="numberValue(latest.pipeline?.parser?.backlogBytes) > 0 ? 'warning' : 'normal'"
          />
          <MetricValue
            label="FileBridge 积压"
            :value="formatBytes(latest.pipeline?.fileBridge?.backlogBytes)"
            :tone="numberValue(latest.pipeline?.fileBridge?.backlogBytes) > 0 ? 'warning' : 'normal'"
          />
          <MetricValue
            label="Node P95"
            :value="formatMs(latest.pipeline?.node?.eventLoopP95Ms)"
            :tone="eventLoopTone(latest.pipeline?.node?.eventLoopP95Ms)"
          />
        </div>
      </section>

      <section class="panel pipeline-panel">
        <div class="section-heading pipeline-heading">
          <div>
            <p class="eyebrow">PIPELINE STAGES</p>
            <h2>实时摄取链路</h2>
          </div>
          <span>6 个阶段 · {{ state?.sampleIntervalMs ?? 1000 }}ms 采样</span>
        </div>

        <div class="pipeline-scroll">
          <div class="pipeline-track">
            <article
              v-for="(stage, index) in stageCards"
              :key="stage.id"
              class="stage-card"
              :class="stage.cssClass"
            >
              <div class="stage-header">
                <div class="stage-number">{{ stage.number }}</div>
                <div class="stage-heading-copy">
                  <strong>{{ stage.title }}</strong>
                  <span>{{ stage.subtitle }}</span>
                </div>
                <span class="stage-state">{{ stage.stateLabel }}</span>
              </div>

              <div class="stage-primary">
                <span>{{ stage.primaryLabel }}</span>
                <strong>{{ stage.primaryValue }}</strong>
              </div>

              <div class="stage-metrics">
                <div v-for="row in stage.rows" :key="row.label" class="metric-row">
                  <span>{{ row.label }}</span>
                  <strong>{{ row.value }}</strong>
                </div>
              </div>

              <p v-if="stage.path" class="path" :title="stage.path">{{ stage.path }}</p>
              <span v-if="index < stageCards.length - 1" class="stage-connector" aria-hidden="true">›</span>
            </article>
          </div>
        </div>
      </section>

      <section class="analysis-layout">
        <article class="panel diagnosis-panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">BOTTLENECK ANALYSIS</p>
              <h2>瓶颈判断</h2>
            </div>
            <span class="count-badge" :class="{ danger: latest.bottlenecks?.length }">
              {{ latest.bottlenecks?.length ?? 0 }} 项
            </span>
          </div>

          <div v-if="!latest.bottlenecks?.length" class="empty-state healthy-empty">
            <span>✓</span>
            <div>
              <strong>链路当前稳定</strong>
              <p>没有发现持续积压、事件序号缺口或 Node 主线程阻塞。</p>
            </div>
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
              <p class="evidence">{{ item.evidence }}</p>
              <div class="recommendation">
                <span>建议</span>
                <p>{{ item.recommendation }}</p>
              </div>
            </article>
          </div>
        </article>

        <div class="analysis-side">
          <article v-if="pythonTimingRows.length" class="panel timing-panel">
            <div class="section-heading">
              <div>
                <p class="eyebrow">PYTHON TIMING</p>
                <h2>Python 阶段耗时</h2>
              </div>
              <span>最大单行 {{ formatMs(latest.pipeline?.parser?.maxLineProcessMs) }}</span>
            </div>

            <div class="timing-list">
              <div v-for="item in pythonTimingRows" :key="item.key" class="timing-item">
                <div class="timing-copy">
                  <span>{{ item.label }}</span>
                  <strong>{{ formatMs(item.durationMs) }}</strong>
                </div>
                <div class="timing-track">
                  <span :style="{ width: `${Math.min(100, item.share * 100)}%` }" />
                </div>
                <small>{{ formatPercent(item.share * 100) }}</small>
              </div>
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
                <span>原始日志副本</span>
                <strong>{{ latest.pipeline?.output?.writeAmplification?.rawCopiesPerLine ?? "--" }}</strong>
                <small>每条原始日志</small>
              </div>
              <div>
                <span>匹配事件写入</span>
                <strong>{{ latest.pipeline?.output?.writeAmplification?.matchedEventWrites ?? "--" }}</strong>
                <small>每个匹配事件</small>
              </div>
            </div>

            <ul v-if="latest.pipeline?.output?.writeAmplification?.notes?.length">
              <li v-for="note in latest.pipeline.output.writeAmplification.notes" :key="note">{{ note }}</li>
            </ul>
            <p v-else class="no-notes">暂无额外写入说明。</p>
          </article>
        </div>
      </section>

      <section class="panel history-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">LAST {{ historyRows.length }} SAMPLES</p>
            <h2>最近吞吐与积压</h2>
          </div>
          <span>最新样本位于顶部</span>
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
              <tr v-for="(row, index) in historyRows" :key="row.sampledAt" :class="{ latest: index === 0 }">
                <td>
                  <span v-if="index === 0" class="latest-dot" />
                  {{ formatTime(row.sampledAt) }}
                </td>
                <td>{{ formatRate(row.sourceProducedBytesPerSec) }}</td>
                <td>{{ formatRate(row.parserConsumedBytesPerSec) }}</td>
                <td :class="{ 'cell-warning': numberValue(row.sourceBacklogBytes) > 0 }">
                  {{ formatBytes(row.sourceBacklogBytes) }}
                </td>
                <td :class="{ 'cell-warning': numberValue(row.bridgeBacklogBytes) > 0 }">
                  {{ formatBytes(row.bridgeBacklogBytes) }}
                </td>
                <td :class="`cell-${eventLoopTone(row.eventLoopP95Ms)}`">
                  {{ formatMs(row.eventLoopP95Ms) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <details class="panel path-panel">
        <summary>
          <span>诊断路径与原始状态</span>
          <small>用于核对配置文件、日志和输出位置</small>
        </summary>
        <dl>
          <template v-for="entry in pathEntries" :key="entry.key">
            <dt>{{ entry.key }}</dt>
            <dd>{{ entry.value }}</dd>
          </template>
        </dl>
      </details>
    </template>

    <section v-else-if="loading" class="loading-state panel">
      <span class="loading-spinner" />
      正在建立第一组 LogPost 诊断样本……
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref } from "vue";

type DiagnosticState = Record<string, any>;
type MetricTone = "normal" | "warning" | "critical";
type MetricRowData = { label: string; value: string };
type StageCard = {
  id: string;
  number: string;
  title: string;
  subtitle: string;
  stateLabel: string;
  primaryLabel: string;
  primaryValue: string;
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

const throughputSummary = computed(() => {
  const produced = numberValue(latest.value?.pipeline?.sourceFile?.producedBytesPerSec);
  const consumed = numberValue(latest.value?.pipeline?.parser?.consumedBytesPerSec);
  const parserStatus = String(latest.value?.pipeline?.parser?.status ?? "unknown").toLowerCase();

  if (parserStatus === "disabled" || parserStatus === "stopped" || parserStatus === "offline") {
    return "Python 摄取进程当前未工作，吞吐对比无效。";
  }
  if (produced <= 0 && consumed <= 0) return "当前没有新的日志流量。";

  const delta = consumed - produced;
  if (Math.abs(delta) < 1) return "Python 消费速率与源日志生成速率基本持平。";
  if (delta > 0) return `Python 当前比输入快 ${formatRate(delta)}，正在追赶或保持低积压。`;
  return `输入当前比 Python 消费快 ${formatRate(Math.abs(delta))}，需要关注积压增长。`;
});

const stageCards = computed<StageCard[]>(() => {
  const pipeline = latest.value?.pipeline ?? {};
  return [
    {
      id: "source",
      number: "01",
      title: "Squad.log",
      subtitle: "日志输入",
      stateLabel: pipeline.sourceFile?.path ? "已连接" : "未找到",
      primaryLabel: "生成速率",
      primaryValue: formatRate(pipeline.sourceFile?.producedBytesPerSec),
      rows: [
        { label: "文件大小", value: formatBytes(pipeline.sourceFile?.sizeBytes) },
        { label: "最后修改", value: formatTime(pipeline.sourceFile?.modifiedAt) },
      ],
      path: pipeline.sourceFile?.path || "未找到",
      cssClass: stageClass("source"),
    },
    {
      id: "python",
      number: "02",
      title: "Python Parser",
      subtitle: "读取与解析",
      stateLabel: parserStatusLabel(pipeline.parser?.status),
      primaryLabel: "消费速率",
      primaryValue: formatRate(pipeline.parser?.consumedBytesPerSec),
      rows: [
        { label: "源文件积压", value: formatBytes(pipeline.parser?.backlogBytes) },
        { label: "预计追平", value: formatSeconds(pipeline.parser?.backlogSeconds) },
        { label: "处理行数", value: formatPerSecond(pipeline.parser?.linesProcessedPerSec) },
        { label: "CPU / 内存", value: `${formatPercent(pipeline.parser?.process?.cpuPercent)} / ${formatBytes(pipeline.parser?.process?.workingSetBytes)}` },
        { label: "磁盘写入", value: formatRate(pipeline.parser?.process?.writeBytesPerSec) },
      ],
      cssClass: stageClass("python"),
    },
    {
      id: "output",
      number: "03",
      title: "JSONL Output",
      subtitle: "文件输出",
      stateLabel: pipeline.output?.path ? "可用" : "未找到",
      primaryLabel: "输出速率",
      primaryValue: formatRate(pipeline.output?.producedBytesPerSec),
      rows: [
        { label: "all.jsonl 大小", value: formatBytes(pipeline.output?.sizeBytes) },
        { label: "原始副本", value: String(pipeline.output?.writeAmplification?.rawCopiesPerLine ?? "--") },
        { label: "事件写入", value: String(pipeline.output?.writeAmplification?.matchedEventWrites ?? "--") },
      ],
      path: pipeline.output?.path || "未找到",
      cssClass: stageClass("output"),
    },
    {
      id: "bridge",
      number: "04",
      title: "FileBridge",
      subtitle: "Node 文件桥",
      stateLabel: numberValue(pipeline.fileBridge?.backlogBytes) > 0 ? "有积压" : "同步",
      primaryLabel: "消费速率",
      primaryValue: formatRate(pipeline.fileBridge?.consumedBytesPerSec),
      rows: [
        { label: "当前积压", value: formatBytes(pipeline.fileBridge?.backlogBytes) },
        { label: "预计追平", value: formatSeconds(pipeline.fileBridge?.backlogSeconds) },
        { label: "单轮耗时", value: formatMs(pipeline.fileBridge?.lastTickDurationMs) },
        { label: "重叠跳过", value: String(pipeline.fileBridge?.overlappingTickSkips ?? 0) },
        { label: "理论上限", value: formatRate(pipeline.fileBridge?.theoreticalMaxBytesPerSec) },
      ],
      cssClass: stageClass("fileBridge"),
    },
    {
      id: "udp",
      number: "05",
      title: "UDP Transport",
      subtitle: "实时投递",
      stateLabel: numberValue(pipeline.udp?.invalidJson) > 0 ? "有错误" : "监听中",
      primaryLabel: "数据包速率",
      primaryValue: formatPerSecond(pipeline.udp?.packetsPerSec),
      rows: [
        { label: "传输带宽", value: formatRate(pipeline.udp?.bytesPerSec) },
        { label: "累计接收", value: String(pipeline.udp?.packetsReceived ?? 0) },
        { label: "无效 JSON", value: String(pipeline.udp?.invalidJson ?? 0) },
        { label: "超大包", value: String(pipeline.udp?.oversizedMessages ?? 0) },
        { label: "玩家分块", value: String(pipeline.udp?.bzssCoreChunks ?? 0) },
      ],
      cssClass: stageClass("udp"),
    },
    {
      id: "node",
      number: "06",
      title: "Node EventBus",
      subtitle: "事件消费",
      stateLabel: numberValue(pipeline.delivery?.metrics?.eventGapCount) > 0 ? "序号缺口" : "运行中",
      primaryLabel: "事件消费速率",
      primaryValue: formatPerSecond(pipeline.delivery?.eventsPerSec),
      rows: [
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
    ["parse", "日志解析", "bzss_parse"],
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
  props: {
    label: String,
    value: String,
    tone: { type: String, default: "normal" },
  },
  setup(props) {
    return () => h("div", { class: ["metric-value", `metric-${props.tone}`] }, [
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
    const value = String(item?.stage ?? "").toLowerCase();
    if (stage === "source") return value.includes("source") || value.includes("squad-log");
    if (stage === "python") return value.startsWith("python") || value.includes("parser");
    if (stage === "output") return value.includes("output") || value.includes("write-amplification");
    if (stage === "fileBridge") return value.includes("file-bridge") || value.includes("filebridge");
    if (stage === "node") return value.includes("node-main-thread") || value.includes("eventbus");
    if (stage === "udp") return value === "udp" || value === "transport" || value.includes("udp");
    return false;
  });
  return related ? `stage-${related.severity}` : "stage-healthy";
}

function statusLabel(value: unknown) {
  if (value === "critical") return "严重瓶颈";
  if (value === "warning") return "存在风险";
  if (value === "healthy") return "运行正常";
  return "等待采样";
}

function parserStatusLabel(value: unknown) {
  const status = String(value ?? "unknown").toLowerCase();
  if (["running", "enabled", "active", "online"].includes(status)) return "运行中";
  if (["disabled", "stopped", "offline"].includes(status)) return "未运行";
  return status === "unknown" ? "未知" : String(value);
}

function eventLoopTone(value: unknown): MetricTone {
  const milliseconds = numberValue(value);
  if (milliseconds >= 100) return "critical";
  if (milliseconds >= 50) return "warning";
  return "normal";
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
  align-content: start;
  gap: 12px;
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
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.page-header {
  padding: 15px 18px;
}

.page-title-block {
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.eyebrow {
  margin: 0 0 4px;
  color: var(--color-brand-primary);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: .18em;
}

h1,
h2,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 4px;
  font-size: 22px;
  line-height: 1.2;
}

h2 {
  margin-bottom: 0;
  font-size: 16px;
}

.subtitle {
  margin-bottom: 0;
  color: var(--color-text-muted);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
}

.live-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 7px;
  border: 1px solid var(--color-border-soft);
  border-radius: 999px;
  color: var(--color-text-muted);
  font-size: 9px;
  font-weight: 700;
}

.live-indicator i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-disabled);
}

.live-indicator.active i {
  background: var(--color-status-success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-status-success) 15%, transparent);
}

.header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.sample-meta {
  display: grid;
  gap: 1px;
  text-align: right;
}

.sample-meta span {
  color: var(--color-text-muted);
  font-size: 9px;
}

.sample-meta strong {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.status-pill {
  padding: 6px 10px;
  border: 1px solid var(--color-border-soft);
  border-radius: 999px;
  font-size: 11px;
  font-weight: 850;
}

.status-healthy {
  border-color: color-mix(in srgb, var(--color-status-success) 35%, var(--color-border-soft));
  background: color-mix(in srgb, var(--color-status-success) 8%, transparent);
  color: var(--color-status-success);
}

.status-warning {
  border-color: color-mix(in srgb, var(--color-status-warning) 40%, var(--color-border-soft));
  background: color-mix(in srgb, var(--color-status-warning) 8%, transparent);
  color: var(--color-status-warning);
}

.status-critical {
  border-color: color-mix(in srgb, var(--color-status-danger) 45%, var(--color-border-soft));
  background: color-mix(in srgb, var(--color-status-danger) 8%, transparent);
  color: var(--color-status-danger);
}

.refresh-button {
  min-height: 34px;
  padding: 0 11px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--color-border-default);
  border-radius: 9px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  cursor: pointer;
}

.refresh-button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--color-brand-primary) 55%, var(--color-border-default));
}

.refresh-button:disabled {
  opacity: .55;
  cursor: wait;
}

.spinning {
  display: inline-block;
  animation: spin .8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-banner {
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-color: color-mix(in srgb, var(--color-status-danger) 40%, var(--color-border-soft));
  color: var(--color-status-danger);
}

.error-icon {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-status-danger) 12%, transparent);
  font-weight: 900;
}

.error-banner > div:last-child {
  display: grid;
  gap: 2px;
}

.error-banner span {
  color: var(--color-text-secondary);
  font-size: 11px;
}

.overview {
  padding: 14px 16px;
  display: grid;
  grid-template-columns: minmax(260px, 1fr) auto;
  align-items: center;
  gap: 18px;
  overflow: hidden;
  position: relative;
}

.overview::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--color-status-success);
}

.overview-warning::before {
  background: var(--color-status-warning);
}

.overview-critical::before {
  background: var(--color-status-danger);
}

.overview-summary {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.overview-label {
  color: var(--color-text-muted);
  font-size: 10px;
}

.overview-summary > strong {
  overflow: hidden;
  font-size: 17px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overview-summary small {
  color: var(--color-text-muted);
  font-size: 10px;
}

.overview-metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(106px, 1fr));
  gap: 8px;
}

.metric-value {
  min-width: 0;
  padding: 8px 10px;
  display: grid;
  gap: 2px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: var(--color-bg-elevated);
}

.metric-value span {
  color: var(--color-text-muted);
  font-size: 9px;
}

.metric-value strong {
  overflow: hidden;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-warning {
  border-color: color-mix(in srgb, var(--color-status-warning) 24%, transparent);
}

.metric-warning strong {
  color: var(--color-status-warning);
}

.metric-critical {
  border-color: color-mix(in srgb, var(--color-status-danger) 28%, transparent);
}

.metric-critical strong {
  color: var(--color-status-danger);
}

.pipeline-panel,
.diagnosis-panel,
.timing-panel,
.amplification-panel,
.history-panel,
.path-panel {
  padding: 14px;
}

.section-heading {
  margin-bottom: 11px;
}

.section-heading > span,
.pipeline-heading > span {
  color: var(--color-text-muted);
  font-size: 10px;
}

.pipeline-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  padding: 1px 1px 5px;
}

.pipeline-track {
  min-width: 1320px;
  display: grid;
  grid-template-columns: repeat(6, minmax(205px, 1fr));
  gap: 12px;
}

.stage-card {
  min-width: 0;
  min-height: 250px;
  padding: 11px;
  position: relative;
  border: 1px solid var(--color-border-soft);
  border-radius: 11px;
  background: var(--color-bg-elevated);
  transition: border-color .15s ease, transform .15s ease;
}

.stage-card:hover {
  transform: translateY(-1px);
  border-color: var(--color-border-default);
}

.stage-card::before {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  border-radius: 11px 11px 0 0;
  background: var(--color-status-success);
  opacity: .75;
}

.stage-warning {
  border-color: color-mix(in srgb, var(--color-status-warning) 42%, var(--color-border-soft));
}

.stage-warning::before {
  background: var(--color-status-warning);
  opacity: 1;
}

.stage-critical {
  border-color: color-mix(in srgb, var(--color-status-danger) 50%, var(--color-border-soft));
}

.stage-critical::before {
  background: var(--color-status-danger);
  opacity: 1;
}

.stage-header {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
}

.stage-number {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: var(--color-bg-card);
  color: var(--color-brand-primary);
  font-size: 9px;
  font-weight: 900;
}

.stage-heading-copy {
  min-width: 0;
  display: grid;
  gap: 1px;
}

.stage-heading-copy strong {
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stage-heading-copy span {
  color: var(--color-text-muted);
  font-size: 9px;
}

.stage-state {
  padding: 3px 5px;
  border-radius: 5px;
  background: var(--color-bg-card);
  color: var(--color-text-muted);
  font-size: 8px;
  font-weight: 800;
  white-space: nowrap;
}

.stage-warning .stage-state {
  color: var(--color-status-warning);
}

.stage-critical .stage-state {
  color: var(--color-status-danger);
}

.stage-primary {
  margin: 12px 0 8px;
  padding: 9px 10px;
  display: grid;
  gap: 2px;
  border-radius: 8px;
  background: var(--color-bg-card);
}

.stage-primary span {
  color: var(--color-text-muted);
  font-size: 9px;
}

.stage-primary strong {
  font-size: 17px;
  font-variant-numeric: tabular-nums;
}

.stage-metrics {
  display: grid;
}

.metric-row {
  min-height: 25px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--color-border-soft);
}

.metric-row:last-child {
  border-bottom: 0;
}

.metric-row span {
  color: var(--color-text-muted);
  font-size: 9px;
}

.metric-row strong {
  overflow: hidden;
  text-align: right;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.path {
  margin: 8px 0 0;
  padding-top: 7px;
  overflow: hidden;
  border-top: 1px dashed var(--color-border-soft);
  color: var(--color-text-disabled);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stage-connector {
  position: absolute;
  top: 50%;
  right: -10px;
  z-index: 2;
  width: 8px;
  height: 18px;
  display: grid;
  place-items: center;
  transform: translateY(-50%);
  color: var(--color-text-disabled);
  font-size: 18px;
}

.analysis-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(360px, .85fr);
  align-items: start;
  gap: 12px;
}

.analysis-side {
  display: grid;
  gap: 12px;
}

.count-badge {
  padding: 4px 7px;
  border-radius: 999px;
  background: var(--color-bg-elevated);
  color: var(--color-text-muted);
  font-size: 9px;
  font-weight: 800;
}

.count-badge.danger {
  background: color-mix(in srgb, var(--color-status-danger) 10%, var(--color-bg-elevated));
  color: var(--color-status-danger);
}

.bottleneck-list {
  display: grid;
  gap: 8px;
}

.bottleneck-item {
  padding: 10px 11px;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  background: var(--color-bg-elevated);
}

.bottleneck-item.severity-warning {
  border-left: 3px solid var(--color-status-warning);
}

.bottleneck-item.severity-critical {
  border-left: 3px solid var(--color-status-danger);
}

.bottleneck-head {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}

.bottleneck-head > span {
  padding: 3px 5px;
  border-radius: 5px;
  background: var(--color-bg-card);
  color: var(--color-text-muted);
  font-size: 8px;
  font-weight: 900;
}

.severity-warning .bottleneck-head > span {
  color: var(--color-status-warning);
}

.severity-critical .bottleneck-head > span {
  color: var(--color-status-danger);
}

.bottleneck-head strong {
  flex: 1;
  font-size: 12px;
}

.bottleneck-head code {
  color: var(--color-text-disabled);
  font-size: 8px;
}

.evidence {
  margin: 7px 0;
  color: var(--color-text-secondary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 9px;
  line-height: 1.5;
}

.recommendation {
  padding: 7px 8px;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 7px;
  border-radius: 7px;
  background: var(--color-bg-card);
}

.recommendation > span {
  color: var(--color-brand-primary);
  font-size: 9px;
  font-weight: 850;
}

.recommendation p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 10px;
  line-height: 1.45;
}

.empty-state {
  min-height: 128px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 11px;
  color: var(--color-text-muted);
}

.healthy-empty > span {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-status-success) 10%, transparent);
  color: var(--color-status-success);
  font-weight: 900;
}

.healthy-empty > div {
  display: grid;
  gap: 3px;
}

.healthy-empty strong {
  color: var(--color-text-primary);
  font-size: 12px;
}

.healthy-empty p {
  margin: 0;
  font-size: 10px;
}

.timing-list {
  display: grid;
  gap: 8px;
}

.timing-item {
  display: grid;
  grid-template-columns: minmax(105px, 1fr) minmax(90px, 1.1fr) 44px;
  align-items: center;
  gap: 8px;
}

.timing-copy {
  min-width: 0;
  display: flex;
  justify-content: space-between;
  gap: 6px;
}

.timing-copy span {
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timing-copy strong {
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.timing-track {
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--color-border-soft);
}

.timing-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-brand-primary);
}

.timing-item small {
  color: var(--color-text-muted);
  font-size: 9px;
  text-align: right;
}

.amplification-score {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.amplification-score > div {
  padding: 10px;
  display: grid;
  gap: 2px;
  border-radius: 9px;
  background: var(--color-bg-elevated);
}

.amplification-score span,
.amplification-score small {
  color: var(--color-text-muted);
  font-size: 9px;
}

.amplification-score strong {
  font-size: 22px;
}

.amplification-panel ul {
  margin: 10px 0 0;
  padding-left: 16px;
  color: var(--color-text-muted);
  font-size: 10px;
  line-height: 1.55;
}

.no-notes {
  margin: 10px 0 0;
  color: var(--color-text-disabled);
  font-size: 9px;
}

.history-table-wrap {
  max-height: 340px;
  overflow: auto;
  border: 1px solid var(--color-border-soft);
  border-radius: 9px;
}

table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 10px;
}

th,
td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border-soft);
  text-align: right;
  white-space: nowrap;
}

th:first-child,
td:first-child {
  text-align: left;
}

th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--color-bg-elevated);
  color: var(--color-text-muted);
  font-weight: 750;
}

td {
  font-variant-numeric: tabular-nums;
}

tbody tr:last-child td {
  border-bottom: 0;
}

tbody tr:hover td {
  background: color-mix(in srgb, var(--color-brand-primary) 3%, transparent);
}

tr.latest td {
  background: color-mix(in srgb, var(--color-brand-primary) 4%, transparent);
}

.latest-dot {
  width: 5px;
  height: 5px;
  margin-right: 5px;
  display: inline-block;
  border-radius: 50%;
  background: var(--color-brand-primary);
  vertical-align: middle;
}

.cell-warning {
  color: var(--color-status-warning);
}

.cell-critical {
  color: var(--color-status-danger);
}

.path-panel summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  cursor: pointer;
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 750;
}

.path-panel summary small {
  color: var(--color-text-disabled);
  font-size: 9px;
  font-weight: 500;
}

.path-panel dl {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 7px 12px;
  margin: 14px 0 0;
}

.path-panel dt {
  color: var(--color-text-muted);
  font-size: 9px;
}

.path-panel dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--color-text-secondary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 9px;
}

.loading-state {
  min-height: 180px;
  padding: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--color-text-muted);
}

.loading-spinner {
  width: 17px;
  height: 17px;
  border: 2px solid var(--color-border-default);
  border-top-color: var(--color-brand-primary);
  border-radius: 50%;
  animation: spin .8s linear infinite;
}

@media (max-width: 1380px) {
  .overview {
    grid-template-columns: 1fr;
  }

  .overview-metrics {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }

  .analysis-layout {
    grid-template-columns: minmax(0, 1.2fr) minmax(330px, .8fr);
  }
}

@media (max-width: 1050px) {
  .analysis-layout {
    grid-template-columns: 1fr;
  }

  .analysis-side {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 760px) {
  .logpost-diagnostics-page {
    padding: 10px;
  }

  .page-header,
  .overview,
  .section-heading {
    align-items: flex-start;
  }

  .page-header {
    flex-direction: column;
  }

  .header-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .sample-meta {
    text-align: left;
  }

  .overview-summary > strong {
    white-space: normal;
  }

  .overview-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .analysis-side {
    grid-template-columns: 1fr;
  }

  .amplification-score {
    grid-template-columns: 1fr 1fr;
  }

  .path-panel summary {
    align-items: flex-start;
    flex-direction: column;
  }

  .path-panel dl {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 480px) {
  .title-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  .overview-metrics,
  .amplification-score {
    grid-template-columns: 1fr;
  }

  .timing-item {
    grid-template-columns: minmax(0, 1fr) 42px;
  }

  .timing-track {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}
</style>
