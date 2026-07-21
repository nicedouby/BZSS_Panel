<template>
  <main class="performance-page">
    <header class="page-header panel">
      <div>
        <p class="eyebrow">LOG CONSUMPTION PERFORMANCE</p>
        <div class="title-row">
          <h1>LogPost 消费性能评估</h1>
          <span class="live-pill" :class="{ active: Boolean(latest) && !error }">
            <i />{{ latest ? "实时评估" : "等待采样" }}
          </span>
        </div>
        <p class="subtitle">评估 Squad.log → Python Parser 的吞吐余量、积压恢复能力与单位处理成本。</p>
      </div>

      <div class="header-actions">
        <div class="sample-meta">
          <span>最近采样</span>
          <strong>{{ formatTime(latest?.sampledAt) }}</strong>
        </div>
        <span class="grade-pill" :class="`grade-${performanceGrade.tone}`">
          {{ performanceGrade.label }} · {{ performanceScore.total }}
        </span>
        <button type="button" class="refresh-button" :disabled="loading" @click="refresh">
          <span :class="{ spinning: loading }">↻</span>
          {{ loading ? "刷新中" : "立即刷新" }}
        </button>
      </div>
    </header>

    <section v-if="error" class="error-banner panel">
      <strong>性能数据读取失败</strong>
      <span>{{ error }}</span>
    </section>

    <template v-if="latest">
      <section class="assessment panel" :class="`assessment-${performanceGrade.tone}`">
        <div class="assessment-score">
          <span>持续负载评分</span>
          <strong>{{ performanceScore.total }}</strong>
          <small>/ 100</small>
        </div>
        <div class="assessment-copy">
          <span class="assessment-label">当前判断</span>
          <h2>{{ performanceGrade.headline }}</h2>
          <p>{{ performanceSummary }}</p>
        </div>
        <div class="assessment-breakdown">
          <div v-for="item in performanceScore.components" :key="item.key">
            <span>{{ item.label }}</span>
            <strong>{{ item.score }}/{{ item.max }}</strong>
          </div>
        </div>
      </section>

      <section class="metric-grid">
        <article v-for="metric in primaryMetrics" :key="metric.key" class="metric-card panel" :class="`metric-${metric.tone}`">
          <div class="metric-heading">
            <span>{{ metric.label }}</span>
            <code>{{ metric.code }}</code>
          </div>
          <strong>{{ metric.value }}</strong>
          <p>{{ metric.description }}</p>
        </article>
      </section>

      <section class="chart-grid">
        <article class="chart-panel panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">THROUGHPUT TREND</p>
              <h2>日志生成与 Python 消费</h2>
            </div>
            <div class="legend">
              <span><i class="legend-source" />源生成</span>
              <span><i class="legend-consume" />Python 消费</span>
            </div>
          </div>

          <div v-if="throughputSamples.length >= 2" class="chart-shell">
            <div class="chart-axis-label top">{{ formatRate(throughputChartMax) }}</div>
            <svg viewBox="0 0 1000 220" preserveAspectRatio="none" role="img" aria-label="LogPost 吞吐趋势">
              <line v-for="line in chartGridLines" :key="line" x1="0" :y1="line" x2="1000" :y2="line" class="grid-line" />
              <polyline :points="sourcePolyline" class="chart-line source-line" />
              <polyline :points="consumePolyline" class="chart-line consume-line" />
            </svg>
            <div class="chart-axis-label bottom">0 B/s</div>
          </div>
          <div v-else class="chart-empty">至少需要两个采样点才能绘制趋势。</div>

          <div class="chart-footer">
            <span>窗口 {{ throughputSamples.length }} 秒</span>
            <span>平均输入 {{ formatRate(averageSourceRate) }}</span>
            <span>平均消费 {{ formatRate(averageConsumeRate) }}</span>
          </div>
        </article>

        <article class="chart-panel panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">BACKLOG TREND</p>
              <h2>积压与追赶方向</h2>
            </div>
            <span class="trend-pill" :class="`trend-${backlogTrend.tone}`">{{ backlogTrend.label }}</span>
          </div>

          <div v-if="backlogSamples.length >= 2" class="chart-shell">
            <div class="chart-axis-label top">{{ formatBytes(backlogChartMax) }}</div>
            <svg viewBox="0 0 1000 220" preserveAspectRatio="none" role="img" aria-label="LogPost 积压趋势">
              <line v-for="line in chartGridLines" :key="line" x1="0" :y1="line" x2="1000" :y2="line" class="grid-line" />
              <polygon :points="backlogArea" class="backlog-area" />
              <polyline :points="backlogPolyline" class="chart-line backlog-line" />
            </svg>
            <div class="chart-axis-label bottom">0 B</div>
          </div>
          <div v-else class="chart-empty">至少需要两个采样点才能绘制趋势。</div>

          <div class="chart-footer">
            <span>当前 {{ formatBytes(sourceBacklog) }}</span>
            <span>斜率 {{ formatSignedRate(backlogSlope) }}</span>
            <span>预计追平 {{ formatRecovery(recoverySeconds) }}</span>
          </div>
        </article>
      </section>

      <section class="analysis-grid">
        <article class="panel stage-panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">ACTIVE COST</p>
              <h2>阶段工作成本</h2>
            </div>
            <span>Active Share 与 Wall Share 分开计算</span>
          </div>

          <div class="stage-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>阶段</th>
                  <th>累计耗时</th>
                  <th>Active Share</th>
                  <th>Wall Share</th>
                  <th>调用次数</th>
                  <th>平均每次</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="stage in stageRows" :key="stage.key">
                  <td>
                    <div class="stage-name">
                      <span :class="`stage-dot stage-dot-${stage.key}`" />
                      <strong>{{ stage.label }}</strong>
                    </div>
                  </td>
                  <td>{{ formatMs(stage.durationMs) }}</td>
                  <td>
                    <div class="share-cell">
                      <div><span :style="{ width: `${Math.min(100, stage.activeShare)}%` }" /></div>
                      <strong>{{ formatPercent(stage.activeShare) }}</strong>
                    </div>
                  </td>
                  <td>{{ formatPercent(stage.wallShare) }}</td>
                  <td>{{ formatCount(stage.calls) }}</td>
                  <td>{{ formatMs(stage.averageMs) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="stage-note">
            <strong>口径说明</strong>
            <p>Active Share 表示阶段耗时占 Python 实际工作时间的比例；Wall Share 表示阶段耗时占整个采样窗口的比例。占比高但 Wall Share 很低时，不应直接判定为系统瓶颈。</p>
          </div>
        </article>

        <aside class="side-stack">
          <article class="panel efficiency-panel">
            <div class="section-heading compact">
              <div>
                <p class="eyebrow">UNIT ECONOMICS</p>
                <h2>单位消费成本</h2>
              </div>
            </div>
            <dl class="efficiency-list">
              <div>
                <dt>每行处理成本</dt>
                <dd>{{ formatUnitMs(processCostPerLine) }}</dd>
              </div>
              <div>
                <dt>每 KB 处理成本</dt>
                <dd>{{ formatUnitMs(processCostPerKb) }}</dd>
              </div>
              <div>
                <dt>平均日志长度</dt>
                <dd>{{ formatBytes(averageLineBytes) }}</dd>
              </div>
              <div>
                <dt>活跃利用率</dt>
                <dd>{{ formatPercent(activeUtilization) }}</dd>
              </div>
              <div>
                <dt>最大单行耗时</dt>
                <dd>{{ formatMs(maxLineProcessMs) }}</dd>
              </div>
              <div>
                <dt>估算处理能力</dt>
                <dd>{{ formatCapacity(estimatedCapacity) }}</dd>
              </div>
            </dl>
            <p class="capacity-note">估算处理能力仅用于观察趋势。没有积压且活跃利用率很低时，实际消费速率会被输入速率限制，不能视为压力测试结果。</p>
          </article>

          <article class="panel pressure-panel">
            <div class="section-heading compact">
              <div>
                <p class="eyebrow">PRESSURE SIGNALS</p>
                <h2>压力信号</h2>
              </div>
              <span>{{ pressureSignals.filter((item) => item.tone !== "healthy").length }} 项关注</span>
            </div>
            <div class="signal-list">
              <div v-for="signal in pressureSignals" :key="signal.key" :class="`signal-${signal.tone}`">
                <span>{{ signal.label }}</span>
                <strong>{{ signal.value }}</strong>
                <small>{{ signal.detail }}</small>
              </div>
            </div>
          </article>
        </aside>
      </section>

      <section class="panel history-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">RECENT SAMPLES</p>
            <h2>最近消费样本</h2>
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
                <th>消费比率</th>
                <th>源积压</th>
                <th>积压变化</th>
                <th>Node P95</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in recentHistory" :key="`${row.sampledAt}-${index}`" :class="{ latest: index === 0 }">
                <td><i v-if="index === 0" class="latest-dot" />{{ formatTime(row.sampledAt) }}</td>
                <td>{{ formatRate(row.sourceProducedBytesPerSec) }}</td>
                <td>{{ formatRate(row.parserConsumedBytesPerSec) }}</td>
                <td>{{ formatRatio(sampleRatio(row)) }}</td>
                <td>{{ formatBytes(row.sourceBacklogBytes) }}</td>
                <td :class="sampleBacklogDelta(row, index).className">{{ sampleBacklogDelta(row, index).label }}</td>
                <td>{{ formatMs(row.eventLoopP95Ms) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <section v-else-if="loading" class="loading-state panel">
      <span class="loading-spinner" />
      正在建立 LogPost 消费性能样本……
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";

type DiagnosticState = Record<string, any>;
type Tone = "healthy" | "warning" | "critical" | "neutral";
type HistoryRow = Record<string, any>;

const state = ref<DiagnosticState | null>(null);
const loading = ref(false);
const error = ref("");
let timer: number | null = null;
let controller: AbortController | null = null;

const latest = computed(() => state.value?.latest ?? null);
const parser = computed(() => latest.value?.pipeline?.parser ?? {});
const probe = computed(() => parser.value?.probe ?? {});
const durations = computed<Record<string, number>>(() => parser.value?.stageDurationsMs ?? probe.value?.durationsMs ?? {});
const counts = computed<Record<string, number>>(() => probe.value?.counts ?? {});
const history = computed<HistoryRow[]>(() => Array.isArray(state.value?.history) ? state.value.history : []);
const chronologicalHistory = computed(() => history.value.slice(-120));
const recentHistory = computed(() => chronologicalHistory.value.slice(-30).reverse());
const throughputSamples = computed(() => chronologicalHistory.value.slice(-90));
const backlogSamples = computed(() => chronologicalHistory.value.slice(-90));

const sourceRate = computed(() => finite(latest.value?.pipeline?.sourceFile?.producedBytesPerSec));
const consumeRate = computed(() => finite(parser.value?.consumedBytesPerSec));
const sourceBacklog = computed(() => finite(parser.value?.backlogBytes));
const fileBridgeBacklog = computed(() => finite(latest.value?.pipeline?.fileBridge?.backlogBytes));
const consumeRatio = computed(() => sourceRate.value > 0 ? consumeRate.value / sourceRate.value : null);
const headroomPercent = computed(() => sourceRate.value > 0 ? ((consumeRate.value - sourceRate.value) / sourceRate.value) * 100 : null);
const netDrainRate = computed(() => consumeRate.value - sourceRate.value);
const recoverySeconds = computed(() => {
  if (sourceBacklog.value <= 0) return 0;
  if (netDrainRate.value <= 0) return null;
  return sourceBacklog.value / netDrainRate.value;
});

const sampleIntervalMs = computed(() => Math.max(1, finite(probe.value?.intervalMs) || finite(state.value?.sampleIntervalMs) || 1000));
const tickTotalMs = computed(() => finite(durations.value.tick_total));
const processTotalMs = computed(() => finite(durations.value.process_total));
const activeUtilization = computed(() => Math.min(100, (tickTotalMs.value / sampleIntervalMs.value) * 100));
const linesProcessed = computed(() => finite(counts.value.lines_processed) || finite(parser.value?.linesProcessedPerSec) * (sampleIntervalMs.value / 1000));
const sourceBytesRead = computed(() => finite(counts.value.source_bytes_read) || consumeRate.value * (sampleIntervalMs.value / 1000));
const processCostPerLine = computed(() => linesProcessed.value > 0 ? processTotalMs.value / linesProcessed.value : null);
const processCostPerKb = computed(() => sourceBytesRead.value > 0 ? processTotalMs.value / (sourceBytesRead.value / 1024) : null);
const averageLineBytes = computed(() => linesProcessed.value > 0 ? sourceBytesRead.value / linesProcessed.value : null);
const maxLineProcessMs = computed(() => finite(parser.value?.maxLineProcessMs));
const estimatedCapacity = computed(() => {
  const utilization = activeUtilization.value / 100;
  if (consumeRate.value <= 0 || utilization < 0.0025) return null;
  return Math.min(1024 ** 3, consumeRate.value / utilization);
});

const averageSourceRate = computed(() => average(throughputSamples.value.map((row) => finite(row.sourceProducedBytesPerSec))));
const averageConsumeRate = computed(() => average(throughputSamples.value.map((row) => finite(row.parserConsumedBytesPerSec))));
const throughputChartMax = computed(() => Math.max(1, ...throughputSamples.value.flatMap((row) => [
  finite(row.sourceProducedBytesPerSec),
  finite(row.parserConsumedBytesPerSec),
])));
const backlogChartMax = computed(() => Math.max(1, ...backlogSamples.value.map((row) => finite(row.sourceBacklogBytes))));
const chartGridLines = [0, 55, 110, 165, 220];
const sourcePolyline = computed(() => buildPolyline(throughputSamples.value.map((row) => finite(row.sourceProducedBytesPerSec)), throughputChartMax.value));
const consumePolyline = computed(() => buildPolyline(throughputSamples.value.map((row) => finite(row.parserConsumedBytesPerSec)), throughputChartMax.value));
const backlogPolyline = computed(() => buildPolyline(backlogSamples.value.map((row) => finite(row.sourceBacklogBytes)), backlogChartMax.value));
const backlogArea = computed(() => {
  const points = backlogPolyline.value;
  return points ? `0,220 ${points} 1000,220` : "";
});

const backlogSlope = computed(() => calculateBacklogSlope(chronologicalHistory.value.slice(-10)));
const backlogTrend = computed<{ label: string; tone: Tone }>(() => {
  if (sourceBacklog.value <= 0) return { label: "积压已清空", tone: "healthy" };
  if (backlogSlope.value > 1024) return { label: "积压正在增长", tone: "critical" };
  if (backlogSlope.value > 128) return { label: "积压缓慢增长", tone: "warning" };
  if (backlogSlope.value < -1024) return { label: "正在快速追赶", tone: "healthy" };
  if (backlogSlope.value < -128) return { label: "正在追赶", tone: "healthy" };
  return { label: "积压基本稳定", tone: "neutral" };
});

const stageRows = computed(() => {
  const value = durations.value;
  const readMs = finite(value.tail_read);
  const parseMs = finite(value.bzss_parse) + finite(value.matchers);
  const fileIoMs = ["raw_archive_write", "raw_input_write", "event_write", "outbox_write", "audit_write"]
    .reduce((total, key) => total + finite(value[key]), 0);
  const udpMs = finite(value.udp_send);
  const measured = readMs + parseMs + fileIoMs + udpMs;
  const otherMs = Math.max(0, tickTotalMs.value - measured);

  const definitions = [
    { key: "read", label: "TailReader 读取", durationMs: readMs, calls: finite(counts.value.ticks) },
    { key: "parse", label: "日志解析", durationMs: parseMs, calls: finite(counts.value.lines_processed) },
    { key: "file", label: "文件落盘", durationMs: fileIoMs, calls: sumCount(["raw_archive_writes", "raw_input_writes", "event_writes", "outbox_writes", "audit_writes"]) },
    { key: "udp", label: "UDP 发送", durationMs: udpMs, calls: finite(counts.value.udp_send_calls) },
    { key: "other", label: "其他同步工作", durationMs: otherMs, calls: finite(counts.value.lines_processed) },
  ];

  return definitions.map((item) => ({
    ...item,
    activeShare: tickTotalMs.value > 0 ? (item.durationMs / tickTotalMs.value) * 100 : 0,
    wallShare: sampleIntervalMs.value > 0 ? (item.durationMs / sampleIntervalMs.value) * 100 : 0,
    averageMs: item.calls > 0 ? item.durationMs / item.calls : 0,
  }));
});

const fileIoShare = computed(() => stageRows.value.find((item) => item.key === "file")?.activeShare ?? 0);
const eventGapCount = computed(() => finite(latest.value?.pipeline?.delivery?.metrics?.eventGapCount));
const invalidUdpCount = computed(() => finite(latest.value?.pipeline?.udp?.invalidJson));

const performanceScore = computed(() => {
  const ratio = consumeRatio.value;
  const throughputScore = ratio == null ? 18 : ratio >= 2 ? 30 : ratio >= 1.5 ? 27 : ratio >= 1.2 ? 23 : ratio >= 1.05 ? 18 : ratio >= 0.9 ? 10 : 3;
  const backlogScore = sourceBacklog.value <= 0 ? 25 : backlogSlope.value <= -128 ? 24 : backlogSlope.value <= 128 && sourceBacklog.value < 1024 * 1024 ? 20 : backlogSlope.value < 1024 ? 12 : 3;
  const latencyScore = maxLineProcessMs.value <= 5 ? 20 : maxLineProcessMs.value <= 20 ? 17 : maxLineProcessMs.value <= 100 ? 11 : maxLineProcessMs.value <= 250 ? 5 : 0;
  const ioScore = fileIoShare.value <= 35 ? 15 : fileIoShare.value <= 50 ? 12 : fileIoShare.value <= 70 ? 7 : 2;
  const deliveryScore = eventGapCount.value === 0 && invalidUdpCount.value === 0 ? 10 : eventGapCount.value <= 2 && invalidUdpCount.value <= 2 ? 6 : 1;
  const components = [
    { key: "throughput", label: "吞吐余量", score: throughputScore, max: 30 },
    { key: "backlog", label: "积压稳定", score: backlogScore, max: 25 },
    { key: "latency", label: "单行延迟", score: latencyScore, max: 20 },
    { key: "io", label: "写入效率", score: ioScore, max: 15 },
    { key: "delivery", label: "投递完整", score: deliveryScore, max: 10 },
  ];
  return { total: components.reduce((total, item) => total + item.score, 0), components };
});

const performanceGrade = computed(() => {
  const score = performanceScore.value.total;
  if (score >= 85) return { label: "健康", tone: "healthy" as Tone, headline: "当前消费链路具备稳定余量" };
  if (score >= 70) return { label: "正常", tone: "neutral" as Tone, headline: "当前能够跟随输入，但应继续观察高峰" };
  if (score >= 50) return { label: "余量偏低", tone: "warning" as Tone, headline: "消费能力正在接近当前输入负载" };
  return { label: "消费不足", tone: "critical" as Tone, headline: "当前积压存在持续增长风险" };
});

const performanceSummary = computed(() => {
  const ratioText = consumeRatio.value == null ? "当前没有足够输入流量计算消费比率" : `Python 当前消费速率约为输入的 ${consumeRatio.value.toFixed(2)} 倍`;
  const trendText = backlogTrend.value.label;
  const dominant = stageRows.value.slice().sort((left, right) => right.activeShare - left.activeShare)[0];
  const dominantText = dominant ? `主要工作成本来自${dominant.label}，占 Active Share 的 ${dominant.activeShare.toFixed(1)}%` : "阶段成本样本不足";
  return `${ratioText}；${trendText}。${dominantText}。`;
});

const primaryMetrics = computed(() => [
  {
    key: "ratio",
    label: "消费比率",
    code: "consume / input",
    value: formatRatio(consumeRatio.value),
    description: consumeRatio.value == null ? "当前没有新的源日志流量。" : "高于 1.00× 表示当前窗口能够追上输入。",
    tone: metricTone(consumeRatio.value == null ? 1.2 : consumeRatio.value, 1.05, 0.9),
  },
  {
    key: "headroom",
    label: "性能余量",
    code: "headroom",
    value: formatSignedPercent(headroomPercent.value),
    description: "当前实际消费速率相对于源日志生成速率的差值。",
    tone: headroomPercent.value == null ? "neutral" : headroomPercent.value >= 5 ? "healthy" : headroomPercent.value >= -10 ? "warning" : "critical",
  },
  {
    key: "backlog",
    label: "源日志积压",
    code: "backlog",
    value: formatBytes(sourceBacklog.value),
    description: backlogTrend.value.label,
    tone: sourceBacklog.value <= 0 ? "healthy" : backlogSlope.value > 1024 ? "critical" : "warning",
  },
  {
    key: "recovery",
    label: "预计追平",
    code: "backlog / net drain",
    value: formatRecovery(recoverySeconds.value),
    description: netDrainRate.value > 0 ? `净追赶速率 ${formatRate(netDrainRate.value)}` : "当前消费速率没有高于输入速率。",
    tone: recoverySeconds.value == null ? "critical" : recoverySeconds.value <= 2 ? "healthy" : recoverySeconds.value <= 10 ? "warning" : "critical",
  },
  {
    key: "utilization",
    label: "活跃利用率",
    code: "active / wall",
    value: formatPercent(activeUtilization.value),
    description: "Python 实际工作时间占采样窗口的比例。",
    tone: activeUtilization.value < 50 ? "healthy" : activeUtilization.value < 80 ? "warning" : "critical",
  },
  {
    key: "cost",
    label: "每行处理成本",
    code: "process / line",
    value: formatUnitMs(processCostPerLine.value),
    description: `当前处理 ${formatPerSecond(parser.value?.linesProcessedPerSec)}，最大单行 ${formatMs(maxLineProcessMs.value)}。`,
    tone: processCostPerLine.value == null || processCostPerLine.value < 1 ? "healthy" : processCostPerLine.value < 5 ? "warning" : "critical",
  },
]);

const pressureSignals = computed(() => [
  {
    key: "source-backlog",
    label: "源文件积压",
    value: formatBytes(sourceBacklog.value),
    detail: backlogTrend.value.label,
    tone: sourceBacklog.value <= 0 ? "healthy" : backlogSlope.value > 1024 ? "critical" : "warning",
  },
  {
    key: "bridge-backlog",
    label: "FileBridge 积压",
    value: formatBytes(fileBridgeBacklog.value),
    detail: fileBridgeBacklog.value <= 0 ? "Node 文件桥已追平" : "需要观察是否持续增长",
    tone: fileBridgeBacklog.value <= 0 ? "healthy" : fileBridgeBacklog.value < 1024 * 1024 ? "warning" : "critical",
  },
  {
    key: "max-line",
    label: "最大单行耗时",
    value: formatMs(maxLineProcessMs.value),
    detail: maxLineProcessMs.value < 100 ? "未发现明显长尾阻塞" : "检查大型玩家帧或同步刷盘",
    tone: maxLineProcessMs.value < 100 ? "healthy" : maxLineProcessMs.value < 250 ? "warning" : "critical",
  },
  {
    key: "delivery",
    label: "事件投递",
    value: `${eventGapCount.value} 缺口 / ${invalidUdpCount.value} 无效包`,
    detail: eventGapCount.value === 0 && invalidUdpCount.value === 0 ? "当前样本未发现投递异常" : "检查 UDP 与 EventBus 序号",
    tone: eventGapCount.value === 0 && invalidUdpCount.value === 0 ? "healthy" : "critical",
  },
]);

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

function buildPolyline(values: number[], maximum: number) {
  if (values.length < 2) return "";
  return values.map((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * 1000;
    const y = 220 - (Math.max(0, value) / Math.max(1, maximum)) * 220;
    return `${x.toFixed(2)},${Math.max(0, Math.min(220, y)).toFixed(2)}`;
  }).join(" ");
}

function calculateBacklogSlope(rows: HistoryRow[]) {
  if (rows.length < 2) return 0;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const firstTime = Date.parse(String(first.sampledAt ?? ""));
  const lastTime = Date.parse(String(last.sampledAt ?? ""));
  const elapsedSeconds = Number.isFinite(firstTime) && Number.isFinite(lastTime)
    ? Math.max(1, (lastTime - firstTime) / 1000)
    : Math.max(1, rows.length - 1);
  return (finite(last.sourceBacklogBytes) - finite(first.sourceBacklogBytes)) / elapsedSeconds;
}

function sampleRatio(row: HistoryRow) {
  const source = finite(row.sourceProducedBytesPerSec);
  return source > 0 ? finite(row.parserConsumedBytesPerSec) / source : null;
}

function sampleBacklogDelta(row: HistoryRow, reversedIndex: number) {
  const chronologicalIndex = Math.max(0, recentHistory.value.length - 1 - reversedIndex);
  const chronologicalRows = recentHistory.value.slice().reverse();
  const previous = chronologicalRows[chronologicalIndex - 1];
  if (!previous) return { label: "--", className: "" };
  const delta = finite(row.sourceBacklogBytes) - finite(previous.sourceBacklogBytes);
  if (Math.abs(delta) < 1) return { label: "持平", className: "cell-neutral" };
  if (delta > 0) return { label: `+${formatBytes(delta)}`, className: "cell-critical" };
  return { label: `-${formatBytes(Math.abs(delta))}`, className: "cell-healthy" };
}

function sumCount(keys: string[]) {
  return keys.reduce((total, key) => total + finite(counts.value[key]), 0);
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function metricTone(value: number, warningBelow: number, criticalBelow: number): Tone {
  if (value < criticalBelow) return "critical";
  if (value < warningBelow) return "warning";
  return "healthy";
}

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function formatTime(value: unknown) {
  if (!value) return "--";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function formatBytes(value: unknown) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  const bytes = Math.max(0, Number(value));
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

function formatRate(value: unknown) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  return `${formatBytes(value)}/s`;
}

function formatSignedRate(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  if (Math.abs(number) < 1) return "0 B/s";
  return `${number > 0 ? "+" : "-"}${formatRate(Math.abs(number))}`;
}

function formatMs(value: unknown) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  const number = Math.max(0, Number(value));
  return `${number < 0.1 ? number.toFixed(3) : number.toFixed(1)} ms`;
}

function formatUnitMs(value: unknown) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  const number = Math.max(0, Number(value));
  return `${number < 0.1 ? number.toFixed(4) : number.toFixed(2)} ms`;
}

function formatPercent(value: unknown) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  return `${Number(value).toFixed(1)}%`;
}

function formatSignedPercent(value: unknown) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(1)}%`;
}

function formatRatio(value: unknown) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  return `${Number(value).toFixed(2)}×`;
}

function formatRecovery(value: unknown) {
  if (value === 0) return "已追平";
  if (value == null || !Number.isFinite(Number(value))) return "无法追平";
  const seconds = Math.max(0, Number(value));
  if (seconds < 1) return "< 1 秒";
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  return `${(seconds / 60).toFixed(1)} 分钟`;
}

function formatPerSecond(value: unknown) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  return `${Number(value).toFixed(1)}/s`;
}

function formatCount(value: unknown) {
  if (value == null || !Number.isFinite(Number(value))) return "--";
  return Math.round(Number(value)).toLocaleString("zh-CN");
}

function formatCapacity(value: unknown) {
  if (value == null || !Number.isFinite(Number(value))) return "样本不足";
  return `约 ${formatRate(value)}`;
}

onMounted(() => {
  void refresh();
  timer = window.setInterval(() => {
    if (canAutoRefreshNow()) void refresh();
  }, 1500);
});

onBeforeUnmount(() => {
  if (timer != null) window.clearInterval(timer);
  controller?.abort();
});
</script>

<style scoped>
.performance-page {
  min-height: 100%;
  height: 100%;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 18px;
  color: var(--color-text-primary);
  background:
    radial-gradient(circle at 12% -10%, color-mix(in srgb, var(--color-accent-primary) 12%, transparent), transparent 28rem),
    var(--color-bg-base);
}

.panel {
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  background:
    var(--theme-panel-highlight),
    color-mix(in srgb, var(--color-bg-elevated) 94%, transparent);
  box-shadow: var(--theme-panel-shadow);
}

.page-header {
  min-height: 112px;
  padding: 20px 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.eyebrow {
  margin: 0 0 6px;
  color: var(--color-accent-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.title-row h1 {
  margin: 0;
  font-size: clamp(22px, 2vw, 30px);
  line-height: 1.1;
}

.subtitle {
  margin: 8px 0 0;
  color: var(--color-text-muted);
  font-size: 13px;
}

.live-pill,
.grade-pill,
.trend-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--color-border-default);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-bg-base) 70%, transparent);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.live-pill i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-text-muted);
}

.live-pill.active i {
  background: var(--color-status-success);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-status-success) 16%, transparent);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sample-meta {
  min-width: 100px;
  display: grid;
  gap: 3px;
  text-align: right;
}

.sample-meta span {
  color: var(--color-text-muted);
  font-size: 11px;
}

.sample-meta strong {
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}

.refresh-button {
  height: 36px;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-accent-primary) 12%, var(--color-bg-elevated));
  color: var(--color-text-primary);
  cursor: pointer;
  font-weight: 700;
}

.refresh-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.spinning {
  display: inline-block;
  animation: spin 0.7s linear infinite;
}

.error-banner {
  margin-top: 14px;
  min-height: 52px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-color: color-mix(in srgb, var(--color-status-danger) 60%, var(--color-border-default));
  color: var(--color-status-danger);
}

.error-banner span {
  color: var(--color-text-muted);
}

.assessment {
  min-height: 142px;
  margin-top: 14px;
  padding: 18px 22px;
  display: grid;
  grid-template-columns: 150px minmax(260px, 1fr) minmax(300px, 0.9fr);
  align-items: center;
  gap: 24px;
  overflow: hidden;
  position: relative;
}

.assessment::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 5px;
  background: var(--color-accent-primary);
}

.assessment-warning::before { background: var(--color-status-warning); }
.assessment-critical::before { background: var(--color-status-danger); }
.assessment-healthy::before { background: var(--color-status-success); }

.assessment-score {
  display: grid;
  grid-template-columns: auto auto;
  align-items: end;
  justify-content: center;
}

.assessment-score span {
  grid-column: 1 / -1;
  margin-bottom: 4px;
  color: var(--color-text-muted);
  font-size: 12px;
}

.assessment-score strong {
  font-size: 52px;
  line-height: 0.95;
  font-variant-numeric: tabular-nums;
}

.assessment-score small {
  padding: 0 0 5px 5px;
  color: var(--color-text-muted);
}

.assessment-label {
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.assessment-copy h2 {
  margin: 5px 0 7px;
  font-size: 20px;
}

.assessment-copy p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.assessment-breakdown {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.assessment-breakdown div {
  min-height: 42px;
  padding: 8px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-bg-base) 55%, transparent);
}

.assessment-breakdown span {
  color: var(--color-text-muted);
  font-size: 11px;
}

.assessment-breakdown strong {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.metric-grid {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(6, minmax(160px, 1fr));
  gap: 12px;
}

.metric-card {
  min-height: 132px;
  padding: 15px;
  position: relative;
  overflow: hidden;
}

.metric-card::after {
  content: "";
  position: absolute;
  inset: auto 0 0;
  height: 3px;
  background: var(--color-border-default);
}

.metric-healthy::after { background: var(--color-status-success); }
.metric-warning::after { background: var(--color-status-warning); }
.metric-critical::after { background: var(--color-status-danger); }
.metric-neutral::after { background: var(--color-accent-primary); }

.metric-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.metric-heading span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.metric-heading code {
  color: var(--color-text-muted);
  font-size: 9px;
}

.metric-card > strong {
  display: block;
  margin-top: 15px;
  font-size: 26px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.metric-card p {
  margin: 10px 0 0;
  color: var(--color-text-muted);
  font-size: 11px;
  line-height: 1.55;
}

.chart-grid {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.chart-panel {
  min-height: 390px;
  padding: 18px;
}

.section-heading {
  min-height: 44px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.section-heading.compact {
  min-height: 38px;
}

.section-heading h2 {
  margin: 0;
  font-size: 17px;
}

.section-heading > span {
  color: var(--color-text-muted);
  font-size: 11px;
}

.legend {
  display: flex;
  align-items: center;
  gap: 14px;
  color: var(--color-text-muted);
  font-size: 11px;
}

.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend i {
  width: 16px;
  height: 3px;
  border-radius: 99px;
}

.legend-source { background: var(--color-accent-primary); }
.legend-consume { background: var(--color-status-success); }

.chart-shell {
  height: 252px;
  margin-top: 12px;
  position: relative;
  padding: 16px 0;
}

.chart-shell svg {
  width: 100%;
  height: 220px;
  overflow: visible;
}

.grid-line {
  stroke: var(--color-border-subtle);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.chart-line {
  fill: none;
  stroke-width: 2.4;
  vector-effect: non-scaling-stroke;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.source-line { stroke: var(--color-accent-primary); }
.consume-line { stroke: var(--color-status-success); }
.backlog-line { stroke: var(--color-status-warning); }
.backlog-area { fill: color-mix(in srgb, var(--color-status-warning) 16%, transparent); }

.chart-axis-label {
  position: absolute;
  left: 0;
  z-index: 2;
  padding: 2px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
  color: var(--color-text-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.chart-axis-label.top { top: 0; }
.chart-axis-label.bottom { bottom: 0; }

.chart-empty {
  height: 252px;
  margin-top: 12px;
  display: grid;
  place-items: center;
  border: 1px dashed var(--color-border-default);
  border-radius: 8px;
  color: var(--color-text-muted);
  font-size: 12px;
}

.chart-footer {
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid var(--color-border-subtle);
  color: var(--color-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.analysis-grid {
  margin-top: 14px;
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(300px, 0.65fr);
  gap: 14px;
}

.stage-panel {
  min-height: 430px;
  padding: 18px;
}

.stage-table-wrap,
.history-table-wrap {
  overflow: auto;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

th,
td {
  height: 44px;
  padding: 0 12px;
  border-bottom: 1px solid var(--color-border-subtle);
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: color-mix(in srgb, var(--color-bg-elevated) 97%, transparent);
  color: var(--color-text-muted);
  font-size: 10px;
  letter-spacing: 0.04em;
}

th:first-child,
td:first-child {
  text-align: left;
}

tbody tr:last-child td {
  border-bottom: 0;
}

.stage-name {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stage-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-muted);
}

.stage-dot-read { background: var(--color-accent-primary); }
.stage-dot-parse { background: var(--color-status-success); }
.stage-dot-file { background: var(--color-status-warning); }
.stage-dot-udp { background: #a78bfa; }
.stage-dot-other { background: var(--color-text-muted); }

.share-cell {
  min-width: 160px;
  display: grid;
  grid-template-columns: 1fr 46px;
  align-items: center;
  gap: 8px;
}

.share-cell > div {
  height: 5px;
  overflow: hidden;
  border-radius: 99px;
  background: var(--color-bg-base);
}

.share-cell > div span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-accent-primary);
}

.share-cell strong {
  font-size: 11px;
}

.stage-note {
  margin-top: 12px;
  padding: 10px 12px;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-accent-primary) 7%, transparent);
}

.stage-note strong {
  font-size: 11px;
}

.stage-note p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 11px;
  line-height: 1.6;
}

.side-stack {
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
}

.efficiency-panel,
.pressure-panel {
  min-height: 208px;
  padding: 16px;
}

.efficiency-list {
  margin: 8px 0 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.efficiency-list div {
  min-height: 54px;
  padding: 9px 10px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 7px;
  background: color-mix(in srgb, var(--color-bg-base) 55%, transparent);
}

.efficiency-list dt {
  color: var(--color-text-muted);
  font-size: 10px;
}

.efficiency-list dd {
  margin: 6px 0 0;
  font-size: 13px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}

.capacity-note {
  margin: 10px 0 0;
  color: var(--color-text-muted);
  font-size: 10px;
  line-height: 1.55;
}

.signal-list {
  margin-top: 8px;
  display: grid;
  gap: 7px;
}

.signal-list > div {
  min-height: 48px;
  padding: 8px 10px;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 8px;
  border: 1px solid var(--color-border-subtle);
  border-radius: 7px;
}

.signal-list span {
  color: var(--color-text-muted);
  font-size: 10px;
}

.signal-list strong {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.signal-list small {
  grid-column: 1 / -1;
  color: var(--color-text-muted);
  font-size: 9px;
}

.signal-healthy { border-left: 3px solid var(--color-status-success) !important; }
.signal-warning { border-left: 3px solid var(--color-status-warning) !important; }
.signal-critical { border-left: 3px solid var(--color-status-danger) !important; }

.history-panel {
  min-height: 360px;
  margin-top: 14px;
  padding: 18px;
}

.history-table-wrap {
  max-height: 300px;
  margin-top: 10px;
}

.history-panel tbody tr.latest {
  background: color-mix(in srgb, var(--color-accent-primary) 7%, transparent);
}

.latest-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 7px;
  border-radius: 50%;
  background: var(--color-status-success);
}

.cell-healthy { color: var(--color-status-success); }
.cell-critical { color: var(--color-status-danger); }
.cell-neutral { color: var(--color-text-muted); }

.grade-healthy,
.trend-healthy {
  border-color: color-mix(in srgb, var(--color-status-success) 45%, var(--color-border-default));
  color: var(--color-status-success);
}

.grade-warning,
.trend-warning {
  border-color: color-mix(in srgb, var(--color-status-warning) 45%, var(--color-border-default));
  color: var(--color-status-warning);
}

.grade-critical,
.trend-critical {
  border-color: color-mix(in srgb, var(--color-status-danger) 45%, var(--color-border-default));
  color: var(--color-status-danger);
}

.grade-neutral,
.trend-neutral {
  color: var(--color-accent-primary);
}

.loading-state {
  min-height: 220px;
  margin-top: 14px;
  display: grid;
  place-items: center;
  color: var(--color-text-muted);
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--color-border-default);
  border-top-color: var(--color-accent-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 1500px) {
  .metric-grid { grid-template-columns: repeat(3, minmax(180px, 1fr)); }
  .assessment { grid-template-columns: 130px minmax(240px, 1fr) minmax(260px, 0.9fr); }
}

@media (max-width: 1100px) {
  .page-header,
  .assessment {
    grid-template-columns: 1fr;
  }

  .page-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .header-actions {
    width: 100%;
    justify-content: flex-end;
  }

  .assessment {
    display: grid;
    grid-template-columns: 120px 1fr;
  }

  .assessment-breakdown {
    grid-column: 1 / -1;
  }

  .chart-grid,
  .analysis-grid {
    grid-template-columns: 1fr;
  }

  .side-stack {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: auto;
  }
}

@media (max-width: 720px) {
  .performance-page { padding: 10px; }
  .title-row { align-items: flex-start; flex-direction: column; }
  .header-actions { align-items: stretch; flex-wrap: wrap; }
  .sample-meta { text-align: left; margin-right: auto; }
  .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .assessment { grid-template-columns: 1fr; }
  .assessment-score { justify-content: start; }
  .assessment-breakdown { grid-column: auto; grid-template-columns: 1fr; }
  .side-stack { grid-template-columns: 1fr; }
  .chart-footer { align-items: flex-start; flex-direction: column; padding-top: 8px; }
  .metric-card { min-height: 145px; }
}
</style>
