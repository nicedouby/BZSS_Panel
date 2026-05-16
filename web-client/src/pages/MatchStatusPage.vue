<template>
  <div class="squad-admin-layout">
    <SquadPageToolbar
      :search-query="pageState.searchQuery"
      :filter-mode="pageState.filterMode"
      :density-mode="pageState.densityMode"
      :can-refresh="canRefresh"
      :refreshing-type="refreshingType"
      :refreshing-playtime="refreshingPlaytime"
      :viewer-perspective-text="viewerPerspectiveText"
      :show-viewer-perspective="ui.showTeamPerspectiveHint"
      :server-status-updated-at="serverStatusUpdatedAt"
      :players-updated-at="playersUpdatedAt"
      :squads-updated-at="squadsUpdatedAt"
      @search="pageState.searchQuery = $event"
      @filter-change="pageState.filterMode = $event"
      @density-change="handleDensityChange"
      @refresh="handleToolbarRefresh"
      @refresh-playtime="refreshOnlinePlaytime"
      @refresh-playtime-force="refreshOnlinePlaytime(true)"
    />

    <section v-if="showPlaytimePanel" class="playtime-refresh-card">
      <div class="playtime-refresh-header">
        <div>
          <div class="playtime-refresh-title">Steam 时长刷新</div>
          <div class="playtime-refresh-subtitle">智能刷新会跳过 30 分钟内已成功刷新的玩家；强制刷新会处理全部在线玩家。</div>
        </div>
        <div class="playtime-refresh-meta">
          <span class="playtime-refresh-status" :data-tone="playtimeStatusTone">{{ playtimeStatusText }}</span>
          <span class="playtime-refresh-counter">{{ playtimeSummaryText }}</span>
        </div>
      </div>

      <div class="playtime-refresh-progress">
        <div class="playtime-refresh-progress-track">
          <div class="playtime-refresh-progress-fill" :style="{ width: `${playtimeProgressPercent}%` }"></div>
        </div>
        <div class="playtime-refresh-progress-meta">
          <span>{{ playtimeProgressLabel }}</span>
          <span>{{ playtimeProgressPercent }}%</span>
          <span>{{ playtimeSelectedCount }} / {{ playtimeTotalCount }}</span>
        </div>
      </div>

      <div class="playtime-refresh-events">
        <div v-if="playtimeEvents.length === 0" class="playtime-refresh-empty">最近没有刷新事件</div>
        <article
          v-for="event in playtimeEvents"
          :key="`${event.at}-${event.phase}-${event.steamID || event.playerName || event.message}`"
          class="playtime-refresh-event"
          :data-tone="eventTone(event)"
        >
          <div class="playtime-refresh-event-head">
            <span class="playtime-refresh-event-phase">{{ event.phase }}</span>
            <span class="playtime-refresh-event-time">{{ formatEventTime(event.at) }}</span>
          </div>
          <strong class="playtime-refresh-event-message">{{ event.message }}</strong>
          <div class="playtime-refresh-event-meta">
            <span v-if="event.playerName">{{ event.playerName }}</span>
            <span v-if="event.steamID">{{ event.steamID }}</span>
            <span v-if="event.reason">{{ event.reason }}</span>
          </div>
        </article>
      </div>
    </section>

    <DataState
      :loading="showInitialLoading"
      :error="blockingRuntimeError"
      :stale="showStaleBanner"
      :stale-text="staleText"
    >
      <div class="match-state-content">
        <div v-if="refreshError || playtimeError" class="match-error-stack">
          <ErrorBlock v-if="refreshError" :message="refreshError" />
          <ErrorBlock v-if="playtimeError" :message="playtimeError" />
        </div>

        <div class="squad-main-content" :class="pageState.densityMode">
          <TeamColumn
            v-for="team in viewModels.teams"
            :key="team.teamId"
            :team="team"
            :density-mode="pageState.densityMode"
            :selected-player-id="pageState.selectedPlayerId"
            @select-player="selectPlayer"
          />
        </div>
      </div>
    </DataState>

    <PlayerDetailDrawer
      :open="selectedPlayerDetail !== null"
      :player="selectedPlayerDetail"
      :can-use-tb="canUseTb"
      :tb-busy="tbBusy"
      @close="closePlayerDetail"
      @switch-team="handleSwitchTeam"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive, watch } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { apiGet, apiPost } from "../app/apiClient";
