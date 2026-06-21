<template>
  <div class="squad-admin-layout">
    <aside class="bzss-sample-window" aria-label="BZSS-Core 样本采样率调试窗口">
      <span class="bzss-sample-window__title">BZSS-Core 样本</span>
      <strong class="bzss-sample-window__rate">{{ bzssCoreSampleRateLabel }}</strong>
      <div class="bzss-sample-window__meta">
        <span>{{ bzssCoreStreamLabel }}</span>
        <span>{{ bzssCoreSampleCountLabel }}</span>
        <span>{{ bzssCoreLastSampleLabel }}</span>
      </div>
    </aside>

    <SquadPageToolbar
      :search-query="pageState.searchQuery"
      :filter-mode="pageState.filterMode"
      :can-refresh="canRefresh"
      :refreshing-type="refreshingType"
      :refreshing-playtime="refreshingPlaytime"
      :viewer-perspective-text="viewerPerspectiveText"
      :show-viewer-perspective="ui.showTeamPerspectiveHint"
      :server-status-updated-at="serverStatusUpdatedAt"
      :players-updated-at="playersUpdatedAt"
      :squads-updated-at="squadsUpdatedAt"
      :multi-select-mode="multiSelectMode"
      :view-mode="viewMode"
      @search="pageState.searchQuery = $event"
      @filter-change="pageState.filterMode = $event"
      @refresh="handleToolbarRefresh"
      @refresh-playtime="refreshOnlinePlaytime"
      @refresh-playtime-force="refreshOnlinePlaytime(true)"
      @toggle-multi-select="toggleMultiSelectMode"
      @view-mode-change="handleViewModeChange"
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
      class="match-status-data-state"
      mode="fill"
      :loading="showInitialLoading"
      :error="blockingRuntimeError"
      :stale="showStaleBanner"
      :stale-text="staleText"
    >
      <div v-if="viewMode === 'list'" class="match-state-content">
        <div class="match-state-main">
          <div v-if="refreshError || playtimeError" class="match-error-stack">
            <ErrorBlock v-if="refreshError" :message="refreshError" />
            <ErrorBlock v-if="playtimeError" :message="playtimeError" />
          </div>

          <div class="squad-main-content" :class="pageState.densityMode">
            <TeamColumn
              v-for="team in viewModels.teams"
              :key="team.teamId"
              :team="team"
              :can-edit-tickets="canEditTickets"
              :playtimes="playtimes"
              :combat-stats-lookup="combatStatsLookup"
              :health-lookup="healthLookup"
              :density-mode="pageState.densityMode"
              :multi-select-mode="multiSelectMode"
              :selected-player-ids="selectedPlayerIds"
              @select-player="selectPlayer"
              @toggle-player-check="togglePlayerCheck"
              @edit-tickets="openTicketEditor"
              @select-squad="handleSquadClick"
            />
          </div>
        </div>

        <MatchChatPanel class="match-chat-column" />
      </div>
      <div v-else-if="viewMode === 'map'" class="match-state-map-wrapper">
        <TacticalMapPage
          :snapshot="bzssCoreSnapshot"
          :players="bzssCorePlayers"
          :loading="bzssCoreLoading"
          :errorText="bzssCoreError"
          @select-player="handleMapSelectPlayer"
        />
      </div>
    </DataState>

    <FloatingPlayerWindow
      :open="activePlayerWindow !== null"
      :player="activePlayerWindow?.detail ?? null"
      :server-id="currentServerId"
      :anchor-x="activePlayerWindow?.anchorX ?? null"
      :anchor-y="activePlayerWindow?.anchorY ?? null"
      :notice="activePlayerWindow?.notice ?? ''"
      @close="closePlayerDetail"
      @playtime-updated="handlePlayerPlaytimeUpdated"
    />

    <SquadDetailDrawer
      :open="selectedSquadDetail !== null"
      :squad="selectedSquadDetail"
      @close="closeSquadDetail"
    />

    <div v-if="ticketEditorOpen" class="ticket-modal-backdrop" v-backdrop-close="closeTicketEditor">
      <div class="ticket-modal-panel">
        <header class="ticket-modal-header">
          <div>
            <h3>修改票数</h3>
            <p>当前 sender: {{ ticketCommandTargetText }}</p>
          </div>
          <div class="ticket-modal-header-meta">
            <span class="ticket-control-badge" :data-tone="ticketSourceTone">{{ ticketSourceText }}</span>
            <button type="button" class="ticket-modal-close" @click="closeTicketEditor">×</button>
          </div>
        </header>

        <div class="ticket-modal-grid">
          <article class="ticket-side-card team1" :class="{ active: ticketEditorTeamId === 1 }" @click="ticketEditorTeamId = 1; ticketAdjustForm.team = 1; resetTicketFormToCurrent();" style="cursor: pointer;">
            <span class="ticket-side-card__label">TEAM 1</span>
            <strong class="ticket-side-card__value">{{ formatTicketDisplay(remoteTicketCounts.team1) }}</strong>
          </article>
          <article class="ticket-side-card team2" :class="{ active: ticketEditorTeamId === 2 }" @click="ticketEditorTeamId = 2; ticketAdjustForm.team = 2; resetTicketFormToCurrent();" style="cursor: pointer;">
            <span class="ticket-side-card__label">TEAM 2</span>
            <strong class="ticket-side-card__value">{{ formatTicketDisplay(remoteTicketCounts.team2) }}</strong>
          </article>
        </div>

        <form class="ticket-adjust-form" style="margin-top: 12px; padding-top: 16px; border-top: 1px solid rgba(255, 255, 255, 0.05);" @submit.prevent>
          <div class="ticket-editor-form" style="margin-bottom: 12px; grid-template-columns: 80px minmax(0, 1fr);">
            <label class="ticket-editor-field">
              <span class="ticket-editor-field__label">队伍</span>
              <select v-model="ticketAdjustForm.team" class="ticket-editor-input">
                <option :value="1">T1</option>
                <option :value="2">T2</option>
              </select>
            </label>
            <label class="ticket-editor-field">
              <span class="ticket-editor-field__label">数值 (例如 50 / -50)</span>
              <input v-model.trim="ticketAdjustForm.deltaText" type="text" inputmode="numeric" class="ticket-editor-input" placeholder="例如 50 / -50" />
            </label>
          </div>
          <div class="ticket-adjust-actions" style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;">
            <button type="button" class="ticket-control-badge" @click="setTicketAdjustDelta(10)">+10</button>
            <button type="button" class="ticket-control-badge" @click="setTicketAdjustDelta(50)">+50</button>
            <button type="button" class="ticket-control-badge" @click="setTicketAdjustDelta(100)">+100</button>
            <button type="button" class="ticket-control-badge" @click="setTicketAdjustDelta(-10)">-10</button>
            <button type="button" class="ticket-control-badge" @click="setTicketAdjustDelta(-50)">-50</button>
            <button type="button" class="ticket-control-badge" @click="setTicketAdjustDelta(-100)">-100</button>
          </div>
          <div class="ticket-modal-actions">
            <button type="button" class="ticket-editor-submit" :disabled="ticketAdjustLoading" @click="submitTicketAdjust(true)">
              {{ ticketAdjustLoading ? "处理中..." : "加票" }}
            </button>
            <button type="button" class="ticket-editor-reset" :disabled="ticketAdjustLoading" @click="submitTicketAdjust(false)">
              {{ ticketAdjustLoading ? "处理中..." : "减票" }}
            </button>
          </div>
        </form>

        <form style="margin-top: 8px; padding-top: 16px; border-top: 1px solid rgba(255, 255, 255, 0.05);" @submit.prevent="submitTicketWrite">
          <div class="ticket-editor-form">
            <label v-if="ticketEditorTeamId === 1" class="ticket-editor-field">
              <span class="ticket-editor-field__label">直接覆盖 TEAM 1 票数</span>
              <input v-model.trim="ticketForm.t1" type="text" inputmode="numeric" class="ticket-editor-input" placeholder="输入新的 TEAM 1 票数" />
            </label>
            <label v-else-if="ticketEditorTeamId === 2" class="ticket-editor-field">
              <span class="ticket-editor-field__label">直接覆盖 TEAM 2 票数</span>
              <input v-model.trim="ticketForm.t2" type="text" inputmode="numeric" class="ticket-editor-input" placeholder="输入新的 TEAM 2 票数" />
            </label>
          </div>

          <div v-if="ticketWriteError" class="ticket-control-error" style="margin-top: 12px;">{{ ticketWriteError }}</div>

          <footer class="ticket-modal-actions" style="margin-top: 16px;">
            <button type="button" class="ticket-editor-reset" :disabled="ticketWriteLoading" @click="resetTicketFormToCurrent">
              使用当前值
            </button>
            <button type="submit" class="ticket-editor-submit" :disabled="ticketWriteLoading">
              {{ ticketWriteLoading ? "提交中..." : "写入覆盖" }}
            </button>
          </footer>
        </form>
      </div>
    </div>

    <!-- 批量操作悬浮条 -->
    <transition name="bar-slide">
      <div v-if="multiSelectMode && selectedPlayers.length > 0" class="batch-action-bar">
        <div class="batch-bar-left">
          <span class="batch-count-badge">{{ selectedPlayers.length }}</span>
          <span class="batch-count-text">
            已选择 (T1: <strong class="t1-count">{{ selectedT1Count }}</strong> 人, T2: <strong class="t2-count">{{ selectedT2Count }}</strong> 人)
          </span>
        </div>
        <div class="batch-bar-actions">
          <button type="button" class="batch-btn warn" @click="handleBatchWarn">
            批量警告
          </button>
          <button type="button" class="batch-btn danger" @click="handleBatchKick">
            批量 Kick
          </button>
          <button type="button" class="batch-btn primary" @click="handleBatchForceTeamChange">
            批量跳边
          </button>
          <div class="batch-divider"></div>
          <button type="button" class="batch-btn secondary" @click="clearBatchSelection">
            取消选择
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, watch, provide } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRoute, useRouter } from "vue-router";
import { apiGet, apiPost } from "../app/apiClient";
import { renderApiError } from "../app/errors";
import { getRuntimeSyncState, syncOnce, useSnapshot } from "../app/runtimeSync";
import { applyMatchSnapshotResponse } from "../app/matchSnapshot";
import { useAuthStore } from "../stores/auth.store";
import { usePlayerStore } from "../stores/player.store";
import { useSquadStore } from "../stores/squad.store";
import { useServerStore } from "../stores/server.store";
import { useMatchStore } from "../stores/match.store";
import { useJobStore } from "../stores/job.store";
import { useUiStore } from "../stores/ui.store";
import { forceTeamChange } from "../app/teamBalanceApi";
import { warnPlayer, kickPlayer } from "../app/squadManagementApi";
import {
  adaptTeam,
  adaptPlayerDetail,
  buildCombatStatsLookupFromBzssCorePlayers,
  buildSquadLifecycleLookup,
  filterTeamsBySearch,
} from "../utils/squad-admin-adapter";
import { getFlagUrlByTeamName } from "../shared/faction-assets/faction-data";
import DataState from "../components/common/DataState.vue";
import ErrorBlock from "../components/common/ErrorBlock.vue";
import SquadPageToolbar from "../components/squad-admin/SquadPageToolbar.vue";
import TeamColumn from "../components/squad-admin/TeamColumn.vue";
import MatchChatPanel from "../components/match/MatchChatPanel.vue";
import FloatingPlayerWindow from "../components/squad-admin/FloatingPlayerWindow.vue";
import SquadDetailDrawer from "../components/squad-admin/SquadDetailDrawer.vue";
import TacticalMapPage from "./TacticalMapPage.vue";
import { t } from "../i18n";
import { normalizeRefreshPolicy, resolveRefreshDelay } from "../app/refreshPolicy";
import { useAutoRefreshGate } from "../composables/useAutoRefreshGate";
import { cancelIdleTask, scheduleIdleTask } from "../utils/idle";
import { resolvePlayerIdentityIp } from "../app/playerIdentityApi";
import { fetchBzssCorePlayerInfo, fetchBzssCorePlayerInfoList, streamBzssCorePlayerInfoList } from "../app/bzssCoreApi";
import type { BzssCorePlayerInfoResponse, BzssCoreTrackedPlayerInfo } from "../app/bzssCoreApi";
import type {
  PageState,
  PlayerDetailViewModel,
  PlayerRowViewModel,
  TeamViewModel,
  SquadViewModel,
} from "../types/squad-admin.types";
import type { RuntimePlayer } from "../stores/player.store";

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
const snapshot = useSnapshot();
const route = useRoute();
const router = useRouter();

