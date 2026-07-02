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
        :class="{ 'is-dragging': isDragging }"
        :style="{
          cursor: isDragging ? 'grabbing' : 'grab'
        }"
      >
        <!-- Tiled Map Renderer -->
        <div class="tiled-map-wrapper">
          <TiledMapRenderer
            :tile-base-path="activeMapConfig.tileBasePath"
            :max-zoom="activeMapConfig.maxZoomLevel"
            :tiles-enabled="true"
            :viewport-width="vpWidth"
            :viewport-height="vpHeight"
            :fallback-image="activeMapConfig.image"
          />
        </div>

        <!-- Canvas Renderer Overlay (V2 Player Markers) -->
          <TacticalCanvasRenderer
            :players="filteredPlayers"
            :viewer-team-id="viewerTeamId"
            :selected-player-key="selectedPlayerKey"
            :hovered-player-key="hoveredPlayer ? hoveredPlayer.identity?.key : null"
            :scale="dynamicMarkerScale"
            :show-player-names="showPlayerNames"
            :show-player-coords="showPlayerCoords"
            :zoom="zoom"
            :interaction-enabled="!isDragging"
            @hover-change="onCanvasHover"
            @click="onCanvasClick"
            @contextmenu="onCanvasContextMenu"
          />
        </div>

      <!-- Floating Player Hover Tooltip -->
      <div
        v-if="hoveredPlayer && hoveredPlayer.identity?.key !== selectedPlayerKey"
        class="player-tooltip-simple font-mono"
        :class="getPerspectiveClass(hoveredPlayer.teamId)"
        :style="tooltipStyle"
      >
        <div class="tooltip-main-row">
          <span class="player-name-simple">{{ getPlayerLabel(hoveredPlayer) }}</span>
          <span class="squad-simple" v-if="hoveredPlayer.match?.squadId">#{{ hoveredPlayer.match.squadId }}</span>
        </div>
        <div class="tooltip-meta-row">
          <span class="role-simple">{{ hoveredPlayer.roleInfo?.label || hoveredPlayer.match?.role || 'Unknown' }}</span>
        </div>
      </div>

      <!-- Floating Details / Action Overlays -->
      <PlayerInfoPanel
        v-if="playerInfoPanel"
        :player="playerInfoPanel.player"
        :x="playerInfoPanel.x"
        :y="playerInfoPanel.y"
        :tone="getPerspectiveTone(playerInfoPanel.player.teamId)"
        :speed-text="''"
        :rcon-detail="getPlayerRconDetail(playerInfoPanel.player)"
        :follow-status="null"
        @close="playerInfoPanel = null; selectedPlayerKey = ''"
      />

      <PlayerActionMenu
        v-if="playerActionMenu"
        :player="playerActionMenu.player"
        :x="playerActionMenu.x"
        :y="playerActionMenu.y"
        :tone="getPerspectiveTone(playerActionMenu.player.teamId)"
        :can-manage="true"
        :rcon-player="getPlayerRconDetail(playerActionMenu.player)"
        @close="playerActionMenu = null"
        @open-profile="onOpenPlayerProfile(playerActionMenu.player)"
        @focus="onFocusPlayer(playerActionMenu.player)"
        @copy-coords="onCopyPlayerCoords(playerActionMenu.player)"
        @start-measure="null"
        @warn="handlePlayerActionEmit('warn-player', playerActionMenu.player)"
        @kick="handlePlayerActionEmit('kick-player', playerActionMenu.player)"
        @force-team="handlePlayerActionEmit('force-team-player', playerActionMenu.player)"
      />

      <MapContextMenu
        v-if="mapCommandMenu"
        :x="mapCommandMenu.x"
        :y="mapCommandMenu.y"
        :game-x="mapCommandMenu.gameX"
        :game-y="mapCommandMenu.gameY"
        :map-x="mapCommandMenu.mapX"
        :map-y="mapCommandMenu.mapY"
        :has-points="false"
        @close="mapCommandMenu = null"
        @start-measure="null"
        @add-point="null"
        @undo-point="null"
        @clear-measure="null"
        @copy-coords="onCopyCoords(mapCommandMenu)"
      />
    </div>

    <!-- Floating Details Modal Overlay -->
    <FloatingPlayerWindow
      :open="activePlayerWindow !== null"
      :player="activePlayerWindow?.detail ?? null"
      :server-id="store.server.serverId ?? ''"
      :anchor-x="activePlayerWindow?.anchorX ?? null"
      :anchor-y="activePlayerWindow?.anchorY ?? null"
      :notice="''"
      @close="activePlayerWindow = null"
    />

    <!-- Sidebar controls and player list directory -->
    <TacticalMapSidebar
      :sidebar-mode="sidebarMode"
      :sidebar-tab="sidebarTab"
      :sidebar-unit-mode="sidebarUnitMode"
      :active-team-tab="activeTeamTab"
      :sidebar-search="sidebarSearch"
      :sidebar-sort-mode="sidebarSortMode"
      :sidebar-only-alive="sidebarOnlyAlive"
      :sidebar-only-vehicle="sidebarOnlyVehicle"
      :show-grid="showGrid"
      :show-player-names="showPlayerNames"
      :show-player-coords="showPlayerCoords"
      :show-capture-zones="false"
      :show-fobs="false"
      :disable-marker-interaction="false"
      :measure-mode="false"
      :selected-map-key="selectedMapKey"
      :marker-scale="markerScale"
      :viewer-perspective-mode="viewerPerspectiveMode"
      :detected-map-name="detectedMapName"
      :map-options="mapOptions"
      :server-player-count="serverPlayerCount"
      :server-map-name="serverMapName"
      :status-text="statusText"
      :match-phase="matchPhase"
      :squad-follow="squadFollow"
      :tickets="tickets"
      :perspective-summary-text="perspectiveSummaryText"
      :snapshot="store.snapshot"
      :current-team-squads="currentTeamSquads"
      :filtered-team-players="filteredTeamPlayers"
      :capture-zone-markers="[]"
      :fob-markers="[]"
      :vehicle-groups="[]"
      :combat-logs="[]"
      :positioned-player-count="positionedPlayerCount"
      :bzss-core-status-label="bzssCoreStatusLabel"
      :bzss-core-status-class="bzssCoreStatusClass"
      :bzss-core-updated-at-text="bzssCoreUpdatedAtText"
      :bzss-core-alive-count="bzssCoreAliveCount"
      :raw-fields="[]"
      :last-error="store.error"
      :marker-focus-key="focusedPlayerKey"
      :focused-squad-id="focusedSquadId"
      :get-perspective-style="getPerspectiveStyle"
      :get-perspective-class="getPerspectiveClass"
      :get-player-key="getPlayerKey"
      :get-player-label="getPlayerLabel"
      :get-player-health="getPlayerHealth"
      :normalize-team="normalizeTeam"
      :normalize-squad="normalizeSquad"
      :is-player-disengaged="isPlayerDisengaged"
      @update:sidebar-mode="sidebarMode = $event"
      @update:sidebar-tab="sidebarTab = $event"
      @update:sidebar-unit-mode="sidebarUnitMode = $event"
      @update:active-team-tab="activeTeamTab = $event"
      @update:sidebar-search="sidebarSearch = $event"
      @update:sidebar-sort-mode="sidebarSortMode = $event"
      @update:sidebar-only-alive="sidebarOnlyAlive = $event"
      @update:sidebar-only-vehicle="sidebarOnlyVehicle = $event"
      @update:show-grid="showGrid = $event"
      @update:show-player-names="showPlayerNames = $event"
      @update:show-player-coords="showPlayerCoords = $event"
      @update:selected-map-key="selectedMapKey = $event"
      @update:marker-scale="markerScale = $event"
      @update:viewer-perspective-mode="viewerPerspectiveMode = $event"
      @focus-player="focusPlayerOnMap"
      @focus-squad="focusSquadOnMap"
      @open-player="showPlayerDetails"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, reactive } from "vue";
