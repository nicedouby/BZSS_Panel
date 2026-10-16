<template>
  <div class="replay-workbench">
    <div v-if="errorText" class="error-banner">{{ errorText }}</div>

    <div v-if="!sessions.length && !loadingSessions" class="empty-state">
      <div class="empty-icon">◷</div>
      <h2>还没有可播放的战术录制</h2>
      <p>请先在实时战术地图打开录制。录制结束后，档案会出现在左侧档案列表中。</p>
      <code v-if="archiveRootDir" class="archive-path">{{ archiveRootDir }}</code>
      <button class="primary-button" type="button" @click="loadSessions">重新扫描</button>
    </div>

    <section v-else class="replay-layout">
      <!-- 左侧：录制档案文件夹列表 -->
      <aside class="session-rail panel">
        <div class="panel-heading">
          <div class="panel-title-wrap">
            <h2>战术回放档案</h2>
            <span class="count-badge">{{ filteredSessions.length }} / {{ sessions.length }}</span>
          </div>
          <button class="ghost-button sm" type="button" :disabled="loadingSessions" @click="loadSessions">
            {{ loadingSessions ? "刷新中" : "刷新" }}
          </button>
        </div>
        <div class="archive-tools">
          <label class="search-box">
            <span>⌕</span>
            <input v-model="searchText" type="search" placeholder="搜索地图/图层" />
          </label>
          <select v-model="durationFilter" class="duration-select">
            <option value="all">时长: 全部</option>
            <option value="short">&lt; 1 分钟</option>
            <option value="1-5">1–5 分钟</option>
            <option value="5-15">5–15 分钟</option>
            <option value="15-30">15–30 分钟</option>
            <option value="long">&gt; 30 分钟</option>
          </select>
        </div>
        <div class="session-list">
          <div
            v-for="item in filteredSessions"
            :key="item.id"
            class="session-card"
            :class="{ selected: item.id === (activeSession && activeSession.id), unreadable: item.isPlayable === false }"
          >
            <button type="button" class="session-select" :disabled="item.isPlayable === false" @click="selectSession(item)">
              <span class="session-status" :class="item.status"></span>
              <span class="session-body">
                <strong>{{ item.map || (item.isPlayable === false ? "异常档案" : "未知地图") }}</strong>
                <small>{{ item.archiveError || item.layer || "未记录图层" }}</small>
                <em>
                  <span>{{ formatDate(item.startedAt) }}</span>
                  <span>{{ formatDuration(item.durationMs) }} · {{ formatBytes(item.sizeBytes) }}</span>
                </em>
              </span>
              <span class="session-arrow">›</span>
            </button>
            <button
              v-if="item.status !== 'recording' && item.isPlayable !== false"
              type="button"
              class="delete-session-button"
              title="删除此快照"
              aria-label="删除此快照"
              @click.stop="deleteSession(item)"
            >
              ×
            </button>
          </div>
          <p v-if="!filteredSessions.length" class="muted-empty">没有匹配的档案</p>
        </div>
      </aside>

      <!-- 中间：轻量化战术地图播放器 (地图 Shell + 底部控制条) -->
      <main class="stage panel">
        <div
          ref="replayViewportRef"
          class="map-shell"
          :class="{ 'is-dragging': isDragging, 'is-following': isFollowingPlayer }"
          @pointerdown="startDrag"
          @pointermove="onPointerMove"
          @pointerup="endDrag"
          @pointercancel="endDrag"
          @pointerleave="endDrag"
          @wheel="onWheel"
        >
          <!-- 嵌入式顶部 HUD 栏 -->
          <div class="map-hud map-hud-top">
            <div class="hud-left">
              <b class="hud-tag">REPLAY</b>
              <span class="hud-map-name">{{ activeSession && activeSession.map || activeMapConfig.name }}</span>
              <span class="hud-layer-name">{{ activeSession && activeSession.layer || "NO LAYER" }}</span>
              <span v-if="isFollowingPlayer && selectedPlayer" class="follow-badge">🎯 跟随: {{ selectedPlayer.name }}</span>
            </div>
            <div class="hud-right">
              <span class="hud-players"><b>{{ visiblePlayers.length }}</b> 场上玩家</span>
              <span class="source-chip" :class="{ live: status && status.enabled }">
                <i></i>{{ status && status.enabled ? "在线" : "未启动" }}
              </span>
            </div>
          </div>

          <div class="map-grid"></div>
          <div class="replay-map-transform" :style="camera.getTransform()">
            <div class="map-canvas" :style="{ opacity: hasMapResource ? 1 : 0 }">
              <TiledMapRenderer
                :tile-base-path="activeMapConfig.tileBasePath"
                :max-zoom="activeMapConfig.maxZoomLevel"
                :tiles-enabled="hasMapResource"
                :interaction-active="isDragging"
                :viewport-width="viewportWidth"
                :viewport-height="viewportHeight"
                :fallback-image="activeMapConfig.image"
              />
            </div>
            <div v-if="!hasMapResource" class="map-placeholder">
              <span>MAP DATA UNAVAILABLE</span>
              <small>当前录制没有匹配的地图资源</small>
            </div>
            <PressureZoneOverlay
              :state="replayPressureZoneState"
              :map-bounds="activeMapConfig.bounds"
              :visible="showPressureZones"
            />
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
                :show-name="true"
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

          <!-- 地图悬浮缩放与跟随控件 -->
          <div class="map-controls" @pointerdown.stop>
            <button type="button" title="放大 (+)" @click="zoomBy(1.25)">＋</button>
            <button type="button" title="缩小 (-)" @click="zoomBy(0.8)">−</button>
            <button type="button" title="重置视角 (R)" @click="resetCamera">⌂</button>
            <button
              type="button"
              class="pressure-zone-button"
              :class="{ active: showPressureZones }"
              :disabled="!replayPressureZoneState"
              :title="showPressureZones ? '隐藏历史压家圈' : '显示历史压家圈'"
              @click="showPressureZones = !showPressureZones"
            >⚡</button>
            <button
              v-if="selectedPlayer"
              type="button"
              class="follow-button"
              :class="{ active: isFollowingPlayer }"
              :title="isFollowingPlayer ? '取消视角锁定 (F)' : '锁定视角跟随该玩家 (F)'"
              @click="toggleFollowPlayer"
            >
              🎯
            </button>
            <div class="marker-size-control" @pointerdown.stop>
              <div class="marker-size-heading"><span>图标</span><output>{{ Math.round(playerMarkerScale * 100) }}%</output></div>
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
                <button type="button" title="缩小" @click.stop="adjustPlayerMarkerScale(-0.05)">−</button>
                <button type="button" title="重置" @click.stop="resetPlayerMarkerScale">↺</button>
                <button type="button" title="放大" @click.stop="adjustPlayerMarkerScale(0.05)">＋</button>
              </div>
            </div>
          </div>

          <div v-if="loadingState && !state" class="map-loading">正在载入回放状态…</div>
        </div>

        <!-- 重构：一体化紧凑底部播放控制面板 -->
        <div class="timeline-bar">
          <div class="timeline-main-row">
            <div class="playback-btn-group">
              <button class="play-button" type="button" :disabled="!activeSession" @click="togglePlaying">{{ playing ? "Ⅱ" : "▶" }}</button>
              <button class="control-button" type="button" :disabled="!activeSession" @click="jump(-15)">−15s</button>
              <button class="control-button" type="button" :disabled="!activeSession" @click="jump(-5)">−5s</button>
              <button class="control-button" type="button" :disabled="!activeSession" @click="jump(5)">+5s</button>
              <button class="control-button" type="button" :disabled="!activeSession" @click="jump(15)">+15s</button>
            </div>

            <div class="timeline-slider-wrap">
              <input
                v-model.number="currentMs"
                class="timeline-range"
                type="range"
                min="0"
                :max="Math.max(1, durationMs)"
                step="100"
                :disabled="!activeSession"
                @pointerdown="beginTimelineSeek"
                @pointerup="endTimelineSeek"
              />
            </div>

            <span class="timeline-clock">{{ formatClock(currentMs) }} / {{ formatClock(durationMs) }}</span>

            <div class="speed-group">
              <button v-for="speed in speeds" :key="speed" class="speed-button" :class="{ active: playbackRate === speed }" type="button" @click="playbackRate = speed">{{ speed }}×</button>
            </div>
          </div>

          <div class="hotkey-inline-hints">
            <span><b>Space</b> 播放/暂停</span>
            <span><b>←/→</b> ±5s</span>
            <span><b>Shift+←/→</b> ±15s</span>
            <span><b>↑/↓</b> 调倍速</span>
            <span><b>R</b> 重置视角</span>
            <span><b>F</b> 跟随</span>
            <span><b>Esc</b> 取消选中</span>
          </div>
        </div>
      </main>

      <!-- 右侧：单位详情与名册 Inspector -->
      <aside class="inspector panel">
        <div class="inspector-tabs">
          <button
            type="button"
            class="tab-button"
            :class="{ active: inspectorTab === 'details' }"
            @click="inspectorTab = 'details'"
          >
            单位详情
          </button>
          <button
            type="button"
            class="tab-button"
            :class="{ active: inspectorTab === 'roster' }"
            @click="inspectorTab = 'roster'"
          >
            对局名册 ({{ visiblePlayers.length }})
          </button>
        </div>

        <div v-if="inspectorTab === 'details'" class="inspector-content">
          <div class="summary-grid">
            <div><strong>{{ teamOneCount }}</strong><span>Team 1 玩家</span></div>
            <div><strong>{{ teamTwoCount }}</strong><span>Team 2 玩家</span></div>
          </div>
          <div class="inspector-divider"></div>
          <div v-if="selectedPlayer" class="selected-player">
            <div class="selected-top">
              <span class="large-pip" :class="'team-' + (selectedPlayer.teamId || 0)"></span>
              <div>
                <span class="panel-kicker">SELECTED UNIT</span>
                <h3>{{ selectedPlayer.name }}</h3>
              </div>
            </div>
            <div class="follow-action-row">
              <button
                type="button"
                class="follow-toggle-btn"
                :class="{ active: isFollowingPlayer }"
                @click="toggleFollowPlayer"
              >
                {{ isFollowingPlayer ? "🎯 正在锁定跟随" : "🎯 视角定位并跟随" }}
              </button>
            </div>
            <dl class="detail-list">
              <div><dt>阵营</dt><dd>Team {{ selectedPlayer.teamId || "--" }}</dd></div>
              <div><dt>小队</dt><dd>{{ selectedPlayer.squadId == null ? "未分队" : "小队 " + selectedPlayer.squadId }}</dd></div>
              <div><dt>职业</dt><dd>{{ selectedPlayer.role || "未记录" }}</dd></div>
              <div><dt>生命</dt><dd>{{ selectedPlayer.health == null ? "--" : Math.round(selectedPlayer.health * 100) + "%" }}</dd></div>
              <div><dt>延迟</dt><dd>{{ selectedPlayer.ping == null ? "--" : selectedPlayer.ping + " ms" }}</dd></div>
              <div><dt>K / W / D</dt><dd>{{ selectedPlayer.kills ?? "--" }} / {{ selectedPlayer.wounds ?? "--" }} / {{ selectedPlayer.deaths ?? "--" }}</dd></div>
              <div><dt>坐标</dt><dd>{{ selectedPlayer.positionText }}</dd></div>
            </dl>
          </div>
          <div v-else class="inspector-placeholder">
            <span>◎</span>
            <p>点击地图上的单位</p>
            <small>查看该时刻状态，或切换名册全员</small>
          </div>
        </div>

        <div v-else class="inspector-content roster-view">
          <div class="roster-search-bar">
            <span>⌕</span>
            <input v-model="rosterSearchText" type="search" placeholder="搜索玩家名字 / 职业 / 小队" />
          </div>

          <div class="roster-groups">
            <div v-for="teamGroup in teamRosters" :key="teamGroup.teamId" class="roster-team-block">
              <div class="roster-team-header" :class="'team-' + teamGroup.teamId">
                <span>{{ teamGroup.name }}</span>
                <span class="roster-badge">{{ teamGroup.count }} 人</span>
              </div>
              <div v-for="sqGroup in teamGroup.squads" :key="sqGroup.name" class="roster-squad-block">
                <div class="roster-squad-title">{{ sqGroup.name }} ({{ sqGroup.players.length }})</div>
                <div
                  v-for="p in sqGroup.players"
                  :key="p.key"
                  class="roster-player-row"
                  :class="{ selected: p.key === (selectedPlayer && selectedPlayer.key) }"
                  @click="selectPlayerFromRoster(p)"
                >
                  <span class="roster-player-pip" :class="'team-' + (p.teamId || 0)"></span>
                  <span class="roster-player-name">
                    <i v-if="p.isLeader" class="leader-star" title="队长">★</i>
                    {{ p.name }}
                  </span>
                  <span class="roster-player-role">{{ p.role || '未分配' }}</span>
                </div>
              </div>
            </div>
            <p v-if="!visiblePlayers.length" class="muted-empty">当前时刻无活跃玩家</p>
          </div>
        </div>
      </aside>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiDelete, apiGet } from "../app/apiClient";
