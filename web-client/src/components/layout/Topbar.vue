<template>
  <header class="topbar">
    <div class="topbar-grid">
      <div class="topbar-brand">
        <button
          type="button"
          class="menu-button"
          :aria-label="sidebarButtonLabel"
          :title="sidebarButtonLabel"
          @click="toggleSidebar"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
        <div class="topbar-copy">
          <strong v-if="showPageTitle">{{ pageTitle }}</strong>
          <div class="topbar-meta">
            <span class="topbar-subtitle">{{ subtitleLabel }}</span>
            <button
              type="button"
              class="warmup-chip"
              :data-warmup="warmupState ? 'on' : 'off'"
              :disabled="warmupBusy"
              @click="toggleWarmup"
            >
              {{ warmupLabel }}
            </button>
          </div>
        </div>
      </div>

      <div class="topbar-center">
        <div class="match-summary">
          <span class="match-chip match-chip-strong">{{ matchPlayersLabel }}</span>
          <span class="match-chip match-chip-team1">{{ t("match.team1", "", { count: matchTeam1Count }) }}</span>
          <span class="match-chip match-chip-team2">{{ t("match.team2", "", { count: matchTeam2Count }) }}</span>
          <button
            type="button"
            class="match-chip match-chip-button"
            :disabled="!canEditLogClock || logClockSaving"
            :title="logClockTitle"
            @click="editLogClock"
          >
            {{ mergedClockLabel }}
          </button>
          <span class="match-chip">{{ matchTpsLabel }}</span>
          <span class="topbar-sys-divider"></span>
          <span class="match-chip sys-metric" :title="`Memory RSS: ${sysMemLabel}`">{{ sysMemLabel }}</span>
        </div>
      </div>

      <div class="topbar-actions">
        <span v-if="runtimeError" class="metric error optional">{{ runtimeError }}</span>
        <button
          v-if="canControlTacticalReplayRecording"
          type="button"
          class="metric metric-button tactical-recording-control"
          :class="{ active: tacticalReplayRecordingEnabled }"
          :disabled="tacticalReplayRecordingLoading || tacticalReplayRecordingSaving"
          :title="tacticalReplayRecordingTitle"
          @click="toggleTacticalReplayRecording"
        >
          {{ tacticalReplayRecordingLabel }}
        </button>
        <BzssCoreMenu />
        <div class="topbar-health" aria-label="RCON and log status">
          <span class="health-chip" :class="rconHealthTone">R</span>
          <span class="health-chip" :class="logHealthTone">L</span>
        </div>
        <button v-if="isMobile" type="button" class="metric more-status-button" @click="mobileStatusOpen = true">
          More
        </button>
        <UserMenu
          @open-plugin-center="emit('open-plugin-center')"
          @open-rcon-modal="emit('open-rcon-modal')"
        />
      </div>
    </div>
    <MobileBottomSheet
      :open="mobileStatusOpen"
      title="More Status"
      description="Secondary runtime and system metrics"
      @close="mobileStatusOpen = false"
    >
      <div class="mobile-status-grid">
        <button type="button" class="mobile-status-item" :disabled="!canEditLogClock || logClockSaving" @click="editLogClock">
          <span class="mobile-status-label">Clock</span>
          <strong>{{ mergedClockLabel }}</strong>
        </button>
        <div class="mobile-status-item"><span class="mobile-status-label">TPS</span><strong>{{ matchTpsLabel }}</strong></div>
        <div class="mobile-status-item"><span class="mobile-status-label">Memory</span><strong>{{ sysMemLabel }}</strong></div>
        <div class="mobile-status-item"><span class="mobile-status-label">Queue</span><strong>{{ matchQueueLabel }}</strong></div>
        <div class="mobile-status-item"><span class="mobile-status-label">Time</span><strong>{{ matchTimeLabel }}</strong></div>
      </div>
    </MobileBottomSheet>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { apiGet, apiPost, ApiError } from "../../app/apiClient";
