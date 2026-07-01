<template>
  <div class="tactical-map-layout">
    <!-- Main Map Viewport -->
    <div
      ref="containerRef"
      class="map-viewport"
      :class="{ 'has-explosion-shake': isShaking }"
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
          cursor: measureMode ? 'crosshair' : isDragging ? 'grabbing' : 'grab'
        }"
        @mousemove="onMapMousemove"
        @click="onMapClick"
        @contextmenu.prevent="handleMapRightClick"
      >
        <!-- Tiled Map Renderer (replaces single <img> for memory-efficient progressive loading) -->
        <div class="tiled-map-wrapper">
          <TiledMapRenderer
            :tile-base-path="activeMapConfig.tileBasePath"
            :max-zoom="activeMapConfig.maxZoomLevel"
            :tiles-enabled="tilesEnabled"
            :zoom="zoom"
            :pan-x="panX"
            :pan-y="panY"
            :viewport-width="vpWidth"
            :viewport-height="vpHeight"
            :fallback-image="activeMapConfig.image"
            @ready="handleTilesReady"
          />
        </div>

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



        <!-- Capture Zone Overlay -->
        <div v-if="showCaptureZones" class="capture-zone-layer">
          <button
            v-for="zone in captureZoneMarkers"
            :key="zone.name"
            class="capture-zone-marker"
            type="button"
            :style="{
              left: `${zone.mapX}%`,
              top: `${zone.mapY}%`,
              transform: `translate(-50%, -50%) scale(${dynamicMarkerScale})`,
            }"
            :title="zone.raw || zone.name"
          >
            <div class="tactical-flag-node">

              <div class="node-crosshair">
                <span class="crosshair-bracket top-left"></span>
                <span class="crosshair-bracket top-right"></span>
                <span class="crosshair-bracket bottom-left"></span>
                <span class="crosshair-bracket bottom-right"></span>
              </div>
              <div class="node-core-diamond">
                <span class="node-letter">{{ getFlagLetter(zone.name) }}</span>
              </div>
              <div class="node-label-container">
                <span class="node-index-label">OBJ {{ zone.name.includes('-') ? zone.name.split('-')[0] : '' }}</span>
                <span class="node-name-text">{{ zone.name.includes('-') ? zone.name.split('-').slice(1).join('-') : zone.name }}</span>
              </div>
            </div>
          </button>
        </div>

        <!-- FOB Overlay -->
        <div v-if="showFobs" class="fob-layer">
          <div
            v-for="fob in fobMarkers"
            :key="fob.name"
            class="fob-marker"
            :class="[`team-${fob.teamId}`, { 'is-bleeding': fob.isBleeding }]"
            :style="{
              left: `${fob.mapX}%`,
              top: `${fob.mapY}%`,
              transform: `translate(-50%, -50%) scale(${dynamicMarkerScale})`,
            }"
            :title="fob.raw || fob.name"
          >
            <div class="tactical-fob-node">
              <div class="fob-ring-outer">
                <svg class="fob-status-ring" viewBox="0 0 36 36">
                  <!-- Construction background circle -->
                  <circle class="ring-bg" cx="18" cy="18" r="14" stroke="rgba(255, 255, 255, 0.05)" stroke-width="2" fill="none" />
                  <!-- Construction circle track (orange) -->
                  <circle class="ring-track const-track" cx="18" cy="18" r="14" stroke-width="2" :stroke-dasharray="getConstructionDashArray(fob)" />
                  <!-- Ammo background circle -->
                  <circle class="ring-bg" cx="18" cy="18" r="11" stroke="rgba(255, 255, 255, 0.05)" stroke-width="2" fill="none" />
                  <!-- Ammo circle track (cyan) -->
                  <circle class="ring-track ammo-track" cx="18" cy="18" r="11" stroke-width="2" :stroke-dasharray="getAmmoDashArray(fob)" />
                </svg>
                
                <div class="fob-core-icon">
                  <!-- Sleek communication satellite/radio tower SVG -->
                  <svg class="fob-svg-icon" viewBox="0 0 24 24" width="12" height="12">
                    <path fill="currentColor" d="M12 2A10 10 0 0 0 2 12a9.9 9.9 0 0 0 3.3 7.4l1.4-1.4A8 8 0 1 1 12 20a8 8 0 0 1-5.3-2l-1.4 1.4A9.9 9.9 0 0 0 12 22a10 10 0 0 0 10-10A10 10 0 0 0 12 2zm0 4a6 6 0 0 0-6 6c0 1.6.6 3.1 1.7 4.2l1.4-1.4A4 4 0 1 1 12 16a4 4 0 0 1-2.8-1.2l-1.4 1.4A5.9 5.9 0 0 0 12 18a6 6 0 0 0 6-6 6 6 0 0 0-6-6zm0 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
                  </svg>
                  <span class="fob-core-glow"></span>
                </div>
              </div>
              
              <!-- Quick Status HUD under the marker -->
              <div class="fob-quick-hud">
                <span class="hud-bar hp-bar" :style="{ width: `${Math.round((fob.health ?? 0) * 100)}%` }"></span>
              </div>
              
              <span class="fob-node-name">FOB [T{{ fob.teamId }}]</span>
            </div>
            
            <!-- FOB Tooltip -->
            <div class="fob-tooltip">
              <div class="fob-tooltip-title">{{ fob.name || 'FOB Radio' }}</div>
              <div class="fob-tooltip-grid">
                <!-- Health Bar -->
                <div class="fob-tooltip-metric">
                  <div class="metric-info">
                    <span class="metric-label">RADIO HP</span>
                    <span class="metric-value" :class="{ 'warning-text': fob.health < 1.0 }">
                      {{ Math.round((fob.health ?? 0) * 100) }}%
                    </span>
                  </div>
                  <div class="metric-bar-track">
                    <div class="metric-bar-fill hp-fill" :style="{ width: `${Math.round((fob.health ?? 0) * 100)}%` }" :class="{ 'is-bleeding-fill': fob.isBleeding }"></div>
                  </div>
                </div>
                
                <!-- Ammo Bar -->
                <div class="fob-tooltip-metric">
                  <div class="metric-info">
                    <span class="metric-label">AMMO</span>
                    <span class="metric-value">{{ Math.round(fob.ammo ?? 0) }} / 10000</span>
                  </div>
                  <div class="metric-bar-track">
                    <div class="metric-bar-fill ammo-fill" :style="{ width: `${Math.min(100, Math.round((fob.ammo ?? 0) / 100))}%` }"></div>
                  </div>
                </div>

                <!-- Construction Bar -->
                <div class="fob-tooltip-metric">
                  <div class="metric-info">
                    <span class="metric-label">CONSTRUCTION</span>
                    <span class="metric-value">{{ Math.round(fob.construction ?? 0) }} / 2000</span>
                  </div>
                  <div class="metric-bar-track">
                    <div class="metric-bar-fill const-fill" :style="{ width: `${Math.min(100, Math.round((fob.construction ?? 0) / 20))}%` }"></div>
                  </div>
                </div>

                <!-- Bleeding Warning -->
                <div class="fob-tooltip-item alert-item" v-if="fob.isBleeding">
                  <span class="fob-tooltip-value bleeding-alert">⚠️ BLEEDING OUT!</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Player Markers Layer -->
        <div class="player-markers-layer" :style="{ pointerEvents: measureMode ? 'none' : 'auto' }">
          <PlayerMarker
            v-for="player in filteredPlayers"
            :key="getPlayerKey(player)"
            mode="tactical"
            :player-name="getPlayerLabel(player)"
            :team-id="player.teamId"
            :map-x="player.mapX"
            :map-y="player.mapY"
            :yaw="player.yaw"
            :health="getPlayerHealth(player)"
            :squad-id="player.squadId"
            :is-squad-leader="isSquadLeader(player)"
            :role-icon="player.roleInfo.icon"
            :role-label="player.roleInfo.label"
            :vehicle-type="player.vehicleInfo?.vehicleType"
            :is-focused="selectedPlayerKey === getPlayerKey(player) || focusedSquadId === player.squadId"
            :is-hovered="getPlayerKey(hoveredPlayer) === getPlayerKey(player)"
            :is-disengaged="isPlayerDisengaged(player)"
            :show-name="showPlayerNames"
            :show-coords="showPlayerCoords"
            :game-x="getPlayerPosition(player)?.x"
            :game-y="getPlayerPosition(player)?.y"
            :scale="dynamicMarkerScale"
            :tone="getPerspectiveTone(player.teamId)"
            :disable-interaction="disableMarkerInteraction"
            @click.stop="handlePlayerSingleClick(player, $event)"
            @dblclick.stop="handlePlayerDoubleClick(player, $event)"
            @contextmenu.prevent.stop="handlePlayerRightClick(player, $event)"
            @mouseenter="hoveredPlayer = player"
            @mouseleave="hoveredPlayer = null"
          />
        </div>

        <!-- Explosion Overlay -->
        <div class="explosion-layer">
          <div
            v-for="exp in explosionMarkers"
            :key="exp.id"
            class="explosion-marker"
            :style="{
              left: `${exp.mapX}%`,
              top: `${exp.mapY}%`,
              width: `${2 * blastRadiusPx}px`,
              height: `${2 * blastRadiusPx}px`,
              '--blast-radius': `${blastRadiusPx}px`,
              '--exp-intensity': exp.intensity,
              '--exp-chaos': exp.chaos,
              '--exp-spin': exp.spin,
              '--exp-stretch-x': exp.stretchX,
              '--exp-stretch-y': exp.stretchY,
              '--exp-flash-hue': exp.flashHue,
              '--exp-flash-alpha': exp.flashAlpha,
            }"
          >
            <!-- Background refraction/distortion wave (lens blur) -->
            <div class="explosion-refraction-wave"></div>
            <!-- Main thin circular expanding/retracting ring -->
            <div class="explosion-pulse-ring"></div>
            <!-- Dynamic secondary expanding plasma shockwave -->
            <div class="explosion-plasma-wave"></div>
            <!-- Sharp expanding pressure wave -->
            <div class="explosion-pressure-ring"></div>
            <!-- Radial particle dots flying outward and drifting dynamically -->
            <div class="explosion-particles">
              <span
                v-for="p in staticExplosionParticles"
                :key="p.id"
                class="particle"
                :class="p.type"
                :style="{
                  '--angle': `${p.angle}deg`,
                  '--speed': p.speed,
                  '--delay': `${p.delay}s`,
                  '--start-offset': `calc(${p.startOffset} * var(--exp-chaos))`,
                  '--spread': `calc(${p.spread} * var(--exp-intensity))`,
                  '--particle-size': `calc(${p.size}px * (0.92 + (var(--exp-intensity) - 1) * 0.55))`,
                }"
              ></span>
            </div>
            <!-- Core flash -->
            <div class="explosion-core"></div>
          </div>
        </div>

        <!-- SVG Layer for Overlays (Distance Measuring & Hotspot Circle) -->
        <svg v-if="measureMode || combatHotspot != null" class="map-measure-svg">
          <path
            v-if="measureMode && measurePoints.length >= 2"
            :d="measurePathD"
            fill="none"
            stroke="#ffcc00"
            stroke-width="3"
            stroke-dasharray="6,4"
            class="measure-polyline"
          />
          <circle
            v-for="(pt, idx) in (measureMode ? measurePoints : [])"
            :key="'mpt-' + idx"
            :cx="pt.mapX * 10"
            :cy="pt.mapY * 10"
            r="6"
            fill="#ffcc00"
            stroke="#0b1120"
            stroke-width="2"
            class="measure-point"
          />

          <!-- Combat Hotspot Overlay (1000m circle & center marker) -->
          <g v-if="combatHotspot != null">
            <!-- 1000m radius circle -->
            <circle
              :cx="combatHotspotMapPos.mapX * 10"
              :cy="combatHotspotMapPos.mapY * 10"
              :r="combatHotspotRadiusSvg"
              fill="rgba(0, 229, 255, 0.04)"
              stroke="#00e5ff"
              stroke-width="2.5"
              stroke-dasharray="8,5"
              class="hotspot-circle"
            />
            <!-- Center crosshair circle -->
            <circle
              :cx="combatHotspotMapPos.mapX * 10"
              :cy="combatHotspotMapPos.mapY * 10"
              r="7"
              fill="#ef5350"
              stroke="#ffffff"
              stroke-width="2"
              class="hotspot-center"
            />
            <!-- Crosshair center lines -->
            <line
              :x1="combatHotspotMapPos.mapX * 10 - 15"
              :y1="combatHotspotMapPos.mapY * 10"
              :x2="combatHotspotMapPos.mapX * 10 + 15"
              :y2="combatHotspotMapPos.mapY * 10"
              stroke="#ffffff"
              stroke-width="1.5"
            />
            <line
              :x1="combatHotspotMapPos.mapX * 10"
              :y1="combatHotspotMapPos.mapY * 10 - 15"
              :x2="combatHotspotMapPos.mapX * 10"
              :y2="combatHotspotMapPos.mapY * 10 + 15"
              stroke="#ffffff"
              stroke-width="1.5"
            />
          </g>
        </svg>

        <!-- Distance Labels -->
        <div v-if="measureMode" class="measure-labels-layer">
          <div
            v-for="(label, idx) in measureLabels"
            :key="'mlbl-' + idx"
            class="measure-distance-label font-mono"
            :style="{ left: label.mapX + '%', top: label.mapY + '%' }"
          >
            {{ label.text }}
          </div>
        </div>
      </div>

      <!-- Floating Player Hover Tooltip (rendered outside map-transform-container) -->
      <div
        v-if="hoveredMarker && getPlayerKey(hoveredMarker) !== selectedPlayerKey"
        class="player-tooltip-simple font-mono"
        :class="getPerspectiveClass(hoveredMarker.teamId)"
        :style="{ ...tooltipStyle, ...getPerspectiveStyle(hoveredMarker.teamId) }"
      >
        <span class="player-name-simple">{{ getPlayerLabel(hoveredMarker) }}</span>
        <span class="squad-simple" v-if="hoveredMarker.squadId">#{{ hoveredMarker.squadId }}</span>
      </div>

      <!-- New Map Interaction Floating Elements -->
      <PlayerInfoPanel
        v-if="playerInfoPanel"
        :player="playerInfoPanel.player"
        :x="playerInfoPanel.x"
        :y="playerInfoPanel.y"
        :tone="getPerspectiveTone(playerInfoPanel.player.teamId)"
        :speed-text="getPlayerSpeedText(playerInfoPanel.player)"
        :rcon-detail="getPlayerRconDetail(playerInfoPanel.player)"
        @close="playerInfoPanel = null; selectedPlayerKey = ''"
      />

      <PlayerActionMenu
        v-if="playerActionMenu"
        :player="playerActionMenu.player"
        :x="playerActionMenu.x"
        :y="playerActionMenu.y"
        :tone="getPerspectiveTone(playerActionMenu.player.teamId)"
        :can-manage="canManageRcon"
        :rcon-player="getPlayerRconDetail(playerActionMenu.player)"
        @close="playerActionMenu = null"
        @open-profile="onOpenPlayerProfile(playerActionMenu.player)"
        @focus="onFocusPlayer(playerActionMenu.player)"
        @copy-coords="onCopyPlayerCoords(playerActionMenu.player)"
        @start-measure="onStartMeasureFromPlayer(playerActionMenu.player)"
        @warn="emit('warn-player', getPlayerRconDetail(playerActionMenu.player))"
        @kick="emit('kick-player', getPlayerRconDetail(playerActionMenu.player))"
        @force-team="emit('force-team-player', getPlayerRconDetail(playerActionMenu.player))"
      />

      <MapContextMenu
        v-if="mapCommandMenu"
        :x="mapCommandMenu.x"
        :y="mapCommandMenu.y"
        :game-x="mapCommandMenu.gameX"
        :game-y="mapCommandMenu.gameY"
        :map-x="mapCommandMenu.mapX"
        :map-y="mapCommandMenu.mapY"
        :has-points="measurePoints.length > 0"
        @close="mapCommandMenu = null"
        @start-measure="onStartMeasure(mapCommandMenu)"
        @add-point="onAddPoint(mapCommandMenu)"
        @undo-point="onUndoPoint"
        @clear-measure="onClearMeasure"
        @copy-coords="onCopyCoords(mapCommandMenu)"
        @focus-here="onFocusHere(mapCommandMenu)"
      />

      <!-- Shortcut Key Hints Overlay -->
      <div class="map-command-hint glass-panel font-mono">
        <span class="hint-item"><span class="key">右键</span> 指令</span>
        <span class="hint-item"><span class="key">双击</span> 资料</span>
        <span class="hint-item"><span class="key">滚轮</span> 缩放</span>
        <span class="hint-item"><span class="key">拖拽</span> 移动</span>
        <span class="hint-item"><span class="key">ESC</span> 关闭</span>
        <span class="hint-item"><span class="key">M</span> 测距</span>
        <span class="hint-item"><span class="key">G</span> 网格</span>
        <span class="hint-item"><span class="key">F</span> 复位</span>
      </div>

      <!-- Top Overlay Panels (Header & Tickets) -->
      <div class="overlay-top-container">
        <!-- System Title Block -->
        <div class="system-header-card glass-panel">
          <div class="header-led-indicator pulse-led"></div>
          <div class="header-text-block">
            <h1 class="main-title">SUMARI SATELLITE COMMAND</h1>
            <p class="subtitle-text">战术地图实时定位系统 &bull; 日志驱动实时定位</p>
          </div>
        </div>

        <!-- Faction Match Tickets -->
        <div class="tickets-overlay-card glass-panel">
          <!-- Team 1 US Army -->
          <div class="team-ticket-block tone-friendly" :style="getPerspectiveStyle(1)">
            <div class="team-info-row">
              <span class="team-label">TEAM 1</span>
              <span class="ticket-number font-mono">{{ tickets.team1 }}</span>
            </div>
            <div class="ticket-progress-track">
              <div class="ticket-progress-fill" :style="{ width: `${(tickets.team1 / 400) * 100}%` }"></div>
            </div>
          </div>

          <!-- Divider -->
          <div class="ticket-vs-divider">VS</div>

          <!-- Team 2 PLA Forces -->
          <div class="team-ticket-block tone-enemy" :style="getPerspectiveStyle(2)">
            <div class="team-info-row">
              <span class="team-label">TEAM 2</span>
              <span class="ticket-number font-mono">{{ tickets.team2 }}</span>
            </div>
            <div class="ticket-progress-track">
              <div class="ticket-progress-fill" :style="{ width: `${(tickets.team2 / 400) * 100}%` }"></div>
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
        <button class="ctrl-btn" title="适配视口 (F)" @click="resetView">
          <span class="icon-span">↺</span>
        </button>
        <div class="ctrl-divider"></div>
        <button
          class="ctrl-btn text-btn"
          :class="{ active: showGrid }"
          @click="showGrid = !showGrid"
          title="网格开关 (G)"
        >
          网格
        </button>
        <button
          class="ctrl-btn text-btn"
          :class="{ active: showCaptureZones }"
          @click="showCaptureZones = !showCaptureZones"
          title="地标区域图层"
        >
          地标
        </button>
        <button
          class="ctrl-btn text-btn"
          :class="{ active: showFobs }"
          @click="showFobs = !showFobs"
          title="FOB图层"
        >
          FOB
        </button>
        <button
          class="ctrl-btn text-btn"
          :class="{ active: showPlayerNames }"
          @click="showPlayerNames = !showPlayerNames"
          title="玩家姓名图层"
        >
          姓名
        </button>
        <button
          class="ctrl-btn text-btn"
          :class="{ active: showPlayerCoords }"
          @click="showPlayerCoords = !showPlayerCoords"
          title="玩家坐标图层"
        >
          坐标
        </button>
        <button
          class="ctrl-btn text-btn"
          :class="{ active: filterAliveOnly }"
          @click="filterAliveOnly = !filterAliveOnly"
          title="只显示存活玩家"
        >
          存活
        </button>
        <button
          class="ctrl-btn text-btn"
          :class="{ active: disableMarkerInteraction }"
          @click="disableMarkerInteraction = !disableMarkerInteraction"
          title="穿透玩家标记(方便查看地图)"
        >
          穿透
        </button>
        <button
          class="ctrl-btn text-btn measure-btn"
          :class="{ active: measureMode }"
          @click="toggleMeasureMode"
          title="多点测距 (M)"
        >
          测距
        </button>
        <button
          v-if="measurePoints.length"
          class="ctrl-btn text-btn"
          @click="clearMeasurePoints"
          title="清空测距点"
        >
          清空
        </button>
        <button
          class="ctrl-btn text-btn hotspot-ctrl-btn"
          :class="{ active: combatHotspot != null }"
          @click="calculateCombatHotspot"
          title="计算并生成作战热点中心及1000m半径"
        >
          热点
        </button>
        <button
          v-if="combatHotspot != null"
          class="ctrl-btn text-btn"
          @click="clearCombatHotspot"
          title="清除作战热点"
        >
          清除热点
        </button>
                <button
          v-if="measurePoints.length"
          class="ctrl-btn text-btn"
          @click="clearMeasurePoints"
          title="清空测距点"
        >
          清空
        </button>
                <button
          class="ctrl-btn text-btn hotspot-ctrl-btn"
          :class="{ active: combatHotspot != null }"
          @click="calculateCombatHotspot"
          title="计算并生成作战热点中心及1000m半径"
        >
          热点
        </button>
                <button
          v-if="combatHotspot != null"
          class="ctrl-btn text-btn"
          @click="clearCombatHotspot"
          title="清除作战热点"
        >
          清除热点
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
      :show-capture-zones="showCaptureZones"
      :show-fobs="showFobs"
      :disable-marker-interaction="disableMarkerInteraction"
      :measure-mode="measureMode"
      :selected-map-key="selectedMapKey"
      :marker-scale="markerScale"
      :viewer-perspective-mode="viewerPerspectiveMode"
      :detected-map-name="detectedMapName"
      :map-options="mapOptions"
      :server-player-count="serverPlayerCount"
      :server-map-name="serverMapName"
      :status-text="statusText"
      :match-phase="matchPhase"
      :tickets="tickets"
      :perspective-summary-text="perspectiveSummaryText"
      :snapshot="snapshot"
      :current-team-squads="currentTeamSquads"
      :filtered-team-players="filteredTeamPlayers"
      :capture-zone-markers="captureZoneMarkers"
      :fob-markers="fobMarkers"
      :vehicle-groups="vehicleGroups"
      :combat-logs="combatLogs"
      :positioned-player-count="positionedPlayers.length"
      :bzss-core-status-label="bzssCoreStatusLabel"
      :bzss-core-status-class="bzssCoreStatusClass"
      :bzss-core-updated-at-text="bzssCoreUpdatedAtText"
      :bzss-core-alive-count="bzssCoreAliveCount"
      :raw-fields="snapshot?.state?.rawFields ?? []"
      :last-error="snapshot?.state?.lastError ?? ''"
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
      @update:show-capture-zones="showCaptureZones = $event"
      @update:show-fobs="showFobs = $event"
      @update:disable-marker-interaction="disableMarkerInteraction = $event"
      @update:measure-mode="measureMode = $event"
      @update:selected-map-key="selectedMapKey = $event"
      @update:marker-scale="markerScale = $event"
      @update:viewer-perspective-mode="viewerPerspectiveMode = $event"
      @focus-player="focusPlayerOnMap"
      @focus-squad="focusSquadOnMap"
      @focus-fob="focusFobOnMap"
      @focus-zone="focusZoneOnMap"
      @focus-vehicle="focusVehicleOnMap"
      @open-player="showPlayerDetails"
    />

  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, reactive, nextTick, watch } from "vue";
