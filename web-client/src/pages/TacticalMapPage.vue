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
        <!-- The Desert/Valley Map Image -->
        <img
          src="/tactical_map.jpg"
          alt="Tactical Map"
          class="map-image"
          draggable="false"
        />

        <!-- Tactical Coordinates Grid Lines -->
        <div v-if="showGrid" class="map-grid-overlay">
          <!-- 8x8 Grid Squares -->
          <div
            v-for="row in 8"
            :key="'row-' + row"
            class="grid-row"
          >
            <div
              v-for="col in 8"
              :key="'col-' + col"
              class="grid-cell"
            >
              <!-- Cell Coordinate ID (subtle) -->
              <span class="cell-id">{{ getCellLabel(col, row) }}</span>
              
              <!-- Numpad-style sub-cells (very faint dotted dividers) -->
              <div class="sub-grid-keypad">
                <div v-for="sub in 9" :key="sub" class="keypad-sector"></div>
              </div>
            </div>
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
          <div
            v-for="player in filteredPlayers"
            :key="player.id"
            class="player-marker"
            :class="{
              'team-1': player.teamId === 1,
              'team-2': player.teamId === 2,
              'is-dead': player.isDead,
              'is-squadleader': player.isSquadLeader,
              'is-focused': focusedSquadId === player.squadId,
              'is-hovered': hoveredPlayer?.id === player.id
            }"
            :style="{
              left: `${player.x}%`,
              top: `${player.y}%`
            }"
            @mouseenter="onPlayerMouseEnter(player)"
            @mouseleave="onPlayerMouseLeave"
          >
            <!-- Marker Aura/Pulse -->
            <div class="marker-pulse"></div>

            <!-- Squad Leader Star or Icon border -->
            <div class="marker-ring">
              <!-- Kit Icon -->
              <img
                :src="getPlayerKitIcon(player.kitIcon)"
                :alt="player.role"
                class="kit-icon-img"
                draggable="false"
              />
            </div>
            
            <!-- Small Squad Index Tag -->
            <span v-if="player.squadId" class="squad-index-tag">
              {{ player.squadId }}
            </span>
          </div>
        </div>

        <!-- Floating Player Hover Tooltip -->
        <div
          v-if="hoveredPlayer"
          class="player-tooltip"
          :class="{ 'team-1-border': hoveredPlayer.teamId === 1, 'team-2-border': hoveredPlayer.teamId === 2 }"
          :style="{
            left: `${hoveredPlayer.x}%`,
            top: `${hoveredPlayer.y - 1.5}%`
          }"
        >
          <!-- Tooltip Header -->
          <div class="tooltip-header">
            <span class="tooltip-clan-tag" v-if="hoveredPlayer.clanTag">[{{ hoveredPlayer.clanTag }}]</span>
            <span class="tooltip-name">{{ hoveredPlayer.name }}</span>
            <span
              class="tooltip-health-badge"
              :class="{ 'low-health': hoveredPlayer.health < 40, 'dead-health': hoveredPlayer.isDead }"
            >
              {{ hoveredPlayer.isDead ? 'DOWNED' : `${hoveredPlayer.health}% HP` }}
            </span>
          </div>

          <!-- Divider Line -->
          <div class="tooltip-divider"></div>

          <!-- Tooltip Details Grid -->
          <div class="tooltip-details">
            <div class="detail-row">
              <span class="detail-label">角色职业</span>
              <span class="detail-val">
                <img :src="getPlayerKitIcon(hoveredPlayer.kitIcon)" class="inline-kit-icon" />
                {{ hoveredPlayer.role }}
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label">战术小队</span>
              <span class="detail-val">
                <span class="squad-color-pill" :style="{ background: hoveredPlayer.teamId === 1 ? '#00e5ff' : '#ff3366' }"></span>
                #{{ hoveredPlayer.squadId }} {{ hoveredPlayer.squadName }}
              </span>
            </div>
            <div class="detail-row">
              <span class="detail-label">战绩 stats</span>
              <span class="detail-val monospace">{{ hoveredPlayer.kills }} K / {{ hoveredPlayer.deaths }} D / {{ hoveredPlayer.assists }} A</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">坐标 grid</span>
              <span class="detail-val monospace highlight-cyan">{{ hoveredPlayer.gridLocation }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">延迟 ping</span>
              <span class="detail-val monospace" :style="{ color: hoveredPlayer.ping > 80 ? '#fbc02d' : '#4caf50' }">{{ hoveredPlayer.ping }} ms</span>
            </div>
          </div>

          <!-- Health visual bar -->
          <div class="tooltip-health-track">
            <div
              class="tooltip-health-bar"
              :style="{
                width: `${hoveredPlayer.health}%`,
                background: hoveredPlayer.isDead ? '#ef5350' : hoveredPlayer.health < 40 ? '#fdd835' : '#00e5ff'
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
            <h1 class="main-title">KOKAN SATELLITE COMMAND</h1>
            <p class="subtitle-text">战术雷达实时定位系统 &bull; AAS v1</p>
          </div>
        </div>

        <!-- Faction Match Tickets -->
        <div class="tickets-overlay-card glass-panel">
          <!-- Team 1 US Army -->
          <div class="team-ticket-block team-1">
            <div class="team-info-row">
              <span class="team-label">US ARMY (TEAM 1)</span>
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
              <span class="team-label">PLA FORCES (TEAM 2)</span>
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
          :class="{ active: moveEnabled }"
          @click="moveEnabled = !moveEnabled"
        >
          演练
        </button>
        <button
          class="ctrl-btn text-btn"
          :class="{ active: filterAliveOnly }"
          @click="filterAliveOnly = !filterAliveOnly"
        >
          存活
        </button>
      </div>

      <!-- Coordinate Sector Display Box (Bottom Right) -->
      <div class="coordinates-hud-card glass-panel font-mono">
        <div class="hud-item">
          <span class="hud-label">COORDS:</span>
          <span class="hud-val text-cyan">{{ currentGrid }}</span>
        </div>
        <div class="hud-item-divider"></div>
        <div class="hud-item">
          <span class="hud-label">KEYPAD:</span>
          <span class="hud-val text-yellow">{{ currentSubGrid }}</span>
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
              <span class="val text-cyan">78 / 100</span>
            </div>
            <div class="server-stat-item">
              <span class="lbl">地图名称</span>
              <span class="val">Kokan Valley</span>
            </div>
            <div class="server-stat-item">
              <span class="lbl">RCON 状态</span>
              <span class="val text-green pulsing-text">CONNECTED</span>
            </div>
            <div class="server-stat-item">
              <span class="lbl">对局阶段</span>
              <span class="val">MID MATCH</span>
            </div>
          </div>
        </div>

        <!-- Tactical Squad Directory -->
        <div class="sidebar-section flex-expand border-b">
          <div class="section-title-bar">
            <span class="glowing-square yellow"></span>
            <h3>小队列表</h3>
            <span class="small-hint">点击可地图高亮</span>
          </div>

          <!-- Team Selection Tabs -->
          <div class="sidebar-tabs">
            <button
              class="tab-btn"
              :class="{ active: activeTeamTab === 1 }"
              @click="activeTeamTab = 1"
            >
              US ARMY (T1)
            </button>
            <button
              class="tab-btn"
              :class="{ active: activeTeamTab === 2 }"
              @click="activeTeamTab = 2"
            >
              PLA FORCES (T2)
            </button>
          </div>

          <!-- Squad Cards List -->
          <div class="squads-scroll-list">
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from "vue";

// Define TypeScript interfaces for our simulated structures
interface Player {
  id: number;
  name: string;
  clanTag: string;
  teamId: 1 | 2;
  squadId: number;
  squadName: string;
  role: string;
  kitIcon: string;
  isSquadLeader: boolean;
  health: number;
  isDead: boolean;
  x: number; // percentage width (0-100)
  y: number; // percentage height (0-100)
  vx: number; // velocity x (movement simulation)
  vy: number; // velocity y (movement simulation)
  kills: number;
  deaths: number;
  assists: number;
  ping: number;
  gridLocation: string;
}

interface SquadSummary {
  id: number;
  name: string;
  teamId: 1 | 2;
  playersCount: number;
  squadLeaderName: string;
  avgHealth: number;
}

interface CombatLog {
  time: string;
  text: string;
  type: "kill" | "revive" | "capture" | "system";
}

// Map interactions & coordinates viewport state
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
const moveEnabled = ref(true);
const filterAliveOnly = ref(false);

const currentGrid = ref("D4");
const currentSubGrid = ref("5-3");

// Sidebar state
const sidebarCollapsed = ref(false);
const activeTeamTab = ref<1 | 2>(1);
const focusedSquadId = ref<number | null>(null);

// Team Ticket counts (starts high, bleeds slowly)
const tickets = reactive({
  team1: 300,
  team2: 260
});

// Mock lists of player naming conventions
const playerNames = [
  "NiceDouby", "AntiGravity", "Delta_One", "Vanguard_99", "AlphaSlayer", 
  "Sgt_Bilko", "Major_Payne", "WombatCombat", "GhostRider", "SoapMacTavish",
  "CaptainPrice", "Roach_INF", "Gaz_Tactical", "Ghost_Recon", "Frost_Ranger",
  "Sandman_SL", "Grinch_Designated", "Truck_Armor", "Yuri_Pilot", "Makalov_Red",
  "Ivan_Sapper", "Sergey_LAT", "Dmitry_Medic", "Vladimir_SL", "Alexey_Sniper",
  "Pavel_HAT", "Nikolay_MG", "Artem_Crew", "Mikhail_Rifle", "Gennady_SL"
];
const clanTags = ["BZSS", "SQUAD", "CN", "TAAC", "WPMC", "RGF", "USA", "VNG"];

// Squad kit icon maps
const kitRoles = [
  { role: "小队队长", icon: "T_role_squadleader.PNG", isSL: true },
  { role: "医疗兵", icon: "T_role_medic.PNG", isSL: false },
  { role: "步枪兵", icon: "T_role_rifleman.PNG", isSL: false },
  { role: "步枪兵(倍镜)", icon: "T_role_rifleman_scoped.PNG", isSL: false },
  { role: "轻型反坦克兵", icon: "T_role_lightantitank.PNG", isSL: false },
  { role: "重型反坦克兵", icon: "T_role_heavyantitank.PNG", isSL: false },
  { role: "机枪手", icon: "T_role_automaticrifleman_optic.PNG", isSL: false },
  { role: "精确射手", icon: "T_role_designatedmarksman.PNG", isSL: false },
  { role: "工兵", icon: "T_role_engineer.PNG", isSL: false },
  { role: "狙击手", icon: "T_role_sniper.PNG", isSL: false },
  { role: "载具乘员", icon: "T_role_crewman.PNG", isSL: false }
];

const squadNames = [
  { id: 1, name: "INFANTRY - MAIN", type: "inf" },
  { id: 2, name: "ARMOR - BTR82A", type: "armor" },
  { id: 3, name: "RECON SQUAD", type: "recon" },
  { id: 4, name: "DEFENSE LOGI", type: "inf" },
  { id: 5, name: "MORTAR SUPPORT", type: "mortar" }
];

// Reactive data arrays
const players = ref<Player[]>([]);
const combatLogs = ref<CombatLog[]>([]);
const hoveredPlayer = ref<Player | null>(null);

// Kit icon resolver helper
function getPlayerKitIcon(iconFileName: string): string {
  return `/Icon/${iconFileName}`;
}

// Generate the cells labels (e.g. A1, B4)
function getCellLabel(col: number, row: number): string {
  const cols = ["A", "B", "C", "D", "E", "F", "G", "H"];
  return `${cols[col - 1]}${row}`;
}

// Generate initial players simulation
function generateSimulatedPlayers() {
  const list: Player[] = [];
  let playerIdCounter = 1;

  // Let's create two Teams
  // Team 1: spawns in South-West (coords around X: 15-45, Y: 55-85)
  // Team 2: spawns in North-East (coords around X: 55-85, Y: 15-45)

  for (let teamNum of [1, 2] as [1, 2]) {
    const isTeam1 = teamNum === 1;
    const baseSquads = [1, 2, 3, 4];
    
    baseSquads.forEach((sqId) => {
      // Find a squad template name
      const squadTemplate = squadNames.find((s) => s.id === sqId) || { name: "INFANTRY", type: "inf" };
      const playersInSquadCount = sqId === 1 ? 9 : sqId === 2 ? 3 : sqId === 3 ? 4 : 5;
      
      // Determine coordinates center for squad based on team
      let squadCenterX = isTeam1 ? 20 + sqId * 6 : 80 - sqId * 6;
      let squadCenterY = isTeam1 ? 80 - sqId * 6 : 20 + sqId * 6;

      // Add SL
      const slRole = kitRoles[0];
      const slName = getRandomElement(playerNames) + `_SL${sqId}`;
      const slClan = getRandomElement(clanTags);
      
      const sl: Player = {
        id: playerIdCounter++,
        name: slName,
        clanTag: slClan,
        teamId: teamNum,
        squadId: sqId,
        squadName: squadTemplate.name,
        role: slRole.role,
        kitIcon: slRole.icon,
        isSquadLeader: true,
        health: 100,
        isDead: false,
        x: clampCoordinate(squadCenterX + getRandomOffset(3)),
        y: clampCoordinate(squadCenterY + getRandomOffset(3)),
        vx: getRandomVelocity(),
        vy: getRandomVelocity(),
        kills: Math.floor(Math.random() * 8),
        deaths: Math.floor(Math.random() * 4),
        assists: Math.floor(Math.random() * 6),
        ping: Math.floor(Math.random() * 60) + 15,
        gridLocation: ""
      };
      sl.gridLocation = computeGridString(sl.x, sl.y);
      list.push(sl);

      // Add squad members
      for (let m = 0; m < playersInSquadCount - 1; m++) {
        // Pick a non-SL kit
        const kitIdx = Math.floor(Math.random() * (kitRoles.length - 1)) + 1;
        const kit = kitRoles[kitIdx];
        const memberName = getRandomElement(playerNames) + `_${sqId}-${m}`;
        const isDead = Math.random() < 0.08; // 8% chance downed initially
        
        const member: Player = {
          id: playerIdCounter++,
          name: memberName,
          clanTag: Math.random() < 0.6 ? slClan : getRandomElement(clanTags),
          teamId: teamNum,
          squadId: sqId,
          squadName: squadTemplate.name,
          role: kit.role,
          kitIcon: isDead ? "T_role_dead.PNG" : kit.icon,
          isSquadLeader: false,
          health: isDead ? 0 : Math.floor(Math.random() * 30) + 71, // 71-100 health
          isDead: isDead,
          x: clampCoordinate(squadCenterX + getRandomOffset(7)),
          y: clampCoordinate(squadCenterY + getRandomOffset(7)),
          vx: getRandomVelocity(),
          vy: getRandomVelocity(),
          kills: Math.floor(Math.random() * 6),
          deaths: Math.floor(Math.random() * 5),
          assists: Math.floor(Math.random() * 4),
          ping: Math.floor(Math.random() * 60) + 15,
          gridLocation: ""
        };
        member.gridLocation = computeGridString(member.x, member.y);
        list.push(member);
      }
    });

    // Add 2 unassigned players drifting
    for (let u = 0; u < 2; u++) {
      const uKit = kitRoles[2]; // rifleman
      const name = getRandomElement(playerNames) + `_Lone`;
      const p: Player = {
        id: playerIdCounter++,
        name,
        clanTag: getRandomElement(clanTags),
        teamId: teamNum,
        squadId: 0,
        squadName: "无小队",
        role: uKit.role,
        kitIcon: uKit.icon,
        isSquadLeader: false,
        health: 100,
        isDead: false,
        x: clampCoordinate(isTeam1 ? 25 + getRandomOffset(10) : 75 + getRandomOffset(10)),
        y: clampCoordinate(isTeam1 ? 75 + getRandomOffset(10) : 25 + getRandomOffset(10)),
        vx: getRandomVelocity() * 0.5,
        vy: getRandomVelocity() * 0.5,
        kills: 0,
        deaths: 1,
        assists: 0,
        ping: Math.floor(Math.random() * 100) + 20,
        gridLocation: ""
      };
      p.gridLocation = computeGridString(p.x, p.y);
      list.push(p);
    }
  }

  players.value = list;
}

// Random helpers
function getRandomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function getRandomOffset(range: number): number {
  return (Math.random() - 0.5) * range;
}
function getRandomVelocity(): number {
  return (Math.random() - 0.5) * 0.35; // displacement per tick
}
function clampCoordinate(val: number): number {
  return Math.max(3, Math.min(97, val));
}

// Compute grids based on pixel % (A1 to H8)
function computeGridString(x: number, y: number): string {
  const cols = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const colIndex = Math.min(7, Math.floor(x / 12.5));
  const rowIndex = Math.min(7, Math.floor(y / 12.5)) + 1;
  const grid = `${cols[colIndex]}${rowIndex}`;

  // Keypad
  const localX = (x / 12.5 - colIndex) * 3;
  const localY = (y / 12.5 - (rowIndex - 1)) * 3;
  const keypadLayout = [
    [7, 8, 9],
    [4, 5, 6],
    [1, 2, 3]
  ];
  const kp = keypadLayout[Math.min(2, Math.floor(localY))][Math.min(2, Math.floor(localX))];
  return `${grid}-${kp}`;
}

// Computed lists of filtered players
const filteredPlayers = computed(() => {
  let list = players.value;
  if (filterAliveOnly.value) {
    list = list.filter((p) => !p.isDead);
  }
  return list;
});

// Compute summaries for squads listed on the right sidebar
const currentTeamSquads = computed<SquadSummary[]>(() => {
  const teamId = activeTeamTab.value;
  const squadMap = new Map<number, Player[]>();
  
  // Group players by squad
  players.value.forEach((p) => {
    if (p.teamId === teamId && p.squadId > 0) {
      if (!squadMap.has(p.squadId)) {
        squadMap.set(p.squadId, []);
      }
      squadMap.get(p.squadId)!.push(p);
    }
  });

  const list: SquadSummary[] = [];
  squadMap.forEach((squadPlayers, squadId) => {
    const sl = squadPlayers.find((p) => p.isSquadLeader) || squadPlayers[0];
    const totalHealth = squadPlayers.reduce((acc, p) => acc + p.health, 0);
    const avgHealth = Math.round(totalHealth / squadPlayers.length);
    
    list.push({
      id: squadId,
      name: sl.squadName,
      teamId: teamId,
      playersCount: squadPlayers.length,
      squadLeaderName: sl.name,
      avgHealth: avgHealth
    });
  });

  return list.sort((a, b) => a.id - b.id);
});

// Toggle highlight of a squad on click
function toggleSquadFocus(squadId: number) {
  if (focusedSquadId.value === squadId) {
    focusedSquadId.value = null;
  } else {
    focusedSquadId.value = squadId;
  }
}

// Hover trigger
function onPlayerMouseEnter(player: Player) {
  hoveredPlayer.value = player;
}
function onPlayerMouseLeave() {
  hoveredPlayer.value = null;
}

// Zoom / Pan actions
function zoomIn() {
  zoom.value = Math.min(5, zoom.value * 1.25);
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
  const mapSize = 1000; // inner container is 1000x1000 square

  const scale = Math.min(viewWidth, viewHeight) / mapSize * 0.95;
  zoom.value = Math.max(0.35, Math.min(2, scale));
  
  // Center
  panX.value = (viewWidth - mapSize * zoom.value) / 2;
  panY.value = (viewHeight - mapSize * zoom.value) / 2;
}

// Mouse dragging controls for pan
function startDrag(e: MouseEvent) {
  // Check if click was on buttons or sidebar
  const target = e.target as HTMLElement;
  if (target.closest(".glass-panel") || target.closest(".tactical-sidebar") || target.closest(".player-tooltip")) return;

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

// Zoom on wheel (relative to cursor position)
function onWheel(e: WheelEvent) {
  if (!containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // Key coordinate on unzoomed map before scaling
  const mapX = (mouseX - panX.value) / zoom.value;
  const mapY = (mouseY - panY.value) / zoom.value;

  const factor = 1.15;
  let nextZoom = zoom.value;
  if (e.deltaY < 0) {
    nextZoom = Math.min(5, zoom.value * factor);
  } else {
    nextZoom = Math.max(0.35, zoom.value / factor);
  }

  zoom.value = nextZoom;
  // Readjust pan coordinates so point under cursor stays at screen coordinate
  panX.value = mouseX - mapX * zoom.value;
  panY.value = mouseY - mapY * zoom.value;
}

// Coordinate finder HUD helper (calculates grid based on mouse coords over map)
function onMapMousemove(e: MouseEvent) {
  if (!mapRef.value) return;
  const rect = mapRef.value.getBoundingClientRect();
  const xPercent = ((e.clientX - rect.left) / rect.width) * 100;
  const yPercent = ((e.clientY - rect.top) / rect.height) * 100;

  if (xPercent < 0 || xPercent > 100 || yPercent < 0 || yPercent > 100) return;

  const cols = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const colIndex = Math.min(7, Math.floor(xPercent / 12.5));
  const rowIndex = Math.min(7, Math.floor(yPercent / 12.5)) + 1;
  currentGrid.value = `${cols[colIndex]}${rowIndex}`;

  // Sub keypad coordinates calculation
  const localX = (xPercent / 12.5 - colIndex) * 3;
  const localY = (yPercent / 12.5 - (rowIndex - 1)) * 3;
  const keypad = [
    [7, 8, 9],
    [4, 5, 6],
    [1, 2, 3]
  ];
  const kpNum = keypad[Math.min(2, Math.floor(localY))][Math.min(2, Math.floor(localX))];
  
  // Secondary sub keypad coordinates (micro level)
  const microX = (localX - Math.floor(localX)) * 3;
  const microY = (localY - Math.floor(localY)) * 3;
  const microNum = keypad[Math.min(2, Math.floor(microY))][Math.min(2, Math.floor(microX))];

  currentSubGrid.value = `${kpNum}-${microNum}`;
}

// Add logs to combat scrolling log console
function logCombatEvent(text: string, type: "kill" | "revive" | "capture" | "system" = "kill") {
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  combatLogs.value.push({ time, text, type });
  
  // Cap at 40 rows
  if (combatLogs.value.length > 40) {
    combatLogs.value.shift();
  }

  // Scroll to bottom
  nextTick(() => {
    if (consoleRef.value) {
      consoleRef.value.scrollTop = consoleRef.value.scrollHeight;
    }
  });
}

// Active simulation loops (ran on mount)
let simulationInterval: number | null = null;
let combatEventsInterval: number | null = null;

function runMapSimulation() {
  // 1. Move players slowly along their vectors
  if (moveEnabled.value) {
    players.value = players.value.map((player) => {
      // Hovered player stops moving for tracking
      if (hoveredPlayer.value?.id === player.id) return player;

      // Small chance to randomly alter velocity vector
      let vx = player.vx;
      let vy = player.vy;
      if (Math.random() < 0.15) {
        vx = getRandomVelocity();
        vy = getRandomVelocity();
      }

      // Compute new coordinates
      let x = player.x + vx;
      let y = player.y + vy;

      // Boundary check & direction reverse
      if (x <= 5 || x >= 95) {
        vx = -vx;
        x = clampCoordinate(x);
      }
      if (y <= 5 || y >= 95) {
        vy = -vy;
        y = clampCoordinate(y);
      }

      // Constrain movement area to river valley context
      // (Kokans river runs diagonally bottom-left to top-right)
      // Ideal valley line is roughly y = 100 - x.
      // We apply a pull force vector back to valley center if player gets too far
      const targetY = 100 - x;
      const distanceToValley = y - targetY;
      if (Math.abs(distanceToValley) > 18) {
        vy += distanceToValley > 0 ? -0.05 : 0.05;
      }

      // If player is dead, they don't walk around
      if (player.isDead) {
        return player;
      }

      return {
        ...player,
        x,
        y,
        vx,
        vy,
        gridLocation: computeGridString(x, y)
      };
    });
  }
}

// Run combat event logs generation randomly
function runCombatEventSimulation() {
  // tickets bleed slightly
  if (Math.random() < 0.6) {
    if (Math.random() < 0.5) {
      tickets.team1 = Math.max(0, tickets.team1 - 1);
    } else {
      tickets.team2 = Math.max(0, tickets.team2 - 1);
    }
  }

  // 15% chance to trigger player downed/killed/revived event
  if (Math.random() < 0.3) {
    const team1Alive = players.value.filter((p) => p.teamId === 1 && !p.isDead);
    const team2Alive = players.value.filter((p) => p.teamId === 2 && !p.isDead);
    const downedPlayers = players.value.filter((p) => p.isDead);

    const eventChoice = Math.random();

    if (eventChoice < 0.6 && team1Alive.length > 0 && team2Alive.length > 0) {
      // Skirmish/Kill event: Player kills enemy
      const isTeam1Attacking = Math.random() < 0.5;
      const killer = isTeam1Attacking ? getRandomElement(team1Alive) : getRandomElement(team2Alive);
      const victim = isTeam1Attacking ? getRandomElement(team2Alive) : getRandomElement(team1Alive);

      // Down the victim
      victim.isDead = true;
      victim.health = 0;
      victim.deaths += 1;
      victim.kitIcon = "T_role_dead.PNG";
      killer.kills += 1;

      const weapons = ["M4A1", "QBZ191", "AK-74", "M249", "QJB201", "RPG-7", "M3E1 LAW", "PKP", "M110 Sniper"];
      const weapon = getRandomElement(weapons);

      const killerName = `<span class="team-${killer.teamId}-text">${killer.clanTag ? '[' + killer.clanTag + '] ' : ''}${killer.name}</span>`;
      const victimName = `<span class="team-${victim.teamId}-text">${victim.clanTag ? '[' + victim.clanTag + '] ' : ''}${victim.name}</span>`;
      
      logCombatEvent(`${killerName} 击倒了 ${victimName} (武器: ${weapon})`, "kill");

    } else if (eventChoice < 0.95 && downedPlayers.length > 0) {
      // Revive event
      const victim = getRandomElement(downedPlayers);
      const teamMedics = players.value.filter((p) => p.teamId === victim.teamId && !p.isDead && (p.role === "医疗兵" || p.isSquadLeader));
      
      if (teamMedics.length > 0) {
        const medic = getRandomElement(teamMedics);
        
        // Revive
        victim.isDead = false;
        victim.health = 45; // starts with low health on revive
        medic.assists += 1;
        
        // Restore original icon (SL or normal kits)
        const origKit = kitRoles.find((r) => r.role === victim.role) || kitRoles[2];
        victim.kitIcon = origKit.icon;

        const medicName = `<span class="team-${medic.teamId}-text">${medic.clanTag ? '[' + medic.clanTag + '] ' : ''}${medic.name}</span>`;
        const victimName = `<span class="team-${victim.teamId}-text">${victim.clanTag ? '[' + victim.clanTag + '] ' : ''}${victim.name}</span>`;

        logCombatEvent(`${medicName} 救起了 ${victimName} (医疗包包扎)`, "revive");
      }
    } else {
      // Objective capture or systemic event
      const flagNames = ["南侧农庄 (Farmhouse)", "红土河道 (Riverbed)", "高地前哨 (Outpost)", "桥梁节点 (Bridge)"];
      const flag = getRandomElement(flagNames);
      const team = Math.random() < 0.5 ? 1 : 2;
      
      const teamName = team === 1 ? `<span class="team-1-text">美军 (Team 1)</span>` : `<span class="team-2-text">解放军 (Team 2)</span>`;
      logCombatEvent(`${teamName} 正在争夺重要据点 ${flag}...`, "capture");
    }
  }
}

// Lifecycle setups
onMounted(() => {
  generateSimulatedPlayers();

  // fit view to container bounds
  setTimeout(() => {
    fitToViewport();
  }, 100);

  // Set up logs
  logCombatEvent("对局卫星扫描加载就绪... 坐标网格正常", "system");
  logCombatEvent("美军与中国解放军交火中... 实时动态激活", "system");

  // Run movement loop every 100ms for smooth CSS transitions
  simulationInterval = window.setInterval(runMapSimulation, 100);

  // Run combat logs update loop every 2.5 seconds
  combatEventsInterval = window.setInterval(runCombatEventSimulation, 2500);

  // Handle resizing
  window.addEventListener("resize", fitToViewport);
});

onBeforeUnmount(() => {
  if (simulationInterval) clearInterval(simulationInterval);
  if (combatEventsInterval) clearInterval(combatEventsInterval);
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
  display: flex;
  flex-direction: column;
  pointer-events: none;
  z-index: 2;
}

.grid-row {
  display: flex;
  flex: 1;
}

.grid-cell {
  flex: 1;
  border-right: 1px dashed rgba(0, 240, 255, 0.12);
  border-bottom: 1px dashed rgba(0, 240, 255, 0.12);
  position: relative;
  box-sizing: border-box;
}

.grid-row:last-child .grid-cell {
  border-bottom: none;
}

.grid-cell:last-child {
  border-right: none;
}

.cell-id {
  position: absolute;
  top: 4px;
  left: 6px;
  font-size: 10px;
  color: rgba(0, 240, 255, 0.35);
  font-family: monospace;
  font-weight: bold;
  letter-spacing: 0.5px;
}

/* Dotted indicators inside cell for Keypad */
.sub-grid-keypad {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
}

.keypad-sector {
  border-right: 1px dotted rgba(0, 240, 255, 0.03);
  border-bottom: 1px dotted rgba(0, 240, 255, 0.03);
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
  transform: translate(-50%, -50%);
  pointer-events: auto;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: left 0.9s linear, top 0.9s linear; /* Enables super smooth fluid moving! */
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

/* The solid icon ring */
.marker-ring {
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
  transform: scale(1.15);
  box-shadow: 0 0 15px currentColor;
}
.team-1.is-squadleader .marker-ring { border-color: #ffffff; background-color: #0088ff; color: #00e5ff; }
.team-2.is-squadleader .marker-ring { border-color: #ffffff; background-color: #cc0033; color: #ff3366; }

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

/* Interactive Hover States */
.player-marker.is-hovered .marker-ring,
.player-marker:hover .marker-ring {
  transform: scale(1.4);
  z-index: 50;
  border-color: #ffffff !important;
  box-shadow: 0 0 15px rgba(255, 255, 255, 0.9);
}

/* Pulsing outline for click focus */
.player-marker.is-focused .marker-ring {
  animation: squad-pulse-marker 1.2s ease-in-out infinite alternate;
}

@keyframes squad-pulse-marker {
  from { box-shadow: 0 0 4px rgba(255, 255, 255, 0.3); transform: scale(1.0); }
  to { box-shadow: 0 0 18px currentColor; transform: scale(1.35); }
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

.tooltip-clan-tag {
  color: #94a3b8;
  font-family: monospace;
  font-weight: bold;
  margin-right: 4px;
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

.small-hint {
  font-size: 9px;
  color: #94a3b8;
  margin-left: auto;
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

/* Tabs list */
.sidebar-tabs {
  display: flex;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
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

/* Custom scroll bar inside lists */
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
</style>
