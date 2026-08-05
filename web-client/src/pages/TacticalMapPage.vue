<template>
  <div class="tactical-map-layout">
      <!-- Main Map Viewport -->
      <div
      ref="containerRef"
      class="map-viewport"
      :class="{ 'has-explosion-shake': isShaking, 'is-dragging': isDragging, 'is-loading': isInitialMapLoading }"
      @pointerdown="startDrag"
      @wheel.prevent="onWheel"
    >
      <!-- Tech Grid Overlay Behind Map -->
      <div class="viewport-bg-grid"></div>

      <!-- The map remains usable while its first snapshot and tile layer arrive. -->
      <div v-if="isInitialMapLoading" class="tactical-map-loading" role="status" aria-live="polite">
        <div class="tactical-map-loading__map" aria-hidden="true">
          <i></i><i></i><i></i>
        </div>
        <div class="tactical-map-loading__copy">
          <strong>{{ loading ? "正在同步战场数据" : "正在准备地图图层" }}</strong>
          <span>操作控件已可用，数据到达后会自动显示。</span>
        </div>
      </div>

      <!-- Centered Transform Container -->
        <div
          ref="mapRef"
          class="map-transform-container"
          :class="{ 'is-dragging': isDragging }"
          :style="[mapTransformStyle, { cursor: measureMode ? 'crosshair' : isDragging ? 'grabbing' : 'grab' }]"
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
            :interaction-active="isDragging"
            :viewport-width="vpWidth"
            :viewport-height="vpHeight"
            :fallback-image="activeMapConfig.image"
            @ready="handleTilesReady"
          />
        </div>

        <PressureZoneOverlay
          :state="pressureZoneState"
          :map-bounds="activeMapConfig.bounds"
          :visible="pressureZoneOverlayVisible"
          :show-hard="showPressureHard"
          :show-soft="showPressureSoft"
          :show-combat="showPressureCombat"
          :show-diagnostics="showPressureDiagnostics"
          :show-connections="showPressureConnections"
          :connection-points="pressureObjectivePoints"
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



        <!-- Main Zone Overlay -->
        <div v-if="mainZoneMarkers.length" class="main-zone-layer">
          <div
            v-for="zone in mainZoneMarkers"
            :key="zone.id"
            class="main-zone-marker"
            :class="[`team-${zone.teamId ?? 0}`]"
            :style="{
              left: `${zone.mapX}%`,
              top: `${zone.mapY}%`,
              '--main-base-scale': dynamicMarkerScale,
            }"
            :title="zone.raw || zone.name"
          >
            <span class="zone-flag-group main-zone-flag">
              <span class="zone-flag-visual">
                <img
                  v-if="zone.flagUrl"
                  class="zone-flag-image"
                  :src="zone.flagUrl"
                  :alt="zone.factionLabel"
                />
                <span v-else class="zone-flag-placeholder"></span>
                <span class="zone-flag-lock" aria-label="Locked"></span>
              </span>
              <span class="zone-flag-name">{{ zone.name }}</span>
            </span>
          </div>
        </div>

        <!-- Capture Zone Overlay -->
        <div v-if="showCaptureZones" class="capture-zone-layer">
          <button
            v-for="zone in captureZoneMarkers"
            :key="zone.id"
            class="capture-zone-marker"
            type="button"
            :style="{
              left: `${zone.mapX}%`,
              top: `${zone.mapY}%`,
              '--capture-marker-scale': dynamicMarkerScale,
            }"
            :title="zone.raw || zone.name"
          >
            <span
              class="zone-flag-group capture-zone-flag"
              :class="[
                `team-${zone.captureTeamId ?? zone.teamId ?? 0}`,
                { 'is-capturing': zone.isCapturing },
              ]"
              :style="{ '--capture-progress-deg': `${zone.captureProgress * 3.6}deg` }"
            >
              <span class="zone-flag-visual">
                <img
                  v-if="zone.flagUrl"
                  class="zone-flag-image"
                  :src="zone.flagUrl"
                  :alt="zone.factionLabel"
                />
                <span v-else class="zone-flag-placeholder"></span>
                <span class="capture-flag-neutral-sweep"></span>
                <span v-if="zone.isLocked" class="zone-flag-lock" aria-label="Locked"></span>
              </span>
              <span class="zone-flag-name">{{ zone.name }}</span>
            </span>
          </button>
        </div>

        <!-- FOB Overlay -->
        <div v-if="showFobs" class="fob-layer">
          <svg class="fob-radius-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none">
            <g
              v-for="fob in fobMarkers"
              :key="`fob-radius-${fob.id}`"
              class="fob-radius-group"
              :class="`team-${fob.teamId ?? 0}`"
            >
              <circle
                :cx="fob.mapX * 10"
                :cy="fob.mapY * 10"
                :r="metersToSvgRadius(fob.exclusionRadius ?? 300)"
                class="fob-radius-circle fob-radius-exclusion"
                vector-effect="non-scaling-stroke"
              />
              <circle
                :cx="fob.mapX * 10"
                :cy="fob.mapY * 10"
                :r="metersToSvgRadius(fob.constructionRadius ?? 150)"
                class="fob-radius-circle fob-radius-construction"
                vector-effect="non-scaling-stroke"
              />
              <circle
                :cx="fob.mapX * 10"
                :cy="fob.mapY * 10"
                :r="metersToSvgRadius(fob.constructionRadius ?? 150)"
                class="fob-radius-circle fob-radius-construction-motion"
                vector-effect="non-scaling-stroke"
              />
            </g>
          </svg>

          <div
            v-for="fob in fobMarkers"
            :key="fob.id"
            class="fob-marker"
            :class="[`team-${fob.teamId ?? 0}`, { 'is-bleeding': fob.isBleeding }]"
            :style="{
              left: `${fob.mapX}%`,
              top: `${fob.mapY}%`,
              '--fob-marker-scale': dynamicMarkerScale,
            }"
            :title="fob.raw || fob.name"
          >
            <div class="fob-visual">
              <div class="fob-fortress" :style="{ color: getFobIconColor(fob) }">
                <svg class="fob-castle-icon" viewBox="0 0 32 32" aria-hidden="true">
                  <defs>
                    <linearGradient :id="`fob-bleeding-${fob.id}`" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stop-color="#fff1f2" />
                      <stop offset="42%" stop-color="#ef4444" />
                      <stop offset="100%" stop-color="#7f1d1d" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M9 29V10H12V6H15V10H17V6H20V10H23V29H19V20H13V29H9ZM6 29H26V32H6V29Z"
                    :fill="fob.isBleeding ? `url(#fob-bleeding-${fob.id})` : 'currentColor'"
                  />
                  <path d="M14 23H18V29H14Z" fill="rgba(2,6,23,.72)" />
                </svg>
                <span v-if="fob.isBleeding" class="fob-alert">!</span>
              </div>

              <div class="fob-resource-row">
                <span class="fob-resource fob-resource--ammo" :title="`弹药 ${formatFobResource(fob.ammo)}`">
                  <span class="fob-resource-icon fob-ammo-icon" aria-hidden="true"></span>
                  <strong>{{ formatFobResource(fob.ammo) }}</strong>
                </span>
                <span class="fob-resource fob-resource--construction" :title="`建材 ${formatFobResource(fob.construction)}`">
                  <span class="fob-resource-icon fob-hammer-icon" aria-hidden="true"></span>
                  <strong>{{ formatFobResource(fob.construction) }}</strong>
                </span>
              </div>

              <span class="fob-marker-name">{{ fob.name || `FOB T${fob.teamId ?? "--"}` }}</span>
              <span class="fob-anchor-dot"></span>

              <div class="fob-tooltip">
                <strong>{{ fob.name || "FOB Radio" }}</strong>
                <span>阵营：T{{ fob.teamId ?? "--" }}</span>
                <span>弹药：{{ formatFobResource(fob.ammo) }}</span>
                <span>建材：{{ formatFobResource(fob.construction) }}</span>
                <span>建造圈：150m</span>
                <span>排除圈：300m</span>
                <span v-if="fob.health != null">Radio HP：{{ Math.round(Number(fob.health) * 100) }}%</span>
                <span v-if="fob.isBleeding" class="fob-tooltip-alert">FOB 正在流血</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Player Markers Layer -->
        <div class="player-markers-layer" :style="{ pointerEvents: measureMode || isDragging ? 'none' : 'auto', outline: isDev ? '2px solid red' : 'none' }">
          <PlayerMarker
            v-for="player in displayedPlayers"
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
            :show-name="showPlayerNames"
            :show-coords="showPlayerCoords"
            :game-x="getPlayerPosition(player)?.x"
            :game-y="getPlayerPosition(player)?.y"
            :scale="dynamicMarkerScale"
            :tone="getPerspectiveTone(player.teamId)"
            @click.stop.prevent="handlePlayerSingleClick(player, $event)"
            @dblclick.stop.prevent="handlePlayerDoubleClick(player, $event)"
            @contextmenu.prevent.stop="handlePlayerRightClick(player, $event)"
            @mouseenter="hoveredPlayer = player"
            @mouseleave="hoveredPlayer = null"
          />
        </div>

        <!-- BZSS-Core Vehicle Runtime Layer -->
        <div class="vehicle-markers-layer" :style="{ pointerEvents: measureMode || isDragging ? 'none' : 'auto' }">
          <div
            v-for="vehicle in vehicleMarkers"
            :key="vehicle.id"
            class="vehicle-marker"
            :class="`team-${vehicle.teamId ?? 0}`"
            :style="{
              left: `${vehicle.mapX}%`,
              top: `${vehicle.mapY}%`,
              '--vehicle-marker-scale': dynamicMarkerScale,
              // The game yaw and the helicopter icon's forward axis differ by
              // 90 degrees. Positive CSS rotation is clockwise.
              '--vehicle-yaw': `${(vehicle.yaw ?? 0) + 90}deg`,
            }"
            :title="vehicle.tooltip"
          >
            <span class="vehicle-marker__hitbox" aria-hidden="true"></span>
            <span class="vehicle-marker__frame">
              <svg
                class="vehicle-marker__icon"
                viewBox="0 0 128 128"
                role="img"
                :aria-label="vehicle.iconLabel || '载具'"
              >
                <defs>
                  <filter :id="`vehicle-white-tint-${vehicle.id}`" color-interpolation-filters="sRGB">
                    <!-- The source icon has gray details and white fill. Tint only the white pixels. -->
                    <feColorMatrix
                      in="SourceGraphic"
                      type="matrix"
                      values="0 0 0 0 0
                              0 0 0 0 0
                              0 0 0 0 0
                              .3333 .3333 .3333 0 -.3451"
                      result="white-mask"
                    />
                    <feComponentTransfer in="white-mask" result="white-mask-threshold">
                      <feFuncA type="linear" slope="1.527" intercept="0" />
                    </feComponentTransfer>
                    <feFlood :flood-color="getVehicleIconColor(vehicle)" flood-opacity="1" result="team-color" />
                    <feComposite in="team-color" in2="white-mask-threshold" operator="in" result="tinted-white" />
                    <feComposite in="tinted-white" in2="SourceGraphic" operator="over" />
                  </filter>
                </defs>
                <image
                  x="0"
                  y="0"
                  width="128"
                  height="128"
                  preserveAspectRatio="none"
                  :href="vehicle.iconPath || '/assets/icons/T_map_helicopter_scout.PNG'"
                  :filter="`url(#vehicle-white-tint-${vehicle.id})`"
                />
              </svg>
            </span>
            <div class="vehicle-marker__tooltip" role="tooltip">
              <div v-if="vehicle.occupants.length" class="vehicle-marker__occupants">
                <div
                  v-for="occupant in vehicle.occupants"
                  :key="`${vehicle.id}:occupant:${occupant.playerId}`"
                  class="vehicle-marker__occupant"
                  :class="`team-${occupant.teamId ?? vehicle.teamId ?? 0}`"
                >
                  <span class="vehicle-marker__occupant-role">{{ occupant.role }}</span>
                  <span class="vehicle-marker__occupant-name">{{ occupant.playerName }}</span>
                </div>
              </div>
              <div v-else class="vehicle-marker__empty">无玩家</div>
            </div>
          </div>
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
                v-for="p in visibleExplosionParticles"
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

      <div class="map-debug-hud">
        players={{ players.length }}
        cached={{ positionedPlayers.length }}
        markers={{ markers.length }}
        filtered={{ filteredPlayers.length }}
        zones={{ captureZoneMarkers.length }}
        fobs={{ fobMarkers.length }}
        zoom={{ camera.zoom.value.toFixed(2) }}
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

      <header class="tactical-command-bar">
        <div class="tactical-command-bar__identity">
          <span class="tactical-command-bar__eyebrow">TACTICAL OPERATIONS</span>
          <strong>{{ serverMapName || detectedMapName || "正在识别地图" }}</strong>
          <span>{{ matchPhase || statusText || "实时战场态势" }} · 地图 {{ activeMapSizeText }}</span>
        </div>
        <div class="tactical-command-bar__tickets" aria-label="双方票数">
          <span class="tactical-ticket tactical-ticket--team1" :style="getPerspectiveStyle(1)"><b>TEAM 1</b><strong>{{ tickets.team1 }}</strong></span>
          <span class="tactical-ticket__vs">VS</span>
          <span class="tactical-ticket tactical-ticket--team2" :style="getPerspectiveStyle(2)"><b>TEAM 2</b><strong>{{ tickets.team2 }}</strong></span>
        </div>
        <div class="tactical-command-bar__status">
          <span class="tactical-live-status"><i></i>{{ tacticalMapViewerCount === null ? "同步查看状态" : `${tacticalMapViewerCount} 人查看` }}</span>
          <span class="tactical-recording-status" :class="{ 'is-recording': tacticalRecording.recording, 'is-disabled': !tacticalRecording.recordingEnabled }"><i></i>{{ tacticalRecordingLabel }}</span>
          <button
            type="button"
            class="tactical-recording-action"
            :disabled="tacticalRecording.pending || tacticalRecording.known === false"
            :title="tacticalRecording.recordingEnabled ? '停止本局战术回放录制' : '开始本局战术回放录制'"
            @click="toggleTacticalRecording"
          >{{ tacticalRecording.pending ? "处理中…" : tacticalRecording.recordingEnabled ? "停止录制" : "开始录制" }}</button>
        </div>
      </header>

      <section class="map-control-dock" aria-label="地图操作">
        <div class="map-control-dock__nav">
        <button class="ctrl-btn" title="放大" @click="zoomIn">
          <span class="icon-span">+</span>
        </button>
        <button class="ctrl-btn" title="缩小" @click="zoomOut">
          <span class="icon-span">-</span>
        </button>
        <button class="ctrl-btn" title="适配视口 (F)" @click="resetView">
          <span class="icon-span">↺</span>
        </button>
        </div>
        <div class="map-control-dock__menu-row">
          <button class="ctrl-btn text-btn" :class="{ active: activeMapControlPanel === 'layers' }" @click="toggleMapControlPanel('layers')" :aria-expanded="activeMapControlPanel === 'layers'">图层</button>
          <button class="ctrl-btn text-btn" :class="{ active: activeMapControlPanel === 'tools' || measureMode || combatHotspot != null }" @click="toggleMapControlPanel('tools')" :aria-expanded="activeMapControlPanel === 'tools'">工具</button>
          <button class="ctrl-btn text-btn" :class="{ active: activeMapControlPanel === 'help' }" @click="toggleMapControlPanel('help')" :aria-expanded="activeMapControlPanel === 'help'">帮助</button>
        </div>
        <div v-if="activeMapControlPanel === 'layers'" class="map-control-popover">
        <button
          class="ctrl-btn text-btn"
          :class="{ active: showGrid }"
          @click="showGrid = !showGrid"
          :aria-pressed="showGrid"
          title="网格开关 (G)"
        >
          网格
        </button>
        <button
          class="ctrl-btn text-btn"
          :class="{ active: showCaptureZones }"
          @click="showCaptureZones = !showCaptureZones"
          :aria-pressed="showCaptureZones"
          title="地标区域图层"
        >
          地标
        </button>
        <button
          class="ctrl-btn text-btn"
          :class="{ active: showFobs }"
          @click="showFobs = !showFobs"
          :aria-pressed="showFobs"
          title="FOB图层"
        >
          FOB
        </button>
        <button
          class="ctrl-btn text-btn"
          :class="{ active: showPlayerNames }"
          @click="showPlayerNames = !showPlayerNames"
          :aria-pressed="showPlayerNames"
          title="玩家姓名图层"
        >
          姓名
        </button>
        <button
          class="ctrl-btn text-btn"
          :class="{ active: showPlayerCoords }"
          @click="showPlayerCoords = !showPlayerCoords"
          :aria-pressed="showPlayerCoords"
          title="玩家坐标图层"
        >
          坐标
        </button>
        <button
          class="ctrl-btn text-btn"
          :class="{ active: filterAliveOnly }"
          @click="filterAliveOnly = !filterAliveOnly"
          :aria-pressed="filterAliveOnly"
          title="只显示存活玩家"
        >
          存活
        </button>
        </div>
        <div v-if="activeMapControlPanel === 'tools'" class="map-control-popover">
        <button
          class="ctrl-btn text-btn measure-btn"
          :class="{ active: measureMode }"
          @click="toggleMeasureMode"
          :aria-pressed="measureMode"
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
        </div>
        <div v-if="activeMapControlPanel === 'help'" class="map-control-popover map-control-popover--help">
          <span><kbd>右键</kbd> 指令</span><span><kbd>双击</kbd> 资料</span><span><kbd>滚轮</kbd> 缩放</span><span><kbd>拖拽</kbd> 移动</span><span><kbd>M</kbd> 测距</span><span><kbd>G</kbd> 网格</span><span><kbd>F</kbd> 复位</span>
        </div>
      </section>

      <div class="map-coordinate-readout font-mono" aria-live="polite">
        <span>坐标</span><b>X {{ hoverCoords ? Math.round(hoverCoords.gameX) : '-' }}</b><b>Y {{ hoverCoords ? Math.round(hoverCoords.gameY) : '-' }}</b>
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
      :show-pressure-zones="showPressureZones"
      :show-pressure-hard="showPressureHard"
      :show-pressure-soft="showPressureSoft"
      :show-pressure-combat="showPressureCombat"
      :show-pressure-diagnostics="showPressureDiagnostics"
      :show-pressure-connections="showPressureConnections"
      :measure-mode="measureMode"
      :selected-map-key="selectedMapKey"
      :marker-scale="markerScale"
      :viewer-perspective-mode="viewerPerspectiveMode"
      :detected-map-name="detectedMapName"
      :map-size-text="activeMapSizeText"
      :can-manage-pressure-settings="canManagePressureSettings"
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
      :main-zone-markers="mainZoneMarkers"
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
      @update:show-pressure-zones="showPressureZones = $event"
      @update:show-pressure-hard="showPressureHard = $event"
      @update:show-pressure-soft="showPressureSoft = $event"
      @update:show-pressure-combat="showPressureCombat = $event"
      @update:show-pressure-diagnostics="showPressureDiagnostics = $event"
      @update:show-pressure-connections="showPressureConnections = $event"
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
      @open-pressure-settings="pressureSettingsOpen = true"
    />

    <div v-if="pressureSettingsOpen" class="pressure-settings-modal" role="dialog" aria-modal="true" aria-label="压家圈基础参数">
      <div
        ref="pressureModalPanelRef"
        class="pressure-settings-modal__panel"
        :style="{
          left: modalPos ? `${modalPos.x}px` : undefined,
          top: modalPos ? `${modalPos.y}px` : undefined,
          right: modalPos ? 'auto' : undefined
        }"
      >
        <div class="modal-drag-header" @mousedown="startModalDrag">
          <div class="drag-title-block">
            <span class="drag-grip-dots">:::</span>
            <span class="drag-title font-mono">⚙ 压家圈基础参数设置</span>
            <span class="drag-tip">(按住此处自由拖拽窗口)</span>
          </div>
          <div class="modal-header-actions">
            <button v-if="modalPos" type="button" class="modal-reset-pos-btn" title="重置窗口位置" @click="resetModalPos">↺ 重置位置</button>
            <button type="button" class="modal-close-icon" title="关闭窗口" @click="pressureSettingsOpen = false">✕</button>
          </div>
        </div>
        <div class="modal-body-scroll custom-scrollbar">
          <PressureZoneSettingsPage
            embedded
            :current-map-size-meters="activeMapDimensionsMeters.longest"
            @close="pressureSettingsOpen = false"
            @saved="handlePressureSettingsSaved"
          />
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, nextTick, shallowRef, triggerRef, watch } from "vue";
import { useRoute } from "vue-router";
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
  getStaticTacticalAssets,
  resolveTacticalMapKey,
  type TacticalMapConfig,
} from "../shared/tactical-map-data";
import TiledMapRenderer from "../components/tactical-map/TiledMapRenderer.vue";
import PressureZoneOverlay from "../components/tactical-map/PressureZoneOverlay.vue";
import PlayerMarker from "../components/tactical-map/PlayerMarker.vue";
import TacticalMapSidebar from "../components/tactical-map/TacticalMapSidebar.vue";
import PressureZoneSettingsPage from "./PressureZoneSettingsPage.vue";
import MapContextMenu from "../components/tactical-map/MapContextMenu.vue";
import PlayerInfoPanel from "../components/tactical-map/PlayerInfoPanel.vue";
import PlayerActionMenu from "../components/tactical-map/PlayerActionMenu.vue";
import { useMapCamera } from "../composables/useMapCamera";
import { provideTacticalMapViewport } from "../composables/tacticalMapViewport";
import { useTacticalStateStore } from "../stores/tactical-state.store";
import type { BzssCoreMainZoneInfo } from "../app/bzssCoreApi";
import { getChineseNameByFaction, getFactionFromTeamName, 获取战斗群旗帜 } from "../shared/faction-assets/faction-data";
import { apiDelete, apiGet, apiPost } from "../app/apiClient";
import { fetchDynamicPressureZoneState, type PressureZoneState } from "../app/dynamicPressureZoneApi";