const viewMode = ref<"list" | "map">(route.path.includes("map") ? "map" : "list");

watch(
  () => route.path,
  (path) => {
    viewMode.value = path.includes("map") ? "map" : "list";
  }
);

function handleViewModeChange(mode: "list" | "map") {
  if (mode === "list") {
    router.push("/match-status");
  } else {
    router.push("/tactical-map");
  }
}

const bzssCoreSnapshot = ref<BzssCorePlayerInfoResponse | null>(null);
const bzssCorePlayers = ref<BzssCoreTrackedPlayerInfo[]>([]);
const bzssCoreLoading = ref(false);
const bzssCoreError = ref("");
const bzssCoreSampleClock = ref(Date.now());
const bzssCoreSampleEvents = ref<number[]>([]);
const bzssCoreStreamActive = ref(false);
let unsubscribeBzssStream: (() => void) | null = null;
let bzssCoreSampleClockTimer: number | null = null;

const bzssCoreRecentSampleEvents = computed(() => {
  const now = bzssCoreSampleClock.value;
  return bzssCoreSampleEvents.value.filter((timestamp) => now - timestamp <= 1000);
});
const bzssCoreSampleRateLabel = computed(() => `${formatSampleDecimal(bzssCoreRecentSampleEvents.value.length)} / s`);
const bzssCoreSampleCountLabel = computed(() => `${bzssCoreRecentSampleEvents.value.length} 次 / 1s`);
const bzssCoreLastSampleLabel = computed(() => {
  const last = bzssCoreSampleEvents.value[bzssCoreSampleEvents.value.length - 1];
  if (!last) return "暂无样本";
  const age = Math.max(0, bzssCoreSampleClock.value - last);
  if (age < 1000) return `${age} ms 前`;
  return `${formatSampleDecimal(age / 1000)} s 前`;
});
const bzssCoreStreamLabel = computed(() => (bzssCoreStreamActive.value ? "SSE 实时流" : "轮询兜底"));

function startBzssStream() {
  bzssCoreLoading.value = true;
  if (unsubscribeBzssStream) unsubscribeBzssStream();
  bzssCoreStreamActive.value = true;
  unsubscribeBzssStream = streamBzssCorePlayerInfoList(
    (payload) => {
      bzssCoreLoading.value = false;
      bzssCoreSnapshot.value = payload;
      bzssCorePlayers.value = payload.players ?? [];
      bzssCoreError.value = payload.ok ? "" : payload.status || "BZSS-Core returned an error.";
      recordBzssCoreSample();
    },
    (err) => {
      bzssCoreLoading.value = false;
      if (typeof EventSource !== "undefined" && err?.target?.readyState === EventSource.CLOSED) {
        bzssCoreError.value = "SSE Stream connection error.";
        if (unsubscribeBzssStream) {
          unsubscribeBzssStream();
          unsubscribeBzssStream = null;
        }
        bzssCoreStreamActive.value = false;
      }
    }
  );
}

function recordBzssCoreSample() {
  const now = Date.now();
  bzssCoreSampleEvents.value = [...bzssCoreSampleEvents.value, now]
    .filter((timestamp) => now - timestamp <= 5000)
    .slice(-120);
  bzssCoreSampleClock.value = now;
}

function startBzssCoreSampleClock() {
  if (bzssCoreSampleClockTimer != null) return;
  bzssCoreSampleClockTimer = window.setInterval(() => {
    bzssCoreSampleClock.value = Date.now();
  }, 250);
}

function stopBzssCoreSampleClock() {
  if (bzssCoreSampleClockTimer != null) {
    window.clearInterval(bzssCoreSampleClockTimer);
    bzssCoreSampleClockTimer = null;
  }
}

const refreshingPlaytime = ref(false);
const refreshingPlayers = ref(false);
const refreshingSquads = ref(false);
const refreshingAll = ref(false);
const refreshError = ref("");
const playtimeError = ref("");
const ticketWriteError = ref("");
const ticketWriteLoading = ref(false);
const ticketAdjustLoading = ref(false);
const ticketEditorOpen = ref(false);
const ticketEditorTeamId = ref<number | null>(null);
const ticketForm = reactive({
  t1: "",
  t2: "",
});
const ticketAdjustForm = reactive({
  team: 1 as 1 | 2,
  deltaText: "",
});
const playtimeRequested = ref(true);
const playtimeJob = ref<PlaytimeJobViewModel | null>(null);
const activePlayerWindow = ref<{
  detail: PlayerDetailViewModel;
  anchorX: number;
  anchorY: number;
  notice: string;
} | null>(null);
const selectedSquadDetail = ref<SquadViewModel | null>(null);
const pageHidden = ref(typeof document !== "undefined" ? document.hidden : false);
const active = ref(true);
const { canAutoRefresh } = useAutoRefreshGate(computed(() => active.value && !pageHidden.value));
let battlePlayerRefreshToken = 0;
let battleStatsRefreshIdleHandle: number | null = null;

