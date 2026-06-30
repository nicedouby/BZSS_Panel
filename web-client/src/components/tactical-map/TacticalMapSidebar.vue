<template>
  <aside class="tactical-sidebar" :data-mode="sidebarModeClass">
    <button v-if="sidebarMode !== 'expanded'" class="sidebar-toggle-tab" type="button" @click="toggleExpanded">
      <span class="tab-arrow">{{ sidebarMode === 'hidden' ? '◀' : '⮜' }}</span>
    </button>

    <div v-if="sidebarMode !== 'hidden'" class="sidebar-content-wrapper">
      <header class="sidebar-header glass-panel">
        <div class="sidebar-title-block">
          <div class="header-led-indicator pulse-led"></div>
          <div>
            <div class="sidebar-title">TACTICAL COMMAND PANEL</div>
            <div class="sidebar-subtitle">Overview / Units / Assets / Core / Feed</div>
          </div>
        </div>
        <div class="sidebar-mode-switch">
          <button type="button" class="mode-btn" :class="{ active: sidebarMode === 'compact' }" @click="setSidebarMode('compact')">Compact</button>
          <button type="button" class="mode-btn" :class="{ active: sidebarMode === 'expanded' }" @click="setSidebarMode('expanded')">Expanded</button>
        </div>
      </header>

      <section class="sidebar-section border-b">
        <div class="section-title-bar">
          <span class="glowing-square blue"></span>
          <h3>Server Overview</h3>
        </div>
        <div class="server-stats-grid monospace">
          <div class="server-stat-item">
            <span class="lbl">Online</span>
            <span class="val text-cyan">{{ serverPlayerCount }}</span>
          </div>
          <div class="server-stat-item">
            <span class="lbl">Map</span>
            <span class="val">{{ serverMapName }}</span>
          </div>
          <div class="server-stat-item">
            <span class="lbl">Status</span>
            <span class="val text-green pulsing-text">{{ statusText }}</span>
          </div>
          <div class="server-stat-item">
            <span class="lbl">Phase</span>
            <span class="val">{{ matchPhase }}</span>
          </div>
        </div>
        <div class="tickets-row">
          <div class="ticket-pill tone-friendly" :style="getPerspectiveStyle(1)">T1 {{ tickets.team1 }}</div>
          <div class="ticket-pill tone-enemy" :style="getPerspectiveStyle(2)">T2 {{ tickets.team2 }}</div>
        </div>
      </section>

      <section class="sidebar-section border-b">
        <div class="section-title-bar">
          <span class="glowing-square blue"></span>
          <h3>Layers</h3>
        </div>
        <div class="options-group-sidebar layers-grid">
          <label class="option-item-sidebar"><input v-model="showGridModel" type="checkbox" /><span class="option-text">Grid</span></label>
          <label class="option-item-sidebar"><input v-model="showPlayerNamesModel" type="checkbox" /><span class="option-text">Names</span></label>
          <label class="option-item-sidebar"><input v-model="showPlayerCoordsModel" type="checkbox" /><span class="option-text">Coords</span></label>
          <label class="option-item-sidebar"><input v-model="showCaptureZonesModel" type="checkbox" /><span class="option-text">Zones</span></label>
          <label class="option-item-sidebar"><input v-model="showFobsModel" type="checkbox" /><span class="option-text">FOBs</span></label>
          <label class="option-item-sidebar"><input v-model="disableMarkerInteractionModel" type="checkbox" /><span class="option-text">Pass-through</span></label>
          <label class="option-item-sidebar"><input v-model="measureModeModel" type="checkbox" /><span class="option-text">Measure</span></label>
          <div class="option-item-slider">
            <span class="option-text">Map</span>
            <select v-model="selectedMapKeyModel" class="map-select">
              <option value="auto">Auto ({{ detectedMapName }})</option>
              <option v-for="map in mapOptions" :key="map.key" :value="map.key">{{ map.name }}</option>
            </select>
          </div>
          <div class="option-item-slider option-item-slider--stacked">
            <span class="option-text">Perspective</span>
            <div class="perspective-switch">
              <button type="button" class="perspective-btn" :class="{ active: viewerPerspectiveModeModel === 'auto' }" @click="viewerPerspectiveModeModel = 'auto'">Auto</button>
              <button type="button" class="perspective-btn tone-friendly" :class="{ active: viewerPerspectiveModeModel === 'team1' }" :style="getPerspectiveStyle(1)" @click="viewerPerspectiveModeModel = 'team1'">TEAM 1</button>
              <button type="button" class="perspective-btn tone-enemy" :class="{ active: viewerPerspectiveModeModel === 'team2' }" :style="getPerspectiveStyle(2)" @click="viewerPerspectiveModeModel = 'team2'">TEAM 2</button>
            </div>
          </div>
          <div class="perspective-summary">{{ perspectiveSummaryText }}</div>
          <div class="option-item-slider">
            <span class="option-text">Marker</span>
            <input v-model.number="markerScaleModel" type="range" min="0.05" max="2" step="0.05" class="scale-slider" />
            <span class="scale-val">{{ markerScaleModel.toFixed(2) }}x</span>
          </div>
        </div>
      </section>

      <section class="sidebar-section flex-expand border-b">
        <div class="sidebar-tabs-directory">
          <button class="directory-tab-btn" :class="{ active: sidebarTab === 'overview' }" @click="sidebarTabModel = 'overview'">Overview</button>
          <button class="directory-tab-btn" :class="{ active: sidebarTab === 'units' }" @click="sidebarTabModel = 'units'">Units</button>
          <button class="directory-tab-btn" :class="{ active: sidebarTab === 'assets' }" @click="sidebarTabModel = 'assets'">Assets</button>
          <button class="directory-tab-btn" :class="{ active: sidebarTab === 'core' }" @click="sidebarTabModel = 'core'">Core</button>
          <button class="directory-tab-btn" :class="{ active: sidebarTab === 'feed' }" @click="sidebarTabModel = 'feed'">Feed</button>
        </div>

        <div v-if="sidebarTab === 'overview'" class="sidebar-overview">
          <div class="overview-card">
            <div class="overview-card-title">Server / BZSS Core</div>
            <div class="overview-grid">
              <div class="overview-line"><span>Players</span><strong>{{ serverPlayerCount }}</strong></div>
              <div class="overview-line"><span>Phase</span><strong>{{ matchPhase }}</strong></div>
              <div class="overview-line"><span>BZSS</span><strong :class="bzssCoreStatusClass">{{ bzssCoreStatusLabel }}</strong></div>
              <div class="overview-line"><span>Updated</span><strong>{{ bzssCoreUpdatedAtText }}</strong></div>
            </div>
          </div>
          <div class="overview-card">
            <div class="overview-card-title">Quick Actions</div>
            <div class="overview-actions">
              <button type="button" class="quick-action-btn" @click="sidebarTabModel = 'units'">Search players</button>
              <button type="button" class="quick-action-btn" @click="sidebarTabModel = 'assets'">Inspect assets</button>
              <button type="button" class="quick-action-btn" @click="sidebarTabModel = 'core'">Open core</button>
            </div>
          </div>
        </div>

        <div v-else-if="sidebarTab === 'units'" class="sidebar-scroll">
          <div class="sidebar-search-row">
            <input v-model="sidebarSearchModel" class="sidebar-search-input" type="search" placeholder="Search player, squad, SteamID, kit..." />
            <select v-model="sidebarSortModeModel" class="map-select">
              <option value="squad">Squad</option>
              <option value="name">Name</option>
              <option value="health">Health</option>
              <option value="distance">Distance</option>
              <option value="vehicle">Vehicle</option>
            </select>
          </div>
          <div class="filter-pill-row">
            <button type="button" class="filter-pill" :class="{ active: sidebarOnlyAliveModel }" @click="sidebarOnlyAliveModel = !sidebarOnlyAliveModel">Alive only</button>
            <button type="button" class="filter-pill" :class="{ active: sidebarOnlyVehicleModel }" @click="sidebarOnlyVehicleModel = !sidebarOnlyVehicleModel">Vehicles only</button>
          </div>
          <div class="sidebar-tabs">
            <button type="button" class="tab-btn" :class="[getPerspectiveClass(1), { active: activeTeamTab === 1 }]" :style="getPerspectiveStyle(1)" @click="activeTeamTabModel = 1">TEAM 1</button>
            <button type="button" class="tab-btn" :class="[getPerspectiveClass(2), { active: activeTeamTab === 2 }]" :style="getPerspectiveStyle(2)" @click="activeTeamTabModel = 2">TEAM 2</button>
          </div>
          <div class="unit-mode-tabs">
            <button type="button" class="mode-chip" :class="{ active: sidebarUnitMode === 'squads' }" @click="sidebarUnitModeModel = 'squads'">Squads</button>
            <button type="button" class="mode-chip" :class="{ active: sidebarUnitMode === 'players' }" @click="sidebarUnitModeModel = 'players'">Players</button>
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
            <div v-if="!currentTeamSquads.length" class="empty-state">No squads</div>
          </div>

          <div v-else class="sidebar-list">
            <button
              v-for="player in filteredTeamPlayers"
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
              <span class="player-name-row">
                {{ getPlayerLabel(player) }}
                <span v-if="isPlayerDisengaged(player)" class="disengaged-sidebar-tag">Disengaged</span>
              </span>
              <span class="player-meta-row">
                S{{ normalizeSquad(player.squadId) }} / HP {{ getPlayerHealth(player) ?? '-' }}
                <template v-if="player.vehicleInfo?.vehicleType"> / {{ player.vehicleInfo.vehicleType }}</template>
              </span>
            </button>
            <div v-if="!filteredTeamPlayers.length" class="empty-state">No players</div>
          </div>
        </div>

        <div v-else-if="sidebarTab === 'assets'" class="sidebar-scroll">
          <div class="asset-group">
            <div class="asset-group-title">Capture Zones</div>
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
            <div v-if="!captureZoneMarkers.length" class="empty-state">No zones</div>
          </div>

          <div class="asset-group">
            <div class="asset-group-title">FOB Radio</div>
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
                <span v-if="fob.isBleeding" class="bzss-badge bzss-badge--danger">BLEEDING</span>
              </div>
              <div class="asset-bars">
                <div class="asset-bar-line">
                  <span>HP</span>
                  <div class="mini-bar-track"><div class="mini-bar-fill bzss-fill-hp" :style="{ width: `${Math.round((fob.health ?? 0) * 100)}%` }"></div></div>
                  <span>{{ Math.round((fob.health ?? 0) * 100) }}%</span>
                </div>
                <div class="asset-bar-line">
                  <span>Ammo</span>
                  <div class="mini-bar-track"><div class="mini-bar-fill bzss-fill-ammo" :style="{ width: `${Math.min(100, Math.round((fob.ammo ?? 0) / 100))}%` }"></div></div>
                  <span>{{ Math.round(fob.ammo ?? 0) }}</span>
                </div>
                <div class="asset-bar-line">
                  <span>Const</span>
                  <div class="mini-bar-track"><div class="mini-bar-fill bzss-fill-const" :style="{ width: `${Math.min(100, Math.round((fob.construction ?? 0) / 20))}%` }"></div></div>
                  <span>{{ Math.round(fob.construction ?? 0) }}</span>
                </div>
              </div>
            </button>
            <div v-if="!fobMarkers.length" class="empty-state">No FOBs</div>
          </div>

          <div class="asset-group">
            <div class="asset-group-title">Vehicles</div>
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
            <div v-if="!vehicleGroups.length" class="empty-state">No vehicles</div>
          </div>
        </div>

        <div v-else-if="sidebarTab === 'core'" class="sidebar-scroll">
          <div class="bzss-info-card">
            <div class="bzss-card-title">
              <span class="bzss-status-dot" :class="bzssCoreStatusClass"></span>
              Core Status
            </div>
            <div class="bzss-stats-grid">
              <div class="bzss-stat-row"><span class="bzss-stat-label">Status</span><span class="bzss-stat-value" :class="bzssCoreStatusClass">{{ bzssCoreStatusLabel }}</span></div>
              <div class="bzss-stat-row"><span class="bzss-stat-label">Revision</span><span class="bzss-stat-value font-mono">Rev {{ snapshot?.state?.revision ?? '--' }}</span></div>
              <div class="bzss-stat-row"><span class="bzss-stat-label">Updated</span><span class="bzss-stat-value font-mono">{{ bzssCoreUpdatedAtText }}</span></div>
              <div class="bzss-stat-row"><span class="bzss-stat-label">Marker</span><span class="bzss-stat-value"><span v-if="snapshot?.state?.markerSeen" class="bzss-badge bzss-badge--ok">Seen</span><span v-else class="bzss-badge bzss-badge--warn">Missing</span></span></div>
            </div>
          </div>
          <div class="bzss-info-card">
            <div class="bzss-card-title">Player Counts</div>
            <div class="bzss-stats-grid">
              <div class="bzss-stat-row"><span class="bzss-stat-label">Runtime</span><span class="bzss-stat-value text-cyan font-mono">{{ snapshot?.state?.runtimePlayerCount ?? 0 }}</span></div>
              <div class="bzss-stat-row"><span class="bzss-stat-label">Scoreboard</span><span class="bzss-stat-value text-yellow font-mono">{{ snapshot?.state?.scoreboardPlayerCount ?? 0 }}</span></div>
              <div class="bzss-stat-row"><span class="bzss-stat-label">Placed</span><span class="bzss-stat-value text-cyan font-mono">{{ positionedPlayerCount }}</span></div>
              <div class="bzss-stat-row"><span class="bzss-stat-label">Alive</span><span class="bzss-stat-value text-green font-mono">{{ bzssCoreAliveCount }}</span></div>
            </div>
          </div>
          <div class="bzss-info-card" v-if="rawFields?.length">
            <div class="bzss-card-title">Raw Fields</div>
            <div class="bzss-raw-fields">
              <code v-for="(field, idx) in rawFields" :key="`rf-${idx}`" class="bzss-raw-field-tag">{{ field }}</code>
            </div>
          </div>
          <div v-if="lastError" class="bzss-info-card bzss-info-card--error">
            <div class="bzss-card-title">Last Error</div>
            <div class="bzss-error-text font-mono">{{ lastError }}</div>
          </div>
        </div>

        <div v-else class="sidebar-scroll">
          <div class="combat-log-console">
            <div v-for="(log, idx) in combatLogs" :key="`log-${idx}`" class="console-log-line monospace" :class="log.type">
              <span class="log-time">[{{ log.time }}]</span>
              <span class="log-body" v-html="log.text"></span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <button v-else class="sidebar-toggle-tab sidebar-toggle-tab--hidden" type="button" @click="setSidebarMode('compact')">
      <span class="tab-arrow">⮞</span>
    </button>
  </aside>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { BzssCoreCaptureZoneInfo, BzssCoreFobInfo, BzssCorePlayerInfoResponse, BzssCoreTrackedPlayerInfo } from "../../app/bzssCoreApi";

