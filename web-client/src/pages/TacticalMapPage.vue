<template>
  <div class="tactical-map-layout">
    <!-- Main Map Viewport -->
    <div
      ref="containerRef"
      class="map-viewport"
      @mousedown="startDrag"
      @mousemove="onDrag"
      @mouseup="stopDrag"
      @mouseleave="stopDrag"
      @wheel.prevent="onWheel"
    >
      <!-- Tech Grid Overlay Behind Map -->
      <div class="viewport-bg-grid"></div>

      <!-- Centered Transform Container -->
      <div
        ref="mapRef"
        class="map-transform-container"
        :style="{
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          cursor: isDragging ? 'grabbing' : 'grab'
        }"
        @mousemove="onMapMousemove"
      >
        <!-- Dynamic Map Image -->
        <img
          :src="activeMapConfig.image"
          alt="Tactical Map"
          class="map-image"
          draggable="false"
        />

        <!-- Tactical Coordinates Grid Lines -->
        <div v-if="showGrid" class="map-grid-overlay">
          <!-- Vertical grid lines (game X coordinates) -->
          <div
            v-for="line in verticalGridLines"
            :key="'v-' + line.percent"
            class="grid-line vertical"
            :style="{ left: `${line.percent}%` }"
          >
            <span class="grid-label">{{ line.label }}</span>
          </div>
          <!-- Horizontal grid lines (game Y coordinates) -->
          <div
            v-for="line in horizontalGridLines"
            :key="'h-' + line.percent"
            class="grid-line horizontal"
            :style="{ top: `${line.percent}%` }"
          >
            <span class="grid-label">{{ line.label }}</span>
          </div>
        </div>

        <!-- Radar Sweep Scan Overlay -->
        <div v-if="showRadar" class="radar-scan-overlay">
          <div class="radar-sweep-beam"></div>
          <div class="radar-circle circle-1"></div>
          <div class="radar-circle circle-2"></div>
          <div class="radar-circle circle-3"></div>
        </div>

        <!-- Player Markers Layer -->
        <div class="player-markers-layer">
          <button
            v-for="player in filteredPlayers"
            :key="player.playerGuid || player.playerName"
            class="player-marker"
            :class="[
              `team-${normalizeTeam(player.teamId)}`,
              { 'is-dead': (player.soldierInfo?.health ?? 100) <= 0 },
              { 'is-squadleader': isSquadLeader(player) },
              { 'is-focused': focusedSquadId === player.squadId },
              { 'is-hovered': hoveredPlayer?.playerGuid === player.playerGuid || hoveredPlayer?.playerName === player.playerName },
              { 'no-pointer': disableMarkerInteraction }
            ]"
            :style="{
              left: `${player.mapX}%`,
              top: `${player.mapY}%`,
              transform: `translate(-50%, -50%) scale(${markerScale})`
            }"
            type="button"
            @click="showPlayerDetails(player)"
            @mouseenter="hoveredPlayer = player"
            @mouseleave="hoveredPlayer = null"
          >
            <!-- Marker Aura/Pulse -->
            <div class="marker-pulse"></div>

            <!-- Squad Leader Star or Icon border -->
            <div class="marker-ring">
              <!-- Kit Icon -->
              <img
                :src="getPlayerKitIcon(player)"
                :alt="inferRole(player)"
                class="kit-icon-img"
                draggable="false"
              />
            </div>
            
            <!-- Small Squad Index Tag -->
            <span v-if="player.squadId" class="squad-index-tag">
              {{ player.squadId }}
            </span>

            <!-- Text Tag for Player Name & Coordinates -->
            <span v-if="showPlayerNames" class="tag">
              <span class="player-name-tag">{{ player.playerName }}</span>
              <span v-if="showPlayerCoords" class="coords-tag">
                ({{ Math.round(player.soldierInfo?.position?.x ?? 0) }}, {{ Math.round(player.soldierInfo?.position?.y ?? 0) }})
              </span>
            </span>
          </button>
        </div>

        <!-- Floating Player Hover Tooltip -->
        <div
          v-if="hoveredMarker"
          class="player-tooltip"
          :class="{ 'team-1-border': normalizeTeam(hoveredMarker.teamId) === 1, 'team-2-border': normalizeTeam(hoveredMarker.teamId) === 2 }"
          :style="{
            left: `${hoveredMarker.mapX}%`,
            top: `${hoveredMarker.mapY - 1.5}%`
          }"
        >
          <!-- Tooltip Header -->
          <div class="tooltip-header">
            <span class="tooltip-name">{{ hoveredMarker.playerName }}</span>
            <span
              class="tooltip-health-badge"
              :class="{ 'low-health': (hoveredMarker.soldierInfo?.health ?? 100) < 40, 'dead-health': (hoveredMarker.soldierInfo?.health ?? 100) <= 0 }"
            >
              {{ (hoveredMarker.soldierInfo?.health ?? 100) <= 0 ? 'DOWNED' : `${hoveredMarker.soldierInfo?.health ?? 100}% HP` }}
            </span>
          </div>

          <!-- Divider Line -->
          <div class="tooltip-divider"></div>

          <!-- Tooltip Details Grid -->
          <div class="tooltip-details">
            <div class="detail-row">
              <span class="detail-label">角色职业</span>
              <span class="detail-val">
                <img :src="getPlayerKitIcon(hoveredMarker)" class="inline-kit-icon" />
                {{ inferRole(hoveredMarker) }}
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label">战术小队</span>
              <span class="detail-val">
                <span class="squad-color-pill" :style="{ background: normalizeTeam(hoveredMarker.teamId) === 1 ? '#00e5ff' : '#ff3366' }"></span>
                #{{ hoveredMarker.squadId || '-' }}
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label">武器</span>
              <span class="detail-val font-mono">{{ hoveredMarker.soldierInfo?.weaponClass || '-' }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">坐标</span>
              <span class="detail-val font-mono highlight-cyan">
                {{ Math.round(hoveredMarker.soldierInfo?.position?.x ?? 0) }}, {{ Math.round(hoveredMarker.soldierInfo?.position?.y ?? 0) }}
              </span>
            </div>
          </div>

          <!-- Health visual bar -->
          <div class="tooltip-health-track">
            <div
              class="tooltip-health-bar"
              :style="{
                width: `${hoveredMarker.soldierInfo?.health ?? 100}%`,
                background: (hoveredMarker.soldierInfo?.health ?? 100) <= 0 ? '#ef5350' : (hoveredMarker.soldierInfo?.health ?? 100) < 40 ? '#fdd835' : '#00e5ff'
              }"
            ></div>
          </div>
        </div>
      </div>

      <!-- Top Overlay Panels (Header & Tickets) -->
      <div class="overlay-top-container">
        <!-- System Title Block -->
        <div class="system-header-card glass-panel">
          <div class="header-led-indicator pulse-led"></div>
          <div class="header-text-block">
            <h1 class="main-title">SUMARI SATELLITE COMMAND</h1>
            <p class="subtitle-text">战术雷达实时定位系统 &bull; PBI.sav v1</p>
          </div>
        </div>

        <!-- Faction Match Tickets -->
        <div class="tickets-overlay-card glass-panel">
          <!-- Team 1 US Army -->
          <div class="team-ticket-block team-1">
            <div class="team-info-row">
              <span class="team-label">T1 美军</span>
              <span class="ticket-number font-mono">{{ tickets.team1 }}</span>
            </div>
            <div class="ticket-progress-track">
              <div class="ticket-progress-fill team-1" :style="{ width: `${(tickets.team1 / 400) * 100}%` }"></div>
            </div>
          </div>

          <!-- Divider -->
          <div class="ticket-vs-divider">VS</div>

          <!-- Team 2 PLA Forces -->
          <div class="team-ticket-block team-2">
            <div class="team-info-row">
              <span class="team-label">T2 解放军</span>
              <span class="ticket-number font-mono">{{ tickets.team2 }}</span>
            </div>
            <div class="ticket-progress-track">
              <div class="ticket-progress-fill team-2" :style="{ width: `${(tickets.team2 / 400) * 100}%` }"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Floating Map Utility Action Controls (Bottom Left) -->
      <div class="map-controls-panel glass-panel">
        <button class="ctrl-btn" title="放大" @click="zoomIn">
          <span class="icon-span">+</span>
        </button>
        <button class="ctrl-btn" title="缩小" @click="zoomOut">
          <span class="icon-span">-</span>
        </button>
        <button class="ctrl-btn" title="适配视口" @click="resetView">
          <span class="icon-span">⛶</span>
        </button>
        <div class="ctrl-divider"></div>
        <button
          class="ctrl-btn text-btn"
          :class="{ active: showGrid }"
          @click="showGrid = !showGrid"
        >
          网格
        </button>
        <button
          class="ctrl-btn text-btn"
          :class="{ active: showRadar }"
          @click="showRadar = !showRadar"
        >
          雷达
        </button>
        <button
          class="ctrl-btn text-btn"
          :class="{ active: filterAliveOnly }"
          @click="filterAliveOnly = !filterAliveOnly"
        >
          存活
        </button>
        <button
          class="ctrl-btn text-btn"
          :class="{ active: disableMarkerInteraction }"
          @click="disableMarkerInteraction = !disableMarkerInteraction"
          title="穿透玩家标记 (方便查看地图)"
        >
          穿透
        </button>
      </div>

      <!-- Coordinate Sector Display Box (Bottom Right) -->
      <div class="coordinates-hud-card glass-panel font-mono">
        <div class="hud-item">
          <span class="hud-label">GAME X:</span>
          <span class="hud-val text-cyan">{{ hoverCoords ? Math.round(hoverCoords.gameX) : '-' }}</span>
        </div>
        <div class="hud-item-divider"></div>
        <div class="hud-item">
          <span class="hud-label">GAME Y:</span>
          <span class="hud-val text-yellow">{{ hoverCoords ? Math.round(hoverCoords.gameY) : '-' }}</span>
        </div>
      </div>
    </div>

    <!-- Right Collapsible Tactical Sidebar -->
    <div class="tactical-sidebar" :class="{ 'is-collapsed': sidebarCollapsed }">
      <!-- Toggle button tab -->
      <button class="sidebar-toggle-tab" @click="sidebarCollapsed = !sidebarCollapsed">
        <span class="tab-arrow">{{ sidebarCollapsed ? '◀' : '▶' }}</span>
      </button>

      <div class="sidebar-content-wrapper">
        <!-- Live Server Status Area -->
        <div class="sidebar-section border-b">
          <div class="section-title-bar">
            <span class="glowing-square blue"></span>
            <h3>服务器实时状态</h3>
          </div>
          <div class="server-stats-grid monospace">
            <div class="server-stat-item">
              <span class="lbl">在线人数</span>
              <span class="val text-cyan">{{ serverPlayerCount }}</span>
            </div>
            <div class="server-stat-item">
              <span class="lbl">地图名称</span>
              <span class="val">{{ serverMapName }}</span>
            </div>
            <div class="server-stat-item">
              <span class="lbl">监控状态</span>
              <span class="val text-green pulsing-text">{{ statusText }}</span>
            </div>
            <div class="server-stat-item">
              <span class="lbl">对局阶段</span>
              <span class="val">{{ matchPhase }}</span>
            </div>
          </div>
        </div>

        <!-- Display Options Panel inside Sidebar -->
        <div class="sidebar-section border-b">
          <div class="section-title-bar">
            <span class="glowing-square blue"></span>
            <h3>显示选项</h3>
          </div>
          <div class="options-group-sidebar">
            <label class="option-item-sidebar">
              <input type="checkbox" v-model="showGrid" />
              <span class="option-text">显示坐标网格</span>
            </label>
            <label class="option-item-sidebar">
              <input type="checkbox" v-model="showPlayerNames" />
              <span class="option-text">显示玩家姓名</span>
            </label>
            <label class="option-item-sidebar">
              <input type="checkbox" v-model="showPlayerCoords" />
              <span class="option-text">显示玩家坐标</span>
            </label>
            <label class="option-item-sidebar">
              <input type="checkbox" v-model="disableMarkerInteraction" />
              <span class="option-text">穿透玩家标记</span>
            </label>
            <div class="option-item-slider">
              <span class="option-text">地图选择:</span>
              <select v-model="selectedMapKey" class="map-select">
                <option value="auto">自动检测 ({{ detectedMapName === 'chora' ? 'Chora' : 'Sumari' }})</option>
                <option value="sumari">Sumari</option>
                <option value="chora">Chora</option>
              </select>
            </div>
            <div class="option-item-slider">
              <span class="option-text">图标大小:</span>
              <input type="range" v-model.number="markerScale" min="0.05" max="2.0" step="0.05" class="scale-slider" />
              <span class="scale-val">{{ markerScale.toFixed(2) }}x</span>
            </div>
          </div>
        </div>

        <!-- Directory Tabs (Squads vs Players) -->
        <div class="sidebar-section flex-expand border-b">
          <!-- Selection Mode Tabs -->
          <div class="sidebar-tabs-directory">
            <button
              class="directory-tab-btn"
              :class="{ active: sidebarTab === 'squads' }"
              @click="sidebarTab = 'squads'"
            >
              小队列表
            </button>
            <button
              class="directory-tab-btn"
              :class="{ active: sidebarTab === 'players' }"
              @click="sidebarTab = 'players'"
            >
              所有玩家
            </button>
          </div>

          <!-- Team Selection Tabs -->
          <div class="sidebar-tabs">
            <button
              class="tab-btn"
              :class="{ active: activeTeamTab === 1 }"
              @click="activeTeamTab = 1"
            >
              美军 (T1)
            </button>
            <button
              class="tab-btn"
              :class="{ active: activeTeamTab === 2 }"
              @click="activeTeamTab = 2"
            >
              解放军 (T2)
            </button>
          </div>

          <!-- Squad Cards List -->
          <div v-if="sidebarTab === 'squads'" class="squads-scroll-list">
            <div
              v-for="squad in currentTeamSquads"
              :key="squad.id"
              class="sidebar-squad-card"
              :class="{ 'is-focused': focusedSquadId === squad.id }"
              @click="toggleSquadFocus(squad.id)"
            >
              <div class="squad-card-header">
                <span class="squad-number">#{{ squad.id }}</span>
                <span class="squad-name">{{ squad.name }}</span>
                <span class="squad-members-count monospace">{{ squad.playersCount }}人</span>
              </div>
              <div class="squad-card-meta">
                <span class="sl-name">SL: {{ squad.squadLeaderName }}</span>
                <div class="squad-health-summary">
                  <span class="health-label">均血:</span>
                  <div class="mini-bar-track">
                    <div
                      class="mini-bar-fill"
                      :style="{
                        width: `${squad.avgHealth}%`,
                        backgroundColor: squad.avgHealth < 50 ? '#ef5350' : '#00e5ff'
                      }"
                    ></div>
                  </div>
                  <span class="health-num font-mono">{{ squad.avgHealth }}%</span>
                </div>
              </div>
            </div>
            <div v-if="!currentTeamSquads.length" class="empty-state">
              暂无已创建小队
            </div>
          </div>

          <!-- Active Players List -->
          <div v-else class="squads-scroll-list">
            <button
              v-for="player in filteredTeamPlayers"
              :key="player.playerGuid || player.playerName"
              class="sidebar-player-card-row"
              :class="{ 'is-focused': hoveredPlayer?.playerGuid === player.playerGuid }"
              @click="showPlayerDetails(player)"
              @mouseenter="hoveredPlayer = player"
              @mouseleave="hoveredPlayer = null"
            >
              <span class="player-name-row">{{ player.playerName }}</span>
              <span class="player-meta-row">S{{ normalizeSquad(player.squadId) }} / HP {{ player.soldierInfo?.health ?? '-' }}</span>
            </button>
            <div v-if="!filteredTeamPlayers.length" class="empty-state">
              暂无在线玩家
            </div>
          </div>
        </div>

        <!-- Real-Time Combat Live Feed Log -->
        <div class="sidebar-section combat-feed-section">
          <div class="section-title-bar">
            <span class="glowing-square red"></span>
            <h3>实时战术广播</h3>
          </div>
          <div class="combat-log-console" ref="consoleRef">
            <div
              v-for="(log, idx) in combatLogs"
              :key="'log-' + idx"
              class="console-log-line monospace"
              :class="log.type"
            >
              <span class="log-time">[{{ log.time }}]</span>
              <span class="log-body" v-html="log.text"></span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Official Sliding Player Detail Drawer -->
    <PlayerDetailDrawer
      :open="detailDrawerOpen"
      :player="detailDrawerPlayer"
      :server-id="currentServerId"
      @close="detailDrawerOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, reactive, nextTick } from "vue";