const props = withDefaults(defineProps<{
  snapshot: BzssCorePlayerInfoResponse | null;
  players: TacticalLinkedPlayer[];
  captureZones?: BzssCoreCaptureZoneInfo[];
  fobs?: BzssCoreFobInfo[];
  mainZones?: BzssCoreMainZoneInfo[];
  loading: boolean;
  errorText: string;
  playtimes?: Record<string, any> | null;
  combatStatsLookup?: Record<string, any> | null;
}>(), {
  snapshot: null,
  players: () => [],
  captureZones: () => [],
  fobs: () => [],
  mainZones: () => [],
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
  type: "captureZone";
  id: string;
  name: string;
  teamId: number | null;
  mapX: number;
  mapY: number;
  gameX: number | null;
  gameY: number | null;
  capturePercent?: number | null;
  captureProgress: number;
  captureDirection?: number | null;
  captureTeamId?: number | null;
  isCapturing: boolean;
  isLocked?: boolean | null;
  factionCode: string | null;
  factionLabel: string;
  flagUrl: string | null;
  raw?: string;
}

interface MainZoneMarker {
  type: "mainZone";
  id: string;
  name: string;
  teamId: number | null;
  factionCode: string | null;
  factionLabel: string;
  flagUrl: string | null;
  mapX: number;
  mapY: number;
  gameX: number | null;
  gameY: number | null;
  raw?: string;
}

interface FobMarker {
  type: "fob";
  id: string;
  name: string;
  teamId: number | null;
  health?: number | null;
  isBleeding?: boolean | null;
  ammo?: number | null;
  construction?: number | null;
  mapX: number;
  mapY: number;
  gameX: number | null;
  gameY: number | null;
  exclusionRadius: number | null;
  constructionRadius: number | null;
  radiusPx: number;
  raw?: string;
}

interface VehicleOccupant {
  playerId: number;
  playerName: string;
  role: string;
  teamId: number | null;
}

interface VehicleMarker {
  id: string;
  teamId: number | null;
  vehicleType: string;
  mapX: number;
  mapY: number;
  yaw: number | null;
  occupied: boolean;
  healthText: string;
  speedText: string;
  occupants: VehicleOccupant[];
  iconPath: string | null;
  iconLabel: string;
  tooltip: string;
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
const route = useRoute();
const tacticalStateStore = useTacticalStateStore();
const isStandaloneMapRoute = computed(() => route.path === "/tactical-map" || route.name === "tactical-map");

const storeSnapshot = computed(() => tacticalStateStore.snapshot ?? null);
const storeCaptureZones = computed(() => Array.isArray(tacticalStateStore.assets?.captureZones) ? tacticalStateStore.assets.captureZones : []);
const storeFobs = computed(() => Array.isArray(tacticalStateStore.assets?.fobs) ? tacticalStateStore.assets.fobs : []);
const storeMainZones = computed(() => Array.isArray(tacticalStateStore.assets?.mainZones) ? tacticalStateStore.assets.mainZones : []);
const storeVehicles = computed(() => Array.isArray(tacticalStateStore.assets?.vehicles) ? tacticalStateStore.assets.vehicles : []);

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

function adaptTacticalStatePlayersForMapUncached(playersList: any[] = [], combatLookup: Record<string, any> = {}) {
  return (Array.isArray(playersList) ? playersList : []).map((player) => {
    const steamId = player?.identity?.steamID ?? null;
    const eosId = player?.identity?.eosID ?? null;
    const rawRcon = player?.raw?.rcon ?? null;
    const presenceState = String(player?.presence?.state ?? "");
    const presenceHint = String(player?.telemetry?.presenceHint ?? "");
    const isNoPawn = presenceHint === "noPawn" || presenceState === "noPawn";
    const isInactive = (
      player?.telemetry?.inactive === true
      || player?.inactive === true
      || player?.presence?.inactive === true
      || rawRcon?.inactive === true
      || rawRcon?.isInactive === true
      || player?.telemetry?.active === false
      || player?.active === false
      || rawRcon?.active === false
      || String(player?.telemetry?.inactive ?? "").trim().toLowerCase() === "inactive"
      || String(player?.inactive ?? "").trim().toLowerCase() === "inactive"
      || String(rawRcon?.inactive ?? "").trim().toLowerCase() === "inactive"
      || presenceState === "inactive"
    );
    const rconDetail = rawRcon
      ? adaptPlayerDetail(rawRcon, player?.profile?.playtimeHours ?? null, combatLookup)
      : null;
    const sourcePosition = player?.telemetry?.position ?? player?.position ?? null;
    const vehicleState = String(
      player?.telemetry?.vehicleState
      ?? player?.vehicle?.vehicleState
      ?? "",
    ).trim().toLowerCase();
    const vehicleSeatIndex = Number(
      player?.telemetry?.vehicleSeatIndex
      ?? player?.vehicle?.vehicleSeatIndex,
    );
    // Runtime uses -1 for walking and non-negative values for vehicle seats.
    // Keep legacy players visible when no vehicle signal exists.
    const vehiclePresence = resolvePlayerVehiclePresence(player);
    const isWalking = vehiclePresence !== "vehicle";
    const position = isInactive || isNoPawn || !isWalking ? null : sourcePosition;
    const yaw = isInactive || isNoPawn || !isWalking ? null : (player?.telemetry?.yaw ?? player?.yaw ?? null);
    const rotation = player?.telemetry?.rotation ?? player?.soldierInfo?.rotation ?? null;

    return {
      key: player?.identity?.key ?? "",
      playerId: player?.identity?.playerID ?? null,
      playerIndex: player?.identity?.playerID ?? null,
      playerName: player?.identity?.name ?? rawRcon?.name ?? "Unknown",
      playerGuid: steamId || eosId || "",
      steamId: steamId || null,
      eosId: eosId || null,
      teamId: player?.match?.teamId ?? null,
      squadId: player?.match?.squadId ?? null,
      isLeader: Boolean(player?.match?.isLeader),
      role: player?.match?.role ?? "",
      health: player?.telemetry?.health ?? null,
      ping: player?.network?.gamePing ?? null,
      ftIndex: player?.telemetry?.fireTeamIndex ?? null,
      ftPosition: player?.telemetry?.fireTeamPosition ?? null,
      position,
      yaw,
      presenceHint: isNoPawn ? "noPawn" : presenceHint,
      inactive: isInactive,
      presence: {
        ...(player?.presence ?? {}),
        state: isInactive ? "inactive" : (isNoPawn ? "noPawn" : presenceState),
      },
      hasTelemetry: Boolean(player?.telemetry?.hasTelemetry),
      hasPosition: Boolean(position),
      playerBaseInfo: {
        raw: "",
        fields: [],
        values: {},
      },
      soldierInfo: {
        raw: "",
        fields: [],
        values: {},
        soldierClass: player?.telemetry?.soldierClass ?? "",
        health: player?.telemetry?.health ?? null,
        weaponClass: player?.telemetry?.weaponClass ?? "",
        ammoValues: [],
        position,
        rotation,
      },
      vehicleInfo: {
        raw: player?.vehicle?.raw ?? "",
        vehicleType: player?.vehicle?.vehicleType ?? "",
        healthText: "",
        health: player?.vehicle?.health ?? null,
        maxHealth: player?.vehicle?.maxHealth ?? null,
        vehicleState,
        vehicleSeatIndex: Number.isNaN(vehicleSeatIndex) ? null : vehicleSeatIndex,
        onVehicle: !isWalking,
        position,
        rotation,
      },
      playerScoreboard: {
        raw: "",
        values: [],
        numericValues: [],
        ping: player?.network?.gamePing ?? null,
        stats: {
          dataLives: null,
          numKills: player?.combat?.kills ?? null,
          numDeaths: player?.combat?.deaths ?? null,
          numWoundeds: player?.combat?.woundeds ?? null,
          numWounds: player?.combat?.wounds ?? null,
          numTeamKills: player?.combat?.teamKills ?? null,
          healPoints: player?.combat?.healPoints ?? null,
          revivedPoints: player?.combat?.revives ?? null,
          teamworkScore: player?.combat?.teamworkScore ?? null,
          objectiveScore: player?.combat?.objectiveScore ?? null,
          combatScore: player?.combat?.combatScore ?? null,
        },
      },
      observedAt: player?.freshness?.bzssCoreUpdatedAt ?? player?.freshness?.generatedAt ?? "",
      stale: !player?.freshness?.bzssCoreUpdatedAt,
      rawText: "",
      runtime: rawRcon,
      raw: player?.raw ?? {},
      profile: player?.profile ?? {},
      rconDetail,
      linkConfidence: player?.link?.confidence ?? "none",
      linkReason: player?.link?.method ?? "unlinked",
      bzss: player,
    };
  });
}

const EMPTY_COMBAT_LOOKUP: Record<string, any> = Object.freeze({});
const adaptedPlayerCache = new Map<string, {
  source: object;
  combatLookup: Record<string, any>;
  adapted: TacticalLinkedPlayer;
}>();

function adaptTacticalStatePlayersForMap(playersList: any[] = [], combatLookup: Record<string, any> = {}) {
  const activeKeys = new Set<string>();
  const adaptedPlayers: TacticalLinkedPlayer[] = [];

  for (const player of Array.isArray(playersList) ? playersList : []) {
    const key = String(
      player?.identity?.key
      ?? player?.identity?.steamID
      ?? player?.identity?.eosID
      ?? player?.identity?.playerID
      ?? player?.identity?.name
      ?? "",
    );
    if (!key) continue;

    activeKeys.add(key);
    const cached = adaptedPlayerCache.get(key);
    if (cached && cached.source === player && cached.combatLookup === combatLookup) {
      adaptedPlayers.push(cached.adapted);
      continue;
    }

    const adapted = adaptTacticalStatePlayersForMapUncached([player], combatLookup)[0] as TacticalLinkedPlayer | undefined;
    if (!adapted) continue;
    adaptedPlayerCache.set(key, { source: player, combatLookup, adapted });
    adaptedPlayers.push(adapted);
  }

  for (const key of adaptedPlayerCache.keys()) {
    if (!activeKeys.has(key)) adaptedPlayerCache.delete(key);
  }

  return adaptedPlayers;
}

const storePlayers = computed(() => adaptTacticalStatePlayersForMap(
  Array.isArray(tacticalStateStore.players) ? tacticalStateStore.players : [],
  props.combatStatsLookup ?? EMPTY_COMBAT_LOOKUP,
));

function getPlayerRconDetail(player: any) {
  try {
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
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[TacticalMap] failed to adapt player detail", error, player);
    }
    return null;
  }
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
const canManagePressureSettings = computed(() => Boolean(
  authStore.user?.isSuperAdmin || authStore.user?.permissions?.includes("settings.manage"),
));

const snapshot = computed(() => {
  if (props.snapshot) return props.snapshot;
  if (isStandaloneMapRoute.value) return storeSnapshot.value;
  return null;
});
const snapshotExplosions = computed(() => {
  const direct = Array.isArray((snapshot.value as any)?.explosions) ? (snapshot.value as any).explosions : [];
  if (direct.length > 0) return direct;
  const assetsExplosions = Array.isArray((snapshot.value as any)?.assets?.explosions) ? (snapshot.value as any).assets.explosions : [];
  if (assetsExplosions.length > 0) return assetsExplosions;
  return Array.isArray(tacticalStateStore.assets?.explosions) ? tacticalStateStore.assets.explosions : [];
});
const players = computed(() => {
  const propPlayers = Array.isArray(props.players) ? props.players : [];
  if (propPlayers.length > 0 || !isStandaloneMapRoute.value) return propPlayers;
  return storePlayers.value;
});
const captureZones = computed(() => {
  const propZones = Array.isArray(props.captureZones) ? props.captureZones : [];
  if (propZones.length > 0 || !isStandaloneMapRoute.value) return propZones;
  return storeCaptureZones.value;
});
const fobs = computed(() => {
  const propFobs = Array.isArray(props.fobs) ? props.fobs : [];
  if (propFobs.length > 0 || !isStandaloneMapRoute.value) return propFobs;
  return storeFobs.value;
});
const mainZones = computed(() => {
  const propZones = Array.isArray(props.mainZones) ? props.mainZones : [];
  if (propZones.length > 0 || !isStandaloneMapRoute.value) return propZones;
  return storeMainZones.value;
});
const runtimeVehicles = computed(() => {
  const direct = Array.isArray((snapshot.value as any)?.vehicles) ? (snapshot.value as any).vehicles : [];
  if (direct.length > 0) return direct;
  const assetsVehicles = Array.isArray((snapshot.value as any)?.assets?.vehicles) ? (snapshot.value as any).assets.vehicles : [];
  if (assetsVehicles.length > 0) return assetsVehicles;
  return storeVehicles.value;
});

function normalizeRuntimePlayerId(value: unknown): string | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? String(Math.trunc(numeric)) : null;
}

function getRuntimePlayerId(player: any): string | null {
  return normalizeRuntimePlayerId(
    player?.playerIndex
    ?? player?.playerId
    ?? player?.identity?.playerID
    ?? player?.bzss?.identity?.playerID
    ?? player?.raw?.bzss?.identity?.playerID,
  );
}

const vehicleOccupantPlayerIds = computed(() => {
  const ids = new Set<string>();
  for (const vehicle of runtimeVehicles.value) {
    // An occupantPlayerIds array is authoritative even when empty. Falling back
    // on an empty array resurrects the stale driver ID after everybody exits.
    const candidates = Array.isArray(vehicle?.occupantPlayerIds)
      ? vehicle.occupantPlayerIds
      : [
          vehicle?.driverPlayerId,
          ...(Array.isArray(vehicle?.seatPlayerIds) ? vehicle.seatPlayerIds : []),
        ];
    for (const candidate of candidates) {
      const id = normalizeRuntimePlayerId(candidate);
      if (id != null) ids.add(id);
    }
  }
  return ids;
});

function resolvePlayerVehiclePresence(player: any): "walking" | "vehicle" | "unknown" {
  const rawVehicleState = (
    player?.vehicleInfo?.vehicleState
    ?? player?.telemetry?.vehicleState
    ?? player?.vehicle?.vehicleState
    ?? player?.bzss?.telemetry?.vehicleState
    ?? player?.bzss?.vehicle?.vehicleState
  );
  if (rawVehicleState !== null && rawVehicleState !== undefined && String(rawVehicleState).trim() !== "") {
    const state = String(rawVehicleState).trim().toLowerCase();
    if (["walking", "onfoot", "on_foot", "foot", "-1", "false"].includes(state)) return "walking";
    const numericState = Number(state);
    if (Number.isFinite(numericState)) return numericState >= 0 ? "vehicle" : "walking";
    return "vehicle";
  }

  const rawSeatIndex = (
    player?.vehicleInfo?.vehicleSeatIndex
    ?? player?.telemetry?.vehicleSeatIndex
    ?? player?.vehicle?.vehicleSeatIndex
    ?? player?.bzss?.telemetry?.vehicleSeatIndex
    ?? player?.bzss?.vehicle?.vehicleSeatIndex
  );
  if (rawSeatIndex !== null && rawSeatIndex !== undefined && String(rawSeatIndex).trim() !== "") {
    const seatIndex = Number(rawSeatIndex);
    if (Number.isFinite(seatIndex)) return seatIndex >= 0 ? "vehicle" : "walking";
  }

  const rawOnVehicle = (
    player?.vehicleInfo?.onVehicle
    ?? player?.telemetry?.onVehicle
    ?? player?.vehicle?.onVehicle
    ?? player?.bzss?.telemetry?.onVehicle
    ?? player?.bzss?.vehicle?.onVehicle
  );
  if (rawOnVehicle === true || rawOnVehicle === 1 || String(rawOnVehicle).trim().toLowerCase() === "true") return "vehicle";
  if (rawOnVehicle === false || rawOnVehicle === 0 || String(rawOnVehicle).trim().toLowerCase() === "false") return "walking";
  return "unknown";
}


function shouldSuppressPlayerMarker(player: any): boolean {
  const presenceState = String(player?.presence?.state ?? player?.bzss?.presence?.state ?? "").trim().toLowerCase();
  const presenceHint = String(
    player?.presenceHint
    ?? player?.telemetry?.presenceHint
    ?? player?.bzss?.telemetry?.presenceHint
    ?? "",
  ).trim().toLowerCase();
  const inactive = (
    player?.inactive === true
    || player?.presence?.inactive === true
    || player?.telemetry?.inactive === true
    || player?.bzss?.inactive === true
    || player?.bzss?.telemetry?.inactive === true
    || presenceState === "inactive"
  );
  const playerId = getRuntimePlayerId(player);
  const vehiclePresence = resolvePlayerVehiclePresence(player);
  return inactive
    || presenceState === "nopawn"
    || presenceHint === "nopawn"
    || vehiclePresence === "vehicle"
    // The vehicle stream can arrive one snapshot later than player telemetry.
    // Explicit walking state is authoritative so a player reappears immediately
    // after leaving a seat instead of being suppressed by stale occupant data.
    || (vehiclePresence === "unknown" && playerId != null && vehicleOccupantPlayerIds.value.has(playerId));
}
const emptyMapConfig: TacticalMapConfig = {
  key: "",
  name: "Unknown",
  image: "",
  tileBasePath: "",
  maxZoomLevel: 1,
  bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
  aliases: [],
};

const serverMapName = computed(() => {
  const serverMap = String(serverStore.snapshot?.mapName ?? "").trim();
  if (serverMap) return serverMap;
  if (isStandaloneMapRoute.value) {
    const serverLayer = String(tacticalStateStore.server?.layer ?? tacticalStateStore.snapshot?.match?.layer ?? "").trim();
    if (serverLayer) return serverLayer;
    return String(tacticalStateStore.server?.map ?? tacticalStateStore.snapshot?.match?.map ?? "").trim();
  }
  return "";
});

const selectedMapKey = ref("auto");
const detectedMapKey = computed(() => resolveTacticalMapKey(serverMapName.value) ?? getDefaultTacticalMapKey() ?? "");
const detectedMapName = computed(() => TACTICAL_MAP_CONFIGS[detectedMapKey.value]?.name ?? "Unknown");

const activeMapConfig = computed<TacticalMapConfig>(() => {
  let key = selectedMapKey.value;
  if (key === "auto") {
    key = detectedMapKey.value;
  }
  const fallbackKey = getDefaultTacticalMapKey() ?? TACTICAL_MAP_LIST[0]?.key ?? "";
  return TACTICAL_MAP_CONFIGS[key] || TACTICAL_MAP_CONFIGS[fallbackKey] || TACTICAL_MAP_LIST[0] || emptyMapConfig;
});

const pressureSettingsOpen = ref(false);
const pressureZoneState = shallowRef<PressureZoneState | null>(null);
const mapOptions = computed<TacticalMapConfig[]>(() => TACTICAL_MAP_LIST);
const staticAssets = computed(() => getStaticTacticalAssets(activeMapConfig.value.key));
const activeMapDimensionsMeters = computed(() => {
  const stateMap = pressureZoneState.value?.map;
  const stateMapKey = String(pressureZoneState.value?.mapKey ?? "").trim();
  if ((!stateMapKey || stateMapKey === activeMapConfig.value.key) && Number(stateMap?.widthMeters) > 0 && Number(stateMap?.heightMeters) > 0) {
    const width = Number(stateMap?.widthMeters);
    const height = Number(stateMap?.heightMeters);
    return { width, height, longest: Math.max(width, height) };
  }
  const bounds = activeMapConfig.value.bounds;
  const rawWidth = Math.max(0, Number(bounds.maxX) - Number(bounds.minX));
  const rawHeight = Math.max(0, Number(bounds.maxY) - Number(bounds.minY));
  const scale = Math.hypot(rawWidth, rawHeight) > 20_000 ? 0.01 : 1;
  const width = rawWidth * scale;
  const height = rawHeight * scale;
  return { width, height, longest: Math.max(width, height) };
});
const activeMapSizeText = computed(() => {
  const { width, height } = activeMapDimensionsMeters.value;
  if (!(width > 1) || !(height > 1) || !activeMapConfig.value.key || (!activeMapConfig.value.image && !activeMapConfig.value.tileBasePath)) return "等待识别";
  return `${Math.round(width).toLocaleString()} × ${Math.round(height).toLocaleString()} m`;
});

const lastKnownZonePositions = ref(new Map<string, { x: number; y: number }>());
const lastKnownFobPositions = ref(new Map<string, { x: number; y: number }>());

// Cache to prevent players disappearing when data is missing temporarily
const cachedPlayers = shallowRef(new Map<string, { player: TacticalLinkedPlayer; lastSeen: number }>());
const positionedPlayers = computed<TacticalLinkedPlayer[]>(() => {
  return [...cachedPlayers.value.values()]
    .map((entry) => entry.player)
    .filter((player) => !shouldSuppressPlayerMarker(player));
});

const hoveredPlayer = ref<TacticalLinkedPlayer | null>(null);
const errorText = computed(() => {
  if (props.errorText) return props.errorText;
  if (isStandaloneMapRoute.value) return tacticalStateStore.error;
  return "";
});
const loading = computed(() => {
  if (isStandaloneMapRoute.value) return tacticalStateStore.loading;
  return props.loading;
});
// Do not wait for every marker before making the page interactive.  The light
// loading layer only covers the empty first paint and never intercepts input.
const isInitialMapLoading = computed(() => loading.value || (!tilesReady.value && !snapshot.value));
let simulatedCombatTimer: number | null = null;

// Viewport Zoom & Pan state
const containerRef = ref<HTMLElement | null>(null);
const mapRef = ref<HTMLElement | null>(null);
const consoleRef = ref<HTMLElement | null>(null);

const camera = useMapCamera();
const isDragging = camera.isDragging;
const isDev = import.meta.env.DEV;
const mapTransformStyle = computed(() => camera.getTransform());

provideTacticalMapViewport({ zoom: camera.zoom, panX: camera.x, panY: camera.y });

const showGrid = ref(true);
const showCaptureZones = ref(true);
const showFobs = ref(true);
const showPressureZones = ref(true);
const showPressureHard = ref(true);
const showPressureSoft = ref(true);
const showPressureCombat = ref(true);
const showPressureDiagnostics = ref(false);
const showPressureConnections = ref(false);
let pressureZoneFetchTimer: number | null = null;
let pressureZoneRequestSequence = 0;
const filterAliveOnly = ref(false);
const activeMapControlPanel = ref<"layers" | "tools" | "help" | null>(null);

function toggleMapControlPanel(panel: "layers" | "tools" | "help") {
  activeMapControlPanel.value = activeMapControlPanel.value === panel ? null : panel;
}

// Icon scaling and tags visibility refs
const markerScale = ref(1.15);
const showPlayerNames = ref(true);
const showPlayerCoords = ref(false);

// Viewport dimension tracking for tile loader
const vpWidth = ref(0);
const vpHeight = ref(0);
const tilesEnabled = ref(true);
let resizeObserver: ResizeObserver | null = null;
let fitViewportTimeout: number | null = null;
let mapPageActive = false;
const tilesReady = ref(false);
const pressureObjectivePoints = computed(() => (Array.isArray(captureZones.value) ? captureZones.value : [])
  .map((zone: any) => ({ x: Number(zone?.x ?? zone?.position?.x), y: Number(zone?.y ?? zone?.position?.y) }))
  .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
const pressureZoneOverlayVisible = computed(() => {
  const stateMapKey = String(pressureZoneState.value?.mapKey ?? "").trim();
  return showPressureZones.value && (!stateMapKey || stateMapKey === activeMapConfig.value.key);
});
const pressureZoneInputSignature = computed(() => JSON.stringify({
  layer: (snapshot.value as any)?.server?.layer ?? (snapshot.value as any)?.match?.layer ?? "",
  mode: (snapshot.value as any)?.server?.mode ?? (snapshot.value as any)?.match?.mode ?? "",
  captureZones: (Array.isArray(captureZones.value) ? captureZones.value : []).map((zone: any) => [
    zone?.id ?? zone?.name ?? "",
    zone?.ownerTeamId ?? zone?.teamId ?? zone?.captureDirection ?? null,
    zone?.position?.x ?? zone?.x ?? null,
    zone?.position?.y ?? zone?.y ?? null,
  ]),
  mainZones: (Array.isArray(mainZones.value) ? mainZones.value : []).map((zone: any) => [
    zone?.teamId ?? zone?.teamID ?? null,
    zone?.position?.x ?? zone?.x ?? null,
    zone?.position?.y ?? zone?.y ?? null,
  ]),
}));

function schedulePressureZoneFetch(delayMs = 120) {
  if (!mapPageActive) return;
  if (pressureZoneFetchTimer != null) window.clearTimeout(pressureZoneFetchTimer);
  pressureZoneFetchTimer = window.setTimeout(() => {
    pressureZoneFetchTimer = null;
    void refreshPressureZoneState();
  }, delayMs);
}

async function refreshPressureZoneState() {
  const requestId = ++pressureZoneRequestSequence;
  try {
    const response = await fetchDynamicPressureZoneState();
    if (requestId === pressureZoneRequestSequence && mapPageActive) pressureZoneState.value = response.state;
  } catch (error) {
    if (import.meta.env.DEV) console.warn("[TacticalMap] pressure zone state unavailable", error);
  }
}

function handlePressureSettingsSaved() {
  schedulePressureZoneFetch(0);
}

watch(pressureZoneInputSignature, () => schedulePressureZoneFetch(), { flush: "post" });
const tacticalMapViewerCount = ref<number | null>(null);
const tacticalRecording = ref({ known: false, recordingEnabled: false, recording: false, pending: false });
const tacticalRecordingLabel = computed(() => {
  if (!tacticalRecording.value.known) return "回放录制状态未知";
  if (tacticalRecording.value.recording) return "正在录制战术回放";
  return tacticalRecording.value.recordingEnabled ? "等待对局开始录制" : "战术回放录制已停止";
});
const TACTICAL_MAP_VIEWER_HEARTBEAT_MS = 15 * 1000;
let tacticalMapViewerHeartbeat: number | null = null;
let tacticalMapViewerPresenceGeneration = 0;
const tacticalMapViewerSessionId = typeof crypto.randomUUID === "function"
  ? crypto.randomUUID()
  : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

async function refreshTacticalMapViewerCount(generation: number) {
  try {
    const response = await apiPost<{ viewerCount?: unknown }>("/api/tactical-map/viewers", {
      sessionId: tacticalMapViewerSessionId,
    });
    if (generation !== tacticalMapViewerPresenceGeneration || !mapPageActive) return;

    const viewerCount = Number(response?.viewerCount);
    tacticalMapViewerCount.value = Number.isFinite(viewerCount)
      ? Math.max(0, Math.floor(viewerCount))
      : null;
  } catch {
    // Presence is informational only; map interaction should continue if this request fails.
  }
}

async function refreshTacticalRecordingStatus() {
  try {
    const status = await apiGet<{ recordingEnabled?: boolean; recording?: boolean }>("/api/tactical-feed-writer/status");
    tacticalRecording.value = {
      ...tacticalRecording.value,
      known: true,
      recordingEnabled: status.recordingEnabled === true,
      recording: status.recording === true,
    };
  } catch {
    // The replay module is optional during rollout; retain the last known state.
  }
}

async function toggleTacticalRecording() {
  if (!tacticalRecording.value.known || tacticalRecording.value.pending) return;
  tacticalRecording.value = { ...tacticalRecording.value, pending: true };
  try {
    const status = await apiPost<{ recordingEnabled?: boolean; recording?: boolean }>("/api/tactical-feed-writer/recording", {
      enabled: !tacticalRecording.value.recordingEnabled,
    });
    tacticalRecording.value = {
      known: true,
      pending: false,
      recordingEnabled: status.recordingEnabled === true,
      recording: status.recording === true,
    };
  } catch (error) {
    tacticalRecording.value = { ...tacticalRecording.value, pending: false };
    console.warn("Failed to change tactical replay recording state.", error);
  }
}

function startTacticalMapViewerPresence() {
  const generation = ++tacticalMapViewerPresenceGeneration;
  if (tacticalMapViewerHeartbeat !== null) window.clearInterval(tacticalMapViewerHeartbeat);
  void refreshTacticalMapViewerCount(generation);
  void refreshTacticalRecordingStatus();
  tacticalMapViewerHeartbeat = window.setInterval(() => {
    void refreshTacticalMapViewerCount(generation);
    void refreshTacticalRecordingStatus();
  }, TACTICAL_MAP_VIEWER_HEARTBEAT_MS);
}

function stopTacticalMapViewerPresence() {
  ++tacticalMapViewerPresenceGeneration;
  if (tacticalMapViewerHeartbeat !== null) {
    window.clearInterval(tacticalMapViewerHeartbeat);
    tacticalMapViewerHeartbeat = null;
  }
  tacticalMapViewerCount.value = null;
  const sessionId = encodeURIComponent(tacticalMapViewerSessionId);
  void apiDelete(`/api/tactical-map/viewers?sessionId=${sessionId}`, { keepalive: true }).catch(() => undefined);
}

const dynamicMarkerScale = computed(() => {
  const zoom = Math.max(camera.zoom.value, 0.05);
  // Below 1.0x, markers shrink with the map. Above 1.0x, compensate map zoom
  // so the on-screen marker size stays fixed instead of growing endlessly.
  if (zoom >= 1) {
    return markerScale.value / zoom;
  }
  return markerScale.value;
});

// Sidebar states
type SidebarMode = "expanded" | "compact" | "hidden";
type SidebarTab = "overview" | "units" | "assets" | "feed" | "core";
type SidebarUnitMode = "squads" | "players";
type SidebarSortMode = "name" | "squad" | "health" | "distance" | "vehicle";

const sidebarMode = ref<SidebarMode>(window.innerWidth <= 900 ? "compact" : "expanded");
const sidebarTab = ref<SidebarTab>("overview");
const sidebarUnitMode = ref<SidebarUnitMode>("squads");
const sidebarSearch = ref("");
const sidebarSortMode = ref<SidebarSortMode>("squad");
const sidebarOnlyAlive = ref(false);
const sidebarOnlyVehicle = ref(false);
const activeTeamTab = ref<number>(1);
const focusedSquadId = ref<number | null>(null);
const combatLogs = ref<CombatLog[]>([]);
const viewerPerspectiveMode = ref<ViewerPerspectiveMode>("auto");
const focusedPlayerKey = ref("");

// Draggable Pressure Zone Settings Modal State
const modalPos = ref<{ x: number; y: number } | null>(null);
const pressureModalPanelRef = ref<HTMLElement | null>(null);

function resetModalPos() {
  modalPos.value = null;
}

function startModalDrag(event: MouseEvent) {
  if ((event.target as HTMLElement).closest("button, input, select, a")) return;
  event.preventDefault();
  const panelEl = pressureModalPanelRef.value;
  if (!panelEl) return;
  const rect = panelEl.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  const initialLeft = modalPos.value ? modalPos.value.x : rect.left;
  const initialTop = modalPos.value ? modalPos.value.y : rect.top;

  const onMouseMove = (moveEvent: MouseEvent) => {
    const deltaX = moveEvent.clientX - startX;
    const deltaY = moveEvent.clientY - startY;
    const panelWidth = rect.width;
    const panelHeight = rect.height;
    const maxX = Math.max(10, window.innerWidth - panelWidth - 10);
    const maxY = Math.max(10, window.innerHeight - panelHeight - 10);
    const newX = Math.max(10, Math.min(maxX, initialLeft + deltaX));
    const newY = Math.max(10, Math.min(maxY, initialTop + deltaY));
    modalPos.value = { x: newX, y: newY };
  };

  const onMouseUp = () => {
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  };

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
}

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
const staticExplosionParticles = Array.from({ length: 36 }, (_, idx) => {
  const angle = Math.floor(Math.random() * 360);
  const speed = +(1.2 + Math.random() * 1.8).toFixed(2);
  const delay = +(Math.random() * 0.12).toFixed(2);
  const startOffset = +(0.1 + Math.random() * 0.3).toFixed(2);
  const spread = +(1.3 + Math.random() * 1.7).toFixed(2);
  const size = +(0.8 + Math.random() * 1.2).toFixed(2);
  const type = idx % 2 === 0 ? "spark" : "ember";
  return { id: idx, angle, speed, delay, startOffset, spread, size, type };
});

const visibleExplosionParticles = computed(() => (
  explosionMarkers.value.length > 6
    ? staticExplosionParticles.slice(0, 18)
    : staticExplosionParticles
));

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
  const list = Array.isArray(snapshotExplosions.value)
    ? snapshotExplosions.value.slice(-12)
    : [];
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
  }
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
    const now = Date.now();
    const currentKeys = new Set<string>();
    let changed = false;

    for (const player of newPlayers ?? []) {
      const key = getPlayerKey(player);
      if (!key) continue;
      currentKeys.add(key);
      const presenceState = String((player as any)?.presence?.state ?? "");
      const presenceHint = String((player as any)?.presenceHint ?? (player as any)?.telemetry?.presenceHint ?? "");
      const isNoPawn = presenceState === "noPawn" || presenceHint === "noPawn";
      const suppressMarker = shouldSuppressPlayerMarker(player);

      if (isNoPawn || suppressMarker) {
        changed = cachedPlayers.value.delete(key) || changed;
        playerTargets.delete(key);
        continue;
      }

      if (hasValidPosition(player)) {
        const cached = cachedPlayers.value.get(key);
        if (cached?.player !== player) {
          cachedPlayers.value.set(key, { player, lastSeen: now });
          changed = true;
        }
      } else if (import.meta.env.DEV) {
        console.debug("[TacticalMap] player skipped: invalid position", {
          key,
          name: player.playerName,
          presenceState,
          presenceHint,
          position: player.soldierInfo?.position,
          raw: player,
        });
      }
    }

    for (const key of cachedPlayers.value.keys()) {
      if (!currentKeys.has(key)) {
        cachedPlayers.value.delete(key);
        changed = true;
      }
    }

    if (changed) triggerRef(cachedPlayers);
  },
  { immediate: true }
);