import { useTacticalStateV2Store } from "../stores/tactical-state-v2.store";
import { TACTICAL_MAP_CONFIGS, TACTICAL_MAP_LIST, type TacticalMapConfig } from "../shared/tactical-map-data";
import TiledMapRenderer from "../components/tactical-map/TiledMapRenderer.vue";
import TacticalCanvasRenderer from "../components/tactical-map-v2/TacticalCanvasRenderer.vue";
import TacticalMapSidebar from "../components/tactical-map/TacticalMapSidebar.vue";
import MapContextMenu from "../components/tactical-map/MapContextMenu.vue";
import PlayerInfoPanel from "../components/tactical-map/PlayerInfoPanel.vue";
import PlayerActionMenu from "../components/tactical-map/PlayerActionMenu.vue";
import FloatingPlayerWindow from "../components/squad-admin/FloatingPlayerWindow.vue";
import { provideTacticalMapViewport } from "../composables/tacticalMapViewport";
import { resolveRoleIcon } from "../utils/role-icons";

// Pinia state delta store setup
const store = useTacticalStateV2Store();

// Viewport layout dims and zoom metrics
const zoom = ref(1.0);
const panX = ref(0);
const panY = ref(0);
const isDragging = ref(false);
const dragStart = reactive({ x: 0, y: 0 });
const dragStartCoords = reactive({ x: 0, y: 0 });
let dragMoved = false;