import {
  fetchBzssCorePlayerInfoList,
  type BzssCorePlayerInfoResponse,
  type BzssCoreTrackedPlayerInfo,
  type BzssCoreTrackedVector,
} from "../app/bzssCoreApi";
import { useServerStore } from "../stores/server.store";
import { usePlayerStore } from "../stores/player.store";
import { adaptPlayerDetail } from "../utils/squad-admin-adapter";
import PlayerDetailDrawer from "../components/squad-admin/PlayerDetailDrawer.vue";

interface MapMarker extends BzssCoreTrackedPlayerInfo {
  mapX: number;
  mapY: number;
}

interface CombatLog {
  time: string;
  text: string;
  type: "kill" | "revive" | "capture" | "system";
}

const serverStore = useServerStore();
const playerStore = usePlayerStore();

const snapshot = ref<BzssCorePlayerInfoResponse | null>(null);
const players = ref<BzssCoreTrackedPlayerInfo[]>([]);
const hoveredPlayer = ref<BzssCoreTrackedPlayerInfo | null>(null);
const errorText = ref("");
const loading = ref(false);
let refreshTimer: number | null = null;
let simulatedCombatTimer: number | null = null;
const mapName = "Chora";

interface MapConfig {
  name: string;
  image: string;
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

const MAP_CONFIGS: Record<string, MapConfig> = {
  sumari: {
    name: "Sumari",
    image: "/Sumari_Minimap.PNG",
    bounds: {
      minX: -63973.925781 + 210,
      minY: -44728.078125 + 80,
      maxX: 66033.578125 + 210,
      maxY: 85297.234375 + 80,
    }
  },
  chora: {
    name: "Chora",
    image: "/Chora_Minimap.jpg",
    bounds: {
      minX: -93500,
      minY: -114000,
      maxX: 182000,
      maxY: 161500,
    }
  }
};

const selectedMapKey = ref("auto");
const detectedMapName = computed(() => {
  const currentMap = (serverMapName.value || "").toLowerCase();
  if (currentMap.includes("sumari")) return "sumari";
  return "chora";
});

const activeMapConfig = computed(() => {
  let key = selectedMapKey.value;
  if (key === "auto") {
    key = detectedMapName.value;
  }
  return MAP_CONFIGS[key] || MAP_CONFIGS.sumari;
});

// Viewport Zoom & Pan state
const containerRef = ref<HTMLElement | null>(null);
const mapRef = ref<HTMLElement | null>(null);
const consoleRef = ref<HTMLElement | null>(null);

const zoom = ref(0.7);
const panX = ref(0);
const panY = ref(0);
const isDragging = ref(false);
const dragStart = reactive({ x: 0, y: 0 });

const showGrid = ref(true);
const showRadar = ref(true);
const filterAliveOnly = ref(false);
const disableMarkerInteraction = ref(false);

// Icon scaling and tags visibility refs
const markerScale = ref(1.0);
const showPlayerNames = ref(true);
const showPlayerCoords = ref(true);

// Sidebar states
const sidebarCollapsed = ref(false);
const sidebarTab = ref<"squads" | "players">("squads");
const activeTeamTab = ref<number>(1);
const focusedSquadId = ref<number | null>(null);
const combatLogs = ref<CombatLog[]>([]);

// Detail Drawer States
const detailDrawerOpen = ref(false);
const detailDrawerPlayer = ref<any>(null);

// Get real Server metrics
const currentServerId = computed(() => String(serverStore.snapshot?.serverId ?? ""));
const serverPlayerCount = computed(() => serverStore.snapshot?.playerCount || players.value.length);
const serverMapName = computed(() => serverStore.snapshot?.mapName || mapName);
const matchPhase = computed(() => serverStore.snapshot?.webStatus?.isWarmup ? "WARMUP" : "MID MATCH");

// Grid lines calculation
const verticalGridLines = computed(() => {
  const steps = [0, 25, 50, 75, 100];
  const bounds = activeMapConfig.value.bounds;
  return steps.map((pct) => {
    const val = bounds.minX + (bounds.maxX - bounds.minX) * (pct / 100);
    return {
      percent: pct,
      label: `X:${Math.round(val)}`,
    };
  });
});

const horizontalGridLines = computed(() => {
  const steps = [0, 25, 50, 75, 100];
  const bounds = activeMapConfig.value.bounds;
  return steps.map((pct) => {
    const val = bounds.minY + (bounds.maxY - bounds.minY) * (pct / 100);
    return {
      percent: pct,
      label: `Y:${Math.round(val)}`,
    };
  });
});

// Tickets computed
const tickets = computed(() => {
  const matchState = serverStore.snapshot?.matchState || {};
  const matchTickets = matchState?.match?.tickets || {};
  return {
    team1: Number.isFinite(matchTickets.team1) ? Number(matchTickets.team1) : 300,
    team2: Number.isFinite(matchTickets.team2) ? Number(matchTickets.team2) : 260,
  };
});

const positionedPlayers = computed(() => players.value.filter(hasValidPosition));

const markers = computed<MapMarker[]>(() => {
  const positioned = positionedPlayers.value;
  if (!positioned.length) return [];

  const bounds = activeMapConfig.value.bounds;
  return positioned.map((player) => {
    const pos = player.soldierInfo.position as BzssCoreTrackedVector;
    return {
      ...player,
      mapX: project(pos.x ?? 0, bounds.minX, bounds.maxX),
      mapY: project(pos.y ?? 0, bounds.minY, bounds.maxY),
    };
  });
});

const filteredPlayers = computed(() => {
  let list = markers.value;
  if (filterAliveOnly.value) {
    list = list.filter((p) => {
      const hp = p.soldierInfo?.health;
      return hp != null && hp > 0;
    });
  }
  return list;
});

// Hover tooltip target
const hoveredMarker = computed(() => {
  if (!hoveredPlayer.value) return null;
  return markers.value.find(
    (m) => m.playerGuid === hoveredPlayer.value?.playerGuid || m.playerName === hoveredPlayer.value?.playerName
  ) || null;
});

// Filter players for active team list
const filteredTeamPlayers = computed(() => {
  return players.value
    .filter((p) => normalizeTeam(p.teamId) === activeTeamTab.value)
    .sort((a, b) => (a.playerName || "").localeCompare(b.playerName || ""));
});

// Group real players by squads
const currentTeamSquads = computed(() => {
  const teamId = activeTeamTab.value;
  const squadMap = new Map<number, BzssCoreTrackedPlayerInfo[]>();
  
  players.value.forEach((p) => {
    if (normalizeTeam(p.teamId) === teamId && p.squadId && p.squadId > 0) {
      if (!squadMap.has(p.squadId)) {
        squadMap.set(p.squadId, []);
      }
      squadMap.get(p.squadId)!.push(p);
    }
  });

  const list: any[] = [];
  squadMap.forEach((squadPlayers, squadId) => {
    const sl = squadPlayers.find(p => isSquadLeader(p)) || squadPlayers[0];
    const totalHealth = squadPlayers.reduce((acc, p) => acc + (p.soldierInfo?.health ?? 100), 0);
    const avgHealth = Math.round(totalHealth / squadPlayers.length);
    
    list.push({
      id: squadId,
      name: `Squad ${squadId}`,
      teamId: teamId,
      playersCount: squadPlayers.length,
      squadLeaderName: sl?.playerName || "Unknown",
      avgHealth: avgHealth
    });
  });

  return list.sort((a, b) => a.id - b.id);
});

const statusText = computed(() => {
  if (loading.value && !snapshot.value) return "同步中";
  if (errorText.value) return "异常";
  return snapshot.value?.state?.status || snapshot.value?.status || "待机";
});

// Track Mouse Movement for game coordinates HUD
const hoverCoords = ref<{ x: number; y: number; gameX: number; gameY: number } | null>(null);

function handleMouseMove(event: MouseEvent) {
  if (!mapRef.value) return;
  const rect = mapRef.value.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  
  const pctX = (x / rect.width);
  const pctY = (y / rect.height);
  
  const bounds = activeMapConfig.value.bounds;
  const gameX = bounds.minX + pctX * (bounds.maxX - bounds.minX);
  const gameY = bounds.minY + pctY * (bounds.maxY - bounds.minY);
  
  hoverCoords.value = {
    x: x + 10,
    y: y + 15,
    gameX,
    gameY,
  };
}

function handleMouseLeave() {
  hoverCoords.value = null;
}

// Drag & Pan & Zoom Event Handlers
function startDrag(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.closest(".glass-panel") || target.closest(".tactical-sidebar") || target.closest(".player-tooltip") || target.closest(".player-marker")) return;

