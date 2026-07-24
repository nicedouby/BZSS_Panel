<template>
  <div class="replay-workbench" :class="{ 'is-player-mode': isPlayerMode }">
    <header class="replay-header">
      <div>
        <p class="eyebrow">{{ isPlayerMode ? "TACTICAL REPLAY / PLAYER" : "TACTICAL ARCHIVE / WORKBENCH" }}</p>
        <h1>{{ isPlayerMode ? "战术回放播放器" : "战术回放工作台" }}</h1>
        <p class="subtitle">{{ isPlayerMode ? "独立读取 .rps 增量记录，使用与实时战术地图一致的图标、缩放和拖动操作。" : "管理已录制的对局；当前页面是可播放、可互动的战术预览，完整高级页面以后单独设计。" }}</p>
      </div>
      <div class="header-actions">
        <span class="source-chip" :class="{ live: status && status.enabled }"><i></i>{{ status && status.enabled ? "回放读取器在线" : "读取器未启动" }}</span>
        <button v-if="isPlayerMode" class="ghost-button" type="button" @click="backToWorkbench">返回工作台</button>
        <button v-else class="ghost-button" type="button" :disabled="loadingSessions" @click="loadSessions">{{ loadingSessions ? "刷新中…" : "刷新档案" }}</button>
      </div>
    </header>

    <div v-if="errorText" class="error-banner">{{ errorText }}</div>
    <div v-if="!sessions.length && !loadingSessions" class="empty-state">
      <div class="empty-icon">◷</div>
      <h2>还没有可播放的战术录制</h2>
      <p>请先在实时战术地图打开录制。录制结束后，档案会出现在这里；进行中的 `.open` 会话也可直接读取。</p>
      <code v-if="archiveRootDir" class="archive-path">{{ archiveRootDir }}</code>
      <button class="primary-button" type="button" @click="loadSessions">重新扫描</button>
    </div>

    <section v-else class="replay-grid">
      <aside class="session-rail panel">
        <div class="panel-heading"><div><span class="panel-kicker">ARCHIVE</span><h2>对局档案</h2></div><span class="count-badge">{{ sessions.length }}</span></div>
        <label class="search-box"><span>⌕</span><input v-model="searchText" type="search" placeholder="搜索地图或图层" /></label>
        <div class="session-list">
          <button v-for="item in filteredSessions" :key="item.id" type="button" class="session-card" :class="{ selected: item.id === (activeSession && activeSession.id), unreadable: item.isPlayable === false }" :disabled="item.isPlayable === false" @click="selectSession(item)">
            <span class="session-status" :class="item.status"></span>
            <span class="session-body"><strong>{{ item.map || (item.isPlayable === false ? "异常档案" : "未知地图") }}</strong><small>{{ item.archiveError || item.layer || "未记录图层" }}</small><em><span>{{ formatDate(item.startedAt) }}</span><span>{{ formatDuration(item.durationMs) }}</span></em></span>
            <span class="session-arrow">›</span>
          </button>
          <p v-if="!filteredSessions.length" class="muted-empty">没有匹配的档案</p>
        </div>
      </aside>

      <main class="stage panel" :class="{ 'is-player-stage': isPlayerMode }">
        <div class="stage-heading">
          <div><span class="panel-kicker">{{ isPlayerMode ? "RECONSTRUCTED SCENE" : "MAP PREVIEW" }}</span><h2>{{ activeSession && activeSession.map || "选择一场对局" }}</h2><span class="stage-layer">{{ activeSession && activeSession.layer || "等待选择录制档案" }}</span></div>
          <div class="stage-metrics"><span><b>{{ formatClock(currentMs) }}</b><small>当前时间</small></span><span><b>{{ visiblePlayers.length }}</b><small>场上玩家</small></span></div>
        </div>

        <div v-if="!isPlayerMode" class="session-overview">
          <span><small>录制时间</small><b>{{ activeSession ? formatDate(activeSession.startedAt) : "--" }}</b></span>
          <span><small>回放时长</small><b>{{ activeSession ? formatDuration(activeSession.durationMs) : "--:--" }}</b></span>
          <span><small>档案状态</small><b :class="{ recording: activeSession && activeSession.status === 'recording' }">{{ activeSession && activeSession.status === "recording" ? "录制中" : "可播放" }}</b></span>
        </div>

        <div
          ref="replayViewportRef"
          class="map-shell"
          :class="{ 'is-dragging': isDragging, 'is-preview': !isPlayerMode }"
          @pointerdown="startDrag"
          @pointermove="onPointerMove"
          @pointerup="endDrag"
          @pointercancel="endDrag"
          @pointerleave="endDrag"
          @wheel="onWheel"
        >
          <div class="map-hud map-hud-top"><b>{{ isPlayerMode ? "REPLAY" : "PREVIEW" }}</b><span>{{ activeSession && activeSession.status === "recording" ? "录制中" : "历史档案" }}</span><i>/</i><span>{{ activeMapConfig.name }}</span></div>
          <div class="map-grid"></div>
          <div class="replay-map-transform" :style="camera.getTransform()">
            <div class="map-canvas" :style="{ opacity: hasMapResource ? 1 : 0 }">
              <TiledMapRenderer :tile-base-path="activeMapConfig.tileBasePath" :max-zoom="activeMapConfig.maxZoomLevel" :tiles-enabled="hasMapResource" :interaction-active="isDragging" :viewport-width="viewportWidth" :viewport-height="viewportHeight" :fallback-image="activeMapConfig.image" />
            </div>
            <div v-if="!hasMapResource" class="map-placeholder"><span>MAP DATA UNAVAILABLE</span><small>当前录制没有匹配的地图资源</small></div>
            <div class="player-layer">
              <PlayerMarker
                v-for="player in visiblePlayers"
                :key="player.key"
                mode="tactical"
                :player-name="player.name"
                :team-id="player.teamId"
                :map-x="player.mapX"
                :map-y="player.mapY"
                :yaw="player.yaw"
                :health="player.health"
                :squad-id="player.squadId"
                :is-squad-leader="player.isLeader"
                :role-icon="player.roleInfo.icon"
                :role-label="player.roleInfo.label"
                :is-focused="player.key === (selectedPlayer && selectedPlayer.key)"
                :show-name="isPlayerMode"
                :show-coords="false"
                :game-x="player.position && player.position.x"
                :game-y="player.position && player.position.y"
                :scale="playerMarkerScale"
                :compact="true"
                :tone="getReplayPerspectiveTone(player.teamId)"
                @click.stop="selectPlayer(player)"
              />
            </div>
          </div>
          <div class="map-controls" @pointerdown.stop>
            <button type="button" title="放大" @click="zoomBy(1.25)">＋</button>
            <button type="button" title="缩小" @click="zoomBy(0.8)">−</button>
            <button type="button" title="重置视角" @click="resetCamera">⌂</button>
            <div class="marker-size-control" @pointerdown.stop>
              <div class="marker-size-heading"><span>玩家图标</span><output>{{ Math.round(playerMarkerScale * 100) }}%</output></div>
              <input
                v-model.number="playerMarkerScale"
                type="range"
                min="0.4"
                max="1"
                step="0.05"
                aria-label="玩家图标大小"
                title="调整玩家图标大小"
              />
              <div class="marker-size-actions">
                <button type="button" title="缩小玩家图标" @click.stop="adjustPlayerMarkerScale(-0.05)">−</button>
                <button type="button" title="恢复玩家图标大小" @click.stop="resetPlayerMarkerScale">↺</button>
                <button type="button" title="放大玩家图标" @click.stop="adjustPlayerMarkerScale(0.05)">＋</button>
              </div>
            </div>
          </div>
          <div class="map-hud map-hud-bottom"><span>{{ activeSession && activeSession.layer || "NO LAYER" }}</span><i>·</i><span>数据点 {{ state ? formatClock(state.resolvedAtMs) : "--:--" }}</span><span v-if="loadingState" class="state-sync">同步中</span></div>
          <div v-if="loadingState && !state" class="map-loading">正在载入预览状态…</div>
        </div>

        <div v-if="isPlayerMode" class="timeline">
          <div class="timeline-topline"><span class="timeline-caption">时间轴</span><span>{{ formatClock(currentMs) }} / {{ formatClock(durationMs) }}</span></div>
          <input v-model.number="currentMs" class="timeline-range" type="range" min="0" :max="Math.max(1, durationMs)" step="100" :disabled="!activeSession" @pointerdown="beginTimelineSeek" @pointerup="endTimelineSeek" />
          <div class="timeline-controls"><button class="play-button" type="button" :disabled="!activeSession" @click="togglePlaying">{{ playing ? "Ⅱ" : "▶" }}</button><button class="control-button" type="button" :disabled="!activeSession" @click="jump(-10)">−10s</button><button class="control-button" type="button" :disabled="!activeSession" @click="jump(10)">+10s</button><div class="speed-group"><button v-for="speed in speeds" :key="speed" class="speed-button" :class="{ active: playbackRate === speed }" type="button" @click="playbackRate = speed">{{ speed }}×</button></div><span class="timeline-hint">{{ playing ? "正在播放" : "已暂停" }}</span></div>
        </div>
        <div v-else class="preview-timeline">
          <div><span>预览时间点</span><b>{{ formatClock(currentMs) }} / {{ formatClock(durationMs) }}</b></div>
          <input v-model.number="currentMs" class="timeline-range" type="range" min="0" :max="Math.max(1, durationMs)" step="100" :disabled="!activeSession" @pointerdown="beginTimelineSeek" @pointerup="endTimelineSeek" />
          <div class="preview-controls"><button class="play-button" type="button" :disabled="!activeSession" @click="togglePlaying">{{ playing ? "Ⅱ" : "▶" }}</button><button class="control-button" type="button" :disabled="!activeSession" @click="jump(-10)">−10s</button><button class="control-button" type="button" :disabled="!activeSession" @click="jump(10)">+10s</button><div class="speed-group"><button v-for="speed in speeds" :key="speed" class="speed-button" :class="{ active: playbackRate === speed }" type="button" @click="playbackRate = speed">{{ speed }}×</button></div><span class="timeline-hint">{{ playing ? "预览播放中" : "预览已暂停" }}</span></div>
          <p>当前为预览页面：可以播放、拖动、缩放地图和点击玩家；完整高级播放器以后单独设计。</p>
        </div>
      </main>

      <aside v-if="isPlayerMode" class="inspector panel">
        <div class="panel-heading"><div><span class="panel-kicker">AT THIS MOMENT</span><h2>现场摘要</h2></div></div>
        <div class="summary-grid"><div><strong>{{ teamOneCount }}</strong><span>Team 1 玩家</span></div><div><strong>{{ teamTwoCount }}</strong><span>Team 2 玩家</span></div></div>
        <div class="inspector-divider"></div>
        <div v-if="selectedPlayer" class="selected-player">
          <div class="selected-top"><span class="large-pip" :class="'team-' + (selectedPlayer.teamId || 0)"></span><div><span class="panel-kicker">SELECTED UNIT</span><h3>{{ selectedPlayer.name }}</h3></div></div>
          <dl class="detail-list"><div><dt>阵营</dt><dd>Team {{ selectedPlayer.teamId || "--" }}</dd></div><div><dt>小队</dt><dd>{{ selectedPlayer.squadId || "--" }}</dd></div><div><dt>职业</dt><dd>{{ selectedPlayer.role || "未记录" }}</dd></div><div><dt>生命</dt><dd>{{ selectedPlayer.health == null ? "--" : Math.round(selectedPlayer.health * 100) + "%" }}</dd></div><div><dt>延迟</dt><dd>{{ selectedPlayer.ping == null ? "--" : selectedPlayer.ping + " ms" }}</dd></div><div><dt>K / W / D</dt><dd>{{ selectedPlayer.kills ?? "--" }} / {{ selectedPlayer.wounds ?? "--" }} / {{ selectedPlayer.deaths ?? "--" }}</dd></div><div><dt>坐标</dt><dd>{{ selectedPlayer.positionText }}</dd></div></dl>
        </div>
        <div v-else class="inspector-placeholder"><span>◎</span><p>点击地图上的单位</p><small>查看该时刻的玩家状态</small></div>
        <div class="inspector-footer"><span class="health-dot"></span><span>状态来自 .rps 增量记录</span></div>
      </aside>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiGet } from "../app/apiClient";
