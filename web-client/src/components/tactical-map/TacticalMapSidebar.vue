<template>
  <aside class="tactical-sidebar" :class="{ 'is-collapsed': isCollapsed }">
    <!-- Collapsible toggle tab -->
    <button
      class="sidebar-toggle-tab"
      type="button"
      :class="{ 'is-collapsed': isCollapsed }"
      @click="isCollapsed = !isCollapsed"
      :title="isCollapsed ? '展开战术面板' : '收起战术面板'"
    >
      <span class="tab-arrow">{{ isCollapsed ? '◀' : '▶' }}</span>
      <span v-if="isCollapsed" class="vertical-tab-text font-mono">TACTICAL</span>
    </button>

    <div class="sidebar-content-wrapper" :class="{ 'is-collapsed': isCollapsed }">
      <!-- ── Header ── -->
      <header class="sidebar-header">
        <div class="header-top-row">
          <div class="header-led-block">
            <div class="header-led-indicator pulse-led" title="System Online"></div>
            <div class="header-text">
              <div class="sidebar-title font-mono">TACTICAL CMD</div>
              <div class="sidebar-subtitle">实时战术指挥系统</div>
            </div>
          </div>
          <div class="header-live-chip">
            <span class="live-pulse-dot"></span>
            <span class="live-label font-mono">LIVE</span>
          </div>
        </div>

        <!-- Server quick stats -->
        <div class="header-quick-stats">
          <div class="qs-item">
            <span class="qs-val text-cyan font-mono">{{ serverPlayerCount }}</span>
            <span class="qs-lbl">在线玩家</span>
          </div>
          <div class="qs-sep"></div>
          <div class="qs-item">
            <span class="qs-val pulsing-text text-green">{{ statusText || '正常运行' }}</span>
            <span class="qs-lbl">系统状态</span>
          </div>
          <div class="qs-sep"></div>
          <div class="qs-item">
            <span class="qs-val text-amber font-mono">{{ matchPhase || '对局进行中' }}</span>
            <span class="qs-lbl">战局阶段</span>
          </div>
        </div>

        <!-- Ticket bar -->
        <div class="header-ticket-bar" :class="{ 'is-low-ticket': isLowTicket }">
          <div class="ticket-meta-info">
            <span class="ticket-label-left font-mono" :style="getPerspectiveStyle(1)">T1 {{ tickets.team1 }}</span>
            <span class="ticket-vs-badge font-mono">VS</span>
            <span class="ticket-label-right font-mono" :style="getPerspectiveStyle(2)">{{ tickets.team2 }} T2</span>
          </div>
          <div class="ticket-track">
            <div class="ticket-fill ticket-fill-left" :style="{ ...getPerspectiveStyle(1), width: getTicketBarWidth(1) }"></div>
            <div class="ticket-fill ticket-fill-right" :style="{ ...getPerspectiveStyle(2), width: getTicketBarWidth(2) }"></div>
          </div>
        </div>
      </header>

      <!-- ── Layers / Settings ── -->
      <section class="sidebar-section">
        <div class="section-title-bar" @click="layersOpen = !layersOpen">
          <div class="title-left">
            <span class="glowing-square blue"></span>
            <h3>图层控制</h3>
            <span class="layers-count-badge font-mono">{{ activeLayerCount }} 项开启</span>
          </div>
          <button type="button" class="section-collapse-btn" aria-label="Toggle Layers">
            {{ layersOpen ? '▲' : '▼' }}
          </button>
        </div>

        <div v-show="layersOpen" class="layers-content custom-scrollbar">
          <!-- Layer Presets -->
          <div class="layer-preset-bar">
            <span class="preset-label font-mono">预设:</span>
            <button type="button" class="preset-btn" @click="applyLayerPreset('all')">全图层</button>
            <button type="button" class="preset-btn" @click="applyLayerPreset('compact')">精简</button>
            <button type="button" class="preset-btn" @click="applyLayerPreset('minimal')">极简</button>
          </div>

          <!-- Switcher Chips Grid -->
          <div class="layers-chips-grid">
            <button
              type="button"
              class="layer-chip"
              :class="{ active: showGridModel }"
              @click="showGridModel = !showGridModel"
            >
              <span class="chip-icon">🌐</span>
              <span class="chip-text">网格</span>
            </button>
            <button
              type="button"
              class="layer-chip"
              :class="{ active: showPlayerNamesModel }"
              @click="showPlayerNamesModel = !showPlayerNamesModel"
            >
              <span class="chip-icon">🏷️</span>
              <span class="chip-text">名称</span>
            </button>
            <button
              type="button"
              class="layer-chip"
              :class="{ active: showPlayerCoordsModel }"
              @click="showPlayerCoordsModel = !showPlayerCoordsModel"
            >
              <span class="chip-icon">📍</span>
              <span class="chip-text">坐标</span>
            </button>
            <button
              type="button"
              class="layer-chip"
              :class="{ active: showCaptureZonesModel }"
              @click="showCaptureZonesModel = !showCaptureZonesModel"
            >
              <span class="chip-icon">🚩</span>
              <span class="chip-text">目标点</span>
            </button>
            <button
              type="button"
              class="layer-chip"
              :class="{ active: showFobsModel }"
              @click="showFobsModel = !showFobsModel"
            >
              <span class="chip-icon">🏰</span>
              <span class="chip-text">FOB</span>
            </button>
            <button
              type="button"
              class="layer-chip"
              :class="{ active: showPressureZonesModel }"
              @click="showPressureZonesModel = !showPressureZonesModel"
            >
              <span class="chip-icon">⚡</span>
              <span class="chip-text">压家圈</span>
            </button>
            <button
              type="button"
              class="layer-chip"
              :class="{ active: measureModeModel }"
              @click="measureModeModel = !measureModeModel"
            >
              <span class="chip-icon">📏</span>
              <span class="chip-text">测距</span>
            </button>
          </div>

          <div v-if="showPressureZonesModel" class="pressure-layer-options">
            <label class="pressure-sub-option"><input v-model="showPressureHardModel" type="checkbox" /><span>Hard</span></label>
            <label class="pressure-sub-option"><input v-model="showPressureSoftModel" type="checkbox" /><span>Soft</span></label>
            <label class="pressure-sub-option"><input v-model="showPressureCombatModel" type="checkbox" /><span>Combat</span></label>
            <label class="pressure-sub-option"><input v-model="showPressureDiagnosticsModel" type="checkbox" /><span>参数</span></label>
            <label class="pressure-sub-option"><input v-model="showPressureConnectionsModel" type="checkbox" /><span>连线</span></label>
            <button v-if="canManagePressureSettings" type="button" class="pressure-settings-button" @click="emit('open-pressure-settings')">
              <span>⚙</span><b>压家圈基础参数</b>
            </button>
          </div>

          <!-- Map selector -->
          <div class="option-row">
            <span class="option-label">地图</span>
            <select v-model="selectedMapKeyModel" class="map-select">
              <option value="auto">Auto ({{ detectedMapName || '自动识别' }})</option>
              <option v-for="map in mapOptions" :key="map.key" :value="map.key">{{ map.name }}</option>
            </select>
          </div>
          <div class="map-size-summary">
            <span>地图范围</span>
            <strong class="font-mono">{{ mapSizeText || '未知尺寸' }}</strong>
          </div>

          <!-- Perspective -->
          <div class="option-row option-row--col">
            <span class="option-label">观察视角</span>
            <div class="perspective-switch">
              <button type="button" class="perspective-btn" :class="{ active: viewerPerspectiveModeModel === 'auto' }" @click="viewerPerspectiveModeModel = 'auto'">Auto</button>
              <button type="button" class="perspective-btn" :class="{ active: viewerPerspectiveModeModel === 'team1' }" :style="getPerspectiveStyle(1)" @click="viewerPerspectiveModeModel = 'team1'">TEAM 1</button>
              <button type="button" class="perspective-btn" :class="{ active: viewerPerspectiveModeModel === 'team2' }" :style="getPerspectiveStyle(2)" @click="viewerPerspectiveModeModel = 'team2'">TEAM 2</button>
            </div>
          </div>
          <div v-if="perspectiveSummaryText" class="perspective-summary">{{ perspectiveSummaryText }}</div>

          <!-- Marker scale -->
          <div class="option-row">
            <span class="option-label">标记缩放</span>
            <input v-model.number="markerScaleModel" type="range" min="0.05" max="2" step="0.05" class="scale-slider" />
            <span class="scale-val font-mono">{{ markerScaleModel.toFixed(2) }}x</span>
          </div>
        </div>
      </section>

      <!-- ── Tab Directory Navigation ── -->
      <nav class="sidebar-tabs-directory" aria-label="Sidebar Navigation">
        <button class="directory-tab-btn" :class="{ active: sidebarTab === 'overview' }" @click="sidebarTabModel = 'overview'">
          <span class="tab-icon">📊</span><span class="tab-name">总览</span>
        </button>
        <button class="directory-tab-btn" :class="{ active: sidebarTab === 'units' }" @click="sidebarTabModel = 'units'">
          <span class="tab-icon">👥</span><span class="tab-name">单位</span>
        </button>
        <button class="directory-tab-btn" :class="{ active: sidebarTab === 'assets' }" @click="sidebarTabModel = 'assets'">
          <span class="tab-icon">📡</span><span class="tab-name">资产</span>
        </button>
        <button class="directory-tab-btn" :class="{ active: sidebarTab === 'feed' }" @click="sidebarTabModel = 'feed'">
          <span class="tab-icon">📜</span><span class="tab-name">战报</span>
          <span v-if="combatLogs?.length" class="feed-count-badge font-mono">{{ combatLogs.length }}</span>
        </button>
        <button class="directory-tab-btn" :class="{ active: sidebarTab === 'core' }" @click="sidebarTabModel = 'core'">
          <span class="tab-icon">⚙️</span><span class="tab-name">核心</span>
        </button>
      </nav>

      <!-- ── Tab Content ── -->
      <section class="sidebar-tab-section">

        <!-- Overview Tab -->
        <div v-if="sidebarTab === 'overview'" class="tab-panel-container">
          <div class="sidebar-scroll panel-body-scroll custom-scrollbar">
            <!-- Tactical Breakdown Card -->
            <div class="overview-card tactical-breakdown-card">
              <div class="overview-card-title">战场局势对比</div>
              <div class="team-comparison-grid">
                <div class="team-comp-col team-1-col" :style="getPerspectiveStyle(1)">
                  <div class="team-comp-header">TEAM 1</div>
                  <div class="team-comp-stat"><span class="lbl">FOB 电台</span><strong class="val font-mono">{{ team1FobCount }}</strong></div>
                  <div class="team-comp-stat"><span class="lbl">控制点</span><strong class="val font-mono">{{ team1CpCount }}</strong></div>
                  <div class="team-comp-stat"><span class="lbl">在线人数</span><strong class="val font-mono">{{ team1PlayerCount }}</strong></div>
                </div>
                <div class="team-comp-divider"></div>
                <div class="team-comp-col team-2-col" :style="getPerspectiveStyle(2)">
                  <div class="team-comp-header">TEAM 2</div>
                  <div class="team-comp-stat"><span class="lbl">FOB 电台</span><strong class="val font-mono">{{ team2FobCount }}</strong></div>
                  <div class="team-comp-stat"><span class="lbl">控制点</span><strong class="val font-mono">{{ team2CpCount }}</strong></div>
                  <div class="team-comp-stat"><span class="lbl">在线人数</span><strong class="val font-mono">{{ team2PlayerCount }}</strong></div>
                </div>
              </div>
            </div>

            <div class="overview-card">
              <div class="overview-card-title">服务器 / BZSS 核心</div>
              <div class="overview-grid">
                <div class="overview-line"><span>在场玩家</span><strong class="font-mono text-cyan">{{ serverPlayerCount }}</strong></div>
                <div class="overview-line"><span>对局阶段</span><strong>{{ matchPhase || '进行中' }}</strong></div>
                <div class="overview-line"><span>BZSS 核心</span><strong :class="bzssCoreStatusClass">{{ bzssCoreStatusLabel }}</strong></div>
                <div class="overview-line"><span>数据更新</span><strong class="font-mono">{{ bzssCoreUpdatedAtText }}</strong></div>
              </div>
            </div>

            <div class="overview-card">
              <div class="overview-card-title">快捷导航</div>
              <div class="overview-actions">
                <button type="button" class="quick-action-btn" @click="sidebarTabModel = 'units'">
                  <span>👥 查找玩家</span>
                </button>
                <button type="button" class="quick-action-btn" @click="sidebarTabModel = 'assets'">
                  <span>📡 查看战术资产</span>
                </button>
                <button type="button" class="quick-action-btn" @click="sidebarTabModel = 'feed'">
                  <span>📜 实时战报日志</span>
                </button>
                <button type="button" class="quick-action-btn" @click="sidebarTabModel = 'core'">
                  <span>⚙️ 核心状态</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Units Tab -->
        <div v-else-if="sidebarTab === 'units'" class="tab-panel-container">
          <div class="panel-sticky-header">
            <div class="sidebar-search-row">
              <div class="search-input-wrapper">
                <span class="search-icon">🔍</span>
                <input
                  v-model="sidebarSearchModel"
                  class="sidebar-search-input"
                  type="search"
                  placeholder="搜索玩家、小队、Kit..."
                />
                <button
                  v-if="sidebarSearchModel"
                  type="button"
                  class="search-clear-btn"
                  title="清空搜索"
                  @click="sidebarSearchModel = ''"
                >
                  ✕
                </button>
              </div>
              <select v-model="sidebarSortModeModel" class="map-select sort-select" title="排序规则">
                <option value="squad">小队</option>
                <option value="name">名称</option>
                <option value="health">血量</option>
                <option value="distance">距离</option>
                <option value="vehicle">载具</option>
              </select>
            </div>

            <!-- Active filters & Count badge -->
            <div class="filter-pill-row">
              <button
                type="button"
                class="filter-pill"
                :class="{ active: sidebarOnlyAliveModel }"
                @click="sidebarOnlyAliveModel = !sidebarOnlyAliveModel"
              >
                存活
              </button>
              <button
                type="button"
                class="filter-pill"
                :class="{ active: sidebarOnlyVehicleModel }"
                @click="sidebarOnlyVehicleModel = !sidebarOnlyVehicleModel"
              >
                载具
              </button>
              <button
                type="button"
                class="filter-pill"
                :class="{ active: sidebarOnlySl }"
                @click="sidebarOnlySl = !sidebarOnlySl"
              >
                仅队长 SL
              </button>
              <button
                type="button"
                class="filter-pill"
                :class="{ active: sidebarOnlyLowHp }"
                @click="sidebarOnlyLowHp = !sidebarOnlyLowHp"
              >
                低血量
              </button>
              <span class="search-count-pill font-mono">{{ filteredPlayers.length }} 人</span>
            </div>

            <!-- Team Selector -->
            <div class="sidebar-tabs">
              <button
                type="button"
                class="tab-btn"
                :class="[getPerspectiveClass(1), { active: activeTeamTab === 1 }]"
                :style="getPerspectiveStyle(1)"
                @click="activeTeamTabModel = 1"
              >
                TEAM 1 ({{ team1PlayerCount }})
              </button>
              <button
                type="button"
                class="tab-btn"
                :class="[getPerspectiveClass(2), { active: activeTeamTab === 2 }]"
                :style="getPerspectiveStyle(2)"
                @click="activeTeamTabModel = 2"
              >
                TEAM 2 ({{ team2PlayerCount }})
              </button>
            </div>

            <!-- Unit Mode Selector -->
            <div class="unit-mode-tabs">
              <button
                type="button"
                class="mode-chip"
                :class="{ active: sidebarUnitMode === 'squads' }"
                @click="sidebarUnitModeModel = 'squads'"
              >
                小队 Squads ({{ currentTeamSquads.length }})
              </button>
              <button
                type="button"
                class="mode-chip"
                :class="{ active: sidebarUnitMode === 'players' }"
                @click="sidebarUnitModeModel = 'players'"
              >
                玩家 Players ({{ filteredPlayers.length }})
              </button>
            </div>
          </div>

          <div class="sidebar-scroll panel-body-scroll custom-scrollbar">
            <!-- Squad List -->
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
                  <span class="squad-number font-mono">#{{ squad.id }}</span>
                  <span class="squad-name">{{ squad.name }}</span>
                  <span class="squad-members-count font-mono">{{ squad.playersCount }} 人</span>
                </div>
                <div class="squad-card-meta">
                  <span class="sl-name">SL: {{ squad.squadLeaderName || '未指定队长' }}</span>
                  <div class="squad-health-summary">
                    <span class="health-label font-mono">均血</span>
                    <div class="mini-bar-track">
                      <div
                        class="mini-bar-fill"
                        :style="{ width: `${squad.avgHealth}%`, backgroundColor: squad.avgHealth < 50 ? '#ef4444' : squad.avgHealth < 75 ? '#eab308' : '#10b981' }"
                      ></div>
                    </div>
                    <span class="health-num font-mono">{{ squad.avgHealth }}%</span>
                  </div>
                </div>
              </button>
              <div v-if="!currentTeamSquads.length" class="empty-state">暂无小队数据</div>
            </div>

            <!-- Player List -->
            <div v-else class="sidebar-list">
              <button
                v-for="player in filteredPlayers"
                :key="getPlayerKey(player)"
                type="button"
                class="sidebar-player-card-row"
                :class="[
                  `team-${normalizeTeam(player.teamId)}`,
                  getPerspectiveClass(player.teamId),
                  { 'is-focused': markerFocusKey === getPlayerKey(player) }
                ]"
                :style="getPerspectiveStyle(player.teamId)"
                :title="player.linkReason"
                @click="onPlayerClick(player)"
              >
                <div class="player-card-header">
                  <span class="player-name">
                    {{ getPlayerLabel(player) }}
                    <span v-if="isSquadLeader(player)" class="sl-badge-pill">SL</span>
                  </span>
                  <span class="player-squad-tag font-mono">S{{ normalizeSquad(player.squadId) }}</span>
                  <span class="player-link-pill font-mono" :data-confidence="player.linkConfidence">{{ linkConfidenceLabel(player.linkConfidence) }}</span>
                </div>
                <div class="player-card-body">
                  <div class="player-health-bar-container">
                    <div
                      class="player-health-bar-fill"
                      :style="{ width: `${getPlayerHealth(player) ?? 0}%`, backgroundColor: getPlayerHealthColor(player) }"
                    ></div>
                  </div>
                  <div class="player-status-row">
                    <span class="player-hp-value font-mono">{{ getPlayerHealth(player) ?? '0' }}% HP</span>
                    <span v-if="player.soldierInfo?.soldierClass" class="player-kit">{{ player.soldierInfo.soldierClass }}</span>
                    <span v-if="player.vehicleInfo?.vehicleType && player.vehicleInfo.vehicleType !== 'None'" class="player-vehicle-badge">
                      <span class="vehicle-icon-mini">⚡</span>
                      {{ player.vehicleInfo.vehicleType }}
                    </span>
                  </div>
                </div>
              </button>
              <div v-if="!filteredPlayers.length" class="empty-state">未找到匹配玩家</div>
            </div>
          </div>
        </div>

        <!-- Assets Tab -->
        <div v-else-if="sidebarTab === 'assets'" class="tab-panel-container">
          <div class="panel-sticky-header">
            <!-- Summary Header -->
            <div class="asset-summary-bar">
              <div class="asset-summary-item">
                <span class="lbl">主基地</span>
                <strong class="val font-mono">{{ mainZoneMarkers.length }}</strong>
              </div>
              <div class="asset-summary-item">
                <span class="lbl">占领点</span>
                <strong class="val font-mono">{{ captureZoneMarkers.length }}</strong>
              </div>
              <div class="asset-summary-item">
                <span class="lbl">FOB 电台</span>
                <strong class="val font-mono">{{ fobMarkers.length }}</strong>
              </div>
              <div class="asset-summary-item">
                <span class="lbl">载具类型</span>
                <strong class="val font-mono">{{ vehicleGroups.length }}</strong>
              </div>
            </div>
          </div>

          <div class="sidebar-scroll panel-body-scroll custom-scrollbar">
            <!-- Main Bases -->
            <div class="asset-group">
              <div class="asset-group-title">主基地 (Main Bases)</div>
              <button
                v-for="zone in mainZoneMarkers"
                :key="zone.id"
                type="button"
                class="asset-row asset-row--stacked"
                @click="$emit('focus-zone', zone)"
              >
                <div class="asset-row-title">
                  <span class="bzss-team-indicator" :class="`team-ind-${zone.teamId ?? 0}`">T{{ zone.teamId ?? '--' }}</span>
                  <span class="asset-name-text">{{ zone.name }}</span>
                </div>
                <div class="asset-meta font-mono">{{ zone.mapX.toFixed(1) }}%, {{ zone.mapY.toFixed(1) }}%</div>
              </button>
              <div v-if="!mainZoneMarkers.length" class="empty-state">暂无主基地数据</div>
            </div>

            <!-- Capture Points -->
            <div class="asset-group">
              <div class="asset-group-title">占领点 (Capture Points)</div>
              <button
                v-for="zone in captureZoneMarkers"
                :key="zone.id"
                type="button"
                class="asset-row asset-row--stacked"
                @click="$emit('focus-zone', zone)"
              >
                <div class="asset-row-title">
                  <span class="bzss-badge bzss-badge--ok">CP</span>
                  <span class="asset-name-text">{{ zone.name }}</span>
                  <span v-if="zone.isLocked" class="bzss-badge bzss-badge--warn">LOCKED</span>
                </div>
                <div class="asset-bars">
                  <div class="asset-bar-line">
                    <span>进度</span>
                    <div class="mini-bar-track">
                      <div class="mini-bar-fill bzss-fill-hp" :style="{ width: `${Math.max(0, Math.min(100, Math.round(zone.capturePercent ?? 0)))}%` }"></div>
                    </div>
                    <span class="font-mono">{{ Math.round(zone.capturePercent ?? 0) }}%</span>
                  </div>
                  <div v-if="zone.captureDirection != null" class="asset-meta font-mono">方向 {{ zone.captureDirection }}</div>
                </div>
              </button>
              <div v-if="!captureZoneMarkers.length" class="empty-state">暂无占领点数据</div>
            </div>

            <!-- FOB Radios -->
            <div class="asset-group">
              <div class="asset-group-title">FOB 电台 (Radios)</div>
              <button
                v-for="fob in fobMarkers"
                :key="`${fob.teamId}-${fob.name}-${fob.mapX}-${fob.mapY}`"
                type="button"
                class="asset-row asset-row--stacked"
                :class="{ 'is-fob-bleeding': fob.isBleeding }"
                @click="$emit('focus-fob', fob)"
              >
                <div class="asset-row-title">
                  <span class="bzss-team-indicator" :class="`team-ind-${fob.teamId}`">T{{ fob.teamId }}</span>
                  <span class="asset-name-text">{{ fob.name || 'FOB Radio' }}</span>
                  <span v-if="fob.isBleeding" class="bzss-badge bzss-badge--danger pulse-badge">! 流血中</span>
                </div>
                <div class="asset-bars">
                  <div class="asset-bar-line">
                    <span>耐久</span>
                    <div class="mini-bar-track">
                      <div class="mini-bar-fill bzss-fill-hp" :style="{ width: `${Math.round((fob.health ?? 0) * 100)}%` }"></div>
                    </div>
                    <span class="font-mono">{{ Math.round((fob.health ?? 0) * 100) }}%</span>
                  </div>
                  <div class="asset-bar-line">
                    <span>弹药</span>
                    <div class="mini-bar-track">
                      <div class="mini-bar-fill bzss-fill-ammo" :style="{ width: `${Math.min(100, Math.round((fob.ammo ?? 0) / 100))}%` }"></div>
                    </div>
                    <span class="font-mono">{{ Math.round(fob.ammo ?? 0) }}</span>
                  </div>
                  <div class="asset-bar-line">
                    <span>建材</span>
                    <div class="mini-bar-track">
                      <div class="mini-bar-fill bzss-fill-const" :style="{ width: `${Math.min(100, Math.round((fob.construction ?? 0) / 20))}%` }"></div>
                    </div>
                    <span class="font-mono">{{ Math.round(fob.construction ?? 0) }}</span>
                  </div>
                </div>
              </button>
              <div v-if="!fobMarkers.length" class="empty-state">暂无 FOB 电台数据</div>
            </div>

            <!-- Vehicles -->
            <div class="asset-group">
              <div class="asset-group-title">载具分类 (Vehicles)</div>
              <button
                v-for="group in vehicleGroups"
                :key="`${group.teamId}-${group.vehicleType}`"
                type="button"
                class="asset-row"
                @click="$emit('focus-vehicle', group)"
              >
                <div class="asset-row-title">
                  <span class="bzss-team-indicator" :class="`team-ind-${group.teamId}`">T{{ group.teamId }}</span>
                  <span>{{ group.vehicleType }}</span>
                </div>
                <span class="asset-meta font-mono">x{{ group.count }}</span>
              </button>
              <div v-if="!vehicleGroups.length" class="empty-state">暂无活跃载具</div>
            </div>
          </div>
        </div>

        <!-- Feed / Combat Log Tab [NEW] -->
        <div v-else-if="sidebarTab === 'feed'" class="tab-panel-container">
          <div class="panel-sticky-header">
            <div class="feed-filter-bar">
              <button
                type="button"
                class="feed-chip"
                :class="{ active: feedFilter === 'all' }"
                @click="feedFilter = 'all'"
              >
                全部
              </button>
              <button
                type="button"
                class="feed-chip"
                :class="{ active: feedFilter === 'kill' }"
                @click="feedFilter = 'kill'"
              >
                击杀
              </button>
              <button
                type="button"
                class="feed-chip"
                :class="{ active: feedFilter === 'revive' }"
                @click="feedFilter = 'revive'"
              >
                救起
              </button>
              <button
                type="button"
                class="feed-chip"
                :class="{ active: feedFilter === 'capture' }"
                @click="feedFilter = 'capture'"
              >
                目标/FOB
              </button>
            </div>
          </div>

          <div class="sidebar-scroll panel-body-scroll custom-scrollbar">
            <div class="combat-log-console">
              <div
                v-for="(log, idx) in filteredCombatLogs"
                :key="`log-${idx}`"
                class="console-log-line"
                :class="`log-type-${log.type}`"
              >
                <span class="log-time font-mono">{{ log.time }}</span>
                <span class="log-type-tag font-mono" :class="`tag-${log.type}`">
                  {{ getLogTypeTag(log.type) }}
                </span>
                <span class="log-text">{{ log.text }}</span>
              </div>
              <div v-if="!filteredCombatLogs.length" class="empty-state">暂无实时战报日志</div>
            </div>
          </div>
        </div>

        <!-- Core Tab -->
        <div v-else-if="sidebarTab === 'core'" class="tab-panel-container">
          <div class="sidebar-scroll panel-body-scroll custom-scrollbar">
            <div class="bzss-info-card">
              <div class="bzss-card-title">
                <span class="bzss-status-dot" :class="bzssCoreStatusClass"></span>
                核心通信状态
              </div>
              <div class="bzss-stats-grid">
                <div class="bzss-stat-row"><span class="bzss-stat-label">运行状态</span><span class="bzss-stat-value" :class="bzssCoreStatusClass">{{ bzssCoreStatusLabel }}</span></div>
                <div class="bzss-stat-row"><span class="bzss-stat-label">数据版本</span><span class="bzss-stat-value font-mono">Rev {{ snapshot?.state?.revision ?? '--' }}</span></div>
                <div class="bzss-stat-row"><span class="bzss-stat-label">最近刷新</span><span class="bzss-stat-value font-mono">{{ bzssCoreUpdatedAtText }}</span></div>
                <div class="bzss-stat-row"><span class="bzss-stat-label">标记就绪</span><span class="bzss-stat-value"><span v-if="snapshot?.state?.markerSeen" class="bzss-badge bzss-badge--ok">已锁定</span><span v-else class="bzss-badge bzss-badge--warn">未锁定</span></span></div>
              </div>
            </div>

            <div class="bzss-info-card">
              <div class="bzss-card-title">在场玩家统计</div>
              <div class="bzss-stats-grid">
                <div class="bzss-stat-row"><span class="bzss-stat-label">运行时玩家</span><span class="bzss-stat-value text-cyan font-mono">{{ snapshot?.state?.runtimePlayerCount ?? 0 }}</span></div>
                <div class="bzss-stat-row"><span class="bzss-stat-label">积分板计数</span><span class="bzss-stat-value text-yellow font-mono">{{ snapshot?.state?.scoreboardPlayerCount ?? 0 }}</span></div>
                <div class="bzss-stat-row"><span class="bzss-stat-label">全图已定位</span><span class="bzss-stat-value text-cyan font-mono">{{ positionedPlayerCount }}</span></div>
                <div class="bzss-stat-row"><span class="bzss-stat-label">存活生命体</span><span class="bzss-stat-value text-green font-mono">{{ bzssCoreAliveCount }}</span></div>
              </div>
            </div>

            <div v-if="rawFields?.length" class="bzss-info-card">
              <div class="bzss-card-title">原始结构字段</div>
              <div class="bzss-raw-fields">
                <code v-for="(field, idx) in rawFields" :key="`rf-${idx}`" class="bzss-raw-field-tag font-mono">{{ field }}</code>
              </div>
            </div>

            <div v-if="lastError" class="bzss-info-card bzss-info-card--error">
              <div class="bzss-card-title">异常警示</div>
              <div class="bzss-error-text font-mono">{{ lastError }}</div>
            </div>
          </div>
        </div>

      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { BzssCoreCaptureZoneInfo, BzssCoreFobInfo, BzssCorePlayerInfoResponse } from "../../app/bzssCoreApi";