  isDragging.value = true;
  dragStart.x = e.clientX - panX.value;
  dragStart.y = e.clientY - panY.value;
}

function onDrag(e: MouseEvent) {
  if (!isDragging.value) return;
  panX.value = e.clientX - dragStart.x;
  panY.value = e.clientY - dragStart.y;
}

function stopDrag() {
  isDragging.value = false;
}

function onWheel(e: WheelEvent) {
  if (!containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  const mapX = (mouseX - panX.value) / zoom.value;
  const mapY = (mouseY - panY.value) / zoom.value;

  const factor = 1.15;
  let nextZoom = zoom.value;
  if (e.deltaY < 0) {
    nextZoom = Math.min(20, zoom.value * factor);
  } else {
    nextZoom = Math.max(0.35, zoom.value / factor);
  }

  zoom.value = nextZoom;
  panX.value = mouseX - mapX * zoom.value;
  panY.value = mouseY - mapY * zoom.value;
}

function zoomIn() {
  zoom.value = Math.min(20, zoom.value * 1.25);
}
function zoomOut() {
  zoom.value = Math.max(0.35, zoom.value / 1.25);
}
function resetView() {
  fitToViewport();
  focusedSquadId.value = null;
}

function fitToViewport() {
  if (!containerRef.value) return;
  const viewWidth = containerRef.value.clientWidth;
  const viewHeight = containerRef.value.clientHeight;
  const mapSize = 1000;

  const scale = Math.min(viewWidth, viewHeight) / mapSize * 0.95;
  zoom.value = Math.max(0.35, Math.min(2, scale));
  
  panX.value = (viewWidth - mapSize * zoom.value) / 2;
  panY.value = (viewHeight - mapSize * zoom.value) / 2;
}

function onMapMousemove(e: MouseEvent) {
  handleMouseMove(e);
}

// Squad directory highlights
function toggleSquadFocus(squadId: number) {
  if (focusedSquadId.value === squadId) {
    focusedSquadId.value = null;
  } else {
    focusedSquadId.value = squadId;
  }
}

// Show player detail in sliding drawer
function showPlayerDetails(player: BzssCoreTrackedPlayerInfo) {
  const storePlayer = playerStore.active.find(
    (p) => p.name === player.playerName || p.steamID === player.playerGuid
  );

  if (storePlayer) {
    const detail = adaptPlayerDetail(storePlayer, null, {});
    detail.bzssCorePlayerInfo = player;
    detail.bzssCoreStatus = "ready";
    detailDrawerPlayer.value = detail;
  } else {
    detailDrawerPlayer.value = {
      playerId: null,
      name: player.playerName,
      teamId: normalizeTeam(player.teamId),
      squadId: normalizeSquad(player.squadId),
      isLeader: isSquadLeader(player),
      role: inferRole(player),
      isOnline: true,
      ping: null,
      steamId: player.playerGuid?.length === 17 ? player.playerGuid : null,
      eosId: player.playerGuid?.length === 32 ? player.playerGuid : null,
      bzssCorePlayerInfo: player,
      bzssCoreStatus: "ready",
      combatStats: {
        kills: 0,
        deaths: 0,
        downs: 0,
        tk: 0,
        revives: 0
      }
    };
  }
  detailDrawerOpen.value = true;
}

// Log Feed
function logCombatEvent(text: string, type: "kill" | "revive" | "capture" | "system" = "kill") {
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  combatLogs.value.push({ time, text, type });
  
  if (combatLogs.value.length > 40) {
    combatLogs.value.shift();
  }

  nextTick(() => {
    if (consoleRef.value) {
      consoleRef.value.scrollTop = consoleRef.value.scrollHeight;
    }
  });
}

function runCombatEventSimulation() {
  if (players.value.length === 0) return;
  
  if (Math.random() < 0.25) {
    const list = players.value;
    const team1 = list.filter(p => normalizeTeam(p.teamId) === 1);
    const team2 = list.filter(p => normalizeTeam(p.teamId) === 2);
    
    if (team1.length > 0 && team2.length > 0) {
      const killer = getRandomElement(Math.random() < 0.5 ? team1 : team2);
      const victim = getRandomElement(normalizeTeam(killer.teamId) === 1 ? team2 : team1);
      
      const weapons = ["M4A1", "QBZ191", "AK-74", "M249", "QJB201", "RPG-7", "M3E1 LAW", "PKP", "M110 Sniper"];
      const weapon = getRandomElement(weapons);
      
      const killerName = `<span class="team-${normalizeTeam(killer.teamId)}-text">${killer.playerName}</span>`;
      const victimName = `<span class="team-${normalizeTeam(victim.teamId)}-text">${victim.playerName}</span>`;
      
      logCombatEvent(`${killerName} 击倒了 ${victimName} (武器: ${weapon})`, "kill");
    }
  }
}

// Helpers
function getRandomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function normalizeTeam(teamId: number | null | undefined) {
  return Number.isFinite(teamId as number) && Number(teamId) > 0 ? Number(teamId) : 0;
}

function normalizeSquad(squadId: number | null | undefined) {
  return Number.isFinite(squadId as number) && Number(squadId) >= 0 ? Number(squadId) : 0;
}

function hasValidPosition(player: BzssCoreTrackedPlayerInfo) {
  const pos = player.soldierInfo?.position;
  return Boolean(pos && Number.isFinite(pos.x) && Number.isFinite(pos.y));
}

function project(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 50;
  if (max <= min) return 50;
  const percent = ((value - min) / (max - min)) * 100;
  return Math.min(98, Math.max(2, percent));
}

function isSquadLeader(player: BzssCoreTrackedPlayerInfo) {
  const soldierClass = String(player.soldierInfo?.soldierClass ?? "").toLowerCase();
  return soldierClass.includes("squadleader") || soldierClass.includes("officer") || soldierClass.includes("sl");
}

function getPlayerKitIcon(player: BzssCoreTrackedPlayerInfo) {
  const health = player.soldierInfo?.health;
  if (health != null && health <= 0) {
    return "/Icon/T_role_dead.PNG";
  }

  const soldierClass = String(player.soldierInfo?.soldierClass ?? "").toLowerCase();
  const weaponClass = String(player.soldierInfo?.weaponClass ?? "").toLowerCase();
  const text = `${soldierClass} ${weaponClass}`;

  if (soldierClass.includes("squadleader") || soldierClass.includes("officer")) {
    if (soldierClass.includes("pilot")) return "/Icon/T_role_pilot_squadleader.PNG";
    if (soldierClass.includes("crewman")) return "/Icon/T_role_crewman_squadleader.PNG";
    return "/Icon/T_role_squadleader.PNG";
  }
  
  if (text.includes("medic")) return "/Icon/T_role_medic.PNG";
  if (text.includes("sniper")) return "/Icon/T_role_sniper.PNG";
  if (text.includes("marksman")) return "/Icon/T_role_designatedmarksman.PNG";
  if (text.includes("grenadier")) return "/Icon/T_role_grenadier.PNG";
  if (text.includes("machine") || text.includes("mg")) return "/Icon/T_role_machinegunner.PNG";
  if (text.includes("autorifle")) return "/Icon/T_role_automaticrifleman.PNG";
  if (text.includes("hat") || text.includes("heavyantitank")) return "/Icon/T_role_heavyantitank.PNG";
  if (text.includes("lat") || text.includes("lightantitank")) return "/Icon/T_role_lightantitank.PNG";
  if (text.includes("crewman")) return "/Icon/T_role_crewman.PNG";
  if (text.includes("pilot")) return "/Icon/T_role_pilot.PNG";
  if (text.includes("sapper") || text.includes("engineer")) return "/Icon/T_role_engineer.PNG";
  if (text.includes("recruit")) return "/Icon/T_role_recruit.PNG";
  return "/Icon/T_role_rifleman.PNG";
}

function inferRole(player: BzssCoreTrackedPlayerInfo) {
  const soldierClass = String(player.soldierInfo?.soldierClass ?? "").toLowerCase();
  const weaponClass = String(player.soldierInfo?.weaponClass ?? "").toLowerCase();
  const text = `${soldierClass} ${weaponClass}`;

  if (text.includes("medic")) return "Medic";
  if (text.includes("sniper") || text.includes("marksman")) return "Marksman";
  if (text.includes("grenadier")) return "Grenadier";
  if (text.includes("machine") || text.includes("mg")) return "Machine Gunner";
  if (text.includes("lat") || text.includes("hat") || text.includes("rocket")) return "Anti-Tank";
  if (text.includes("crewman")) return "Crewman";
  if (text.includes("pilot")) return "Pilot";
  if (text.includes("rifle")) return "Rifleman";
  return player.soldierInfo?.soldierClass || "Unknown";
}

async function refreshTrackedPlayers() {
  loading.value = true;
  try {
    const payload = await fetchBzssCorePlayerInfoList();
    snapshot.value = payload;
    players.value = payload.players ?? [];
    errorText.value = payload.ok ? "" : payload.status || "BZSS-Core returned an error.";
  } catch (error: any) {
    errorText.value = error?.message ?? "Failed to load BZSS-Core player snapshots.";
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void refreshTrackedPlayers();
  refreshTimer = window.setInterval(() => {
    void refreshTrackedPlayers();
  }, 100);

  setTimeout(() => {
    fitToViewport();
  }, 100);

  logCombatEvent("对局卫星扫描加载就绪... 坐标网格正常", "system");
  logCombatEvent("美军与中国解放军交火中... 实时动态激活", "system");

  simulatedCombatTimer = window.setInterval(runCombatEventSimulation, 2500);
  window.addEventListener("resize", fitToViewport);
});

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer);
  if (simulatedCombatTimer) window.clearInterval(simulatedCombatTimer);
  window.removeEventListener("resize", fitToViewport);
});
</script>