import TiledMapRenderer from "../components/tactical-map/TiledMapRenderer.vue";
import PlayerMarker from "../components/tactical-map/PlayerMarker.vue";
import { provideTacticalMapViewport } from "../composables/tacticalMapViewport";
import { useMapCamera } from "../composables/useMapCamera";
import { EMPTY_TACTICAL_MAP_CONFIG, TACTICAL_MAP_CONFIGS, resolveTacticalMapKey } from "../shared/tactical-map-data";
import { resolveRoleIcon, type RoleIconInfo } from "../utils/role-icons";

interface ReplaySession { id: string; map?: string; layer?: string; status?: string; durationMs?: number; startedAt?: string; isPlayable?: boolean; archiveError?: string; }
interface ReplayPosition { x: number; y: number; z?: number; }
interface ReplayPlayer { key: string; name: string; teamId: number | null; squadId: number | null; role: string; roleInfo: RoleIconInfo; isLeader: boolean; health: number | null; ping: number | null; kills: number | null; wounds: number | null; deaths: number | null; yaw: number | null; position: ReplayPosition | null; positionText: string; mapX: number; mapY: number; hasPosition: boolean; }

const sessions = ref<ReplaySession[]>([]);
const route = useRoute();
const router = useRouter();
const isPlayerMode = computed(() => route.name === "tactical-replay-player");
const activeSession = ref<ReplaySession | null>(null);
const state = ref<Record<string, any> | null>(null);
const status = ref<Record<string, any> | null>(null);
const selectedPlayer = ref<ReplayPlayer | null>(null);
const searchText = ref("");
const currentMs = ref(0);
const playing = ref(false);
const playbackRate = ref(1);
const DEFAULT_PLAYER_MARKER_SCALE = 0.8;
const playerMarkerScale = ref(DEFAULT_PLAYER_MARKER_SCALE);
const loadingSessions = ref(false);
const loadingState = ref(false);
const errorText = ref("");
const speeds = [0.5, 1, 2, 4, 10, 20, 40];
const replayViewportRef = ref<HTMLElement | null>(null);
const viewportWidth = ref(0);
const viewportHeight = ref(0);
const camera = useMapCamera();
const isDragging = camera.isDragging;
const dragMoved = ref(false);
let resizeObserver: ResizeObserver | null = null;
let animationTimer: ReturnType<typeof setInterval> | null = null;
let playbackLastTickAt = 0;
let seekTimer: ReturnType<typeof setTimeout> | null = null;
let stateAbortController: AbortController | null = null;
let stateRequestSequence = 0;
let lastStateRequestStartedAt = -Infinity;
let stateLoadInFlight = false;
let stateLoadToken = 0;
let queuedStateAt: number | null = null;
const STATE_LOAD_INTERVAL_MS = 260;
const MANUAL_SEEK_DELAY_MS = 140;

