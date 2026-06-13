<template>
  <header class="topbar" :class="{ 'match-context': showMatchContext }">
    <div class="topbar-grid">
      <div class="topbar-brand">
        <button type="button" class="menu-button" @click="toggleSidebar">
          {{ sidebarButtonLabel }}
        </button>
        <div class="topbar-copy">
          <strong>{{ pageTitle }}</strong>
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

      <div v-if="showMatchContext" class="topbar-center">
        <div class="match-summary">
          <span class="match-chip match-chip-strong">{{ matchPlayersLabel }}</span>
          <span class="match-chip match-chip-team1">{{ t("match.team1", "", { count: matchTeam1Count }) }}</span>
          <span class="match-chip match-chip-team2">{{ t("match.team2", "", { count: matchTeam2Count }) }}</span>
          <span v-if="matchQueueCount > 0" class="match-chip match-chip-team2">{{ matchQueueLabel }}</span>
          <span class="match-chip">{{ matchTimeLabel }}</span>
          <span class="match-chip">{{ matchTpsLabel }}</span>
          <span class="match-chip" :class="statusTone(matchRconStatus)">{{ matchRconLabel }}</span>
          <span class="match-chip" :class="statusTone(matchLogsStatus)">{{ matchLogsLabel }}</span>
          <span class="match-chip match-chip-muted">{{ matchUpdatedLabel }}</span>
        </div>
      </div>

      <div class="topbar-actions">
        <div class="topbar-metrics">
          <span class="metric optional" :title="t('topbar.queue', '', { count: matchQueueCount })">
            Q {{ matchQueueCount }}
          </span>
          <span
            v-if="rconQueueCount > 0"
            class="metric optional error"
            title="RCON Command Queue"
          >
            RQ {{ rconQueueCount }}
          </span>
          <StatusBadge class="runtime-badge" :tone="runtimeTone">{{ runtimeLabel }}</StatusBadge>
          <button
            type="button"
            class="metric metric-button log-clock"
            :disabled="!canEditLogClock || logClockSaving"
            :title="logClockTitle"
            @click="editLogClock"
          >
            Log {{ logClockLabel }}
          </button>
          <span class="metric refresh-speed" :class="refreshSpeedTone" :title="refreshSpeedTitle">
            {{ refreshSpeedLabel }}
          </span>
          <span v-if="runtimeError" class="metric error optional">{{ runtimeError }}</span>
        </div>
        <UserMenu
          @open-plugin-center="emit('open-plugin-center')"
          @open-rcon-modal="emit('open-rcon-modal')"
        />
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { apiPost, ApiError } from "../../app/apiClient";
import { useAuthStore } from "../../stores/auth.store";
import { useServerStore } from "../../stores/server.store";
import { usePlayerStore } from "../../stores/player.store";
import { useSquadStore } from "../../stores/squad.store";
import { useMatchStore } from "../../stores/match.store";
import { getRuntimeSyncState } from "../../app/runtimeSync";
import { useUiStore } from "../../stores/ui.store";
import { fetchWarmupState, updateWarmupState } from "../../app/warmupApi";
import StatusBadge from "../common/StatusBadge.vue";
import UserMenu from "./UserMenu.vue";
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
const route = useRoute();
const ui = useUiStore();
const warmupLoaded = ref(false);
const warmupLoading = ref(false);
const warmupSaving = ref(false);
const logClockSaving = ref(false);

