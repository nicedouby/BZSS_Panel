<template>
  <aside class="tactical-sidebar">
    <!-- Collapsible toggle tab -->
    <button
      class="sidebar-toggle-tab"
      type="button"
      :class="{ 'is-collapsed': isCollapsed }"
      @click="isCollapsed = !isCollapsed"
      :title="isCollapsed ? '展开面板' : '收起面板'"
    >
      <span class="tab-arrow">{{ isCollapsed ? '◀' : '▶' }}</span>
    </button>

    <div class="sidebar-content-wrapper" :class="{ 'is-collapsed': isCollapsed }">
      <!-- ── Header ── -->
      <header class="sidebar-header">
        <div class="header-led-block">
          <div class="header-led-indicator pulse-led" title="System Online"></div>
          <div class="header-text">
            <div class="sidebar-title">TACTICAL CMD</div>
            <div class="sidebar-subtitle">实时战术指挥系统</div>
          </div>
        </div>
        <!-- Server quick stats -->
        <div class="header-quick-stats">
          <div class="qs-item">
            <span class="qs-val text-cyan monospace">{{ serverPlayerCount }}</span>
            <span class="qs-lbl">在线</span>
          </div>
          <div class="qs-sep"></div>
          <div class="qs-item">
            <span class="qs-val pulsing-text text-green">{{ statusText }}</span>
            <span class="qs-lbl">状态</span>
          </div>
          <div class="qs-sep"></div>
          <div class="qs-item">
            <span class="qs-val">{{ matchPhase }}</span>
            <span class="qs-lbl">阶段</span>
          </div>
        </div>
        <!-- Ticket bar -->
        <div class="header-ticket-bar">
          <span class="ticket-label-left monospace" :style="getPerspectiveStyle(1)">T1 {{ tickets.team1 }}</span>
          <div class="ticket-track">
            <div class="ticket-fill" :style="{ ...getPerspectiveStyle(1), width: getTicketBarWidth(1) }"></div>
            <div class="ticket-fill ticket-fill-right" :style="{ ...getPerspectiveStyle(2), width: getTicketBarWidth(2) }"></div>
          </div>
          <span class="ticket-label-right monospace" :style="getPerspectiveStyle(2)">{{ tickets.team2 }} T2</span>
        </div>
      </header>

      <!-- ── Layers / Settings ── -->
      <section class="sidebar-section">
        <div class="section-title-bar">
          <span class="glowing-square blue"></span>
          <h3>图层控制</h3>
          <button type="button" class="section-collapse-btn" @click="layersOpen = !layersOpen">
            {{ layersOpen ? '▲' : '▼' }}
          </button>
        </div>

        <div v-show="layersOpen" class="layers-content">
          <!-- Checkboxes -->
          <div class="options-group-sidebar layers-grid">
            <label class="option-item-sidebar" :class="{ checked: showGridModel }">
              <input v-model="showGridModel" type="checkbox" />
              <span class="option-text">网格</span>
            </label>
            <label class="option-item-sidebar" :class="{ checked: showPlayerNamesModel }">
              <input v-model="showPlayerNamesModel" type="checkbox" />
              <span class="option-text">名称</span>
            </label>
            <label class="option-item-sidebar" :class="{ checked: showPlayerCoordsModel }">
              <input v-model="showPlayerCoordsModel" type="checkbox" />
              <span class="option-text">坐标</span>
            </label>
            <label class="option-item-sidebar" :class="{ checked: showCaptureZonesModel }">
              <input v-model="showCaptureZonesModel" type="checkbox" />
              <span class="option-text">目标点</span>
            </label>
            <label class="option-item-sidebar" :class="{ checked: showFobsModel }">
              <input v-model="showFobsModel" type="checkbox" />
              <span class="option-text">FOB</span>
            </label>
            <label class="option-item-sidebar" :class="{ checked: disableMarkerInteractionModel }">
              <input v-model="disableMarkerInteractionModel" type="checkbox" />
              <span class="option-text">穿透</span>
            </label>
            <label class="option-item-sidebar" :class="{ checked: measureModeModel }">
              <input v-model="measureModeModel" type="checkbox" />
              <span class="option-text">测距</span>
            </label>
          </div>

          <!-- Map selector -->
          <div class="option-row">
            <span class="option-label">地图</span>
            <select v-model="selectedMapKeyModel" class="map-select">
              <option value="auto">Auto ({{ detectedMapName }})</option>
              <option v-for="map in mapOptions" :key="map.key" :value="map.key">{{ map.name }}</option>
            </select>
          </div>

          <!-- Perspective -->
          <div class="option-row option-row--col">
            <span class="option-label">视角</span>
            <div class="perspective-switch">
              <button type="button" class="perspective-btn" :class="{ active: viewerPerspectiveModeModel === 'auto' }" @click="viewerPerspectiveModeModel = 'auto'">Auto</button>
              <button type="button" class="perspective-btn" :class="{ active: viewerPerspectiveModeModel === 'team1' }" :style="getPerspectiveStyle(1)" @click="viewerPerspectiveModeModel = 'team1'">T1</button>
              <button type="button" class="perspective-btn" :class="{ active: viewerPerspectiveModeModel === 'team2' }" :style="getPerspectiveStyle(2)" @click="viewerPerspectiveModeModel = 'team2'">T2</button>
            </div>
          </div>
          <div class="perspective-summary">{{ perspectiveSummaryText }}</div>

          <!-- Marker scale -->
          <div class="option-row">
            <span class="option-label">标记</span>
            <input v-model.number="markerScaleModel" type="range" min="0.05" max="2" step="0.05" class="scale-slider" />
            <span class="scale-val monospace">{{ markerScaleModel.toFixed(2) }}x</span>
          </div>
        </div>
      </section>

      <!-- ── Tab Navigation ── -->
      <div class="sidebar-tabs-directory">
        <button class="directory-tab-btn" :class="{ active: sidebarTab === 'overview' }" @click="sidebarTabModel = 'overview'">
          <span class="tab-icon">📊</span><span class="tab-name">总览</span>
        </button>
        <button class="directory-tab-btn" :class="{ active: sidebarTab === 'units' }" @click="sidebarTabModel = 'units'">
          <span class="tab-icon">👥</span><span class="tab-name">单位</span>
        </button>
        <button class="directory-tab-btn" :class="{ active: sidebarTab === 'assets' }" @click="sidebarTabModel = 'assets'">
          <span class="tab-icon">📡</span><span class="tab-name">资产</span>
        </button>
        <button class="directory-tab-btn" :class="{ active: sidebarTab === 'core' }" @click="sidebarTabModel = 'core'">
          <span class="tab-icon">⚙️</span><span class="tab-name">核心</span>
        </button>

      </div>

      <!-- ── Tab Content ── -->
      <section class="sidebar-tab-section">

        <!-- Overview Tab -->
        <div v-if="sidebarTab === 'overview'" class="sidebar-overview">
          <div class="overview-card">
            <div class="overview-card-title">服务器 / BZSS 核心</div>
            <div class="overview-grid">
              <div class="overview-line"><span>玩家</span><strong>{{ serverPlayerCount }}</strong></div>
              <div class="overview-line"><span>阶段</span><strong>{{ matchPhase }}</strong></div>
              <div class="overview-line"><span>BZSS</span><strong :class="bzssCoreStatusClass">{{ bzssCoreStatusLabel }}</strong></div>
              <div class="overview-line"><span>更新</span><strong>{{ bzssCoreUpdatedAtText }}</strong></div>
            </div>
          </div>
          <div class="overview-card">
            <div class="overview-card-title">快速操作</div>
            <div class="overview-actions">
              <button type="button" class="quick-action-btn" @click="sidebarTabModel = 'units'">查找玩家</button>
              <button type="button" class="quick-action-btn" @click="sidebarTabModel = 'assets'">查看资产</button>
              <button type="button" class="quick-action-btn" @click="sidebarTabModel = 'core'">核心状态</button>
            </div>
          </div>
        </div>

        <!-- Units Tab -->
        <div v-else-if="sidebarTab === 'units'" class="sidebar-scroll">
          <div class="sidebar-search-row">
            <input v-model="sidebarSearchModel" class="sidebar-search-input" type="search" placeholder="搜索玩家、小队、Kit..." />
            <select v-model="sidebarSortModeModel" class="map-select sort-select">
              <option value="squad">小队</option>
              <option value="name">名称</option>
              <option value="health">血量</option>
              <option value="distance">距离</option>
              <option value="vehicle">载具</option>
            </select>
          </div>
          <div class="filter-pill-row">
            <button type="button" class="filter-pill" :class="{ active: sidebarOnlyAliveModel }" @click="sidebarOnlyAliveModel = !sidebarOnlyAliveModel">存活</button>
            <button type="button" class="filter-pill" :class="{ active: sidebarOnlyVehicleModel }" @click="sidebarOnlyVehicleModel = !sidebarOnlyVehicleModel">载具</button>
          </div>
          <div class="sidebar-tabs">
            <button type="button" class="tab-btn" :class="[getPerspectiveClass(1), { active: activeTeamTab === 1 }]" :style="getPerspectiveStyle(1)" @click="activeTeamTabModel = 1">TEAM 1</button>
            <button type="button" class="tab-btn" :class="[getPerspectiveClass(2), { active: activeTeamTab === 2 }]" :style="getPerspectiveStyle(2)" @click="activeTeamTabModel = 2">TEAM 2</button>
          </div>
          <div class="unit-mode-tabs">
            <button type="button" class="mode-chip" :class="{ active: sidebarUnitMode === 'squads' }" @click="sidebarUnitModeModel = 'squads'">小队</button>
            <button type="button" class="mode-chip" :class="{ active: sidebarUnitMode === 'players' }" @click="sidebarUnitModeModel = 'players'">玩家</button>
          </div>

          <div v-if="sidebarUnitMode === 'squads'" class="sidebar-list">
            <button
              v-for="squad in currentTeamSquads"
              :key="squad.id"
              type="button"
              class="sidebar-squad-card"
              :class="[getPerspectiveClass(squad.teamId), { 'is-focused': focusedSquadId === squad.id }]"
              :style="getPerspectiveStyle(squad.teamId)"
              @click="$emit('focus-squad', { teamId: squad.teamId, squadId: squad.id })"
            >
              <div class="squad-card-header">
                <span class="squad-number">#{{ squad.id }}</span>
                <span class="squad-name">{{ squad.name }}</span>
                <span class="squad-members-count monospace">{{ squad.playersCount }}</span>
              </div>
              <div class="squad-card-meta">
                <span class="sl-name">SL: {{ squad.squadLeaderName }}</span>
                <div class="squad-health-summary">
                  <span class="health-label">HP</span>
                  <div class="mini-bar-track">
                    <div class="mini-bar-fill" :style="{ width: `${squad.avgHealth}%`, backgroundColor: squad.avgHealth < 50 ? '#ef5350' : '#00e5ff' }"></div>
                  </div>
                  <span class="health-num font-mono">{{ squad.avgHealth }}%</span>
                </div>
              </div>
            </button>
            <div v-if="!currentTeamSquads.length" class="empty-state">暂无小队</div>
          </div>

          <div v-else class="sidebar-list">
            <button
              v-for="player in filteredPlayers"
              :key="getPlayerKey(player)"
              type="button"
              class="sidebar-player-card-row"
              :class="[
                `team-${normalizeTeam(player.teamId)}`,
                getPerspectiveClass(player.teamId),
                { 'is-focused': markerFocusKey === getPlayerKey(player) },
                { 'is-disengaged': isPlayerDisengaged(player) }
              ]"
              :style="getPerspectiveStyle(player.teamId)"
              @click="onPlayerClick(player)"
            >
              <div class="player-card-header">
                <span class="player-name">
                  {{ getPlayerLabel(player) }}
                  <span v-if="isSquadLeader(player)" class="sl-badge-pill">SL</span>
                </span>
                <span class="player-squad-tag">S{{ normalizeSquad(player.squadId) }}</span>
              </div>
              <div class="player-card-body">
                <div class="player-health-bar-container">
                  <div class="player-health-bar-fill" :style="{ width: `${getPlayerHealth(player) ?? 0}%`, backgroundColor: getPlayerHealthColor(player) }"></div>
                </div>
                <div class="player-status-row">
                  <span class="player-hp-value font-mono">{{ getPlayerHealth(player) ?? '0' }}% HP</span>
                  <span v-if="player.soldierInfo?.soldierClass" class="player-kit">{{ player.soldierInfo.soldierClass }}</span>
                  <span v-if="player.vehicleInfo?.vehicleType && player.vehicleInfo.vehicleType !== 'None'" class="player-vehicle-badge">
                    <span class="vehicle-icon-mini">⚡</span>
                    {{ player.vehicleInfo.vehicleType }}
                  </span>
                  <span v-if="isPlayerDisengaged(player)" class="disengaged-sidebar-tag glowing-tag">脱离</span>
                </div>
              </div>
            </button>
            <div v-if="!filteredPlayers.length" class="empty-state">暂无玩家</div>
          </div>
        </div>

        <!-- Assets Tab -->
        <div v-else-if="sidebarTab === 'assets'" class="sidebar-scroll">
          <div class="asset-group">
            <div class="asset-group-title">占领点</div>
            <button
              v-for="zone in captureZoneMarkers"
              :key="zone.name"
              type="button"
              class="asset-row"
              @click="$emit('focus-zone', zone)"
            >
              <span>{{ zone.name }}</span>
              <span class="asset-meta font-mono">{{ zone.mapX.toFixed(1) }}%, {{ zone.mapY.toFixed(1) }}%</span>
            </button>
            <div v-if="!captureZoneMarkers.length" class="empty-state">暂无占领点</div>
          </div>

          <div class="asset-group">
            <div class="asset-group-title">FOB 电台</div>
            <button
              v-for="fob in fobMarkers"
              :key="`${fob.teamId}-${fob.name}-${fob.mapX}-${fob.mapY}`"
              type="button"
              class="asset-row asset-row--stacked"
              @click="$emit('focus-fob', fob)"
            >
              <div class="asset-row-title">
                <span class="bzss-team-indicator" :class="`team-ind-${fob.teamId}`">T{{ fob.teamId }}</span>
                <span>{{ fob.name }}</span>
                <span v-if="fob.isBleeding" class="bzss-badge bzss-badge--danger">失血</span>
              </div>
              <div class="asset-bars">
                <div class="asset-bar-line">
                  <span>HP</span>
                  <div class="mini-bar-track"><div class="mini-bar-fill bzss-fill-hp" :style="{ width: `${Math.round((fob.health ?? 0) * 100)}%` }"></div></div>
                  <span>{{ Math.round((fob.health ?? 0) * 100) }}%</span>
                </div>
                <div class="asset-bar-line">
                  <span>弹药</span>
                  <div class="mini-bar-track"><div class="mini-bar-fill bzss-fill-ammo" :style="{ width: `${Math.min(100, Math.round((fob.ammo ?? 0) / 100))}%` }"></div></div>
                  <span>{{ Math.round(fob.ammo ?? 0) }}</span>
                </div>
                <div class="asset-bar-line">
                  <span>建设</span>
                  <div class="mini-bar-track"><div class="mini-bar-fill bzss-fill-const" :style="{ width: `${Math.min(100, Math.round((fob.construction ?? 0) / 20))}%` }"></div></div>
                  <span>{{ Math.round(fob.construction ?? 0) }}</span>
                </div>
              </div>
            </button>
            <div v-if="!fobMarkers.length" class="empty-state">暂无 FOB</div>
          </div>

          <div class="asset-group">
            <div class="asset-group-title">载具</div>
            <button
              v-for="group in vehicleGroups"
              :key="`${group.teamId}-${group.vehicleType}`"
              type="button"
              class="asset-row"
              @click="$emit('focus-vehicle', group)"
            >
              <span>{{ group.vehicleType }}</span>
              <span class="asset-meta font-mono">x{{ group.count }}</span>
            </button>
            <div v-if="!vehicleGroups.length" class="empty-state">暂无载具</div>
          </div>
        </div>

        <!-- Core Tab -->
        <div v-else-if="sidebarTab === 'core'" class="sidebar-scroll">
          <div class="bzss-info-card">
            <div class="bzss-card-title">
              <span class="bzss-status-dot" :class="bzssCoreStatusClass"></span>
              核心状态
            </div>
            <div class="bzss-stats-grid">
              <div class="bzss-stat-row"><span class="bzss-stat-label">状态</span><span class="bzss-stat-value" :class="bzssCoreStatusClass">{{ bzssCoreStatusLabel }}</span></div>
              <div class="bzss-stat-row"><span class="bzss-stat-label">版本</span><span class="bzss-stat-value font-mono">Rev {{ snapshot?.state?.revision ?? '--' }}</span></div>
              <div class="bzss-stat-row"><span class="bzss-stat-label">更新</span><span class="bzss-stat-value font-mono">{{ bzssCoreUpdatedAtText }}</span></div>
              <div class="bzss-stat-row"><span class="bzss-stat-label">标记</span><span class="bzss-stat-value"><span v-if="snapshot?.state?.markerSeen" class="bzss-badge bzss-badge--ok">已发现</span><span v-else class="bzss-badge bzss-badge--warn">未找到</span></span></div>
            </div>
          </div>
          <div class="bzss-info-card">
            <div class="bzss-card-title">玩家统计</div>
            <div class="bzss-stats-grid">
              <div class="bzss-stat-row"><span class="bzss-stat-label">运行时</span><span class="bzss-stat-value text-cyan font-mono">{{ snapshot?.state?.runtimePlayerCount ?? 0 }}</span></div>
              <div class="bzss-stat-row"><span class="bzss-stat-label">积分板</span><span class="bzss-stat-value text-yellow font-mono">{{ snapshot?.state?.scoreboardPlayerCount ?? 0 }}</span></div>
              <div class="bzss-stat-row"><span class="bzss-stat-label">已定位</span><span class="bzss-stat-value text-cyan font-mono">{{ positionedPlayerCount }}</span></div>
              <div class="bzss-stat-row"><span class="bzss-stat-label">存活</span><span class="bzss-stat-value text-green font-mono">{{ bzssCoreAliveCount }}</span></div>
            </div>
          </div>
          <div class="bzss-info-card" v-if="rawFields?.length">
            <div class="bzss-card-title">原始字段</div>
            <div class="bzss-raw-fields">
              <code v-for="(field, idx) in rawFields" :key="`rf-${idx}`" class="bzss-raw-field-tag">{{ field }}</code>
            </div>
          </div>
          <div v-if="lastError" class="bzss-info-card bzss-info-card--error">
            <div class="bzss-card-title">最后错误</div>
            <div class="bzss-error-text font-mono">{{ lastError }}</div>
          </div>
        </div>



      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { BzssCoreCaptureZoneInfo, BzssCoreFobInfo, BzssCorePlayerInfoResponse, BzssCoreTrackedPlayerInfo } from "../../app/bzssCoreApi";