const multiSelectMode = ref(false);
const selectedPlayerIds = ref<Set<string | number>>(new Set());

const selectedPlayers = computed(() => {
  const list: PlayerRowViewModel[] = [];
  selectedPlayerIds.value.forEach((id) => {
    const player = findPlayerById(id);
    if (player) {
      list.push(player);
    }
  });
  return list;
});

const selectedT1Count = computed(() => {
  return selectedPlayers.value.filter((p) => Number(p.teamId) === 1).length;
});

const selectedT2Count = computed(() => {
  return selectedPlayers.value.filter((p) => Number(p.teamId) === 2).length;
});

const pageState = reactive<PageState>({
  searchQuery: "",
  densityMode: "compact",
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
const routeRefreshPolicy = computed(() => normalizeRefreshPolicy(route.meta.refreshPolicy));
const matchSnapshot = computed(() => snapshot.value?.snapshot?.matchState ?? snapshot.value?.matchState ?? null);
const remoteTelemetryQuery = useQuery({
  queryKey: computed(() => ["remote-telemetry-state", auth.authenticated]),
  enabled: computed(() => auth.authenticated),
  queryFn: async () => apiGet<any>("/api/remote-telemetry/state"),
  refetchInterval: computed(() => (auth.authenticated ? 2_000 : false)),
  refetchIntervalInBackground: true,
  refetchOnWindowFocus: false,
});
const remoteTelemetryState = computed(() => remoteTelemetryQuery.data.value?.remoteTelemetry ?? null);

const healthLookup = computed<Record<string, number | null>>(() => {
  const players = bzssCorePlayers.value;
  if (!Array.isArray(players) || players.length === 0) return {};
  const map: Record<string, number | null> = {};
  for (const p of players) {
    const name = String(p.playerName ?? "").trim();
    if (!name) continue;
    const hp = p.soldierInfo?.health;
    map[name] = hp != null && Number.isFinite(hp) ? hp : null;
  }
  return map;
});
const remoteTicketCounts = computed(() => {
  const latest = remoteTelemetryState.value?.currentSample ?? null;
  const latestTickets = latest?.tickets ?? {};
  const matchTickets = matchSnapshot.value?.match?.tickets ?? {};
  return {
    team1: firstFiniteNumber(latestTickets.team1, matchTickets.team1),
    team2: firstFiniteNumber(latestTickets.team2, matchTickets.team2),
  };
});
const ticketCommandTarget = computed(() => {
  const target = remoteTelemetryState.value?.commandTarget ?? null;
  const host = normalizeCommandHost(target?.host ?? "");
  const port = firstFiniteNumber(target?.port) ?? 12765;
  return {
    host,
    port,
  };
});
const canEditTickets = computed(() => {
  const hasPerm = auth.user?.isSuperAdmin || auth.user?.permissions?.includes("rcon.settickets");
  return Boolean(hasPerm && ticketCommandTarget.value.host);
});
const showTicketControlPanel = computed(() => Boolean(currentServerId.value || remoteTelemetryState.value?.currentSource));
const ticketCommandTargetText = computed(() => {
  if (!ticketCommandTarget.value.host) return "未识别 sender 地址";
  return `${ticketCommandTarget.value.host}:${ticketCommandTarget.value.port}`;
});
const ticketSourceTone = computed(() => {
  const source = remoteTelemetryState.value?.currentSource ?? null;
  if (!source) return "idle";
  if (source.online === false) return "warning";
  if (source.lastError) return "error";
  return "success";
});
const ticketSourceText = computed(() => {
  const source = remoteTelemetryState.value?.currentSource ?? null;
  if (!source) return "等待 sender";
  if (source.online === false) return "sender 离线";
  if (source.lastError) return source.lastError;
  return "sender 在线";
});
const runtimeWebStatus = computed(() => server.snapshot?.webStatus ?? server.snapshot ?? {});
const currentServerId = computed(() => String(
  runtimeWebStatus.value.serverId
  ?? matchSnapshot.value?.serverStatus?.serverId
  ?? matchSnapshot.value?.match?.serverId
  ?? server.snapshot?.serverId
  ?? "",
).trim());
const rconStatus = computed(() => String(runtimeWebStatus.value.rcon ?? "unknown"));
const currentPlayerCount = computed(() => Number(
  server.snapshot?.webStatus?.playerCount
  ?? matchSnapshot.value?.serverStatus?.playerCount
  ?? matchSnapshot.value?.players?.list?.length
  ?? players.active.length
  ?? 0,
));
const combatCacheRefetchInterval = computed(() => resolveRefreshDelay({
  policy: routeRefreshPolicy.value,
  playerCount: currentPlayerCount.value,
  hidden: pageHidden.value,
  surface: "page",
}));
const squadLifecycleRefetchInterval = computed(() => resolveRefreshDelay({
  policy: routeRefreshPolicy.value,
  playerCount: currentPlayerCount.value,
  hidden: pageHidden.value,
  surface: "pageSlow",
}));
const squadLifecycleQuery = useQuery({
  queryKey: computed(() => ["squad-lifecycle-current", auth.authenticated]),
  enabled: computed(() => auth.authenticated),
  queryFn: async () => apiGet<any>("/api/squad-lifecycle/current"),
  refetchInterval: computed(() => squadLifecycleRefetchInterval.value),
  refetchIntervalInBackground: true,
  refetchOnWindowFocus: false,
});
const squadLifecycleCurrent = computed(() => squadLifecycleQuery.data.value?.current ?? null);
const combatStatsLookup = computed(() => buildCombatStatsLookupFromBzssCorePlayers(bzssCorePlayers.value));
const battleLogOverviewQuery = useQuery({
  queryKey: computed(() => ["battle-log-overview", auth.authenticated, currentServerId.value]),
  enabled: computed(() => auth.authenticated && Boolean(currentServerId.value)),
  queryFn: async () => {
    try {
      return await apiGet<any>(`/api/battle-log/overview?serverId=${encodeURIComponent(currentServerId.value)}`);
    } catch {
      return createEmptyBattleLogOverview(currentServerId.value);
    }
  },
  staleTime: 5_000,
  refetchInterval: computed(() => combatCacheRefetchInterval.value),
  refetchIntervalInBackground: true,
  refetchOnWindowFocus: false,
});
const battleLogOverview = computed(() => normalizeBattleLogOverview(
  battleLogOverviewQuery.data.value ?? createEmptyBattleLogOverview(currentServerId.value),
));
const battleLogSummaryStats = computed(() => normalizeBattleLogSummaryStats(battleLogOverview.value.stats));
const battleLogSummaryTone = computed(() => {
  if (!battleLogOverview.value.enabled) return "idle";
  const logStatus = battleLogOverview.value.sourceStatus?.log;
  if (logStatus?.enabled === false || logStatus?.subscribed === false) return "warning";
  return "success";
});
const battleLogSummaryStatusText = computed(() => {
  if (!battleLogOverview.value.enabled) return "战绩模块未启用";
  const logStatus = battleLogOverview.value.sourceStatus?.log;
  if (logStatus?.enabled === false) return "战绩模块已关闭";
  if (logStatus?.subscribed === false) return "战绩订阅未连接";
  return "战绩订阅正常";
});
const battleLogSummarySubtitle = computed(() => {
  const total = Number(battleLogOverview.value.count ?? battleLogSummaryStats.value.total ?? 0);
  return `总计 ${total} 条`;
});
const battleLogSummaryUpdatedText = computed(() => {
  const updatedAt = battleLogOverview.value.lastUpdatedAt;
  if (!updatedAt) return "暂无更新时间";
  return `更新于 ${formatBattleLogTimestamp(updatedAt)}`;
});
const battleLogLatestText = computed(() => {
  const latest = Array.isArray(battleLogOverview.value.latest) ? battleLogOverview.value.latest : [];
  const first = latest[0];
  if (!first) return "";
  return first.displayText || first.note || first.sourceEventName || "";
});
const battleLogSummaryCards = computed(() => buildBattleLogSummaryCards(battleLogSummaryStats.value));
const showBattleLogPanel = computed(() => Boolean(currentServerId.value));
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

const stablePlaytimes = ref<Record<string, any>>({});
const squadLifecycleLookup = computed(() => buildSquadLifecycleLookup(squadLifecycleCurrent.value));
const playtimes = computed(() => stablePlaytimes.value);

provide("selectedPlayerId", computed(() => pageState.selectedPlayerId));

const viewerSteam64 = computed(() => normalizeSteam64(auth.user?.steam64));
const viewerAutoSwapEnabled = computed(() => auth.user?.viewerTeamAutoSwapEnabled !== false);

const rawTeams = computed(() => {
  return match.teams.map((team) => {
    const ticketCount = team.teamID === 1 ? remoteTicketCounts.value.team1 : remoteTicketCounts.value.team2;
    return adaptTeam(team, {}, squadLifecycleLookup.value, {}, ticketCount);
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

function handleVisibilityChange() {
  pageHidden.value = typeof document !== "undefined" ? document.hidden : false;
}

onMounted(() => {
  pageHidden.value = typeof document !== "undefined" ? document.hidden : false;
  document.addEventListener("visibilitychange", handleVisibilityChange);
  startBzssCoreSampleClock();
  startBzssStream();
});

onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  cancelIdleTask(battleStatsRefreshIdleHandle);
  if (unsubscribeBzssStream) {
    unsubscribeBzssStream();
    unsubscribeBzssStream = null;
  }
  bzssCoreStreamActive.value = false;
  stopBzssCoreSampleClock();
});

onActivated(() => {
  active.value = true;
  startBzssCoreSampleClock();
  if (!unsubscribeBzssStream) startBzssStream();
});

onDeactivated(() => {
  active.value = false;
  stopBzssCoreSampleClock();
});

function formatTicketDisplay(value: number | null | undefined) {
  return value == null ? "--" : String(value);
}

function formatSampleDecimal(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function resetTicketFormToCurrent() {
  ticketForm.t1 = ticketEditorTeamId.value === 1 && remoteTicketCounts.value.team1 != null
    ? String(remoteTicketCounts.value.team1)
    : "";
  ticketForm.t2 = ticketEditorTeamId.value === 2 && remoteTicketCounts.value.team2 != null
    ? String(remoteTicketCounts.value.team2)
    : "";
  ticketWriteError.value = "";
}

function setTicketAdjustDelta(delta: number) {
  ticketAdjustForm.deltaText = String(delta);
}

function openTicketEditor(team: TeamViewModel) {
  if (!canEditTickets.value) {
    ui.pushToast({
      title: "当前无法修改票数",
      message: ticketCommandTarget.value.host
        ? "请先等待 sender 恢复在线。"
        : "当前 sender 没有可用的命令地址，无法下发票数修改。",
      tone: "warn",
    });
    return;
  }
  ticketEditorTeamId.value = Number(team?.teamId ?? 0) || null;
  ticketEditorOpen.value = true;
  ticketAdjustForm.team = ticketEditorTeamId.value === 2 ? 2 : 1;
  ticketAdjustForm.deltaText = "";
  resetTicketFormToCurrent();
}

function closeTicketEditor() {
  ticketEditorOpen.value = false;
  ticketEditorTeamId.value = null;
  ticketWriteError.value = "";
}

function toggleTicketEditor() {
  if (ticketEditorOpen.value) {
    closeTicketEditor();
    return;
  }
  openTicketEditor({ teamId: 1 } as TeamViewModel);
}

async function submitTicketWrite() {
  ticketWriteError.value = "";
  ticketWriteLoading.value = true;
  try {
    if (!ticketCommandTarget.value.host) {
      throw new Error("当前 sender 没有可用的命令地址。");
    }
    const payload: Record<string, number> = {};
    if (ticketEditorTeamId.value === 1 && ticketForm.t1) payload.t1 = requireIntegerInput(ticketForm.t1, "TEAM 1");
    if (ticketEditorTeamId.value === 2 && ticketForm.t2) payload.t2 = requireIntegerInput(ticketForm.t2, "TEAM 2");
    if (payload.t1 == null && payload.t2 == null) {
      if (ticketEditorTeamId.value === 1) {
        throw new Error("请填写 TEAM 1 的票数。");
      }
      if (ticketEditorTeamId.value === 2) {
        throw new Error("请填写 TEAM 2 的票数。");
      }
      throw new Error("至少填写一个队伍票数。");
    }

    const result = await apiPost<any>("/api/remote-telemetry/write-tickets", payload);
    if (!result?.ok) {
      throw new Error(String(result?.response?.error || result?.error || "票数写入失败"));
    }

    await Promise.all([
      syncOnce(),
      remoteTelemetryQuery.refetch(),
    ]);
    resetTicketFormToCurrent();
    closeTicketEditor();
    const updatedTeamLabel = payload.t1 != null ? "TEAM 1" : "TEAM 2";
    const updatedValue = payload.t1 != null ? result?.response?.t1 : result?.response?.t2;
    ui.pushToast({
      title: "票数写入成功",
      message: `${updatedTeamLabel}: ${formatTicketDisplay(updatedValue)}`,
      tone: "ok",
    });
  } catch (error) {
    ticketWriteError.value = renderApiError(error, "票数写入失败");
    ui.pushToast({
      title: "票数写入失败",
      message: ticketWriteError.value,
      tone: "error",
    });
  } finally {
    ticketWriteLoading.value = false;
  }
}

async function submitTicketAdjust(isAdd = true) {
  ticketWriteError.value = "";
  ticketAdjustLoading.value = true;
  try {
    if (!ticketCommandTarget.value.host) {
      throw new Error("褰撳墠 sender 娌℃湁鍙敤鐨勫懡浠ゅ湴鍧€銆?");
    }

    const team = Number(ticketAdjustForm.team) === 2 ? 2 : 1;
    const inputDelta = requireIntegerInput(ticketAdjustForm.deltaText, "数值");
    if (inputDelta === 0) {
      throw new Error("票数变化不能为 0");
    }
    const delta = isAdd ? Math.abs(inputDelta) : -Math.abs(inputDelta);
    if (Math.abs(delta) > 1000) {
      throw new Error("单次改票不能超过 1000");
    }

    const before = team === 1 ? remoteTicketCounts.value.team1 : remoteTicketCounts.value.team2;
    const result = await apiPost<any>("/api/remote-telemetry/adjust-tickets", team === 1 ? { addT1: delta } : { addT2: delta });
    if (!result?.ok) {
      throw new Error(String(result?.response?.error || result?.error || "票数调整失败"));
    }

    await Promise.all([
      syncOnce(),
      remoteTelemetryQuery.refetch(),
    ]);

    const after = team === 1
      ? result?.response?.after?.t1 ?? result?.response?.t1 ?? null
      : result?.response?.after?.t2 ?? result?.response?.t2 ?? null;
    ui.pushToast({
      title: "票数调整成功",
      message: `T${team}: ${formatTicketDisplay(before)} -> ${formatTicketDisplay(after)} (${delta > 0 ? "+" : ""}${delta})`,
      tone: "ok",
    });
  } catch (error) {
    ticketWriteError.value = renderApiError(error, "票数调整失败");
    ui.pushToast({
      title: "票数调整失败",
      message: ticketWriteError.value,
      tone: "error",
    });
  } finally {
    ticketAdjustLoading.value = false;
  }
}

async function fetchPlaytimes(steamIDsList: string[]) {
  if (steamIDsList.length === 0) return {};
  const res = await apiGet<{ items: Record<string, any> }>(
    `/api/query/playtime-cache?steamIDs=${encodeURIComponent(steamIDsList.join(","))}`
  );
  return res?.items ?? {};
}

watch(
  () => players.active,
  async (newPlayers) => {
    if (!newPlayers || newPlayers.length === 0) return;
    const missingIDs = [...new Set(
      newPlayers
        .map((p) => String(p.steamID ?? "").trim())
        .filter((id) => id && stablePlaytimes.value[id] === undefined)
    )];

    if (missingIDs.length > 0 && auth.authenticated && playtimeRequested.value) {
      try {
        const items = await fetchPlaytimes(missingIDs);
        stablePlaytimes.value = {
          ...stablePlaytimes.value,
          ...items,
        };
        playtimeError.value = "";
      } catch (err) {
        playtimeError.value = renderApiError(err, t("common.error"));
      }
    }
  },
  { immediate: true }
);

watch(
  () => [bzssCorePlayers.value, activePlayerWindow.value?.detail.name, bzssCoreSnapshot.value] as const,
  ([currentPlayers, activeName, snapshotVal]) => {
    if (!activePlayerWindow.value) return;
    const currentName = String(activeName ?? "").trim();
    if (!currentName) return;

    let matched = currentPlayers.find((p) => String(p.playerName ?? "").trim() === currentName);
    if (!matched) {
      const currentSuffix = currentName.split(/\s+/).filter(Boolean).pop() ?? currentName;
      matched = currentPlayers.find((p) => {
        const responseName = String(p.playerName ?? "").trim();
        const responseSuffix = responseName.split(/\s+/).filter(Boolean).pop() ?? responseName;
        return currentSuffix && responseSuffix && currentSuffix === responseSuffix;
      });
    }

    const nextStatus = snapshotVal?.status || "";
    const nextCompletedAt = snapshotVal?.state?.lastCompletedAt ?? null;
    const nextPlayerInfo = matched ?? null;

    const currentDetail = activePlayerWindow.value.detail;
    if (
      currentDetail.bzssCoreStatus === nextStatus &&
      currentDetail.bzssCoreLastCompletedAt === nextCompletedAt &&
      currentDetail.bzssCorePlayerInfo === nextPlayerInfo
    ) {
      return;
    }

    activePlayerWindow.value = {
      ...activePlayerWindow.value,
      detail: {
        ...activePlayerWindow.value.detail,
        bzssCoreStatus: nextStatus,
        bzssCoreLastCompletedAt: nextCompletedAt,
        bzssCorePlayerInfo: nextPlayerInfo,
      },
    };
  },
  { immediate: true },
);

watch(
  () => [
    currentServerId.value,
    activePlayerWindow.value?.detail.playerId,
    activePlayerWindow.value?.detail.steamId,
    activePlayerWindow.value?.detail.steam64,
    activePlayerWindow.value?.detail.eosId,
    activePlayerWindow.value?.detail.controller,
    activePlayerWindow.value?.detail.name,
  ],
  () => {
    if (!active.value) return;
    cancelIdleTask(battleStatsRefreshIdleHandle);
    battleStatsRefreshIdleHandle = scheduleIdleTask(() => {
      if (!active.value) return;
      void refreshActivePlayerBattleStats();
    });
  },
  { immediate: true },
);

function selectPlayer(payload: { player: PlayerRowViewModel; event: MouseEvent }) {
  const player = payload.player;
  pageState.selectedPlayerId = player.playerId;
  const detail = buildPlayerDetailViewModel(player);

  activePlayerWindow.value = {
    detail,
    anchorX: payload.event?.clientX ?? Math.floor(window.innerWidth / 2),
    anchorY: payload.event?.clientY ?? Math.floor(window.innerHeight / 2),
    notice: "",
  };
  void hydrateActivePlayerWindowIp(detail);

  if (player.steamId) {
    playtimeRequested.value = true;
  }
}

function handleMapSelectPlayer(payload: { detail: any; event: MouseEvent }) {
  activePlayerWindow.value = {
    detail: payload.detail,
    anchorX: payload.event.clientX,
    anchorY: payload.event.clientY,
    notice: "",
  };
  void hydrateActivePlayerWindowIp(payload.detail);

  if (payload.detail.steamId) {
    playtimeRequested.value = true;
  }
}

function selectSquad(squad: SquadViewModel) {
  selectedSquadDetail.value = squad;
}

function handleSquadClick(squad: SquadViewModel) {
  if (multiSelectMode.value) {
    toggleSquadPlayersCheck(squad);
  } else {
    selectSquad(squad);
  }
}

function toggleSquadPlayersCheck(squad: SquadViewModel) {
  const squadPlayers = [
    ...(squad.leader ? [squad.leader] : []),
    ...squad.members,
  ];
  if (squadPlayers.length === 0) return;

  const newSet = new Set(selectedPlayerIds.value);
  const allSelected = squadPlayers.every((player) => {
    if (player.playerId == null) return false;
    const id = player.playerId;
    return newSet.has(id) || newSet.has(String(id)) || newSet.has(Number(id));
  });

  if (allSelected) {
    squadPlayers.forEach((player) => {
      if (player.playerId != null) {
        const id = player.playerId;
        const match = [id, String(id), Number(id)].find(x => newSet.has(x));
        if (match !== undefined) {
          newSet.delete(match);
        }
      }
    });
  } else {
    squadPlayers.forEach((player) => {
      if (player.playerId != null) {
        const id = player.playerId;
        const exists = [id, String(id), Number(id)].some(x => newSet.has(x));
        if (!exists) {
          newSet.add(id);
        }
      }
    });
  }
  selectedPlayerIds.value = newSet;
}

function toggleMultiSelectMode() {
  multiSelectMode.value = !multiSelectMode.value;
  selectedPlayerIds.value = new Set();
}

function clearBatchSelection() {
  selectedPlayerIds.value = new Set();
}

function togglePlayerCheck(payload: { player: PlayerRowViewModel; event: MouseEvent }) {
  const id = payload.player.playerId;
  if (id == null) return;
  const newSet = new Set(selectedPlayerIds.value);
  const match = [id, String(id), Number(id)].find(x => newSet.has(x));
  if (match !== undefined) {
    newSet.delete(match);
  } else {
    newSet.add(id);
  }
  selectedPlayerIds.value = newSet;
}

function closeSquadDetail() {
  selectedSquadDetail.value = null;
}

function handleDensityChange(mode: "comfortable" | "compact") {
  pageState.densityMode = mode;
  ui.setGlobalDensity(mode);
}

function closePlayerDetail() {
  pageState.selectedPlayerId = null;
  activePlayerWindow.value = null;
  battlePlayerRefreshToken += 1;
}

async function handleBatchWarn() {
  if (selectedPlayers.value.length === 0) return;
  const message = await ui.openWarnPrompt({
    title: "批量发送玩家警告",
    targetName: `${selectedPlayers.value.length} 名所选玩家`,
    defaultMessage: "请遵守服务器规则",
  });
  if (message === null) return;

  const targets = [...selectedPlayers.value];
  let successCount = 0;
  let failCount = 0;
  
  ui.pushToast({
    title: "批量操作中",
    message: `正在发送警告给 ${targets.length} 名玩家...`,
    tone: "idle",
  });

  await Promise.all(
    targets.map(async (player) => {
      try {
        const res = await warnPlayer({
          targetName: player.name,
          targetSteamId: player.steamId ?? undefined,
          targetEosId: player.eosId ?? undefined,
          message: message.trim() || "Admin Warning",
          reason: "manual_warn",
          sourceModule: "web.squadAdmin",
        });
        if (res.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (e) {
        failCount++;
      }
    })
  );

  ui.pushToast({
    title: "批量警告完成",
    message: `成功: ${successCount}，失败: ${failCount}`,
    tone: failCount > 0 ? "warn" : "ok",
  });

  clearBatchSelection();
}

async function handleBatchKick() {
  if (selectedPlayers.value.length === 0) return;
  
  const reason = window.prompt(`请输入批量踢出原因 (将作用于 ${selectedPlayers.value.length} 名玩家):`, "")?.trim();
  if (!reason) {
    ui.pushToast({
      title: "踢出已取消",
      message: "请先填写踢出原因。",
      tone: "warn",
    });
    return;
  }

  const confirmed = await ui.openConfirm({
    title: "确认批量踢出玩家？",
    message: `确定要将已选的 ${selectedPlayers.value.length} 名玩家踢出服务器吗？\n原因：${reason}`,
    tone: "error",
  });
  if (!confirmed) return;

  const targets = [...selectedPlayers.value];
  let successCount = 0;
  let failCount = 0;

  ui.pushToast({
    title: "批量操作中",
    message: `正在踢出 ${targets.length} 名玩家...`,
    tone: "idle",
  });

  await Promise.all(
    targets.map(async (player) => {
      try {
        const res = await kickPlayer({
          playerId: player.playerId ?? undefined,
          anyId: player.steamId || player.eosId || player.name || String(player.playerId ?? ""),
          steamId: player.steamId ?? undefined,
          eosId: player.eosId ?? undefined,
          name: player.name,
          reason,
          source: "web.squadAdmin",
        });
        if (res.ok) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (e) {
        failCount++;
      }
    })
  );

  ui.pushToast({
    title: "批量踢出完成",
    message: `成功: ${successCount}，失败: ${failCount}`,
    tone: failCount > 0 ? "warn" : "ok",
  });

  clearBatchSelection();
}

async function handleBatchForceTeamChange() {
  if (selectedPlayers.value.length === 0) return;

  const confirmed = await ui.openConfirm({
    title: "确认批量跳边？",
    message: `确定要将已选的 ${selectedPlayers.value.length} 名玩家执行跳边操作吗？`,
    tone: "warn",
  });
  if (!confirmed) return;

  const targets = [...selectedPlayers.value];
  let successCount = 0;
  let failCount = 0;

  ui.pushToast({
    title: "批量操作中",
    message: `正在为 ${targets.length} 名玩家执行跳边...`,
    tone: "idle",
  });

  await Promise.all(
    targets.map(async (player) => {
      try {
        const res = await forceTeamChange({
          steamId: player.steamId ?? undefined,
          playerName: player.name,
          source: "对局状态手动操作",
          reason: "manual_team_balance",
          operator: {
            id: auth.user?.id ?? auth.user?.username ?? "",
            name: auth.user?.username ?? "",
            username: auth.user?.username ?? "",
            role: auth.user?.role ?? "",
            isSuperAdmin: Boolean(auth.user?.isSuperAdmin),
            permissions: Array.isArray(auth.user?.permissions) ? auth.user.permissions : [],
          },
        });
        if (res.ok) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (e) {
        failCount++;
      }
    })
  );

  ui.pushToast({
    title: "批量跳边完成",
    message: `成功: ${successCount}，失败: ${failCount}`,
    tone: failCount > 0 ? "warn" : "ok",
  });

  clearBatchSelection();
}

async function handlePlayerPlaytimeUpdated() {
  try {
    const activeIDs = [...new Set(
      players.active
        .map((p) => String(p.steamID ?? "").trim())
        .filter(Boolean)
    )];
    if (activeIDs.length > 0) {
      const items = await fetchPlaytimes(activeIDs);
      stablePlaytimes.value = {
        ...stablePlaytimes.value,
        ...items,
      };
    }

    if (!activePlayerWindow.value) return;

    const currentId = activePlayerWindow.value.detail.playerId;
    const player = findPlayerById(currentId);
    if (!player) return;

    const existingBattleStats = activePlayerWindow.value.detail.battleStats ?? null;
    const existingBattleStatsLabel = activePlayerWindow.value.detail.battleStatsLabel ?? "";
    const existingBattleStatsSource = activePlayerWindow.value.detail.battleStatsSource ?? "";
    const existingBattleStatsLastUpdatedAt = activePlayerWindow.value.detail.battleStatsLastUpdatedAt ?? null;
    const existingResolvedIp = String(activePlayerWindow.value.detail.resolvedIp ?? "").trim();
    const existingLastIp = String(activePlayerWindow.value.detail.lastIp ?? "").trim();
    const existingIpSource = activePlayerWindow.value.detail.ipSource ?? "none";
    const existingBzssCoreStatus = activePlayerWindow.value.detail.bzssCoreStatus ?? "";
    const existingBzssCoreLastCompletedAt = activePlayerWindow.value.detail.bzssCoreLastCompletedAt ?? null;
    const existingBzssCorePlayerInfo = activePlayerWindow.value.detail.bzssCorePlayerInfo ?? null;
    const nextDetail = buildPlayerDetailViewModel(player);
    if (!String(nextDetail.resolvedIp ?? "").trim() && existingResolvedIp) {
      nextDetail.resolvedIp = existingResolvedIp;
      nextDetail.lastIp = existingLastIp || existingResolvedIp;
      nextDetail.ipSource = existingIpSource;
    }

    activePlayerWindow.value = {
      ...activePlayerWindow.value,
      detail: {
        ...nextDetail,
        ...(existingBattleStats ? {
          battleStats: existingBattleStats,
          battleStatsLabel: existingBattleStatsLabel,
          battleStatsSource: existingBattleStatsSource,
          battleStatsLastUpdatedAt: existingBattleStatsLastUpdatedAt,
        } : {}),
        bzssCoreStatus: existingBzssCoreStatus,
        bzssCoreLastCompletedAt: existingBzssCoreLastCompletedAt,
        bzssCorePlayerInfo: existingBzssCorePlayerInfo,
      },
      notice: "",
    };
    void hydrateActivePlayerWindowIp(nextDetail);
  } catch (error) {
    ui.pushToast({
      title: t("common.error"),
      message: renderApiError(error, t("common.error")),
      tone: "error",
    });
  }
}

function buildPlayerDetailViewModel(player: PlayerRowViewModel): PlayerDetailViewModel {
  const rawBase = player.raw && typeof player.raw === "object" ? player.raw : {};
  const rawPlayer: RuntimePlayer = {
    ...rawBase,
    playerID: normalizePlayerId(player.playerId),
    name: player.name,
    teamID: player.teamId ?? null,
    squadID: player.squadId ?? null,
    steamID: player.steamId ?? undefined,
    steam64: player.steam64 ?? (rawBase as any).steam64 ?? undefined,
    eosID: player.eosId ?? undefined,
    isLeader: player.isLeader,
    role: player.role,
    online: player.isOnline,
    current_ip: player.ip ?? (rawBase as any).current_ip ?? (rawBase as any).ip ?? undefined,
    matchOnlineSeconds: player.matchOnlineSeconds ?? (rawBase as any).matchOnlineSeconds ?? undefined,
    matchObservedOnlineSeconds: player.matchObservedOnlineSeconds ?? (rawBase as any).matchObservedOnlineSeconds ?? undefined,
    matchEstimatedOnlineSeconds: player.matchEstimatedOnlineSeconds ?? (rawBase as any).matchEstimatedOnlineSeconds ?? undefined,
    matchFirstSeenAt: player.matchFirstSeenAt ?? (rawBase as any).matchFirstSeenAt ?? undefined,
    matchLastSeenAt: player.matchLastSeenAt ?? (rawBase as any).matchLastSeenAt ?? undefined,
    matchJoinCount: player.matchJoinCount ?? (rawBase as any).matchJoinCount ?? undefined,
  } as RuntimePlayer;
  const detail = adaptPlayerDetail(rawPlayer, player.playtimeHours ?? null, combatStatsLookup.value);
  const currentTeam =
    viewModels.value.teams.find((team) => team.teamId === player.teamId)
    ?? rawTeams.value.find((team) => team.teamId === player.teamId)
    ?? null;
  const resolvedTeamName = normalizeResolvedTeamName(
    currentTeam?.teamName
    ?? player.teamName
    ?? (rawBase as any).teamName
    ?? (rawBase as any).TeamName,
  );
  detail.teamName = resolvedTeamName;
  detail.factionFlagUrl = resolvedTeamName
    ? getFlagUrlByTeamName(resolvedTeamName)
    : (player.factionFlagUrl ?? null);
  const cacheRecord = player.steamId ? stablePlaytimes.value[player.steamId] : null;
  detail.steamAvatar = cacheRecord?.steam_avatar || cacheRecord?.steamAvatar || player.steamAvatar || null;
  return detail;
}

async function hydrateActivePlayerWindowIp(detail: PlayerDetailViewModel) {
  const currentIp = String(detail.resolvedIp ?? detail.ip ?? "").trim();
  if (currentIp) return;

  const identityKey = buildBattlePlayerIdentityKey(detail);
  if (!identityKey) return;

  try {
    const result = await resolvePlayerIdentityIp({
      steamId: detail.steam64 ?? detail.steamId,
      eosId: detail.eosId,
      name: detail.name,
    });
    if (!result.ip) return;
    if (!activePlayerWindow.value) return;
    if (buildBattlePlayerIdentityKey(activePlayerWindow.value.detail) !== identityKey) return;

    activePlayerWindow.value = {
      ...activePlayerWindow.value,
      detail: {
        ...activePlayerWindow.value.detail,
        lastIp: result.ip,
        resolvedIp: result.ip,
        ipSource: result.source,
      },
    };
  } catch {
    // Leave the floating player window unchanged when database IP backfill fails.
  }
}

async function refreshActivePlayerBattleStats() {
  const windowState = activePlayerWindow.value;
  const detail = windowState?.detail;
  const query = buildBattlePlayerQuery(detail);
  if (!windowState || !detail || !query || !currentServerId.value) return;

  const requestToken = ++battlePlayerRefreshToken;

  try {
    const response = await apiGet<any>(`/api/battle-log/player?serverId=${encodeURIComponent(currentServerId.value)}${query}`);
    if (requestToken !== battlePlayerRefreshToken) return;
    if (!activePlayerWindow.value) return;
    if (buildBattlePlayerIdentityKey(activePlayerWindow.value.detail) !== buildBattlePlayerIdentityKey(detail)) return;

    const battleStats = normalizeBattlePlayerStats(response?.stats ?? response?.overview?.stats ?? null);
    activePlayerWindow.value = {
      ...activePlayerWindow.value,
      detail: {
        ...activePlayerWindow.value.detail,
        battleStats,
        battleStatsLabel: `击倒 ${battleStats.downs} / 击杀 ${battleStats.kills} / 死亡 ${battleStats.deaths} / TK ${battleStats.tk} / 复苏 ${battleStats.revives}`,
        battleStatsSource: String(response?.source ?? "battleLog"),
        battleStatsLastUpdatedAt: response?.lastUpdatedAt ? String(response.lastUpdatedAt) : null,
      },
    };
  } catch {
    if (requestToken !== battlePlayerRefreshToken) return;
  }
}

function normalizePlayerId(value: string | number | null | undefined) {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeResolvedTeamName(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function buildBattlePlayerQuery(detail: PlayerDetailViewModel | null | undefined) {
  if (!detail) return "";

  const params = new URLSearchParams();
  const steam64ID = normalizeSteam64(detail.steam64 ?? detail.steamId);
  const eosID = String(detail.eosId ?? "").trim();
  const controllerID = String(detail.controller ?? "").trim();
  const name = String(detail.name ?? "").trim();

  if (steam64ID) params.set("steam64ID", steam64ID);
  if (eosID) params.set("eosID", eosID);
  if (controllerID) params.set("controllerID", controllerID);
  if (name) params.set("name", name);
  if (detail.playerId != null) params.set("playerKey", String(detail.playerId));

  const query = params.toString();
  return query ? `&${query}` : "";
}

function buildBattlePlayerIdentityKey(detail: PlayerDetailViewModel | null | undefined) {
  if (!detail) return "";
  return [
    normalizeSteam64(detail.steam64 ?? detail.steamId),
    String(detail.eosId ?? "").trim().toLowerCase(),
    String(detail.controller ?? "").trim().toLowerCase(),
    String(detail.name ?? "").trim().toLowerCase(),
    String(detail.playerId ?? ""),
  ].join("|");
}

function normalizeBattleLogOverview(value: any) {
  const stats = normalizeBattleLogStats(value?.stats ?? null);
  return {
    ok: Boolean(value?.ok ?? true),
    enabled: Boolean(value?.enabled ?? false),
    source: String(value?.source ?? "battleLog"),
    count: Number(value?.count ?? stats.total ?? 0) || 0,
    stats,
    lastUpdatedAt: value?.lastUpdatedAt ? String(value.lastUpdatedAt) : "",
    latest: Array.isArray(value?.latest) ? value.latest : [],
    sourceStatus: value?.sourceStatus ?? {},
    serverId: String(value?.serverId ?? currentServerId.value ?? ""),
  };
}

function normalizeBattleLogStats(value: any) {
  return {
    total: Number(value?.total ?? value?.count ?? 0) || 0,
    down: Number(value?.down ?? value?.downs ?? 0) || 0,
    kill: Number(value?.kill ?? value?.kills ?? 0) || 0,
    death: Number(value?.death ?? value?.deaths ?? 0) || 0,
    revive: Number(value?.revive ?? value?.revives ?? 0) || 0,
    tk: Number(value?.tk ?? 0) || 0,
  };
}

function normalizeBattlePlayerStats(value: any) {
  return {
    kills: Number(value?.kills ?? value?.kill ?? 0) || 0,
    downs: Number(value?.downs ?? value?.down ?? 0) || 0,
    deaths: Number(value?.deaths ?? value?.death ?? 0) || 0,
    tk: Number(value?.tk ?? 0) || 0,
    revives: Number(value?.revives ?? value?.revive ?? 0) || 0,
  };
}

function normalizeBattleLogSummaryStats(value: any) {
  return normalizeBattleLogStats(value);
}

function createEmptyBattleLogOverview(serverId = "") {
  return {
    ok: true,
    enabled: false,
    source: "battleLog",
    count: 0,
    stats: {
      total: 0,
      down: 0,
      kill: 0,
      death: 0,
      revive: 0,
      tk: 0,
    },
    lastUpdatedAt: "",
    latest: [],
    sourceStatus: {
      log: {
        enabled: false,
        subscribed: false,
      },
      mod: {
        enabled: false,
        subscribed: false,
        supported: false,
      },
    },
    serverId: String(serverId ?? ""),
  };
}

function buildBattleLogSummaryCards(stats: ReturnType<typeof normalizeBattleLogStats>) {
  return [
    { key: "down", label: "击倒", value: stats.down, tone: "down" },
    { key: "kill", label: "击杀", value: stats.kill, tone: "kill" },
    { key: "death", label: "死亡", value: stats.death, tone: "death" },
    { key: "revive", label: "复苏", value: stats.revive, tone: "revive" },
    { key: "tk", label: "TK", value: stats.tk, tone: "tk" },
  ];
}

function battleLogSummaryCardLabel(key: string) {
  if (key === "down") return "击倒";
  if (key === "kill") return "击杀";
  if (key === "death") return "死亡";
  if (key === "revive") return "复苏";
  if (key === "tk") return "TK";
  return key;
}

function formatBattleStatsLabel(stats: ReturnType<typeof normalizeBattleLogStats>) {
  return `击倒 ${stats.down} / 击杀 ${stats.kill} / 死亡 ${stats.death} / TK ${stats.tk} / 复苏 ${stats.revive}`;
}

function formatBattleLogTimestamp(value: string | number | null | undefined) {
  const time = toMillis(value);
  if (!time) return "";
  return new Date(time).toLocaleString("zh-CN", { hour12: false });
}

function findPlayerById(playerId: PlayerDetailViewModel["playerId"]) {
  if (playerId == null) return null;
  for (const team of rawTeams.value) {
    for (const squad of team.squads) {
      if (squad.leader && String(squad.leader.playerId) === String(playerId)) {
        return squad.leader;
      }
      const member = squad.members.find((item) => String(item.playerId) === String(playerId));
      if (member) return member;
    }
  }
  return null;
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

    const activeIDs = [...new Set(
      players.active
        .map((p) => String(p.steamID ?? "").trim())
        .filter(Boolean)
    )];
    if (activeIDs.length > 0) {
      const items = await fetchPlaytimes(activeIDs);
      stablePlaytimes.value = {
        ...stablePlaytimes.value,
        ...items,
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

  applyMatchSnapshotResponse(result);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    await sleep(2000);
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

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function normalizeCommandHost(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.startsWith("::ffff:") ? text.slice("::ffff:".length) : text;
}

function requireIntegerInput(value: string, label: string): number {
  const text = String(value ?? "").trim();
  if (!/^-?\d+$/.test(text)) {
    throw new Error(`${label} 必须是整数。`);
  }
  return Number(text);
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

.bzss-sample-window {
  position: fixed;
  top: 124px;
  right: 18px;
  z-index: 70;
  width: 218px;
  padding: 12px 12px 10px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 12px;
  background: rgba(2, 6, 23, 0.9);
  box-shadow: 0 16px 34px rgba(2, 6, 23, 0.28);
  backdrop-filter: blur(12px);
}

.bzss-sample-window__title {
  display: block;
  margin-bottom: 6px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.bzss-sample-window__rate {
  display: block;
  font-size: 28px;
  line-height: 1;
  color: #86efac;
}

.bzss-sample-window__meta {
  display: grid;
  gap: 4px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.match-state-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
  gap: 10px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  align-items: stretch;
}

.match-state-main {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.match-chat-column {
  min-width: 0;
  min-height: 0;
  height: auto;
  align-self: stretch;
}

.match-error-stack {
  display: grid;
  gap: 8px;
  padding: 8px var(--spacing-lg) 0;
}

.ticket-control-card {
  display: grid;
  gap: 12px;
  margin: 8px var(--spacing-lg) 0;
  padding: 12px 14px;
  border: 1px solid rgba(245, 158, 11, 0.26);
  border-radius: var(--radius-xl);
  background:
    radial-gradient(circle at 100% 0%, rgba(245, 158, 11, 0.12), transparent 28%),
    radial-gradient(circle at 0% 0%, rgba(59, 130, 246, 0.08), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.015)),
    var(--color-bg-card);
  box-shadow: var(--shadow-md);
  min-width: 0;
}

.ticket-control-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.ticket-control-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.ticket-control-subtitle {
  margin-top: 4px;
  color: var(--color-text-muted);
  font-size: 13px;
}

.ticket-control-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.ticket-control-badge,
.ticket-control-toggle,
.ticket-editor-submit,
.ticket-editor-reset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: var(--radius-full);
  font-size: 13px;
  font-weight: 600;
}

.ticket-control-badge {
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-secondary);
}

.ticket-control-badge[data-tone="success"] {
  color: var(--color-status-online);
  border-color: rgba(34, 197, 94, 0.28);
}

.ticket-control-badge[data-tone="warning"] {
  color: var(--color-status-warning);
  border-color: rgba(245, 158, 11, 0.28);
}

.ticket-control-badge[data-tone="error"] {
  color: var(--color-status-error);
  border-color: rgba(239, 68, 68, 0.28);
}

.ticket-control-toggle,
.ticket-editor-submit,
.ticket-editor-reset {
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-primary);
}

.ticket-control-toggle:disabled,
.ticket-editor-submit:disabled,
.ticket-editor-reset:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ticket-editor-submit {
  border-color: rgba(245, 158, 11, 0.38);
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.18), rgba(245, 158, 11, 0.1));
}

.ticket-control-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.ticket-side-card {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.03);
}

.ticket-side-card.team1 {
  border-color: rgba(56, 189, 248, 0.3);
  background: linear-gradient(180deg, rgba(56, 189, 248, 0.12), rgba(56, 189, 248, 0.05));
}

.ticket-side-card.team2 {
  border-color: rgba(251, 146, 60, 0.32);
  background: linear-gradient(180deg, rgba(251, 146, 60, 0.14), rgba(251, 146, 60, 0.05));
}

.ticket-side-card__label {
  color: var(--color-text-muted);
  font-size: 12px;
  letter-spacing: 0.05em;
}

.ticket-side-card__value {
  color: var(--color-text-primary);
  font-size: 28px;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.ticket-editor-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
  gap: 10px;
  align-items: end;
}

.ticket-editor-field {
  display: grid;
  gap: 6px;
}

.ticket-editor-field__label {
  color: var(--color-text-muted);
  font-size: 12px;
}

.ticket-editor-input {
  min-width: 0;
  height: 38px;
  padding: 0 12px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border-default);
  background: rgba(15, 23, 42, 0.35);
  color: var(--color-text-primary);
}

.ticket-editor-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.ticket-control-error {
  color: var(--color-status-error);
  font-size: 13px;
}

.ticket-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(2, 6, 23, 0.56);
  backdrop-filter: blur(8px);
}

.ticket-modal-panel {
  width: min(560px, 100%);
  display: grid;
  gap: 14px;
  padding: 16px;
  border-radius: var(--radius-xl);
  border: 1px solid rgba(245, 158, 11, 0.28);
  background:
    radial-gradient(circle at 100% 0%, rgba(245, 158, 11, 0.12), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.015)),
    var(--color-bg-card);
  box-shadow: var(--shadow-lg);
}

.ticket-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.ticket-modal-header h3 {
  margin: 0;
  font-size: 18px;
  color: var(--color-text-primary);
}

.ticket-modal-header p {
  margin: 6px 0 0;
  color: var(--color-text-muted);
  font-size: 13px;
}

.ticket-modal-header-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ticket-modal-close {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-primary);
  font-size: 18px;
  line-height: 1;
}

.ticket-modal-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.ticket-side-card.active {
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 10px 24px rgba(15, 23, 42, 0.18);
}

.ticket-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.playtime-refresh-card {
  display: grid;
  gap: 10px;
  margin: 8px var(--spacing-lg) 0;
  padding: 10px 14px;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-xl);
  background:
    radial-gradient(circle at 0% 0%, rgba(96, 165, 250, 0.08), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.015)),
    var(--color-bg-card);
  box-shadow: var(--shadow-md);
  min-width: 0;
}

.battle-log-summary-card {
  display: grid;
  gap: 10px;
  margin: 8px var(--spacing-lg) 0;
  padding: 10px 14px;
  border: 1px solid rgba(96, 165, 250, 0.28);
  border-radius: var(--radius-xl);
  background:
    radial-gradient(circle at 100% 0%, rgba(34, 197, 94, 0.08), transparent 30%),
    radial-gradient(circle at 0% 0%, rgba(96, 165, 250, 0.08), transparent 36%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.015)),
    var(--color-bg-card);
  box-shadow: var(--shadow-md);
  min-width: 0;
}

.battle-log-summary-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.battle-log-summary-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.battle-log-summary-subtitle {
  margin-top: 4px;
  color: var(--color-text-muted);
  font-size: 13px;
}

.battle-log-summary-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.battle-log-summary-badge {
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

.battle-log-summary-badge[data-tone="success"] {
  color: var(--color-status-online);
  border-color: rgba(34, 197, 94, 0.28);
}

.battle-log-summary-badge[data-tone="warning"] {
  color: var(--color-status-warning);
  border-color: rgba(245, 158, 11, 0.28);
}

.battle-log-summary-badge[data-tone="idle"] {
  color: var(--color-text-secondary);
}

.battle-log-summary-updated {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.battle-log-summary-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

@media (max-width: 980px) {
  .ticket-control-grid,
  .ticket-editor-form,
  .shuffle-plan-stats,
  .battle-log-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .ticket-control-grid,
  .ticket-editor-form,
  .ticket-modal-grid {
    grid-template-columns: 1fr;
  }
}

.battle-log-summary-stat {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.025);
  min-width: 0;
}

.battle-log-summary-stat[data-tone="down"] {
  border-color: rgba(59, 130, 246, 0.24);
}

.battle-log-summary-stat[data-tone="kill"] {
  border-color: rgba(248, 113, 113, 0.22);
}

.battle-log-summary-stat[data-tone="death"] {
  border-color: rgba(148, 163, 184, 0.22);
}

.battle-log-summary-stat[data-tone="revive"] {
  border-color: rgba(34, 197, 94, 0.24);
}

.battle-log-summary-stat[data-tone="tk"] {
  border-color: rgba(245, 158, 11, 0.28);
}

.battle-log-summary-stat-label {
  color: var(--color-text-muted);
  font-size: 12px;
  letter-spacing: 0.02em;
}

.battle-log-summary-stat-value {
  color: var(--color-text-primary);
  font-size: 20px;
  font-weight: 800;
  line-height: 1;
}

.battle-log-summary-latest {
  padding: 8px 10px;
  border-radius: var(--radius-lg);
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-secondary);
  font-size: 13px;
}

.playtime-refresh-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.playtime-refresh-title {
  font-size: 15px;
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
  gap: clamp(10px, 1vw, 16px);
  padding: clamp(10px, 1vw, 16px);
  min-height: 0;
  height: 100%;
  overflow: hidden;
  align-items: stretch;
  background: linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.004)), transparent 22%), var(--app-background, var(--color-bg-page));
}