import { renderApiError } from "../app/errors";
import { executeTeamBalance, getTeamBalanceStatus, type TeamBalanceTbObject } from "../app/teamBalanceApi";
import { getRuntimeSyncState } from "../app/runtimeSync";
import { applyMatchSnapshotResponse } from "../app/matchSnapshot";
import { useAuthStore } from "../stores/auth.store";
import { usePlayerStore } from "../stores/player.store";
import { useSquadStore } from "../stores/squad.store";
import { useServerStore } from "../stores/server.store";
import { useMatchStore } from "../stores/match.store";
import { useJobStore } from "../stores/job.store";
import { useUiStore } from "../stores/ui.store";
import {
  adaptTeam,
  buildSquadLifecycleLookup,
  filterTeamsBySearch,
} from "../utils/squad-admin-adapter";
import DataState from "../components/common/DataState.vue";
import ErrorBlock from "../components/common/ErrorBlock.vue";
import SquadPageToolbar from "../components/squad-admin/SquadPageToolbar.vue";
import TeamColumn from "../components/squad-admin/TeamColumn.vue";
import PlayerDetailDrawer from "../components/squad-admin/PlayerDetailDrawer.vue";
import { t } from "../i18n";
import type {
  PageState,
  PlayerDetailViewModel,
  PlayerRowViewModel,
  TeamViewModel,
} from "../types/squad-admin.types";

interface PlaytimeJobProgressEvent {
  at?: number | string | null;
  phase?: string | null;
  status?: string | null;
  steamID?: string | null;
  playerName?: string | null;
  playerId?: string | number | null;
  message?: string | null;
  gameSeconds?: number | null;
  reason?: string | null;
  fetchedAt?: number | null;
  ageMinutes?: number | null;
}

interface PlaytimeJobProgress {
  phase?: string | null;
  message?: string | null;
  total?: number | null;
  selected?: number | null;
  skipped?: number | null;
  queued?: number | null;
  running?: number | null;
  updated?: number | null;
  failed?: number | null;
  percent?: number | null;
  events?: PlaytimeJobProgressEvent[];
}

interface PlaytimeJobViewModel {
  id?: string;
  status?: string;
  error?: { message?: string | null } | null;
  result?: { updated?: number; skipped?: number; failed?: number } | null;
  progress?: PlaytimeJobProgress;
}

const auth = useAuthStore();
const server = useServerStore();
const players = usePlayerStore();
const squads = useSquadStore();
const match = useMatchStore();
const jobs = useJobStore();
const ui = useUiStore();
const runtime = getRuntimeSyncState();
const queryClient = useQueryClient();

const refreshingPlaytime = ref(false);
const refreshingPlayers = ref(false);
const refreshingSquads = ref(false);
const refreshingAll = ref(false);
const refreshError = ref("");
const playtimeError = ref("");
const playtimeRequested = ref(true);
const playtimeJob = ref<PlaytimeJobViewModel | null>(null);
const selectedPlayerDetail = ref<PlayerDetailViewModel | null>(null);
const tbBusy = ref(false);
const canUseTb = ref(false);

const pageState = reactive<PageState>({
  searchQuery: "",
  densityMode: ui.globalDensity,
  selectedPlayerId: null,
  filterMode: "all",
});

const canRefresh = computed(() => Boolean(auth.user?.isSuperAdmin));
const refreshingType = computed(() => {
  if (refreshingPlayers.value) return "players";
  if (refreshingSquads.value) return "squads";
  if (refreshingAll.value) return "all";
  return "";
});