import { useAuthStore } from "../../stores/auth.store";
import { useServerStore } from "../../stores/server.store";
import { usePlayerStore } from "../../stores/player.store";
import { useSquadStore } from "../../stores/squad.store";
import { useMatchStore } from "../../stores/match.store";
import { getRuntimeSyncState, useSystemStatus } from "../../app/runtimeSync";
import { useUiStore } from "../../stores/ui.store";
import { fetchWarmupState, updateWarmupState } from "../../app/warmupApi";
import { useIsMobile } from "../../composables/useMediaQuery";
import MobileBottomSheet from "../mobile/MobileBottomSheet.vue";
import UserMenu from "./UserMenu.vue";
import BzssCoreMenu from "./BzssCoreMenu.vue";
import { t } from "../../i18n";

const emit = defineEmits<{
  (event: "open-plugin-center"): void;
  (event: "open-rcon-modal"): void;
}>();

const server = useServerStore();
const players = usePlayerStore();
const squads = useSquadStore();
const match = useMatchStore();
const auth = useAuthStore();
const runtime = getRuntimeSyncState();
const sysStatus = useSystemStatus();
const route = useRoute();
const ui = useUiStore();
const isMobile = useIsMobile(1024);
// 导航抽屉断点统一到 ≤1100px，独立于内容断点
const isNavDrawer = useIsMobile(1100);
const warmupLoaded = ref(false);
const warmupLoading = ref(false);
const warmupSaving = ref(false);
const logClockSaving = ref(false);
const tacticalReplayRecordingLoading = ref(false);
const tacticalReplayRecordingSaving = ref(false);
const tacticalReplayRecordingEnabled = ref(false);
const mobileStatusOpen = ref(false);

const webStatus = computed(() => server.snapshot.webStatus ?? server.snapshot ?? {});
const currentLayer = computed(() => stableDisplayValue(
  server.snapshot.currentLayer,
  webStatus.value.currentLayer,
  server.snapshot.layer,
  webStatus.value.layer,
  server.snapshot.map,
  webStatus.value.map,
  server.snapshot.mapName,
  webStatus.value.mapName,
  t("topbar.unknownLayer", "Unknown Layer"),
));
const currentMode = computed(() => stableDisplayValue(
  server.snapshot.gameMode,
  webStatus.value.gameMode,
  server.snapshot.mode,
  webStatus.value.mode,
  t("match.unknownMode", "Unknown Mode"),
));
const subtitleLabel = computed(() => {
  const unknownMode = t("match.unknownMode", "Unknown Mode");
  if (currentMode.value && currentMode.value !== unknownMode) return `${currentLayer.value} / ${currentMode.value}`;
  return currentLayer.value;
});

const matchServerName = computed(() => stableDisplayValue(
  server.snapshot.serverName,
  webStatus.value.serverName,
  server.snapshot.name,
  webStatus.value.name,
  t("match.unknownServer", "Unknown Server"),
));
const pageTitle = computed(() => {
  if (route.path === "/match-status") return matchServerName.value;
  const titleKey = route.meta.titleKey ? String(route.meta.titleKey) : "";
  const title = route.meta.title ? String(route.meta.title) : "";
  if (titleKey) return t(titleKey, title);
  return String(title || server.snapshot.serverName || webStatus.value.serverName || server.snapshot.name || webStatus.value.name || "BZSS Panel");
});
const showPageTitle = computed(() => route.path !== "/match-status");
const logClockSeconds = computed(() => {
  const value = Number(
    webStatus.value.logClockSeconds
      ?? server.snapshot.logClockSeconds
      ?? server.snapshot.webStatus?.logClockSeconds,
  );

  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
});
const logClockLabel = computed(() => {
  if (logClockSeconds.value == null) return "--:--";
  return formatDuration(logClockSeconds.value);
});
const canEditLogClock = computed(() => auth.user?.isSuperAdmin === true);
const canControlTacticalReplayRecording = computed(() => auth.user?.isSuperAdmin === true);
const tacticalReplayRecordingLabel = computed(() => {
  if (tacticalReplayRecordingLoading.value) return "录像状态…";
  return tacticalReplayRecordingEnabled.value ? "结束录像" : "开始录像";
});
const tacticalReplayRecordingTitle = computed(() => {
  if (tacticalReplayRecordingLoading.value) return "正在读取战术回放录制状态。";
  if (tacticalReplayRecordingSaving.value) return "正在更新战术回放录制状态。";
  return tacticalReplayRecordingEnabled.value
    ? "停止当前战术回放录制；对局结束时也会自动停止。"
    : "开始录制当前战术地图回放。";
});
const logClockTitle = computed(() => {
  if (!canEditLogClock.value) return t("topbar.logClockReadonly", "Only super admins can edit the log clock.");
  if (logClockSaving.value) return t("topbar.logClockSaving", "Saving log clock...");
  return t("topbar.logClockEditable", "Click to edit the log clock.");
});
const sidebarButtonLabel = computed(() => ui.sidebarCollapsed ? t("topbar.expand") : t("topbar.collapse"));
const runtimeError = computed(() => runtime.lastError ? briefRuntimeError(runtime.lastError) : "");
const warmupState = computed(() => resolveWarmupState(webStatus.value, server.snapshot));
const warmupLabel = computed(() => {
  if (!warmupLoaded.value && warmupLoading.value) return t("topbar.warmupLoading");
  return warmupState.value ? t("topbar.warmupOn") : t("topbar.warmupOff");
});
const warmupBusy = computed(() => warmupLoading.value || warmupSaving.value);