@media (max-width: 1180px) {
  .match-state-content {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(360px, 1fr) minmax(280px, 40%);
  }

  .battle-log-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .squad-main-content {
    grid-template-columns: 1fr;
  }

  .match-chat-column {
    min-height: 280px;
  }
}

@media (max-width: 720px) {
  .battle-log-summary-grid {
    grid-template-columns: 1fr;
  }

  .bzss-sample-window {
    top: 12px;
    right: 12px;
    width: min(200px, calc(100vw - 24px));
  }
}

/* ─── 批量操作悬浮条 ─────────────────────────────────────────────────────── */
.batch-action-bar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 12px 24px;
  border-radius: var(--radius-xl);
  border: 1px solid rgba(140, 160, 200, 0.28);
  background:
    linear-gradient(135deg, rgba(55, 200, 255, 0.08), rgba(168, 85, 247, 0.06)),
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.015)),
    rgba(10, 15, 24, 0.88);
  box-shadow:
    0 24px 70px rgba(0, 0, 0, 0.64),
    0 8px 20px rgba(0, 0, 0, 0.36),
    0 0 0 1px rgba(255, 255, 255, 0.03) inset;
  backdrop-filter: blur(20px) saturate(1.3);
  width: min(720px, calc(100vw - 24px));
  max-width: calc(100vw - 24px);
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  animation: bar-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.batch-bar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.batch-count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  border-radius: var(--radius-full);
  background: var(--color-status-info);
  color: #fff;
  font-weight: 800;
  font-size: 13px;
  box-shadow: 0 0 10px rgba(96, 165, 250, 0.4);
}

