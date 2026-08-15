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
    <span v-if="phaseTimeLabel" class="match-lifecycle-time">{{ phaseTimeLabel }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useServerStore } from "../../stores/server.store";

const server = useServerStore();

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
.match-lifecycle-time {
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
  .match-lifecycle-time {
    display: none;
  }
}
</style>