type SidebarMode = "expanded" | "compact" | "hidden";
type SidebarTab = "overview" | "units" | "assets" | "core";
type SidebarUnitMode = "squads" | "players";
type SidebarSortMode = "name" | "squad" | "health" | "distance" | "vehicle";
type ViewerPerspectiveMode = "auto" | "team1" | "team2";

interface TacticalMapConfigOption {
  key: string;
  name: string;
}

interface TacticalTeamSquad {
  id: number;
  name: string;
  teamId: number;
  playersCount: number;
  squadLeaderName: string;
  avgHealth: number;
}

interface TacticalCaptureZoneMarker {
  name: string;
  mapX: number;
  mapY: number;
  raw?: string;
}

interface TacticalFobMarker {
  name: string;
  teamId: number;
  health?: number | null;
  isBleeding?: boolean | null;
  ammo?: number | null;
  construction?: number | null;
  mapX: number;
  mapY: number;
  raw?: string;
}

interface TacticalVehicleGroup {
  teamId: number;
  vehicleType: string;
  count: number;
}

const props = defineProps<{
  sidebarMode: SidebarMode;
  sidebarTab: SidebarTab;
  sidebarUnitMode: SidebarUnitMode;
  activeTeamTab: number;
  sidebarSearch: string;
  sidebarSortMode: SidebarSortMode;
  sidebarOnlyAlive: boolean;
  sidebarOnlyVehicle: boolean;
  showGrid: boolean;
  showPlayerNames: boolean;
  showPlayerCoords: boolean;
  showCaptureZones: boolean;
  showFobs: boolean;
  disableMarkerInteraction: boolean;
  measureMode: boolean;
  selectedMapKey: string;
  markerScale: number;
  viewerPerspectiveMode: ViewerPerspectiveMode;
  detectedMapName: string;
  mapOptions: TacticalMapConfigOption[];
  serverPlayerCount: number;
  serverMapName: string;
  statusText: string;
  matchPhase: string;
  tickets: { team1: number; team2: number };
  perspectiveSummaryText: string;
  snapshot: BzssCorePlayerInfoResponse | null;
  currentTeamSquads: TacticalTeamSquad[];
  filteredTeamPlayers: BzssCoreTrackedPlayerInfo[];
  captureZoneMarkers: TacticalCaptureZoneMarker[];
  fobMarkers: TacticalFobMarker[];
  vehicleGroups: TacticalVehicleGroup[];
  combatLogs: Array<{ time: string; text: string; type: "kill" | "revive" | "capture" | "system" }>;
  positionedPlayerCount: number;
  bzssCoreStatusLabel: string;
  bzssCoreStatusClass: string;
  bzssCoreUpdatedAtText: string;
  bzssCoreAliveCount: number;
  rawFields: string[];
  lastError: string;
  markerFocusKey: string;
  focusedSquadId: number | null;
  getPerspectiveStyle: (teamId: number | null | undefined) => Record<string, string>;
  getPerspectiveClass: (teamId: number | null | undefined) => string;
  getPlayerKey: (player: BzssCoreTrackedPlayerInfo | null | undefined) => string;
  getPlayerLabel: (player: BzssCoreTrackedPlayerInfo | null | undefined) => string;
  getPlayerHealth: (player: BzssCoreTrackedPlayerInfo | null | undefined) => number | null;
  normalizeTeam: (teamId: number | null | undefined) => number;
  normalizeSquad: (squadId: number | null | undefined) => number;
  isPlayerDisengaged: (player: BzssCoreTrackedPlayerInfo) => boolean;
}>()