// Register viewport coordinates composite
provideTacticalMapViewport({ zoom, panX, panY });

const containerRef = ref<HTMLDivElement | null>(null);
const mapRef = ref<HTMLDivElement | null>(null);
const vpWidth = ref(0);
const vpHeight = ref(0);
let resizeObserver: ResizeObserver | null = null;

// UI controls state
const showGrid = ref(true);
const showPlayerNames = ref(true);
const showPlayerCoords = ref(true);
const markerScale = ref(1.0);

type ViewerPerspectiveMode = "auto" | "team1" | "team2";
const viewerPerspectiveMode = ref<ViewerPerspectiveMode>("auto");
const activeTeamTab = ref<1 | 2>(1);

// Sidebar states
const sidebarMode = ref<"expanded" | "compact" | "hidden">("expanded");
const sidebarTab = ref<"overview" | "units" | "assets" | "core">("overview");
const sidebarUnitMode = ref<"squads" | "players">("squads");
const sidebarSearch = ref("");
const sidebarSortMode = ref<"name" | "squad" | "health" | "distance" | "vehicle">("squad");
const sidebarOnlyAlive = ref(false);
const sidebarOnlyVehicle = ref(false);

// Active overlay triggers
const hoveredPlayer = ref<any | null>(null);
const selectedPlayerKey = ref<string>("");
const playerInfoPanel = ref<any | null>(null);
const playerActionMenu = ref<any | null>(null);
const mapCommandMenu = ref<any | null>(null);
const activePlayerWindow = ref<any | null>(null);
const singleClickTimer = ref<any>(null);

// Faction alignment perspectives
const viewerTeamId = computed(() => {
  if (viewerPerspectiveMode.value === "team1") return 1;
  if (viewerPerspectiveMode.value === "team2") return 2;
  return 1; // Default
});

// Dynamic scaling formula for visual consistency
const dynamicMarkerScale = computed(() => {
  return markerScale.value / Math.pow(Math.max(zoom.value, 0.05), 0.6);
});

// Map config lookups
const activeMapConfig = computed<TacticalMapConfig>(() => {
  const mapName = store.server?.map || "Sumari_RAAS_v1";
  return TACTICAL_MAP_CONFIGS[mapName] || TACTICAL_MAP_CONFIGS["Sumari_RAAS_v1"];
});

const selectedMapKey = computed({
  get: () => activeMapConfig.value.key,
  set: () => {}, // read only
});

// Map projection helpers
function project(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return 50;
  if (max <= min) return 50;
  const percent = ((value - min) / (max - min)) * 100;
  return Math.min(98, Math.max(2, percent));
}

// Compute positioned coordinates list
const filteredPlayers = computed(() => {
  const list = store.playersList;
  const bounds = activeMapConfig.value.bounds;

  // Filter based on search query and alive/vehicle state
  return list
    .filter((player) => {
      // 1. Position check
      const pos = player.telemetry?.position;
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return false;

      // 2. Sidebar search filter
      if (sidebarSearch.value) {
        const query = sidebarSearch.value.toLowerCase();
        const name = String(player.identity?.name ?? "").toLowerCase();
        const steam = String(player.identity?.steamID ?? "").toLowerCase();
        const role = String(player.match?.role ?? "").toLowerCase();
        if (!name.includes(query) && !steam.includes(query) && !role.includes(query)) return false;
      }

      // 3. Sidebar alive filter
      if (sidebarOnlyAlive.value) {
        const isDead = player.telemetry?.health !== null && player.telemetry?.health <= 0;
        if (isDead) return false;
      }

      // 4. Sidebar vehicle filter
      if (sidebarOnlyVehicle.value) {
        const hasVehicle = player.vehicle?.vehicleType && player.vehicle?.vehicleType !== "None";
        if (!hasVehicle) return false;
      }

      return true;
    })
    .map((player) => {
      const pos = player.telemetry.position;
      const roleIconInfo = resolveRoleIcon(player.match?.role || "");
      return {
        ...player,
        mapX: project(pos.x ?? 0, bounds.minX, bounds.maxX),
        mapY: project(pos.y ?? 0, bounds.minY, bounds.maxY),
        yaw: player.telemetry?.yaw ?? player.telemetry?.rotation?.z ?? 0,
        teamId: player.match?.teamId ?? 1,
        roleInfo: {
          icon: roleIconInfo.icon,
          label: roleIconInfo.label,
        },
      };
    });
});