const webStatus = computed(() => server.snapshot.webStatus ?? server.snapshot ?? {});
const showMatchContext = computed(() => route.path === "/match-status");
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
  if (showMatchContext.value) return matchServerName.value;
  const titleKey = route.meta.titleKey ? String(route.meta.titleKey) : "";
  const title = route.meta.title ? String(route.meta.title) : "";
  if (titleKey) return t(titleKey, title);
  return String(title || server.snapshot.serverName || webStatus.value.serverName || server.snapshot.name || webStatus.value.name || "BZSS Panel");
});
const tps = computed(() => formatTps(server.snapshot?.tps ?? server.snapshot?.webStatus?.tps ?? null));
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
const logClockHasAnchor = computed(() => Boolean(
  webStatus.value.logClockHasAnchor
    ?? server.snapshot.logClockHasAnchor
    ?? server.snapshot.webStatus?.logClockHasAnchor,
));
const logClockManual = computed(() => Boolean(
  webStatus.value.logClockManual
    ?? server.snapshot.logClockManual
    ?? server.snapshot.webStatus?.logClockManual,
));
const rconPollingSnapshot = computed(() => asRecord(
  webStatus.value.rconPolling
    ?? server.snapshot.rconPolling
    ?? server.snapshot.webStatus?.rconPolling,
));
const refreshSpeedPolicy = computed(() => resolveRefreshSpeedPolicy(
  rconPollingSnapshot.value,
  logClockSeconds.value,
  logClockHasAnchor.value,
  logClockManual.value,
));
const refreshSpeedLabel = computed(() => formatRefreshSpeedLabel(refreshSpeedPolicy.value));
const refreshSpeedTitle = computed(() => formatRefreshSpeedTitle(refreshSpeedPolicy.value, logClockSeconds.value, logClockHasAnchor.value, logClockManual.value));
const refreshSpeedTone = computed(() => refreshSpeedToneClass(refreshSpeedPolicy.value.mode));
const rconQueueCount = computed(() => {
  const value = Number(
    webStatus.value.rconQueue
      ?? server.snapshot.rconQueue
      ?? server.snapshot.webStatus?.rconQueue
      ?? 0
  );
  return Number.isFinite(value) ? Math.floor(value) : 0;
});
const canEditLogClock = computed(() => auth.user?.isSuperAdmin === true);
const logClockTitle = computed(() => {
  if (!canEditLogClock.value) return t("topbar.logClockReadonly", "Only super admins can edit the log clock.");
  if (logClockSaving.value) return t("topbar.logClockSaving", "Saving log clock...");
  return t("topbar.logClockEditable", "Click to edit the log clock.");
});
const sidebarButtonLabel = computed(() => ui.sidebarCollapsed ? t("topbar.expand") : t("topbar.collapse"));
const runtimeLabel = computed(() => {
  if (runtime.inFlight) return t("common.syncing");
  if (runtime.errorType === "unauthorized") return t("common.unauthorized");
  if (runtime.errorType === "network" || runtime.errorType === "timeout") return t("common.apiOffline");
  if (runtime.lastError || server.stale) return t("common.stale");
  return t("common.live");
});
const runtimeTone = computed(() => {
  if (runtimeLabel.value === t("common.live")) return "ok";
  if (runtimeLabel.value === t("common.unauthorized") || runtimeLabel.value === t("common.apiOffline")) return "error";
  return "warn";
});
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
const matchRconLabel = computed(() => `RCON ${formatRconStatus(matchRconStatus.value)}`);
const matchLogsStatus = computed(() => (runtime.lastError ? "stale" : "live"));
const matchLogsLabel = computed(() => `Log ${formatLogsStatus(matchLogsStatus.value)}`);
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