const matchTeam1Count = computed(() => match.team1Players.length);
const matchTeam2Count = computed(() => match.team2Players.length);
const matchTotalPlayers = computed(() => matchTeam1Count.value + matchTeam2Count.value);
const matchMaxPlayers = computed(() => {
  const value = Number(server.snapshot?.maxPlayers ?? server.snapshot?.webStatus?.maxPlayers);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 100;
});
const matchPlayersLabel = computed(() => {
  const players = t("match.players", "", {
    current: matchTotalPlayers.value,
    max: matchMaxPlayers.value,
  });
  if (matchQueueCount.value > 0) {
    return `${players} (+${matchQueueCount.value})`;
  }
  return players;
});
const matchQueueCount = computed(() => {
  const value = Number(
    server.snapshot?.queueCount
      ?? server.snapshot?.webStatus?.queueCount
      ?? server.snapshot?.matchState?.serverStatus?.queueCount
      ?? 0
  );
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
});
const matchQueueLabel = computed(() => t("topbar.queue", "", { count: matchQueueCount.value }));
const matchMatchTimeSeconds = computed(() => {
  const value = Number(
    server.snapshot?.matchTimeSeconds
      ?? server.snapshot?.playtime
      ?? server.snapshot?.webStatus?.matchTimeSeconds
      ?? server.snapshot?.webStatus?.playtime,
  );

  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
});
const matchTimeLabel = computed(() => `Time ${formatMatchTime(matchMatchTimeSeconds.value)}`);
const matchTpsLabel = computed(() => `TPS ${formatTps(
  server.snapshot?.tps
    ?? server.snapshot?.webStatus?.tps
    ?? null,
)}`);
const matchRconStatus = computed(() => String(
  server.snapshot?.rconStatus
    ?? webStatus.value.rcon
    ?? "unknown",
));
const matchLogsStatus = computed(() => (runtime.lastError ? "stale" : "live"));
const rconHealthTone = computed(() => statusTone(matchRconStatus.value) === "ok" ? "ok" : "error");
const logHealthTone = computed(() => statusTone(matchLogsStatus.value) === "ok" ? "ok" : "error");
const mergedClockLabel = computed(() => `R ${formatMatchTime(matchMatchTimeSeconds.value)} / L ${logClockLabel.value}`);
const matchUpdatedAt = computed(() => Math.max(
  server.updatedAt,
  players.updatedAt,
  squads.updatedAt,
  toMillis(server.snapshot?.matchState?.serverStatus?.lastUpdatedAt),
  toMillis(server.snapshot?.matchState?.players?.lastUpdatedAt),
  toMillis(server.snapshot?.matchState?.squads?.lastUpdatedAt),
));
const matchUpdatedLabel = computed(() => t("match.updated", "", {
  time: formatUpdateTime(matchUpdatedAt.value),
}));

/* ── System Metrics (subtle topbar display) ── */
function fmtSysUptime(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return "--";
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(" ");
}