const snapshotUpdatedAt = computed(() => Math.max(server.updatedAt, players.updatedAt, squads.updatedAt));
const hasSnapshotData = computed(() => snapshotUpdatedAt.value > 0);
const runtimeWebStatus = computed(() => server.snapshot?.webStatus ?? server.snapshot ?? {});
const rconStatus = computed(() => String(runtimeWebStatus.value.rcon ?? "unknown"));
const matchSnapshotQuery = useQuery({
  queryKey: computed(() => ["match-snapshot", auth.authenticated]),
  enabled: computed(() => auth.authenticated),
  queryFn: async () => apiGet<any>("/api/match/snapshot"),
  refetchOnWindowFocus: false,
});
const squadLifecycleQuery = useQuery({
  queryKey: computed(() => ["squad-lifecycle-current", auth.authenticated]),
  enabled: computed(() => auth.authenticated),
  queryFn: async () => apiGet<any>("/api/squad-lifecycle/current"),
  refetchInterval: 3000,
  refetchOnWindowFocus: false,
});
const matchSnapshot = computed(() => matchSnapshotQuery.data.value?.matchState ?? null);
const squadLifecycleCurrent = computed(() => squadLifecycleQuery.data.value?.current ?? null);
const serverStatusUpdatedAt = computed(() => toMillis(matchSnapshot.value?.serverStatus?.lastUpdatedAt));
const playersUpdatedAt = computed(() => toMillis(matchSnapshot.value?.players?.lastUpdatedAt));
const squadsUpdatedAt = computed(() => toMillis(matchSnapshot.value?.squads?.lastUpdatedAt));
const showInitialLoading = computed(() => auth.authenticated && !hasSnapshotData.value && runtime.inFlight && !runtime.lastError);
const blockingRuntimeError = computed(() => {
  if (!auth.authenticated || hasSnapshotData.value || !runtime.lastError) return "";
  return renderApiErrorText(runtime.lastError);
});
const showStaleBanner = computed(() => hasSnapshotData.value && (Boolean(runtime.lastError) || server.stale || players.stale || squads.stale));
const staleText = computed(() => {
  if (runtime.lastError) return `${t("dataState.staleText")} ${runtime.lastError}`;
  if (refreshError.value) return `${t("dataState.staleText")} ${refreshError.value}`;
  return t("dataState.staleText");
});

const steamIDs = computed(() => {
  return [...new Set(players.active.map((player) => player.steamID).filter(Boolean))]
    .map((id) => String(id).trim())
    .filter(Boolean)
    .sort();
});
const steamIDParam = computed(() => steamIDs.value.join(","));
const stablePlaytimes = ref<Record<string, any>>({});
const squadLifecycleLookup = computed(() => buildSquadLifecycleLookup(squadLifecycleCurrent.value));

const playtimeQuery = useQuery({
  queryKey: computed(() => ["playtime-cache", steamIDParam.value, playtimeRequested.value]),
  enabled: computed(() => auth.authenticated && playtimeRequested.value && steamIDs.value.length > 0),
  queryFn: async () => apiGet<{ items: Record<string, any> }>(`/api/query/playtime-cache?steamIDs=${encodeURIComponent(steamIDParam.value)}`),
  placeholderData: (previousData) => previousData,
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  refetchOnWindowFocus: false,
});

const playtimes = computed(() => stablePlaytimes.value);

const viewerSteam64 = computed(() => normalizeSteam64(auth.user?.steam64));
const viewerAutoSwapEnabled = computed(() => auth.user?.viewerTeamAutoSwapEnabled !== false);

const rawTeams = computed(() => {
  return match.teams.map((team) => {
    const adapted = adaptTeam(team, playtimes.value, squadLifecycleLookup.value);

    return {
      ...adapted,
      squads: adapted.squads,
    };
  });
});

const viewModels = computed(() => {
  const searchedTeams = filterTeamsBySearch(rawTeams.value, pageState.searchQuery);
  const filteredTeams = filterTeamsByMode(searchedTeams, pageState.filterMode);
  const viewerTeamId = viewerAutoSwapEnabled.value ? findAdminTeamId(rawTeams.value, viewerSteam64.value) : null;
  return {
    teams: sortTeamsForAdminPerspective(filteredTeams, viewerTeamId),
    viewerTeamId,
    viewerSteam64: viewerSteam64.value,
    viewerPerspectiveText: buildViewerPerspectiveTextEnglish(viewerTeamId, viewerAutoSwapEnabled.value),
  };
});

const viewerPerspectiveText = computed(() => viewModels.value.viewerPerspectiveText);