onMounted(() => {
  void loadWarmupState();
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

function resolveRefreshSpeedPolicy(
  polling: Record<string, any> | null,
  logClockValue: number | null,
  hasAnchor: boolean,
  manual: boolean,
) {
  const enabled = Boolean(polling?.enabled ?? true);
  const dynamicEnabled = Boolean(polling?.dynamicEnabled ?? polling?.dynamic?.enabled ?? true);
  const fastUntilSeconds = normalizePositiveInteger(polling?.fastUntilSeconds, 90);
  const mediumUntilSeconds = Math.max(
    fastUntilSeconds,
    normalizePositiveInteger(polling?.mediumUntilSeconds, 180),
  );
  const seconds = Number.isFinite(Number(logClockValue)) ? Math.max(0, Math.floor(Number(logClockValue))) : 0;
  const isAnchored = Boolean(hasAnchor) && !Boolean(manual);
  let mode = String(polling?.mode ?? "disabled");

  if (!enabled) {
    mode = "disabled";
  } else if (!dynamicEnabled || !isAnchored) {
    mode = "fallback";
  } else if (seconds < fastUntilSeconds) {
    mode = "fast";
  } else if (seconds < mediumUntilSeconds) {
    mode = "medium";
  } else {
    mode = "fallback";
  }

  const playersIntervalMs = resolveIntervalMs(
    mode === "fast"
      ? polling?.fastPlayersIntervalMs
      : mode === "medium"
        ? polling?.mediumPlayersIntervalMs
        : polling?.playersIntervalMs,
    polling?.playersIntervalMs,
  );
  const squadsIntervalMs = resolveIntervalMs(
    mode === "fast"
      ? polling?.fastSquadsIntervalMs
      : mode === "medium"
        ? polling?.mediumSquadsIntervalMs
        : polling?.squadsIntervalMs,
    polling?.squadsIntervalMs,
  );

  return {
    mode,
    enabled,
    dynamicEnabled,
    fastUntilSeconds,
    mediumUntilSeconds,
    logClockSeconds: seconds,
    playersIntervalMs: playersIntervalMs > 0 ? playersIntervalMs : Number(polling?.playersIntervalMs ?? 0) || 0,
    squadsIntervalMs: squadsIntervalMs > 0 ? squadsIntervalMs : Number(polling?.squadsIntervalMs ?? 0) || 0,
  };
}

function formatRefreshSpeedLabel(policy: Record<string, any>) {
  if (policy.mode === "disabled") return t("topbar.refreshDisabled");
  const modeLabel = resolveRefreshModeLabel(policy.mode);
  return t("topbar.refreshSpeed", "", {
    mode: modeLabel,
    players: formatIntervalMs(policy.playersIntervalMs),
    squads: formatIntervalMs(policy.squadsIntervalMs),
  });
}

function formatRefreshSpeedTitle(
  policy: Record<string, any>,
  logClockValue: number | null,
  hasAnchor: boolean,
  manual: boolean,
) {
  if (policy.mode === "disabled") {
    return t("topbar.refreshDisabledTitle", "Dynamic players/squads refresh is disabled.");
  }

  const clockLabel = logClockValue == null ? "--:--" : formatDuration(logClockValue);
  const anchorLabel = manual
    ? t("topbar.refreshManual", "manual")
    : hasAnchor
      ? t("topbar.refreshAnchored", "anchored")
      : t("topbar.refreshUnanchored", "unanchored");

  return t("topbar.refreshSpeedTitle", "", {
    clock: clockLabel,
    state: anchorLabel,
    players: formatIntervalMs(policy.playersIntervalMs),
    squads: formatIntervalMs(policy.squadsIntervalMs),
  });
}

function resolveRefreshModeLabel(mode: string) {
  if (mode === "fast") return t("topbar.refreshFast");
  if (mode === "medium") return t("topbar.refreshMedium");
  if (mode === "fallback") return t("topbar.refreshFallback");
  return t("topbar.refreshUnknown");
}

function formatIntervalMs(value: number) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return "--";
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
}

function refreshSpeedToneClass(mode: string) {
  if (mode === "fast") return "refresh-fast";
  if (mode === "medium") return "refresh-medium";
  if (mode === "disabled") return "refresh-disabled";
  return "refresh-fallback";
}

function asRecord(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, any>;
}

function normalizePositiveInteger(value: unknown, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return Math.max(1, Math.floor(Number(fallback) || 1));
  }
  return Math.max(1, Math.floor(number));
}

function resolveIntervalMs(value: unknown, fallback: unknown) {
  const primary = Number(value);
  if (Number.isFinite(primary) && primary > 0) return Math.floor(primary);
  const secondary = Number(fallback);
  if (Number.isFinite(secondary) && secondary > 0) return Math.floor(secondary);
  return 0;
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
  if (window.matchMedia("(max-width: 780px)").matches) {
    ui.toggleMobileSidebar();
    return;
  }
  ui.toggleSidebarCollapsed();
}
</script>

<style scoped>
.topbar {
  position: relative;
  z-index: var(--z-user-dropdown);
  overflow: visible;
  padding: 12px 18px 14px;
  border-bottom: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.016)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-panel);
  backdrop-filter: blur(12px);
  box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.02);
}

