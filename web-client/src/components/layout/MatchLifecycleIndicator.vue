<template>
  <div
    class="match-lifecycle-bar"
    :data-state="lifecycleState"
    role="status"
    aria-live="polite"
    :title="detailTitle"
  >
    <span class="match-lifecycle-state">
      <span class="match-lifecycle-dot" aria-hidden="true"></span>
      <strong>{{ stateLabel }}</strong>
    </span>

    <span v-if="identityLabel" class="match-lifecycle-identity">{{ identityLabel }}</span>
    <span v-if="winnerLabel" class="match-lifecycle-winner">{{ winnerLabel }}</span>
    <span v-if="!connected" class="match-lifecycle-stale">RCON 已断开 · 保留最后状态</span>
    <span class="match-lifecycle-spacer"></span>
    <span
      class="main-thread-chip"
      :data-tone="mainThreadTone"
      :title="mainThreadTitle"
      aria-label="Panel main thread performance"
    >
      <span class="main-thread-name">MAIN</span>
      <strong>{{ mainThreadUtilizationLabel }}</strong>
      <span class="main-thread-delay">P95 {{ mainThreadP95Label }}</span>
    </span>
    <span v-if="phaseTimeLabel" class="match-lifecycle-time">{{ phaseTimeLabel }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useSystemStatus } from "../../app/runtimeSync";
import { useServerStore } from "../../stores/server.store";

const server = useServerStore();
const systemStatus = useSystemStatus();

const lifecycle = computed<Record<string, any>>(() => {
  const snapshot = server.snapshot ?? {};
  return snapshot.matchLifecycle
    ?? snapshot.webStatus?.matchLifecycle
    ?? snapshot.matchState?.matchLifecycle
    ?? {};
});

const lifecycleState = computed(() => String(lifecycle.value.state ?? "unknown").trim() || "unknown");
const connected = computed(() => lifecycle.value.connected !== false);

const stateLabel = computed(() => {
  switch (lifecycleState.value) {
    case "waiting": return "等待比赛";
    case "loading_map": return "地图切换中";
    case "map_ready": return "地图已加载";
    case "live": return "对局进行中";
    case "ending": return "对局结算中";
    case "finished": return "对局已结束";
    case "next_match": return "本局已结束 · 等待下一局";
    default: return "比赛状态未知";
  }
});

const identityLabel = computed(() => {
  const layer = clean(lifecycle.value.layer);
  const map = clean(lifecycle.value.map);
  const mode = clean(lifecycle.value.mode);
  if (layer) return mode && !layer.toLowerCase().includes(mode.toLowerCase()) ? `${layer} / ${mode}` : layer;
  if (map && mode) return `${map} / ${mode}`;
  return map;
});

const winnerLabel = computed(() => {
  const winner = clean(lifecycle.value.winner);
  if (!winner || !["ending", "finished", "next_match"].includes(lifecycleState.value)) return "";
  return `胜方 ${winner}`;
});

const phaseTimeLabel = computed(() => {
  const target = ["ending", "finished", "next_match"].includes(lifecycleState.value)
    ? lifecycle.value.endedAt
    : lifecycle.value.startedAt;
  const millis = Date.parse(String(target ?? ""));
  if (!Number.isFinite(millis)) return "";
  const date = new Date(millis);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
});

const mainThread = computed<Record<string, any>>(() => (
  (systemStatus.value as any)?.system?.performance?.latest?.eventLoop ?? {}
));
const mainThreadUtilization = computed(() => finiteNumber(mainThread.value.utilization));
const mainThreadMean = computed(() => finiteNumber(mainThread.value.mean));
const mainThreadP95 = computed(() => finiteNumber(mainThread.value.p95));
const mainThreadP99 = computed(() => finiteNumber(mainThread.value.p99));
const mainThreadMax = computed(() => finiteNumber(mainThread.value.max));

const mainThreadUtilizationLabel = computed(() => {
  const value = mainThreadUtilization.value;
  if (value == null) return "--";
  const percent = Math.max(0, Math.min(1, value)) * 100;
  return `${percent.toFixed(percent >= 10 ? 0 : 1)}%`;
});

const mainThreadP95Label = computed(() => formatMilliseconds(mainThreadP95.value));

const mainThreadTone = computed(() => {
  const utilization = mainThreadUtilization.value;
  const p99 = mainThreadP99.value;
  const max = mainThreadMax.value;
  if (utilization == null && p99 == null && max == null) return "waiting";
  if ((utilization ?? 0) >= 0.9 || (p99 ?? 0) >= 100 || (max ?? 0) >= 250) return "critical";
  if ((utilization ?? 0) >= 0.7 || (p99 ?? 0) >= 50 || (max ?? 0) >= 100) return "warning";
  return "healthy";
});