const emit = defineEmits<{
  (e: "update:sidebar-mode", value: SidebarMode): void;
  (e: "update:sidebar-tab", value: SidebarTab): void;
  (e: "update:sidebar-unit-mode", value: SidebarUnitMode): void;
  (e: "update:active-team-tab", value: number): void;
  (e: "update:sidebar-search", value: string): void;
  (e: "update:sidebar-sort-mode", value: SidebarSortMode): void;
  (e: "update:sidebar-only-alive", value: boolean): void;
  (e: "update:sidebar-only-vehicle", value: boolean): void;
  (e: "update:show-grid", value: boolean): void;
  (e: "update:show-player-names", value: boolean): void;
  (e: "update:show-player-coords", value: boolean): void;
  (e: "update:show-capture-zones", value: boolean): void;
  (e: "update:show-fobs", value: boolean): void;
  (e: "update:disable-marker-interaction", value: boolean): void;
  (e: "update:measure-mode", value: boolean): void;
  (e: "update:selected-map-key", value: string): void;
  (e: "update:marker-scale", value: number): void;
  (e: "update:viewer-perspective-mode", value: ViewerPerspectiveMode): void;
  (e: "focus-player", player: BzssCoreTrackedPlayerInfo): void;
  (e: "focus-squad", payload: { teamId: number; squadId: number }): void;
  (e: "focus-fob", payload: TacticalFobMarker): void;
  (e: "focus-zone", payload: TacticalCaptureZoneMarker): void;
  (e: "focus-vehicle", payload: TacticalVehicleGroup): void;
  (e: "open-player", player: BzssCoreTrackedPlayerInfo): void;
}>();