const playtimeProgress = computed(() => playtimeJob.value?.progress ?? null);
const playtimeSelectedCount = computed(() => Number(playtimeProgress.value?.selected ?? 0));
const playtimeTotalCount = computed(() => Number(playtimeProgress.value?.total ?? 0));
const playtimeProgressPercent = computed(() => clampPercent(playtimeProgress.value?.percent ?? 0));
const playtimeProgressLabel = computed(() => playtimeProgress.value?.message || (refreshingPlaytime.value ? "正在处理" : "等待开始"));
const playtimeSummaryText = computed(() => `updated ${Number(playtimeJob.value?.result?.updated ?? playtimeProgress.value?.updated ?? 0)} / skipped ${Number(playtimeJob.value?.result?.skipped ?? playtimeProgress.value?.skipped ?? 0)} / failed ${Number(playtimeJob.value?.result?.failed ?? playtimeProgress.value?.failed ?? 0)}`);
const playtimeStatusTone = computed(() => {
  if (refreshingPlaytime.value) return "pending";
  if (playtimeJob.value?.status === "failed") return "error";
  if (playtimeJob.value?.status === "completed") return "success";
  return "idle";
});
const playtimeStatusText = computed(() => {
  if (refreshingPlaytime.value) return "正在刷新 Steam 时长";
  if (playtimeJob.value?.status === "failed") return playtimeJob.value.error?.message || "Steam 时长刷新失败";
  if (playtimeJob.value?.status === "completed") return "Steam 时长刷新完成";
  return "Steam 时长待刷新";
});
const playtimeEvents = computed(() => {
  const events = playtimeProgress.value?.events ?? [];
  return [...events].slice(-10).reverse();
});
const showPlaytimePanel = computed(() => Boolean(refreshingPlaytime.value || playtimeJob.value || playtimeError.value));

watch(
  () => playtimeQuery.data.value?.items,
  (items) => {
    if (!items || typeof items !== "object") return;

    stablePlaytimes.value = {
      ...stablePlaytimes.value,
      ...items,
    };
    playtimeError.value = "";
  },
  { immediate: true },
);

watch(
  () => playtimeQuery.error.value,
  (error) => {
    if (!error) return;
    playtimeError.value = renderApiError(error, t("common.error"));
  },
);

watch(
  () => matchSnapshotQuery.data.value,
  (data) => {
    if (!data?.matchState) return;
    applyMatchSnapshotResponse(data);
  },
  { immediate: true },
);

watch(
  () => ui.globalDensity,
  (next) => {
    pageState.densityMode = next;
  },
  { immediate: true },
);

watch(
  () => auth.authenticated,
  (authenticated) => {
    if (authenticated) {
      void loadTeamBalanceStatus();
    } else {
      canUseTb.value = false;
    }
  },
  { immediate: true },
);

function selectPlayer(player: PlayerRowViewModel) {
  pageState.selectedPlayerId = player.playerId;

  selectedPlayerDetail.value = {
    playerId: player.playerId,
    name: player.name,
    role: player.role,
    isLeader: player.isLeader,
    isOnline: player.isOnline,
    teamId: player.teamId,
    squadId: player.squadId,
    steamId: player.steamId,
    eosId: player.eosId,
    ip: player.ip,
    playtimeHours: player.playtimeHours,
    source: "row",
    controller: "",
    raw: player,
  };

  if (player.steamId) {
    playtimeRequested.value = true;
  }
}

function handleDensityChange(mode: "comfortable" | "compact") {
  pageState.densityMode = mode;
  ui.setGlobalDensity(mode);
}

function closePlayerDetail() {
  pageState.selectedPlayerId = null;
  selectedPlayerDetail.value = null;
}

async function loadTeamBalanceStatus() {
  try {
    const status = await getTeamBalanceStatus();
    canUseTb.value = Boolean(status.viewer?.canUseTb);
  } catch {
    canUseTb.value = false;
  }
}

async function handleSwitchTeam(player: PlayerDetailViewModel) {
  if (!player) return;

  tbBusy.value = true;
  refreshError.value = "";

  const tb: TeamBalanceTbObject = {
    type: "switch-team",
    source: "player-detail-drawer",
    reason: "manual switch from player drawer",
    target: {
      playerId: player.playerId,
      name: player.name,
      steamId: player.steamId,
      eosId: player.eosId,
      teamId: player.teamId,
      squadId: player.squadId,
    },
  };

  try {
    const result = await executeTeamBalance(tb);

    if (!result.ok) {
      throw new Error(result.message || result.error || "TB 执行失败");
    }

    ui.pushToast({
      title: "TB 执行成功",
      message: `已请求将 ${player.name} 跳边`,
      tone: "ok",
    });

    window.setTimeout(() => {
      void refreshMatchState("all");
    }, 1200);
  } catch (error) {
    const message = renderApiError(error, "TB 执行失败");

    ui.pushToast({
      title: "TB 执行失败",
      message,
      tone: "error",
    });
  } finally {
    tbBusy.value = false;
  }
}