// Coordinate and identification accessors
function getPlayerKey(player: any) {
  return player?.identity?.key ?? "";
}
function getPlayerLabel(player: any) {
  return player?.identity?.name ?? "Unknown";
}
function getPlayerHealth(player: any) {
  return player?.telemetry?.health ?? 100;
}
function normalizeTeam(teamId: any) {
  return Number(teamId || 1);
}
function normalizeSquad(squadId: any) {
  return Number(squadId || 0);
}
function isPlayerDisengaged() {
  return false;
}
function getPlayerRconDetail(player: any) {
  return player?.raw?.rcon ?? null;
}

function clearInteractionPanels() {
  playerInfoPanel.value = null;
  playerActionMenu.value = null;
  mapCommandMenu.value = null;
  selectedPlayerKey.value = "";
}

function getLocalPoint(clientX: number, clientY: number) {
  if (!containerRef.value) return null;
  const rect = containerRef.value.getBoundingClientRect();
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function onCanvasHover(payload: any | null) {
  if (isDragging.value) return;
  hoveredPlayer.value = payload?.player ?? null;
}

function onCanvasClick(payload: any) {
  if (dragMoved) {
    dragMoved = false;
    return;
  }

  if (payload?.player) {
    handlePlayerSingleClick(payload.player, payload.clientX, payload.clientY);
    return;
  }

  clearInteractionPanels();
}

function onCanvasContextMenu(payload: any) {
  if (dragMoved) {
    dragMoved = false;
    return;
  }

  if (payload?.player) {
    handlePlayerRightClick(payload.player, payload.clientX, payload.clientY);
    return;
  }

  showMapContextMenu(payload?.clientX ?? 0, payload?.clientY ?? 0, payload?.mapX ?? 0, payload?.mapY ?? 0);
}

// Coordinate tooltip styling
const tooltipStyle = computed(() => {
  if (!hoveredPlayer.value || !containerRef.value) return { display: "none" };
  const mapX = hoveredPlayer.value.mapX;
  const mapY = hoveredPlayer.value.mapY;
  
  const pixelX = panX.value + (mapX * 10) * zoom.value;
  const pixelY = panY.value + (mapY * 10) * zoom.value;
  
  const tooltipWidth = 170;
  const halfWidth = tooltipWidth / 2;
  const viewportWidth = containerRef.value.clientWidth;
  
  let adjustedX = pixelX;
  if (pixelX - halfWidth < 12) {
    adjustedX = halfWidth + 12;
  } else if (pixelX + halfWidth > viewportWidth - 12) {
    adjustedX = viewportWidth - halfWidth - 12;
  }
  
  const tooltipHeight = 100;
  let adjustedY = pixelY - 12;
  let transform = "translate(-50%, -100%)";
  
  if (pixelY - tooltipHeight < 12) {
    adjustedY = pixelY + 12;
    transform = "translate(-50%, 0)";
  }
  
  return {
    left: `${adjustedX}px`,
    top: `${adjustedY}px`,
    transform,
    position: "absolute" as const,
    zIndex: 100,
  };
});

type PerspectiveTone = "friendly" | "enemy" | "neutral";
function getPerspectiveTone(teamId: number | null | undefined): PerspectiveTone {
  const normalized = Number(teamId);
  if (normalized !== 1 && normalized !== 2) return "neutral";
  const viewer = viewerTeamId.value;
  return normalized === viewer ? "friendly" : "enemy";
}

function getPerspectiveClass(teamId: number | null | undefined) {
  return `tone-${getPerspectiveTone(teamId)}`;
}

function getPerspectivePalette(tone: PerspectiveTone) {
  if (tone === "friendly") {
    return {
      primary: "#37c8ff",
      soft: "#7de6ff",
      deep: "#0b6fa3",
      glow: "rgba(55, 200, 255, 0.35)",
      pulse: "#00c8ff",
      tooltip: "rgba(55, 200, 255, 0.6)",
      chip: "rgba(55, 200, 255, 0.15)",
      textGlow: "rgba(55, 200, 255, 0.3)",
      icon: "#7de6ff",
    };
  }
  if (tone === "enemy") {
    return {
      primary: "#ff5b6e",
      soft: "#ff97a3",
      deep: "#a32032",
      glow: "rgba(255, 91, 110, 0.35)",
      pulse: "#ff3366",
      tooltip: "rgba(255, 91, 110, 0.6)",
      chip: "rgba(255, 91, 110, 0.15)",
      textGlow: "rgba(255, 91, 110, 0.3)",
      icon: "#ff97a3",
    };
  }
  return {
    primary: "#94a3b8",
    soft: "#cbd5e1",
    deep: "#334155",
    glow: "rgba(148, 163, 184, 0.25)",
    pulse: "#94a3b8",
    tooltip: "rgba(148, 163, 184, 0.45)",
    chip: "rgba(148, 163, 184, 0.14)",
    textGlow: "rgba(148, 163, 184, 0.2)",
    icon: "#cbd5e1",
  };
}

function getPerspectiveStyle(teamId: number | null | undefined) {
  const palette = getPerspectivePalette(getPerspectiveTone(teamId));
  return {
    "--perspective-primary": palette.primary,
    "--perspective-soft": palette.soft,
    "--perspective-deep": palette.deep,
    "--perspective-glow": palette.glow,
    "--perspective-pulse": palette.pulse,
    "--perspective-tooltip": palette.tooltip,
    "--perspective-chip": palette.chip,
    "--perspective-text-glow": palette.textGlow,
    "--perspective-icon": palette.icon,
  };
}

function showMapContextMenu(clientX: number, clientY: number, mapX: number, mapY: number) {
  if (!containerRef.value) return;
  const local = getLocalPoint(clientX, clientY);
  if (!local) return;

  const bounds = activeMapConfig.value.bounds;
  mapCommandMenu.value = {
    x: local.x,
    y: local.y,
    mapX,
    mapY,
    gameX: bounds.minX + (mapX / 100) * (bounds.maxX - bounds.minX),
    gameY: bounds.minY + (mapY / 100) * (bounds.maxY - bounds.minY),
  };
  playerInfoPanel.value = null;
  playerActionMenu.value = null;
}

// Drag & Pan view transformations
function startDrag(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (
    target.closest(".glass-panel") ||
    target.closest(".tactical-sidebar") ||
    target.closest(".player-tooltip-simple") ||
    target.closest(".map-floating-panel")
  ) {
    return;
  }

  isDragging.value = true;
  dragStart.x = e.clientX - panX.value;
  dragStart.y = e.clientY - panY.value;
  dragStartCoords.x = e.clientX;
  dragStartCoords.y = e.clientY;
  dragMoved = false;
  hoveredPlayer.value = null;
}

function onDrag(e: MouseEvent) {
  if (!isDragging.value) return;
  const dx = Math.abs(e.clientX - dragStartCoords.x);
  const dy = Math.abs(e.clientY - dragStartCoords.y);
  if (dx > 4 || dy > 4) {
    dragMoved = true;
  }
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

function fitToViewport() {
  if (!containerRef.value) return;
  const viewWidth = containerRef.value.clientWidth;
  const viewHeight = containerRef.value.clientHeight;
  const mapSize = 1000;

  const scale = (Math.min(viewWidth, viewHeight) / mapSize) * 0.95;
  zoom.value = Math.max(0.35, Math.min(2, scale));
  
  panX.value = (viewWidth - mapSize * zoom.value) / 2;
  panY.value = (viewHeight - mapSize * zoom.value) / 2;
}

// Sync map matrix translation on ref update
function syncMapTransform() {
  if (!mapRef.value) return;
  mapRef.value.style.transform = `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`;
}

watch([panX, panY, zoom], syncMapTransform, { immediate: true, flush: "post" });

function handlePlayerSingleClick(player: any, clientX: number, clientY: number) {
  if (singleClickTimer.value) {
    clearTimeout(singleClickTimer.value);
  }

  singleClickTimer.value = setTimeout(() => {
    selectedPlayerKey.value = getPlayerKey(player);
    const local = getLocalPoint(clientX, clientY) ?? {
      x: (containerRef.value?.clientWidth ?? window.innerWidth) / 2,
      y: (containerRef.value?.clientHeight ?? window.innerHeight) / 2,
    };

    playerInfoPanel.value = {
      player,
      x: local.x,
      y: local.y,
    };
    playerActionMenu.value = null;
    mapCommandMenu.value = null;
    singleClickTimer.value = null;
  }, 180);
}

function handlePlayerRightClick(player: any, clientX: number, clientY: number) {
  if (singleClickTimer.value) {
    clearTimeout(singleClickTimer.value);
    singleClickTimer.value = null;
  }

  const local = getLocalPoint(clientX, clientY) ?? {
    x: (containerRef.value?.clientWidth ?? window.innerWidth) / 2,
    y: (containerRef.value?.clientHeight ?? window.innerHeight) / 2,
  };

  playerActionMenu.value = {
    player,
    x: local.x,
    y: local.y,
  };

  playerInfoPanel.value = null;
  mapCommandMenu.value = null;
}

function showPlayerDetails(player: any, clientX?: number, clientY?: number) {
  if (singleClickTimer.value) {
    clearTimeout(singleClickTimer.value);
    singleClickTimer.value = null;
  }

  playerInfoPanel.value = null;
  playerActionMenu.value = null;
  mapCommandMenu.value = null;

  const rconDetail = getPlayerRconDetail(player);
  let detail: any;
  if (rconDetail) {
    detail = {
      ...rconDetail,
      raw: rconDetail.raw ?? player.raw?.rcon ?? rconDetail.raw,
    };
    detail.bzssCorePlayerInfo = player;
    detail.bzssCoreStatus = "ready";
  } else {
    detail = {
      playerId: null,
      name: getPlayerLabel(player),
      teamId: normalizeTeam(player.teamId),
      squadId: normalizeSquad(player.match?.squadId),
      isLeader: player.match?.isLeader === true,
      role: player.match?.role || "",
      bzssCorePlayerInfo: player,
      bzssCoreStatus: "ready",
    };
  }

  const anchorX = clientX ?? window.innerWidth / 2;
  const anchorY = clientY ?? window.innerHeight / 2;

  activePlayerWindow.value = {
    detail,
    anchorX,
    anchorY,
  };
}

// Sidebar triggers view panning refocuses
function focusPlayerOnMap(player: any) {
  selectedPlayerKey.value = getPlayerKey(player);
  panToMapPercent(player.mapX, player.mapY, Math.max(zoom.value, 1.15));
}

function focusSquadOnMap(squad: any) {
  // Find lead player or average position in squad
  const squadPlayers = filteredPlayers.value.filter((p) => p.match?.squadId === squad.squadId);
  if (squadPlayers.length === 0) return;
  const avgX = squadPlayers.reduce((sum, p) => sum + p.mapX, 0) / squadPlayers.length;
  const avgY = squadPlayers.reduce((sum, p) => sum + p.mapY, 0) / squadPlayers.length;
  panToMapPercent(avgX, avgY, Math.max(zoom.value, 1.05));
}

function panToMapPercent(mapPercentX: number, mapPercentY: number, targetZoom?: number) {
  const zoomTarget = targetZoom ?? zoom.value;
  if (!containerRef.value) return;
  const viewWidth = containerRef.value.clientWidth;
  const viewHeight = containerRef.value.clientHeight;

  zoom.value = zoomTarget;
  panX.value = viewWidth / 2 - (mapPercentX * 10) * zoomTarget;
  panY.value = viewHeight / 2 - (mapPercentY * 10) * zoomTarget;
}

// Actions from player action menu
function handlePlayerActionEmit(action: string, player: any) {
  console.log(`RCON action [${action}] requested for player:`, player);
  playerActionMenu.value = null;
}

function onOpenPlayerProfile(player: any) {
  console.log("Open player profile request:", player);
  playerActionMenu.value = null;
}

function onFocusPlayer(player: any) {
  focusPlayerOnMap(player);
  playerActionMenu.value = null;
}

function onCopyPlayerCoords(player: any) {
  const pos = player.telemetry?.position;
  if (pos) {
    navigator.clipboard.writeText(`${Math.round(pos.x)}, ${Math.round(pos.y)}`);
  }
  playerActionMenu.value = null;
}

function onCopyCoords(menu: any) {
  if (menu) {
    navigator.clipboard.writeText(`${Math.round(menu.gameX)}, ${Math.round(menu.gameY)}`);
  }
  mapCommandMenu.value = null;
}

// Sidebar required computed mappings
const mapOptions = computed(() => TACTICAL_MAP_LIST);
const detectedMapName = computed(() => activeMapConfig.value.name);
const serverPlayerCount = computed(() => store.server?.playerCount ?? 0);
const serverMapName = computed(() => store.server?.map ?? "");
const statusText = computed(() => {
  if (store.loading && !store.server.serverId) return "同步中";
  if (store.error) return "异常";
  return "在线";
});
const matchPhase = computed(() => store.match?.phase ?? "LIVE");
const squadFollow = computed(() => store.squadFollow);
const tickets = computed(() => store.server?.tickets ?? { team1: null, team2: null });

const perspectiveSummaryText = computed(() => {
  if (viewerPerspectiveMode.value === "team1") return "当前视角: TEAM 1";
  if (viewerPerspectiveMode.value === "team2") return "当前视角: TEAM 2";
  return "自由视角";
});

const currentTeamSquads = computed(() => {
  const teamId = activeTeamTab.value;
  const squadMap = new Map<number, any[]>();
  
  filteredPlayers.value.forEach((p) => {
    const sId = p.match?.squadId;
    if (p.teamId === teamId && sId && sId > 0) {
      if (!squadMap.has(sId)) {
        squadMap.set(sId, []);
      }
      squadMap.get(sId)!.push(p);
    }
  });

  const list: any[] = [];
  squadMap.forEach((squadPlayers, squadId) => {
    const sl = squadPlayers.find(p => p.match?.isLeader === true) || squadPlayers[0];
    const totalHealth = squadPlayers.reduce((acc, p) => acc + (p.telemetry?.health ?? 100), 0);
    const avgHealth = Math.round(totalHealth / squadPlayers.length);
    
    list.push({
      id: squadId,
      name: `Squad ${squadId}`,
      teamId: teamId,
      playersCount: squadPlayers.length,
      squadLeaderName: sl?.identity?.name ?? "Unknown",
      avgHealth: avgHealth,
    });
  });

  return list.sort((a, b) => a.id - b.id);
});

const filteredTeamPlayers = computed(() => {
  return filteredPlayers.value
    .filter((p) => p.teamId === activeTeamTab.value)
    .sort((a, b) => (a.identity?.name || "").localeCompare(b.identity?.name || ""));
});

const positionedPlayerCount = computed(() => filteredPlayers.value.length);

const bzssCoreStatusLabel = computed(() => store.streamActive ? "正常运行" : "未连接");
const bzssCoreStatusClass = computed(() => store.streamActive ? "status-ok" : "status-idle");
const bzssCoreUpdatedAtText = computed(() => {
  const raw = store.diagnostics?.generatedAt || store.server?.generatedAt;
  if (!raw) return "--";
  try {
    const d = new Date(raw);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  } catch {
    return String(raw);
  }
});
const bzssCoreAliveCount = computed(() => {
  return filteredPlayers.value.filter(p => p.telemetry?.health > 0).length;
});

const focusedPlayerKey = computed(() => selectedPlayerKey.value);
const focusedSquadId = ref<number | null>(null);

// Lifecycle hooks for SSE connection updates
onMounted(() => {
  store.startStream();

  // Wait next tick for layout client rect evaluations
  setTimeout(() => {
    fitToViewport();
  }, 100);

  window.addEventListener("resize", fitToViewport);

  if (containerRef.value) {
    vpWidth.value = containerRef.value.clientWidth;
    vpHeight.value = containerRef.value.clientHeight;
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        vpWidth.value = entry.contentRect.width;
        vpHeight.value = entry.contentRect.height;
      }
    });
    resizeObserver.observe(containerRef.value);
  }
});

onBeforeUnmount(() => {
  store.stopStream();
  window.removeEventListener("resize", fitToViewport);
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<style scoped>
@import "../styles/tactical-map.css";
</style>