import type { TacticalLinkedPlayer } from "../../utils/tactical-map-linker";

type SidebarMode = "expanded" | "compact" | "hidden";
type SidebarTab = "overview" | "units" | "assets" | "feed" | "core";
type SidebarUnitMode = "squads" | "players";
type SidebarSortMode = "name" | "squad" | "health" | "distance" | "vehicle";
type ViewerPerspectiveMode = "auto" | "team1" | "team2";
type FeedFilterType = "all" | "kill" | "revive" | "capture" | "system";

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
  id: string;
  name: string;
  teamId: number | null;
  mapX: number;
  mapY: number;
  gameX?: number | null;
  gameY?: number | null;
  capturePercent?: number | null;
  captureDirection?: number | null;
  isLocked?: boolean | null;
  raw?: string;
}

interface TacticalMainZoneMarker {
  id: string;
  name: string;
  teamId: number | null;
  mapX: number;
  mapY: number;
  raw?: string;
}

interface TacticalFobMarker {
  id: string;
  name: string;
  teamId: number | null;
  health?: number | null;
  isBleeding?: boolean | null;
  ammo?: number | null;
  construction?: number | null;
  mapX: number;
  mapY: number;
  gameX?: number | null;
  gameY?: number | null;
  exclusionRadius?: number | null;
  constructionRadius?: number | null;
  radiusPx?: number | null;
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
  showPressureZones: boolean;
  showPressureHard: boolean;
  showPressureSoft: boolean;
  showPressureCombat: boolean;
  showPressureDiagnostics: boolean;
  showPressureConnections: boolean;
  measureMode: boolean;
  selectedMapKey: string;
  markerScale: number;
  viewerPerspectiveMode: ViewerPerspectiveMode;
  detectedMapName: string;
  mapSizeText: string;
  canManagePressureSettings: boolean;
  mapOptions: TacticalMapConfigOption[];
  serverPlayerCount: number;
  serverMapName: string;
  statusText: string;
  matchPhase: string;
  tickets: { team1: number; team2: number };
  perspectiveSummaryText: string;
  snapshot: BzssCorePlayerInfoResponse | null;
  currentTeamSquads: TacticalTeamSquad[];
  filteredTeamPlayers: TacticalLinkedPlayer[];
  mainZoneMarkers: TacticalMainZoneMarker[];
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
  getPlayerKey: (player: TacticalLinkedPlayer | null | undefined) => string;
  getPlayerLabel: (player: TacticalLinkedPlayer | null | undefined) => string;
  getPlayerHealth: (player: TacticalLinkedPlayer | null | undefined) => number | null;
  normalizeTeam: (teamId: number | null | undefined) => number;
  normalizeSquad: (squadId: number | null | undefined) => number;
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
  (e: "update:show-pressure-zones", value: boolean): void;
  (e: "update:show-pressure-hard", value: boolean): void;
  (e: "update:show-pressure-soft", value: boolean): void;
  (e: "update:show-pressure-combat", value: boolean): void;
  (e: "update:show-pressure-diagnostics", value: boolean): void;
  (e: "update:show-pressure-connections", value: boolean): void;
  (e: "update:measure-mode", value: boolean): void;
  (e: "update:selected-map-key", value: string): void;
  (e: "update:marker-scale", value: number): void;
  (e: "update:viewer-perspective-mode", value: ViewerPerspectiveMode): void;
  (e: "focus-player", player: TacticalLinkedPlayer): void;
  (e: "focus-squad", payload: { teamId: number; squadId: number }): void;
  (e: "focus-fob", payload: TacticalFobMarker): void;
  (e: "focus-zone", payload: TacticalCaptureZoneMarker): void;
  (e: "focus-vehicle", payload: TacticalVehicleGroup): void;
  (e: "open-player", player: TacticalLinkedPlayer): void;
  (e: "open-pressure-settings"): void;
}>();