<style scoped>
/* Main Grid Layout */
.tactical-map-layout {
  display: grid;
  grid-template-columns: 1fr auto;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: #05070f;
  color: #e2e8f0;
  position: relative;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

/* Map Viewport Area */
.map-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  outline: none;
  user-select: none;
  background-color: #060913;
}

/* Tech grid background pattern */
.viewport-bg-grid {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-size: 40px 40px;
  background-image: 
    linear-gradient(to right, rgba(0, 240, 255, 0.03) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(0, 240, 255, 0.03) 1px, transparent 1px);
  pointer-events: none;
  z-index: 1;
}

/* Transform map canvas container */
.map-transform-container {
  position: absolute;
  width: 1000px;
  height: 1000px;
  transform-origin: 0 0;
  box-shadow: 0 0 100px rgba(0, 0, 0, 0.9);
  background-color: #020205;
}

.map-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.88;
  filter: contrast(1.1) brightness(0.85) saturate(0.9);
  border: 2px solid rgba(0, 240, 255, 0.2);
}

/* Dotted grid Coordinate Lines overlay */
.map-grid-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 2;
}

.grid-line {
  position: absolute;
  border: 0.5px dashed rgba(56, 189, 248, 0.2);
}

.grid-line.vertical {
  top: 0;
  bottom: 0;
  width: 0;
}