import TiledMapRenderer from "../components/tactical-map/TiledMapRenderer.vue";
import PlayerMarker from "../components/tactical-map/PlayerMarker.vue";
import PressureZoneOverlay from "../components/tactical-map/PressureZoneOverlay.vue";
import type { PressureZoneState } from "../app/dynamicPressureZoneApi";
import { provideTacticalMapViewport } from "../composables/tacticalMapViewport";
import { useMapCamera } from "../composables/useMapCamera";
import { EMPTY_TACTICAL_MAP_CONFIG, TACTICAL_MAP_CONFIGS, resolveTacticalMapKey } from "../shared/tactical-map-data";
import { resolveRoleIcon, type RoleIconInfo } from "../utils/role-icons";

interface ReplaySession { id: string; map?: string; layer?: string; status?: string; durationMs?: number; startedAt?: string; sizeBytes?: number; isPlayable?: boolean; archiveError?: string; }
interface ReplayPosition { x: number; y: number; z?: number; }
interface ReplayPlayer { key: string; name: string; teamId: number | null; squadId: number | null; role: string; roleInfo: RoleIconInfo; isLeader: boolean; health: number | null; ping: number | null; kills: number | null; wounds: number | null; deaths: number | null; yaw: number | null; position: ReplayPosition | null; positionText: string; mapX: number; mapY: number; hasPosition: boolean; }