// Local UI state
const isCollapsed = ref(false);
const layersOpen = ref(true);
const sidebarOnlySl = ref(false);
const sidebarOnlyLowHp = ref(false);
const feedFilter = ref<FeedFilterType>("all");

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
const showPressureZonesModel = computed({
  get: () => props.showPressureZones,
  set: (value: boolean) => emit("update:show-pressure-zones", value),
});
const showPressureHardModel = computed({
  get: () => props.showPressureHard,
  set: (value: boolean) => emit("update:show-pressure-hard", value),
});
const showPressureSoftModel = computed({
  get: () => props.showPressureSoft,
  set: (value: boolean) => emit("update:show-pressure-soft", value),
});
const showPressureCombatModel = computed({
  get: () => props.showPressureCombat,
  set: (value: boolean) => emit("update:show-pressure-combat", value),
});
const showPressureDiagnosticsModel = computed({
  get: () => props.showPressureDiagnostics,
  set: (value: boolean) => emit("update:show-pressure-diagnostics", value),
});
const showPressureConnectionsModel = computed({
  get: () => props.showPressureConnections,
  set: (value: boolean) => emit("update:show-pressure-connections", value),
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

const isLowTicket = computed(() => {
  const t1 = props.tickets?.team1 ?? 100;
  const t2 = props.tickets?.team2 ?? 100;
  return t1 < 50 || t2 < 50;
});

const activeLayerCount = computed(() => {
  return [
    showGridModel.value,
    showPlayerNamesModel.value,
    showPlayerCoordsModel.value,
    showCaptureZonesModel.value,
    showFobsModel.value,
    showPressureZonesModel.value,
    measureModeModel.value,
  ].filter(Boolean).length;
});

const team1PlayerCount = computed(() => {
  return props.filteredTeamPlayers.filter(p => props.normalizeTeam(p.teamId) === 1).length;
});
const team2PlayerCount = computed(() => {
  return props.filteredTeamPlayers.filter(p => props.normalizeTeam(p.teamId) === 2).length;
});
const team1FobCount = computed(() => {
  return props.fobMarkers.filter(f => props.normalizeTeam(f.teamId) === 1).length;
});
const team2FobCount = computed(() => {
  return props.fobMarkers.filter(f => props.normalizeTeam(f.teamId) === 2).length;
});
const team1CpCount = computed(() => {
  return props.captureZoneMarkers.filter(z => props.normalizeTeam(z.teamId) === 1).length;
});
const team2CpCount = computed(() => {
  return props.captureZoneMarkers.filter(z => props.normalizeTeam(z.teamId) === 2).length;
});

const filteredCombatLogs = computed(() => {
  if (!props.combatLogs) return [];
  if (feedFilter.value === "all") return props.combatLogs;
  return props.combatLogs.filter(log => log.type === feedFilter.value);
});

function applyLayerPreset(mode: "all" | "compact" | "minimal") {
  if (mode === "all") {
    showGridModel.value = true;
    showPlayerNamesModel.value = true;
    showPlayerCoordsModel.value = true;
    showCaptureZonesModel.value = true;
    showFobsModel.value = true;
    showPressureZonesModel.value = true;
  } else if (mode === "compact") {
    showGridModel.value = false;
    showPlayerNamesModel.value = true;
    showPlayerCoordsModel.value = false;
    showCaptureZonesModel.value = true;
    showFobsModel.value = true;
    showPressureZonesModel.value = false;
  } else if (mode === "minimal") {
    showGridModel.value = false;
    showPlayerNamesModel.value = true;
    showPlayerCoordsModel.value = false;
    showCaptureZonesModel.value = false;
    showFobsModel.value = false;
    showPressureZonesModel.value = false;
  }
}

function getLogTypeTag(type: string) {
  if (type === "kill") return "击杀";
  if (type === "revive") return "救起";
  if (type === "capture") return "目标";
  return "系统";
}

function getTicketBarWidth(teamId: number) {
  const t1 = props.tickets?.team1 ?? 0;
  const t2 = props.tickets?.team2 ?? 0;
  const total = t1 + t2;
  if (total <= 0) return '50%';
  const percent = teamId === 1 ? (t1 / total) * 100 : (t2 / total) * 100;
  return `${percent}%`;
}

function isSquadLeader(player: TacticalLinkedPlayer) {
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

function getPlayerHealthColor(player: TacticalLinkedPlayer) {
  const hp = props.getPlayerHealth(player);
  if (hp == null) return 'var(--perspective-primary, #00e5ff)';
  if (hp <= 0) return '#ef4444';
  if (hp < 40) return '#eab308';
  return '#10b981';
}

function onPlayerClick(player: TacticalLinkedPlayer) {
  emit("focus-player", player);
  emit("open-player", player);
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function getPlayerPosition(player: TacticalLinkedPlayer) {
  return player.soldierInfo?.position ?? player.position ?? null;
}

function getSquadForPlayer(player: TacticalLinkedPlayer) {
  return props.currentTeamSquads.find((squad) => squad.id === props.normalizeSquad(player.squadId));
}

const filteredPlayers = computed(() => {
  const teamId = props.activeTeamTab;
  const query = normalizeText(props.sidebarSearch);
  const list = props.filteredTeamPlayers.filter((player) => {
    if (props.normalizeTeam(player.teamId) !== teamId) return false;
    const hp = props.getPlayerHealth(player) ?? 0;
    if (props.sidebarOnlyAlive && hp <= 0) return false;
    if (props.sidebarOnlyVehicle && !player.vehicleInfo?.vehicleType) return false;
    if (sidebarOnlySl.value && !isSquadLeader(player)) return false;
    if (sidebarOnlyLowHp.value && (hp <= 0 || hp >= 50)) return false;

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

function getPlayerKey(player: TacticalLinkedPlayer | null | undefined) {
  return props.getPlayerKey(player);
}
function getPlayerLabel(player: TacticalLinkedPlayer | null | undefined) {
  return props.getPlayerLabel(player);
}
function getPlayerHealth(player: TacticalLinkedPlayer | null | undefined) {
  return props.getPlayerHealth(player);
}
function normalizeTeam(teamId: number | null | undefined) {
  return props.normalizeTeam(teamId);
}
function normalizeSquad(squadId: number | null | undefined) {
  return props.normalizeSquad(squadId);
}
function getPerspectiveClass(teamId: number | null | undefined) {
  return props.getPerspectiveClass(teamId);
}
function getPerspectiveStyle(teamId: number | null | undefined) {
  return props.getPerspectiveStyle(teamId);
}

function linkConfidenceLabel(confidence: TacticalLinkedPlayer["linkConfidence"]) {
  if (confidence === "exact") return "精确";
  if (confidence === "strong") return "强";
  if (confidence === "weak") return "弱";
  return "未关联";
}
</script>

<style scoped>
/* ─── Base Layout ──────────────────────────────────── */
.tactical-sidebar {
  position: relative;
  height: 100%;
  width: 360px;
  min-width: 360px;
  display: flex;
  flex-shrink: 0;
  background: radial-gradient(ellipse at 100% 0%, rgba(10, 18, 42, 0.97), rgba(4, 7, 18, 0.99));
  border-left: 1px solid rgba(0, 240, 255, 0.18);
  box-shadow: -12px 0 50px rgba(0, 0, 0, 0.9), inset 1px 0 0 rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(20px) saturate(180%);
  z-index: 30;
  transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.tactical-sidebar.is-collapsed {
  width: 32px;
  min-width: 32px;
  background: rgba(4, 7, 18, 0.85);
  border-left-color: rgba(0, 240, 255, 0.15);
  box-shadow: none;
  backdrop-filter: blur(12px);
}

/* ─── Toggle Handle Tab ───────────────────────────── */
.sidebar-toggle-tab {
  position: absolute;
  left: -24px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 84px;
  border: 1px solid rgba(0, 240, 255, 0.22);
  border-right: none;
  border-radius: 8px 0 0 8px;
  background: rgba(6, 11, 28, 0.96);
  color: rgba(0, 240, 255, 0.8);
  cursor: pointer;
  z-index: 35;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.2s ease;
  box-shadow: -4px 0 12px rgba(0, 0, 0, 0.5);
}

.sidebar-toggle-tab:hover {
  background: rgba(0, 240, 255, 0.16);
  color: #ffffff;
  box-shadow: -6px 0 18px rgba(0, 240, 255, 0.3);
  border-color: rgba(0, 240, 255, 0.4);
}

.tab-arrow {
  font-size: 10px;
  line-height: 1;
}

.vertical-tab-text {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-size: 9px;
  letter-spacing: 1.5px;
  opacity: 0.8;
  text-transform: uppercase;
}

/* ─── Content Wrapper ─────────────────────────────── */
.sidebar-content-wrapper {
  display: flex;
  flex-direction: column;
  width: 360px;
  min-width: 360px;
  height: 100%;
  overflow: hidden;
  opacity: 1;
  visibility: visible;
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.sidebar-content-wrapper.is-collapsed {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateX(12px);
}

/* ─── Header ──────────────────────────────────────── */
.sidebar-header {
  padding: 12px 14px 10px;
  background: linear-gradient(180deg, rgba(0, 240, 255, 0.05) 0%, transparent 100%);
  border-bottom: 1px solid rgba(0, 240, 255, 0.12);
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
}

.header-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
  background-color: #10b981;
  box-shadow: 0 0 10px #10b981, 0 0 20px rgba(16, 185, 129, 0.4);
  animation: led-glow 2s infinite alternate;
}

@keyframes led-glow {
  from { filter: brightness(0.8); box-shadow: 0 0 6px #10b981; }
  to   { filter: brightness(1.3); box-shadow: 0 0 14px #10b981, 0 0 28px rgba(16, 185, 129, 0.5); }
}

.header-text {
  flex: 1;
  min-width: 0;
}

.sidebar-title {
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 2px;
  color: #f8fafc;
  text-transform: uppercase;
}

.sidebar-subtitle {
  font-size: 10px;
  color: rgba(0, 240, 255, 0.65);
  margin-top: 1px;
}

.header-live-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(0, 240, 255, 0.1);
  border: 1px solid rgba(0, 240, 255, 0.25);
}

.live-pulse-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #00e5ff;
  box-shadow: 0 0 8px #00e5ff;
  animation: stat-pulse 1.2s infinite alternate;
}

.live-label {
  font-size: 9px;
  font-weight: 700;
  color: #00e5ff;
  letter-spacing: 1px;
}

/* Quick stats row */
.header-quick-stats {
  display: flex;
  align-items: center;
  gap: 0;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 6px;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.qs-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
}

.qs-val {
  font-size: 13px;
  font-weight: 800;
  line-height: 1.2;
}

.qs-lbl {
  font-size: 9px;
  color: rgba(148, 163, 184, 0.7);
  margin-top: 1px;
}

.qs-sep {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.08);
}

/* Ticket bar */
.header-ticket-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: rgba(0, 0, 0, 0.3);
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid rgba(0, 240, 255, 0.1);
  transition: border-color 0.3s ease;
}

.header-ticket-bar.is-low-ticket {
  border-color: rgba(239, 68, 68, 0.4);
  box-shadow: 0 0 12px rgba(239, 68, 68, 0.15);
}

.ticket-meta-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 700;
}

.ticket-vs-badge {
  font-size: 9px;
  color: rgba(148, 163, 184, 0.6);
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.05);
}

.ticket-track {
  height: 6px;
  border-radius: 3px;
  background: rgba(15, 23, 42, 0.8);
  overflow: hidden;
  display: flex;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.ticket-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.ticket-fill-left {
  border-radius: 3px 0 0 3px;
}

.ticket-fill-right {
  border-radius: 0 3px 3px 0;
  margin-left: auto;
}

/* ─── Layer Section ──────────────────────────────── */
.sidebar-section {
  border-bottom: 1px solid rgba(0, 240, 255, 0.12);
  flex-shrink: 0;
}

.section-title-bar {
  padding: 8px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
  background: rgba(0, 0, 0, 0.2);
  transition: background 0.15s ease;
}

.section-title-bar:hover {
  background: rgba(0, 240, 255, 0.05);
}

.title-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.layers-count-badge {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(0, 240, 255, 0.12);
  color: #00e5ff;
  border: 1px solid rgba(0, 240, 255, 0.25);
  margin-left: 4px;
}

.glowing-square {
  width: 6px;
  height: 6px;
  border-radius: 1px;
}

.glowing-square.blue {
  background: #00f0ff;
  box-shadow: 0 0 8px #00f0ff;
}

.section-title-bar h3 {
  font-size: 11px;
  font-weight: 700;
  color: #e2e8f0;
  margin: 0;
  letter-spacing: 0.5px;
}

.section-collapse-btn {
  background: transparent;
  border: none;
  color: rgba(148, 163, 184, 0.7);
  font-size: 9px;
  cursor: pointer;
  padding: 2px 4px;
}

.layers-content {
  padding: 8px 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(0, 0, 0, 0.2);
  max-height: 240px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* Presets bar */
.layer-preset-bar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.preset-label {
  font-size: 10px;
  color: rgba(148, 163, 184, 0.7);
}

.preset-btn {
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid rgba(0, 240, 255, 0.2);
  background: rgba(0, 240, 255, 0.06);
  color: #00e5ff;
  font-size: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.preset-btn:hover {
  background: rgba(0, 240, 255, 0.18);
  border-color: rgba(0, 240, 255, 0.4);
}

/* Switcher Chips Grid */
.layers-chips-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.layer-chip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 5px 4px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(148, 163, 184, 0.8);
  font-size: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.layer-chip:hover {
  border-color: rgba(0, 240, 255, 0.3);
  color: #f8fafc;
}

.layer-chip.active {
  border-color: rgba(0, 240, 255, 0.5);
  background: rgba(0, 240, 255, 0.12);
  color: #00f0ff;
  box-shadow: 0 0 10px rgba(0, 240, 255, 0.15);
}

.chip-icon {
  font-size: 10px;
}

/* Sub-options for pressure zone */
.pressure-layer-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
  padding: 8px;
  border: 1px solid rgba(45, 212, 191, 0.2);
  border-radius: 6px;
  background: rgba(13, 148, 136, 0.08);
}

.pressure-sub-option {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #9db5c8;
  font: 10px/1.2 monospace;
  cursor: pointer;
}

.pressure-sub-option input {
  accent-color: #2dd4bf;
}

.pressure-settings-button {
  grid-column: 1 / -1;
  min-height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid rgba(45, 212, 191, .3);
  border-radius: 5px;
  background: rgba(13, 148, 136, .16);
  color: #99f6e4;
  cursor: pointer;
  font-size: 10px;
}

.pressure-settings-button:hover {
  border-color: rgba(94, 234, 212, .65);
  background: rgba(13, 148, 136, .26);
}

/* Option Rows */
.option-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
}

.option-row--col {
  flex-direction: column;
  align-items: stretch;
  gap: 5px;
}

.option-label {
  color: rgba(148, 163, 184, 0.8);
  font-size: 10px;
}

.map-select {
  flex: 1;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(0, 240, 255, 0.2);
  border-radius: 5px;
  color: #e2e8f0;
  padding: 4px 6px;
  font-size: 11px;
  outline: none;
}

.map-select:focus {
  border-color: #00e5ff;
}

.map-size-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-radius: 5px;
  background: rgba(0, 240, 255, 0.05);
  color: #7f98aa;
  font-size: 10px;
}

.map-size-summary strong {
  color: #bfeaf0;
}

.perspective-switch {
  display: flex;
  gap: 4px;
}

.perspective-btn {
  flex: 1;
  padding: 4px 0;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(148, 163, 184, 0.8);
  font-size: 10px;
  font-family: monospace;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}

.perspective-btn:hover {
  border-color: rgba(0, 240, 255, 0.3);
  color: #ffffff;
}

.perspective-btn.active {
  border-color: rgba(0, 240, 255, 0.6);
  background: rgba(0, 240, 255, 0.15);
  color: #00f0ff;
}

.perspective-summary {
  font-size: 10px;
  color: rgba(148, 163, 184, 0.7);
  padding: 2px 4px;
}

.scale-slider {
  flex: 1;
  accent-color: #00e5ff;
}

.scale-val {
  font-size: 10px;
  color: #00e5ff;
  min-width: 32px;
  text-align: right;
}

/* ─── Tab Directory ───────────────────────────────── */
.sidebar-tabs-directory {
  display: flex;
  background: rgba(0, 0, 0, 0.4);
  border-bottom: 1px solid rgba(0, 240, 255, 0.15);
  flex-shrink: 0;
}

.directory-tab-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 4px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: rgba(148, 163, 184, 0.7);
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
  position: relative;
}

.directory-tab-btn:hover {
  color: #f8fafc;
  background: rgba(255, 255, 255, 0.02);
}

.directory-tab-btn.active {
  color: #00f0ff;
  border-bottom-color: #00f0ff;
  background: rgba(0, 240, 255, 0.08);
}

.tab-icon {
  font-size: 11px;
}

.tab-name {
  font-size: 10px;
  font-weight: 700;
}

.feed-count-badge {
  font-size: 9px;
  padding: 0 4px;
  border-radius: 999px;
  background: rgba(0, 229, 255, 0.2);
  color: #00f0ff;
  border: 1px solid rgba(0, 229, 255, 0.3);
}

/* ─── Tab Content Section & Sticky Panels ───────── */
.sidebar-tab-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tab-panel-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.panel-sticky-header {
  padding: 10px 12px 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: rgba(6, 11, 26, 0.96);
  border-bottom: 1px solid rgba(0, 240, 255, 0.1);
  flex-shrink: 0;
  backdrop-filter: blur(12px);
  z-index: 5;
}

.panel-body-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  -webkit-overflow-scrolling: touch;
}

.sidebar-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  -webkit-overflow-scrolling: touch;
}

/* Custom Scrollbars */
.custom-scrollbar::-webkit-scrollbar,
.sidebar-scroll::-webkit-scrollbar {
  width: 5px;
}

.custom-scrollbar::-webkit-scrollbar-track,
.sidebar-scroll::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.25);
}