async function refreshOnlinePlaytime(force = false) {
  if (force && !window.confirm("确定强制刷新全部在线玩家时长？")) return;

  refreshingPlaytime.value = true;
  playtimeError.value = "";
  playtimeRequested.value = true;
  playtimeJob.value = {
    status: "running",
    progress: {
      phase: "queued",
      message: force ? "正在强制刷新全部在线玩家时长..." : "正在智能刷新在线玩家时长...",
      total: 0,
      selected: 0,
      skipped: 0,
      queued: 0,
      running: 0,
      updated: 0,
      failed: 0,
      percent: 0,
      events: [],
    },
  };

  try {
    const job = await apiPost<PlaytimeJobViewModel>("/api/playtime/online/refresh", {
      waitMs: 0,
      force,
    });
    applyPlaytimeJob(job);

    const finalJob = job.status === "completed" || job.status === "failed"
      ? job
      : await waitForPlaytimeJob(job.id ?? "", 45_000, (nextJob) => {
        applyPlaytimeJob(nextJob);
      });

    applyPlaytimeJob(finalJob);

    if (finalJob.status !== "completed") {
      throw new Error(finalJob.error?.message ?? t("common.error"));
    }

    const refreshed = await playtimeQuery.refetch();
    if (refreshed.data?.items) {
      stablePlaytimes.value = {
        ...stablePlaytimes.value,
        ...refreshed.data.items,
      };
    }
    ui.pushToast({
      title: t("common.updated"),
      message: `成功 ${Number(finalJob.result?.updated ?? 0)}，跳过 ${Number(finalJob.result?.skipped ?? 0)}，失败 ${Number(finalJob.result?.failed ?? 0)}`,
      tone: "ok",
    });
  } catch (error) {
    playtimeError.value = renderApiError(error, t("common.error"));
    playtimeJob.value = {
      status: "failed",
      error: { message: playtimeError.value },
      progress: {
        phase: "failed",
        message: playtimeError.value,
        total: 0,
        selected: 0,
        skipped: 0,
        queued: 0,
        running: 0,
        updated: 0,
        failed: 0,
        percent: 0,
        events: [],
      },
    };
    ui.pushToast({
      title: t("common.error"),
      message: playtimeError.value,
      tone: "error",
    });
  } finally {
    refreshingPlaytime.value = false;
  }
}

async function refreshPlayers() {
  await refreshMatchState("players");
}

async function refreshSquads() {
  await refreshMatchState("squads");
}

async function refreshAll() {
  await refreshMatchState("all");
}

function handleToolbarRefresh(type: "players" | "squads" | "all") {
  if (type === "players") {
    void refreshPlayers();
    return;
  }
  if (type === "squads") {
    void refreshSquads();
    return;
  }
  void refreshAll();
}

async function refreshMatchState(type: "players" | "squads" | "all") {
  const loadingState = type === "players"
    ? refreshingPlayers
    : type === "squads"
      ? refreshingSquads
      : refreshingAll;

  loadingState.value = true;
  refreshError.value = "";

  try {
    const endpoint = type === "players"
      ? "/api/match/refresh/players"
      : type === "squads"
        ? "/api/match/refresh/squads"
        : "/api/match/refresh/all";
    const result = await apiPost<any>(endpoint, {});
    applyMatchRefreshResult(result);
    if (!result?.ok) {
      refreshError.value = result?.errors?.[0]?.message ?? t("common.error");
      server.markStale();
      players.markStale();
      squads.markStale();
      ui.pushToast({
        title: t("common.error"),
        message: refreshError.value,
        tone: "error",
      });
      return;
    }
    ui.pushToast({
      title: t("common.updated"),
      message: type === "all" ? t("match.refreshAll") : type === "players" ? t("match.refreshPlayers") : t("match.refreshSquads"),
      tone: "ok",
    });
  } catch (error) {
    refreshError.value = renderApiError(error, t("common.error"));
    ui.pushToast({
      title: t("common.error"),
      message: refreshError.value,
      tone: "error",
    });
  } finally {
    loadingState.value = false;
  }
}