interface SquadGroup { squadId: number | null; name: string; players: ReplayPlayer[]; }
interface TeamRosterGroup { teamId: number; name: string; count: number; squads: SquadGroup[]; }

const sessions = ref<ReplaySession[]>([]);
const route = useRoute();
const router = useRouter();
const activeSession = ref<ReplaySession | null>(null);
const state = ref<Record<string, any> | null>(null);
const status = ref<Record<string, any> | null>(null);
const selectedPlayer = ref<ReplayPlayer | null>(null);
const showPressureZones = ref(true);
const isFollowingPlayer = ref(false);
const inspectorTab = ref<"details" | "roster">("details");
const rosterSearchText = ref("");

const searchText = ref("");
const durationFilter = ref("all");
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
  return sessions.value.filter((item) => {
    const matchesQuery = !query || (String(item.map || "") + " " + String(item.layer || "")).toLocaleLowerCase().includes(query);
    const minutes = Number(item.durationMs || 0) / 60_000;
    const matchesDuration = durationFilter.value === "all"
      || (durationFilter.value === "short" && minutes < 1)
      || (durationFilter.value === "1-5" && minutes >= 1 && minutes < 5)
      || (durationFilter.value === "5-15" && minutes >= 5 && minutes < 15)
      || (durationFilter.value === "15-30" && minutes >= 15 && minutes <= 30)
      || (durationFilter.value === "long" && minutes > 30);
    return matchesQuery && matchesDuration;
  });
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
const replayPressureZoneState = computed<PressureZoneState | null>(() => {
  const value = currentSnapshot.value?.pressureZoneState;
  return value && typeof value === "object" ? value as PressureZoneState : null;
});
const rawPlayers = computed<any[]>(() => Array.isArray(currentSnapshot.value && currentSnapshot.value.players) ? currentSnapshot.value.players : []);
const replayNameCache = new Map<string, string>();
const visiblePlayers = computed<ReplayPlayer[]>(() => rawPlayers.value.map(normalizePlayer).filter((item: ReplayPlayer) => item.hasPosition));
const teamOneCount = computed(() => visiblePlayers.value.filter((item: ReplayPlayer) => item.teamId === 1).length);
const teamTwoCount = computed(() => visiblePlayers.value.filter((item: ReplayPlayer) => item.teamId === 2).length);