const filteredSessions = computed(() => {
  const query = searchText.value.trim().toLocaleLowerCase();
  return query ? sessions.value.filter((item) => (String(item.map || "") + " " + String(item.layer || "")).toLocaleLowerCase().includes(query)) : sessions.value;
});
const archiveRootDir = computed(() => String(status.value && status.value.rootDir || ""));
const durationMs = computed(() => Math.max(1, Number((activeSession.value && activeSession.value.durationMs) || (state.value && state.value.session && state.value.session.durationMs) || 1)));
const activeMapConfig = computed(() => {
  const source = (activeSession.value && activeSession.value.map) || (state.value && state.value.state && state.value.state.server && state.value.state.server.map) || (activeSession.value && activeSession.value.layer) || "";
  const key = resolveTacticalMapKey(source);
  return (key && TACTICAL_MAP_CONFIGS[key]) || EMPTY_TACTICAL_MAP_CONFIG;
});
const hasMapResource = computed(() => Boolean(activeMapConfig.value.tileBasePath || activeMapConfig.value.image));
const currentSnapshot = computed(() => state.value && state.value.state || null);
const rawPlayers = computed<any[]>(() => Array.isArray(currentSnapshot.value && currentSnapshot.value.players) ? currentSnapshot.value.players : []);
const replayNameCache = new Map<string, string>();
const visiblePlayers = computed<ReplayPlayer[]>(() => rawPlayers.value.map(normalizePlayer).filter((item: ReplayPlayer) => item.hasPosition));
const teamOneCount = computed(() => visiblePlayers.value.filter((item: ReplayPlayer) => item.teamId === 1).length);
const teamTwoCount = computed(() => visiblePlayers.value.filter((item: ReplayPlayer) => item.teamId === 2).length);