.grid-line.horizontal {
  left: 0;
  right: 0;
  height: 0;
}

.grid-label {
  position: absolute;
  font-size: 9px;
  color: rgba(56, 189, 248, 0.6);
  font-family: monospace;
  background: rgba(15, 23, 42, 0.6);
  padding: 1px 3px;
  border-radius: 3px;
  white-space: nowrap;
}

.grid-line.vertical .grid-label {
  bottom: 4px;
  transform: translateX(-50%);
}

.grid-line.horizontal .grid-label {
  left: 4px;
  transform: translateY(-50%);
}

/* Radar Sweep overlay */
.radar-scan-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 3;
  overflow: hidden;
}

.radar-sweep-beam {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 120%;
  height: 120%;
  transform: translate(-50%, -50%);
  background: conic-gradient(from 0deg, rgba(0, 229, 255, 0.14) 0deg, rgba(0, 229, 255, 0) 100deg);
  border-radius: 50%;
  animation: sweep-beam-rotation 12s linear infinite;
}

@keyframes sweep-beam-rotation {
  from { transform: translate(-50%, -50%) rotate(0deg); }
  to { transform: translate(-50%, -50%) rotate(360deg); }
}

.radar-circle {
  position: absolute;
  top: 50%;
  left: 50%;
  border: 1px solid rgba(0, 240, 255, 0.06);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.circle-1 { width: 30%; height: 30%; }
.circle-2 { width: 60%; height: 60%; }
.circle-3 { width: 90%; height: 90%; }

/* Player markers styling */
.player-markers-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 10;
  pointer-events: none;
}