// Clear player cache if active map changes
watch(
  activeMapConfig,
  () => {
    cachedPlayers.value.clear();
    triggerRef(cachedPlayers);
    adaptedPlayerCache.clear();
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
      const lastTarget = playerTargets.get(key);
      const nextYaw = unwrapAngleDegrees(lastTarget?.yaw ?? null, getPlayerYaw(player));
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
  const world = camera.screenToWorld(x, y);
  const mapSize = 1000;
  const pctX = world.x / mapSize;
  const pctY = world.y / mapSize;
  
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
    singleClickTimer.value = null;
  }

  selectedPlayerKey.value = getPlayerKey(player);
  if (containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect();
    playerInfoPanel.value = {
      player,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  playerActionMenu.value = null;
  mapCommandMenu.value = null;
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
  panToMapPercent(menu.mapX, menu.mapY, Math.max(camera.zoom.value, 1.25));
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
const serverPlayerCount = computed(() => {
  const serverCount = Number(serverStore.snapshot?.playerCount ?? 0);
  if (Number.isFinite(serverCount) && serverCount > 0) return serverCount;
  if (isStandaloneMapRoute.value) {
    const storeCount = Number(tacticalStateStore.server?.playerCount ?? 0);
    if (Number.isFinite(storeCount) && storeCount > 0) return storeCount;
  }
  return players.value.length;
});
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
    const key = getPlayerKey(player);
    const trackedYaw = key ? playerTargets.get(key)?.yaw ?? null : null;
    
    // Associate RCON detail
    const rconDetail = getPlayerRconDetail(player);

    return {
      ...player,
      mapX: project(pos.x ?? 0, bounds.minX, bounds.maxX),
      mapY: project(pos.y ?? 0, bounds.minY, bounds.maxY),
      yaw: trackedYaw ?? getPlayerYaw(player),
      teamId: resolvedTeamId,
      roleInfo: resolveMapRoleInfo(player),
      rconDetail,
    } as any as MapMarker;
  });
});