import {
  type BzssCorePlayerInfoResponse,
  type BzssCoreCaptureZoneInfo,
  type BzssCoreFobInfo,
  type BzssCoreTrackedPlayerInfo,
  type BzssCoreTrackedVector,
} from "../app/bzssCoreApi";
import { useAuthStore } from "../stores/auth.store";
import { useServerStore } from "../stores/server.store";
import { usePlayerStore } from "../stores/player.store";
import { adaptPlayerDetail } from "../utils/squad-admin-adapter";
import { resolveRoleIcon, type RoleIconInfo } from "../utils/role-icons";
import { resolveVehicleIcon } from "../utils/vehicle-icons";
import {
  TACTICAL_MAP_CONFIGS,
  TACTICAL_MAP_LIST,
  resolveTacticalMapKey,
  type TacticalMapConfig,
} from "../shared/tactical-map-data";
import TiledMapRenderer from "../components/tactical-map/TiledMapRenderer.vue";
import PlayerMarker from "../components/tactical-map/PlayerMarker.vue";
import TacticalMapSidebar from "../components/tactical-map/TacticalMapSidebar.vue";
import MapContextMenu from "../components/tactical-map/MapContextMenu.vue";
import PlayerInfoPanel from "../components/tactical-map/PlayerInfoPanel.vue";
import PlayerActionMenu from "../components/tactical-map/PlayerActionMenu.vue";

const props = defineProps<{
  snapshot: BzssCorePlayerInfoResponse | null;
  players: BzssCoreTrackedPlayerInfo[];
  captureZones?: BzssCoreCaptureZoneInfo[];
  fobs?: BzssCoreFobInfo[];
  loading: boolean;
  errorText: string;
  playtimes?: Record<string, any> | null;
  combatStatsLookup?: Record<string, any> | null;
}>();

const emit = defineEmits<{
  (e: "select-player", payload: { detail: any; event: MouseEvent }): void;
  (e: "snapshot-ready", payload: { ready: boolean; reason?: string }): void;
  (e: "warn-player", player: any): void;
  (e: "kick-player", player: any): void;
  (e: "force-team-player", player: any): void;
}>();

interface MapMarker extends BzssCoreTrackedPlayerInfo {
  mapX: number;
  mapY: number;
  roleInfo: RoleIconInfo;
}

interface CaptureZoneMarker {
  name: string;
  mapX: number;
  mapY: number;
  raw?: string;
}

interface CombatLog {
  time: string;
  text: string;
  type: "kill" | "revive" | "capture" | "system";
}

type ViewerPerspectiveMode = "auto" | "team1" | "team2";
type PerspectiveTone = "friendly" | "enemy" | "neutral";

const serverStore = useServerStore();
const playerStore = usePlayerStore();
const authStore = useAuthStore();

function findRconPlayer(player: BzssCoreTrackedPlayerInfo) {
  if (player.playerGuid) {
    const p = playerStore.bySteamID[player.playerGuid] || playerStore.byEOSID[player.playerGuid];
    if (p) return p;
  }
  if (player.playerId != null) {
    const p = playerStore.byPlayerID[String(player.playerId)] || playerStore.byPlayerID[Number(player.playerId)];
    if (p) return p;
  }
  if (player.playerName) {
    const p = playerStore.byName[player.playerName] || playerStore.byName[player.playerName.trim()];
    if (p) return p;
  }
  return null;
}

