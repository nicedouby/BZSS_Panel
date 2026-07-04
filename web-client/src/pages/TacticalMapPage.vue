<template>
  <div class="tactical-map-layout">
    <!-- Main Map Viewport -->
    <div
      ref="containerRef"
      class="map-viewport"
      :class="{ 'has-explosion-shake': isShaking, 'is-dragging': isDragging }"
      @pointerdown="startDrag"
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
            transform: mapTransformStyle.transform,
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
  <div class="player-markers-layer" :style="{ pointerEvents: measureMode || isDragging ? 'none' : 'auto' }">
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
            <!-- Black smoke clouds -->
            <div class="explosion-smoke-group">
              <div class="smoke-puff puff-1"></div>
              <div class="smoke-puff puff-2"></div>
              <div class="smoke-puff puff-3"></div>
              <div class="smoke-puff puff-4"></div>
            </div>
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
        <svg v-if="measureMode || combatHotspot != null || showSquadFollow" class="map-measure-svg">
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

          <g v-if="showSquadFollow">
            <g
              v-for="circle in squadFollowCircles"
              :key="circle.key"
              class="squad-follow-circle"
            >
              <circle
                :cx="circle.mapX * 10"
                :cy="circle.mapY * 10"
                :r="circle.radiusSvg"
                fill="rgba(251, 191, 36, 0.035)"
                stroke="rgba(251, 191, 36, 0.75)"
                stroke-width="2"
                stroke-dasharray="7,5"
              />
              <text
                :x="circle.mapX * 10"
                :y="circle.mapY * 10 - circle.radiusSvg - 8"
                text-anchor="middle"
                class="squad-follow-label"
              >
                S{{ circle.squadId }} 跟队 {{ circle.insideCount }}/{{ circle.aliveMembers }}
              </text>
            </g>
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
        <div class="tooltip-main-row">
          <span class="player-name-simple">{{ getPlayerLabel(hoveredMarker) }}</span>
          <span class="squad-simple" v-if="hoveredMarker.squadId">#{{ hoveredMarker.squadId }}</span>
        </div>
        <div class="tooltip-meta-row">
          <span class="role-simple">{{ displayRole(hoveredMarker.roleInfo?.label || hoveredMarker.role) }}</span>
        </div>
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
        :follow-status="getPlayerFollowStatus(playerInfoPanel.player)"
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
        :measure-active="measureMode"
        :measure-count="measurePoints.length"
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

        <button
          class="ctrl-btn text-btn"
          :class="{ active: showSquadFollow }"
          @click="showSquadFollow = !showSquadFollow"
          title="闃熼暱璺熼殢鍦?200m"
        >
          璺熼槦
        </button>

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
      :squad-follow="squadFollow"
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
import { computed, onBeforeUnmount, onMounted, ref, nextTick, watch } from "vue";
import { t } from "../i18n";
import {
  type BzssCorePlayerInfoResponse,
  type BzssCoreCaptureZoneInfo,
  type BzssCoreFobInfo,
  type BzssCoreTrackedPlayerInfo,
  type BzssCoreTrackedVector,
} from "../app/bzssCoreApi";
import { useAuthStore } from "../stores/auth.store";
import { useServerStore } from "../stores/server.store";
import { adaptPlayerDetail } from "../utils/squad-admin-adapter";
import { type TacticalLinkedPlayer } from "../utils/tactical-map-linker";
import { resolveRoleIcon, type RoleIconInfo } from "../utils/role-icons";
import { resolveVehicleIcon } from "../utils/vehicle-icons";
import type { PlayerDetailViewModel } from "../types/squad-admin.types";
import {
  getDefaultTacticalMapKey,
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
import { useMapCamera } from "../composables/useMapCamera";
import { provideTacticalMapViewport } from "../composables/tacticalMapViewport";

const props = withDefaults(defineProps<{
  snapshot: BzssCorePlayerInfoResponse | null;
  players: TacticalLinkedPlayer[];
  captureZones?: BzssCoreCaptureZoneInfo[];
  fobs?: BzssCoreFobInfo[];
  loading: boolean;
  errorText: string;
  playtimes?: Record<string, any> | null;
  combatStatsLookup?: Record<string, any> | null;
}>(), {
  snapshot: null,
  players: () => [],
  captureZones: () => [],
  fobs: () => [],
  loading: false,
  errorText: "",
  playtimes: () => ({}),
  combatStatsLookup: () => ({}),
});

const emit = defineEmits<{
  (e: "select-player", payload: { detail: any; event: MouseEvent }): void;
  (e: "snapshot-ready", payload: { ready: boolean; reason?: string }): void;
  (e: "warn-player", player: any): void;
  (e: "kick-player", player: any): void;
  (e: "force-team-player", player: any): void;
}>();

interface MapMarker extends TacticalLinkedPlayer {
  mapX: number;
  mapY: number;
  roleInfo: RoleIconInfo;
  rconDetail: PlayerDetailViewModel | null;
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
const authStore = useAuthStore();

function displayRole(role: string | null | undefined) {
  const raw = String(role ?? "").trim();
  if (!raw || raw === "Unknown Role") return t("role.unknownRole");
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const keyMap: Record<string, string> = {
    squadleader: "role.squadLeader",
    medic: "role.medic",
    heavyantitank: "role.heavyAntiTank",
    lightantitank: "role.lightAntiTank",
    machinegunner: "role.machineGunner",
    automaticrifleman: "role.automaticRifleman",
    engineer: "role.engineer",
    sapper: "role.sapper",
    marksman: "role.marksman",
    sniper: "role.sniper",
    grenadier: "role.grenadier",
    crewman: "role.crewman",
    pilot: "role.pilot",
    rifleman: "role.rifleman",
  };
  const key = keyMap[normalized];
  return key ? t(key, raw) : raw;
}

function getPlayerRconDetail(player: any) {
  if (player?.rconDetail) {
    return player.rconDetail;
  }

  const rcon = player?.raw?.rcon ?? player?.runtime ?? null;
  if (!rcon) return null;

  const steamId = (rcon.steamID as string | undefined) || (rcon.steam64 as string | undefined) || null;
  const playtime = steamId
    ? (props.playtimes?.[steamId]?.playtimeHours ?? player?.profile?.playtimeHours ?? null)
    : (player?.profile?.playtimeHours ?? null);
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
const players = computed(() => Array.isArray(props.players) ? props.players : []);
const captureZones = computed(() => Array.isArray(props.captureZones) ? props.captureZones : snapshot.value?.captureZones ?? []);
const fobs = computed(() => Array.isArray(props.fobs) ? props.fobs : snapshot.value?.fobs ?? []);

const serverMapName = computed(() => serverStore.snapshot?.mapName || "");

const selectedMapKey = ref("auto");
const detectedMapKey = computed(() => resolveTacticalMapKey(serverMapName.value) ?? getDefaultTacticalMapKey() ?? "");
const detectedMapName = computed(() => TACTICAL_MAP_CONFIGS[detectedMapKey.value]?.name ?? "Unknown");

const activeMapConfig = computed(() => {
  let key = selectedMapKey.value;
  if (key === "auto") {
    key = detectedMapKey.value;
  }
  return TACTICAL_MAP_CONFIGS[key] || TACTICAL_MAP_LIST[0] || null;
});

const mapOptions = computed<TacticalMapConfig[]>(() => TACTICAL_MAP_LIST);

// Cache to prevent players disappearing when data is missing temporarily
const cachedPlayers = ref<Record<string, { player: TacticalLinkedPlayer; lastSeen: number }>>({});
const positionedPlayers = computed<TacticalLinkedPlayer[]>(() => {
  return Object.values(cachedPlayers.value).map((entry) => entry.player);
});

const hoveredPlayer = ref<TacticalLinkedPlayer | null>(null);
const errorText = computed(() => props.errorText);
const loading = computed(() => props.loading);
let simulatedCombatTimer: number | null = null;

// Viewport Zoom & Pan state
const containerRef = ref<HTMLElement | null>(null);
const mapRef = ref<HTMLElement | null>(null);
const consoleRef = ref<HTMLElement | null>(null);

const camera = useMapCamera();
const panX = camera.x;
const panY = camera.y;
const zoom = camera.zoom;
const isDragging = camera.isDragging;
const mapTransformStyle = computed(() => camera.getTransform());

provideTacticalMapViewport({ zoom, panX, panY });

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
type MeasurePoint = {
  mapX: number;
  mapY: number;
  gameX: number;
  gameY: number;
};

const measurePoints = ref<MeasurePoint[]>([]);

// Map Interaction States Layer
const selectedPlayerKey = ref<string>("");
const playerInfoPanel = ref<{
  player: TacticalLinkedPlayer;
  x: number;
  y: number;
} | null>(null);
const playerActionMenu = ref<{
  player: TacticalLinkedPlayer;
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
const showSquadFollow = ref(true);
const squadFollow = computed(() => (props.snapshot as any)?.squadFollow ?? null);
const squadFollowPlayerIndex = computed<Record<string, any>>(() => {
  return squadFollow.value?.playerIndex ?? {};
});
const squadFollowSquads = computed<any[]>(() => {
  return Array.isArray(squadFollow.value?.squads) ? squadFollow.value.squads : [];
});

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

const squadFollowCircles = computed(() => {
  const bounds = activeMapConfig.value.bounds;
  const mapGameWidth = bounds.maxX - bounds.minX;
  if (mapGameWidth <= 0) return [];

  const radiusGameUnits = Number(squadFollow.value?.radiusGameUnits ?? 20000);
  const radiusSvg = (radiusGameUnits / mapGameWidth) * 1000;

  return squadFollowSquads.value
    .filter((squad) => squad?.leader?.position)
    .map((squad) => ({
      key: squad.key,
      teamId: squad.teamId,
      squadId: squad.squadId,
      leaderName: squad.leader.name,
      insideCount: squad.insideCount,
      aliveMembers: squad.aliveMembers ?? squad.totalMembers,
      outsideCount: squad.outsideCount,
      mapX: project(Number(squad.leader.position.x ?? 0), bounds.minX, bounds.maxX),
      mapY: project(Number(squad.leader.position.y ?? 0), bounds.minY, bounds.maxY),
      radiusSvg,
    }));
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

function isPlayerDisengaged(player: BzssCoreTrackedPlayerInfo): boolean | null {
  const key = getPlayerKey(player);
  const followState = squadFollowPlayerIndex.value[key];
  if (followState) {
    const reason = String(followState.reason ?? "").trim();
    if (reason === "" || reason === "outside_leader_radius") {
      return followState.disengaged == null ? null : Boolean(followState.disengaged);
    }
    return null;
  }

  if (!combatHotspot.value) return null;
  const pos = player.soldierInfo?.position;
  if (!pos) return null;
  
  const dx = (pos.x ?? 0) - combatHotspot.value.gameX;
  const dy = (pos.y ?? 0) - combatHotspot.value.gameY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // 1000 meters = 100,000 game units
  return dist > 100000;
}

function getPlayerFollowStatus(player: BzssCoreTrackedPlayerInfo) {
  return squadFollowPlayerIndex.value[getPlayerKey(player)] ?? null;
}

// Position and Rotation Spring-Damper State
interface PlayerTarget {
  x: number;
  y: number;
  yaw: number | null;
  vx: number;
  vy: number;
  speedMs: number;
  speedSampleMs: number;
  lastSeen: number;
}

const playerTargets = new Map<string, PlayerTarget>();

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
    const currentKeys = new Set<string>();
    let changed = false;

    newPlayers.forEach((player) => {
      const key = getPlayerKey(player);
      if (!key) return;
      currentKeys.add(key);
      if (hasValidPosition(player)) {
        nextCache[key] = {
          player,
          lastSeen: now
        };
        changed = true;
      }
    });

    for (const key of Object.keys(nextCache)) {
      if (!currentKeys.has(key)) {
        delete nextCache[key];
        changed = true;
      }
    }

    if (changed) {
      cachedPlayers.value = nextCache;
    }
  },
  { immediate: true }
);

// Clear player cache if active map changes
watch(
  activeMapConfig,
  () => {
    cachedPlayers.value = {};
    playerTargets.clear();
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
      let speedMs = 0;
      let speedSampleMs = 0;
      if (lastTarget) {
        const dt = (now - lastTarget.lastSeen) / 1000;
        if (dt > 0.05) {
          vx = (nextX - lastTarget.x) / dt;
          vy = (nextY - lastTarget.y) / dt;
          const sampleSpeedMs = Math.sqrt(vx * vx + vy * vy) / 100;
          speedSampleMs = sampleSpeedMs;
          const speedAlpha = sampleSpeedMs < 0.3
            ? clamp01(Math.max(0.08, Math.min(0.16, dt * 0.15)))
            : clamp01(Math.max(0.22, Math.min(0.38, dt * 0.42)));
          speedMs = lastTarget.speedMs > 0
            ? lerp(lastTarget.speedMs, sampleSpeedMs, speedAlpha)
            : sampleSpeedMs;
        } else {
          vx = lastTarget.vx;
          vy = lastTarget.vy;
          speedMs = lastTarget.speedMs;
        }
      }

      playerTargets.set(key, {
        x: nextX,
        y: nextY,
        yaw: nextYaw,
        vx,
        vy,
        speedMs,
        speedSampleMs,
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
  },
  { immediate: true }
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
  if (isDragging.value || dragMoved) {
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
function handlePlayerSingleClick(player: TacticalLinkedPlayer, event: MouseEvent) {
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

function handlePlayerDoubleClick(player: TacticalLinkedPlayer, event: MouseEvent) {
  if (singleClickTimer.value) {
    clearTimeout(singleClickTimer.value);
    singleClickTimer.value = null;
  }

  playerInfoPanel.value = null;
  playerActionMenu.value = null;
  mapCommandMenu.value = null;

  showPlayerDetails(player, event);
}

function handlePlayerRightClick(player: TacticalLinkedPlayer, event: MouseEvent) {
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
function setMeasurePoint(menu: { mapX: number; mapY: number; gameX: number; gameY: number }, reset = false) {
  activeTool.value = "measure";
  const point = {
    mapX: menu.mapX,
    mapY: menu.mapY,
    gameX: menu.gameX,
    gameY: menu.gameY
  };
  measurePoints.value = reset ? [point] : [...measurePoints.value, point];
}

function onStartMeasure(menu: any) {
  setMeasurePoint(menu, true);
  logCombatEvent(`开始测距。起点: [X:${Math.round(menu.gameX)}, Y:${Math.round(menu.gameY)}]`, "system");
}

function onAddPoint(menu: any) {
  setMeasurePoint(menu, false);
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
function onOpenPlayerProfile(player: TacticalLinkedPlayer) {
  showPlayerDetails(player);
}

function onFocusPlayer(player: TacticalLinkedPlayer) {
  focusPlayerOnMap(player);
}

async function onCopyPlayerCoords(player: TacticalLinkedPlayer) {
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

function onStartMeasureFromPlayer(player: TacticalLinkedPlayer) {
  const marker = markers.value.find((m) => getPlayerKey(m) === getPlayerKey(player));
  const pos = getPlayerPosition(player);
  if (!marker || !pos) return;

  setMeasurePoint({
    mapX: marker.mapX,
    mapY: marker.mapY,
    gameX: pos.x ?? 0,
    gameY: pos.y ?? 0
  }, true);
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
    const pos = getPlayerPosition(player) as BzssCoreTrackedVector;
    const resolvedTeamId = resolvePlayerTeamId(player);
    
    // Associate RCON detail
    const rconDetail = getPlayerRconDetail(player);

    return {
      ...player,
      mapX: project(pos.x ?? 0, bounds.minX, bounds.maxX),
      mapY: project(pos.y ?? 0, bounds.minY, bounds.maxY),
      yaw: getPlayerYaw(player),
      teamId: resolvedTeamId,
      roleInfo: resolveMapRoleInfo(player),
      rconDetail,
    } as any as MapMarker;
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
  
  const mapSize = 1000;
  const pixelX = panX.value + (mapX / 100) * mapSize * zoom.value;
  const pixelY = panY.value + (mapY / 100) * mapSize * zoom.value;
  
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
  if (isDragging.value) return;
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
const dragStartCoords = { x: 0, y: 0 };
let dragMoved = false;
let activeDragPointerId: number | null = null;

function isDragBlockedTarget(target: HTMLElement | null) {
  if (!target) return false;
  return Boolean(
    target.closest(".glass-panel") ||
    target.closest(".tactical-sidebar") ||
    target.closest(".player-tooltip") ||
    target.closest(".player-tooltip-simple") ||
    target.closest(".player-marker") ||
    target.closest(".map-floating-panel")
  );
}

function startDrag(e: PointerEvent) {
  if (e.button !== 0 || isDragging.value) return;

  const target = e.target as HTMLElement | null;
  if (isDragBlockedTarget(target)) return;

  e.preventDefault();
  activeDragPointerId = e.pointerId;
  camera.startDrag(e.clientX, e.clientY);
  dragStartCoords.x = e.clientX;
  dragStartCoords.y = e.clientY;
  dragMoved = false;
  hoveredPlayer.value = null;
  hoverCoords.value = null;

  containerRef.value?.setPointerCapture?.(e.pointerId);

  window.addEventListener("pointermove", onDrag, { passive: false });
  window.addEventListener("pointerup", stopDrag);
  window.addEventListener("pointercancel", stopDrag);
}

function onDrag(e: PointerEvent) {
  if (!isDragging.value) return;
  if (activeDragPointerId !== null && e.pointerId !== activeDragPointerId) return;

  e.preventDefault();

  const dx = Math.abs(e.clientX - dragStartCoords.x);
  const dy = Math.abs(e.clientY - dragStartCoords.y);
  if (dx > 4 || dy > 4) {
    dragMoved = true;
  }

  camera.onDrag(e.clientX, e.clientY);
}

// Re-sync final dragging state (handles cleanup if dragging ends outside viewport)
function stopDrag(e?: PointerEvent) {
  if (activeDragPointerId !== null) {
    containerRef.value?.releasePointerCapture?.(activeDragPointerId);
  }

  activeDragPointerId = null;
  camera.endDrag();

  window.removeEventListener("pointermove", onDrag);
  window.removeEventListener("pointerup", stopDrag);
  window.removeEventListener("pointercancel", stopDrag);
}

function onWheel(e: WheelEvent) {
  if (!containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  const factor = 1.15;
  let nextZoom = zoom.value;
  if (e.deltaY < 0) {
    nextZoom = Math.min(20, zoom.value * factor);
  } else {
    nextZoom = Math.max(0.35, zoom.value / factor);
  }

  camera.setZoom(nextZoom, mouseX, mouseY);
}

function zoomIn() {
  if (!containerRef.value) {
    camera.setZoom(Math.min(20, zoom.value * 1.25), 0, 0);
    return;
  }
  const rect = containerRef.value.getBoundingClientRect();
  camera.setZoom(Math.min(20, zoom.value * 1.25), rect.width / 2, rect.height / 2);
}
function zoomOut() {
  if (!containerRef.value) {
    camera.setZoom(Math.max(0.35, zoom.value / 1.25), 0, 0);
    return;
  }
  const rect = containerRef.value.getBoundingClientRect();
  camera.setZoom(Math.max(0.35, zoom.value / 1.25), rect.width / 2, rect.height / 2);
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
  const nextZoom = Math.max(0.35, Math.min(2, scale));
  zoom.value = nextZoom;
  panX.value = (viewWidth - mapSize * nextZoom) / 2;
  panY.value = (viewHeight - mapSize * nextZoom) / 2;
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
  if (!containerRef.value) return;
  const mapSize = 1000;
  const viewWidth = containerRef.value.clientWidth;
  const viewHeight = containerRef.value.clientHeight;
  const nextX = viewWidth / 2 - (mapX / 100) * mapSize * clampedZoom;
  const nextY = viewHeight / 2 - (mapY / 100) * mapSize * clampedZoom;
  zoom.value = clampedZoom;
  panX.value = nextX;
  panY.value = nextY;
}

function focusPlayerOnMap(player: TacticalLinkedPlayer) {
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
function showPlayerDetails(player: TacticalLinkedPlayer, event?: MouseEvent) {
  let detail: any;
  const rconDetail = getPlayerRconDetail(player);
  const displayName = getPlayerLabel(player);
  if (rconDetail) {
    detail = {
      ...rconDetail,
      name: String(rconDetail.name ?? displayName).trim() || displayName,
      playerName: String(rconDetail.playerName ?? rconDetail.name ?? displayName).trim() || displayName,
      raw: rconDetail.raw ?? (player as any)?.raw?.rcon ?? rconDetail.raw,
    };
    detail.bzssCorePlayerInfo = player;
    detail.bzssCoreStatus = "ready";
  } else {
    detail = {
      playerId: null,
      name: displayName,
      playerName: displayName,
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
  const playerName = String((player as any)?.identity?.name ?? player.playerName ?? (player as any)?.name ?? "").trim();
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
  const source = player as any;
  if (source?.match?.isLeader === true) return true;
  if (source?.isLeader === true) return true;
  if (source?.raw?.rcon?.isLeader === true) return true;
  if (source?.raw?.bzss?.isLeader === true) return true;

  const role = [
    source?.match?.role,
    source?.role,
    source?.soldierInfo?.soldierClass,
    source?.telemetry?.soldierClass,
  ].map((value) => String(value ?? "").toLowerCase()).join(" ");

  return role.includes("squadleader") || role.includes("officer") || /\bsl\b/.test(role);
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

  const rconDetail = getPlayerRconDetail(player);
  let roleSource = "";
  if (rconDetail?.role && rconDetail.role !== "Unknown Role") {
    roleSource = rconDetail.role;
  } else if ((player as any).role && (player as any).role !== "Unknown Role") {
    roleSource = (player as any).role;
  } else {
    roleSource = [player.soldierInfo?.soldierClass, player.soldierInfo?.weaponClass]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .join(" ");
  }

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

function lerp(from: number, to: number, alpha: number) {
  return from + (to - from) * alpha;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
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

function getPlayerSpeedText(player: TacticalLinkedPlayer) {
  const key = getPlayerKey(player);
  if (!key) return "-";
  const target = playerTargets.get(key);
  if (!target) return "--";

  const ageMs = Math.max(0, Date.now() - target.lastSeen);
  const decayAfterMs = 350;
  const decayFactor = ageMs <= decayAfterMs
    ? 1
    : Math.pow(0.9, (ageMs - decayAfterMs) / 200);
  const speedMS = Number.isFinite(target.speedMs) ? target.speedMs * decayFactor : 0;
  const speedKMH = speedMS * 3.6;
  if (speedMS < 0.05) return "0.0 m/s";
  
  return `${speedMS.toFixed(1)} m/s (${Math.round(speedKMH)} km/h)`;
}

function getLinkConfidenceLabel(confidence: TacticalLinkedPlayer["linkConfidence"]) {
  switch (confidence) {
    case "exact":
      return "精准";
    case "strong":
      return "强";
    case "weak":
      return "弱";
    default:
      return "未关联";
  }
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
  stopDrag();
  if (simulatedCombatTimer) window.clearInterval(simulatedCombatTimer);
  window.removeEventListener("resize", fitToViewport);
  window.removeEventListener("keydown", handleWindowKeyDown);
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<style scoped>
@import "../styles/tactical-map.css";
</style>