provideTacticalMapViewport({ zoom: camera.zoom, panX: camera.x, panY: camera.y });

function normalizePlayer(source: any): ReplayPlayer {
  const identity = source && source.identity || {};
  const position = source && source.telemetry && source.telemetry.position || source && source.position;
  const health = numberOrNull(source && source.telemetry && source.telemetry.health);
  const role = String(source && source.match && source.match.role || source && source.telemetry && source.telemetry.soldierClass || "");
  // 回放当前阶段只显示玩家，始终使用玩家职业图标，不渲染或替换为载具图标。
  const roleInfo = health != null && health <= 0
    ? resolveRoleIcon("dead")
    : resolveRoleIcon(role);
  const hasPosition = Boolean(position && Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.y)));
  const bounds = activeMapConfig.value.bounds;
  const key = resolveReplayPlayerKey(source, identity);
  return {
    key,
    name: resolveReplayPlayerName(source, identity, key),
    teamId: numberOrNull(source && source.match && source.match.teamId),
    squadId: numberOrNull(source && source.match && source.match.squadId),
    role,
    roleInfo,
    isLeader: source && source.match && source.match.isLeader === true,
    health,
    ping: numberOrNull(source && source.network && source.network.gamePing),
    kills: numberOrNull(source && source.combat && source.combat.kills),
    wounds: numberOrNull(source && source.combat && source.combat.wounds),
    deaths: numberOrNull(source && source.combat && source.combat.deaths),
    yaw: numberOrNull(source && source.telemetry && source.telemetry.yaw),
    position,
    positionText: position ? round(position.x) + ", " + round(position.y) : "--",
    mapX: project(Number(position && position.x), bounds.minX, bounds.maxX),
    mapY: project(Number(position && position.y), bounds.minY, bounds.maxY),
    hasPosition,
  };
}

function resolveReplayPlayerKey(source: any, identity: any) {
  return firstReplayText(
    identity && (identity.key || identity.steamID || identity.eosID || identity.playerID)
      || source && (source.key || source.playerID || source.id)
  ) || "anonymous-player";
}

function resolveReplayPlayerName(source: any, identity: any, key: string) {
  const candidates = [
    identity && (identity.name || identity.displayName || identity.playerName),
    source && (source.name || source.displayName || source.playerName),
    identity && (identity.steamID || identity.eosID),
  ];
  const name = candidates.map(firstReplayText).find(Boolean);
  if (name && !isGenericReplayName(name)) {
    replayNameCache.set(key, name);
    return name;
  }
  return replayNameCache.get(key) || "Player " + key;
}

function firstReplayText(value: any) {
  const result = String(value ?? "").trim();
  return result && !/^(undefined|null|n\/a)$/i.test(result) ? result : "";
}

function isGenericReplayName(value: string) {
  return /^(unknown(?:\s+player)?|player\s+unknown)$/i.test(value.trim());
}
function project(value: number, min: number, max: number) { if (!Number.isFinite(value) || max <= min) return 50; return Math.min(98, Math.max(2, ((value - min) / (max - min)) * 100)); }
function numberOrNull(value: any) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function round(value: any) { const n = Number(value); return Number.isFinite(n) ? Math.round(n) : "--"; }
function formatClock(value: any) { const total = Math.max(0, Math.floor(Number(value || 0) / 1000)); return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0"); }
function formatDuration(value: any) { return Number(value) > 0 ? formatClock(value) : "--:--"; }
function formatDate(value: any) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "未知时间" : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }

function updateViewportSize() {
  const element = replayViewportRef.value;
  if (!element) return;
  viewportWidth.value = element.clientWidth;
  viewportHeight.value = element.clientHeight;
  if (!isDragging.value && (!isPlayerMode.value || (camera.zoom.value === 1 && camera.x.value === 0 && camera.y.value === 0))) resetCamera();
}
function resetCamera() {
  const mapSize = 1000;
  const zoom = isPlayerMode.value
    ? 1
    : Math.max(0.2, Math.min(0.72, Math.min(viewportWidth.value, viewportHeight.value) / mapSize * 0.94));
  camera.zoom.value = zoom;
  camera.x.value = (viewportWidth.value - mapSize * zoom) / 2;
  camera.y.value = (viewportHeight.value - mapSize * zoom) / 2;
}
function zoomBy(factor: number) {
  const next = Math.min(isPlayerMode.value ? 8 : 3.5, Math.max(0.2, camera.zoom.value * factor));
  camera.setZoom(next, viewportWidth.value / 2, viewportHeight.value / 2);
}
function adjustPlayerMarkerScale(delta: number) {
  const next = Math.round((playerMarkerScale.value + delta) * 20) / 20;
  playerMarkerScale.value = Math.min(1, Math.max(0.4, next));
}
function resetPlayerMarkerScale() {
  playerMarkerScale.value = DEFAULT_PLAYER_MARKER_SCALE;
}
function onWheel(event: WheelEvent) {
  event.preventDefault();
  zoomBy(event.deltaY < 0 ? 1.12 : 0.89);
}
function startDrag(event: PointerEvent) {
  if (event.button !== 0) return;
  dragMoved.value = false;
  (event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId);
  camera.startDrag(event.clientX, event.clientY);
}
function onPointerMove(event: PointerEvent) {
  if (!isDragging.value) return;
  if (Math.abs(event.movementX) + Math.abs(event.movementY) > 0) dragMoved.value = true;
  camera.onDrag(event.clientX, event.clientY);
}
function endDrag(event?: PointerEvent) {
  if (event && (event.currentTarget as HTMLElement)?.hasPointerCapture?.(event.pointerId)) {
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }
  camera.endDrag();
}
function selectPlayer(player: ReplayPlayer) {
  if (dragMoved.value) { dragMoved.value = false; return; }
  selectedPlayer.value = player;
}

function backToWorkbench() {
  playing.value = false;
  if (animationTimer) clearInterval(animationTimer);
  animationTimer = null;
  playbackLastTickAt = 0;
  void router.push({ name: "tactical-replay" });
}

function getReplayPerspectiveTone(teamId: number | null): "friendly" | "enemy" | "neutral" {
  if (teamId === 1) return "friendly";
  if (teamId === 2) return "enemy";
  return "neutral";
}

function scheduleStateLoad() {
  if (!activeSession.value) return;
  queuedStateAt = Math.max(0, Math.round(currentMs.value));
  if (stateLoadInFlight) return;
  if (!playing.value && seekTimer) {
    clearTimeout(seekTimer);
    seekTimer = null;
  } else if (seekTimer) return;
  // Playback uses a throttle. Manual timeline dragging uses a short debounce,
  // so crossing many pixels does not start one reconstruction per pixel.
  const interval = playing.value ? STATE_LOAD_INTERVAL_MS : MANUAL_SEEK_DELAY_MS;
  const delay = playing.value
    ? Math.max(0, interval - (performance.now() - lastStateRequestStartedAt))
    : interval;
  seekTimer = setTimeout(() => {
    seekTimer = null;
    void drainStateLoad();
  }, delay);
}
async function drainStateLoad() {
  if (stateLoadInFlight || queuedStateAt == null || !activeSession.value) return;
  const atMs = queuedStateAt;
  queuedStateAt = null;
  const loadToken = ++stateLoadToken;
  stateLoadInFlight = true;
  try {
    await loadState(atMs);
  } finally {
    if (loadToken === stateLoadToken) {
      stateLoadInFlight = false;
      if (queuedStateAt != null) scheduleStateLoad();
    }
  }
}
async function loadSessions() {
  loadingSessions.value = true;
  errorText.value = "";
  try {
    const response = await apiGet<any>("/api/tactical-replay/sessions?limit=100");
    sessions.value = Array.isArray(response && response.sessions) ? response.sessions : [];
    const routeSessionId = String(route.params.sessionId || "");
    const selected = sessions.value.find((item) => item.id === routeSessionId)
      || sessions.value.find((item) => item.id === (activeSession.value && activeSession.value.id))
      || sessions.value[0]
      || null;
    // Refreshing the archive list must not reset the currently displayed
    // scene. Only a genuinely different selection needs a new state read.
    if (selected && selected.id !== activeSession.value?.id) await selectSession(selected);
    else if (selected && activeSession.value) activeSession.value = { ...activeSession.value, ...selected };
  } catch (error: any) { errorText.value = error && error.message || "无法读取回放档案"; }
  finally { loadingSessions.value = false; }
}
async function selectSession(session: ReplaySession) {
  if (session.isPlayable === false) return;
  playing.value = false;
  activeSession.value = session;
  const requestedAt = isPlayerMode.value ? Number(route.query.at) : 0;
  currentMs.value = Number.isFinite(requestedAt) ? Math.max(0, requestedAt) : 0;
  stateRequestSequence += 1;
  stateAbortController?.abort();
  stateAbortController = null;
  state.value = null;
  queuedStateAt = null;
  if (seekTimer) { clearTimeout(seekTimer); seekTimer = null; }
  lastStateRequestStartedAt = -Infinity;
  selectedPlayer.value = null;
  replayNameCache.clear();
  const loadToken = ++stateLoadToken;
  stateLoadInFlight = true;
  try {
    await loadState(currentMs.value);
  } finally {
    if (loadToken === stateLoadToken) {
      stateLoadInFlight = false;
      queuedStateAt = null;
      if (seekTimer) { clearTimeout(seekTimer); seekTimer = null; }
    }
  }
}
async function loadState(atMs: number) {
  if (!activeSession.value) return;
  const sessionId = activeSession.value.id;
  const requestSequence = ++stateRequestSequence;
  const controller = new AbortController();
  stateAbortController = controller;
  lastStateRequestStartedAt = performance.now();
  loadingState.value = true;
  try {
    const response = await apiGet<any>("/api/tactical-replay/sessions/" + encodeURIComponent(sessionId) + "/state?at=" + Math.max(0, Math.round(atMs)), { signal: controller.signal });
    if (requestSequence !== stateRequestSequence || activeSession.value?.id !== sessionId) return;
    state.value = response;
  } catch (error: any) {
    if (controller.signal.aborted) return;
    errorText.value = error && error.message || "无法重建回放状态";
  } finally {
    if (requestSequence === stateRequestSequence) loadingState.value = false;
  }
}
function togglePlaying() {
  if (!activeSession.value) return;
  playing.value = !playing.value;
  if (!playing.value) { if (animationTimer) clearInterval(animationTimer); animationTimer = null; playbackLastTickAt = 0; return; }
  if (currentMs.value >= durationMs.value) currentMs.value = 0;
  if (animationTimer) clearInterval(animationTimer);
  playbackLastTickAt = performance.now();
  animationTimer = setInterval(() => {
    const now = performance.now();
    const elapsedMs = Math.min(500, Math.max(0, now - playbackLastTickAt || 100));
    playbackLastTickAt = now;
    const next = currentMs.value + elapsedMs * playbackRate.value;
    if (next >= durationMs.value) {
      currentMs.value = durationMs.value;
      playing.value = false;
      if (animationTimer) clearInterval(animationTimer);
      animationTimer = null;
      playbackLastTickAt = 0;
    } else currentMs.value = next;
  }, 100);
}
function jump(seconds: number) { currentMs.value = Math.min(durationMs.value, Math.max(0, currentMs.value + seconds * 1000)); }
function beginTimelineSeek() {
  if (playing.value) playing.value = false;
  if (animationTimer) { clearInterval(animationTimer); animationTimer = null; }
  playbackLastTickAt = 0;
}
function endTimelineSeek() {
  scheduleStateLoad();
}
watch(currentMs, scheduleStateLoad);
watch(activeMapConfig, () => { void nextTick(updateViewportSize); });
watch(isPlayerMode, () => { void nextTick(resetCamera); });
watch(() => route.params.sessionId, (sessionId) => {
  const next = sessions.value.find((item) => item.id === String(sessionId || ""));
  if (next && next.id !== activeSession.value?.id) void selectSession(next);
});
onMounted(async () => {
  resizeObserver = new ResizeObserver(updateViewportSize);
  if (replayViewportRef.value) resizeObserver.observe(replayViewportRef.value);
  updateViewportSize();
  try { const response = await apiGet<any>("/api/tactical-replay/status"); status.value = response && response.status || null; } catch { status.value = null; }
  await loadSessions();
});
onBeforeUnmount(() => { stateLoadToken += 1; playbackLastTickAt = 0; if (animationTimer) clearInterval(animationTimer); if (seekTimer) clearTimeout(seekTimer); stateAbortController?.abort(); stateAbortController = null; resizeObserver?.disconnect(); resizeObserver = null; });
</script>