.custom-scrollbar::-webkit-scrollbar-thumb,
.sidebar-scroll::-webkit-scrollbar-thumb {
  background: rgba(0, 240, 255, 0.25);
  border-radius: 3px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover,
.sidebar-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 240, 255, 0.55);
}

/* ─── Overview Tab ────────────────────────────────── */
.overview-card {
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(0, 240, 255, 0.12);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.overview-card-title {
  font-size: 11px;
  font-weight: 700;
  color: rgba(248, 250, 252, 0.9);
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding-bottom: 6px;
}

.team-comparison-grid {
  display: flex;
  align-items: stretch;
  gap: 8px;
  padding-top: 2px;
}

.team-comp-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.team-comp-header {
  font-size: 10px;
  font-weight: 800;
  margin-bottom: 2px;
}

.team-comp-stat {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
}

.team-comp-stat .lbl {
  color: rgba(148, 163, 184, 0.7);
}

.team-comp-stat .val {
  color: #e2e8f0;
}

.team-comp-divider {
  width: 1px;
  background: rgba(255, 255, 255, 0.08);
}

.overview-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.overview-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
}

.overview-line span {
  color: rgba(148, 163, 184, 0.8);
}

.overview-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.quick-action-btn {
  padding: 7px 8px;
  border-radius: 6px;
  border: 1px solid rgba(0, 240, 255, 0.2);
  background: rgba(0, 240, 255, 0.06);
  color: #00e5ff;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: center;
}