type SidebarMode = "expanded" | "compact" | "hidden";
type SidebarTab = "overview" | "units" | "assets" | "core" | "feed";
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
}>();

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

const sidebarMode = computed({
  get: () => props.sidebarMode,
  set: (value: SidebarMode) => emit("update:sidebar-mode", value),
});
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

function setSidebarMode(mode: SidebarMode) {
  sidebarMode.value = mode;
}

function toggleExpanded() {
  setSidebarMode(props.sidebarMode === "hidden" ? "expanded" : "expanded");
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
    if (props.sidebarOnlyAlive && !(props.getPlayerHealth(player) ?? 0 > 0)) return false;
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
      const ax = da?.x ?? 0;
      const ay = da?.y ?? 0;
      const bx = db?.x ?? 0;
      const by = db?.y ?? 0;
      return Math.hypot(ax, ay) - Math.hypot(bx, by);
    }
    const sa = props.normalizeSquad(a.squadId);
    const sb = props.normalizeSquad(b.squadId);
    return sa - sb || props.getPlayerLabel(a).localeCompare(props.getPlayerLabel(b));
  });
});

const sidebarModeClass = computed(() => props.sidebarMode);

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
.tactical-sidebar {
  position: relative;
  height: 100%;
  width: 360px;
  display: flex;
  flex-direction: column;
  background: rgba(4, 7, 18, 0.93);
  border-left: 1px solid rgba(0, 240, 255, 0.15);
  box-shadow: -10px 0 30px rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(16px);
  z-index: 30;
  transition: width 0.28s ease, transform 0.28s ease;
}

