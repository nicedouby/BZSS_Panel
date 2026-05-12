<template>
  <header class="match-header-bar">
    <div class="match-header-content">
      <div class="match-info-row">
        <span class="match-info-item">
          <strong>{{ data.serverName }}</strong>
        </span>
        <span class="match-info-separator">·</span>
        <span class="match-info-item">
          {{ data.mapName }}
        </span>
        <span class="match-info-separator">·</span>
        <span class="match-info-item">
          {{ data.gameMode }}
        </span>
        <span class="match-info-separator">·</span>
        <span class="match-info-item">
          {{ t("match.players", "", { current: data.totalPlayers, max: data.maxPlayers }) }}
        </span>
        <span class="match-info-separator">·</span>
        <span class="match-info-item team-1-badge">
          {{ t("match.team1", "", { count: data.team1Count }) }}
        </span>
        <span class="match-info-separator">·</span>
        <span class="match-info-item team-2-badge">
          {{ t("match.team2", "", { count: data.team2Count }) }}
        </span>
        <span class="match-info-separator">·</span>
        <span class="match-info-item">
          {{ formatMatchTime(data.matchTimeSeconds) }}
        </span>
        <span class="match-info-separator">·</span>
        <span class="match-info-item">
          {{ t("topbar.tps", "", { value: formatTps(data.tps) }) }}
        </span>
      </div>
      <div class="match-status-row">
        <span class="status-item" :class="{ error: data.rconStatus !== 'connected' }">
          <span class="status-dot" :style="{ backgroundColor: getStatusColor(data.rconStatus) }" />
          {{ formatRconStatus(data.rconStatus) }}
        </span>
        <span class="status-separator">·</span>
        <span class="status-item" :class="{ error: data.logsStatus === 'error' }">
          <span class="status-dot" :style="{ backgroundColor: getLogsStatusColor(data.logsStatus) }" />
          {{ formatLogsStatus(data.logsStatus) }}
        </span>
        <span class="status-separator">·</span>
        <span
          class="status-item"
          :title="`${t('match.serverUpdated', '', { time: formatUpdateTime(data.serverStatusUpdatedAt) })} / ${t('match.playersUpdated', '', { time: formatUpdateTime(data.playersUpdatedAt) })} / ${t('match.squadsUpdated', '', { time: formatUpdateTime(data.squadsUpdatedAt) })}`"
        >
          {{ t("match.updated", "", { time: formatUpdateTime(data.lastUpdateTime) }) }}
        </span>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import type { MatchHeaderData } from "../../types/squad-admin.types";
import { t } from "../../i18n";

const props = defineProps<{
  data: MatchHeaderData;
}>();

function formatMatchTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatTps(value: number | null | undefined): string {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number.toFixed(1) : "--";
}

function formatRconStatus(status: string): string {
  if (status === "connected") return t("match.rconConnected");
  if (status === "disconnected") return t("match.rconDisconnected");
  if (status === "error") return t("match.rconError");
  if (status === "disabled") return t("match.rconDisabled");
  return t("common.unknown");
}

function formatLogsStatus(status: string): string {
  if (status === "live") return t("match.logsLive");
  if (status === "stale") return t("match.logsStale");
  if (status === "error") return t("common.error");
  return t("common.unknown");
}

function formatUpdateTime(time: number): string {
  if (!time) return "--:--:--";
  const date = new Date(time);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getStatusColor(status: string): string {
  if (status === "connected") return "#22c55e";
  if (status === "disconnected") return "#f59e0b";
  if (status === "error") return "#ef4444";
  return "#64748b";
}

function getLogsStatusColor(status: string): string {
  if (status === "live") return "#22c55e";
  if (status === "stale") return "#f59e0b";
  return "#ef4444";
}
</script>

<style scoped>
.match-header-bar {
  background: var(--color-bg-panel);
  border-bottom: 1px solid var(--color-border-default);
  padding: var(--spacing-md) var(--spacing-lg);
  flex-shrink: 0;
}

.match-header-content {
  display: grid;
  gap: 8px;
  font-size: var(--font-size-sm);
}

.match-info-row,
.match-status-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  color: var(--color-text-secondary);
}

.match-info-row strong {
  color: var(--color-text-primary);
  font-weight: 700;
}

.match-info-item {
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
}

.match-info-separator {
  opacity: 0.4;
}

.team-1-badge {
  color: var(--color-team1-primary);
}

.team-2-badge {
  color: var(--color-team2-primary);
}

.status-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.status-separator {
  opacity: 0.5;
}

.status-item.error {
  color: var(--color-status-warning);
}

.status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

@media (max-width: 1200px) {
  .match-info-row {
    font-size: 11px;
  }

  .match-info-item,
  .status-item {
    min-width: 0;
  }
}
</style>