// Local UI state
const isCollapsed = ref(false);
const layersOpen = ref(true);

const sidebarTabModel = computed({
  get: () => props.sidebarTab,
  set: (value: SidebarTab) => emit("update:sidebar-tab", value),
});
const activeTeamTabModel = computed({
  get: () => props.activeTeamTab,
  set: (value: number) => emit("update:active-team-tab", value),
});
const sidebarUnitModeModel = computed({
  get: () => props.sidebarUnitMode,
  set: (value: SidebarUnitMode) => emit("update:sidebar-unit-mode", value),
});
const sidebarTab = computed(() => props.sidebarTab);
const sidebarUnitMode = computed(() => props.sidebarUnitMode);
const activeTeamTab = computed(() => props.activeTeamTab);
const sidebarSearchModel = computed({
  get: () => props.sidebarSearch,
  set: (value: string) => emit("update:sidebar-search", value),
});
const sidebarSortModeModel = computed({
  get: () => props.sidebarSortMode,
  set: (value: SidebarSortMode) => emit("update:sidebar-sort-mode", value),
});
const sidebarOnlyAliveModel = computed({
  get: () => props.sidebarOnlyAlive,
  set: (value: boolean) => emit("update:sidebar-only-alive", value),
});
const sidebarOnlyVehicleModel = computed({
  get: () => props.sidebarOnlyVehicle,
  set: (value: boolean) => emit("update:sidebar-only-vehicle", value),
});
const showGridModel = computed({
  get: () => props.showGrid,
  set: (value: boolean) => emit("update:show-grid", value),
});
const showPlayerNamesModel = computed({
  get: () => props.showPlayerNames,
  set: (value: boolean) => emit("update:show-player-names", value),
});
const showPlayerCoordsModel = computed({
  get: () => props.showPlayerCoords,
  set: (value: boolean) => emit("update:show-player-coords", value),
});
const showCaptureZonesModel = computed({
  get: () => props.showCaptureZones,
  set: (value: boolean) => emit("update:show-capture-zones", value),
});
const showFobsModel = computed({
  get: () => props.showFobs,
  set: (value: boolean) => emit("update:show-fobs", value),
});
const disableMarkerInteractionModel = computed({
  get: () => props.disableMarkerInteraction,
  set: (value: boolean) => emit("update:disable-marker-interaction", value),
});
const measureModeModel = computed({
  get: () => props.measureMode,
  set: (value: boolean) => emit("update:measure-mode", value),
});
const selectedMapKeyModel = computed({
  get: () => props.selectedMapKey,
  set: (value: string) => emit("update:selected-map-key", value),
});
const markerScaleModel = computed({
  get: () => props.markerScale,
  set: (value: number) => emit("update:marker-scale", value),
});
const viewerPerspectiveModeModel = computed({
  get: () => props.viewerPerspectiveMode,
  set: (value: ViewerPerspectiveMode) => emit("update:viewer-perspective-mode", value),
});