.quick-action-btn:hover {
  background: rgba(0, 240, 255, 0.16);
  border-color: rgba(0, 240, 255, 0.4);
  transform: translateY(-1px);
}

/* ─── Units Tab ───────────────────────────────────── */
.sidebar-search-row {
  display: flex;
  gap: 6px;
}

.search-input-wrapper {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 8px;
  font-size: 10px;
  opacity: 0.6;
  pointer-events: none;
}

.sidebar-search-input {
  width: 100%;
  padding: 5px 24px 5px 24px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(0, 240, 255, 0.2);
  color: #e2e8f0;
  font-size: 11px;
  outline: none;
}

.sidebar-search-input:focus {
  border-color: #00e5ff;
  box-shadow: 0 0 10px rgba(0, 229, 255, 0.15);
}

.search-clear-btn {
  position: absolute;
  right: 6px;
  background: transparent;
  border: none;
  color: rgba(148, 163, 184, 0.8);
  font-size: 10px;
  cursor: pointer;
  padding: 2px 4px;
}

.search-clear-btn:hover {
  color: #ef4444;
}

.sort-select {
  width: 72px;
}

.filter-pill-row {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.filter-pill {
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(148, 163, 184, 0.8);
  font-size: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.filter-pill:hover {
  border-color: rgba(0, 240, 255, 0.3);
  color: #f8fafc;
}

.filter-pill.active {
  border-color: rgba(0, 240, 255, 0.5);
  background: rgba(0, 240, 255, 0.15);
  color: #00f0ff;
}

.search-count-pill {
  margin-left: auto;
  font-size: 10px;
  color: rgba(148, 163, 184, 0.6);
}

.sidebar-tabs {
  display: flex;
  gap: 6px;
}

.tab-btn {
  flex: 1;
  padding: 6px 0;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.3);
  color: rgba(148, 163, 184, 0.8);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tab-btn.active {
  border-color: rgba(0, 240, 255, 0.5);
  background: rgba(0, 240, 255, 0.12);
  color: #00f0ff;
}

.unit-mode-tabs {
  display: flex;
  gap: 4px;
  background: rgba(0, 0, 0, 0.25);
  padding: 3px;
  border-radius: 6px;
}

.mode-chip {
  flex: 1;
  padding: 4px 0;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: rgba(148, 163, 184, 0.7);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mode-chip.active {
  background: rgba(255, 255, 255, 0.08);
  color: #f8fafc;
}

.sidebar-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Squad Card */
.sidebar-squad-card {
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
}

.sidebar-squad-card:hover {
  border-color: rgba(0, 240, 255, 0.35);
  background: rgba(15, 23, 42, 0.9);
}

.sidebar-squad-card.is-focused {
  border-color: #00f0ff;
  box-shadow: 0 0 12px rgba(0, 240, 255, 0.2);
}

.squad-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.squad-number {
  font-size: 11px;
  font-weight: 800;
  color: #00e5ff;
}

.squad-name {
  flex: 1;
  font-size: 11px;
  font-weight: 700;
  color: #f8fafc;
}

.squad-members-count {
  font-size: 10px;
  color: rgba(148, 163, 184, 0.8);
}

.squad-card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
}

.sl-name {
  color: rgba(148, 163, 184, 0.75);
}

.squad-health-summary {
  display: flex;
  align-items: center;
  gap: 5px;
}

.mini-bar-track {
  width: 44px;
  height: 4px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.mini-bar-fill {
  height: 100%;
  transition: width 0.3s ease;
}

/* Player Card */
.sidebar-player-card-row {
  padding: 7px 9px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
}

.sidebar-player-card-row:hover {
  border-color: rgba(0, 240, 255, 0.35);
  background: rgba(15, 23, 42, 0.85);
}

.sidebar-player-card-row.is-focused {
  border-color: #00f0ff;
  box-shadow: 0 0 12px rgba(0, 240, 255, 0.2);
}

.player-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.player-name {
  flex: 1;
  font-size: 11px;
  font-weight: 700;
  color: #f8fafc;
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sl-badge-pill {
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(234, 179, 8, 0.25);
  color: #facc15;
  border: 1px solid rgba(234, 179, 8, 0.4);
  font-size: 9px;
  font-weight: 800;
}

.player-squad-tag {
  font-size: 10px;
  color: #00e5ff;
  font-weight: 700;
}

.player-link-pill {
  font-size: 9px;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(148, 163, 184, 0.7);
}

.player-card-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.player-health-bar-container {
  width: 100%;
  height: 3px;
  border-radius: 1.5px;
  background: rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.player-health-bar-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.player-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 9px;
}

.player-hp-value {
  color: rgba(148, 163, 184, 0.8);
}

.player-kit {
  color: rgba(0, 240, 255, 0.8);
}

.player-vehicle-badge {
  display: flex;
  align-items: center;
  gap: 2px;
  color: #facc15;
}

/* ─── Assets Tab ──────────────────────────────────── */
.asset-summary-bar {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  background: rgba(0, 0, 0, 0.3);
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid rgba(0, 240, 255, 0.1);
}

.asset-summary-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.asset-summary-item .lbl {
  font-size: 8px;
  color: rgba(148, 163, 184, 0.7);
}

.asset-summary-item .val {
  font-size: 11px;
  color: #00e5ff;
}

.asset-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.asset-group-title {
  font-size: 10px;
  font-weight: 700;
  color: rgba(0, 240, 255, 0.8);
  border-bottom: 1px solid rgba(0, 240, 255, 0.1);
  padding-bottom: 3px;
  letter-spacing: 0.5px;
}

.asset-row {
  padding: 7px 9px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  transition: all 0.15s ease;
  color: #e2e8f0;
  font-size: 11px;
}

.asset-row:hover {
  border-color: rgba(0, 240, 255, 0.3);
  background: rgba(15, 23, 42, 0.85);
}

.asset-row--stacked {
  flex-direction: column;
  align-items: stretch;
  gap: 5px;
}

.asset-row-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.asset-name-text {
  font-weight: 700;
}

.asset-bars {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.asset-bar-line {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 9px;
  color: rgba(148, 163, 184, 0.8);
}

.asset-bar-line span:first-child {
  min-width: 24px;
}

.bzss-fill-hp { background: #10b981; }
.bzss-fill-ammo { background: #eab308; }
.bzss-fill-const { background: #3b82f6; }

.bzss-team-indicator {
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 800;
  font-family: monospace;
}

.team-ind-1 { background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); }
.team-ind-2 { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }
.team-ind-0 { background: rgba(148, 163, 184, 0.2); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.4); }

.bzss-badge {
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
}

.bzss-badge--ok { background: rgba(16, 185, 129, 0.2); color: #34d399; }
.bzss-badge--warn { background: rgba(234, 179, 8, 0.2); color: #facc15; }
.bzss-badge--danger { background: rgba(239, 68, 68, 0.25); color: #f87171; }

.pulse-badge {
  animation: stat-pulse 1.2s infinite alternate;
}

.is-fob-bleeding {
  border-color: rgba(239, 68, 68, 0.5) !important;
  background: rgba(239, 68, 68, 0.08) !important;
}

/* ─── Feed Tab ────────────────────────────────────── */
.feed-filter-bar {
  display: flex;
  gap: 4px;
}

.feed-chip {
  flex: 1;
  padding: 3px 0;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: rgba(148, 163, 184, 0.7);
  font-size: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.feed-chip:hover {
  border-color: rgba(0, 240, 255, 0.3);
  color: #ffffff;
}

.feed-chip.active {
  border-color: rgba(0, 240, 255, 0.5);
  background: rgba(0, 240, 255, 0.12);
  color: #00f0ff;
}

.combat-log-console {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.console-log-line {
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 10px;
  line-height: 1.4;
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.log-time {
  color: rgba(148, 163, 184, 0.6);
  flex-shrink: 0;
}

.log-type-tag {
  padding: 0 4px;
  border-radius: 3px;
  font-size: 8px;
  font-weight: 700;
  flex-shrink: 0;
}

.tag-kill { background: rgba(239, 68, 68, 0.2); color: #f87171; }
.tag-revive { background: rgba(16, 185, 129, 0.2); color: #34d399; }
.tag-capture { background: rgba(0, 229, 255, 0.2); color: #00f0ff; }
.tag-system { background: rgba(148, 163, 184, 0.2); color: #94a3b8; }

.log-text {
  color: #e2e8f0;
  word-break: break-all;
}

/* ─── Core Tab ────────────────────────────────────── */
.bzss-info-card {
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(0, 240, 255, 0.12);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bzss-info-card--error {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.08);
}

.bzss-card-title {
  font-size: 11px;
  font-weight: 700;
  color: #f8fafc;
  display: flex;
  align-items: center;
  gap: 6px;
}

.bzss-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
}

.bzss-stats-grid {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.bzss-stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
}

.bzss-stat-label {
  color: rgba(148, 163, 184, 0.7);
}

.bzss-stat-value {
  color: #e2e8f0;
}

.bzss-raw-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.bzss-raw-field-tag {
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(148, 163, 184, 0.8);
  font-size: 9px;
}

.bzss-error-text {
  color: #f87171;
  font-size: 10px;
  word-break: break-all;
}

/* ─── Helpers ─────────────────────────────────────── */
.empty-state {
  padding: 16px 12px;
  color: rgba(148, 163, 184, 0.6);
  text-align: center;
  font-size: 11px;
}

.font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.text-cyan  { color: #00f0ff; }
.text-green { color: #10b981; }
.text-amber { color: #f59e0b; }
.text-yellow { color: #facc15; }

.pulsing-text { animation: stat-pulse 1.8s infinite alternate; }

@keyframes stat-pulse {
  from { opacity: 0.55; }
  to   { opacity: 1; }
}

/* Responsive breakpoint */
@media (max-width: 900px) {
  .tactical-sidebar {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: min(92vw, 360px);
  }
}
</style>