const vehicleMarkers = computed<VehicleMarker[]>(() => {
  const bounds = activeMapConfig.value.bounds;
  const markers: VehicleMarker[] = [];
  const playersByRuntimeId = new Map<string, TacticalLinkedPlayer>();
  for (const player of players.value) {
    const playerId = getRuntimePlayerId(player);
    if (playerId != null) playersByRuntimeId.set(playerId, player);
  }

  for (const [index, vehicle] of runtimeVehicles.value.entries()) {
    const x = Number(vehicle?.position?.x);
    const y = Number(vehicle?.position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const vehicleType = String(vehicle?.vehicleType ?? "").trim() || "Unknown Vehicle";
    const teamId = Number(vehicle?.teamId);
    const normalizedTeamId = teamId === 1 || teamId === 2 ? teamId : null;
    const icon = resolveVehicleIcon(vehicleType);
    const health = Number(vehicle?.healthPercent);
    const speed = vehicle?.speed == null || String(vehicle.speed).trim() === ""
      ? Number.NaN
      : Number(vehicle.speed);
    const driverId = normalizeRuntimePlayerId(vehicle?.driverPlayerId);
    const driverPlayerId = driverId == null ? null : Number(driverId);
    // Empty occupantPlayerIds means the latest seat snapshot is explicitly
    // empty. Only legacy payloads without that array may fall back to ID/seats.
    const hasOccupantSnapshot = Array.isArray(vehicle?.occupantPlayerIds);
    const rawOccupantIds = hasOccupantSnapshot
      ? vehicle.occupantPlayerIds
      : [
          ...(driverPlayerId == null ? [] : [driverPlayerId]),
          ...(Array.isArray(vehicle?.seatPlayerIds) ? vehicle.seatPlayerIds : []),
        ];
    const uniqueOccupantIds: string[] = [...new Set<string>(
      rawOccupantIds
        .map((item: unknown) => normalizeRuntimePlayerId(item))
        .filter((id: string | null): id is string => id != null),
    )];
    const occupants: VehicleOccupant[] = uniqueOccupantIds.map((id: string) => {
      const linkedPlayer = playersByRuntimeId.get(id);
      const rawRole = linkedPlayer?.role || "";
      const resolvedRole = resolveRoleIcon(rawRole);
      const roleLabel = (resolvedRole.label && resolvedRole.label !== "未指定" && resolvedRole.label !== "未知")
        ? resolvedRole.label
        : (id === driverId ? "驾驶员" : "乘员");
      const teamId = linkedPlayer?.teamId ?? normalizedTeamId;
      return {
        playerId: Number(id),
        playerName: linkedPlayer ? getPlayerLabel(linkedPlayer) : `Player ${id}`,
        role: roleLabel,
        teamId,
      };
    });
    const occupied = occupants.length > 0 || (!hasOccupantSnapshot && Boolean(vehicle?.occupied));
    const healthText = Number.isFinite(health) ? `HP ${Math.round(health)}%` : "HP --";
    const speedText = Number.isFinite(speed) ? `速度 ${speed.toFixed(1)}` : "速度 --";
    const tooltipParts = [
      `T${normalizedTeamId ?? "--"} · ${vehicleType}`,
      healthText,
      speedText,
      ...(occupants.length > 0
        ? occupants.map((occupant) => `${occupant.role}：${occupant.playerName} (#${occupant.playerId})`)
        : ["当前无人乘坐"]),
    ];
    markers.push({
      id: `runtime-vehicle:${normalizedTeamId ?? 0}:${vehicleType}:${index}`,
      teamId: normalizedTeamId,
      vehicleType,
      mapX: project(x, bounds.minX, bounds.maxX),
      mapY: project(y, bounds.minY, bounds.maxY),
      yaw: Number.isFinite(Number(vehicle?.yaw)) ? Number(vehicle.yaw) : null,
      occupied,
      healthText,
      speedText,
      occupants,
      iconPath: icon.icon.startsWith("/") ? icon.icon : null,
      iconLabel: icon.label,
      tooltip: tooltipParts.join(" · "),
    });
  }
  return markers;
});

const captureZoneMarkers = computed<CaptureZoneMarker[]>(() => {
  const zones = captureZones.value;
  if (!Array.isArray(zones) || zones.length === 0) return [];
  const bounds = activeMapConfig.value.bounds;
  const staticCaptureZones = Array.isArray(staticAssets.value?.captureZones) ? staticAssets.value.captureZones : [];
  const markers: CaptureZoneMarker[] = [];
  for (const zone of zones) {
    const name = String(zone.name ?? "").trim();
    if (!name) continue;
    const pos = zone?.position;
    let x = Number(pos?.x);
    let y = Number(pos?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      const fallback = staticCaptureZones.find((entry) => String(entry.name ?? "").trim() === name);
      x = Number(fallback?.x);
      y = Number(fallback?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        const cached = lastKnownZonePositions.value.get(name);
        x = Number(cached?.x);
        y = Number(cached?.y);
      }
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    lastKnownZonePositions.value.set(name, { x, y });
    const rawTeamId = Number(zone.teamId ?? zone.ownerTeamId ?? zone.captureDirection);
    const teamId = Number.isFinite(rawTeamId) && (rawTeamId === 1 || rawTeamId === 2) ? rawTeamId : null;
    const rawCapturePercent = Number(zone.capturePercent);
    const captureProgress = Number.isFinite(rawCapturePercent)
      ? Math.max(0, Math.min(100, rawCapturePercent >= 0 && rawCapturePercent <= 1 ? rawCapturePercent * 100 : rawCapturePercent))
      : 100;
    const rawCaptureTeamId = Number(
      zone.captureTeamId
      ?? zone.capturingTeamId
      ?? zone.captureDirection
      ?? zone.captureTeam
    );
    const captureTeamId = Number.isFinite(rawCaptureTeamId)
      && (rawCaptureTeamId === 1 || rawCaptureTeamId === 2)
      ? rawCaptureTeamId
      : null;
    const isCapturing = Boolean(
      captureTeamId
      && captureProgress > 0
      && captureProgress < 100
      && (zone.isCapturing ?? zone.capturing ?? true)
    );
    const faction = resolveMainZoneFaction(teamId);
    markers.push({
      type: "captureZone",
      id: `capture-zone-${name}`,
      name,
      teamId,
      mapX: project(x, bounds.minX, bounds.maxX),
      mapY: project(y, bounds.minY, bounds.maxY),
      gameX: x,
      gameY: y,
      capturePercent: zone.capturePercent ?? null,
      captureProgress,
      captureDirection: zone.captureDirection ?? null,
      captureTeamId,
      isCapturing,
      isLocked: zone.isLocked ?? null,
      factionCode: faction.factionCode,
      factionLabel: faction.factionLabel,
      flagUrl: faction.flagUrl,
      raw: zone.raw,
    });
  }
  return markers;
});

const teamFactionById = computed(() => {
  const map = new Map<number, string>();
  const addTeamName = (item: any) => {
    const teamId = Number(item?.teamId ?? item?.teamID ?? item?.id);
    if (!Number.isFinite(teamId) || map.has(teamId)) return;
    const factionName = String(
      // ListSquads is the authoritative RCON source: Team ID: n (Battlegroup Name).
      item?.teamName
      ?? item?.factionName
      ?? item?.name
      ?? item?.faction
      ?? "",
    ).trim();
    if (factionName) map.set(teamId, factionName);
  };

  const teamSources = [
    (snapshot.value as any)?.teams,
    (snapshot.value as any)?.matchState?.teams,
    (snapshot.value as any)?.matchState?.squads?.teams,
    (serverStore.snapshot as any)?.matchState?.teams,
    (serverStore.snapshot as any)?.matchState?.squads?.teams,
    (serverStore.snapshot as any)?.squads?.teams,
    (serverStore.snapshot as any)?.teams,
  ];
  for (const source of teamSources) {
    if (Array.isArray(source)) source.forEach(addTeamName);
  }

  const squadSources = [
    (snapshot.value as any)?.squads,
    (snapshot.value as any)?.matchState?.squads?.list,
    (serverStore.snapshot as any)?.matchState?.squads?.list,
    (serverStore.snapshot as any)?.squads?.list,
  ];
  for (const source of squadSources) {
    if (Array.isArray(source)) source.forEach(addTeamName);
  }
  return map;
});

function resolveMainZoneFaction(teamId: number | null) {
  const teamName = teamId == null ? "" : (teamFactionById.value.get(teamId) ?? "");
  const factionCode = teamName ? getFactionFromTeamName(teamName) : null;
  return {
    factionCode,
    factionLabel: factionCode ? getChineseNameByFaction(factionCode) : (teamName || (teamId == null ? "" : `Team ${teamId}`)),
    flagUrl: teamName ? 获取战斗群旗帜(teamName) : null,
  };
}

const mainZoneMarkers = computed<MainZoneMarker[]>(() => {
  const zones = mainZones.value;
  if (!Array.isArray(zones) || zones.length === 0) return [];
  const bounds = activeMapConfig.value.bounds;
  return zones
    .map((zone, index) => {
      const pos = zone?.position;
      const x = Number(pos?.x);
      const y = Number(pos?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const teamId = Number(zone?.teamId);
      const resolvedTeamId = Number.isFinite(teamId) ? teamId : null;
      const faction = resolveMainZoneFaction(resolvedTeamId);
      return {
        type: "mainZone",
        id: `main-zone-${resolvedTeamId ?? index}`,
        name: resolvedTeamId ? `MAIN T${resolvedTeamId}` : `MAIN ${index + 1}`,
        teamId: resolvedTeamId,
        factionCode: faction.factionCode,
        factionLabel: faction.factionLabel,
        flagUrl: faction.flagUrl,
        mapX: project(x, bounds.minX, bounds.maxX),
        mapY: project(y, bounds.minY, bounds.maxY),
        gameX: x,
        gameY: y,
        raw: zone.raw,
      };
    })
    .filter(Boolean) as MainZoneMarker[];
});

function metersToSvgRadius(meters: number) {
  const bounds = activeMapConfig.value.bounds;
  const mapGameWidth = bounds.maxX - bounds.minX;
  if (mapGameWidth <= 0) return 0;
  return ((meters * 100) / mapGameWidth) * 1000;
}

const fobMarkers = computed<FobMarker[]>(() => {
  const list = fobs.value;
  if (!Array.isArray(list) || list.length === 0) return [];
  const bounds = activeMapConfig.value.bounds;
  const markers: FobMarker[] = [];
  for (const fob of list) {
    const name = String(fob?.name ?? "FOB Radio").trim() || "FOB Radio";
    const teamId = Number.isFinite(Number(fob?.teamId)) ? Number(fob?.teamId) : null;
    const key = String(fob?.fobId ?? `${teamId ?? "unknown"}:${name}`).trim();
    const pos = fob?.position;
    let x = Number(pos?.x);
    let y = Number(pos?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      const cached = lastKnownFobPositions.value.get(key);
      x = Number(cached?.x);
      y = Number(cached?.y);
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    lastKnownFobPositions.value.set(key, { x, y });
    markers.push({
      type: "fob",
      id: String(fob.fobId ?? key ?? `${teamId ?? "unknown"}-${x}-${y}`),
      name,
      teamId,
      health: fob.health ?? null,
      isBleeding: fob.isBleeding,
      ammo: fob.ammo ?? null,
      construction: fob.construction ?? null,
      mapX: project(x, bounds.minX, bounds.maxX),
      mapY: project(y, bounds.minY, bounds.maxY),
      gameX: x,
      gameY: y,
      exclusionRadius: 300,
      constructionRadius: 150,
      radiusPx: metersToSvgRadius(300),
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
const renderedPlayerLimit = ref(0);
let markerBatchFrame: number | null = null;
let tilesEnableFrame: number | null = null;

const renderedPlayers = computed(() => (
  filteredPlayers.value.slice(0, renderedPlayerLimit.value)
));

/**
 * Fan out players that occupy the same screen-space bucket. This keeps every
 * player clickable and readable without creating a second marker data model.
 * The offset is screen-pixel based, so it remains stable while zooming.
 */
const displayedPlayers = computed(() => {
  const source = renderedPlayers.value;
  const zoom = Math.max(camera.zoom.value, 0.35);
  const bucketSizePercent = 18 / (10 * zoom);
  const buckets = new Map<string, any[]>();

  for (const player of source) {
    const key = [
      Math.round(player.mapX / bucketSizePercent),
      Math.round(player.mapY / bucketSizePercent),
    ].join(":");
    const bucket = buckets.get(key) ?? [];
    bucket.push(player);
    buckets.set(key, bucket);
  }

  const result: any[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length === 1) {
      result.push(bucket[0]);
      continue;
    }

    const radiusPx = Math.min(30, 9 + bucket.length * 1.5);
    bucket.forEach((player, index) => {
      const angle = (Math.PI * 2 * index) / bucket.length - Math.PI / 2;
      const offsetPercent = 1 / (10 * zoom);
      result.push({
        ...player,
        mapX: Math.max(0, Math.min(100, player.mapX + Math.cos(angle) * radiusPx * offsetPercent)),
        mapY: Math.max(0, Math.min(100, player.mapY + Math.sin(angle) * radiusPx * offsetPercent)),
      });
    });
  }
  return result;
});

function cancelMarkerBatch() {
  if (markerBatchFrame !== null) cancelAnimationFrame(markerBatchFrame);
  markerBatchFrame = null;
}

function scheduleMarkerBatch() {
  cancelMarkerBatch();
  const target = filteredPlayers.value.length;
  if (!mapPageActive || target === 0) {
    renderedPlayerLimit.value = 0;
    return;
  }

  const step = () => {
    if (!mapPageActive) return;
    renderedPlayerLimit.value = Math.min(target, renderedPlayerLimit.value + 25);
    if (renderedPlayerLimit.value < target) {
      markerBatchFrame = requestAnimationFrame(step);
    } else {
      markerBatchFrame = null;
    }
  };
  if (renderedPlayerLimit.value > target) renderedPlayerLimit.value = target;
  markerBatchFrame = requestAnimationFrame(step);
}

watch(
  () => filteredPlayers.value.length,
  () => scheduleMarkerBatch(),
);


watch(
  () => ({
    players: players.value.length,
    cached: positionedPlayers.value.length,
    markers: markers.value.length,
    filtered: filteredPlayers.value.length,
  }),
  (stats) => {
    if (isDev) {
      console.debug("[TacticalMap] marker stats", stats);
    }
  },
  { immediate: true }
);

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
  const { x: pixelX, y: pixelY } = camera.worldToScreen((mapX / 100) * mapSize, (mapY / 100) * mapSize);
  
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
  const world = camera.screenToWorld(x, y);
  const mapSize = 1000;
  const pctX = world.x / mapSize;
  const pctY = world.y / mapSize;
  
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
let dragFrameId: number | null = null;
let pendingDragPoint: { x: number; y: number } | null = null;

function flushPendingDrag() {
  if (!pendingDragPoint) return;
  const point = pendingDragPoint;
  pendingDragPoint = null;
  camera.onDrag(point.x, point.y);
}

function scheduleDragFrame(clientX: number, clientY: number) {
  pendingDragPoint = { x: clientX, y: clientY };
  if (dragFrameId !== null) return;
  dragFrameId = requestAnimationFrame(() => {
    dragFrameId = null;
    flushPendingDrag();
  });
}

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

  scheduleDragFrame(e.clientX, e.clientY);
}

// Re-sync final dragging state (handles cleanup if dragging ends outside viewport)
function stopDrag(e?: PointerEvent) {
  if (e && activeDragPointerId !== null && e.pointerId === activeDragPointerId) {
    pendingDragPoint = { x: e.clientX, y: e.clientY };
  }
  if (dragFrameId !== null) {
    cancelAnimationFrame(dragFrameId);
    dragFrameId = null;
  }
  flushPendingDrag();

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
  let nextZoom = camera.zoom.value;
  if (e.deltaY < 0) {
    nextZoom = Math.min(64, camera.zoom.value * factor);
  } else {
    nextZoom = Math.max(0.35, camera.zoom.value / factor);
  }

  camera.setZoom(nextZoom, mouseX, mouseY);
}

function zoomIn() {
  if (!containerRef.value) {
    camera.setZoom(Math.min(64, camera.zoom.value * 1.25), 0, 0);
    return;
  }
  const rect = containerRef.value.getBoundingClientRect();
  camera.setZoom(Math.min(64, camera.zoom.value * 1.25), rect.width / 2, rect.height / 2);
}
function zoomOut() {
  if (!containerRef.value) {
    camera.setZoom(Math.max(0.35, camera.zoom.value / 1.25), 0, 0);
    return;
  }
  const rect = containerRef.value.getBoundingClientRect();
  camera.setZoom(Math.max(0.35, camera.zoom.value / 1.25), rect.width / 2, rect.height / 2);
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
  camera.setZoom(nextZoom, viewWidth / 2, viewHeight / 2);
  camera.x.value = (viewWidth - mapSize * nextZoom) / 2;
  camera.y.value = (viewHeight - mapSize * nextZoom) / 2;
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

function panToMapPercent(mapX: number, mapY: number, targetZoom?: number) {
  const zoomTarget = targetZoom ?? camera.zoom.value;
  const clampedZoom = Math.max(0.35, Math.min(64, zoomTarget));
  if (!containerRef.value) return;
  const mapSize = 1000;
  const viewWidth = containerRef.value.clientWidth;
  const viewHeight = containerRef.value.clientHeight;
  const nextX = viewWidth / 2 - (mapX / 100) * mapSize * clampedZoom;
  const nextY = viewHeight / 2 - (mapY / 100) * mapSize * clampedZoom;
  camera.setZoom(clampedZoom, viewWidth / 2, viewHeight / 2);
  camera.x.value = nextX;
  camera.y.value = nextY;
}

function focusPlayerOnMap(player: TacticalLinkedPlayer) {
  const key = getPlayerKey(player);
  focusedPlayerKey.value = key;
  const marker = markers.value.find((m) => getPlayerKey(m) === key);
  if (marker) {
    panToMapPercent(marker.mapX, marker.mapY, Math.max(camera.zoom.value, 1.2));
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
  panToMapPercent(avgX, avgY, Math.max(camera.zoom.value, 1.1));
}

function focusFobOnMap(marker: { mapX: number; mapY: number }) {
  panToMapPercent(marker.mapX, marker.mapY, Math.max(camera.zoom.value, 1.15));
}

function focusZoneOnMap(marker: { mapX: number; mapY: number }) {
  panToMapPercent(marker.mapX, marker.mapY, Math.max(camera.zoom.value, 1.15));
}

function focusVehicleOnMap(marker: { mapX: number; mapY: number }) {
  panToMapPercent(marker.mapX, marker.mapY, Math.max(camera.zoom.value, 1.15));
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

  if (isStandaloneMapRoute.value) {
    if (containerRef.value) {
      const rect = containerRef.value.getBoundingClientRect();
      const eventX = event?.clientX ?? rect.left + rect.width / 2;
      const eventY = event?.clientY ?? rect.top + rect.height / 2;
      playerInfoPanel.value = {
        player,
        x: Math.max(8, Math.min(rect.width - 268, eventX - rect.left)),
        y: Math.max(8, Math.min(rect.height - 220, eventY - rect.top)),
      };
      selectedPlayerKey.value = getPlayerKey(player);
      playerActionMenu.value = null;
      mapCommandMenu.value = null;
    }
    return;
  }

  // Embedded map: the parent owns the single floating window.
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
  const source = player as any;
  if (source?.yaw != null) return source.yaw;
  if (source?.telemetry?.yaw != null) return source.telemetry.yaw;
  const rotation = source?.telemetry?.rotation ?? player.soldierInfo?.rotation ?? source?.raw?.bzss?.soldierInfo?.rotation;
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
  const playerName = String(
    player.playerName
    ?? (player as any)?.identity?.name
    ?? (player as any)?.rconDetail?.name
    ?? (player as any)?.runtime?.name
    ?? (player as any)?.name
    ?? "",
  ).trim();
  if (playerName) return playerName;
  const playerIndex = player.playerIndex ?? player.playerId;
  if (playerIndex != null) return `Player ${playerIndex}`;
  return "Unknown";
}

function getPlayerPosition(player: BzssCoreTrackedPlayerInfo | null | undefined) {
  const source = player as any;
  return source?.telemetry?.position ?? player?.soldierInfo?.position ?? player?.position ?? source?.raw?.bzss?.position ?? source?.raw?.bzss?.soldierInfo?.position ?? null;
}

function getPlayerHealth(player: BzssCoreTrackedPlayerInfo | null | undefined): number | null {
  const source = player as any;
  const value = source?.telemetry?.health ?? player?.soldierInfo?.health ?? source?.raw?.bzss?.soldierInfo?.health;
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

function normalizeAngleDegrees(value: number) {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function unwrapAngleDegrees(previous: number | null, next: number | null) {
  if (next == null || !Number.isFinite(next)) return null;
  const normalizedNext = normalizeAngleDegrees(next);
  if (previous == null || !Number.isFinite(previous)) return normalizedNext;

  const normalizedPrevious = normalizeAngleDegrees(previous);
  let delta = normalizedNext - normalizedPrevious;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return previous + delta;
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

function cleanWeaponName(weaponClass: string | null | undefined): string {
  if (!weaponClass) return "-";
  return weaponClass
    .replace(/^(BP_|Weapon_)/i, "")
    .replace(/(_\d+)?_C.*$/i, "")
    .replace(/_\d+$/, "");
}

function getVehicleIconColor(vehicle: VehicleMarker): string {
  return getPerspectivePalette(getPerspectiveTone(vehicle.teamId)).icon;
}

function getFobIconColor(fob: FobMarker) {
  if (fob.isBleeding) return "#ef4444";
  const health = Number(fob.health);
  const ratio = Number.isFinite(health) ? Math.max(0, Math.min(1, health > 1 ? health / 300 : health)) : 1;
  const base = fob.teamId === 1 ? [96, 165, 250] : fob.teamId === 2 ? [248, 113, 113] : [148, 163, 184];
  const shade = 0.35 + ratio * 0.65;
  return `rgb(${Math.round(base[0] * shade)} ${Math.round(base[1] * shade)} ${Math.round(base[2] * shade)})`;
}

function formatFobResource(value: number | null | undefined) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  return Math.max(0, Math.round(numeric)).toLocaleString();
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
    if (pressureSettingsOpen.value) {
      pressureSettingsOpen.value = false;
      return;
    }
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

function attachResizeObserver() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (!containerRef.value || typeof ResizeObserver === "undefined") return;

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

function activateMapPage() {
  if (mapPageActive) return;
  mapPageActive = true;
  startTacticalMapViewerPresence();
  tilesEnabled.value = false;
  renderedPlayerLimit.value = 0;

  if (tilesEnableFrame !== null) cancelAnimationFrame(tilesEnableFrame);
  tilesEnableFrame = requestAnimationFrame(() => {
    tilesEnableFrame = null;
    if (!mapPageActive) return;
    tilesEnabled.value = true;
    scheduleMarkerBatch();
  });

  if (isStandaloneMapRoute.value) {
    void tacticalStateStore.fetchSnapshot();
    tacticalStateStore.startStream();
  }
  schedulePressureZoneFetch(0);

  window.addEventListener("resize", fitToViewport);
  window.addEventListener("keydown", handleWindowKeyDown);
  attachResizeObserver();

  if (fitViewportTimeout !== null) window.clearTimeout(fitViewportTimeout);
  fitViewportTimeout = window.setTimeout(() => {
    fitViewportTimeout = null;
    fitToViewport();
  }, 100);

  logCombatEvent("Tactical map scan initialized... coordinate grid ready", "system");
  logCombatEvent("Live tactical tracking active", "system");

  if (import.meta.env.DEV && !simulatedCombatTimer) {
    simulatedCombatTimer = window.setInterval(runCombatEventSimulation, 2500);
  }
}

function deactivateMapPage() {
  if (!mapPageActive) return;
  mapPageActive = false;
  stopTacticalMapViewerPresence();
  stopDrag();

  if (isStandaloneMapRoute.value) {
    tacticalStateStore.stopStream();
  }

  window.removeEventListener("resize", fitToViewport);
  window.removeEventListener("keydown", handleWindowKeyDown);
  resizeObserver?.disconnect();
  resizeObserver = null;

  if (simulatedCombatTimer) {
    window.clearInterval(simulatedCombatTimer);
    simulatedCombatTimer = null;
  }
  if (fitViewportTimeout !== null) {
    window.clearTimeout(fitViewportTimeout);
    fitViewportTimeout = null;
  }
  if (tilesEnableFrame !== null) {
    cancelAnimationFrame(tilesEnableFrame);
    tilesEnableFrame = null;
  }
  if (pressureZoneFetchTimer != null) {
    window.clearTimeout(pressureZoneFetchTimer);
    pressureZoneFetchTimer = null;
  }
  pressureZoneRequestSequence += 1;
  cancelMarkerBatch();
  renderedPlayerLimit.value = 0;
  clearTimeout(shakeTimeoutId);
  shakeTimeoutId = null;
  if (singleClickTimer.value) {
    clearTimeout(singleClickTimer.value);
    singleClickTimer.value = null;
  }

  tilesEnabled.value = false;
  tilesReady.value = false;
  playerInfoPanel.value = null;
  playerActionMenu.value = null;
  mapCommandMenu.value = null;
  hoveredPlayer.value = null;
  hoverCoords.value = null;
}

onMounted(activateMapPage);
onActivated(activateMapPage);
onDeactivated(deactivateMapPage);
onBeforeUnmount(deactivateMapPage);

</script>

<style scoped>
@import "../styles/tactical-map.css";

.tactical-map-viewer-count {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 1000;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid rgba(103, 232, 249, 0.32);
  border-radius: 999px;
  background: rgba(5, 12, 24, 0.82);
  box-shadow: 0 5px 16px rgba(0, 0, 0, 0.28);
  color: #d9faff;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  pointer-events: none;
  backdrop-filter: blur(8px);
}

.tactical-map-viewer-count__indicator {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #41f5b5;
  box-shadow: 0 0 0 3px rgba(65, 245, 181, 0.14), 0 0 10px rgba(65, 245, 181, 0.82);
}

.tactical-map-recording {
  position: absolute;
  top: 54px;
  right: 14px;
  z-index: 1000;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 7px 6px 10px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 999px;
  background: rgba(5, 12, 24, 0.84);
  box-shadow: 0 5px 16px rgba(0, 0, 0, 0.28);
  color: #dbeafe;
  font-size: 12px;
  font-weight: 650;
  backdrop-filter: blur(8px);
}

.tactical-map-recording.is-recording { border-color: rgba(248, 113, 113, 0.7); color: #fee2e2; }
.tactical-map-recording.is-disabled { color: #94a3b8; }
.tactical-map-recording__dot { width: 8px; height: 8px; border-radius: 50%; background: #64748b; }
.tactical-map-recording.is-recording .tactical-map-recording__dot { background: #ef4444; box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.18), 0 0 12px rgba(248, 113, 113, 0.9); animation: tactical-record-pulse 1.2s ease-in-out infinite; }
.tactical-map-recording__button { border: 1px solid rgba(203, 213, 225, .3); border-radius: 999px; padding: 3px 8px; background: rgba(15, 23, 42, .76); color: inherit; cursor: pointer; font: inherit; font-size: 11px; }
.tactical-map-recording__button:hover:not(:disabled) { border-color: rgba(255, 255, 255, .78); background: rgba(30, 41, 59, .92); }
.tactical-map-recording__button:disabled { cursor: wait; opacity: .58; }
@keyframes tactical-record-pulse { 50% { opacity: .45; } }
.vehicle-markers-layer {
  position: absolute;
  inset: 0;
  z-index: 18;
}

.vehicle-marker {
  position: absolute;
  width: 0;
  height: 0;
  overflow: visible;
  --vehicle-accent: #94a3b8;
}

.vehicle-marker.team-1 { --vehicle-accent: #7da2d6; }
.vehicle-marker.team-2 { --vehicle-accent: #d68a8a; }
.vehicle-marker:hover { z-index: 90; }

.vehicle-marker__hitbox {
  position: absolute;
  left: -22px;
  top: -22px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
}

.vehicle-marker__frame {
  position: absolute;
  left: -13px;
  top: -13px;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  transform: scale(var(--vehicle-marker-scale, 1)) rotate(var(--vehicle-yaw));
  transform-origin: center;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .92));
  will-change: transform;
}

.vehicle-marker__icon {
  width: 26px;
  height: 26px;
  display: block;
  overflow: visible;
}

.vehicle-marker__fallback {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: 1px solid var(--vehicle-accent);
  border-radius: 50%;
  background: rgba(2, 6, 23, .88);
  color: var(--vehicle-accent);
  font-size: 13px;
  line-height: 1;
}

.vehicle-marker__tooltip {
  position: absolute;
  left: 18px;
  top: 50%;
  z-index: 95;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
  pointer-events: none;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(-50%) translateX(4px);
  transition: opacity .12s ease, transform .12s ease;
}

.vehicle-marker:hover .vehicle-marker__tooltip {
  opacity: 1;
  transform: translateY(-50%) translateX(0);
}

.vehicle-marker__occupants {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.vehicle-marker__occupant {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95), 0 0 2px rgba(0, 0, 0, 0.95);
  color: var(--vehicle-accent, #94a3b8);
}

.vehicle-marker__occupant.team-1 {
  color: #7dd3fc;
}

.vehicle-marker__occupant.team-2 {
  color: #f87171;
}

.vehicle-marker__occupant-role {
  flex: 0 0 auto;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.vehicle-marker__occupant-name {
  flex: 0 0 auto;
}

.vehicle-marker__empty {
  font-size: 11px;
  font-weight: 600;
  color: #94a3b8;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95), 0 0 2px rgba(0, 0, 0, 0.95);
}


/* The command layer is deliberately small and grouped.  Map data keeps the
   visual priority; controls only expand when the operator asks for them. */
.tactical-command-bar {
  position: absolute;
  z-index: 60;
  top: 14px;
  left: 14px;
  right: 14px;
  display: grid;
  grid-template-columns: minmax(190px, 1fr) auto minmax(260px, 1fr);
  align-items: center;
  gap: 14px;
  min-height: 54px;
  padding: 9px 12px 9px 16px;
  border: 1px solid rgba(148, 163, 184, .28);
  border-radius: 12px;
  background: linear-gradient(90deg, rgba(4, 13, 27, .93), rgba(8, 23, 40, .84));
  box-shadow: 0 12px 32px rgba(0, 0, 0, .32);
  backdrop-filter: blur(14px);
}
.tactical-command-bar__identity { display: grid; min-width: 0; gap: 1px; }
.tactical-command-bar__identity strong { overflow: hidden; color: #f1f7fb; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
.tactical-command-bar__identity span:last-child { overflow: hidden; color: #91aabd; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.tactical-command-bar__eyebrow { color: #48d6aa; font-size: 9px; font-weight: 800; letter-spacing: .14em; }
.tactical-command-bar__tickets { display: flex; align-items: center; gap: 8px; padding: 0 14px; border-inline: 1px solid rgba(148, 163, 184, .17); }
.tactical-ticket { display: grid; gap: 2px; min-width: 58px; text-align: center; }
.tactical-ticket b { color: #91aabd; font-size: 9px; letter-spacing: .08em; }
.tactical-ticket strong { color: var(--perspective-primary, #f8fafc); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 18px; line-height: 1; }
.tactical-ticket__vs { color: #60768a; font-size: 10px; font-weight: 800; }
.tactical-command-bar__status { display: flex; justify-content: flex-end; align-items: center; gap: 9px; min-width: 0; color: #b9cad6; font-size: 11px; }
.tactical-live-status, .tactical-recording-status { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.tactical-live-status i, .tactical-recording-status i { width: 7px; height: 7px; border-radius: 50%; background: #64748b; }
.tactical-live-status i { background: #45d9ac; box-shadow: 0 0 10px rgba(69, 217, 172, .85); }
.tactical-recording-status.is-recording { color: #fee2e2; }
.tactical-recording-status.is-recording i { background: #f87171; box-shadow: 0 0 10px rgba(248, 113, 113, .88); }
.tactical-recording-status.is-disabled { color: #718096; }
.tactical-recording-action { flex: 0 0 auto; padding: 6px 9px; border: 1px solid rgba(111, 227, 178, .48); border-radius: 7px; background: rgba(20, 83, 67, .42); color: #9bf4cf; font-size: 11px; cursor: pointer; }
.tactical-recording-action:hover:not(:disabled) { background: #48d6aa; color: #06251e; }
.tactical-recording-action:disabled { cursor: wait; opacity: .55; }

.map-control-dock { position: absolute; z-index: 60; bottom: 16px; left: 16px; display: grid; gap: 7px; }
.map-control-dock__nav, .map-control-dock__menu-row, .map-control-popover, .map-coordinate-readout { border: 1px solid rgba(148, 163, 184, .28); border-radius: 10px; background: rgba(4, 14, 27, .9); box-shadow: 0 10px 28px rgba(0, 0, 0, .28); backdrop-filter: blur(12px); }
.map-control-dock__nav, .map-control-dock__menu-row { display: flex; width: fit-content; padding: 4px; }
.map-control-dock .ctrl-btn { min-width: 34px; height: 32px; border: 0; border-radius: 7px; background: transparent; color: #b8ccd9; }
.map-control-dock .ctrl-btn:hover, .map-control-dock .ctrl-btn.active { background: rgba(72, 214, 170, .2); color: #a7f6d4; }
.map-control-dock .ctrl-btn.text-btn { width: auto; min-width: 46px; padding: 0 10px; font-size: 11px; }
.map-control-popover { display: grid; grid-template-columns: repeat(3, minmax(54px, 1fr)); width: min(260px, calc(100vw - 32px)); gap: 3px; padding: 5px; }
.map-control-popover--help { grid-template-columns: 1fr 1fr; padding: 10px; color: #aac0ce; font-size: 11px; }
.map-control-popover--help span { display: flex; align-items: center; gap: 6px; }
.map-control-popover kbd { min-width: 30px; padding: 2px 4px; border: 1px solid rgba(148, 163, 184, .3); border-radius: 4px; color: #e1edf5; background: rgba(30, 41, 59, .7); font: inherit; text-align: center; }
.map-coordinate-readout { position: absolute; z-index: 60; right: 16px; bottom: 16px; display: flex; align-items: center; gap: 10px; padding: 9px 11px; color: #91aabd; font-size: 11px; }
.map-coordinate-readout span { color: #60768a; font-size: 9px; letter-spacing: .1em; text-transform: uppercase; }
.map-coordinate-readout b { color: #dcebf3; font-weight: 650; }
.pressure-settings-modal {
  position: fixed;
  z-index: 1200;
  inset: 0;
  pointer-events: none;
  background: transparent;
  backdrop-filter: none;
}

.pressure-settings-modal__panel {
  position: absolute;
  top: 50px;
  left: max(16px, calc(50vw - 390px));
  width: min(780px, calc(100vw - 32px));
  height: min(700px, calc(100vh - 70px));
  pointer-events: auto;
  overflow: hidden;
  border: 1px solid rgba(94, 234, 212, 0.4);
  border-radius: 14px;
  background: rgba(4, 9, 18, 0.96);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.85), 0 0 30px rgba(45, 212, 191, 0.18);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
}

.modal-drag-header {
  padding: 10px 14px;
  background: rgba(13, 148, 136, 0.25);
  border-bottom: 1px solid rgba(94, 234, 212, 0.3);
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: move;
  user-select: none;
  flex-shrink: 0;
}

.drag-title-block {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #99f6e4;
  font-size: 12px;
}

.drag-grip-dots {
  font-weight: 900;
  color: #2dd4bf;
  letter-spacing: -2px;
}

.drag-title {
  font-weight: 700;
}

.drag-tip {
  font-size: 10px;
  color: rgba(148, 163, 184, 0.7);
}

.modal-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.modal-reset-pos-btn {
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(148, 163, 184, 0.35);
  color: #94a3b8;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.modal-reset-pos-btn:hover {
  background: rgba(13, 148, 136, 0.3);
  border-color: rgba(45, 212, 191, 0.5);
  color: #5eead4;
}

.modal-close-icon {
  background: transparent;
  border: none;
  color: #94a3b8;
  font-size: 14px;
  cursor: pointer;
  padding: 3px 8px;
  border-radius: 6px;
  transition: all 0.15s ease;
}

.modal-close-icon:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.modal-body-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

@media (max-width: 1050px) {
  .tactical-command-bar { grid-template-columns: minmax(0, 1fr) auto; }
  .tactical-command-bar__tickets { order: 3; grid-column: 1 / -1; justify-self: center; padding: 5px 0 0; border-top: 1px solid rgba(148, 163, 184, .17); border-inline: 0; }
}
@media (max-width: 700px) {
  .tactical-command-bar { top: 8px; left: 8px; right: 8px; gap: 8px; padding: 8px 10px; }
  .tactical-command-bar__status { gap: 6px; }
  .tactical-live-status, .tactical-recording-status { font-size: 0; }
  .tactical-command-bar__identity strong { font-size: 13px; }
  .tactical-command-bar__identity span:last-child { display: none; }
  .map-control-dock { bottom: 8px; left: 8px; }
  .map-coordinate-readout { right: 8px; bottom: 8px; }
  .pressure-settings-modal { padding: 0; }
  .pressure-settings-modal__panel { width: 100%; height: 100%; border: 0; border-radius: 0; }
}
</style>
