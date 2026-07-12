<template>
  <div class="insight-panel">
    <h3 class="panel-title">当前状态与运营结论</h3>

    <!-- Operational Conclusions list -->
    <div class="conclusions-list">
      <div class="conclusion-item" :class="playersTone">
        <span class="indicator-dot" />
        <div class="conclusion-content">
          <div class="conclusion-title">在线状态</div>
          <div class="conclusion-desc">{{ playersConclusion }}</div>
        </div>
      </div>

      <div class="conclusion-item" :class="queueTone">
        <span class="indicator-dot" />
        <div class="conclusion-content">
          <div class="conclusion-title">队列压力</div>
          <div class="conclusion-desc">{{ queueConclusion }}</div>
        </div>
      </div>

      <div class="conclusion-item" :class="tpsTone">
        <span class="indicator-dot" />
        <div class="conclusion-content">
          <div class="conclusion-title">性能状态</div>
          <div class="conclusion-desc">{{ tpsConclusion }}</div>
        </div>
      </div>
    </div>

    <!-- Key Statistics List -->
    <div class="stats-section">
      <h4 class="section-title">关键运营统计</h4>
      <div class="stats-grid">
        <div v-if="summary.reached50At" class="stat-card">
          <span class="stat-label">达到 50 人时间</span>
          <span class="stat-value">{{ formatTime(summary.reached50At) }}</span>
        </div>
        <div v-if="summary.fullAt" class="stat-card">
          <span class="stat-label">首次满服时间</span>
          <span class="stat-value">{{ formatTime(summary.fullAt) }}</span>
        </div>
        <div v-if="summary.fullDurationMs > 0" class="stat-card">
          <span class="stat-label">满服累计时间</span>
          <span class="stat-value">{{ formatDuration(summary.fullDurationMs) }}</span>
        </div>
        <div v-if="summary.peakQueue > 0" class="stat-card">
          <span class="stat-label">队列最高峰值</span>
          <span class="stat-value text-orange">{{ summary.peakQueue }} 人</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ServerStatsSummary } from "../../composables/useServerMetricsAnalytics";

const props = defineProps<{
  summary: ServerStatsSummary;
}>();

function formatTime(timestamp: number | null) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(ms: number) {
  if (ms <= 0) return "0 分钟";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (remMins === 0) return `${hours} 小时`;
  return `${hours} 小时 ${remMins} 分钟`;
}

// 1. Players Status Conclusion
const playersTone = computed(() => {
  const p = props.summary.currentPlayers;
  if (p >= 100) return "status-critical";
  if (p >= 80) return "status-warn";
  return "status-ok";
});

const playersConclusion = computed(() => {
  const p = props.summary.currentPlayers;
  if (p >= 100) {
    const fullMin = Math.round(props.summary.fullDurationMs / 60000);
    return `服务器已满员 (100人)，累计满载运行约 ${fullMin} 分钟。`;
  }
  if (p >= 80) {
    return `服务器接近满员 (当前人数: ${p}人)，玩家数较为充裕。`;
  }
  if (p >= 50) {
    return `在线人数为 ${p} 人，处于中等对局承载状态。`;
  }
  return `在线人数为 ${p} 人，目前处于低载暖服状态。`;
});

// 2. Queue Status Conclusion
const queueTone = computed(() => {
  const q = props.summary.currentQueue;
  if (q > 15) return "status-critical";
  if (q > 0) return "status-warn";
  return "status-neutral";
});

const queueConclusion = computed(() => {
  const q = props.summary.currentQueue;
  if (q > 15) {
    return `当前排队 ${q} 人，排队队列较长，队列压力较大。`;
  }
  if (q > 0) {
    return `当前排队 ${q} 人，排队压力适中，持续积累约 ${Math.round(props.summary.queueDurationMs / 60000)} 分钟。`;
  }
  return "当前无玩家排队，进入服务器无需等待。";
});

// 3. TPS Status Conclusion
const tpsTone = computed(() => {
  const t = props.summary.currentTps;
  if (t === null) return "status-neutral";
  if (t < 28) return "status-critical";
  if (t < 35) return "status-warn";
  return "status-ok";
});

const tpsConclusion = computed(() => {
  const t = props.summary.currentTps;
  if (t === null) return "服务器未上报 TPS 指标。";
  if (t < 28) {
    return `TPS 掉至 ${t.toFixed(1)}，处于严重告警状态，累计异常时长 ${Math.round(props.summary.lowTpsDurationMs / 1000)} 秒。`;
  }
  if (t < 35) {
    return `TPS 降至 ${t.toFixed(1)}，服务器出现小幅度帧率抖动。`;
  }
  return `TPS 处于正常范围 (${t.toFixed(1)} FPS)，服务器状态十分稳定。`;
});
</script>

<style scoped>
.insight-panel {
  background: var(--stats-panel, var(--color-bg-card));
  border: 1px solid var(--stats-panel-border, var(--color-border-soft));
  border-radius: var(--card-radius, 14px);
  padding: 16px;
  display: flex;
  flex-direction: column;
  height: 400px;
}

.panel-title {
  font-size: 13px;
  font-weight: 800;
  color: var(--color-text-primary);
  margin: 0 0 16px;
  flex-shrink: 0;
}

.conclusions-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  overflow-y: auto;
  margin-bottom: 16px;
}

.conclusion-item {
  display: flex;
  gap: 10px;
  background: color-mix(in srgb, var(--color-bg-elevated) 60%, transparent);
  border: 1px solid var(--color-border-soft);
  padding: 10px 12px;
  border-radius: 10px;
  align-items: flex-start;
}

.indicator-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 4px;
  flex-shrink: 0;
}

.conclusion-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.conclusion-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.conclusion-desc {
  font-size: 11px;
  color: var(--color-text-secondary);
  line-height: 1.4;
}

/* Tone styles for dot */
.status-ok .indicator-dot {
  background: var(--stats-tps-good, #40b983);
  box-shadow: 0 0 6px rgba(64, 185, 131, 0.4);
}

.status-warn .indicator-dot {
  background: var(--stats-tps-warning, #e7b84b);
  box-shadow: 0 0 6px rgba(231, 184, 75, 0.4);
}

.status-critical .indicator-dot {
  background: var(--stats-tps-critical, #e56868);
  box-shadow: 0 0 6px rgba(229, 104, 104, 0.4);
}

.status-neutral .indicator-dot {
  background: var(--color-text-muted);
}

/* Key Stats section */
.stats-section {
  border-top: 1px solid var(--color-border-soft);
  padding-top: 12px;
  flex-shrink: 0;
}

.section-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0 0 10px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.stat-card {
  background: color-mix(in srgb, var(--color-bg-elevated) 60%, transparent);
  border: 1px solid var(--color-border-soft);
  padding: 8px 10px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-label {
  font-size: 9px;
  color: var(--color-text-muted);
  font-weight: 600;
}

.stat-value {
  font-size: 11px;
  font-weight: 800;
  color: var(--color-text-primary);
  font-family: monospace;
}

.text-orange {
  color: var(--stats-queue, #f0a84b);
}
</style>