const teamRosters = computed<TeamRosterGroup[]>(() => {
  const query = rosterSearchText.value.trim().toLocaleLowerCase();
  const filtered = visiblePlayers.value.filter((p) => {
    if (!query) return true;
    return (
      p.name.toLocaleLowerCase().includes(query) ||
      String(p.key).toLocaleLowerCase().includes(query) ||
      p.role.toLocaleLowerCase().includes(query) ||
      (p.squadId != null && String(p.squadId).includes(query))
    );
  });

  const teams: TeamRosterGroup[] = [
    { teamId: 1, name: "Team 1 阵营", count: 0, squads: [] },
    { teamId: 2, name: "Team 2 阵营", count: 0, squads: [] },
  ];

  for (const team of teams) {
    const teamPlayers = filtered.filter((p) => p.teamId === team.teamId);
    team.count = teamPlayers.length;

    const squadMap = new Map<number | null, ReplayPlayer[]>();
    for (const p of teamPlayers) {
      const sq = p.squadId;
      if (!squadMap.has(sq)) squadMap.set(sq, []);
      squadMap.get(sq)!.push(p);
    }

    const sortedSquadIds = Array.from(squadMap.keys()).sort((a, b) => {
      if (a == null) return 1;
      if (b == null) return -1;
      return a - b;
    });

    for (const sqId of sortedSquadIds) {
      const sqPlayers = squadMap.get(sqId) || [];
      sqPlayers.sort((a, b) => (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0));
      team.squads.push({
        squadId: sqId,
        name: sqId == null ? "未分队" : `小队 ${sqId}`,
        players: sqPlayers,
      });
    }
  }

  return teams;
});

provideTacticalMapViewport({ zoom: camera.zoom, panX: camera.x, panY: camera.y });

watch(visiblePlayers, (next) => {
  if (selectedPlayer.value) {
    const updated = next.find((p) => p.key === selectedPlayer.value?.key);
    if (updated) {
      selectedPlayer.value = updated;
      if (isFollowingPlayer.value) {
        centerCameraOnPlayer(updated);
      }
    }
  }
});

function normalizePlayer(source: any): ReplayPlayer {
  const identity = source && source.identity || {};
  const position = source && source.telemetry && source.telemetry.position || source && source.position;
  const health = numberOrNull(source && source.telemetry && source.telemetry.health);
  const role = String(source && source.match && source.match.role || source && source.telemetry && source.telemetry.soldierClass || "");
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
  const name = candidates.map(firstReplayText).find((candidate) => candidate && !isGenericReplayName(candidate));
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
function formatBytes(value: any) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "大小未知";
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}
function formatDate(value: any) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "未知时间" : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }

function updateViewportSize() {
  const element = replayViewportRef.value;
  if (!element) return;
  viewportWidth.value = element.clientWidth;
  viewportHeight.value = element.clientHeight;
  if (!isDragging.value && (camera.zoom.value === 1 && camera.x.value === 0 && camera.y.value === 0)) resetCamera();
}
function resetCamera() {
  isFollowingPlayer.value = false;
  const mapSize = 1000;
  const zoom = Math.max(0.2, Math.min(1.2, Math.min(viewportWidth.value, viewportHeight.value) / mapSize * 0.94));
  camera.zoom.value = zoom;
  camera.x.value = (viewportWidth.value - mapSize * zoom) / 2;
  camera.y.value = (viewportHeight.value - mapSize * zoom) / 2;
}
function centerCameraOnPlayer(player: ReplayPlayer) {
  if (!player || !player.hasPosition) return;
  const mapSize = 1000;
  const px = (player.mapX / 100) * mapSize;
  const py = (player.mapY / 100) * mapSize;
  camera.x.value = viewportWidth.value / 2 - px * camera.zoom.value;
  camera.y.value = viewportHeight.value / 2 - py * camera.zoom.value;
}
function toggleFollowPlayer() {
  if (!selectedPlayer.value) return;
  isFollowingPlayer.value = !isFollowingPlayer.value;
  if (isFollowingPlayer.value) {
    centerCameraOnPlayer(selectedPlayer.value);
  }
}
function zoomBy(factor: number) {
  const next = Math.min(8, Math.max(0.2, camera.zoom.value * factor));
  camera.setZoom(next, viewportWidth.value / 2, viewportHeight.value / 2);
  if (isFollowingPlayer.value && selectedPlayer.value) {
    centerCameraOnPlayer(selectedPlayer.value);
  }
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
  isFollowingPlayer.value = false;
  (event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId);
  camera.startDrag(event.clientX, event.clientY);
}
function onPointerMove(event: PointerEvent) {
  if (!isDragging.value) return;
  if (Math.abs(event.movementX) + Math.abs(event.movementY) > 0) {
    dragMoved.value = true;
    isFollowingPlayer.value = false;
  }
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
  if (isFollowingPlayer.value) {
    centerCameraOnPlayer(player);
  }
}
function selectPlayerFromRoster(player: ReplayPlayer) {
  selectedPlayer.value = player;
  centerCameraOnPlayer(player);
}