function fmtSysMem(bytes: number | null | undefined) {
  if (bytes == null || !Number.isFinite(bytes)) return "--";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtSysRate(bytesPerSec?: number | null) {
  if (!Number.isFinite(Number(bytesPerSec))) return "--";
  const value = Number(bytesPerSec);
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let size = Math.max(0, value);
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

const sysUptimeLabel = computed(() => fmtSysUptime(sysStatus.value?.system?.uptime));
const sysMemLabel = computed(() => fmtSysMem(sysStatus.value?.system?.memory?.rss));
const sysNetInLabel = computed(() => fmtSysRate(sysStatus.value?.system?.performance?.latest?.network?.bytesInPerSec));
const sysNetOutLabel = computed(() => fmtSysRate(sysStatus.value?.system?.performance?.latest?.network?.bytesOutPerSec));

onMounted(() => {
  void loadWarmupState();
  if (canControlTacticalReplayRecording.value) void loadTacticalReplayRecordingState();
});

function briefRuntimeError(value: string) {
  if (value.length <= 52) return value;
  return `${value.slice(0, 49)}...`;
}

async function editLogClock() {
  if (!canEditLogClock.value || logClockSaving.value) return;

  const currentValue = logClockSeconds.value == null ? "00:00" : formatDuration(logClockSeconds.value);
  const input = window.prompt(
    t("topbar.logClockPrompt", "Enter the log clock value (supports hh:mm:ss, mm:ss, or seconds)."),
    currentValue,
  );
  if (input == null) return;

  const seconds = parseClockInput(input);
  if (seconds == null) {
    ui.pushToast({
      title: t("common.error"),
      message: t("topbar.logClockInvalid", "Invalid log clock value."),
      tone: "error",
    });
    return;
  }

  logClockSaving.value = true;
  try {
    const response = await apiPost<{ ok?: boolean; logClockSeconds?: number }>("/api/log-clock/set", { seconds });
    const nextSeconds = Number(response.logClockSeconds ?? seconds);
    server.applyStableSnapshot({
      logClockSeconds: nextSeconds,
      logClockManual: true,
      logClockHasAnchor: false,
      webStatus: {
        logClockSeconds: nextSeconds,
        logClockManual: true,
        logClockHasAnchor: false,
      },
    });
    ui.pushToast({
      title: t("common.save"),
      message: t("topbar.logClockSaved", "Log clock updated to {value}.", { value: formatDuration(nextSeconds) }),
      tone: "ok",
    });
  } catch (error) {
    const message = error instanceof ApiError
      ? error.message
      : t("topbar.logClockSaveFailed", "Failed to update the log clock.");
    ui.pushToast({
      title: t("common.error"),
      message,
      tone: "error",
    });
  } finally {
    logClockSaving.value = false;
  }
}

async function loadTacticalReplayRecordingState() {
  if (!canControlTacticalReplayRecording.value) return;
  tacticalReplayRecordingLoading.value = true;
  try {
    const status = await apiGet<{ recordingEnabled?: boolean }>("/api/tactical-feed-writer/status");
    if (typeof status.recordingEnabled === "boolean") {
      tacticalReplayRecordingEnabled.value = status.recordingEnabled;
    }
  } catch (error) {
    ui.pushToast({
      title: "战术回放",
      message: error instanceof ApiError ? error.message : "无法读取录制状态。",
      tone: "error",
    });
  } finally {
    tacticalReplayRecordingLoading.value = false;
  }
}

async function toggleTacticalReplayRecording() {
  if (!canControlTacticalReplayRecording.value || tacticalReplayRecordingLoading.value || tacticalReplayRecordingSaving.value) return;

  const enabled = !tacticalReplayRecordingEnabled.value;
  const confirmed = await ui.openConfirm({
    title: enabled ? "开始战术回放录像" : "结束战术回放录像",
    message: enabled
      ? "确认开始录制当前对局的战术地图回放？"
      : "确认停止并保存当前战术地图回放？",
    confirmText: enabled ? "开始录像" : "结束录像",
    cancelText: "取消",
    tone: enabled ? "warn" : "idle",
  });
  if (!confirmed) return;

  tacticalReplayRecordingSaving.value = true;
  try {
    const result = await apiPost<{ recordingEnabled?: boolean }>("/api/tactical-feed-writer/recording", { enabled });
    tacticalReplayRecordingEnabled.value = result.recordingEnabled === true;
    ui.pushToast({
      title: "战术回放",
      message: tacticalReplayRecordingEnabled.value ? "已开始录制。" : "已停止录制。",
      tone: "ok",
    });
  } catch (error) {
    ui.pushToast({
      title: "战术回放",
      message: error instanceof ApiError ? error.message : "更新录制状态失败。",
      tone: "error",
    });
  } finally {
    tacticalReplayRecordingSaving.value = false;
  }
}

async function loadWarmupState() {
  warmupLoading.value = true;
  try {
    const snapshot = await fetchWarmupState();
    applyWarmupState(snapshot);
  } catch {
    // Keep the last known runtime snapshot if the dedicated call fails.
  } finally {
    warmupLoading.value = false;
    warmupLoaded.value = true;
  }
}

async function toggleWarmup() {
  if (warmupBusy.value) return;

  const targetWarmup = !warmupState.value;
  const confirmed = await ui.openConfirm({
    title: targetWarmup ? "Enable warmup" : "Disable warmup",
    message: targetWarmup
      ? "Confirm enabling warmup for the current server."
      : "Confirm disabling warmup for the current server.",
    confirmText: targetWarmup ? "Confirm enable" : "Confirm disable",
    cancelText: "Cancel",
    tone: targetWarmup ? "warn" : "idle",
  });
  if (!confirmed) return;

  warmupSaving.value = true;
  try {
    const next = await updateWarmupState(targetWarmup);
    applyWarmupState(next);
  } catch {
    // Leave the current state untouched if the update fails.
  } finally {
    warmupSaving.value = false;
    warmupLoaded.value = true;
  }
}

function applyWarmupState(state: { isWarmup: boolean; updatedAt: string | null; updatedBy?: string | null; }) {
  server.applyStableSnapshot({
    isWarmup: state.isWarmup,
    warmupUpdatedAt: state.updatedAt,
    warmupUpdatedBy: state.updatedBy ?? null,
    webStatus: {
      isWarmup: state.isWarmup,
      warmupUpdatedAt: state.updatedAt,
      warmupUpdatedBy: state.updatedBy ?? null,
    },
  });
}

function resolveWarmupState(webStatusSnapshot: Record<string, any>, snapshot: Record<string, any>) {
  if (typeof webStatusSnapshot?.isWarmup === "boolean") return webStatusSnapshot.isWarmup;
  if (typeof snapshot?.isWarmup === "boolean") return snapshot.isWarmup;
  return false;
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function asRecord(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, any>;
}

function parseClockInput(value: string): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    return clampSeconds(Number(text));
  }

  const parts = text.split(":").map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }

  let seconds = 0;
  for (const part of parts) {
    seconds = (seconds * 60) + Number(part);
  }
  return clampSeconds(seconds);
}