function applyMatchRefreshResult(result: any) {
  if (!result) return;

  if (!result.ok) return;

  queryClient.setQueryData(["match-snapshot", auth.authenticated], result);
  applyMatchSnapshotResponse(result);
}

async function waitForPlaytimeJob(
  jobId: string,
  timeoutMs: number,
  onUpdate?: (job: PlaytimeJobViewModel) => void,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const job = await apiGet<PlaytimeJobViewModel>(`/api/playtime/jobs/${encodeURIComponent(jobId)}?waitMs=3000`);
    jobs.upsert(job);
    applyPlaytimeJob(job);
    onUpdate?.(job);
    if (job.status === "completed" || job.status === "failed") return job;
  }
  throw new Error("Timed out while waiting for the playtime refresh job.");
}

function applyPlaytimeJob(job: PlaytimeJobViewModel | null | undefined) {
  if (!job) return;
  playtimeJob.value = normalizePlaytimeJob(job);
  const progress = playtimeJob.value.progress;
  if (progress?.message && !refreshingPlaytime.value) {
    playtimeError.value = "";
  }
}

function normalizePlaytimeJob(job: PlaytimeJobViewModel): PlaytimeJobViewModel {
  const progress = job.progress ?? {};
  return {
    ...job,
    progress: {
      phase: progress.phase ?? "queued",
      message: progress.message ?? "",
      total: Number(progress.total ?? 0),
      selected: Number(progress.selected ?? 0),
      skipped: Number(progress.skipped ?? 0),
      queued: Number(progress.queued ?? 0),
      running: Number(progress.running ?? 0),
      updated: Number(progress.updated ?? 0),
      failed: Number(progress.failed ?? 0),
      percent: clampPercent(progress.percent ?? 0),
      events: Array.isArray(progress.events) ? progress.events.map(normalizePlaytimeEvent) : [],
    },
    result: job.result ?? null,
    error: job.error ?? null,
  };
}

function normalizePlaytimeEvent(event: PlaytimeJobProgressEvent): PlaytimeJobProgressEvent {
  return {
    at: typeof event.at === "string" ? Date.parse(event.at) || Date.now() : Number(event.at ?? Date.now()),
    phase: String(event.phase ?? "lookup"),
    status: String(event.status ?? "success"),
    steamID: event.steamID ?? null,
    playerName: event.playerName ?? null,
    playerId: event.playerId ?? null,
    message: String(event.message ?? ""),
    gameSeconds: event.gameSeconds ?? null,
    reason: event.reason ?? null,
    fetchedAt: event.fetchedAt ?? null,
    ageMinutes: event.ageMinutes ?? null,
  };
}

function eventTone(event: PlaytimeJobProgressEvent): "success" | "skipped" | "failed" {
  if (event.status === "skipped") return "skipped";
  if (event.status === "failed") return "failed";
  return "success";
}

function formatEventTime(value: number | string | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : new Date(Number(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function clampPercent(value: number | string | null | undefined): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.floor(numeric)));
}

function renderApiErrorText(runtimeError: string) {
  if (runtime.errorType === "network" || runtime.errorType === "timeout") {
    return `${t("common.apiOffline")}: ${runtimeError}`;
  }
  if (runtime.errorType === "unauthorized") {
    return t("common.unauthorized");
  }
  return `${t("common.error")}: ${runtimeError}`;
}

function toMillis(value: string | number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value) return 0;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSteam64(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^\d{17}$/.test(text) ? text : "";
}

function findAdminTeamId(teams: TeamViewModel[], steam64: string): number | null {
  if (!steam64) return null;

  for (const team of teams) {
    for (const squad of team.squads) {
      const players = [
        ...(squad.leader ? [squad.leader] : []),
        ...squad.members,
      ];

      for (const player of players) {
        if (normalizeSteam64(player.steam64 ?? player.steamId) === steam64) {
          return team.teamId;
        }
      }
    }
  }

  return null;
}

function sortTeamsForAdminPerspective(teams: TeamViewModel[], adminTeamId: number | null): TeamViewModel[] {
  const copy = [...teams];

  if (adminTeamId !== 1 && adminTeamId !== 2) {
    return copy.sort((a, b) => Number(a.teamId) - Number(b.teamId));
  }

  return copy.sort((a, b) => {
    if (a.teamId === adminTeamId) return -1;
    if (b.teamId === adminTeamId) return 1;
    return Number(a.teamId) - Number(b.teamId);
  });
}