function getPlayerRconDetail(player: BzssCoreTrackedPlayerInfo) {
  const rcon = findRconPlayer(player);
  if (!rcon) return null;
  const steamId = (rcon.steamID as string | undefined) || (rcon.steam64 as string | undefined) || null;
  if (!steamId) {
    return adaptPlayerDetail(rcon, null, props.combatStatsLookup ?? {});
  }
  const playtime = playerStore.bySteamID[steamId]?.playtimeHours || props.playtimes?.[steamId]?.playtimeHours || null;
  return adaptPlayerDetail(rcon, playtime, props.combatStatsLookup ?? {});
}

const canManageRcon = computed(() => {
  return Boolean(
    authStore.user?.isSuperAdmin ||
    authStore.user?.permissions?.includes("rcon.warn") ||
    authStore.user?.permissions?.includes("rcon.kick") ||
    authStore.user?.permissions?.includes("rcon.forceteamchange") ||
    authStore.user?.permissions?.includes("rcon.balance") ||
    authStore.user?.permissions?.some(p => p.startsWith("rcon."))
  );
});

const snapshot = computed(() => props.snapshot);
const players = computed(() => props.players);
const captureZones = computed(() => props.captureZones ?? snapshot.value?.captureZones ?? []);
const fobs = computed(() => props.fobs ?? snapshot.value?.fobs ?? []);

const mapName = "Sumari";
const serverMapName = computed(() => serverStore.snapshot?.mapName || mapName);

const selectedMapKey = ref("auto");
const detectedMapKey = computed(() => resolveTacticalMapKey(serverMapName.value) ?? "Sumari_RAAS_v1");
const detectedMapName = computed(() => TACTICAL_MAP_CONFIGS[detectedMapKey.value]?.name ?? "Sumari");

const activeMapConfig = computed(() => {
  let key = selectedMapKey.value;
  if (key === "auto") {
    key = detectedMapKey.value;
  }
  return TACTICAL_MAP_CONFIGS[key] || TACTICAL_MAP_CONFIGS.Sumari_RAAS_v1;
});

const mapOptions = computed<TacticalMapConfig[]>(() => TACTICAL_MAP_LIST);

// Cache to prevent players disappearing when data is missing temporarily
const cachedPlayers = ref<Record<string, { player: BzssCoreTrackedPlayerInfo; lastSeen: number }>>({});
const positionedPlayers = computed(() => {
  return Object.values(cachedPlayers.value).map((entry) => entry.player);
});

const hoveredPlayer = ref<BzssCoreTrackedPlayerInfo | null>(null);
const errorText = computed(() => props.errorText);
const loading = computed(() => props.loading);
let simulatedCombatTimer: number | null = null;

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
const showCaptureZones = ref(true);
const showFobs = ref(true);
const filterAliveOnly = ref(false);
const disableMarkerInteraction = ref(false);

// Icon scaling and tags visibility refs
const markerScale = ref(1.0);
const showPlayerNames = ref(true);
const showPlayerCoords = ref(true);

// Viewport dimension tracking for tile loader
const vpWidth = ref(0);
const vpHeight = ref(0);
const tilesEnabled = ref(true);
let resizeObserver: ResizeObserver | null = null;
const tilesReady = ref(false);

const dynamicMarkerScale = computed(() => {
  // Rather than keeping marker screen size perfectly constant (1/zoom),
  // we scale it by zoom^(-0.6) so that markers grow slightly when zoomed in
  // and shrink slightly when zoomed out, creating a natural tactical map feel.
  return markerScale.value / Math.pow(Math.max(zoom.value, 0.05), 0.6);
});

// Sidebar states
type SidebarMode = "expanded" | "compact" | "hidden";
type SidebarTab = "overview" | "units" | "assets" | "core";
type SidebarUnitMode = "squads" | "players";
type SidebarSortMode = "name" | "squad" | "health" | "distance" | "vehicle";

const sidebarMode = ref<SidebarMode>(window.innerWidth <= 900 ? "compact" : "expanded");
const sidebarTab = ref<SidebarTab>("overview");
const sidebarUnitMode = ref<SidebarUnitMode>("squads");
const sidebarSearch = ref("");
const sidebarSortMode = ref<SidebarSortMode>("squad");
const sidebarOnlyAlive = ref(false);
const sidebarOnlyVehicle = ref(false);
const sidebarCollapsed = ref(false);
const activeTeamTab = ref<number>(1);
const focusedSquadId = ref<number | null>(null);
const combatLogs = ref<CombatLog[]>([]);
const viewerPerspectiveMode = ref<ViewerPerspectiveMode>("auto");
const focusedPlayerKey = ref("");

// Shared activePlayerWindow managed by parent MatchStatusPage

// Distance Measuring State
const measurePoints = ref<Array<{ mapX: number; mapY: number; gameX: number; gameY: number }>>([]);

// Map Interaction States Layer
const selectedPlayerKey = ref<string>("");
const playerInfoPanel = ref<{
  player: BzssCoreTrackedPlayerInfo;
  x: number;
  y: number;
} | null>(null);
const playerActionMenu = ref<{
  player: BzssCoreTrackedPlayerInfo;
  x: number;
  y: number;
} | null>(null);
const mapCommandMenu = ref<{
  x: number;
  y: number;
  mapX: number;
  mapY: number;
  gameX: number;
  gameY: number;
} | null>(null);
const activeTool = ref<"none" | "measure" | "future">("none");
const singleClickTimer = ref<any>(null);

const measureMode = computed({
  get: () => activeTool.value === "measure",
  set: (val: boolean) => {
    activeTool.value = val ? "measure" : "none";
  }
});

// Pre-generated static random values for denser grenade blast debris
const staticExplosionParticles = Array.from({ length: 90 }, (_, idx) => {
  const angle = Math.floor(Math.random() * 360);
  const speed = +(1.2 + Math.random() * 1.8).toFixed(2);
  const delay = +(Math.random() * 0.12).toFixed(2);
  const startOffset = +(0.1 + Math.random() * 0.3).toFixed(2);
  const spread = +(1.3 + Math.random() * 1.7).toFixed(2);
  const size = +(0.8 + Math.random() * 1.2).toFixed(2);
  const type = idx % 2 === 0 ? "spark" : "ember";
  return { id: idx, angle, speed, delay, startOffset, spread, size, type };
});