.tactical-sidebar[data-mode="compact"] {
  width: 68px;
}

.tactical-sidebar[data-mode="hidden"] {
  width: 0;
  transform: translateX(100%);
  pointer-events: none;
}

.sidebar-toggle-tab {
  position: absolute;
  left: -24px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 80px;
  border: 1px solid rgba(0, 240, 255, 0.15);
  border-right: none;
  border-radius: 8px 0 0 8px;
  background: rgba(4, 7, 18, 0.93);
  color: #00e5ff;
  z-index: 2;
}

.sidebar-toggle-tab--hidden {
  left: auto;
  right: -24px;
}

.sidebar-content-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.glass-panel {
  background: rgba(6, 11, 28, 0.75);
  border: 1px solid rgba(0, 240, 255, 0.15);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), inset 0 0 10px rgba(0, 240, 255, 0.05);
  backdrop-filter: blur(12px) saturate(160%);
}

.sidebar-header {
  margin: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sidebar-title-block {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-led-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.pulse-led {
  background-color: #00ff66;
  box-shadow: 0 0 10px #00ff66, 0 0 18px #00ff66;
}

.sidebar-title {
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 1px;
}

.sidebar-subtitle {
  font-size: 11px;
  color: rgba(0, 240, 255, 0.7);
}

.sidebar-mode-switch,
.tickets-row,
.filter-pill-row,
.unit-mode-tabs,
.overview-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.mode-btn,
.filter-pill,
.mode-chip,
.quick-action-btn {
  border: 1px solid rgba(0, 240, 255, 0.16);
  background: rgba(255, 255, 255, 0.04);
  color: #cbd5e1;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
}

.mode-btn.active,
.filter-pill.active,
.mode-chip.active {
  color: #00e5ff;
  border-color: #00e5ff;
  background: rgba(0, 240, 255, 0.12);
}

.sidebar-section {
  padding: 14px 14px 12px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.flex-expand {
  flex: 1;
}

.border-b {
  border-bottom: 1px solid rgba(0, 240, 255, 0.08);
}

.section-title-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.glowing-square {
  width: 6px;
  height: 6px;
  border-radius: 1px;
}

.glowing-square.blue { background-color: #00e5ff; box-shadow: 0 0 8px #00e5ff; }

.section-title-bar h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.server-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.server-stat-item {
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 10px;
}

.lbl,
.val {
  display: block;
  line-height: 1.25;
}

.lbl {
  font-size: 10px;
  color: rgba(148, 163, 184, 0.9);
}

.val {
  margin-top: 3px;
  font-size: 13px;
}

.text-cyan { color: #00e5ff; }
.text-green { color: #4caf50; }
.text-yellow { color: #fbc02d; }

.pulsing-text {
  animation: stat-pulse 1.8s infinite alternate;
}

@keyframes stat-pulse {
  from { opacity: 0.45; }
  to { opacity: 1; }
}

.tickets-row {
  margin-top: 10px;
}

.ticket-pill {
  flex: 1;
  text-align: center;
  border-radius: 999px;
  padding: 8px 10px;
  font-weight: 800;
}

.sidebar-tabs-directory,
.sidebar-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.directory-tab-btn,
.tab-btn {
  border: 1px solid rgba(0, 240, 255, 0.12);
  background: rgba(255, 255, 255, 0.03);
  color: #cbd5e1;
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 12px;
}

.directory-tab-btn.active,
.tab-btn.active {
  color: #ffffff;
  border-color: rgba(0, 240, 255, 0.4);
  background: rgba(0, 240, 255, 0.12);
}

.sidebar-search-row {
  display: flex;
  gap: 8px;
  margin: 10px 0;
}

.sidebar-search-input,
.map-select {
  width: 100%;
  border: 1px solid rgba(0, 240, 255, 0.12);
  background: rgba(255, 255, 255, 0.03);
  color: #e2e8f0;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
}

.layers-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.option-item-sidebar {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.option-item-slider {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.option-item-slider--stacked {
  align-items: flex-start;
  flex-direction: column;
}

.option-text {
  font-size: 12px;
}

.perspective-switch {
  display: flex;
  gap: 8px;
  width: 100%;
}

.perspective-btn {
  flex: 1;
  border: 1px solid rgba(0, 240, 255, 0.12);
  background: rgba(255, 255, 255, 0.03);
  color: #cbd5e1;
  border-radius: 8px;
  padding: 8px 10px;
}

.perspective-summary {
  font-size: 11px;
  color: rgba(148, 163, 184, 0.9);
}

.scale-slider {
  flex: 1;
}

.scale-val {
  width: 44px;
  text-align: right;
  font-family: monospace;
}

.sidebar-scroll {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sidebar-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sidebar-squad-card,
.sidebar-player-card-row,
.asset-row {
  text-align: left;
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
  color: inherit;
  border-radius: 12px;
  padding: 10px;
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
  margin-top: 8px;
  align-items: flex-start;
  flex-direction: column;
}

.squad-health-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.mini-bar-track {
  flex: 1;
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
}

.mini-bar-fill {
  height: 100%;
  border-radius: inherit;
}

.sidebar-player-card-row.is-focused,
.sidebar-squad-card.is-focused,
.asset-row:hover {
  border-color: rgba(0, 240, 255, 0.35);
  box-shadow: 0 0 0 1px rgba(0, 240, 255, 0.15) inset;
}

.player-name-row,
.player-meta-row {
  display: block;
}

.player-meta-row {
  margin-top: 4px;
  color: rgba(148, 163, 184, 0.9);
  font-size: 11px;
}

.disengaged-sidebar-tag,
.bzss-badge {
  margin-left: 6px;
  padding: 2px 5px;
  border-radius: 999px;
  font-size: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.asset-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.asset-group-title,
.overview-card-title {
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.asset-row--stacked {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.asset-bars {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.asset-bar-line {
  font-size: 11px;
  color: rgba(148, 163, 184, 0.9);
}

.asset-meta {
  color: rgba(148, 163, 184, 0.9);
}

.overview-card {
  padding: 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.overview-grid {
  display: grid;
  gap: 8px;
  margin-top: 8px;
}

.overview-line {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}

.overview-actions {
  margin-top: 8px;
}

.quick-action-btn {
  flex: 1;
}

.bzss-info-card {
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bzss-card-title {
  font-size: 12px;
  font-weight: 800;
  display: flex;
  align-items: center;
  gap: 8px;
}

.bzss-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.bzss-stats-grid {
  display: grid;
  gap: 8px;
}

.bzss-stat-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}

.bzss-stat-label {
  color: rgba(148, 163, 184, 0.9);
}

.bzss-badge--ok { color: #4ade80; }
.bzss-badge--warn { color: #facc15; }
.bzss-badge--danger { color: #f87171; }

.bzss-raw-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.bzss-raw-field-tag {
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
}

.combat-log-console {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 100%;
  overflow: auto;
}

.console-log-line {
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 12px;
}

.log-time {
  color: rgba(148, 163, 184, 0.9);
  margin-right: 6px;
}

.empty-state {
  padding: 12px;
  color: rgba(148, 163, 184, 0.9);
  text-align: center;
}

@media (max-width: 900px) {
  .tactical-sidebar {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: min(92vw, 380px);
  }
  .tactical-sidebar[data-mode="compact"] {
    width: 56px;
  }
}
</style>