.batch-count-text {
  font-size: var(--font-size-base);
  font-weight: 700;
  color: var(--color-text-primary);
}

.batch-bar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex-grow: 1;
  justify-content: flex-end;
}

.batch-btn {
  height: 32px;
  padding: 0 14px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  transition: all 0.15s ease;
  white-space: nowrap;
}

.batch-btn.primary {
  background: rgba(96, 165, 250, 0.12);
  color: #93c5fd;
  border-color: rgba(96, 165, 250, 0.35);
}

.batch-btn.primary:hover {
  background: rgba(96, 165, 250, 0.22);
  border-color: rgba(96, 165, 250, 0.6);
  color: #bfdbfe;
  box-shadow: 0 0 12px rgba(96, 165, 250, 0.2);
}

.batch-btn.warn {
  background: rgba(245, 158, 11, 0.12);
  color: #fde68a;
  border-color: rgba(245, 158, 11, 0.35);
}

.batch-btn.warn:hover {
  background: rgba(245, 158, 11, 0.22);
  border-color: rgba(245, 158, 11, 0.6);
  color: #fef08a;
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.2);
}

.batch-btn.danger {
  background: rgba(248, 113, 113, 0.12);
  color: #fca5a5;
  border-color: rgba(248, 113, 113, 0.35);
}

.batch-btn.danger:hover {
  background: rgba(248, 113, 113, 0.22);
  border-color: rgba(248, 113, 113, 0.6);
  color: #fecaca;
  box-shadow: 0 0 12px rgba(248, 113, 113, 0.2);
}

.batch-btn.secondary {
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-muted);
}

.batch-btn.secondary:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-secondary);
}

.batch-divider {
  width: 1px;
  height: 18px;
  background: var(--color-border-soft);
  margin: 0 4px;
}

/* ─── 动画 ───────────────────────────────────────────────────────────────── */
@keyframes bar-slide-in {
  from {
    transform: translate(-50%, 40px);
    opacity: 0;
  }
  to {
    transform: translate(-50%, 0);
    opacity: 1;
  }
}

.bar-slide-leave-active {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.bar-slide-leave-to {
  transform: translate(-50%, 40px);
  opacity: 0;
}

.t1-count {
  color: var(--color-team1-primary, #37c8ff);
  font-weight: 800;
}

.t2-count {
  color: var(--color-team2-primary, #ff9b45);
  font-weight: 800;
}

.match-state-map-wrapper {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.match-status-data-state {
  grid-row: 3;
}
</style>