function getTicketBarWidth(teamId: number) {
  const t1 = props.tickets?.team1 ?? 0;
  const t2 = props.tickets?.team2 ?? 0;
  const total = t1 + t2;
  if (total <= 0) return '50%';
  const percent = teamId === 1 ? (t1 / total) * 100 : (t2 / total) * 100;
  return `${percent}%`;
}

function isSquadLeader(player: BzssCoreTrackedPlayerInfo) {
  const soldierClass = String(player.soldierInfo?.soldierClass ?? "").toLowerCase();
  return soldierClass.includes("squadleader") || soldierClass.includes("officer") || soldierClass.includes("sl");
}

function getPlayerHealthColor(player: BzssCoreTrackedPlayerInfo) {
  const hp = props.getPlayerHealth(player);
  if (hp == null) return 'var(--perspective-primary, #00e5ff)';
  if (hp <= 0) return '#ef5350';
  if (hp < 40) return '#ffea00';
  return 'var(--perspective-primary, #00e5ff)';
}

function onPlayerClick(player: BzssCoreTrackedPlayerInfo) {
  emit("focus-player", player);
  emit("open-player", player);
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function getPlayerPosition(player: BzssCoreTrackedPlayerInfo) {
  return player.soldierInfo?.position ?? player.position ?? null;
}

function getSquadForPlayer(player: BzssCoreTrackedPlayerInfo) {
  return props.currentTeamSquads.find((squad) => squad.id === props.normalizeSquad(player.squadId));
}

const filteredPlayers = computed(() => {
  const teamId = props.activeTeamTab;
  const query = normalizeText(props.sidebarSearch);
  const list = props.filteredTeamPlayers.filter((player) => {
    if (props.normalizeTeam(player.teamId) !== teamId) return false;
    if (props.sidebarOnlyAlive && (props.getPlayerHealth(player) ?? 0) <= 0) return false;
    if (props.sidebarOnlyVehicle && !player.vehicleInfo?.vehicleType) return false;
    if (!query) return true;
    const squad = getSquadForPlayer(player);
    const haystack = [
      props.getPlayerLabel(player),
      player.playerGuid,
      player.soldierInfo?.soldierClass,
      player.soldierInfo?.weaponClass,
      player.vehicleInfo?.vehicleType,
      `s${props.normalizeSquad(player.squadId)}`,
      squad?.name,
      squad?.squadLeaderName,
    ]
      .map(normalizeText)
      .join(" ");
    return haystack.includes(query);
  });

  const sortMode = props.sidebarSortMode;
  return [...list].sort((a, b) => {
    if (sortMode === "name") return props.getPlayerLabel(a).localeCompare(props.getPlayerLabel(b));
    if (sortMode === "health") return (props.getPlayerHealth(b) ?? -1) - (props.getPlayerHealth(a) ?? -1);
    if (sortMode === "vehicle") return normalizeText(a.vehicleInfo?.vehicleType).localeCompare(normalizeText(b.vehicleInfo?.vehicleType)) || props.getPlayerLabel(a).localeCompare(props.getPlayerLabel(b));
    if (sortMode === "distance") {
      const da = getPlayerPosition(a);
      const db = getPlayerPosition(b);
      return Math.hypot(da?.x ?? 0, da?.y ?? 0) - Math.hypot(db?.x ?? 0, db?.y ?? 0);
    }
    const sa = props.normalizeSquad(a.squadId);
    const sb = props.normalizeSquad(b.squadId);
    return sa - sb || props.getPlayerLabel(a).localeCompare(props.getPlayerLabel(b));
  });
});

const teamVehicleGroups = computed(() => {
  const buckets = new Map<string, TacticalVehicleGroup>();
  for (const player of props.filteredTeamPlayers) {
    if (props.normalizeTeam(player.teamId) !== props.activeTeamTab) continue;
    const vehicleType = String(player.vehicleInfo?.vehicleType ?? "").trim();
    if (!vehicleType || vehicleType === "None") continue;
    const key = `${props.normalizeTeam(player.teamId)}:${vehicleType}`;
    const group = buckets.get(key) ?? { teamId: props.normalizeTeam(player.teamId), vehicleType, count: 0 };
    group.count += 1;
    buckets.set(key, group);
  }
  return [...buckets.values()].sort((a, b) => a.vehicleType.localeCompare(b.vehicleType));
});

const vehicleGroups = computed(() => props.vehicleGroups?.length ? props.vehicleGroups : teamVehicleGroups.value);

function getPlayerKey(player: BzssCoreTrackedPlayerInfo | null | undefined) {
  return props.getPlayerKey(player);
}
function getPlayerLabel(player: BzssCoreTrackedPlayerInfo | null | undefined) {
  return props.getPlayerLabel(player);
}
function getPlayerHealth(player: BzssCoreTrackedPlayerInfo | null | undefined) {
  return props.getPlayerHealth(player);
}
function normalizeTeam(teamId: number | null | undefined) {
  return props.normalizeTeam(teamId);
}
function normalizeSquad(squadId: number | null | undefined) {
  return props.normalizeSquad(squadId);
}
function isPlayerDisengaged(player: BzssCoreTrackedPlayerInfo) {
  return props.isPlayerDisengaged(player);
}
function getPerspectiveClass(teamId: number | null | undefined) {
  return props.getPerspectiveClass(teamId);
}
function getPerspectiveStyle(teamId: number | null | undefined) {
  return props.getPerspectiveStyle(teamId);
}
</script>

<style scoped>
/* ─── Base ─────────────────────────────────────────── */
.tactical-sidebar {
  position: relative;
  height: 100%;
  width: 340px;
  display: flex;
  flex-shrink: 0;
  background: radial-gradient(ellipse at 100% 0%, rgba(10, 18, 42, 0.97), rgba(4, 7, 18, 0.99));
  border-left: 1px solid rgba(0, 240, 255, 0.18);
  box-shadow: -12px 0 50px rgba(0, 0, 0, 0.9), inset 1px 0 0 rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(20px) saturate(180%);
  z-index: 30;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* ─── Toggle Tab ──────────────────────────────────── */
.sidebar-toggle-tab {
  position: absolute;
  left: -22px;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
  height: 72px;
  border: 1px solid rgba(0, 240, 255, 0.18);
  border-right: none;
  border-radius: 8px 0 0 8px;
  background: rgba(6, 11, 28, 0.95);
  color: rgba(0, 229, 255, 0.7);
  cursor: pointer;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s ease;
  font-size: 10px;
}

.sidebar-toggle-tab:hover {
  background: rgba(0, 240, 255, 0.12);
  color: #ffffff;
  box-shadow: -4px 0 14px rgba(0, 240, 255, 0.25);
}

.tab-arrow {
  line-height: 1;
}

/* ─── Content Wrapper ─────────────────────────────── */
.sidebar-content-wrapper {
  display: flex;
  flex-direction: column;
  width: 340px;
  height: 100%;
  overflow: hidden;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease;
}

.sidebar-content-wrapper.is-collapsed {
  width: 0;
  opacity: 0;
  pointer-events: none;
}

/* ─── Header ──────────────────────────────────────── */
.sidebar-header {
  padding: 12px 14px 10px;
  background: linear-gradient(180deg, rgba(0, 240, 255, 0.04) 0%, transparent 100%);
  border-bottom: 1px solid rgba(0, 240, 255, 0.1);
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
}

.header-led-block {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-led-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.pulse-led {
  background-color: #00ff66;
  box-shadow: 0 0 10px #00ff66, 0 0 20px rgba(0, 255, 102, 0.4);
  animation: led-glow 2s infinite alternate;
}

@keyframes led-glow {
  from { filter: brightness(0.7); box-shadow: 0 0 6px #00ff66; }
  to   { filter: brightness(1.3); box-shadow: 0 0 14px #00ff66, 0 0 28px rgba(0, 255, 102, 0.5); }
}

.header-text {
  flex: 1;
  min-width: 0;
}

.sidebar-title {
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 2px;
  color: #e2e8f0;
  text-transform: uppercase;
}

.sidebar-subtitle {
  font-size: 10px;
  color: rgba(0, 240, 255, 0.6);
  margin-top: 1px;
}

/* Quick stats row */
.header-quick-stats {
  display: flex;
  align-items: center;
  gap: 0;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  overflow: hidden;
}

.qs-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 12px;
  flex: 1;
  gap: 2px;
}

.qs-sep {
  width: 1px;
  height: 30px;
  background: rgba(255, 255, 255, 0.08);
}

.qs-val {
  font-size: 13px;
  font-weight: 700;
  color: #e2e8f0;
  line-height: 1;
}

.qs-lbl {
  font-size: 9px;
  color: rgba(148, 163, 184, 0.7);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Ticket bar */
.header-ticket-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ticket-label-left,
.ticket-label-right {
  font-size: 10px;
  font-weight: 800;
  white-space: nowrap;
  color: var(--perspective-primary, #00e5ff);
}

.ticket-track {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
  display: flex;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.ticket-fill {
  height: 100%;
  transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
  background-color: var(--perspective-primary, #00e5ff);
  box-shadow: 0 0 8px var(--perspective-glow, rgba(0,229,255,0.5));
}

/* ─── Section Common ──────────────────────────────── */
.sidebar-section {
  padding: 10px 14px;
  border-bottom: 1px solid rgba(0, 240, 255, 0.07);
  flex-shrink: 0;
}

.section-title-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 0;
}

.glowing-square {
  width: 5px;
  height: 5px;
  border-radius: 1px;
  flex-shrink: 0;
}
.glowing-square.blue { background-color: #00e5ff; box-shadow: 0 0 6px #00e5ff; }

.section-title-bar h3 {
  margin: 0;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: rgba(148, 163, 184, 0.9);
  flex: 1;
}

.section-collapse-btn {
  background: none;
  border: none;
  color: rgba(148, 163, 184, 0.6);
  cursor: pointer;
  font-size: 10px;
  padding: 2px 4px;
  border-radius: 4px;
  transition: all 0.2s ease;
}
.section-collapse-btn:hover {
  color: #00e5ff;
  background: rgba(0, 240, 255, 0.08);
}

.layers-content {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
}

/* Layers grid */
.layers-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
}

.option-item-sidebar {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: all 0.2s ease;
  color: #94a3b8;
}
.option-item-sidebar:hover {
  background: rgba(0, 240, 255, 0.06);
  border-color: rgba(0, 240, 255, 0.25);
  color: #e2e8f0;
}
.option-item-sidebar.checked {
  background: rgba(0, 240, 255, 0.1);
  border-color: rgba(0, 240, 255, 0.4);
  color: #00e5ff;
}
.option-item-sidebar input[type="checkbox"] {
  appearance: none;
  width: 12px;
  height: 12px;
  border: 1.5px solid rgba(0, 240, 255, 0.4);
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.4);
  position: relative;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.18s ease;
}
.option-item-sidebar input[type="checkbox"]:checked {
  background: #00e5ff;
  border-color: #00e5ff;
  box-shadow: 0 0 6px #00e5ff;
}
.option-item-sidebar input[type="checkbox"]:checked::after {
  content: "✓";
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #040712;
  font-size: 8px;
  font-weight: 900;
}

.option-text { font-size: 11px; }

/* Option rows */
.option-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.option-row--col {
  flex-direction: column;
  align-items: flex-start;
}
.option-label {
  font-size: 11px;
  color: rgba(148, 163, 184, 0.8);
  white-space: nowrap;
  width: 32px;
  flex-shrink: 0;
}

.map-select,
.sort-select {
  flex: 1;
  border: 1px solid rgba(0, 240, 255, 0.14);
  background: rgba(0, 0, 0, 0.4);
  color: #cbd5e1;
  border-radius: 7px;
  padding: 5px 8px;
  font-size: 11px;
  transition: all 0.2s ease;
  cursor: pointer;
}
.map-select:focus,
.sort-select:focus {
  outline: none;
  border-color: #00e5ff;
  box-shadow: 0 0 10px rgba(0, 240, 255, 0.25);
}

.perspective-switch {
  display: flex;
  gap: 6px;
  width: 100%;
}
.perspective-btn {
  flex: 1;
  border: 1px solid rgba(0, 240, 255, 0.12);
  background: rgba(255, 255, 255, 0.03);
  color: #94a3b8;
  border-radius: 7px;
  padding: 6px 8px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.perspective-btn:hover { background: rgba(0, 240, 255, 0.08); color: #fff; }
.perspective-btn.active {
  border-color: var(--perspective-primary, #00e5ff);
  background: rgba(0, 240, 255, 0.15);
  color: #ffffff;
  box-shadow: 0 0 8px rgba(0, 240, 255, 0.15);
}

.perspective-summary {
  font-size: 10px;
  color: rgba(148, 163, 184, 0.8);
  padding: 2px 0;
}

.scale-slider {
  flex: 1;
  -webkit-appearance: none;
  height: 3px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  outline: none;
}
.scale-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #00e5ff;
  box-shadow: 0 0 6px #00e5ff;
  cursor: pointer;
  transition: transform 0.1s ease;
}
.scale-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
.scale-val {
  width: 40px;
  text-align: right;
  font-size: 11px;
}

/* ─── Tab Navigation ──────────────────────────────── */
.sidebar-tabs-directory {
  display: flex;
  gap: 0;
  padding: 0 8px;
  border-bottom: 1px solid rgba(0, 240, 255, 0.08);
  background: rgba(0, 0, 0, 0.15);
  flex-shrink: 0;
}

.directory-tab-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 4px 7px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: rgba(148, 163, 184, 0.65);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 11px;
  font-weight: 600;
  position: relative;
}
.directory-tab-btn .tab-icon { font-size: 15px; line-height: 1; }
.directory-tab-btn .tab-name { font-size: 9px; letter-spacing: 0.3px; text-transform: uppercase; }

.directory-tab-btn:hover {
  color: #e2e8f0;
  background: rgba(0, 240, 255, 0.05);
}
.directory-tab-btn.active {
  color: #00e5ff;
  border-bottom-color: #00e5ff;
  background: rgba(0, 240, 255, 0.07);
}
.directory-tab-btn.active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 20%;
  right: 20%;
  height: 2px;
  background: #00e5ff;
  box-shadow: 0 0 8px #00e5ff;
  border-radius: 1px;
}

/* ─── Tab Section ─────────────────────────────────── */
.sidebar-tab-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 10px 12px;
}

/* ─── Overview ────────────────────────────────────── */
.sidebar-overview {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
}
.overview-card {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.overview-card-title {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: rgba(148, 163, 184, 0.8);
  margin-bottom: 8px;
}
.overview-grid { display: flex; flex-direction: column; gap: 6px; }
.overview-line {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: rgba(148, 163, 184, 0.8);
}
.overview-line strong { color: #e2e8f0; font-weight: 600; }

.overview-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.quick-action-btn {
  flex: 1;
  border: 1px solid rgba(0, 240, 255, 0.15);
  background: rgba(255, 255, 255, 0.03);
  color: #94a3b8;
  border-radius: 7px;
  padding: 7px 8px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}
.quick-action-btn:hover {
  background: rgba(0, 240, 255, 0.08);
  border-color: rgba(0, 240, 255, 0.35);
  color: #ffffff;
}

/* ─── Scroll container ────────────────────────────── */
.sidebar-scroll {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sidebar-scroll::-webkit-scrollbar { width: 4px; }
.sidebar-scroll::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.02); }
.sidebar-scroll::-webkit-scrollbar-thumb {
  background: rgba(0, 240, 255, 0.2);
  border-radius: 2px;
}
.sidebar-scroll::-webkit-scrollbar-thumb:hover { background: rgba(0, 240, 255, 0.4); }

/* ─── Units ───────────────────────────────────────── */
.sidebar-search-row {
  display: flex;
  gap: 6px;
}
.sidebar-search-input {
  flex: 1;
  border: 1px solid rgba(0, 240, 255, 0.14);
  background: rgba(0, 0, 0, 0.4);
  color: #cbd5e1;
  border-radius: 7px;
  padding: 7px 10px;
  font-size: 11px;
  transition: all 0.2s ease;
}
.sidebar-search-input:focus {
  outline: none;
  border-color: #00e5ff;
  box-shadow: 0 0 10px rgba(0, 240, 255, 0.25);
}

.filter-pill-row,
.unit-mode-tabs,
.sidebar-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.filter-pill,
.mode-chip {
  border: 1px solid rgba(0, 240, 255, 0.14);
  background: rgba(255, 255, 255, 0.03);
  color: #94a3b8;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.filter-pill:hover, .mode-chip:hover {
  background: rgba(0, 240, 255, 0.07);
  border-color: rgba(0, 240, 255, 0.3);
  color: #e2e8f0;
}
.filter-pill.active, .mode-chip.active {
  color: #00e5ff;
  border-color: #00e5ff;
  background: rgba(0, 240, 255, 0.1);
  box-shadow: 0 0 8px rgba(0, 240, 255, 0.15);
}

.tab-btn {
  border: 1px solid rgba(0, 240, 255, 0.14);
  background: rgba(255, 255, 255, 0.03);
  color: #94a3b8;
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  flex: 1;
}
.tab-btn:hover {
  background: rgba(0, 240, 255, 0.08);
  border-color: rgba(0, 240, 255, 0.35);
  color: #fff;
}
.tab-btn.active {
  color: #ffffff;
  border-color: var(--perspective-primary, #00e5ff);
  background: rgba(0, 240, 255, 0.15);
  box-shadow: 0 0 12px rgba(0, 240, 255, 0.2);
}

/* ─── Sidebar Lists ───────────────────────────────── */
.sidebar-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sidebar-squad-card {
  text-align: left;
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(6, 11, 28, 0.4);
  color: inherit;
  border-radius: 10px;
  padding: 10px 12px;
  box-sizing: border-box;
  transition: all 0.22s ease;
  cursor: pointer;
}
.sidebar-squad-card:hover {
  border-color: rgba(0, 240, 255, 0.3);
  background: rgba(6, 11, 28, 0.65);
  box-shadow: 0 4px 14px rgba(0, 240, 255, 0.1);
  transform: translateY(-1px);
}
.sidebar-squad-card.is-focused {
  border-color: rgba(0, 240, 255, 0.5);
  box-shadow: 0 0 14px rgba(0, 240, 255, 0.2);
  background: rgba(0, 240, 255, 0.07);
}

.squad-card-header,
.squad-card-meta,
.asset-row-title,
.asset-bar-line {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: space-between;
}
.squad-card-meta {
  margin-top: 6px;
  align-items: flex-start;
  flex-direction: column;
  gap: 4px;
}
.squad-health-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}
.mini-bar-track {
  flex: 1;
  height: 5px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
}
.mini-bar-fill {
  height: 100%;
  border-radius: inherit;
  transition: width 0.3s ease;
}

.sidebar-player-card-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: rgba(6, 11, 28, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-left: 3px solid var(--perspective-primary, rgba(0, 240, 255, 0.4));
  border-radius: 9px;
  transition: all 0.22s ease;
  box-sizing: border-box;
  text-align: left;
  cursor: pointer;
}
.sidebar-player-card-row:hover {
  background: rgba(6, 11, 28, 0.7);
  border-color: var(--perspective-primary, #00e5ff);
  box-shadow: 0 3px 12px rgba(0, 240, 255, 0.12);
  transform: translateY(-1px);
}
.sidebar-player-card-row.is-focused {
  background: rgba(0, 240, 255, 0.06);
  border-color: var(--perspective-primary, #00e5ff);
  box-shadow: 0 4px 18px rgba(0, 240, 255, 0.2);
}

.player-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.player-name {
  font-size: 12px;
  font-weight: 700;
  color: #f1f5f9;
  display: flex;
  align-items: center;
  gap: 5px;
}
.sl-badge-pill {
  font-size: 8px;
  font-weight: 900;
  padding: 1px 4px;
  background: #f59e0b;
  color: #0f172a;
  border-radius: 3px;
}
.player-squad-tag {
  font-size: 10px;
  font-weight: 800;
  color: var(--perspective-primary, #00e5ff);
  font-family: monospace;
}
.player-card-body {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.player-health-bar-container {
  width: 100%;
  height: 3px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: hidden;
}
.player-health-bar-fill {
  height: 100%;
  border-radius: inherit;
  transition: width 0.3s ease;
}
.player-status-row {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 10px;
  color: #94a3b8;
  flex-wrap: wrap;
}
.player-hp-value { font-size: 10px; font-weight: bold; }
.player-kit { color: rgba(226, 232, 240, 0.8); }
.player-vehicle-badge {
  font-size: 9px;
  padding: 1px 5px;
  background: rgba(0, 240, 255, 0.1);
  border: 1px solid rgba(0, 240, 255, 0.28);
  color: #00e5ff;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 3px;
}
.vehicle-icon-mini { font-size: 8px; }

.disengaged-sidebar-tag,
.bzss-badge {
  padding: 1px 5px;
  border-radius: 999px;
  font-size: 9px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.glowing-tag {
  background: rgba(251, 191, 36, 0.1);
  border-color: rgba(251, 191, 36, 0.3);
  color: #fbbf24;
}

/* ─── Assets ──────────────────────────────────────── */
.asset-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.asset-group-title {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: rgba(148, 163, 184, 0.7);
}
.asset-row {
  text-align: left;
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(6, 11, 28, 0.35);
  color: inherit;
  border-radius: 9px;
  padding: 9px 11px;
  box-sizing: border-box;
  transition: all 0.22s ease;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  gap: 8px;
}
.asset-row:hover {
  border-color: rgba(0, 240, 255, 0.3);
  background: rgba(6, 11, 28, 0.65);
  box-shadow: 0 3px 12px rgba(0, 240, 255, 0.1);
  transform: translateY(-1px);
}
.asset-row--stacked {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}
.asset-bars { display: flex; flex-direction: column; gap: 5px; }
.asset-bar-line {
  font-size: 10px;
  color: rgba(148, 163, 184, 0.9);
  gap: 6px;
}
.asset-meta { color: rgba(148, 163, 184, 0.8); font-size: 11px; }

.bzss-team-indicator {
  font-size: 9px;
  font-weight: 800;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.07);
}
.team-ind-1 { color: #00e5ff; border: 1px solid rgba(0, 229, 255, 0.3); }
.team-ind-2 { color: #ff6b35; border: 1px solid rgba(255, 107, 53, 0.3); }

.bzss-fill-hp    { background: #4caf50; }
.bzss-fill-ammo  { background: #00e5ff; }
.bzss-fill-const { background: #ffa726; }

.bzss-badge--ok     { color: #4ade80; }
.bzss-badge--warn   { color: #facc15; }
.bzss-badge--danger { color: #f87171; }

/* ─── Core ────────────────────────────────────────── */
.bzss-info-card {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.bzss-card-title {
  font-size: 11px;
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(148, 163, 184, 0.9);
}
.bzss-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.bzss-stats-grid { display: flex; flex-direction: column; gap: 6px; }
.bzss-stat-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 11px;
}
.bzss-stat-label { color: rgba(148, 163, 184, 0.8); }
.bzss-raw-fields { display: flex; flex-wrap: wrap; gap: 5px; }
.bzss-raw-field-tag {
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 10px;
}

/* ─── Feed / Combat Log ───────────────────────────── */
.combat-log-console {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 100%;
  overflow: auto;
}
.console-log-line {
  padding: 7px 9px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 11px;
  line-height: 1.4;
}
.log-time { color: rgba(148, 163, 184, 0.7); margin-right: 5px; }

/* ─── Common Helpers ──────────────────────────────── */
.empty-state {
  padding: 12px;
  color: rgba(148, 163, 184, 0.7);
  text-align: center;
  font-size: 12px;
}
.monospace { font-family: monospace; }
.font-mono { font-family: monospace; }
.text-cyan  { color: #00e5ff; }
.text-green { color: #4caf50; }
.text-yellow { color: #fbc02d; }

.pulsing-text { animation: stat-pulse 1.8s infinite alternate; }
@keyframes stat-pulse {
  from { opacity: 0.45; }
  to   { opacity: 1; }
}

.squad-number { font-size: 11px; font-weight: 700; color: rgba(148, 163, 184, 0.8); }
.squad-name   { flex: 1; font-size: 12px; font-weight: 600; color: #e2e8f0; text-align: left; }
.squad-members-count { font-size: 11px; color: rgba(148, 163, 184, 0.8); }
.sl-name      { font-size: 10px; color: rgba(148, 163, 184, 0.8); }
.health-label { font-size: 10px; color: rgba(148, 163, 184, 0.7); }
.health-num   { font-size: 10px; }

/* ─── Responsive ──────────────────────────────────── */
@media (max-width: 900px) {
  .tactical-sidebar {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: min(92vw, 340px);
  }
}
</style>