function clampSeconds(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), 7 * 24 * 3600);
}

function formatMatchTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatTps(value: number | null | undefined): string {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number.toFixed(1) : "--";
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

function stableDisplayValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) continue;
      if (text === "Unknown" || text === "Unknown Server" || text === "Unknown Map" || text === "Unknown Layer") continue;
      return text;
    }
    if (value !== undefined && value !== null) {
      return String(value);
    }
  }
  return t("topbar.unknownLayer", "Unknown Layer");
}

function toMillis(value: string | number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value) return 0;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toggleSidebar() {
  if (isNavDrawer.value) {
    ui.toggleMobileSidebar();
    return;
  }
  ui.toggleSidebarCollapsed();
}
</script>

<style scoped>
.topbar {
  position: relative;
  z-index: var(--z-topbar);
  overflow: visible;
  padding: 6px 14px 7px;
  border-bottom: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.016)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-panel);
  backdrop-filter: blur(12px);
  box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.02);
  padding-top: calc(6px + var(--safe-top));
}

.topbar-grid {
  display: grid;
  grid-template-columns: minmax(280px, 1.05fr) minmax(0, 1.3fr) auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.topbar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.topbar-copy {
  min-width: 0;
}

.topbar-copy strong,
.topbar-copy span {
  display: block;
}

.topbar-copy strong {
  font-size: 14px;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.topbar-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 1px;
  min-width: 0;
  flex-wrap: wrap;
}

.topbar-subtitle {
  color: var(--color-text-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.warmup-chip {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid rgba(122, 162, 184, 0.26);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.02)), rgba(255, 255, 255, 0.004)),
    rgba(122, 162, 184, 0.14);
  color: #d7f3ff;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.01em;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease;
}

.warmup-chip[data-warmup="on"] {
  border-color: rgba(52, 211, 153, 0.45);
  background: rgba(52, 211, 153, 0.16);
  color: #bbf7d0;
}

.warmup-chip[data-warmup="off"] {
  border-color: rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.13);
  color: #fecaca;
}