const mainThreadTitle = computed(() => {
  const utilization = mainThreadUtilizationLabel.value;
  const mean = formatMilliseconds(mainThreadMean.value);
  const p95 = formatMilliseconds(mainThreadP95.value);
  const p99 = formatMilliseconds(mainThreadP99.value);
  const max = formatMilliseconds(mainThreadMax.value);
  return `Panel 主线程（Node.js Event Loop） · Busy ${utilization} · Mean ${mean} · P95 ${p95} · P99 ${p99} · Max ${max}`;
});

const detailTitle = computed(() => {
  const parts = [
    stateLabel.value,
    identityLabel.value,
    winnerLabel.value,
    lifecycle.value.reason ? `原因: ${lifecycle.value.reason}` : "",
    lifecycle.value.source ? `来源: ${lifecycle.value.source}` : "",
    lifecycle.value.isReplay ? "状态来源包含日志回溯" : "",
  ].filter(Boolean);
  return parts.join(" · ");
});

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatMilliseconds(value: number | null) {
  if (value == null) return "--";
  if (value >= 100) return `${value.toFixed(0)}ms`;
  if (value >= 10) return `${value.toFixed(1)}ms`;
  return `${value.toFixed(2)}ms`;
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}
</script>

<style scoped>
.match-lifecycle-bar {
  min-width: 0;
  min-height: 30px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border, #334155) 58%, transparent);
  background: color-mix(in srgb, var(--color-bg-panel, #0f172a) 86%, transparent);
  color: var(--color-text, #e2e8f0);
  font-size: 12px;
  line-height: 1.2;
  overflow: hidden;
}

.match-lifecycle-state,
.match-lifecycle-identity,
.match-lifecycle-winner,
.match-lifecycle-stale,
.match-lifecycle-time,
.main-thread-chip {
  white-space: nowrap;
}

.match-lifecycle-state {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
}

.match-lifecycle-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #94a3b8;
  box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.12);
}

.match-lifecycle-bar[data-state="live"] .match-lifecycle-dot,
.match-lifecycle-bar[data-state="map_ready"] .match-lifecycle-dot {
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.13);
}

.match-lifecycle-bar[data-state="loading_map"] .match-lifecycle-dot,
.match-lifecycle-bar[data-state="waiting"] .match-lifecycle-dot {
  background: #eab308;
  box-shadow: 0 0 0 3px rgba(234, 179, 8, 0.13);
}

.match-lifecycle-bar[data-state="ending"] .match-lifecycle-dot {
  background: #f97316;
  box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.13);
}

.match-lifecycle-bar[data-state="finished"] .match-lifecycle-dot,
.match-lifecycle-bar[data-state="next_match"] .match-lifecycle-dot {
  background: #64748b;
  box-shadow: 0 0 0 3px rgba(100, 116, 139, 0.15);
}

.match-lifecycle-identity {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text-secondary, #cbd5e1);
}

.match-lifecycle-winner {
  color: #fbbf24;
  font-weight: 600;
}

.match-lifecycle-stale {
  color: #f59e0b;
}

.match-lifecycle-spacer {
  flex: 1 1 auto;
  min-width: 4px;
}

.main-thread-chip {
  flex: 0 0 auto;
  min-height: 21px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(148, 163, 184, 0.07);
  color: #cbd5e1;
  font-variant-numeric: tabular-nums;
  cursor: default;
}

.main-thread-name {
  color: #94a3b8;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.main-thread-chip strong {
  font-size: 11px;
  font-weight: 800;
}

.main-thread-delay {
  color: #94a3b8;
  font-size: 10px;
}

.main-thread-chip[data-tone="healthy"] {
  border-color: rgba(34, 197, 94, 0.28);
  background: rgba(34, 197, 94, 0.08);
  color: #bbf7d0;
}

.main-thread-chip[data-tone="warning"] {
  border-color: rgba(234, 179, 8, 0.38);
  background: rgba(234, 179, 8, 0.1);
  color: #fde68a;
}

.main-thread-chip[data-tone="critical"] {
  border-color: rgba(248, 113, 113, 0.46);
  background: rgba(248, 113, 113, 0.12);
  color: #fecaca;
}

.main-thread-chip[data-tone="waiting"] {
  opacity: 0.72;
}

.match-lifecycle-time {
  flex: 0 0 auto;
  color: var(--color-text-muted, #94a3b8);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 780px) {
  .match-lifecycle-bar {
    gap: 8px;
    padding-inline: 10px;
  }

  .match-lifecycle-winner,
  .match-lifecycle-time,
  .main-thread-delay {
    display: none;
  }

  .main-thread-chip {
    padding-inline: 7px;
  }
}
</style>