function createSeededRandom(seedText: string) {
  let seed = 0;
  for (let i = 0; i < seedText.length; i += 1) {
    seed = (seed * 31 + seedText.charCodeAt(i)) >>> 0;
  }
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const blastRadiusPx = computed(() => {
  const bounds = activeMapConfig.value.bounds;
  const mapGameWidth = bounds.maxX - bounds.minX;
  if (mapGameWidth <= 0) return 30;
  // 30 meters = 3000 game units. Px on a 1000px map = (3000 / mapGameWidth) * 1000
  return (3000 / mapGameWidth) * 1000;
});

const explosionMarkers = computed(() => {
  const list = snapshot.value?.explosions;
  if (!Array.isArray(list) || list.length === 0) return [];
  const bounds = activeMapConfig.value.bounds;
  const markers: any[] = [];
  for (const exp of list) {
    const x = Number(exp.x);
    const y = Number(exp.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const rand = createSeededRandom(String(exp.id ?? `${x}:${y}:${exp.at ?? ""}`));
    const intensity = +(1.02 + rand() * 0.46).toFixed(2);
    const chaos = +(0.8 + rand() * 0.95).toFixed(2);
    const spin = `${Math.round(-30 + rand() * 60)}deg`;
    const stretchX = +(0.9 + rand() * 0.38).toFixed(2);
    const stretchY = +(0.88 + rand() * 0.44).toFixed(2);
    const flashHue = `${Math.round(28 + rand() * 18)}deg`;
    const flashAlpha = +(0.9 + rand() * 0.35).toFixed(2);
    markers.push({
      id: exp.id,
      mapX: project(x, bounds.minX, bounds.maxX),
      mapY: project(y, bounds.minY, bounds.maxY),
      damageCauser: exp.damageCauser,
      damageInstigator: exp.damageInstigator,
      at: exp.at,
      intensity,
      chaos,
      spin,
      stretchX,
      stretchY,
      flashHue,
      flashAlpha,
    });
  }
  return markers;
});

const isShaking = ref(false);
let shakeTimeoutId: any = null;

function triggerShake() {
  if (isShaking.value) {
    isShaking.value = false;
    void nextTick();
  }
  isShaking.value = true;
  clearTimeout(shakeTimeoutId);
  shakeTimeoutId = setTimeout(() => {
    isShaking.value = false;
  }, 350);
}

watch(
  () => explosionMarkers.value,
  (newVal, oldVal) => {
    const oldIds = new Set((oldVal || []).map((e: any) => e.id));
    let hasNewExplosion = false;
    for (const exp of newVal) {
      if (!oldIds.has(exp.id)) {
        hasNewExplosion = true;
        const cleanCauser = cleanWeaponName(exp.damageCauser);
        logCombatEvent(
          `<span style="color: #94a3b8">检测到官方爆炸物爆炸 (武器: ${cleanCauser}, 坐标: ${Math.round(exp.mapX)}%, ${Math.round(exp.mapY)}%)</span>`,
          "system"
        );
      }
    }
    if (hasNewExplosion) {
      triggerShake();
    }
  },
  { deep: true }
);

// Combat Hotspot State (Centroid of alive players)
const combatHotspot = ref<{ gameX: number; gameY: number } | null>(null);

const combatHotspotMapPos = computed(() => {
  if (!combatHotspot.value) return { mapX: 0, mapY: 0 };
  const bounds = activeMapConfig.value.bounds;
  return {
    mapX: project(combatHotspot.value.gameX, bounds.minX, bounds.maxX),
    mapY: project(combatHotspot.value.gameY, bounds.minY, bounds.maxY)
  };
});

const combatHotspotRadiusSvg = computed(() => {
  const bounds = activeMapConfig.value.bounds;
  const mapGameWidth = bounds.maxX - bounds.minX;
  if (mapGameWidth <= 0) return 0;
  // 1000m in game coordinates is 100,000 units (1m = 100 units)
  return (100000 / mapGameWidth) * 1000;
});

function calculateCombatHotspot() {
  const alivePlayers = positionedPlayers.value.filter(player => {
    const hp = player.soldierInfo?.health;
    return hp != null && hp > 0;
  });
  
  if (alivePlayers.length === 0) {
    logCombatEvent("无法计算作战热点: 暂无存活玩家", "system");
    return;
  }
  
  let sumX = 0;
  let sumY = 0;
  alivePlayers.forEach(player => {
    const pos = player.soldierInfo?.position;
    if (pos) {
      sumX += pos.x ?? 0;
      sumY += pos.y ?? 0;
    }
  });
  
  combatHotspot.value = {
    gameX: sumX / alivePlayers.length,
    gameY: sumY / alivePlayers.length
  };
  
  logCombatEvent(`计算得到新一轮作战热点中心 [X:${Math.round(combatHotspot.value.gameX)}, Y:${Math.round(combatHotspot.value.gameY)}] (1000m 半径)`, "system");
}

function clearCombatHotspot() {
  combatHotspot.value = null;
  logCombatEvent("Cleared combat hotspot marker", "system");
}

function isPlayerDisengaged(player: BzssCoreTrackedPlayerInfo) {
  if (!combatHotspot.value) return false;
  const pos = player.soldierInfo?.position;
  if (!pos) return false;
  
  const dx = (pos.x ?? 0) - combatHotspot.value.gameX;
  const dy = (pos.y ?? 0) - combatHotspot.value.gameY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // 1000 meters = 100,000 game units
  return dist > 100000;
}

// Position and Rotation Spring-Damper State
interface PlayerTarget {
  x: number;
  y: number;
  yaw: number | null;
  vx: number;
  vy: number;
  lastSeen: number;
}

const playerTargets = new Map<string, PlayerTarget>();
const interpolatedPositions = ref<Record<string, { mapX: number, mapY: number, yaw: number | null }>>({});

// Watch players prop to update the cache
watch(
  players,
  (newPlayers) => {
    if (!newPlayers || newPlayers.length === 0) {
      // Keep cached players on temporary empty data
      return;
    }
    const now = Date.now();
    const nextCache = { ...cachedPlayers.value };
    let changed = false;

    newPlayers.forEach((player) => {
      const key = getPlayerKey(player);
      if (!key) return;
      if (hasValidPosition(player)) {
        nextCache[key] = {
          player,
          lastSeen: now
        };
        changed = true;
      }
    });

    if (changed) {
      cachedPlayers.value = nextCache;
    }
  },
  { immediate: true, deep: true }
);

// Clear player cache if active map changes
watch(
  activeMapConfig,
  () => {
    cachedPlayers.value = {};
    playerTargets.clear();
    interpolatedPositions.value = {};
    combatHotspot.value = null;
    tilesReady.value = false;
  }
);



watch(
  () => props.snapshot,
  () => {
    tilesReady.value = false;
  }
);

watch(
  positionedPlayers,
  (newList) => {
    const now = Date.now();
    newList.forEach(player => {
      const key = getPlayerKey(player);
      if (!key) return;
      const pos = getPlayerPosition(player);
      if (!pos) return;
      
      const nextX = pos.x ?? 0;
      const nextY = pos.y ?? 0;
      const nextYaw = getPlayerYaw(player);

      const lastTarget = playerTargets.get(key);
      let vx = 0;
      let vy = 0;
      if (lastTarget) {
        const dt = (now - lastTarget.lastSeen) / 1000;
        if (dt > 0.05) {
          vx = (nextX - lastTarget.x) / dt;
          vy = (nextY - lastTarget.y) / dt;
        } else {
          vx = lastTarget.vx;
          vy = lastTarget.vy;
        }
      }

      playerTargets.set(key, {
        x: nextX,
        y: nextY,
        yaw: nextYaw,
        vx,
        vy,
        lastSeen: now
      });
    });

    // Cleanup states for disconnected/evicted players
    const currentKeys = new Set(newList.map((p) => getPlayerKey(p)).filter(Boolean));
    for (const key of playerTargets.keys()) {
      if (!currentKeys.has(key)) {
        playerTargets.delete(key);
      }
    }

    if (!newList.length) {
      interpolatedPositions.value = {};
      return;
    }

    const bounds = activeMapConfig.value.bounds;
    const nextPositions: Record<string, { mapX: number, mapY: number, yaw: number | null }> = {};
    for (const player of newList) {
      const key = getPlayerKey(player);
      if (!key) continue;
      const pos = getPlayerPosition(player);
      if (!pos) continue;
      nextPositions[key] = {
        mapX: project(pos.x ?? 0, bounds.minX, bounds.maxX),
        mapY: project(pos.y ?? 0, bounds.minY, bounds.maxY),
        yaw: getPlayerYaw(player)
      };
    }
    interpolatedPositions.value = nextPositions;
  },
  { immediate: true, deep: true }
);

function toggleMeasureMode() {
  measureMode.value = !measureMode.value;
  if (!measureMode.value) {
    measurePoints.value = [];
  }
}

function clearMeasurePoints() {
  measurePoints.value = [];
}

const measureLabels = computed(() => {
  const pts = measurePoints.value;
  if (pts.length === 0) return [];
  
  const labels: any[] = [];
  let totalDistance = 0;
  
  pts.forEach((pt, idx) => {
    if (idx === 0) {
      labels.push({
        mapX: pt.mapX,
        mapY: pt.mapY,
        text: "起点 (Start)"
      });
    } else {
      const prev = pts[idx - 1];
      const dx = pt.gameX - prev.gameX;
      const dy = pt.gameY - prev.gameY;
      const dist = Math.sqrt(dx * dx + dy * dy) / 100;
      totalDistance += dist;
      
      labels.push({
        mapX: pt.mapX,
        mapY: pt.mapY,
        text: `+${Math.round(dist)}m (${Math.round(totalDistance)}m)`
      });
    }
  });
  
  return labels;
});

const measurePathD = computed(() => {
  const pts = measurePoints.value;
  if (pts.length < 2) return "";
  return pts.map((pt, idx) => {
    const pxX = pt.mapX * 10;
    const pxY = pt.mapY * 10;
    return `${idx === 0 ? 'M' : 'L'} ${pxX} ${pxY}`;
  }).join(" ");
});

function onMapClick(e: MouseEvent) {
  if (dragMoved) {
    dragMoved = false;
    return;
  }

  // Clicking on blank space closes info panels and menus
  playerInfoPanel.value = null;
  playerActionMenu.value = null;
  mapCommandMenu.value = null;
  selectedPlayerKey.value = "";

  if (!measureMode.value) return;
  // Ignore clicks inside UI controls
  if (
    (e.target as HTMLElement).closest(".glass-panel") ||
    (e.target as HTMLElement).closest(".tactical-sidebar") ||
    (e.target as HTMLElement).closest(".map-floating-panel")
  ) {
    return;
  }

  if (!mapRef.value) return;
  const rect = mapRef.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  const pctX = (x / rect.width);
  const pctY = (y / rect.height);
  
  const bounds = activeMapConfig.value.bounds;
  const gameX = bounds.minX + pctX * (bounds.maxX - bounds.minX);
  const gameY = bounds.minY + pctY * (bounds.maxY - bounds.minY);

  measurePoints.value.push({
    mapX: pctX * 100,
    mapY: pctY * 100,
    gameX,
    gameY
  });
}

function handleMapRightClick(e: MouseEvent) {
  // Ignore if right click was inside controls
  const target = e.target as HTMLElement;
  if (
    target.closest(".glass-panel") ||
    target.closest(".tactical-sidebar") ||
    target.closest(".map-floating-panel")
  ) {
    return;
  }

  if (!mapRef.value || !containerRef.value) return;
  const rect = mapRef.value.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  const pctX = x / rect.width;
  const pctY = y / rect.height;
  
  const bounds = activeMapConfig.value.bounds;
  const gameX = bounds.minX + pctX * (bounds.maxX - bounds.minX);
  const gameY = bounds.minY + pctY * (bounds.maxY - bounds.minY);

  // Position relative to viewport container
  const vpRect = containerRef.value.getBoundingClientRect();
  const menuX = e.clientX - vpRect.left;
  const menuY = e.clientY - vpRect.top;

  mapCommandMenu.value = {
    x: menuX,
    y: menuY,
    mapX: pctX * 100,
    mapY: pctY * 100,
    gameX,
    gameY
  };

  // Close player panels/menus
  playerInfoPanel.value = null;
  playerActionMenu.value = null;
}

// Player Click / DblClick / RightClick Differentiators
function handlePlayerSingleClick(player: BzssCoreTrackedPlayerInfo, event: MouseEvent) {
  if (singleClickTimer.value) {
    clearTimeout(singleClickTimer.value);
  }

  singleClickTimer.value = setTimeout(() => {
    selectedPlayerKey.value = getPlayerKey(player);
    
    if (containerRef.value) {
      const rect = containerRef.value.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      playerInfoPanel.value = {
        player,
        x,
        y
      };
    }
    
    playerActionMenu.value = null;
    mapCommandMenu.value = null;
    singleClickTimer.value = null;
  }, 180);
}

function handlePlayerDoubleClick(player: BzssCoreTrackedPlayerInfo, event: MouseEvent) {
  if (singleClickTimer.value) {
    clearTimeout(singleClickTimer.value);
    singleClickTimer.value = null;
  }

  playerInfoPanel.value = null;
  playerActionMenu.value = null;
  mapCommandMenu.value = null;

  showPlayerDetails(player, event);
}

function handlePlayerRightClick(player: BzssCoreTrackedPlayerInfo, event: MouseEvent) {
  if (singleClickTimer.value) {
    clearTimeout(singleClickTimer.value);
    singleClickTimer.value = null;
  }

  if (containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    playerActionMenu.value = {
      player,
      x,
      y
    };
  }

  playerInfoPanel.value = null;
  mapCommandMenu.value = null;
}

// Map Context Menu Event Handlers
function onStartMeasure(menu: any) {
  activeTool.value = "measure";
  measurePoints.value = [{
    mapX: menu.mapX,
    mapY: menu.mapY,
    gameX: menu.gameX,
    gameY: menu.gameY
  }];
  logCombatEvent(`开始测距。起点: [X:${Math.round(menu.gameX)}, Y:${Math.round(menu.gameY)}]`, "system");
}

function onAddPoint(menu: any) {
  if (activeTool.value !== "measure") {
    activeTool.value = "measure";
  }
  measurePoints.value.push({
    mapX: menu.mapX,
    mapY: menu.mapY,
    gameX: menu.gameX,
    gameY: menu.gameY
  });
  logCombatEvent(`添加测距点: [X:${Math.round(menu.gameX)}, Y:${Math.round(menu.gameY)}]`, "system");
}

function onUndoPoint() {
  if (measurePoints.value.length > 0) {
    const popped = measurePoints.value.pop();
    if (popped) {
      logCombatEvent(`撤销测距点: [X:${Math.round(popped.gameX)}, Y:${Math.round(popped.gameY)}]`, "system");
    }
  }
}

function onClearMeasure() {
  measurePoints.value = [];
  logCombatEvent("清空测距点", "system");
}

async function onCopyCoords(coords: { gameX: number; gameY: number }) {
  const text = `${Math.round(coords.gameX)}, ${Math.round(coords.gameY)}`;
  try {
    await navigator.clipboard.writeText(text);
    logCombatEvent(`已复制地图坐标: ${text}`, "system");
  } catch (err) {
    console.error("Failed to copy coordinates:", err);
  }
}

function onFocusHere(menu: any) {
  panToMapPercent(menu.mapX, menu.mapY, Math.max(zoom.value, 1.25));
}

// Player Context Menu Event Handlers
function onOpenPlayerProfile(player: BzssCoreTrackedPlayerInfo) {
  showPlayerDetails(player);
}

function onFocusPlayer(player: BzssCoreTrackedPlayerInfo) {
  focusPlayerOnMap(player);
}

async function onCopyPlayerCoords(player: BzssCoreTrackedPlayerInfo) {
  const pos = getPlayerPosition(player);
  if (!pos) return;
  const text = `${Math.round(pos.x ?? 0)}, ${Math.round(pos.y ?? 0)}`;
  try {
    await navigator.clipboard.writeText(text);
    logCombatEvent(`已复制玩家 ${player.playerName} 的坐标: ${text}`, "system");
  } catch (err) {
    console.error("Failed to copy player coords:", err);
  }
}

function onStartMeasureFromPlayer(player: BzssCoreTrackedPlayerInfo) {
  const marker = markers.value.find((m) => getPlayerKey(m) === getPlayerKey(player));
  const pos = getPlayerPosition(player);
  if (!marker || !pos) return;
  
  activeTool.value = "measure";
  measurePoints.value = [{
    mapX: marker.mapX,
    mapY: marker.mapY,
    gameX: pos.x ?? 0,
    gameY: pos.y ?? 0
  }];
  logCombatEvent(`开始从玩家 ${player.playerName} 处测距。`, "system");
}

// Get real Server metrics
const currentServerId = computed(() => String(serverStore.snapshot?.serverId ?? ""));
const serverPlayerCount = computed(() => serverStore.snapshot?.playerCount || players.value.length);
const matchPhase = computed(() => serverStore.snapshot?.webStatus?.isWarmup ? "WARMUP" : "MID MATCH");
const matchStatePlayers = computed(() => {
  const list = serverStore.snapshot?.matchState?.players?.list;
  return Array.isArray(list) ? list : [];
});
const viewerSteam64 = computed(() => normalizeSteam64(authStore.user?.steam64));
const autoViewerTeamId = computed(() => findAdminTeamId(matchStatePlayers.value, viewerSteam64.value));
const resolvedViewerTeamId = computed<number | null>(() => {
  if (viewerPerspectiveMode.value === "team1") return 1;
  if (viewerPerspectiveMode.value === "team2") return 2;
  if (autoViewerTeamId.value === 1 || autoViewerTeamId.value === 2) return autoViewerTeamId.value;
  return 1;
});
const perspectiveSummaryText = computed(() => {
  if (viewerPerspectiveMode.value === "team1") return "当前视角: TEAM 1";
  if (viewerPerspectiveMode.value === "team2") return "当前视角: TEAM 2";
  if (autoViewerTeamId.value === 1 || autoViewerTeamId.value === 2) {
    return `当前视角: 自动识别 TEAM ${autoViewerTeamId.value}`;
  }
  return "当前视角: 自动识别失败，回退 TEAM 1";
});

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

const markers = computed<MapMarker[]>(() => {
  const positioned = positionedPlayers.value;
  if (!positioned.length) return [];

  const bounds = activeMapConfig.value.bounds;
  return positioned.map((player) => {
    const key = getPlayerKey(player);
    const interp = interpolatedPositions.value[key];
    const pos = getPlayerPosition(player) as BzssCoreTrackedVector;
    const resolvedTeamId = resolvePlayerTeamId(player);
    
    // Associate RCON detail
    const rconDetail = getPlayerRconDetail(player);

    return {
      ...player,
      mapX: interp ? interp.mapX : project(pos.x ?? 0, bounds.minX, bounds.maxX),
      mapY: interp ? interp.mapY : project(pos.y ?? 0, bounds.minY, bounds.maxY),
      yaw: interp && interp.yaw !== null ? interp.yaw : getPlayerYaw(player),
      teamId: resolvedTeamId,
      roleInfo: resolveMapRoleInfo(player),
      rconDetail,
    };
  });
});

const captureZoneMarkers = computed<CaptureZoneMarker[]>(() => {
  const zones = captureZones.value;
  if (!Array.isArray(zones) || zones.length === 0) return [];
  const bounds = activeMapConfig.value.bounds;
  const markers: CaptureZoneMarker[] = [];
  for (const zone of zones) {
    const pos = zone?.position;
    if (!pos) continue;
    const x = Number(pos.x);
    const y = Number(pos.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const name = String(zone.name ?? "").trim();
    if (!name) continue;
    markers.push({
      name,
      mapX: project(x, bounds.minX, bounds.maxX),
      mapY: project(y, bounds.minY, bounds.maxY),
      raw: zone.raw,
    });
  }
  return markers;
});

const fobMarkers = computed(() => {
  const list = fobs.value;
  if (!Array.isArray(list) || list.length === 0) return [];
  const bounds = activeMapConfig.value.bounds;
  const markers: any[] = [];
  for (const fob of list) {
    const pos = fob?.position;
    if (!pos) continue;
    const x = Number(pos.x);
    const y = Number(pos.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    markers.push({
      name: fob.name || "FOB Radio",
      teamId: fob.teamId,
      health: fob.health,
      isBleeding: fob.isBleeding,
      ammo: fob.ammo,
      construction: fob.construction,
      mapX: project(x, bounds.minX, bounds.maxX),
      mapY: project(y, bounds.minY, bounds.maxY),
      raw: fob.raw,
    });
  }
  return markers;
});

const vehicleGroups = computed(() => {
  const buckets = new Map<string, { teamId: number; vehicleType: string; count: number; mapX: number; mapY: number }>();
  for (const player of markers.value) {
    const vehicleType = String(player.vehicleInfo?.vehicleType ?? "").trim();
    if (!vehicleType || vehicleType === "None") continue;
    const teamId = normalizeTeam(player.teamId);
    const key = `${teamId}:${vehicleType}`;
    const current = buckets.get(key) ?? { teamId, vehicleType, count: 0, mapX: player.mapX, mapY: player.mapY };
    current.count += 1;
    current.mapX = (current.mapX + player.mapX) / 2;
    current.mapY = (current.mapY + player.mapY) / 2;
    buckets.set(key, current);
  }
  return [...buckets.values()].sort((a, b) => a.vehicleType.localeCompare(b.vehicleType));
});

watch(
  () => [loading.value, errorText.value, positionedPlayers.value.length, captureZoneMarkers.value.length, fobMarkers.value.length, tilesReady.value] as const,
  () => {
    const ready = Boolean(!loading.value && !errorText.value && props.snapshot && tilesReady.value);
    emit("snapshot-ready", {
      ready,
      reason: ready ? "rendered" : loading.value ? "loading" : errorText.value ? "error" : "pending-tiles",
    });
  },
  { immediate: true }
);

const filteredPlayers = computed(() => {
  let list = markers.value;
  if (filterAliveOnly.value) {
    list = list.filter((p) => {
      const hp = getPlayerHealth(p);
      return hp != null && hp > 0;
    });
  }
  return list;
});

// Hover tooltip target
const hoveredMarker = computed(() => {
  if (!hoveredPlayer.value) return null;
  return markers.value.find(
    (m) => getPlayerKey(m) === getPlayerKey(hoveredPlayer.value)
  ) || null;
});

// Hover tooltip style with screen coordinate projection & boundary clamping
const tooltipStyle = computed(() => {
  if (!hoveredMarker.value || !containerRef.value) return { display: "none" };
  const mapX = hoveredMarker.value.mapX;
  const mapY = hoveredMarker.value.mapY;
  
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
  
  const tooltipHeight = 160; // approximate height
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
    zIndex: 100
  };
});

// Filter players for active team list
const filteredTeamPlayers = computed(() => {
  return markers.value
    .filter((p) => normalizeTeam(p.teamId) === activeTeamTab.value)
    .sort((a, b) => getPlayerLabel(a).localeCompare(getPlayerLabel(b)));
});

// Group real players by squads
const currentTeamSquads = computed(() => {
  const teamId = activeTeamTab.value;
  const squadMap = new Map<number, BzssCoreTrackedPlayerInfo[]>();
  
  markers.value.forEach((p) => {
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
    const totalHealth = squadPlayers.reduce((acc, p) => acc + (getPlayerHealth(p) ?? 100), 0);
    const avgHealth = Math.round(totalHealth / squadPlayers.length);
    
    list.push({
      id: squadId,
      name: `Squad ${squadId}`,
      teamId: teamId,
      playersCount: squadPlayers.length,
      squadLeaderName: getPlayerLabel(sl),
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

// BZSS-Core Info Panel Computed Properties
const bzssCoreStatusLabel = computed(() => {
  const status = snapshot.value?.state?.status;
  if (!status) return '未连接';
  const map: Record<string, string> = {
    ok: '正常运行',
    active: '活跃',
    idle: '待机',
    error: '异常',
    starting: '启动中',
    stopped: '已停止',
  };
  return map[status.toLowerCase()] ?? status;
});

const bzssCoreStatusClass = computed(() => {
  const status = (snapshot.value?.state?.status ?? '').toLowerCase();
  if (status === 'ok' || status === 'active') return 'status-ok';
  if (status === 'idle' || status === 'starting') return 'status-idle';
  if (status === 'error' || status === 'stopped') return 'status-error';
  return 'status-idle';
});

const bzssCoreUpdatedAtText = computed(() => {
  const raw = snapshot.value?.state?.updatedAt;
  if (!raw) return '--';
  try {
    const d = new Date(raw);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  } catch {
    return raw;
  }
});

const bzssCoreAliveCount = computed(() => {
  return positionedPlayers.value.filter(p => {
    const hp = p.soldierInfo?.health;
    return hp != null && hp > 0;
  }).length;
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

function handleTilesReady() {
  tilesReady.value = true;
}

// Drag & Pan & Zoom Event Handlers
let dragMoved = false;
const dragStartCoords = { x: 0, y: 0 };

function startDrag(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (
    target.closest(".glass-panel") ||
    target.closest(".tactical-sidebar") ||
    target.closest(".player-tooltip") ||
    target.closest(".player-tooltip-simple") ||
    target.closest(".player-marker") ||
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

watch(
  () => sidebarMode.value,
  (mode) => {
    if (mode === "hidden") {
      sidebarCollapsed.value = true;
    }
  }
);

// Squad directory highlights
function toggleSquadFocus(squadId: number) {
  if (focusedSquadId.value === squadId) {
    focusedSquadId.value = null;
  } else {
    focusedSquadId.value = squadId;
  }
}

function panToMapPercent(mapX: number, mapY: number, targetZoom?: number) {
  const zoomTarget = targetZoom ?? zoom.value;
  const clampedZoom = Math.max(0.35, Math.min(20, zoomTarget));
  zoom.value = clampedZoom;
  if (!containerRef.value) return;
  const viewWidth = containerRef.value.clientWidth;
  const viewHeight = containerRef.value.clientHeight;
  panX.value = viewWidth / 2 - (mapX * 10) * clampedZoom;
  panY.value = viewHeight / 2 - (mapY * 10) * clampedZoom;
}

function focusPlayerOnMap(player: BzssCoreTrackedPlayerInfo) {
  const key = getPlayerKey(player);
  focusedPlayerKey.value = key;
  const marker = markers.value.find((m) => getPlayerKey(m) === key);
  if (marker) {
    panToMapPercent(marker.mapX, marker.mapY, Math.max(zoom.value, 1.2));
  }
  hoveredPlayer.value = player;
}

function focusSquadOnMap(payload: { teamId: number; squadId: number }) {
  const squadPlayers = markers.value.filter(
    (player) => normalizeTeam(player.teamId) === payload.teamId && normalizeSquad(player.squadId) === payload.squadId
  );
  if (!squadPlayers.length) return;
  const avgX = squadPlayers.reduce((sum, p) => sum + p.mapX, 0) / squadPlayers.length;
  const avgY = squadPlayers.reduce((sum, p) => sum + p.mapY, 0) / squadPlayers.length;
  focusedSquadId.value = payload.squadId;
  panToMapPercent(avgX, avgY, Math.max(zoom.value, 1.1));
}

function focusFobOnMap(marker: { mapX: number; mapY: number }) {
  panToMapPercent(marker.mapX, marker.mapY, Math.max(zoom.value, 1.15));
}

function focusZoneOnMap(marker: { mapX: number; mapY: number }) {
  panToMapPercent(marker.mapX, marker.mapY, Math.max(zoom.value, 1.15));
}

function focusVehicleOnMap(marker: { mapX: number; mapY: number }) {
  panToMapPercent(marker.mapX, marker.mapY, Math.max(zoom.value, 1.15));
}

// Show player detail in floating window
function showPlayerDetails(player: BzssCoreTrackedPlayerInfo, event?: MouseEvent) {
  const storePlayer = playerStore.active.find(
    (p) => p.name === player.playerName || p.steamID === player.playerGuid
  );

  let detail: any;
  if (storePlayer) {
    detail = adaptPlayerDetail(storePlayer, null, {});
    detail.bzssCorePlayerInfo = player;
    detail.bzssCoreStatus = "ready";
  } else {
    detail = {
      playerId: null,
      name: getPlayerLabel(player),
      teamId: normalizeTeam(player.teamId),
      squadId: normalizeSquad(player.squadId),
      isLeader: isSquadLeader(player),
      role: resolveMapRoleInfo(player).label,
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

  emit("select-player", {
    detail,
    event: event ?? ({ clientX: Math.floor(window.innerWidth / 2), clientY: Math.floor(window.innerHeight / 2) } as MouseEvent)
  });
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
      
      const killerName = `<span class="tone-${getPerspectiveTone(killer.teamId)}-text">${killer.playerName}</span>`;
      const victimName = `<span class="tone-${getPerspectiveTone(victim.teamId)}-text">${victim.playerName}</span>`;
      
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

function normalizePlayerIdentity(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeSteam64(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^\d{17}$/.test(text) ? text : "";
}

function findAdminTeamId(entries: any[], steam64: string): number | null {
  if (!steam64) return null;

  for (const entry of entries) {
    const entryTeamId = normalizeTeam(entry?.teamId ?? entry?.teamID);
    if (entryTeamId !== 1 && entryTeamId !== 2) continue;

    const candidates = [
      entry?.steam64,
      entry?.steamID,
      entry?.steamId,
      entry?.playerGuid,
    ]
      .map(normalizeSteam64)
      .filter(Boolean);

    if (candidates.includes(steam64)) {
      return entryTeamId;
    }
  }

  return null;
}

function getMatchStateTeamId(player: BzssCoreTrackedPlayerInfo): number | null {
  const candidates = new Set([
    normalizePlayerIdentity(getPlayerKey(player)),
    normalizePlayerIdentity(player.playerName),
    normalizePlayerIdentity(player.playerGuid),
  ].filter(Boolean));

  if (candidates.size === 0) return null;

  for (const entry of matchStatePlayers.value) {
    const entryTeamId = normalizeTeam(entry?.teamId ?? entry?.teamID);
    if (entryTeamId !== 1 && entryTeamId !== 2) continue;

    const entryCandidates = [
      entry?.playerName,
      entry?.name,
      entry?.displayName,
      entry?.playerGuid,
      entry?.steamID,
      entry?.steamId,
      entry?.eosID,
      entry?.eosId,
    ]
      .map(normalizePlayerIdentity)
      .filter(Boolean);

    if (entryCandidates.some((candidate) => candidates.has(candidate))) {
      return entryTeamId;
    }
  }

  return null;
}

function resolvePlayerTeamId(player: BzssCoreTrackedPlayerInfo): number {
  return getMatchStateTeamId(player) ?? normalizeTeam(player.teamId);
}

function getPlayerYaw(player: BzssCoreTrackedPlayerInfo): number | null {
  if (player.yaw != null) return player.yaw;
  const rotation = player.soldierInfo?.rotation;
  if (!rotation) return null;
  if (rotation.z != null) return rotation.z;
  if (rotation.y != null) return rotation.y;
  return null;
}

function getPlayerKey(player: BzssCoreTrackedPlayerInfo | null | undefined): string {
  if (!player) return "";
  const playerIndex = player.playerIndex ?? player.playerId;
  if (playerIndex != null && Number.isFinite(Number(playerIndex))) {
    return `idx:${Number(playerIndex)}`;
  }
  const playerGuid = String(player.playerGuid ?? "").trim();
  if (playerGuid) return `guid:${playerGuid}`;
  const playerName = String(player.playerName ?? "").trim();
  if (playerName) return `name:${playerName}`;
  return "";
}

function getPlayerLabel(player: BzssCoreTrackedPlayerInfo | null | undefined): string {
  if (!player) return "Unknown";
  const playerName = String(player.playerName ?? "").trim();
  if (playerName) return playerName;
  const playerIndex = player.playerIndex ?? player.playerId;
  if (playerIndex != null) return `Player ${playerIndex}`;
  return "Unknown";
}

function getPlayerPosition(player: BzssCoreTrackedPlayerInfo | null | undefined) {
  return player?.soldierInfo?.position ?? player?.position ?? null;
}

function getPlayerHealth(player: BzssCoreTrackedPlayerInfo | null | undefined): number | null {
  const value = player?.soldierInfo?.health;
  return value != null && Number.isFinite(value) ? value : null;
}

function normalizeSquad(squadId: number | null | undefined) {
  return Number.isFinite(squadId as number) && Number(squadId) >= 0 ? Number(squadId) : 0;
}

function hasValidPosition(player: BzssCoreTrackedPlayerInfo) {
  const pos = getPlayerPosition(player);
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

function resolveMapRoleInfo(player: BzssCoreTrackedPlayerInfo): RoleIconInfo {
  const health = getPlayerHealth(player);
  if (health != null && health <= 0) {
    return resolveRoleIcon("dead");
  }

  const vehicleInfo = player.vehicleInfo;
  if (vehicleInfo && vehicleInfo.vehicleType && vehicleInfo.vehicleType !== 'None') {
    const vehicleIcon = resolveVehicleIcon(vehicleInfo.vehicleType);
    return { icon: vehicleIcon.icon, label: `${vehicleIcon.label} (${vehicleInfo.vehicleType})`, tone: vehicleIcon.tone };
  }

  const roleSource = [player.soldierInfo?.soldierClass, player.soldierInfo?.weaponClass]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");

  return resolveRoleIcon(roleSource);
}

function isRoleIconImage(icon: string) {
  return String(icon ?? "").startsWith("/");
}

function getTeamRoleIconStyle(icon: string, teamId: number | null | undefined) {
  const iconUrl = String(icon ?? "");
  const color = getTeamRoleIconColor(teamId);
  return {
    backgroundColor: color,
    WebkitMaskImage: `url("${iconUrl}")`,
    maskImage: `url("${iconUrl}")`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  };
}

function getTeamRoleIconColor(teamId: number | null | undefined) {
  const tone = getPerspectiveTone(teamId);
  return getPerspectivePalette(tone).icon;
}

function getPerspectiveTone(teamId: number | null | undefined): PerspectiveTone {
  const normalized = normalizeTeam(teamId);
  if (normalized !== 1 && normalized !== 2) return "neutral";
  const viewerTeamId = resolvedViewerTeamId.value;
  if (viewerTeamId !== 1 && viewerTeamId !== 2) return "neutral";
  return normalized === viewerTeamId ? "friendly" : "enemy";
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

function getPlayerSpeedText(player: any) {
  const key = getPlayerKey(player);
  if (!key) return "-";
  const target = playerTargets.get(key);
  if (!target) return "0.0 m/s";
  
  const speedMS = Math.sqrt(target.vx * target.vx + target.vy * target.vy) / 100;
  const speedKMH = speedMS * 3.6;
  
  if (speedMS < 0.1) return "0.0 m/s";
  
  return `${speedMS.toFixed(1)} m/s (${Math.round(speedKMH)} km/h)`;
}

function getFlagLetter(name: string): string {
  if (!name) return "●";
  const parts = name.split("-");
  const first = parts[0]?.trim();
  if (/^\d+$/.test(first)) {
    const num = parseInt(first, 10);
    if (num >= 1 && num <= 26) {
      return String.fromCharCode(64 + num); // 1 -> A, 2 -> B, etc.
    }
  }
  return first || "●";
}

function cleanWeaponName(weaponClass: string | null | undefined): string {
  if (!weaponClass) return "-";
  return weaponClass
    .replace(/^(BP_|Weapon_)/i, "")
    .replace(/(_\d+)?_C.*$/i, "")
    .replace(/_\d+$/, "");
}

function getConstructionDashArray(fob: any) {
  const construction = Number(fob.construction ?? 0);
  const max = 2000;
  const ratio = Math.min(1.0, Math.max(0.0, construction / max));
  const perimeter = 2 * Math.PI * 14; // ~87.96
  return `${ratio * perimeter} ${perimeter}`;
}

function getAmmoDashArray(fob: any) {
  const ammo = Number(fob.ammo ?? 0);
  const max = 10000;
  const ratio = Math.min(1.0, Math.max(0.0, ammo / max));
  const perimeter = 2 * Math.PI * 11; // ~69.1
  return `${ratio * perimeter} ${perimeter}`;
}

function handleWindowKeyDown(e: KeyboardEvent) {
  const target = e.target as HTMLElement;
  if (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  ) {
    return;
  }

  const key = e.key.toUpperCase();
  if (key === "ESCAPE") {
    playerInfoPanel.value = null;
    playerActionMenu.value = null;
    mapCommandMenu.value = null;
    selectedPlayerKey.value = "";
  } else if (key === "M") {
    measureMode.value = !measureMode.value;
  } else if (key === "G") {
    showGrid.value = !showGrid.value;
  } else if (key === "F") {
    resetView();
  }
}

onMounted(() => {
  setTimeout(() => {
    fitToViewport();
  }, 100);

  logCombatEvent("Tactical map scan initialized... coordinate grid ready", "system");
  logCombatEvent("Live tactical tracking active", "system");

  if (import.meta.env.DEV) {
    simulatedCombatTimer = window.setInterval(runCombatEventSimulation, 2500);
  }
  window.addEventListener("resize", fitToViewport);
  window.addEventListener("keydown", handleWindowKeyDown);

  // Track viewport dimensions for tile loader
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
  if (simulatedCombatTimer) window.clearInterval(simulatedCombatTimer);
  window.removeEventListener("resize", fitToViewport);
  window.removeEventListener("keydown", handleWindowKeyDown);
  resizeObserver?.disconnect();
  resizeObserver = null;
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

/* Tiled map wrapper - applies same visual treatment as .map-image */
.tiled-map-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  opacity: 0.88;
  filter: contrast(1.1) brightness(0.85) saturate(0.9);
  border: 2px solid rgba(0, 240, 255, 0.2);
  overflow: hidden;
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



/* Capture point markers */
.capture-zone-layer {
  position: absolute;
  inset: 0;
  z-index: 8;
  pointer-events: none;
}

.capture-zone-marker {
  position: absolute;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  transform: translate(-50%, -50%);
  pointer-events: auto; /* Enable hovering */
  cursor: pointer;
}

.tactical-flag-node {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
}



/* Static Tech target crosshair */
.node-crosshair {
  position: absolute;
  width: 32px;
  height: 32px;
  left: -6px;
  top: -6px;
  pointer-events: none;
  transition: all 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.crosshair-bracket {
  position: absolute;
  width: 5px;
  height: 5px;
  border-color: rgba(245, 158, 11, 0.6);
  border-style: solid;
  border-width: 0;
  transition: all 0.3s ease;
}

.crosshair-bracket.top-left { top: 0; left: 0; border-top-width: 1.5px; border-left-width: 1.5px; }
.crosshair-bracket.top-right { top: 0; right: 0; border-top-width: 1.5px; border-right-width: 1.5px; }
.crosshair-bracket.bottom-left { bottom: 0; left: 0; border-bottom-width: 1.5px; border-left-width: 1.5px; }
.crosshair-bracket.bottom-right { bottom: 0; right: 0; border-bottom-width: 1.5px; border-right-width: 1.5px; }

/* Glowing core diamond */
.node-core-diamond {
  position: relative;
  width: 20px;
  height: 20px;
  background: rgba(11, 15, 26, 0.95);
  border: 1.5px solid #f59e0b;
  transform: rotate(45deg);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 10px rgba(245, 158, 11, 0.4), inset 0 0 4px rgba(245, 158, 11, 0.2);
  z-index: 2;
  flex: 0 0 auto;
  transition: all 0.3s ease;
}

.node-letter {
  display: inline-block;
  transform: rotate(-45deg);
  font-size: 9px;
  font-weight: 900;
  color: #ffffff;
  font-family: 'Outfit', 'Inter', sans-serif;
  text-shadow: 0 0 3px rgba(245, 158, 11, 0.8);
}

/* Integrated Label Container */
.node-label-container {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 4px 10px;
  background: rgba(9, 15, 30, 0.85);
  backdrop-filter: blur(10px);
  border: 1.5px solid rgba(245, 158, 11, 0.3);
  border-radius: 5px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.6);
  z-index: 1;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  transform: translateX(4px);
}

.node-index-label {
  font-size: 8px;
  font-weight: 900;
  color: #f59e0b;
  letter-spacing: 1px;
  font-family: monospace;
}

.node-name-text {
  font-size: 10px;
  font-weight: 700;
  color: #e2e8f0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

/* Hover effects */
.capture-zone-marker:hover .node-crosshair {
  width: 38px;
  height: 38px;
  left: -9px;
  top: -9px;
  transform: rotate(90deg);
}

.capture-zone-marker:hover .crosshair-bracket {
  border-color: #ffffff;
}

.capture-zone-marker:hover .node-core-diamond {
  background: #f59e0b;
  box-shadow: 0 0 18px #f59e0b;
  border-color: #ffffff;
}

.capture-zone-marker:hover .node-letter {
  color: #0b0f19;
  text-shadow: none;
}

.capture-zone-marker:hover .node-label-container {
  border-color: rgba(245, 158, 11, 0.95);
  background: rgba(15, 22, 42, 0.96);
  box-shadow: 0 8px 25px rgba(245, 158, 11, 0.2), 0 4px 15px rgba(0, 0, 0, 0.7);
  transform: translateX(8px);
}

/* Explosion Layer */
.explosion-layer {
  position: absolute;
  inset: 0;
  z-index: 10;
  pointer-events: none;
}

.explosion-marker {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
  filter: saturate(calc(1 + (var(--exp-intensity) - 1) * 0.22));
}

/* Background refraction/distortion wave */
.explosion-refraction-wave {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 44% 56% 52% 48% / 40% 58% 42% 60%;
  background:
    radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.22) 0%, rgba(255, 248, 220, 0.15) 12%, rgba(255, 255, 255, 0.04) 26%, transparent 56%),
    repeating-conic-gradient(
      from 0deg,
      rgba(255, 255, 255, 0.07) 0deg 14deg,
      rgba(255, 236, 179, 0.03) 14deg 32deg,
      transparent 32deg 54deg
    );
  mix-blend-mode: screen;
  -webkit-backdrop-filter: blur(12px) saturate(1.2) brightness(1.3) contrast(1.15) hue-rotate(var(--exp-flash-hue));
  backdrop-filter: blur(12px) saturate(1.2) brightness(1.3) contrast(1.15) hue-rotate(var(--exp-flash-hue));
  filter: blur(1px);
  animation: exp-refract-anim 1.55s cubic-bezier(0.12, 0.8, 0.24, 1) forwards;
  will-change: transform, opacity, filter;
  transform: translateZ(0);
  opacity: var(--exp-flash-alpha);
}

/* Main soft shockwave haze */
.explosion-pulse-ring {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background:
    radial-gradient(circle, rgba(255, 244, 214, 0.25) 0%, rgba(255, 200, 100, 0.12) 15%, rgba(226, 232, 240, 0.05) 35%, transparent 70%),
    radial-gradient(circle at 38% 42%, rgba(255, 255, 255, 0.2) 0%, transparent 25%),
    radial-gradient(circle at 62% 56%, rgba(255, 200, 80, 0.12) 0%, transparent 25%);
  filter: blur(14px);
  animation: exp-pulse-ring-anim 1.45s cubic-bezier(0.12, 0.8, 0.24, 1) forwards;
  opacity: calc(0.92 * var(--exp-flash-alpha));
}

/* Secondary plasma shockwave: fiery colored glow expanding and dissipating */
.explosion-plasma-wave {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: radial-gradient(circle, transparent 35%, rgba(255, 90, 0, 0.25) 55%, rgba(255, 200, 50, 0.15) 65%, transparent 75%);
  filter: blur(4px);
  animation: exp-plasma-wave-anim 1.2s cubic-bezier(0.1, 0.8, 0.15, 1) forwards;
  opacity: var(--exp-flash-alpha);
}

/* Sharp expanding pressure ring (Mach cone shockwave) */
.explosion-pressure-ring {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2.5px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 20px rgba(255, 255, 255, 0.6), inset 0 0 10px rgba(0, 240, 255, 0.25);
  filter: blur(0.5px);
  animation: exp-pressure-ring-anim 0.85s cubic-bezier(0.05, 0.75, 0.1, 1) forwards;
}

/* Particle dots and streaks flying outward */
.explosion-particles {
  position: absolute;
  width: 100%;
  height: 100%;
}

.particle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform-origin: center center;
  animation: particle-fade-drift 0.92s cubic-bezier(0.08, 0.72, 0.18, 1) forwards;
  animation-delay: var(--delay);
}

.particle.spark {
  width: calc(var(--particle-size) * 0.7);
  height: calc(var(--particle-size) * 6.5);
  background: linear-gradient(to top, rgba(255, 235, 120, 1) 0%, rgba(255, 110, 0, 0.85) 80%, rgba(255, 50, 0, 0) 100%);
  border-radius: 999px;
  box-shadow: 0 0 8px rgba(255, 160, 50, 0.85);
  margin-top: calc(-3.25 * var(--particle-size));
  margin-left: calc(-0.35 * var(--particle-size));
}

.particle.ember {
  width: calc(var(--particle-size) * 2.6);
  height: calc(var(--particle-size) * 2.6);
  background: radial-gradient(circle, rgba(255, 255, 255, 1) 0%, rgba(255, 160, 0, 0.95) 30%, rgba(255, 70, 0, 0.45) 60%, rgba(0, 0, 0, 0) 100%);
  border-radius: 50%;
  box-shadow: 0 0 12px rgba(255, 110, 0, 0.65);
  margin-top: calc(-1.3 * var(--particle-size));
  margin-left: calc(-1.3 * var(--particle-size));
}

/* Extremely soft center core but with vibrant plasma fire glow */
.explosion-core {
  position: absolute;
  width: 12px;
  height: 12px;
  background: radial-gradient(circle, #ffffff 0%, #ffeaa7 30%, #ff7675 60%, #d63031 90%, transparent 100%);
  border-radius: 50%;
  box-shadow:
    0 0 20px #ff7675,
    0 0 45px #ff7675,
    0 0 90px #ff3f34;
  filter: blur(0.5px);
  animation: exp-core-anim 0.85s cubic-bezier(0.1, 0.8, 0.2, 1) forwards;
}

/* Map Screen Shake */
.map-viewport.has-explosion-shake {
  animation: map-shake-anim 0.35s cubic-bezier(.36,.07,.19,.97) both;
}

/* Keyframe Animations */
@keyframes map-shake-anim {
  10%, 90% { transform: translate3d(-1px, 1px, 0); }
  20%, 80% { transform: translate3d(2.5px, -2.5px, 0); }
  30%, 50%, 70% { transform: translate3d(-4.5px, 4.5px, 0); }
  40%, 60% { transform: translate3d(4.5px, -4.5px, 0); }
}

@keyframes exp-refract-anim {
  0% { transform: scale(0.16) rotate(0deg) scaleX(0.92) scaleY(1.08); opacity: 0; }
  12% { opacity: calc(0.92 * var(--exp-flash-alpha)); }
  42% { opacity: calc(0.58 * var(--exp-flash-alpha)); }
  100% { transform: scale(1.36) rotate(var(--exp-spin)) scaleX(var(--exp-stretch-x)) scaleY(var(--exp-stretch-y)); opacity: 0; }
}

@keyframes exp-pulse-ring-anim {
  0% { transform: scale(0.18) scaleX(0.96) scaleY(1.04); opacity: 0; }
  10% { opacity: calc(0.82 * var(--exp-flash-alpha)); }
  55% { opacity: calc(0.32 * var(--exp-flash-alpha)); }
  100% { transform: scale(1.22) scaleX(var(--exp-stretch-x)) scaleY(var(--exp-stretch-y)); opacity: 0; }
}

@keyframes exp-plasma-wave-anim {
  0% { transform: scale(0.1); opacity: 0; }
  15% { opacity: 0.95; }
  100% { transform: scale(1.6) rotate(30deg); opacity: 0; }
}

@keyframes exp-pressure-ring-anim {
  0% { transform: scale(0.05); opacity: 0; border-width: 4px; }
  8% { opacity: 1; }
  100% { transform: scale(1.4); opacity: 0; border-width: 0.5px; }
}

@keyframes exp-core-anim {
  0% { transform: scale(0.3); opacity: 0; }
  14% { transform: scale(calc(2.1 * var(--exp-intensity))); opacity: 1; }
  100% { transform: scale(0.08); opacity: 0; }
}

/* Particles start beyond the core and outrun the soft haze quickly */
@keyframes particle-fade-drift {
  0% {
    transform: rotate(var(--angle)) translateY(calc(-0.35 * var(--start-offset) * var(--blast-radius))) scale(0.7);
    opacity: 0;
  }
  12% {
    transform: rotate(var(--angle)) translateY(calc(-1 * var(--start-offset) * var(--blast-radius))) scale(1);
    opacity: 0.95;
  }
  46% {
    opacity: 0.92;
  }
  100% {
    transform: rotate(calc(var(--angle) + (var(--exp-spin) * 0.28))) translateY(calc(-1 * (var(--start-offset) + (var(--spread) * var(--speed))) * var(--blast-radius))) scale(0.72);
    opacity: 0;
  }
}

/* FOB Overlay and Markers */
.fob-layer {
  position: absolute;
  inset: 0;
  z-index: 9;
  pointer-events: none;
}

.fob-marker {
  position: absolute;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transform: translate(-50%, -50%);
  pointer-events: auto; /* Allow hovering */
  cursor: pointer;
}

.tactical-fob-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
}

.fob-ring-outer {
  position: relative;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(8, 12, 24, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  transition: all 0.3s ease;
}

.fob-status-ring {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
  pointer-events: none;
}

.ring-track {
  fill: none;
  stroke-linecap: round;
  transition: stroke-dasharray 0.35s ease;
}

.const-track {
  stroke: #f97316; /* Construction Orange */
  filter: drop-shadow(0 0 2px rgba(249, 115, 22, 0.7));
}

.ammo-track {
  stroke: #06b6d4; /* Ammo Cyan */
  filter: drop-shadow(0 0 2px rgba(6, 182, 212, 0.7));
}

/* Core transceiver styling */
.fob-core-icon {
  position: relative;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 4px rgba(0, 0, 0, 0.6);
  z-index: 2;
  transition: all 0.3s ease;
}

/* Faction gradients */
.team-1 .fob-core-icon {
  background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
  border: 1px solid #3b82f6;
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.4);
}

.team-2 .fob-core-icon {
  background: linear-gradient(135deg, #7f1d1d 0%, #ef4444 100%);
  border: 1px solid #ef4444;
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.4);
}

.team-1 .fob-svg-icon {
  color: #93c5fd;
  filter: drop-shadow(0 0 2px rgba(59, 130, 246, 0.8));
}

.team-2 .fob-svg-icon {
  color: #fca5a5;
  filter: drop-shadow(0 0 2px rgba(239, 68, 68, 0.8));
}

.fob-core-glow {
  position: absolute;
  inset: -1px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.25);
  animation: core-glow-pulse 2s infinite ease-in-out;
}

@keyframes core-glow-pulse {
  0%, 100% { transform: scale(1); opacity: 0.3; }
  50% { transform: scale(1.15); opacity: 0.7; }
}

/* HUD under the marker */
.fob-quick-hud {
  width: 30px;
  height: 4px;
  background: rgba(15, 23, 42, 0.8);
  border: 0.5px solid rgba(255, 255, 255, 0.1);
  border-radius: 99px;
  overflow: hidden;
  margin-top: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.hp-bar {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #059669 0%, #10b981 100%);
  border-radius: 99px;
  transition: width 0.35s ease;
}

.fob-node-name {
  font-size: 8px;
  font-weight: 900;
  color: #e2e8f0;
  margin-top: 3px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: rgba(9, 15, 30, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 1px 5px;
  border-radius: 3px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
}

.team-1 .fob-node-name {
  border-color: rgba(59, 130, 246, 0.4);
  color: #93c5fd;
  text-shadow: 0 0 2px rgba(59, 130, 246, 0.5);
}

.team-2 .fob-node-name {
  border-color: rgba(239, 68, 68, 0.4);
  color: #fca5a5;
  text-shadow: 0 0 2px rgba(239, 68, 68, 0.5);
}

/* Bleeding Critical Warning State */
.fob-marker.is-bleeding {
  animation: fob-bleeding-pulse 1.2s infinite ease-in-out;
}

@keyframes fob-bleeding-pulse {
  0%, 100% {
    filter: drop-shadow(0 0 2px rgba(239, 68, 68, 0.4));
  }
  50% {
    filter: drop-shadow(0 0 12px rgba(239, 68, 68, 0.9));
  }
}

.fob-marker.is-bleeding .fob-ring-outer {
  border-color: #ef4444;
  background: rgba(24, 8, 8, 0.95);
}

.fob-marker.is-bleeding .hp-bar {
  background: #ef4444;
  animation: bleeding-bar-flash 0.5s infinite alternate;
}

@keyframes bleeding-bar-flash {
  from { opacity: 0.5; }
  to { opacity: 1; }
}

.fob-marker.is-bleeding .fob-node-name {
  border-color: rgba(239, 68, 68, 0.7);
  color: #f87171;
  background: rgba(40, 10, 10, 0.92);
}

/* Hover Scale */
.fob-marker:hover .fob-ring-outer {
  transform: scale(1.1);
  border-color: rgba(255, 255, 255, 0.25);
  box-shadow: 0 0 15px rgba(255, 255, 255, 0.1);
}

/* FOB Hover details tooltip */
.fob-tooltip {
  display: none;
  position: absolute;
  bottom: 45px;
  left: 50%;
  transform: translateX(-50%);
  width: 180px;
  background: rgba(8, 12, 24, 0.95);
  backdrop-filter: blur(12px);
  border: 1.5px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 12px;
  box-shadow: 0 15px 35px rgba(0, 0, 0, 0.8), 0 0 15px rgba(255, 255, 255, 0.05);
  z-index: 100;
  transition: all 0.2s ease;
  pointer-events: none;
}

.team-1 .fob-tooltip {
  border-color: rgba(59, 130, 246, 0.45);
  box-shadow: 0 15px 35px rgba(0, 0, 0, 0.8), 0 0 15px rgba(59, 130, 246, 0.1);
}

.team-2 .fob-tooltip {
  border-color: rgba(239, 68, 68, 0.45);
  box-shadow: 0 15px 35px rgba(0, 0, 0, 0.8), 0 0 15px rgba(239, 68, 68, 0.1);
}

.fob-marker:hover .fob-tooltip {
  display: block;
}

.fob-tooltip-title {
  color: #ffffff;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.75px;
  text-transform: uppercase;
  border-bottom: 1.5px solid rgba(255, 255, 255, 0.08);
  padding-bottom: 6px;
  margin-bottom: 8px;
  text-align: center;
}

.team-1 .fob-tooltip-title {
  color: #93c5fd;
  border-color: rgba(59, 130, 246, 0.2);
}

.team-2 .fob-tooltip-title {
  color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.2);
}

.fob-tooltip-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.fob-tooltip-metric {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.metric-info {
  display: flex;
  justify-content: space-between;
  font-size: 8.5px;
  font-weight: 700;
  color: #94a3b8;
  letter-spacing: 0.5px;
}

.metric-label {
  text-transform: uppercase;
}

.metric-value {
  color: #ffffff;
  font-family: monospace;
}

.metric-bar-track {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 99px;
  overflow: hidden;
}

.metric-bar-fill {
  height: 100%;
  border-radius: 99px;
  transition: width 0.3s ease;
}

.hp-fill { background: linear-gradient(90deg, #10b981 0%, #34d399 100%); }
.hp-fill.is-bleeding-fill { background: #ef4444; }
.ammo-fill { background: linear-gradient(90deg, #06b6d4 0%, #22d3ee 100%); }
.const-fill { background: linear-gradient(90deg, #f97316 0%, #fb923c 100%); }

.fob-tooltip-item.alert-item {
  justify-content: center;
  background: rgba(220, 38, 38, 0.15);
  border: 1px solid rgba(220, 38, 38, 0.3);
  padding: 4px;
  border-radius: 4px;
  margin-top: 2px;
}

.bleeding-alert {
  color: #f87171;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.5px;
  animation: pulse-alert 1s infinite alternate;
}

@keyframes pulse-alert {
  from { opacity: 0.6; }
  to { opacity: 1; }
}

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
  transition: none;
  will-change: left, top, transform;
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

.tone-friendly .marker-pulse,
.tone-enemy .marker-pulse,
.tone-neutral .marker-pulse {
  border: 2px solid var(--perspective-pulse, #00c8ff);
  animation: pulse-ring-blue 2.4s infinite;
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
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background-color: #0b1120;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.8);
  border: 2px solid;
  transition: all 0.2s ease;
}

.tone-friendly .marker-ring,
.tone-enemy .marker-ring,
.tone-neutral .marker-ring {
  border-color: var(--perspective-primary, #37c8ff);
  background-color: var(--perspective-deep, #0b6fa3);
  box-shadow: 0 0 8px var(--perspective-glow, rgba(55, 200, 255, 0.35));
}
.is-dead .marker-ring {
  filter: saturate(0.85) brightness(0.7);
  opacity: 0.8;
  box-shadow: none;
}

/* Leader special outline slightly larger scale only */
.is-squadleader .marker-ring {
  transform: translate(-50%, -50%) scale(1.15);
}

.kit-icon-fallback {
  width: 11px;
  height: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  line-height: 1;
  color: #e2e8f0;
  font-weight: 700;
}

.kit-icon-mask {
  width: 11px;
  height: 11px;
  display: inline-block;
}

.inline-kit-mask {
  width: 9px;
  height: 9px;
  display: inline-block;
}

.kit-icon-mask,
.inline-kit-mask {
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}

.tone-friendly .kit-icon-mask,
.tone-friendly .inline-kit-mask,
.tone-enemy .kit-icon-mask,
.tone-enemy .inline-kit-mask,
.tone-neutral .kit-icon-mask,
.tone-neutral .inline-kit-mask {
  color: var(--perspective-icon, #7de6ff);
}

.is-dead .kit-icon-mask,
.is-dead .inline-kit-mask {
  opacity: 0.55;
  filter: grayscale(1) brightness(0.9);
}

.squad-index-tag {
  position: absolute;
  bottom: -5px;
  right: -3px;
  background-color: #0f172a;
  color: #e2e8f0;
  font-size: 7.5px;
  line-height: 1;
  padding: 1px 2.5px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  font-family: monospace;
  font-weight: bold;
  z-index: 3;
}

.tone-friendly .squad-index-tag,
.tone-enemy .squad-index-tag,
.tone-neutral .squad-index-tag {
  color: var(--perspective-primary, #37c8ff);
}

/* Player direction indicators */
.marker-direction {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 26px;
  height: 26px;
  transform-origin: center center;
  pointer-events: none;
  z-index: 1;
}

.direction-arrow {
  position: absolute;
  top: -5px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 3px solid transparent;
  border-right: 3px solid transparent;
  border-bottom: 5px solid #ffffff;
}

.tone-friendly .direction-arrow,
.tone-enemy .direction-arrow,
.tone-neutral .direction-arrow {
  border-bottom-color: var(--perspective-primary, #37c8ff);
}

.is-dead .direction-arrow {
  display: none;
}



/* Interactive Hover/Active States with explicit translate centered fix */
.player-marker.is-hovered .marker-ring,
.player-marker:hover .marker-ring {
  transform: translate(-50%, -50%) scale(1.3);
  z-index: 50;
  border-color: #ffffff !important;
  box-shadow: 0 0 15px rgba(255, 255, 255, 0.9);
}

.player-marker.is-hovered.is-squadleader .marker-ring,
.player-marker:hover.is-squadleader .marker-ring {
  transform: translate(-50%, -50%) scale(1.4);
}



/* Floating Player Hover Tooltip */
.player-tooltip {
  position: absolute;
  width: 170px;
  background: rgba(6, 9, 22, 0.85);
  border: 1.5px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  padding: 6px 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(10px);
  z-index: 100;
  pointer-events: none;
  animation: tooltip-fade-in 0.15s ease-out;
}

@keyframes tooltip-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.player-tooltip.tone-friendly,
.player-tooltip.tone-enemy,
.player-tooltip.tone-neutral {
  border-color: var(--perspective-tooltip, rgba(55, 200, 255, 0.6)) !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.85), 0 0 15px var(--perspective-glow, rgba(55, 200, 255, 0.25));
}

.player-tooltip.tone-friendly .tooltip-health-badge,
.player-tooltip.tone-enemy .tooltip-health-badge,
.player-tooltip.tone-neutral .tooltip-health-badge {
  color: var(--perspective-primary, #37c8ff);
  background: var(--perspective-chip, rgba(55, 200, 255, 0.12));
  border-color: color-mix(in srgb, var(--perspective-primary, #37c8ff) 30%, transparent);
}

.player-tooltip .squad-color-pill {
  background: var(--perspective-primary, #37c8ff) !important;
}

.tooltip-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 5px;
}

.tooltip-name {
  font-weight: bold;
  font-size: 11px;
  color: #ffffff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.tooltip-health-badge {
  font-size: 8px;
  font-family: monospace;
  padding: 1px 4px;
  border-radius: 3px;
  font-weight: bold;
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
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.15), transparent);
  margin-bottom: 6px;
}

.tooltip-details {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  color: #94a3b8;
}

.detail-label {
  font-size: 8.5px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-val {
  color: #e2e8f0;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
}

.inline-kit-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 9px;
  height: 9px;
  font-size: 8px;
  line-height: 1;
  color: #e2e8f0;
  font-weight: 700;
}

.squad-color-pill {
  width: 5px;
  height: 5px;
  border-radius: 50%;
}

.highlight-cyan {
  color: #00e5ff;
}

.tooltip-health-track {
  width: 100%;
  height: 2px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 1px;
  margin-top: 5px;
  overflow: hidden;
}

.tooltip-health-bar {
  height: 100%;
  border-radius: 1px;
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

.team-ticket-block .ticket-number {
  color: var(--perspective-primary, #37c8ff);
  text-shadow: 0 0 10px var(--perspective-text-glow, rgba(55, 200, 255, 0.3));
}

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

.ticket-progress-fill { background-color: var(--perspective-primary, #37c8ff); }

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

.option-item-slider--stacked {
  align-items: flex-start;
  flex-direction: column;
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

.perspective-switch {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}

.perspective-btn {
  min-width: 76px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: #cbd5e1;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}

.perspective-btn:hover {
  border-color: rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.06);
}

.perspective-btn.active {
  border-color: var(--perspective-primary, #38bdf8);
  color: var(--perspective-primary, #38bdf8);
  background: var(--perspective-chip, rgba(56, 189, 248, 0.12));
  box-shadow: inset 0 0 6px color-mix(in srgb, var(--perspective-primary, #38bdf8) 18%, transparent);
}

.perspective-summary {
  font-size: 11px;
  line-height: 1.4;
  color: #94a3b8;
  margin-top: 2px;
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
  background: var(--perspective-chip, rgba(0, 240, 255, 0.1));
  color: var(--perspective-primary, #00e5ff);
  box-shadow: inset 0 0 5px color-mix(in srgb, var(--perspective-primary, #00e5ff) 16%, transparent);
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
  background: var(--perspective-chip, rgba(0, 240, 255, 0.05));
  border-color: color-mix(in srgb, var(--perspective-primary, #00e5ff) 35%, transparent);
  box-shadow: 0 0 10px color-mix(in srgb, var(--perspective-primary, #00e5ff) 18%, transparent);
}

.sidebar-squad-card.is-focused {
  background: var(--perspective-chip, rgba(0, 240, 255, 0.08));
  border-color: var(--perspective-primary, #00e5ff);
  box-shadow: inset 0 0 6px color-mix(in srgb, var(--perspective-primary, #00e5ff) 20%, transparent), 0 0 12px color-mix(in srgb, var(--perspective-primary, #00e5ff) 20%, transparent);
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
  color: var(--perspective-primary, #00e5ff);
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
  background: var(--perspective-chip, rgba(0, 240, 255, 0.06));
  border-color: color-mix(in srgb, var(--perspective-primary, #00e5ff) 40%, transparent);
}

.sidebar-player-card-row.tone-friendly,
.sidebar-player-card-row.tone-enemy,
.sidebar-player-card-row.tone-neutral {
  border-left: 3px solid var(--perspective-primary, #00e5ff);
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
:deep(.tone-friendly-text),
:deep(.tone-enemy-text),
:deep(.tone-neutral-text) {
  font-weight: bold;
}

:deep(.tone-friendly-text) {
  color: #00e5ff;
}

:deep(.tone-enemy-text) {
  color: #ff5b6e;
}

:deep(.tone-neutral-text) {
  color: #cbd5e1;
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

/* Distance Measuring tool classes */
.map-measure-svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 1000px;
  height: 1000px;
  pointer-events: none;
  z-index: 9;
}

.measure-polyline {
  filter: drop-shadow(0 0 6px rgba(255, 204, 0, 0.7));
}

.measure-point {
  filter: drop-shadow(0 0 4px rgba(255, 204, 0, 0.8));
  transition: r 0.2s ease;
}

.measure-labels-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 12;
}

.measure-distance-label {
  position: absolute;
  transform: translate(-50%, -120%);
  background: rgba(11, 17, 32, 0.92);
  border: 1px solid rgba(255, 204, 0, 0.8);
  color: #ffcc00;
  font-size: 10px;
  font-weight: bold;
  padding: 3px 7px;
  border-radius: 5px;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.7), 0 0 8px rgba(255, 204, 0, 0.15);
  backdrop-filter: blur(4px);
}

.ctrl-btn.text-btn.measure-btn.active {
  background: rgba(255, 204, 0, 0.2);
  color: #ffcc00;
  border-color: #ffcc00;
  box-shadow: inset 0 0 6px rgba(255, 204, 0, 0.2), 0 0 10px rgba(255, 204, 0, 0.15);
}

.ctrl-btn.text-btn.hotspot-ctrl-btn.active {
  background: rgba(0, 229, 255, 0.2);
  color: #00e5ff;
  border-color: #00e5ff;
  box-shadow: inset 0 0 6px rgba(0, 229, 255, 0.2), 0 0 10px rgba(0, 229, 255, 0.15);
}

.hotspot-circle {
  filter: drop-shadow(0 0 8px rgba(0, 229, 255, 0.5));
  animation: hotspot-pulse 4s infinite ease-in-out;
}

@keyframes hotspot-pulse {
  0% { stroke-opacity: 0.5; fill-opacity: 0.03; }
  50% { stroke-opacity: 0.9; fill-opacity: 0.07; }
  100% { stroke-opacity: 0.5; fill-opacity: 0.03; }
}

.hotspot-center {
  filter: drop-shadow(0 0 6px #ef5350);
}

.disengaged-sidebar-tag {
  font-size: 8px;
  font-weight: bold;
  background: rgba(239, 83, 80, 0.18);
  color: #ef5350;
  padding: 1px 3px;
  border-radius: 3px;
  border: 1px solid rgba(239, 83, 80, 0.35);
  margin-left: 6px;
  display: inline-block;
  vertical-align: middle;
  line-height: 1;
}

.player-disengaged-tag {
  font-size: 7px;
  font-weight: bold;
  color: #ff5b6e;
  background: rgba(255, 91, 110, 0.18);
  border: 1px solid rgba(255, 91, 110, 0.35);
  padding: 0px 2px;
  border-radius: 2px;
  line-height: 1;
}

.player-marker.is-disengaged {
  opacity: 0.58;
}

.player-marker.is-disengaged:hover,
.player-marker.is-disengaged.is-hovered {
  opacity: 1;
}

/* ─── BZSS-Core Info Panel Styles ─── */

.bzss-core-tab-btn.active {
  background: rgba(168, 85, 247, 0.12) !important;
  color: #c084fc !important;
}

.bzss-core-scroll {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
}

.bzss-info-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 10px 12px;
  transition: border-color 0.25s ease;
}

.bzss-info-card:hover {
  border-color: rgba(255, 255, 255, 0.12);
}

.bzss-info-card--error {
  border-color: rgba(239, 83, 80, 0.3);
  background: rgba(239, 83, 80, 0.04);
}

.bzss-card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  color: #e2e8f0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.bzss-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

.bzss-status-dot.status-ok {
  background: #4ade80;
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.5);
  animation: bzss-pulse-dot 2s infinite;
}

.bzss-status-dot.status-idle {
  background: #facc15;
  box-shadow: 0 0 6px rgba(250, 204, 21, 0.4);
}

.bzss-status-dot.status-error {
  background: #ef5350;
  box-shadow: 0 0 6px rgba(239, 83, 80, 0.5);
}

@keyframes bzss-pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.bzss-stats-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bzss-stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 0;
}

.bzss-stat-label {
  font-size: 10px;
  color: #64748b;
  font-weight: 500;
}

.bzss-stat-value {
  font-size: 10px;
  color: #e2e8f0;
  font-weight: 600;
}

.bzss-stat-value.status-ok {
  color: #4ade80;
}

.bzss-stat-value.status-idle {
  color: #facc15;
}

.bzss-stat-value.status-error {
  color: #ef5350;
}

.bzss-badge {
  display: inline-block;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  line-height: 1.4;
  letter-spacing: 0.3px;
}

.bzss-badge--ok {
  background: rgba(74, 222, 128, 0.15);
  color: #4ade80;
  border: 1px solid rgba(74, 222, 128, 0.3);
}

.bzss-badge--warn {
  background: rgba(250, 204, 21, 0.12);
  color: #facc15;
  border: 1px solid rgba(250, 204, 21, 0.3);
}

.bzss-badge--danger {
  background: rgba(239, 83, 80, 0.15);
  color: #ef5350;
  border: 1px solid rgba(239, 83, 80, 0.3);
  animation: bzss-blink 1.2s infinite;
}

@keyframes bzss-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.bzss-count-badge {
  margin-left: auto;
  font-size: 9px;
  background: rgba(0, 229, 255, 0.1);
  color: #00e5ff;
  padding: 1px 5px;
  border-radius: 4px;
  font-weight: 600;
  font-family: monospace;
}

.bzss-entity-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.bzss-entity-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 6px;
  background: rgba(255, 255, 255, 0.015);
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.03);
  transition: background 0.2s;
}

.bzss-entity-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.bzss-entity-name {
  font-size: 10px;
  color: #cbd5e1;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 55%;
}

.bzss-entity-meta {
  font-size: 9px;
  color: #64748b;
}

.bzss-fob-row {
  flex-direction: column;
  align-items: stretch;
  gap: 5px;
  padding: 6px 8px;
}

.bzss-fob-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.bzss-team-indicator {
  font-size: 8px;
  font-weight: 700;
  padding: 1px 3px;
  border-radius: 3px;
  margin-right: 4px;
}

.bzss-team-indicator.team-ind-1 {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.bzss-team-indicator.team-ind-2 {
  background: rgba(239, 83, 80, 0.2);
  color: #ef5350;
  border: 1px solid rgba(239, 83, 80, 0.3);
}

.bzss-fob-bars {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.bzss-mini-metric {
  display: flex;
  align-items: center;
  gap: 5px;
}

.bzss-mini-label {
  font-size: 8px;
  color: #64748b;
  width: 24px;
  flex-shrink: 0;
  text-align: right;
}

.bzss-mini-bar-track {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: hidden;
}

.bzss-mini-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.5s ease;
}

.bzss-fill-hp { background: linear-gradient(90deg, #ef5350, #4ade80); }
.bzss-fill-ammo { background: #00e5ff; }
.bzss-fill-const { background: #f59e0b; }

.bzss-mini-val {
  font-size: 8px;
  color: #94a3b8;
  width: 32px;
  text-align: right;
  flex-shrink: 0;
}

.bzss-raw-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.bzss-raw-field-tag {
  font-size: 8px;
  font-family: monospace;
  background: rgba(255, 255, 255, 0.04);
  color: #94a3b8;
  padding: 2px 5px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.bzss-error-text {
  font-size: 10px;
  color: #ef5350;
  word-break: break-all;
  line-height: 1.4;
}

.glowing-square.orange {
  background: #f59e0b;
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.5);
}

.glowing-square.green {
  background: #4ade80;
  box-shadow: 0 0 8px rgba(74, 222, 128, 0.5);
}

/* Simple Tooltip Styling */
.player-tooltip-simple {
  position: absolute;
  background: rgba(10, 15, 30, 0.9);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  border: 1px solid var(--perspective-primary);
  border-radius: 3px;
  padding: 4px 8px;
  font-size: 10px;
  color: #ffffff;
  pointer-events: none;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6), 0 0 6px var(--perspective-glow);
  z-index: 150;
  animation: tooltipAppear 0.15s ease-out;
}

@keyframes tooltipAppear {
  from { opacity: 0; transform: translate(-50%, -100%) scale(0.95); }
  to { opacity: 1; transform: translate(-50%, -100%) scale(1); }
}

.player-name-simple {
  font-weight: 700;
}

.squad-simple {
  color: var(--perspective-soft);
  opacity: 0.85;
}

/* Command Hotkey Hints Layout */
.map-command-hint {
  position: absolute;
  left: 20px;
  bottom: 80px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 6px 12px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.65);
  z-index: 10;
  pointer-events: none;
  background: rgba(8, 12, 24, 0.75);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(0, 229, 255, 0.15);
  border-radius: 4px;
}

.map-command-hint .hint-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.map-command-hint .key {
  background: rgba(0, 229, 255, 0.12);
  color: #00e5ff;
  padding: 1px 4px;
  border-radius: 3px;
  border: 1px solid rgba(0, 229, 255, 0.25);
  font-weight: bold;
}
</style>