.warmup-chip:disabled {
  cursor: wait;
  opacity: 0.72;
}

.menu-button {
  display: none;
}

@media (max-width: 1100px) {
  .menu-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    min-width: var(--touch-target-min);
    min-height: var(--touch-target-min);
    padding: 0;
    border-radius: 10px;
    border: 1px solid var(--color-border-default);
    background: var(--color-bg-elevated);
    color: var(--color-text-primary);
    box-shadow: var(--shadow-sm);
  }

  .menu-button:active {
    background: var(--color-bg-hover);
  }
}

.topbar-center {
  min-width: 0;
  display: flex;
  justify-content: flex-start;
}

.match-summary {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

.match-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid rgba(122, 162, 184, 0.22);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.018)), rgba(255, 255, 255, 0.004)),
    rgba(122, 162, 184, 0.09);
  color: var(--color-text-secondary);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  box-shadow: var(--shadow-sm);
}

.match-chip-strong {
  color: var(--color-text-primary);
}

.match-chip-team1 {
  color: var(--color-team1-primary);
}

.match-chip-team2 {
  color: var(--color-team2-primary);
}

.match-chip-button {
  appearance: none;
  -webkit-appearance: none;
  text-align: left;
  border-color: rgba(122, 162, 184, 0.3);
  padding: 0 8px;
  color: #d7f3ff;
  cursor: pointer;
  font: inherit;
}

.match-chip-button:disabled {
  cursor: not-allowed;
  opacity: 0.68;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
  min-width: 0;
}

.metric {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid rgba(122, 162, 184, 0.22);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.018)), rgba(255, 255, 255, 0.004)),
    rgba(122, 162, 184, 0.09);
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  box-shadow: var(--shadow-sm);
}

.metric-button {
  appearance: none;
  -webkit-appearance: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.metric-button:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

.tactical-recording-control {
  border-color: rgba(248, 113, 113, 0.42);
  background: rgba(248, 113, 113, 0.1);
  color: #fecaca;
}

.tactical-recording-control.active {
  border-color: rgba(248, 113, 113, 0.7);
  background: rgba(248, 113, 113, 0.2);
  color: #fff1f2;
}

.metric.primary {
  color: var(--color-text-primary);
  border-color: rgba(122, 162, 184, 0.3);
}

.metric.error {
  color: #ffb1b1;
}

.metric.optional {
  display: inline-flex;
}

.topbar-health {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
}

.health-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  min-width: 20px;
  min-height: 20px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid rgba(122, 162, 184, 0.22);
  color: var(--color-text-secondary);
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  box-shadow: var(--shadow-sm);
}

.health-chip.ok {
  border-color: rgba(52, 211, 153, 0.38);
  background: rgba(52, 211, 153, 0.14);
  color: #bbf7d0;
}

.health-chip.error {
  border-color: rgba(248, 113, 113, 0.42);
  background: rgba(248, 113, 113, 0.13);
  color: #fecaca;
}

.updated-metric {
  color: var(--color-text-muted);
}

.more-status-button {
  min-height: var(--touch-target-min);
}