.player-marker {
  position: absolute;
  width: 28px;
  height: 28px;
  pointer-events: auto;
  cursor: pointer;
  border: none;
  background: transparent;
  padding: 0;
  outline: none;
  transition: left 0.1s linear, top 0.1s linear;
}

.player-marker.no-pointer {
  pointer-events: none;
}

/* Pulsing neon outline */
.marker-pulse {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  opacity: 0;
  transform: scale(1);
}

.team-1 .marker-pulse {
  border: 2px solid #00c8ff;
  animation: pulse-ring-blue 2.4s infinite;
}

.team-2 .marker-pulse {
  border: 2px solid #ff3366;
  animation: pulse-ring-red 2.4s infinite;
}

@keyframes pulse-ring-blue {
  0% { transform: scale(0.9); opacity: 0.8; }
  80% { transform: scale(2.2); opacity: 0; }
  100% { transform: scale(2.2); opacity: 0; }
}

@keyframes pulse-ring-red {
  0% { transform: scale(0.9); opacity: 0.8; }
  80% { transform: scale(2.2); opacity: 0; }
  100% { transform: scale(2.2); opacity: 0; }
}

/* The solid icon ring (anchored perfectly at center) */
.marker-ring {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background-color: #0b1120;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.8);
  border: 2.5px solid;
  transition: all 0.2s ease;
}