function buildViewerPerspectiveTextEnglish(adminTeamId: number | null, enabled: boolean): string {
  if (!enabled || (adminTeamId !== 1 && adminTeamId !== 2)) {
    return "Current view: default TEAM 1 -> TEAM 2";
  }
  return `Current view: TEAM ${adminTeamId}`;
}

function filterTeamsByMode(teams: TeamViewModel[], mode: "all" | "no_leader" | "locked" | "alerts"): TeamViewModel[] {
  if (mode === "all") return teams;

  return teams
    .map((team) => ({
      ...team,
      squads: team.squads.filter((squad) => {
        if (mode === "no_leader") return squad.state === "no_leader";
        if (mode === "locked") return squad.isLocked;
        if (mode === "alerts") return squad.warnings.length > 0 || squad.state === "no_leader";
        return true;
      }),
    }))
    .filter((team) => team.squads.length > 0);
}

</script>

<style scoped>
@import "../styles/squad-admin.css";

.squad-admin-layout {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  gap: 0;
  overflow: hidden;
  background: var(--app-background, var(--color-bg-page));
}

.match-state-content {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.match-error-stack {
  display: grid;
  gap: 8px;
  padding: 8px var(--spacing-lg) 0;
}

.playtime-refresh-card {
  display: grid;
  gap: 14px;
  margin: 10px var(--spacing-lg) 0;
  padding: 14px 16px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-xl);
  background:
    radial-gradient(circle at 0% 0%, rgba(96, 165, 250, 0.08), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.015)),
    var(--color-bg-card);
  box-shadow: var(--shadow-md);
  min-width: 0;
}

.playtime-refresh-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.playtime-refresh-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.playtime-refresh-subtitle {
  margin-top: 4px;
  color: var(--color-text-muted);
  font-size: 13px;
}

.playtime-refresh-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.playtime-refresh-status {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.playtime-refresh-status[data-tone="pending"] {
  color: var(--color-status-warning);
  border-color: rgba(245, 158, 11, 0.28);
}

.playtime-refresh-status[data-tone="success"] {
  color: var(--color-status-online);
  border-color: rgba(34, 197, 94, 0.28);
}

.playtime-refresh-status[data-tone="error"] {
  color: var(--color-status-error);
  border-color: rgba(239, 68, 68, 0.28);
}

.playtime-refresh-counter {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.playtime-refresh-progress {
  display: grid;
  gap: 8px;
}

.playtime-refresh-progress-track {
  height: 10px;
  border-radius: var(--radius-full);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border-soft);
}

.playtime-refresh-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(55, 200, 255, 0.92), rgba(96, 165, 250, 0.94), rgba(168, 85, 247, 0.88));
  transition: width 180ms ease;
}

.playtime-refresh-progress-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: space-between;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.playtime-refresh-events {
  display: grid;
  gap: 8px;
}

.playtime-refresh-empty {
  padding: 8px 2px;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.playtime-refresh-event {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.03);
}

.playtime-refresh-event[data-tone="success"] {
  border-color: rgba(34, 197, 94, 0.22);
}

.playtime-refresh-event[data-tone="skipped"] {
  border-color: rgba(245, 158, 11, 0.24);
}

.playtime-refresh-event[data-tone="failed"] {
  border-color: rgba(239, 68, 68, 0.24);
}

.playtime-refresh-event-head {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
}

.playtime-refresh-event-phase {
  color: var(--color-text-secondary);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.playtime-refresh-event-time {
  color: var(--color-text-muted);
  font-size: 11px;
}

.playtime-refresh-event-message {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  line-height: 1.45;
}

.playtime-refresh-event-meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  color: var(--color-text-muted);
  font-size: 11px;
}

.squad-main-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: clamp(12px, 1vw, 18px);
  padding: clamp(12px, 1vw, 18px);
  min-height: 0;
  height: 100%;
  overflow: hidden;
  align-items: stretch;
  background: linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.004)), transparent 22%), var(--app-background, var(--color-bg-page));
}

@media (max-width: 1180px) {
  .squad-main-content {
    grid-template-columns: 1fr;
  }
}
</style>