.mobile-status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.mobile-status-item {
  min-height: 76px;
  padding: 12px;
  display: grid;
  gap: 6px;
  text-align: left;
  border-radius: 14px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.mobile-status-label {
  color: var(--color-text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.topbar-sys-divider {
  width: 1px;
  height: 14px;
  background: rgba(122, 162, 184, 0.18);
  flex: 0 0 auto;
}

.sys-metric {
  color: var(--color-text-muted) !important;
  opacity: 0.6;
  font-size: 9px !important;
  font-weight: 600 !important;
  border-color: rgba(122, 162, 184, 0.12) !important;
  background: rgba(122, 162, 184, 0.04) !important;
  box-shadow: none !important;
  transition: opacity 0.2s ease;
}

.sys-metric:hover {
  opacity: 1;
}

@media (max-width: 1180px) {
  .topbar-grid {
    grid-template-columns: minmax(250px, 1fr) minmax(0, 1fr);
    grid-template-areas:
      "brand actions"
      "center center";
  }

  .topbar-brand {
    grid-area: brand;
  }

  .topbar-center {
    grid-area: center;
  }

  .topbar-actions {
    grid-area: actions;
    flex-wrap: wrap;
  }
}

@media (max-width: 780px) {
  .topbar {
    padding: calc(6px + var(--safe-top)) 10px 7px;
  }

  .topbar-grid {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    grid-template-areas:
      "brand actions"
      "center center";
  }

  .topbar-brand {
    align-items: center;
  }

  .topbar-actions {
    justify-content: flex-end;
  }

  .topbar-center {
    justify-content: flex-start;
  }

  .topbar-subtitle {
    max-width: 42vw;
  }

  .match-summary {
    overflow-x: auto;
    flex-wrap: nowrap;
    padding-bottom: 2px;
  }

  .match-summary > :nth-child(n + 4) {
    display: none;
  }

  .updated-metric {
    display: none;
  }
}

@media (max-width: 1100px) {
  .metric.optional {
    display: none;
  }
}

@media (orientation: landscape) and (max-height: 520px) {
  .topbar {
    padding: calc(4px + var(--safe-top)) 8px 5px;
  }

  .topbar-grid {
    gap: 6px;
  }

  .topbar-brand {
    gap: 7px;
  }

  .topbar-copy strong {
    font-size: 13px;
  }

  .topbar-subtitle,
  .warmup-chip,
  .metric {
    font-size: 10px;
  }

  .warmup-chip,
  .metric {
    min-height: 18px;
    padding: 0 6px;
  }

  .menu-button {
    border-radius: 8px;
  }

  .match-summary {
    gap: 4px;
  }

  .match-chip {
    min-height: 18px;
    padding: 0 6px;
    font-size: 9px;
  }

  .topbar-actions {
    gap: 4px;
  }

  .topbar-health {
    display: none;
  }

  .more-status-button {
    min-height: var(--touch-target-min);
  }

  .mobile-status-grid {
    gap: 8px;
  }

  .mobile-status-item {
    min-height: 56px;
    padding: 9px;
    border-radius: 10px;
  }
}


/* The primary top navigation stays one row; narrow widths clip/condense instead of stacking. */
.topbar {
  box-sizing: border-box !important;
  height: calc(54px + var(--safe-top)) !important;
  min-height: calc(54px + var(--safe-top)) !important;
  max-height: calc(54px + var(--safe-top)) !important;
  overflow: hidden !important;
  padding: calc(5px + var(--safe-top)) 10px 5px !important;
}

.topbar-grid {
  height: 100% !important;
  grid-template-columns: minmax(150px, 0.9fr) minmax(210px, 1.55fr) auto !important;
  grid-template-areas: none !important;
  gap: 7px !important;
  overflow: hidden !important;
}

.topbar-brand,
.topbar-center,
.topbar-actions {
  min-width: 0 !important;
  grid-area: auto !important;
}

.topbar-brand {
  gap: 7px !important;
  overflow: hidden !important;
}

.topbar-center {
  overflow: hidden !important;
}

.match-summary {
  flex-wrap: nowrap !important;
  overflow: hidden !important;
  gap: 4px !important;
  white-space: nowrap !important;
}

.match-chip {
  min-height: 20px !important;
  padding-inline: 6px !important;
}

.topbar-actions {
  flex-wrap: nowrap !important;
  gap: 4px !important;
  overflow: hidden !important;
  white-space: nowrap !important;
}

.updated-metric {
  display: none !important;
}

@media (max-width: 1180px) {
  .topbar-grid {
    grid-template-columns: minmax(130px, 0.85fr) minmax(190px, 1.45fr) auto !important;
    grid-template-areas: none !important;
  }
}

@media (max-width: 780px) {
  .topbar {
    padding-inline: 6px !important;
  }

  .topbar-grid {
    grid-template-columns: minmax(112px, 0.8fr) minmax(170px, 1.35fr) auto !important;
    grid-template-areas: none !important;
    gap: 4px !important;
  }

  .match-summary {
    gap: 3px !important;
  }

  .match-summary > :nth-child(n + 4) {
    display: none !important;
  }
}



/* Keep dropdowns clickable and visible while the bar itself remains height-fixed. */
.topbar {
  overflow: visible !important;
  isolation: isolate;
}

.topbar-grid {
  overflow: visible !important;
}

.topbar-actions {
  position: relative;
  z-index: calc(var(--z-topbar) + 2);
  flex: 0 0 auto !important;
  overflow: visible !important;
  pointer-events: auto !important;
}

.topbar-actions > * {
  pointer-events: auto;
}



</style>