.topbar-grid {
  display: grid;
  grid-template-columns: minmax(300px, 1.05fr) minmax(0, 1.5fr) auto;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.topbar-brand {
  display: flex;
  align-items: center;
  gap: 14px;
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
  font-size: 17px;
  line-height: 1.18;
  letter-spacing: -0.02em;
}

.topbar-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
  min-width: 0;
  flex-wrap: wrap;
}

.topbar-subtitle {
  color: var(--color-text-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.warmup-chip {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(122, 162, 184, 0.26);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.02)), rgba(255, 255, 255, 0.004)),
    rgba(122, 162, 184, 0.14);
  color: #d7f3ff;
  font-size: 12px;
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
  min-width: 82px;
  box-shadow: var(--shadow-sm);
}

.topbar-center {
  min-width: 0;
  display: flex;
  justify-content: center;
}

.match-summary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.match-chip {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(122, 162, 184, 0.22);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.018)), rgba(255, 255, 255, 0.004)),
    rgba(122, 162, 184, 0.09);
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  box-shadow: var(--shadow-sm);
}

.match-chip-strong {
  color: var(--color-text-primary);
  border-color: rgba(122, 162, 184, 0.32);
}

.match-chip-team1 {
  color: var(--color-team1-primary);
  border-color: rgba(55, 200, 255, 0.25);
  background: rgba(55, 200, 255, 0.07);
}

.match-chip-team2 {
  color: var(--color-team2-primary);
  border-color: rgba(255, 155, 69, 0.25);
  background: rgba(255, 155, 69, 0.07);
}

.match-chip-muted {
  color: var(--color-text-muted);
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: flex-end;
  min-width: 0;
}

.topbar-metrics {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  min-width: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.metric {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(122, 162, 184, 0.22);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.018)), rgba(255, 255, 255, 0.004)),
    rgba(122, 162, 184, 0.09);
  color: var(--color-text-secondary);
  font-size: 12px;
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

.metric.primary {
  color: var(--color-text-primary);
  border-color: rgba(122, 162, 184, 0.3);
}

.metric.log-clock {
  color: #d7f3ff;
  border-color: rgba(122, 162, 184, 0.32);
  cursor: pointer;
}

.metric.refresh-speed {
  color: #d7f3ff;
  border-color: rgba(122, 162, 184, 0.26);
}

.metric.refresh-speed.refresh-fast {
  color: #bbf7d0;
  border-color: rgba(52, 211, 153, 0.36);
  background: rgba(52, 211, 153, 0.12);
}

.metric.refresh-speed.refresh-medium {
  color: #fde68a;
  border-color: rgba(245, 158, 11, 0.36);
  background: rgba(245, 158, 11, 0.1);
}

.metric.refresh-speed.refresh-fallback {
  color: #d7f3ff;
}

.metric.refresh-speed.refresh-disabled {
  color: #cbd5e1;
  border-color: rgba(148, 163, 184, 0.28);
  background: rgba(148, 163, 184, 0.08);
}

.runtime-badge {
  min-width: 76px;
}

.metric.error {
  color: #ffb1b1;
}

.metric.optional {
  display: inline-flex;
}

@media (max-width: 1180px) {
  .topbar-grid {
    grid-template-columns: minmax(250px, 1fr) minmax(0, 1.1fr);
    grid-template-areas:
      "brand actions"
      "center center";
  }

  .topbar-brand {
    grid-area: brand;
  }

  .topbar-center {
    grid-area: center;
    justify-content: flex-start;
  }

  .topbar-actions {
    grid-area: actions;
  }
}

@media (max-width: 780px) {
  .topbar {
    padding: 10px 14px 12px;
  }

  .topbar-grid {
    grid-template-columns: 1fr;
    grid-template-areas:
      "brand"
      "actions"
      "center";
    gap: 10px;
  }

  .topbar-brand {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .topbar-actions {
    justify-content: space-between;
  }

  .topbar-metrics {
    gap: 8px;
    overflow: hidden;
  }

  .topbar-center {
    justify-content: flex-start;
  }
}

@media (max-width: 1100px) {
  .metric.optional {
    display: none;
  }
}
</style>