function handleKeyDown(event: KeyboardEvent) {
  const activeTag = (document.activeElement?.tagName || "").toLowerCase();
  if (activeTag === "input" || activeTag === "select" || activeTag === "textarea") return;

  switch (event.code) {
    case "Space":
      event.preventDefault();
      togglePlaying();
      break;
    case "ArrowLeft":
      event.preventDefault();
      jump(event.shiftKey ? -15 : -5);
      break;
    case "ArrowRight":
      event.preventDefault();
      jump(event.shiftKey ? 15 : 5);
      break;
    case "ArrowUp": {
      event.preventDefault();
      const idx = speeds.indexOf(playbackRate.value);
      if (idx < speeds.length - 1) playbackRate.value = speeds[idx + 1];
      break;
    }
    case "ArrowDown": {
      event.preventDefault();
      const idx = speeds.indexOf(playbackRate.value);
      if (idx > 0) playbackRate.value = speeds[idx - 1];
      break;
    }
    case "KeyR":
      event.preventDefault();
      resetCamera();
      break;
    case "KeyF":
      event.preventDefault();
      toggleFollowPlayer();
      break;
    case "Escape":
      event.preventDefault();
      selectedPlayer.value = null;
      isFollowingPlayer.value = false;
      break;
  }
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
    const target = sessions.value.find((item) => item.id === routeSessionId)
      || sessions.value.find((item) => item.id === (activeSession.value && activeSession.value.id))
      || sessions.value.find((item) => item.isPlayable !== false)
      || sessions.value[0]
      || null;
    if (target && target.id !== activeSession.value?.id) {
      await selectSession(target);
    } else if (target && activeSession.value) {
      activeSession.value = { ...activeSession.value, ...target };
    }
  } catch (error: any) { errorText.value = error && error.message || "无法读取回放档案"; }
  finally { loadingSessions.value = false; }
}
async function selectSession(session: ReplaySession) {
  if (session.isPlayable === false) return;
  playing.value = false;
  isFollowingPlayer.value = false;
  activeSession.value = session;
  const requestedAt = Number(route.query.at);
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

async function deleteSession(session: ReplaySession) {
  if (session.status === "recording") return;
  if (!window.confirm(`确定删除这场 ${session.map || "未知地图"} 的回放快照吗？删除后无法恢复。`)) return;
  try {
    errorText.value = "";
    await apiDelete<any>("/api/tactical-replay/sessions/" + encodeURIComponent(session.id));
    if (activeSession.value?.id === session.id) {
      playing.value = false;
      isFollowingPlayer.value = false;
      activeSession.value = null;
      state.value = null;
      selectedPlayer.value = null;
    }
    sessions.value = sessions.value.filter((item) => item.id !== session.id);
  } catch (error: any) {
    errorText.value = error?.message || "删除回放快照失败";
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
watch(() => route.params.sessionId, (sessionId) => {
  const next = sessions.value.find((item) => item.id === String(sessionId || ""));
  if (next && next.id !== activeSession.value?.id) void selectSession(next);
});
onMounted(async () => {
  window.addEventListener("keydown", handleKeyDown);
  resizeObserver = new ResizeObserver(updateViewportSize);
  if (replayViewportRef.value) resizeObserver.observe(replayViewportRef.value);
  updateViewportSize();
  try { const response = await apiGet<any>("/api/tactical-replay/status"); status.value = response && response.status || null; } catch { status.value = null; }
  await loadSessions();
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeyDown);
  stateLoadToken += 1;
  playbackLastTickAt = 0;
  if (animationTimer) clearInterval(animationTimer);
  if (seekTimer) clearTimeout(seekTimer);
  stateAbortController?.abort();
  stateAbortController = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<style scoped>
:global(body) { background: #07111f; margin: 0; }
.replay-workbench { height: 100%; max-height: 100%; padding: 6px 8px; color: #e8f0fb; background: radial-gradient(circle at 18% 0%, rgba(22,101,137,.2), transparent 35%), #07111f; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; }

.error-banner { padding: 6px 10px; margin-bottom: 6px; color: #ffc5c5; border: 1px solid rgba(248,113,113,.3); background: rgba(127,29,29,.2); border-radius: 6px; font-size: 11px; flex: 0 0 auto; }
.panel { border: 1px solid rgba(141,182,205,.14); background: linear-gradient(145deg, rgba(16,35,54,.96), rgba(8,20,34,.96)); box-shadow: 0 12px 40px rgba(0,0,0,.2); border-radius: 10px; }

/* 核心视口严格 100% 高度约束：100% 无溢出页面滚动 */
.replay-layout { display: grid; grid-template-columns: 260px minmax(0, 1fr) 240px; gap: 8px; align-items: stretch; flex: 1 1 0; min-height: 0; height: 100%; overflow: hidden; }

.session-rail, .inspector { padding: 8px; height: 100%; box-sizing: border-box; overflow: hidden; display: flex; flex-direction: column; }
.panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 6px; flex: 0 0 auto; }
.panel-title-wrap { display: flex; align-items: center; gap: 6px; }
.panel-heading h2 { margin: 0; font-size: 14px; color: #f1fbff; }
.panel-kicker { color: #6f9bb5; font-size: 9px; letter-spacing: .15em; font-weight: 700; }
.count-badge { min-width: 20px; padding: 1px 5px; text-align: center; border-radius: 5px; background: rgba(65,151,191,.18); color: #9bcee2; font-size: 10px; }
.ghost-button.sm { padding: 3px 7px; font-size: 10px; border-radius: 6px; border: 1px solid rgba(150,190,211,.2); color: #cfe1ee; background: rgba(13,30,48,.8); cursor: pointer; }

.archive-tools { display: grid; grid-template-columns: minmax(0, 1fr) 85px; gap: 5px; margin: 6px 0; flex: 0 0 auto; }
.search-box { display: flex; gap: 5px; align-items: center; padding: 4px 6px; border: 1px solid rgba(150,190,211,.14); border-radius: 6px; color: #7a9ab0; background: rgba(5,15,26,.5); }
.search-box input { width: 100%; border: 0; outline: 0; color: #e8f0fb; background: transparent; font-size: 10px; }
.duration-select { min-width: 0; padding: 4px 3px; border: 1px solid rgba(150,190,211,.14); border-radius: 6px; color: #cfe1ee; background: rgba(5,15,26,.7); font-size: 9px; }

.session-list { display: grid; gap: 4px; flex: 1 1 0; min-height: 0; overflow-y: auto; padding-right: 2px; }
.session-card { position: relative; display: grid; grid-template-columns: minmax(0,1fr) 20px; width: 100%; padding: 0; text-align: left; color: #bad0df; border: 1px solid transparent; border-radius: 7px; background: rgba(4,13,24,.34); }
.session-select { display: grid; grid-template-columns: 6px minmax(0,1fr) auto; gap: 7px; min-width: 0; padding: 7px 4px 7px 7px; text-align: left; color: inherit; border: 0; background: transparent; cursor: pointer; }
.delete-session-button { align-self: center; width: 18px; height: 18px; margin-right: 2px; padding: 0; border: 1px solid transparent; border-radius: 4px; color: #7692a2; background: transparent; cursor: pointer; font-size: 14px; line-height: 1; }
.delete-session-button:hover { border-color: rgba(248,113,113,.42); color: #ff8d95; background: rgba(127,29,29,.28); }
.session-card:hover, .session-card.selected { border-color: rgba(71,211,165,.45); background: rgba(23,81,79,.25); }
.session-card.unreadable { cursor: not-allowed; opacity: .58; }
.session-status { margin: 3px 0 0; display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #718298; }
.session-status.recording { background: #40dfa0; box-shadow: 0 0 6px #40dfa0; }
.session-body { min-width: 0; display: grid; gap: 1px; }
.session-card strong { overflow: hidden; color: #f2f7fb; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.session-card small { overflow: hidden; color: #7c9aaf; text-overflow: ellipsis; white-space: nowrap; font-size: 9px; }
.session-card em { display: flex; justify-content: space-between; color: #6c879a; font-size: 9px; font-style: normal; }
.session-arrow { color: #5e879d; font-size: 14px; }
.muted-empty, .inspector-placeholder { color: #6f8b9e; font-size: 10px; text-align: center; }

/* Stage: 地图自适应填充父容器所有可用高度 */
.stage { min-width: 0; padding: 8px; height: 100%; box-sizing: border-box; overflow: hidden; display: flex; flex-direction: column; }

.map-shell { position: relative; flex: 1 1 0; min-height: 0; height: 100%; overflow: hidden; border: 1px solid rgba(164,209,224,.18); border-radius: 8px; background: #081827; cursor: grab; touch-action: none; user-select: none; transition: border-color .2s; }
.map-shell.is-dragging { cursor: grabbing; }
.map-shell.is-following { border-color: rgba(64,223,160,.5); }

.replay-map-transform { position: absolute; top: 0; left: 0; width: 1000px; height: 1000px; transform-origin: 0 0; will-change: transform; z-index: 2; background: #020205; }
.map-grid { position: absolute; inset: 0; z-index: 1; pointer-events: none; opacity: .22; background-image: linear-gradient(rgba(120,183,203,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(120,183,203,.12) 1px, transparent 1px); background-size: 64px 64px; }
.map-canvas { position: absolute; inset: 0; z-index: 0; transition: opacity .2s; }
.map-placeholder { position: absolute; inset: 0; z-index: 2; display: grid; place-content: center; gap: 4px; text-align: center; color: #7498ab; letter-spacing: .12em; font-size: 10px; }
.map-placeholder small { letter-spacing: 0; color: #547384; font-size: 9px; }

/* 嵌入式顶部 HUD 栏 */
.map-hud-top { position: absolute; top: 6px; left: 6px; right: 6px; z-index: 10; display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; border: 1px solid rgba(159,210,224,.18); background: rgba(4,16,28,.82); color: #aacbd6; font-size: 10px; backdrop-filter: blur(8px); border-radius: 6px; pointer-events: none; }
.hud-left, .hud-right { display: flex; align-items: center; gap: 8px; }
.hud-tag { color: #55ddb6; font-size: 9px; letter-spacing: .12em; }
.hud-map-name { font-weight: 700; color: #f1fbff; font-size: 11px; }
.hud-layer-name { color: #789bb0; font-size: 9px; }
.follow-badge { padding: 1px 4px; border-radius: 3px; background: rgba(64,223,160,.2); color: #6bf2c4; font-weight: 600; border: 1px solid rgba(64,223,160,.3); font-size: 9px; }
.hud-players b { color: #eaf7f5; }
.source-chip { padding: 2px 5px; font-size: 9px; border-radius: 4px; border: 1px solid rgba(150,190,211,.2); background: rgba(13,30,48,.8); color: #cfe1ee; }
.source-chip.live { color: #8cf0c1; border-color: rgba(73,214,151,.35); }
.source-chip i { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: #74879c; margin-right: 4px; }
.source-chip.live i { background: #40dfa0; box-shadow: 0 0 8px #40dfa0; }

.player-layer { position: absolute; inset: 0; z-index: 5; pointer-events: none; }
.map-loading { position: absolute; inset: 0; z-index: 20; display: grid; place-items: center; color: #b8d5df; background: rgba(4,15,26,.35); backdrop-filter: blur(2px); font-size: 11px; }

.map-controls { position: absolute; z-index: 12; right: 8px; top: 38px; display: grid; gap: 4px; }
.map-controls button { width: 26px; height: 26px; border: 1px solid rgba(159,210,224,.2); border-radius: 5px; color: #bfeaf0; background: rgba(4,16,28,.82); cursor: pointer; font-size: 13px; display: grid; place-content: center; }
.map-controls button:hover { color: #fff; border-color: rgba(85,221,182,.7); background: rgba(24,92,83,.75); }
.map-controls button:disabled { cursor: not-allowed; opacity: .38; }
.pressure-zone-button.active { border-color: rgba(250,204,21,.72); color: #fde047; background: rgba(113,63,18,.72); }
.follow-button { font-size: 12px; }
.follow-button.active { border-color: #40dfa0 !important; background: rgba(64,223,160,.35) !important; color: #fff !important; }

.marker-size-control { width: 78px; padding: 4px; border: 1px solid rgba(159,210,224,.2); border-radius: 5px; color: #91adba; background: rgba(4,16,28,.92); box-shadow: 0 4px 12px rgba(0,0,0,.22); }
.marker-size-heading { display: flex; justify-content: space-between; gap: 3px; margin-bottom: 2px; font-size: 8px; }
.marker-size-heading output { color: #bfeaf0; font-family: monospace; }
.marker-size-control input[type="range"] { display: block; width: 100%; height: 8px; margin: 0; accent-color: #40dfa0; cursor: pointer; }
.marker-size-actions { display: flex; justify-content: space-between; gap: 2px; margin-top: 2px; }
.marker-size-actions button { width: 18px; height: 16px; min-height: 16px; padding: 0; font-size: 10px; }

/* 重构：一体化紧凑单行播放控制面板 (Timeline Bar) */
.timeline-bar { flex: 0 0 auto; margin-top: 6px; padding: 6px 8px; background: rgba(4,14,24,.6); border: 1px solid rgba(150,190,211,.12); border-radius: 8px; display: flex; flex-direction: column; gap: 4px; }
.timeline-main-row { display: flex; align-items: center; gap: 8px; }
.playback-btn-group { display: flex; gap: 3px; align-items: center; flex: 0 0 auto; }
.play-button { width: 28px; height: 24px; padding: 0; color: #062117; background: #43dca5; border-color: #43dca5; font-weight: 800; cursor: pointer; border-radius: 5px; font-size: 11px; }
.control-button { padding: 3px 5px; color: #9db9c6; background: rgba(6,19,32,.72); font-size: 9px; border-radius: 5px; border: 1px solid rgba(150,190,211,.2); cursor: pointer; }
.control-button:hover, .speed-button:hover { color: #eaf7f5; border-color: rgba(64,223,160,.4); }

.timeline-slider-wrap { flex: 1 1 0; min-width: 0; display: flex; align-items: center; }
.timeline-range { width: 100%; margin: 0; accent-color: #3ed9a1; cursor: pointer; height: 12px; }
.timeline-clock { font-family: monospace; color: #55ddb6; font-size: 10px; font-weight: 700; white-space: nowrap; flex: 0 0 auto; }

.speed-group { display: flex; gap: 2px; flex: 0 0 auto; }
.speed-button { padding: 3px 5px; color: #9db9c6; background: rgba(6,19,32,.72); font-size: 9px; border-radius: 4px; border: 1px solid rgba(150,190,211,.2); cursor: pointer; }
.speed-button.active { color: #071b18; border-color: #40dfa0; background: #40dfa0; font-weight: 700; }

.hotkey-inline-hints { display: flex; gap: 8px; font-size: 9px; color: #6a8b9f; justify-content: center; border-top: 1px dashed rgba(150,190,211,.1); padding-top: 4px; }
.hotkey-inline-hints b { color: #9ecee0; font-family: monospace; }

.inspector { display: flex; flex-direction: column; }
.inspector-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; padding: 2px; background: rgba(4,13,24,.4); border-radius: 7px; margin-bottom: 6px; border: 1px solid rgba(150,190,211,.1); flex: 0 0 auto; }
.tab-button { padding: 5px; border: 0; background: transparent; color: #7897a7; border-radius: 5px; font-size: 10px; font-weight: 600; cursor: pointer; transition: all .15s; }
.tab-button.active { color: #eaf7f5; background: rgba(22,66,88,.6); box-shadow: 0 2px 6px rgba(0,0,0,.2); }

.inspector-content { display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; overflow-y: auto; }
.summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 4px; }
.summary-grid div { display: grid; gap: 1px; padding: 6px; border-radius: 6px; background: rgba(5,17,29,.5); }
.summary-grid strong { color: #ecfafa; font-size: 14px; }
.summary-grid span { color: #7592a3; font-size: 9px; }
.inspector-divider { height: 1px; margin: 8px 0; background: rgba(150,190,211,.12); }
.selected-top { justify-content: flex-start; display: flex; align-items: center; gap: 6px; }
.large-pip { width: 14px; height: 14px; flex: 0 0 auto; border-radius: 50%; background: #49c9ff; box-shadow: 0 0 10px rgba(73,201,255,.45); }
.large-pip.team-2 { background: #ff6572; box-shadow: 0 0 10px rgba(255,101,114,.4); }
.selected-player h3 { margin: 0; color: #f1fbff; font-size: 12px; }

.follow-action-row { margin-top: 6px; }
.follow-toggle-btn { width: 100%; padding: 5px; border: 1px solid rgba(64,223,160,.4); border-radius: 6px; background: rgba(19,82,70,.25); color: #7df5c7; cursor: pointer; font-size: 10px; font-weight: 600; transition: all .15s; }
.follow-toggle-btn:hover, .follow-toggle-btn.active { background: #2ec98b; color: #062117; border-color: #2ec98b; }

.detail-list { display: grid; gap: 5px; margin: 8px 0; }
.detail-list div { display: flex; justify-content: space-between; gap: 5px; color: #7897a7; font-size: 10px; }
.detail-list dd { margin: 0; color: #d0e4ed; text-align: right; }

.roster-view { display: flex; flex-direction: column; gap: 6px; }
.roster-search-bar { display: flex; align-items: center; gap: 5px; padding: 4px 6px; border: 1px solid rgba(150,190,211,.15); border-radius: 6px; background: rgba(4,15,26,.5); color: #7696aa; }
.roster-search-bar input { width: 100%; border: 0; outline: 0; background: transparent; color: #e8f0fb; font-size: 10px; }
.roster-groups { display: flex; flex-direction: column; gap: 6px; flex: 1 1 0; min-height: 0; overflow-y: auto; padding-right: 2px; }
.roster-team-block { display: flex; flex-direction: column; gap: 3px; }
.roster-team-header { display: flex; justify-content: space-between; padding: 3px 6px; border-radius: 4px; font-size: 9px; font-weight: 700; background: rgba(73,201,255,.12); color: #6bcfff; }
.roster-team-header.team-2 { background: rgba(255,101,114,.12); color: #ff8894; }
.roster-badge { font-size: 9px; font-weight: normal; opacity: .8; }
.roster-squad-block { display: flex; flex-direction: column; gap: 2px; padding-left: 2px; }
.roster-squad-title { font-size: 9px; color: #618296; font-weight: 600; padding: 1px 2px; }
.roster-player-row { display: flex; align-items: center; gap: 5px; padding: 3px 5px; border-radius: 4px; cursor: pointer; background: rgba(4,13,24,.3); border: 1px solid transparent; transition: background .12s, border-color .12s; }
.roster-player-row:hover, .roster-player-row.selected { background: rgba(25,75,90,.35); border-color: rgba(64,223,160,.4); }
.roster-player-pip { width: 5px; height: 5px; border-radius: 50%; background: #49c9ff; flex: 0 0 auto; }
.roster-player-pip.team-2 { background: #ff6572; }
.roster-player-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; color: #d6e8f2; }
.leader-star { color: #ffc107; font-style: normal; margin-right: 2px; }
.roster-player-role { font-size: 9px; color: #7293a7; white-space: nowrap; }

.inspector-placeholder { display: grid; place-items: center; gap: 4px; padding: 20px 0; }
.inspector-placeholder span { color: #4cd8aa; font-size: 20px; }
.inspector-placeholder p { margin: 0; color: #b6ced8; font-size: 10px; }
.inspector-placeholder small { color: #648293; font-size: 9px; }

.empty-state { display: grid; place-items: center; gap: 8px; min-height: 60vh; text-align: center; border: 1px dashed rgba(126,178,198,.25); border-radius: 10px; background: rgba(9,25,41,.65); }
.empty-icon { color: #55ddb6; font-size: 36px; }
.empty-state h2 { margin: 0; font-size: 16px; }
.empty-state p { margin: 0 0 6px; color: #7897a7; font-size: 11px; }

@media (max-width: 1100px) {
  .replay-layout { grid-template-columns: 240px minmax(0, 1fr); }
  .inspector { display: none; }
}
@media (max-width: 768px) {
  .replay-workbench { height: auto; max-height: none; overflow: auto; padding: 6px; }
  .replay-layout { display: flex; flex-direction: column; height: auto; }
  .session-rail { width: 100%; height: 220px; }
  .map-shell { height: 320px; }
}
</style>
