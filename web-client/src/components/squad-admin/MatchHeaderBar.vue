<template>
  <header class="match-header-bar">
    <div class="match-hero-left">
      <strong class="server-name">{{ props.data.serverName }}</strong>
      <span class="layer-line">{{ props.data.mapName }} / {{ props.data.gameMode }}</span>
    </div>

    <div class="match-hero-stats">
      <div class="hero-stat">
        <span>Players</span>
        <strong>{{ props.data.totalPlayers }}/{{ props.data.maxPlayers }}</strong>
      </div>
      <div v-if="props.data.queueCount > 0" class="hero-stat team2">
        <span>Queue</span>
        <strong>{{ props.data.queueCount }}</strong>
      </div>
      <div class="hero-stat team1">
        <span>TEAM 1</span>
        <strong>{{ props.data.team1Count }}</strong>
      </div>
      <div class="hero-stat team2">
        <span>TEAM 2</span>
        <strong>{{ props.data.team2Count }}</strong>
      </div>
      <div class="hero-stat">
        <span>Time</span>
        <strong>{{ formatMatchTime(props.data.matchTimeSeconds) }}</strong>
      </div>
      <div class="hero-stat">
        <span>TPS</span>
        <strong>{{ formatTps(props.data.tps) }}</strong>
      </div>
    </div>

    <div class="match-hero-status">
      <span class="status-line" :class="statusTone(props.data.rconStatus)">
        RCON {{ formatRconStatus(props.data.rconStatus) }}
      </span>
      <span class="status-line" :class="statusTone(props.data.logsStatus)">
        Log {{ formatLogsStatus(props.data.logsStatus) }}
      </span>
      <span class="status-line">
        Updated {{ formatUpdateTime(props.data.lastUpdateTime) }}
      </span>
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

function statusTone(status: string): string {
  if (status === "connected" || status === "live") return "ok";
  if (status === "error") return "error";
  if (status === "disconnected" || status === "stale") return "warn";
  return "idle";
}
</script>

<style scoped>
.match-header-bar {
  display: grid;
  grid-template-columns: minmax(260px, 1.15fr) minmax(420px, 2fr) auto;
  gap: var(--spacing-lg);
  align-items: center;
  background:
    radial-gradient(circle at 0% 0%, var(--color-team1-bg), transparent 34%),
    radial-gradient(circle at 100% 0%, var(--color-team2-bg), transparent 34%),
    var(--color-bg-panel);
  border-bottom: 1px solid var(--color-border-default);
  padding: 14px var(--spacing-lg);
  flex-shrink: 0;
  min-width: 0;
}

.match-hero-left {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.server-name {
  color: var(--color-text-primary);
  font-size: var(--font-size-lg);
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layer-line {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.match-hero-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.hero-stat {
  flex: 1 1 100px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.025);
}

.hero-stat span {
  display: block;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.hero-stat strong {
  display: block;
  margin-top: 2px;
  color: var(--color-text-primary);
  font-size: var(--font-size-md);
  font-weight: 800;
}

.hero-stat.team1 strong {
  color: var(--color-team1-primary);
}

.hero-stat.team2 strong {
  color: var(--color-team2-primary);
}

.match-hero-status {
  display: grid;
  gap: 6px;
  justify-items: end;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.status-line {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  white-space: nowrap;
}

.status-line.ok {
  color: var(--color-status-online);
}

.status-line.warn {
  color: var(--color-status-warning);
}

.status-line.error {
  color: var(--color-status-error);
}

@media (max-width: 1180px) {
  .match-header-bar {
    grid-template-columns: 1fr;
  }

  .match-hero-status {
    justify-items: start;
  }
}

@media (max-width: 960px) {
  .match-hero-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