.team-1 .marker-ring { border-color: #00e5ff; }
.team-2 .marker-ring { border-color: #ff3366; }
.is-dead .marker-ring { border-color: #94a3b8; filter: grayscale(1) brightness(0.6); }

/* Leader special outline */
.is-squadleader .marker-ring {
  transform: translate(-50%, -50%) scale(1.15);
}

.kit-icon-img {
  width: 14px;
  height: 14px;
  object-fit: contain;
  filter: invert(1);
}

.is-dead .kit-icon-img {
  width: 10px;
  height: 10px;
}

.squad-index-tag {
  position: absolute;
  bottom: -7px;
  right: -3px;
  background-color: #0f172a;
  color: #e2e8f0;
  font-size: 8px;
  line-height: 1;
  padding: 2px 3.5px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  font-family: monospace;
  font-weight: bold;
  z-index: 3;
}

.team-1 .squad-index-tag { color: #00e5ff; }
.team-2 .squad-index-tag { color: #ff5252; }

/* Text Tag for Player Name & Coordinates (absolute offset, doesn't shift the dot center) */
.player-marker .tag {
  position: absolute;
  left: 28px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.88);
  border: 1px solid rgba(226, 232, 240, 0.14);
  font-size: 11px;
  white-space: nowrap;
  line-height: 1.25;
  pointer-events: none;
  color: #f8fafc;
  z-index: 5;
}

.player-name-tag {
  font-weight: 500;
}

.coords-tag {
  font-size: 9px;
  color: #38bdf8;
  font-family: "Consolas", "SFMono-Regular", monospace;
  margin-top: 1px;
}

/* Interactive Hover/Active States with explicit translate centered fix */
.player-marker.is-hovered .marker-ring,
.player-marker:hover .marker-ring {
  transform: translate(-50%, -50%) scale(1.35);
  z-index: 50;
  border-color: #ffffff !important;
  box-shadow: 0 0 15px rgba(255, 255, 255, 0.9);
}

.player-marker.is-hovered.is-squadleader .marker-ring,
.player-marker:hover.is-squadleader .marker-ring {
  transform: translate(-50%, -50%) scale(1.45);
}

.player-marker.is-hovered .tag,
.player-marker:active .tag {
  border-color: rgba(0, 240, 255, 0.4);
  background: rgba(8, 14, 36, 0.95);
}

/* Floating Player Hover Tooltip */
.player-tooltip {
  position: absolute;
  width: 220px;
  background: rgba(8, 12, 28, 0.88);
  border: 1.5px solid rgba(0, 240, 255, 0.4);
  border-radius: 8px;
  padding: 10px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.9), 0 0 15px rgba(0, 240, 255, 0.15);
  backdrop-filter: blur(10px);
  z-index: 100;
  transform: translate(-50%, -100%);
  pointer-events: none;
  animation: tooltip-fade-in 0.15s ease-out;
}

@keyframes tooltip-fade-in {
  from { opacity: 0; transform: translate(-50%, -95%); }
  to { opacity: 1; transform: translate(-50%, -100%); }
}

.team-1-border { border-color: rgba(0, 229, 255, 0.5) !important; }
.team-2-border { border-color: rgba(255, 51, 102, 0.5) !important; }

.tooltip-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.tooltip-name {
  font-weight: bold;
  font-size: 13px;
  color: #ffffff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.tooltip-health-badge {
  font-size: 9px;
  font-family: monospace;
  background: rgba(0, 240, 255, 0.12);
  color: #00e5ff;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: bold;
  border: 1px solid rgba(0, 240, 255, 0.2);
}

.tooltip-health-badge.low-health {
  color: #ffd54f;
  background: rgba(253, 216, 53, 0.12);
  border-color: rgba(253, 216, 53, 0.2);
}

.tooltip-health-badge.dead-health {
  color: #ef5350;
  background: rgba(239, 83, 80, 0.15);
  border-color: rgba(239, 83, 80, 0.25);
}

.tooltip-divider {
  height: 1px;
  background: linear-gradient(90deg, rgba(0, 240, 255, 0.25), transparent);
  margin-bottom: 8px;
}

.tooltip-details {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: #94a3b8;
}

.detail-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-val {
  color: #e2e8f0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.inline-kit-icon {
  width: 11px;
  height: 11px;
  filter: invert(1);
}

.squad-color-pill {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.highlight-cyan {
  color: #00e5ff;
}

.tooltip-health-track {
  width: 100%;
  height: 3px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  margin-top: 8px;
  overflow: hidden;
}

.tooltip-health-bar {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}

/* Glass panel design rules */
.glass-panel {
  background: rgba(6, 11, 28, 0.75);
  border: 1px solid rgba(0, 240, 255, 0.15);
  border-radius: 12px;
  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.6), inset 0 0 10px rgba(0, 240, 255, 0.05);
  backdrop-filter: blur(12px) saturate(160%);
}

/* Top Panel overlays */
.overlay-top-container {
  position: absolute;
  top: 16px;
  left: 16px;
  right: 16px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  pointer-events: none;
  z-index: 20;
}

.system-header-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  pointer-events: auto;
}

.header-led-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.pulse-led {
  background-color: #00ff66;
  box-shadow: 0 0 10px #00ff66, 0 0 18px #00ff66;
  animation: led-pulse 2s infinite alternate;
}

@keyframes led-pulse {
  from { opacity: 0.3; }
  to { opacity: 1; }
}

.header-text-block .main-title {
  margin: 0;
  font-size: 16px;
  font-weight: 900;
  letter-spacing: 1.5px;
  color: #ffffff;
  text-shadow: 0 0 10px rgba(0, 240, 255, 0.3);
}

.header-text-block .subtitle-text {
  margin: 0;
  font-size: 10px;
  color: rgba(0, 240, 255, 0.6);
  font-family: monospace;
}

/* Faction Ticket Box */
.tickets-overlay-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  min-width: 320px;
  pointer-events: auto;
}

.team-ticket-block {
  flex: 1;
}

.team-info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.team-label {
  font-size: 10px;
  font-weight: bold;
  letter-spacing: 0.5px;
  color: #94a3b8;
}

.ticket-number {
  font-size: 14px;
  font-weight: 900;
  color: #ffffff;
}

.team-1 .ticket-number { color: #00e5ff; text-shadow: 0 0 10px rgba(0, 229, 255, 0.3); }
.team-2 .ticket-number { color: #ff3366; text-shadow: 0 0 10px rgba(255, 51, 102, 0.3); }

.ticket-progress-track {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.ticket-progress-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.5s ease;
}

.ticket-progress-fill.team-1 { background-color: #00e5ff; }
.ticket-progress-fill.team-2 { background-color: #ff3366; }

.ticket-vs-divider {
  font-family: monospace;
  font-weight: bold;
  font-size: 11px;
  color: rgba(0, 240, 255, 0.4);
  padding: 0 4px;
  align-self: center;
}

/* Floating Actions Controls (Bottom Left) */
.map-controls-panel {
  position: absolute;
  bottom: 16px;
  left: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  z-index: 20;
}

.ctrl-btn {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(0, 240, 255, 0.15);
  color: #94a3b8;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.ctrl-btn:hover {
  background: rgba(0, 240, 255, 0.12);
  color: #00e5ff;
  border-color: #00e5ff;
  box-shadow: 0 0 8px rgba(0, 240, 255, 0.2);
}

.ctrl-btn .icon-span {
  font-size: 18px;
  font-weight: bold;
  line-height: 1;
}

.ctrl-divider {
  width: 1px;
  height: 20px;
  background-color: rgba(0, 240, 255, 0.15);
  margin: 0 4px;
}

.ctrl-btn.text-btn {
  width: auto;
  padding: 0 10px;
  font-size: 11px;
  font-weight: bold;
  letter-spacing: 0.5px;
}

.ctrl-btn.text-btn.active {
  background: rgba(0, 240, 255, 0.2);
  color: #00e5ff;
  border-color: #00e5ff;
  box-shadow: inset 0 0 6px rgba(0, 240, 255, 0.2), 0 0 10px rgba(0, 240, 255, 0.15);
}

/* Coordinates Sector HUD (Bottom Right) */
.coordinates-hud-card {
  position: absolute;
  bottom: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  z-index: 20;
}

.hud-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.hud-label {
  color: rgba(255, 255, 255, 0.4);
}

.hud-val {
  font-weight: bold;
}

.hud-item-divider {
  width: 1px;
  height: 12px;
  background-color: rgba(255, 255, 255, 0.15);
}

/* Utilities helpers */
.font-mono { font-family: monospace; }
.monospace { font-family: monospace; }
.text-cyan { color: #00e5ff; }
.text-yellow { color: #fbc02d; }
.text-green { color: #4caf50; }

.pulsing-text {
  animation: stat-pulse 1.8s infinite alternate;
}

@keyframes stat-pulse {
  from { opacity: 0.4; }
  to { opacity: 1; }
}

/* Right Collapsible Sidebar */
.tactical-sidebar {
  position: relative;
  width: 360px;
  height: 100%;
  background: rgba(4, 7, 18, 0.93);
  border-left: 1px solid rgba(0, 240, 255, 0.15);
  box-shadow: -10px 0 30px rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(16px);
  z-index: 30;
  transition: transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
  display: flex;
  flex-direction: column;
}

.tactical-sidebar.is-collapsed {
  transform: translateX(100%);
  position: absolute;
  right: 0;
  height: 100%;
}

/* Tab Handle to toggle sidebar */
.sidebar-toggle-tab {
  position: absolute;
  left: -24px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 80px;
  background: rgba(4, 7, 18, 0.93);
  border: 1px solid rgba(0, 240, 255, 0.15);
  border-right: none;
  border-radius: 8px 0 0 8px;
  cursor: pointer;
  color: #00e5ff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: -5px 0 15px rgba(0, 0, 0, 0.5);
  outline: none;
}

.sidebar-toggle-tab:hover {
  color: #ffffff;
  background: rgba(0, 240, 255, 0.1);
}

.tab-arrow {
  font-size: 10px;
}

/* Sidebar structure */
.sidebar-content-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.sidebar-section {
  padding: 16px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.border-b {
  border-bottom: 1px solid rgba(0, 240, 255, 0.08);
}

.flex-expand {
  flex: 1;
}

.section-title-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.glowing-square {
  width: 6px;
  height: 6px;
  border-radius: 1px;
}

.glowing-square.blue { background-color: #00e5ff; box-shadow: 0 0 8px #00e5ff; }
.glowing-square.yellow { background-color: #ffd54f; box-shadow: 0 0 8px #ffd54f; }
.glowing-square.red { background-color: #ff3366; box-shadow: 0 0 8px #ff3366; }

.section-title-bar h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #ffffff;
}

/* Server Stats Area */
.server-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.server-stat-item {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
}

.server-stat-item .lbl {
  font-size: 9px;
  color: #64748b;
  text-transform: uppercase;
  margin-bottom: 2px;
}

.server-stat-item .val {
  font-size: 11px;
  font-weight: bold;
  color: #e2e8f0;
}

/* Options group sidebar styling */
.options-group-sidebar {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.option-item-sidebar {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.option-item-sidebar input[type="checkbox"] {
  accent-color: #38bdf8;
  width: 14px;
  height: 14px;
  cursor: pointer;
}

.option-text {
  font-size: 12px;
  color: #e5eefc;
}

.option-item-slider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.scale-slider {
  flex: 1;
  accent-color: #38bdf8;
  height: 4px;
  border-radius: 2px;
  cursor: pointer;
}

.scale-val {
  font-size: 11px;
  font-family: monospace;
  color: #38bdf8;
  min-width: 28px;
  text-align: right;
}

/* Directory sub-tabs */
.sidebar-tabs-directory {
  display: flex;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 2px;
  margin-bottom: 10px;
}

.directory-tab-btn {
  flex: 1;
  background: transparent;
  border: none;
  color: #94a3b8;
  font-size: 11px;
  font-weight: bold;
  padding: 6px 0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.directory-tab-btn.active {
  background: rgba(0, 240, 255, 0.08);
  color: #00e5ff;
}

/* Tabs list */
.sidebar-tabs {
  display: flex;
  background: rgba(255, 255, 255, 0.01);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  padding: 3px;
  margin-bottom: 12px;
}

.tab-btn {
  flex: 1;
  background: transparent;
  border: none;
  color: #64748b;
  font-size: 10px;
  font-weight: bold;
  padding: 6px 0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn.active {
  background: rgba(0, 240, 255, 0.1);
  color: #00e5ff;
  box-shadow: inset 0 0 5px rgba(0, 240, 255, 0.1);
}

/* Squad cards scroll */
.squads-scroll-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
}

.squads-scroll-list::-webkit-scrollbar,
.combat-log-console::-webkit-scrollbar {
  width: 4px;
}

.squads-scroll-list::-webkit-scrollbar-thumb,
.combat-log-console::-webkit-scrollbar-thumb {
  background: rgba(0, 240, 255, 0.15);
  border-radius: 2px;
}

.sidebar-squad-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.sidebar-squad-card:hover {
  background: rgba(0, 240, 255, 0.05);
  border-color: rgba(0, 240, 255, 0.25);
  box-shadow: 0 0 10px rgba(0, 240, 255, 0.05);
}

.sidebar-squad-card.is-focused {
  background: rgba(0, 240, 255, 0.08);
  border-color: #00e5ff;
  box-shadow: inset 0 0 6px rgba(0, 240, 255, 0.1), 0 0 12px rgba(0, 240, 255, 0.1);
}

.squad-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.squad-number {
  font-size: 11px;
  font-weight: 900;
  color: #00e5ff;
  font-family: monospace;
}

.squad-name {
  font-weight: bold;
  font-size: 11px;
  color: #ffffff;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  flex: 1;
}

.squad-members-count {
  font-size: 10px;
  color: #94a3b8;
}

.squad-card-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sl-name {
  font-size: 10px;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 130px;
}

.squad-health-summary {
  display: flex;
  align-items: center;
  gap: 5px;
}

.health-label {
  font-size: 9px;
  color: #64748b;
}

.mini-bar-track {
  width: 40px;
  height: 3px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 1px;
  overflow: hidden;
}

.mini-bar-fill {
  height: 100%;
  border-radius: 1px;
}

.health-num {
  font-size: 9px;
  color: #94a3b8;
}

/* Active Player Row inside list */
.sidebar-player-card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.01);
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s ease;
}

.sidebar-player-card-row:hover,
.sidebar-player-card-row.is-focused {
  background: rgba(0, 240, 255, 0.06);
  border-color: rgba(0, 240, 255, 0.3);
}

.sidebar-player-card-row.team-1 {
  border-left: 3px solid #00e5ff;
}

.sidebar-player-card-row.team-2 {
  border-left: 3px solid #ff3366;
}

.player-name-row {
  font-size: 12px;
  font-weight: 500;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.player-meta-row {
  font-size: 10px;
  color: #64748b;
  flex-shrink: 0;
}

.empty-state {
  text-align: center;
  padding: 24px;
  font-size: 12px;
  color: #64748b;
}

/* Combat feed box */
.combat-feed-section {
  height: 220px;
  flex-shrink: 0;
  background: rgba(2, 4, 10, 0.95);
  border-top: 1px solid rgba(0, 240, 255, 0.15);
}

.combat-log-console {
  flex: 1;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(0, 240, 255, 0.05);
  border-radius: 6px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.console-log-line {
  font-size: 10px;
  line-height: 1.4;
  color: #cbd5e1;
  word-break: break-all;
}

.log-time {
  color: #64748b;
  margin-right: 6px;
}

.console-log-line.kill {
  border-left: 2px solid rgba(239, 83, 80, 0.5);
  padding-left: 4px;
}

.console-log-line.revive {
  border-left: 2px solid rgba(0, 229, 255, 0.5);
  padding-left: 4px;
  color: #e2f8ff;
}

.console-log-line.capture {
  color: #fbc02d;
  font-weight: bold;
}

.console-log-line.system {
  color: #10b981;
}

/* Global color tags injected dynamically */
:deep(.team-1-text) {
  color: #00e5ff;
  font-weight: bold;
}

:deep(.team-2-text) {
  color: #ff5252;
  font-weight: bold;
}

.map-select {
  flex: 1;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(0, 240, 255, 0.2);
  color: #e2e8f0;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 11px;
  outline: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.map-select:hover, .map-select:focus {
  border-color: #00e5ff;
  box-shadow: 0 0 8px rgba(0, 240, 255, 0.25);
  background: rgba(8, 12, 28, 0.95);
}

.map-select option {
  background: #0f172a;
  color: #e2e8f0;
}
</style>
