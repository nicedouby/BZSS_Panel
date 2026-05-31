<template>
  <AppCard class="server-metrics-ribbon-card" compact>
    <div class="server-metrics-ribbon">
      <article class="metric-tile metric-players">
        <span class="metric-label">在线人数</span>
        <strong class="metric-value">{{ formatMetricValue(metrics.players) }} <small>pax</small></strong>
      </article>

      <div class="metric-divider"></div>

      <article class="metric-tile" :class="`tone-${tpsTone}`">
        <span class="metric-label">核心帧率</span>
        <strong class="metric-value">{{ formatMetricValue(metrics.tps, 1) }} <small>tps</small></strong>
      </article>

      <div class="metric-divider"></div>

      <article class="metric-tile">
        <span class="metric-label">队列压力</span>
        <strong class="metric-value">{{ formatMetricValue(metrics.queue) }} <small>queue</small></strong>
      </article>
    </div>

    <div class="server-metrics-ribbon-footer">
      <span>{{ rangeLabel }}</span>
      <span>更新于 {{ lastUpdatedLabel }}</span>
    </div>
  </AppCard>
</template>

<script setup lang="ts">
import AppCard from "../common/AppCard.vue";

import type { ServerMetricTone } from "../../composables/useServerMetrics";

defineProps<{
  metrics: Record<string, number>;
  tpsTone: ServerMetricTone;
  rangeLabel: string;
  lastUpdatedLabel: string;
}>();

function formatMetricValue(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }

  if (digits > 0) {
    return value.toFixed(digits);
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
</script>

<style scoped>
.server-metrics-ribbon-card {
  min-width: 0;
}

.server-metrics-ribbon {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 18px;
  align-items: center;
}

.metric-tile {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.metric-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--color-text-muted);
}

.metric-value {
  font-size: clamp(26px, 3vw, 34px);
  line-height: 1;
  font-weight: 800;
  font-family: "JetBrains Mono", monospace;
  color: var(--color-text-primary);
}

.metric-value small {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-muted);
  margin-left: 4px;
}

.metric-divider {
  width: 1px;
  height: 44px;
  background: linear-gradient(180deg, transparent, var(--color-border-default), transparent);
}

.tone-critical .metric-value {
  color: #fb7185;
}

.tone-warn .metric-value {
  color: #fbbf24;
}

.tone-ok .metric-value {
  color: #4ade80;
}

.server-metrics-ribbon-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border-default);
  font-size: 12px;
  color: var(--color-text-muted);
}

@media (max-width: 780px) {
  .server-metrics-ribbon {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .metric-divider {
    width: 100%;
    height: 1px;
  }

  .server-metrics-ribbon-footer {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