<style scoped>
:global(body) { background: #07111f; }
.replay-workbench { min-height: 100%; padding: 26px 30px 34px; color: #e8f0fb; background: radial-gradient(circle at 18% 0%, rgba(22,101,137,.2), transparent 35%), #07111f; }
.replay-header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 24px; }
.eyebrow, .panel-kicker { color: #6f9bb5; font-size: 10px; letter-spacing: .18em; font-weight: 700; }
.replay-header h1 { margin: 7px 0 8px; font-size: clamp(24px, 3vw, 38px); letter-spacing: -.04em; }
.subtitle { color: #83a0b7; margin: 0; max-width: 690px; line-height: 1.6; font-size: 13px; }
.header-actions { display: flex; align-items: center; gap: 10px; }
.source-chip, .ghost-button, .primary-button, .control-button, .speed-button, .play-button { border: 1px solid rgba(150,190,211,.2); border-radius: 10px; color: #cfe1ee; background: rgba(13,30,48,.8); }
.source-chip { padding: 9px 12px; font-size: 12px; white-space: nowrap; }
.source-chip.live { color: #8cf0c1; border-color: rgba(73,214,151,.35); }
.source-chip i, .health-dot, .session-status { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #74879c; margin-right: 7px; }
.source-chip.live i { background: #40dfa0; box-shadow: 0 0 12px #40dfa0; }
.ghost-button, .primary-button, .control-button, .speed-button { padding: 9px 12px; cursor: pointer; }
.primary-button { background: #2ec98b; color: #062117; border-color: #2ec98b; font-weight: 700; }
.archive-path { display: block; max-width: min(100%, 720px); margin: 12px auto; overflow: auto; padding: 8px 10px; border: 1px solid rgba(150,190,211,.14); border-radius: 7px; color: #89a9b9; background: rgba(4,15,26,.45); font-size: 11px; text-align: left; }
.error-banner { padding: 12px 14px; margin-bottom: 18px; color: #ffc5c5; border: 1px solid rgba(248,113,113,.3); background: rgba(127,29,29,.2); border-radius: 10px; }
.panel { border: 1px solid rgba(141,182,205,.14); background: linear-gradient(145deg, rgba(16,35,54,.96), rgba(8,20,34,.96)); box-shadow: 0 24px 80px rgba(0,0,0,.2); border-radius: 16px; }
.replay-grid { display: grid; grid-template-columns: minmax(250px, 320px) minmax(0, 1fr); gap: 15px; align-items: start; min-height: 650px; }
.is-player-mode .replay-grid { grid-template-columns: 235px minmax(0,1fr) 245px; }
.session-rail, .inspector { padding: 16px; min-height: 640px; }
.session-rail { position: sticky; top: 14px; }
.panel-heading, .stage-heading, .timeline-topline, .timeline-controls, .selected-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.panel-heading h2, .stage-heading h2 { margin: 5px 0 0; font-size: 17px; }
.count-badge { min-width: 25px; padding: 4px 7px; text-align: center; border-radius: 7px; background: rgba(65,151,191,.18); color: #9bcee2; font-size: 12px; }
.search-box { display: flex; gap: 8px; align-items: center; padding: 9px 10px; margin: 17px 0 12px; border: 1px solid rgba(150,190,211,.14); border-radius: 9px; color: #7a9ab0; background: rgba(5,15,26,.5); }
.search-box input { width: 100%; border: 0; outline: 0; color: #e8f0fb; background: transparent; font-size: 12px; }
.session-list { display: grid; gap: 7px; max-height: calc(100vh - 300px); overflow: auto; }
.session-card { display: grid; grid-template-columns: 8px minmax(0,1fr) auto; gap: 9px; width: 100%; padding: 11px 9px; text-align: left; color: #bad0df; border: 1px solid transparent; border-radius: 10px; background: rgba(4,13,24,.34); cursor: pointer; }
.session-card:hover, .session-card.selected { border-color: rgba(71,211,165,.45); background: rgba(23,81,79,.25); }
.session-card.unreadable { cursor: not-allowed; opacity: .58; }
.session-card.unreadable:hover { border-color: rgba(248,113,113,.45); background: rgba(127,29,29,.18); }
.session-status { margin: 4px 0 0; background: #718298; }
.session-status.recording { background: #40dfa0; box-shadow: 0 0 8px #40dfa0; }
.session-body { min-width: 0; display: grid; gap: 4px; }
.session-card strong { overflow: hidden; color: #f2f7fb; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.session-card small { overflow: hidden; color: #7c9aaf; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.session-card em { display: flex; justify-content: space-between; color: #6c879a; font-size: 10px; font-style: normal; }
.session-arrow { color: #5e879d; font-size: 20px; }
.muted-empty, .inspector-placeholder { color: #6f8b9e; font-size: 12px; text-align: center; }
.stage { min-width: 0; padding: 18px; }
.stage-layer { display: inline-block; margin-top: 7px; color: #7697ab; font-size: 11px; }
.stage-metrics { display: flex; gap: 18px; }
.stage-metrics span { display: grid; gap: 3px; text-align: right; }
.stage-metrics b { color: #eaf7f5; font-size: 16px; }
.stage-metrics small { color: #6f8d9e; font-size: 10px; }
.session-overview { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) auto; gap: 8px; margin-top: 16px; padding: 10px; border: 1px solid rgba(136,190,205,.13); border-radius: 11px; background: rgba(4,15,26,.38); }
.session-overview > span { display: grid; gap: 4px; min-width: 0; padding: 5px 7px; }
.session-overview small { color: #6e8c9e; font-size: 10px; }
.session-overview b { overflow: hidden; color: #dcecf2; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.session-overview b.recording { color: #72e5b6; }
.map-shell { position: relative; min-height: 355px; margin-top: 15px; overflow: hidden; border: 1px solid rgba(164,209,224,.18); border-radius: 12px; background: #081827; cursor: grab; touch-action: none; user-select: none; }
.is-player-mode .map-shell { min-height: 540px; }
.map-shell.is-preview { cursor: grab; touch-action: none; background: #061420; }
.map-shell.is-dragging { cursor: grabbing; }
.replay-map-transform { position: absolute; top: 0; left: 0; width: 1000px; height: 1000px; transform-origin: 0 0; will-change: transform; z-index: 2; background: #020205; }
.map-grid { position: absolute; inset: 0; z-index: 1; pointer-events: none; opacity: .22; background-image: linear-gradient(rgba(120,183,203,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(120,183,203,.12) 1px, transparent 1px); background-size: 64px 64px; }
.map-canvas { position: absolute; inset: 0; z-index: 0; transition: opacity .2s; }
.map-placeholder { position: absolute; inset: 0; z-index: 2; display: grid; place-content: center; gap: 8px; text-align: center; color: #7498ab; letter-spacing: .12em; font-size: 12px; }
.map-placeholder small { letter-spacing: 0; color: #547384; font-size: 11px; }
.map-hud { position: absolute; z-index: 10; display: flex; gap: 8px; align-items: center; padding: 8px 10px; border: 1px solid rgba(159,210,224,.18); background: rgba(4,16,28,.75); color: #aacbd6; font-size: 10px; backdrop-filter: blur(8px); }
.map-hud-top { top: 12px; left: 12px; border-radius: 7px; }
.map-hud-bottom { right: 12px; bottom: 12px; border-radius: 7px; }
.map-hud b, .timeline-caption { color: #55ddb6; letter-spacing: .12em; }
.map-hud i { color: #507080; font-style: normal; }
.state-sync { color: #f6c76a; }
.player-layer { position: absolute; inset: 0; z-index: 5; pointer-events: none; }
.map-loading { position: absolute; inset: 0; z-index: 20; display: grid; place-items: center; color: #b8d5df; background: rgba(4,15,26,.35); backdrop-filter: blur(2px); font-size: 12px; }
.map-controls { position: absolute; z-index: 12; right: 12px; top: 12px; display: grid; gap: 5px; }
.map-controls button { width: 30px; height: 30px; border: 1px solid rgba(159,210,224,.2); border-radius: 7px; color: #bfeaf0; background: rgba(4,16,28,.78); cursor: pointer; font-size: 16px; }
.map-controls button:hover { color: #fff; border-color: rgba(85,221,182,.7); background: rgba(24,92,83,.75); }
.marker-size-control { width: 86px; padding: 7px; border: 1px solid rgba(159,210,224,.2); border-radius: 7px; color: #91adba; background: rgba(4,16,28,.88); box-shadow: 0 8px 18px rgba(0,0,0,.22); }
.marker-size-heading { display: flex; justify-content: space-between; gap: 5px; margin-bottom: 5px; font-size: 9px; }
.marker-size-heading output { color: #bfeaf0; font-family: monospace; }
.marker-size-control input[type="range"] { display: block; width: 100%; height: 12px; margin: 0; accent-color: #40dfa0; cursor: pointer; }
.marker-size-actions { display: flex; justify-content: space-between; gap: 4px; margin-top: 4px; }
.marker-size-actions button { width: 22px; height: 20px; min-height: 20px; padding: 0; font-size: 12px; }
.timeline { margin-top: 15px; padding: 13px 3px 2px; }
.timeline-topline { color: #9ab4c0; font-size: 11px; }
.timeline-range { width: 100%; margin: 13px 0 11px; accent-color: #3ed9a1; cursor: pointer; }
.timeline-controls { justify-content: flex-start; }
.preview-controls { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.play-button { width: 34px; height: 32px; padding: 0; color: #062117; background: #43dca5; border-color: #43dca5; font-weight: 800; cursor: pointer; }
.control-button, .speed-button { color: #9db9c6; background: rgba(6,19,32,.72); font-size: 11px; }
.speed-group { display: flex; gap: 4px; margin-left: auto; }
.speed-button { padding: 6px 8px; }
.speed-button.active { color: #071b18; border-color: #40dfa0; background: #40dfa0; }
.timeline-hint { color: #668697; font-size: 10px; }
.preview-timeline { display: grid; gap: 2px; padding: 11px 3px 0; }
.preview-timeline > div { display: flex; justify-content: space-between; color: #7393a4; font-size: 11px; }
.preview-timeline b { color: #bcd6df; font-weight: 600; }
.preview-timeline p { margin: 0; color: #577588; font-size: 10px; }
.summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 17px; }
.summary-grid div { display: grid; gap: 4px; padding: 11px 10px; border-radius: 9px; background: rgba(5,17,29,.5); }
.summary-grid strong { color: #ecfafa; font-size: 20px; }
.summary-grid span { color: #7592a3; font-size: 10px; }
.inspector-divider { height: 1px; margin: 18px 0; background: rgba(150,190,211,.12); }
.selected-top { justify-content: flex-start; }
.large-pip { width: 19px; height: 19px; flex: 0 0 auto; border-radius: 50%; background: #49c9ff; box-shadow: 0 0 16px rgba(73,201,255,.45); }
.large-pip.team-2 { background: #ff6572; box-shadow: 0 0 16px rgba(255,101,114,.4); }
.selected-player h3 { margin: 4px 0 0; color: #f1fbff; font-size: 15px; }
.detail-list { display: grid; gap: 8px; margin: 18px 0; }
.detail-list div { display: flex; justify-content: space-between; gap: 8px; color: #7897a7; font-size: 11px; }
.detail-list dd { margin: 0; color: #d0e4ed; text-align: right; }
.inspector-placeholder { display: grid; place-items: center; gap: 7px; min-height: 270px; }
.inspector-placeholder span { color: #4cd8aa; font-size: 30px; }
.inspector-placeholder p { margin: 0; color: #b6ced8; }
.inspector-placeholder small { color: #648293; }
.inspector-footer { display: flex; align-items: center; margin-top: auto; padding-top: 14px; color: #688799; font-size: 10px; }
.health-dot { margin: 0 6px 0 0; background: #43dca5; box-shadow: 0 0 8px #43dca5; }
.empty-state { display: grid; place-items: center; gap: 10px; min-height: 60vh; text-align: center; border: 1px dashed rgba(126,178,198,.25); border-radius: 16px; background: rgba(9,25,41,.65); }
.empty-icon { color: #55ddb6; font-size: 48px; }
.empty-state h2 { margin: 0; font-size: 20px; }
.empty-state p { margin: 0 0 8px; color: #7897a7; font-size: 13px; }
@media (max-width: 1200px) { .is-player-mode .replay-grid { grid-template-columns: 210px minmax(0,1fr); } .is-player-mode .inspector { grid-column: 1 / -1; min-height: auto; } .inspector-placeholder { min-height: 100px; } .session-overview { grid-template-columns: repeat(3, minmax(0,1fr)); } }
@media (max-width: 800px) { .replay-workbench { padding: 18px 12px 24px; } .replay-header { display: grid; } .header-actions { justify-content: space-between; } .replay-grid, .is-player-mode .replay-grid { display: block; } .session-rail { position: static; } .session-rail, .stage, .inspector { min-height: auto; margin-bottom: 12px; } .session-list { max-height: 260px; } .map-shell, .is-player-mode .map-shell { min-height: 350px; } .stage-metrics { gap: 8px; } .session-overview { grid-template-columns: 1fr 1fr; } .session-overview > span:last-of-type { grid-column: 1 / -1; } }
</style>
