<template>
  <section class="bzss-page">
    <header class="page-hero">
      <div class="hero-left">
        <div class="title-row">
          <h1>BZSS-Core 玩家快照</h1>
          <span class="stream-badge" :class="{ 'stream-badge--active': bzssCoreStore.streamActive }">
            <span class="pulse-dot"></span>
            {{ bzssCoreStore.streamActive ? "SSE 监听中" : "轮询更新" }}
          </span>
        </div>
        <p class="hero-subtitle">
          实时监测服务器底层的玩家数据快照，提供运行时位置、计分板统计与场景占领点数据。
        </p>
      </div>

      <div class="hero-actions">
        <button type="button" class="btn btn-secondary btn-sm" :disabled="loading" @click="fetchData">
          <span v-if="loading" class="spinner"></span>
          刷新快照
        </button>
        <button type="button" class="btn btn-secondary btn-sm" :disabled="rawLoading" @click="fetchRawData">
          <span v-if="rawLoading" class="spinner"></span>
          刷新原始数据
        </button>
      </div>
    </header>

    <div v-if="error" class="error-banner">
      <span class="warning-icon">!</span>
      <div class="error-content">
        <strong>快照错误：</strong><span>{{ error }}</span>
      </div>
    </div>

    <div v-if="rawError" class="error-banner error-banner--soft">
      <span class="warning-icon">!</span>
      <div class="error-content">
        <strong>原始数据错误：</strong><span>{{ rawError }}</span>
      </div>
    </div>

    <section class="status-cards-grid">
      <div class="status-card" :class="payload?.status || 'idle'">
        <div class="status-card-inner">
          <div class="status-card-top-row">
            <div class="status-header">
              <span class="status-dot-indicator" :class="payload?.status || 'idle'"></span>
              <span class="lbl">核心状态</span>
            </div>
            <strong class="val" :class="statusColorClass">{{ statusLabel }}</strong>
          </div>
          <span class="sub text-muted">{{ statusDetail }}</span>
        </div>
      </div>

      <div class="status-card">
        <div class="status-card-inner">
          <div class="status-card-top-row">
            <span class="lbl">运行时玩家</span>
            <strong class="val">{{ runtimePlayers.length }} <span class="val-unit">人</span></strong>
          </div>
          <span class="sub text-muted">API同步: {{ payload?.state?.runtimePlayerCount ?? 0 }} 人</span>
        </div>
      </div>

      <div class="status-card">
        <div class="status-card-inner">
          <div class="status-card-top-row">
            <span class="lbl">计分板玩家</span>
            <strong class="val">{{ scoreboardPlayers.length }} <span class="val-unit">人</span></strong>
          </div>
          <span class="sub text-muted">API同步: {{ payload?.state?.scoreboardPlayerCount ?? 0 }} 人</span>
        </div>
      </div>

      <div class="status-card">
        <div class="status-card-inner">
          <div class="status-card-top-row">
            <span class="lbl">场景对象</span>
            <strong class="val">{{ totalSceneCount }} <span class="val-unit">项</span></strong>
          </div>
          <span class="sub text-muted">{{ payload?.captureZones?.length ?? 0 }} 点位 / {{ payload?.fobs?.length ?? 0 }} FOB</span>
        </div>
      </div>
    </section>

    <div class="dashboard-layout" :class="{ 'dashboard-layout--full': !showRawPanel }">
      <section class="dashboard-col main-panel">
        <header class="panel-header-wrapper">
          <div class="panel-header-top">
            <div class="panel-title-group">
              <div class="main-tabs">
                <button 
                  type="button" 
                  class="tab-link" 
                  :class="{ 'tab-link--active': activeMainTab === 'players' }" 
                  @click="activeMainTab = 'players'"
                >
                  玩家 ({{ playerPairs.length }})
                </button>
                <button 
                  type="button" 
                  class="tab-link" 
                  :class="{ 'tab-link--active': activeMainTab === 'zones' }" 
                  @click="activeMainTab = 'zones'"
                >
                  占领点 ({{ captureZones.length }})
                </button>
                <button 
                  type="button" 
                  class="tab-link" 
                  :class="{ 'tab-link--active': activeMainTab === 'fobs' }" 
                  @click="activeMainTab = 'fobs'"
                >
                  FOB ({{ fobs.length }})
                </button>
                <button 
                  type="button" 
                  class="tab-link" 
                  :class="{ 'tab-link--active': activeMainTab === 'mainZones' }" 
                  @click="activeMainTab = 'mainZones'"
                >
                  基地区域 ({{ mainZones.length }})
                </button>
                <button 
                  type="button" 
                  class="tab-link" 
                  :class="{ 'tab-link--active': activeMainTab === 'explosions' }" 
                  @click="activeMainTab = 'explosions'"
                >
                  爆炸记录 ({{ explosions.length }})
                </button>
              </div>
              <span v-if="isFilterActive" class="filter-indicator-badge">已筛选</span>
            </div>

            <div class="header-controls">
              <button 
                type="button" 
                class="btn btn-secondary btn-sm toggle-raw-panel-btn"
                @click="showRawPanel ? closeRawPanel() : openRawPanel()"
              >
                {{ showRawPanel ? "隐藏原始数据" : "显示原始数据" }}
              </button>

              <label class="toggle-switch">
                <input v-model="showRaw" type="checkbox" />
                <span class="slider"></span>
                <span class="label-text">显示原始 JSON</span>
              </label>
            </div>
          </div>

          <!-- New Premium Multi-Parameter Filter Bar -->
          <div class="filter-bar">
            <!-- 1. Search Box -->
            <div v-if="activeMainTab !== 'mainZones'" class="filter-item search-filter">
              <div class="search-input-wrapper">
                <span class="search-icon">🔍</span>
                <input
                  v-model.trim="query"
                  class="search-input"
                  type="text"
                  :placeholder="
                    activeMainTab === 'players' ? '搜索名字、ID、GUID...' :
                    activeMainTab === 'zones' ? '搜索占领点名称...' :
                    activeMainTab === 'fobs' ? '搜索 FOB ID/名称...' :
                    activeMainTab === 'explosions' ? '搜索伤害源/玩家...' : '搜索...'
                  "
                />
                <button v-if="query" type="button" class="clear-search-btn" @click="query = ''">×</button>
              </div>
            </div>

            <!-- 2. Team Faction Filter -->
            <div v-if="activeMainTab !== 'explosions'" class="filter-item team-filter">
              <span class="filter-label">阵营：</span>
              <div class="btn-group">
                <button 
                  type="button" 
                  class="btn-tab" 
                  :class="{ 'btn-tab--active': selectedTeam === null }"
                  @click="selectedTeam = null"
                >
                  全部
                </button>
                <button 
                  type="button" 
                  class="btn-tab btn-tab--blue" 
                  :class="{ 'btn-tab--active': selectedTeam === 1 }"
                  @click="selectedTeam = 1"
                >
                  {{ getTeamShortLabel(1) }}
                </button>
                <button 
                  type="button" 
                  class="btn-tab btn-tab--red" 
                  :class="{ 'btn-tab--active': selectedTeam === 2 }"
                  @click="selectedTeam = 2"
                >
                  {{ getTeamShortLabel(2) }}
                </button>
              </div>
            </div>

            <!-- 3. Squad Filter -->
            <div v-if="activeMainTab === 'players'" class="filter-item squad-filter">
              <span class="filter-label">小队：</span>
              <select v-model="selectedSquad" class="filter-select">
                <option value="all">全部小队</option>
                <option value="none">无小队</option>
                <option v-for="squadId in availableSquads" :key="squadId" :value="squadId">
                  Squad {{ squadId }}
                </option>
              </select>
            </div>

            <!-- 4. Role / Status Filter -->
            <div v-if="activeMainTab === 'players'" class="filter-item role-filter">
              <span class="filter-label">状态：</span>
              <select v-model="selectedRole" class="filter-select">
                <option value="all">全部状态</option>
                <option value="commander">指挥官</option>
                <option value="admin">管理员</option>
                <option value="live">在线玩家</option>
                <option value="stale">已过期/离线</option>
              </select>
            </div>

            <!-- 5. Reset button -->
            <button 
              v-if="isFilterActive"
              type="button" 
              class="btn btn-secondary btn-sm reset-filter-btn"
              @click="resetFilters"
            >
              重置筛选
            </button>
          </div>
        </header>

        <div class="player-list-scroll">
          <!-- Tab 1: Players -->
          <template v-if="activeMainTab === 'players'">
            <div v-if="sortedFilteredPairs.length > 0" class="table-view-container fade-in">
              <div class="table-responsive">
                <table class="player-table">
                  <thead>
                    <tr>
                      <th class="sortable" @click="handleSort('playerIndex')">
                        Index <span v-if="sortKey === 'playerIndex'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                      </th>
                      <th class="sortable" @click="handleSort('playerId')">
                        Player ID <span v-if="sortKey === 'playerId'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                      </th>
                      <th class="sortable" @click="handleSort('teamId')">
                        Team <span v-if="sortKey === 'teamId'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                      </th>
                      <th class="sortable" @click="handleSort('squadId')">
                        Squad <span v-if="sortKey === 'squadId'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                      </th>
                      <th>Status</th>
                      <th class="sortable text-center" @click="handleSort('kills')">
                        K <span v-if="sortKey === 'kills'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                      </th>
                      <th class="sortable text-center" @click="handleSort('deaths')">
                        D <span v-if="sortKey === 'deaths'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                      </th>
                      <th class="sortable text-center" @click="handleSort('woundeds')">
                        W <span v-if="sortKey === 'woundeds'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                      </th>
                      <th class="sortable text-center" @click="handleSort('lives')">
                        Lives <span v-if="sortKey === 'lives'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                      </th>
                      <th class="sortable text-center" @click="handleSort('teamworkScore')">
                        Teamwork <span v-if="sortKey === 'teamworkScore'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                      </th>
                      <th class="sortable text-center" @click="handleSort('objectiveScore')">
                        Objective <span v-if="sortKey === 'objectiveScore'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                      </th>
                      <th class="sortable text-center" @click="handleSort('combatScore')">
                        Combat <span v-if="sortKey === 'combatScore'">{{ sortOrder === 'asc' ? '↑' : '↓' }}</span>
                      </th>
                      <th class="text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <template v-for="pair in sortedFilteredPairs" :key="pair.playerIndex">
                      <tr
                        class="player-row"
                        :class="[
                          pair.scoreboard?.teamId === 1 ? 'player-row--blue' : pair.scoreboard?.teamId === 2 ? 'player-row--red' : '',
                          { 'player-row--expanded': expandedPlayers[pair.playerIndex] },
                        ]"
                        @click="togglePlayerExpand(pair.playerIndex)"
                      >
                        <td class="mono font-bold player-name-cell">
                          {{ getPlayerName(pair) || `Player ${pair.playerIndex}` }}
                          <span class="text-muted text-xs font-normal">({{ pair.playerIndex }})</span>
                        </td>
                        <td class="mono text-muted">{{ pair.runtime?.playerId ?? pair.scoreboard?.playerId ?? "--" }}</td>
                        <td>
                          <span
                            v-if="pair.scoreboard?.teamId != null"
                            class="badge"
                            :class="pair.scoreboard.teamId === 1 ? 'badge--blue' : 'badge--red'"
                          >
                            {{ getTeamChineseName(pair.scoreboard.teamId) || `Team ${pair.scoreboard.teamId}` }}
                          </span>
                          <span v-else class="text-muted">-</span>
                        </td>
                        <td>
                          <span class="badge badge--team">Squad {{ pair.scoreboard?.squadId ?? "--" }}</span>
                        </td>
                        <td>
                          <div class="flex-inline gap-4">
                            <span
                              class="player-status-dot"
                              :class="pair.runtime?.stale ? 'player-status-dot--stale' : 'player-status-dot--live'"
                              :title="pair.runtime?.stale ? '数据已过期' : '数据在线'"
                            ></span>
                            <span v-if="pair.scoreboard?.isCommander" class="badge badge--gold">指挥</span>
                            <span v-if="pair.scoreboard?.isAdmin" class="badge badge--admin">Admin</span>
                          </div>
                        </td>
                        <td class="mono text-center font-bold text-green-glow">{{ pair.scoreboard?.kills ?? 0 }}</td>
                        <td class="mono text-center text-red-soft">{{ pair.scoreboard?.deaths ?? 0 }}</td>
                        <td class="mono text-center">{{ pair.scoreboard?.woundeds ?? 0 }}</td>
                        <td class="mono text-center text-muted">{{ pair.scoreboard?.lives ?? 0 }}</td>
                        <td class="mono text-center">{{ pair.scoreboard?.teamworkScore ?? 0 }}</td>
                        <td class="mono text-center">{{ pair.scoreboard?.objectiveScore ?? 0 }}</td>
                        <td class="mono text-center">{{ pair.scoreboard?.combatScore ?? 0 }}</td>
                        <td class="text-right" @click.stop>
                          <button
                            type="button"
                            class="btn btn-secondary btn-sm table-expand-btn"
                            @click="togglePlayerExpand(pair.playerIndex)"
                          >
                            {{ expandedPlayers[pair.playerIndex] ? "收起" : "展开" }}
                          </button>
                        </td>
                      </tr>

                      <tr v-if="expandedPlayers[pair.playerIndex]" class="detail-row" @click.stop>
                        <td colspan="13">
                          <div class="table-expanded-content">
                            <div class="expanded-grid">
                              <div class="grid-card">
                                <h5>基础信息</h5>
                                <ul>
                                  <li>
                                    <span>Player Index:</span> 
                                    <div class="val-copy-row">
                                      <strong class="mono">{{ pair.playerIndex }}</strong>
                                    </div>
                                  </li>
                                  <li>
                                    <span>Player ID:</span> 
                                    <div class="val-copy-row">
                                      <strong class="mono">{{ pair.runtime?.playerId ?? pair.scoreboard?.playerId ?? "--" }}</strong>
                                      <button 
                                        v-if="pair.runtime?.playerId ?? pair.scoreboard?.playerId" 
                                        type="button" 
                                        class="btn-copy-mini" 
                                        title="复制 ID"
                                        @click="copyToClipboard(String(pair.runtime?.playerId ?? pair.scoreboard?.playerId), 'copied-val')"
                                      >
                                        📋
                                      </button>
                                    </div>
                                  </li>
                                  <li><span>Player Name:</span> <strong class="mono">{{ getPlayerName(pair) || "--" }}</strong></li>
                                  <li>
                                    <span>Player GUID:</span> 
                                    <div class="val-copy-row">
                                      <strong class="mono text-truncate" style="max-width: 140px;">{{ rawPlayerGuid(pair) }}</strong>
                                      <button 
                                        v-if="rawPlayerGuid(pair) !== '--'" 
                                        type="button" 
                                        class="btn-copy-mini" 
                                        title="复制 GUID"
                                        @click="copyToClipboard(rawPlayerGuid(pair), 'copied-val')"
                                      >
                                        📋
                                      </button>
                                    </div>
                                  </li>
                                  <li><span>Team:</span> <strong class="mono">{{ pair.scoreboard?.teamId ?? "--" }}</strong></li>
                                  <li><span>Squad:</span> <strong class="mono">{{ pair.scoreboard?.squadId ?? "--" }}</strong></li>
                                  <li><span>Commander:</span> <strong class="mono">{{ boolText(pair.scoreboard?.isCommander) }}</strong></li>
                                  <li><span>Admin:</span> <strong class="mono">{{ boolText(pair.scoreboard?.isAdmin) }}</strong></li>
                                  <li><span>FireTeam:</span> <strong class="mono">{{ pair.scoreboard?.fireTeamIndex ?? "--" }}/{{ pair.scoreboard?.fireTeamPosition ?? "--" }}</strong></li>
                                </ul>
                              </div>

                              <div class="grid-card">
                                <h5>运行时信息</h5>
                                <ul>
                                  <li>
                                    <span>Position:</span> 
                                    <div class="val-copy-row">
                                      <strong class="mono">{{ formatVector(pair.runtime?.position) }}</strong>
                                      <button 
                                        v-if="pair.runtime?.position" 
                                        type="button" 
                                        class="btn-copy-mini" 
                                        title="复制位置"
                                        @click="copyToClipboard(formatVector(pair.runtime?.position), 'copied-val')"
                                      >
                                        📋
                                      </button>
                                    </div>
                                  </li>
                                  <li><span>Yaw:</span> <strong class="mono">{{ pair.runtime?.yaw ?? "--" }}</strong></li>
                                  <li><span>Observed At:</span> <strong class="mono">{{ formatDateTime(pair.runtime?.observedAt) }}</strong></li>
                                  <li><span>Stale:</span> <strong class="mono">{{ boolText(pair.runtime?.stale) }}</strong></li>
                                  <li><span>Combat Info:</span> <strong class="mono">{{ pair.runtime?.combatInfo || "--" }}</strong></li>
                                </ul>
                              </div>

                              <div class="grid-card">
                                <h5>计分板信息</h5>
                                <ul>
                                  <li><span>Ping:</span> <strong class="mono">{{ pair.scoreboard?.ping != null ? `${pair.scoreboard.ping} ms` : "--" }}</strong></li>
                                  <li><span>Kills:</span> <strong class="mono">{{ pair.scoreboard?.kills ?? 0 }}</strong></li>
                                  <li><span>Deaths:</span> <strong class="mono">{{ pair.scoreboard?.deaths ?? 0 }}</strong></li>
                                  <li><span>Woundeds:</span> <strong class="mono">{{ pair.scoreboard?.woundeds ?? 0 }}</strong></li>
                                  <li><span>Wounds:</span> <strong class="mono">{{ pair.scoreboard?.wounds ?? 0 }}</strong></li>
                                  <li><span>TeamKills:</span> <strong class="mono">{{ pair.scoreboard?.teamKills ?? 0 }}</strong></li>
                                  <li><span>Heal Points:</span> <strong class="mono">{{ pair.scoreboard?.healPoints ?? 0 }}</strong></li>
                                  <li><span>Revived Points:</span> <strong class="mono">{{ pair.scoreboard?.revivedPoints ?? 0 }}</strong></li>
                                  <li><span>Teamwork:</span> <strong class="mono">{{ pair.scoreboard?.teamworkScore ?? 0 }}</strong></li>
                                  <li><span>Objective:</span> <strong class="mono">{{ pair.scoreboard?.objectiveScore ?? 0 }}</strong></li>
                                  <li><span>Combat:</span> <strong class="mono">{{ pair.scoreboard?.combatScore ?? 0 }}</strong></li>
                                </ul>
                              </div>
                            </div>

                            <!-- Extra telemetry cards if available -->
                            <div v-if="pair.rawPlayer?.vehicleInfo?.vehicleType || pair.rawPlayer?.soldierInfo?.soldierClass" class="expanded-extra-grid">
                              <div v-if="pair.rawPlayer?.vehicleInfo?.vehicleType" class="grid-card grid-card--vehicle">
                                <h5>载具状态</h5>
                                <ul>
                                  <li><span>载具类型:</span> <strong class="mono">{{ pair.rawPlayer.vehicleInfo.vehicleType }}</strong></li>
                                  <li v-if="pair.rawPlayer.vehicleInfo.health != null">
                                    <span>生命值:</span>
                                    <div class="fob-health-wrapper" style="width: 100px; margin-left: 10px; display: inline-block; vertical-align: middle;">
                                      <div class="fob-health-track" style="height: 6px;">
                                        <div 
                                          class="fob-health-bar"
                                          :style="{ 
                                            width: `${(pair.rawPlayer.vehicleInfo.health / (pair.rawPlayer.vehicleInfo.maxHealth || 100)) * 100}%`,
                                            background: (pair.rawPlayer.vehicleInfo.health / (pair.rawPlayer.vehicleInfo.maxHealth || 100)) > 0.5 
                                              ? 'linear-gradient(90deg, #10b981, #34d399)' 
                                              : 'linear-gradient(90deg, #ef4444, #f87171)'
                                          }"
                                        ></div>
                                      </div>
                                    </div>
                                    <strong class="mono" style="margin-left: 6px;">{{ pair.rawPlayer.vehicleInfo.health }}/{{ pair.rawPlayer.vehicleInfo.maxHealth || '100' }}</strong>
                                  </li>
                                  <li><span>世界坐标:</span> <strong class="mono text-xs">{{ formatVector(pair.rawPlayer.vehicleInfo.position) }}</strong></li>
                                </ul>
                              </div>

                              <div v-if="pair.rawPlayer?.soldierInfo?.soldierClass" class="grid-card grid-card--soldier">
                                <h5>士兵装备</h5>
                                <ul>
                                  <li><span>兵种职业:</span> <strong class="mono">{{ pair.rawPlayer.soldierInfo.soldierClass }}</strong></li>
                                  <li v-if="pair.rawPlayer.soldierInfo.health != null"><span>健康值:</span> <strong class="mono">{{ pair.rawPlayer.soldierInfo.health }}%</strong></li>
                                  <li><span>当前武器:</span> <strong class="mono text-xs">{{ pair.rawPlayer.soldierInfo.weaponClass || '--' }}</strong></li>
                                  <li v-if="pair.rawPlayer.soldierInfo.ammoValues?.length">
                                    <span>弹药数量:</span> 
                                    <strong class="mono">{{ pair.rawPlayer.soldierInfo.ammoValues.join(' / ') }}</strong>
                                  </li>
                                  <li><span>世界坐标:</span> <strong class="mono text-xs">{{ formatVector(pair.rawPlayer.soldierInfo.position) }}</strong></li>
                                </ul>
                              </div>
                            </div>

                            <details v-if="showRaw" class="player-json-details">
                              <summary>行原始 JSON</summary>
                              <pre class="json-block">{{ formatPlayerPairJson(pair) }}</pre>
                            </details>
                          </div>
                        </td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>
            </div>
            <div v-else class="empty-list-state">
              <p>当前没有满足筛选条件的玩家数据。</p>
            </div>
          </template>

          <!-- Tab 2: Capture Zones -->
          <template v-else-if="activeMainTab === 'zones'">
            <div v-if="filteredCaptureZones.length > 0" class="zones-grid fade-in">
              <div 
                v-for="(zone, index) in filteredCaptureZones" 
                :key="`${zone.name}-${index}`" 
                class="zone-card-main"
                :class="[
                  zone.captureDirection === 1 || zone.ownerTeamId === 1 ? 'zone-card--blue' : '',
                  zone.captureDirection === 2 || zone.ownerTeamId === 2 ? 'zone-card--red' : '',
                ]"
              >
                <div class="zone-card-header">
                  <h3>{{ zone.name || `Capture Zone ${index + 1}` }}</h3>
                  <span class="zone-status-badge" :class="{ 'zone-status-badge--locked': zone.isLocked }">
                    {{ zone.isLocked ? "已锁定" : "活跃点" }}
                  </span>
                </div>
                <div v-if="!zone.isLocked && zone.capturePercent != null && zone.capturePercent > 0" class="capture-progress-wrapper">
                  <div class="capture-progress-track">
                    <div 
                      class="capture-progress-bar"
                      :style="{ 
                        width: formatCapturePercent(zone.capturePercent),
                        background: zone.captureDirection === 1 
                          ? 'linear-gradient(90deg, #3b82f6, #60a5fa)' 
                          : zone.captureDirection === 2 
                            ? 'linear-gradient(90deg, #ef4444, #f87171)' 
                            : 'linear-gradient(90deg, #64748b, #94a3b8)'
                      }"
                    ></div>
                  </div>
                </div>
                <div class="zone-info-grid">
                  <div class="info-item">
                    <span class="label">归属阵营:</span>
                    <strong class="value">
                      <span 
                        v-if="zone.ownerTeamId || zone.teamId" 
                        class="badge" 
                        :class="(zone.ownerTeamId || zone.teamId) === 1 ? 'badge--blue' : 'badge--red'"
                      >
                        {{ getTeamChineseName(zone.ownerTeamId || zone.teamId) || `Team ${zone.ownerTeamId || zone.teamId}` }}
                      </span>
                      <span v-else class="text-muted">中立</span>
                    </strong>
                  </div>
                  <div class="info-item">
                    <span class="label">占领进度:</span>
                    <strong class="value">{{ formatCapturePercent(zone.capturePercent) }}</strong>
                  </div>
                  <div class="info-item">
                    <span class="label">占领方向:</span>
                    <strong class="value">{{ formatCaptureDirection(zone.captureDirection) }}</strong>
                  </div>
                  <div class="info-item">
                    <span class="label">位置坐标:</span>
                    <strong class="value mono text-xs">{{ formatSceneVector(zone.position) }}</strong>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="empty-list-state">
              <p>当前没有满足筛选条件的占领点数据。</p>
            </div>
          </template>

          <!-- Tab 3: FOBs -->
          <template v-else-if="activeMainTab === 'fobs'">
            <div v-if="filteredFobs.length > 0" class="fobs-grid fade-in">
              <div 
                v-for="(fob, index) in filteredFobs" 
                :key="`${fob.name || 'fob'}-${index}`" 
                class="fob-card-main"
                :class="fob.teamId === 1 ? 'fob-card--blue' : fob.teamId === 2 ? 'fob-card--red' : ''"
              >
                <div class="fob-card-header">
                  <h3>{{ fob.name || `FOB` }}</h3>
                  <div class="fob-status-badges">
                    <span v-if="fob.isBleeding" class="fob-badge fob-badge--bleeding animate-pulse">流血中</span>
                    <span v-if="fob.health != null" class="fob-badge fob-badge--health">血量: {{ fob.health }}%</span>
                  </div>
                </div>
                
                <!-- FOB Health Bar -->
                <div v-if="fob.health != null" class="fob-health-wrapper">
                  <div class="fob-health-track">
                    <div 
                      class="fob-health-bar"
                      :style="{ 
                        width: `${fob.health}%`,
                        background: fob.health > 50 
                          ? 'linear-gradient(90deg, #10b981, #34d399)' 
                          : fob.health > 20 
                            ? 'linear-gradient(90deg, #f59e0b, #fbbf24)' 
                            : 'linear-gradient(90deg, #ef4444, #f87171)'
                      }"
                    ></div>
                  </div>
                </div>

                <div class="fob-info-grid">
                  <div class="info-item">
                    <span class="label">归属阵营:</span>
                    <strong class="value">
                      <span 
                        v-if="fob.teamId" 
                        class="badge" 
                        :class="fob.teamId === 1 ? 'badge--blue' : 'badge--red'"
                      >
                        {{ getTeamChineseName(fob.teamId) || `Team ${fob.teamId}` }}
                      </span>
                      <span v-else class="text-muted">-</span>
                    </strong>
                  </div>
                  <div class="info-item">
                    <span class="label">建材点数:</span>
                    <strong class="value">{{ fob.construction ?? fob.constructionPoints ?? 0 }}</strong>
                  </div>
                  <div class="info-item">
                    <span class="label">弹药点数:</span>
                    <strong class="value">{{ fob.ammo ?? 0 }}</strong>
                  </div>
                  <div class="info-item">
                    <span class="label">尺寸/发起者:</span>
                    <strong class="value text-xs">{{ fob.size || fob.instigator || '--' }}</strong>
                  </div>
                  <div class="info-item full-width">
                    <span class="label">世界坐标:</span>
                    <strong class="value mono text-xs">{{ formatSceneVector(fob.position) }}</strong>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="empty-list-state">
              <p>当前没有满足筛选条件的 FOB 数据。</p>
            </div>
          </template>

          <!-- Tab 4: Main Zones -->
          <template v-else-if="activeMainTab === 'mainZones'">
            <div v-if="filteredMainZones.length > 0" class="main-zones-grid fade-in">
              <div 
                v-for="(mz, index) in filteredMainZones" 
                :key="index" 
                class="mz-card-main"
                :class="mz.teamId === 1 ? 'mz-card--blue' : mz.teamId === 2 ? 'mz-card--red' : ''"
              >
                <div class="mz-card-header">
                  <h3>基地 (Main Zone)</h3>
                  <span class="badge" :class="mz.teamId === 1 ? 'badge--blue' : 'badge--red'">
                    {{ getTeamChineseName(mz.teamId) || `Team ${mz.teamId}` }}
                  </span>
                </div>
                <div class="mz-info">
                  <div class="info-item">
                    <span class="label">位置坐标:</span>
                    <strong class="value mono text-xs">{{ formatSceneVector(mz.position) }}</strong>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="empty-list-state">
              <p>当前没有满足筛选条件的基地区域数据。</p>
            </div>
          </template>

          <!-- Tab 5: Explosions -->
          <template v-else-if="activeMainTab === 'explosions'">
            <div v-if="filteredExplosions.length > 0" class="table-view-container fade-in">
              <div class="table-responsive">
                <table class="player-table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>ID</th>
                      <th>伤害源 (Damage Causer)</th>
                      <th>发起者 (Instigator)</th>
                      <th>世界坐标</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="exp in filteredExplosions" :key="exp.id" class="explosion-row">
                      <td class="mono">{{ formatDateTime(exp.at) }}</td>
                      <td class="mono text-muted text-xs">{{ exp.id }}</td>
                      <td class="mono text-green-glow">{{ exp.damageCauser }}</td>
                      <td class="mono font-bold">{{ exp.damageInstigator || '--' }}</td>
                      <td class="mono text-xs">X: {{ exp.x.toFixed(1) }}, Y: {{ exp.y.toFixed(1) }}, Z: {{ exp.z.toFixed(1) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div v-else class="empty-list-state">
              <p>当前没有满足筛选条件的爆炸记录数据。</p>
            </div>
          </template>
        </div>
      </section>

      <aside v-if="showRawPanel" class="dashboard-col raw-panel">
        <header class="panel-header-wrapper">
          <div class="panel-header-top">
            <h2>最近一次原始数据</h2>
            <div class="header-controls">
              <span class="raw-pill">{{ rawDataStatusLabel }}</span>
            </div>
          </div>
        </header>

        <div class="raw-data-panel">
          <div class="raw-meta-row">
            <span><strong>Revision:</strong> {{ rawData?.revision ?? "--" }}</span>
            <span><strong>Updated:</strong> {{ formatDateTime(rawData?.updatedAt) }}</span>
            <span><strong>Hash:</strong> {{ rawData?.rawLineHash || "--" }}</span>
          </div>

          <section class="capture-zone-section">
            <div class="capture-zone-section__header">
              <div>
                <h3>Capture Zones (占领点)</h3>
                <p>当前场景快照中的占领点。列表可独立滚动。</p>
              </div>
              <span class="capture-zone-count">{{ captureZones.length }}</span>
            </div>

            <div v-if="captureZones.length > 0" class="capture-zone-list">
              <article
                v-for="(zone, index) in captureZones"
                :key="`${zone.name}-${index}`"
                class="capture-zone-card"
              >
                <div class="capture-zone-card__title">
                  <strong>{{ zone.name || `Capture Zone ${index + 1}` }}</strong>
                  <span class="capture-zone-state" :class="{ 'capture-zone-state--locked': zone.isLocked }">
                    {{ zone.isLocked ? "已锁定" : "可占领" }}
                  </span>
                </div>

                <!-- Capture Progress Bar Visualizer -->
                <div v-if="!zone.isLocked && zone.capturePercent != null && zone.capturePercent > 0" class="capture-progress-wrapper">
                  <div class="capture-progress-track">
                    <div 
                      class="capture-progress-bar"
                      :style="{ 
                        width: formatCapturePercent(zone.capturePercent),
                        background: zone.captureDirection === 1 
                          ? 'linear-gradient(90deg, #3b82f6, #60a5fa)' 
                          : zone.captureDirection === 2 
                            ? 'linear-gradient(90deg, #ef4444, #f87171)' 
                            : 'linear-gradient(90deg, #64748b, #94a3b8)'
                      }"
                    ></div>
                  </div>
                </div>

                <dl class="capture-zone-facts">
                  <div>
                    <dt>世界坐标</dt>
                    <dd class="mono">{{ formatSceneVector(zone.position) }}</dd>
                  </div>
                  <div>
                    <dt>占领比例</dt>
                    <dd>{{ formatCapturePercent(zone.capturePercent) }}</dd>
                  </div>
                  <div>
                    <dt>占领方向</dt>
                    <dd>{{ formatCaptureDirection(zone.captureDirection) }}</dd>
                  </div>
                </dl>
              </article>
            </div>
            <p v-else class="capture-zone-empty">当前快照尚未包含 Capture Zone 数据。</p>
          </section>

          <!-- Tabbed interface for raw JSON data -->
          <div class="raw-tabs-container">
            <div class="raw-tabs-header">
              <button 
                type="button" 
                class="raw-tab-btn" 
                :class="{ 'raw-tab-btn--active': activeRawTab === 'full' }" 
                @click="activeRawTab = 'full'"
              >
                完整快照
              </button>
              <button 
                type="button" 
                class="raw-tab-btn" 
                :class="{ 'raw-tab-btn--active': activeRawTab === 'runtime' }" 
                @click="activeRawTab = 'runtime'"
              >
                运行时
              </button>
              <button 
                type="button" 
                class="raw-tab-btn" 
                :class="{ 'raw-tab-btn--active': activeRawTab === 'scoreboard' }" 
                @click="activeRawTab = 'scoreboard'"
              >
                计分板
              </button>
              <button 
                type="button" 
                class="raw-tab-btn" 
                :class="{ 'raw-tab-btn--active': activeRawTab === 'scene' }" 
                @click="activeRawTab = 'scene'"
              >
                场景
              </button>
            </div>
            <div class="raw-tab-content">
              <div class="raw-tab-meta">
                <span>{{ activeRawTab === 'full' ? '完整 JSON 数据' : activeRawTab === 'runtime' ? '运行时原始玩家' : activeRawTab === 'scoreboard' ? '计分板原始玩家' : '场景（点/FOB/爆破）数据' }}</span>
                <div class="raw-tab-actions">
                  <button type="button" class="btn btn-secondary btn-sm copy-btn" @click="copyActiveRawBlock">
                    {{ copiedBlock === activeRawTab ? '已复制' : '复制预览' }}
                  </button>
                  <button type="button" class="btn btn-secondary btn-sm" @click="downloadFullRawJson">
                    下载完整 JSON
                  </button>
                </div>
              </div>
              <pre class="raw-code-block">{{ activeRawBlock }}</pre>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from "vue";
import {
  type BzssCoreCaptureZoneInfo,
  type BzssCoreRuntimePlayerInfo,
  type BzssCoreScoreboardPlayerInfo,
  type BzssCoreFobInfo,
  type BzssCoreMainZoneInfo,
  type BzssCoreExplosionInfo,
} from "../app/bzssCoreApi";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";
import { useSquadStore } from "../stores/squad.store";
import { useServerStore } from "../stores/server.store";
import { usePlayerStore } from "../stores/player.store";
import { useBzssCoreStore } from "../stores/bzss-core.store";
import { getChineseNameFromTeamName } from "../shared/faction-assets/faction-data";

type PlayerPair = {
  playerIndex: number | string;
  runtime: BzssCoreRuntimePlayerInfo | null;
  scoreboard: BzssCoreScoreboardPlayerInfo | null;
  rawPlayer?: BzssCoreMergedPlayer | null;
};

type BzssCoreMergedPlayer = {
  playerId?: number | null;
  playerIndex?: number | null;
  playerName?: string;
  playerGuid?: string;
  teamId?: number | null;
  squadId?: number | null;
  isAdmin?: boolean | null;
  isCommander?: boolean | null;
  stale?: boolean;
  runtimeObservedAt?: string;
  scoreboardObservedAt?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  position?: BzssCoreRuntimePlayerInfo["position"] | null;
  yaw?: number | null;
  combatInfo?: string;
  telemetry?: {
    position?: BzssCoreRuntimePlayerInfo["position"] | null;
    yaw?: number | null;
    combatInfo?: string;
    vehicleInfo?: any;
  };
  vehicleInfo?: {
    raw?: string;
    vehicleType?: string;
    healthText?: string;
    health?: number | null;
    maxHealth?: number | null;
    position?: BzssCoreRuntimePlayerInfo["position"] | null;
    rotation?: BzssCoreRuntimePlayerInfo["position"] | null;
  } | null;
  soldierInfo?: {
    raw?: string;
    fields?: string[];
    values?: Record<string, string>;
    soldierClass?: string;
    health?: number | null;
    weaponClass?: string;
    ammoValues?: number[];
    position?: BzssCoreRuntimePlayerInfo["position"] | null;
    rotation?: BzssCoreRuntimePlayerInfo["position"] | null;
  } | null;
  presence?: {
    state?: string;
    runtimeObservedAt?: string;
    scoreboardObservedAt?: string;
  };
  playerScoreboard?: {
    ping?: number | null;
    stats?: Record<string, any>;
    raw?: string;
    values?: string[];
    numericValues?: Array<number | null>;
  };
  ftIndex?: number | null;
  ftPosition?: number | null;
  ping?: number | null;
};

const bzssCoreStore = useBzssCoreStore();
const squadStore = useSquadStore();
const serverStore = useServerStore();
const playerStore = usePlayerStore();

const payload = computed(() => bzssCoreStore.snapshot);
const rawData = computed(() => bzssCoreStore.rawData);
const loading = computed(() => bzssCoreStore.loading);
const rawLoading = computed(() => bzssCoreStore.rawLoading);
const error = computed(() => bzssCoreStore.error);
const rawError = computed(() => bzssCoreStore.rawError);

const query = ref("");
const showRaw = ref(false);
const copiedBlock = ref<string | null>(null);
const sortKey = ref<keyof BzssCoreScoreboardPlayerInfo | "playerIndex" | "playerId">("playerIndex");
const sortOrder = ref<"asc" | "desc">("asc");
const expandedPlayers = ref<Record<string | number, boolean>>({});

// New filter state & panel state
const showRawPanel = ref(false);
const rawLoaded = ref(false);
const selectedTeam = ref<number | null>(null);
const selectedSquad = ref<string | number>("all");
const selectedRole = ref<string>("all");
const activeMainTab = ref<"players" | "zones" | "fobs" | "mainZones" | "explosions">("players");

const availableSquads = computed(() => {
  const squadsSet = new Set<number>();
  playerPairs.value.forEach((pair) => {
    const sId = pair.scoreboard?.squadId;
    if (sId != null && sId !== 0) {
      squadsSet.add(sId);
    }
  });
  return Array.from(squadsSet).sort((a, b) => a - b);
});

const isFilterActive = computed(() => {
  return query.value.trim() !== "" ||
    selectedTeam.value !== null ||
    selectedSquad.value !== "all" ||
    selectedRole.value !== "all";
});

function resetFilters() {
  query.value = "";
  selectedTeam.value = null;
  selectedSquad.value = "all";
  selectedRole.value = "all";
}

// Custom UI filters and tabs state
const activeTeamFilter = ref<'all' | 1 | 2>('all');
const activeRawTab = ref<'full' | 'runtime' | 'scoreboard' | 'scene'>('full');
const RAW_PREVIEW_MAX_CHARS = 200 * 1024;
const rawPreviewBlocks = ref<Record<'full' | 'runtime' | 'scoreboard' | 'scene', string>>({
  full: "",
  runtime: "",
  scoreboard: "",
  scene: "",
});

const activeRawBlock = computed(() => rawPreviewBlocks.value[activeRawTab.value]);

function stringifyRawPreview(value: unknown) {
  const text = JSON.stringify(value, null, 2) ?? "null";
  if (text.length <= RAW_PREVIEW_MAX_CHARS) return text;
  return `${text.slice(0, RAW_PREVIEW_MAX_CHARS)}\n\n... 预览已截断（最多 200KB），请下载完整 JSON。`;
}

function refreshRawPreviews() {
  rawPreviewBlocks.value = {
    full: stringifyRawPreview(rawData.value ?? {}),
    runtime: stringifyRawPreview(runtimePlayers.value),
    scoreboard: stringifyRawPreview(scoreboardPlayers.value),
    scene: stringifyRawPreview({
      captureZones: payload.value?.captureZones ?? [],
      fobs: payload.value?.fobs ?? [],
      mainZones: payload.value?.mainZones ?? [],
      explosions: payload.value?.explosions ?? [],
    }),
  };
}

async function copyActiveRawBlock() {
  await copyToClipboard(activeRawBlock.value, activeRawTab.value);
}

function getPlayerName(pair: PlayerPair) {
  const mergedName = (pair.runtime as unknown as { playerName?: string })?.playerName ?? (pair.scoreboard as unknown as { playerName?: string })?.playerName;
  if (mergedName) return mergedName;

  const playerId = pair.runtime?.playerId ?? pair.scoreboard?.playerId;
  if (playerId != null) {
    const player = playerStore.byPlayerID[playerId];
    if (player?.name) return player.name;
  }
  return "";
}

const teamNames = computed(() => {
  let team1 = "";
  let team2 = "";

  const squadTeam1 = squadStore.list.find((s) => s.teamID === 1);
  if (squadTeam1?.teamName) team1 = squadTeam1.teamName;
  const squadTeam2 = squadStore.list.find((s) => s.teamID === 2);
  if (squadTeam2?.teamName) team2 = squadTeam2.teamName;

  const snapshotTeams = serverStore.snapshot?.matchState?.teams;
  if (Array.isArray(snapshotTeams)) {
    const t1 = snapshotTeams.find((t: any) => t.teamId === 1 || t.teamID === 1);
    const t2 = snapshotTeams.find((t: any) => t.teamId === 2 || t.teamID === 2);
    if (t1?.teamName) team1 = t1.teamName;
    if (t2?.teamName) team2 = t2.teamName;
  }

  const webStatus = serverStore.snapshot?.webStatus;
  if (webStatus) {
    if (webStatus.team1Name) team1 = webStatus.team1Name;
    if (webStatus.team2Name) team2 = webStatus.team2Name;
  }

  return {
    t1Raw: team1 || "Team 1",
    t2Raw: team2 || "Team 2",
  };
});

function getTeamChineseName(teamId: number | null | undefined) {
  if (teamId === 1) return getChineseNameFromTeamName(teamNames.value.t1Raw);
  if (teamId === 2) return getChineseNameFromTeamName(teamNames.value.t2Raw);
  return "";
}

// Check if a team translation was found, return raw name or clean short name if translation is empty
function getTeamShortLabel(teamId: number | null | undefined) {
  if (teamId == null) return "";
  const cnName = getTeamChineseName(teamId);
  if (cnName) return cnName;
  return teamId === 1 ? teamNames.value.t1Raw : teamNames.value.t2Raw;
}

function togglePlayerExpand(playerIndex: string | number) {
  expandedPlayers.value[playerIndex] = !expandedPlayers.value[playerIndex];
}

function handleSort(key: "playerIndex" | "playerId" | keyof BzssCoreScoreboardPlayerInfo) {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === "asc" ? "desc" : "asc";
    return;
  }
  sortKey.value = key;
  sortOrder.value = "desc";
}

const runtimePlayers = computed(() => payload.value?.runtimePlayers ?? []);
const scoreboardPlayers = computed(() => payload.value?.scoreboardPlayers ?? []);
const mergedPlayers = computed<BzssCoreMergedPlayer[]>(() => Array.isArray(payload.value?.players) ? (payload.value?.players as BzssCoreMergedPlayer[]) : []);

const totalSceneCount = computed(() => {
  return (payload.value?.captureZones?.length ?? 0) + (payload.value?.fobs?.length ?? 0) + (payload.value?.mainZones?.length ?? 0);
});

const playerPairs = computed<PlayerPair[]>(() => {
  if (mergedPlayers.value.length > 0) {
    return mergedPlayers.value
      .map((player) => buildPlayerPairFromMergedPlayer(player))
      .sort((a, b) => Number(a.playerIndex) - Number(b.playerIndex));
  }

  const map = new Map<string, PlayerPair>();
  const addPlayer = (player: BzssCoreRuntimePlayerInfo | BzssCoreScoreboardPlayerInfo | undefined, side: "runtime" | "scoreboard") => {
    if (!player) return;
    const key = String(player.playerIndex ?? player.playerId ?? "");
    if (!key) return;
    const current = map.get(key) ?? {
      playerIndex: player.playerIndex ?? player.playerId ?? key,
      runtime: null,
      scoreboard: null,
    };
    if (side === "runtime") current.runtime = player as BzssCoreRuntimePlayerInfo;
    if (side === "scoreboard") current.scoreboard = player as BzssCoreScoreboardPlayerInfo;
    map.set(key, current);
  };

  runtimePlayers.value.forEach((player) => addPlayer(player, "runtime"));
  scoreboardPlayers.value.forEach((player) => addPlayer(player, "scoreboard"));
  return [...map.values()].sort((a, b) => Number(a.playerIndex) - Number(b.playerIndex));
});

function buildPlayerPairFromMergedPlayer(player: BzssCoreMergedPlayer): PlayerPair {
  const telemetry = player.telemetry ?? {};
  const scoreboardStats = player.playerScoreboard?.stats ?? {};
  const runtimePosition = telemetry.position ?? player.position ?? player.soldierInfo?.position ?? null;
  const runtimeYaw = telemetry.yaw ?? player.yaw ?? player.soldierInfo?.rotation?.z ?? null;
  const runtimeCombatInfo = telemetry.combatInfo ?? player.combatInfo ?? player.soldierInfo?.weaponClass ?? "";
  const runtimeObservedAt = player.presence?.runtimeObservedAt
    ?? player.runtimeObservedAt
    ?? player.lastSeenAt
    ?? player.firstSeenAt
    ?? "";
  const presenceState = player.presence?.state ?? "";
  const runtime: BzssCoreRuntimePlayerInfo & { playerGuid?: string; playerName?: string } = {
    playerId: player.playerId ?? null,
    playerIndex: player.playerIndex ?? null,
    position: presenceState === "noPawn" ? null : runtimePosition,
    yaw: presenceState === "noPawn" ? null : runtimeYaw,
    combatInfo: runtimeCombatInfo,
    observedAt: runtimeObservedAt,
    stale: presenceState === "scoreboardOnly" || presenceState === "notSpawned"
      ? true
      : Boolean(player.stale),
    playerGuid: player.playerGuid ?? "",
    playerName: player.playerName ?? "",
  };

  const scoreboard: BzssCoreScoreboardPlayerInfo & { playerGuid?: string; playerName?: string } = {
    playerId: player.playerId ?? null,
    playerIndex: player.playerIndex ?? null,
    teamId: player.teamId ?? null,
    squadId: player.squadId ?? null,
    lives: scoreboardStats.dataLives ?? null,
    kills: scoreboardStats.numKills ?? null,
    vehicleKills: scoreboardStats.vehicleKills ?? null,
    deaths: scoreboardStats.numDeaths ?? null,
    woundeds: scoreboardStats.numWoundeds ?? null,
    wounds: scoreboardStats.numWounds ?? null,
    teamKills: scoreboardStats.numTeamKills ?? null,
    healPoints: scoreboardStats.healPoints ?? null,
    revivedPoints: scoreboardStats.revivedPoints ?? null,
    teamworkScore: scoreboardStats.teamworkScore ?? null,
    objectiveScore: scoreboardStats.objectiveScore ?? null,
    combatScore: scoreboardStats.combatScore ?? null,
    isAdmin: player.isAdmin ?? null,
    isCommander: player.isCommander ?? null,
    fireTeamIndex: player.ftIndex ?? null,
    fireTeamPosition: player.ftPosition ?? null,
    ping: player.ping ?? player.playerScoreboard?.ping ?? null,
    playerGuid: player.playerGuid ?? "",
    playerName: player.playerName ?? "",
  };

  return {
    playerIndex: player.playerIndex ?? player.playerId ?? "",
    runtime,
    scoreboard,
    rawPlayer: player,
  };
}

const filteredPairs = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return playerPairs.value.filter((pair) => {
    // 1. Text Search Filter
    if (needle) {
      const values = [
        pair.playerIndex,
        pair.runtime?.playerId,
        pair.runtime?.combatInfo,
        pair.scoreboard?.playerId,
        pair.scoreboard?.teamId,
        pair.scoreboard?.squadId,
        getPlayerName(pair),
        rawPlayerGuid(pair),
      ];
      const matchesText = values.some((value) => String(value ?? "").toLowerCase().includes(needle));
      if (!matchesText) return false;
    }

    // 2. Team/Faction Filter
    if (selectedTeam.value !== null) {
      if (pair.scoreboard?.teamId !== selectedTeam.value) return false;
    }

    // 3. Squad Filter
    if (selectedSquad.value !== "all") {
      if (selectedSquad.value === "none") {
        if (pair.scoreboard?.squadId != null && pair.scoreboard?.squadId !== 0) return false;
      } else {
        if (pair.scoreboard?.squadId !== Number(selectedSquad.value)) return false;
      }
    }

    // 4. Role/Status Filter
    if (selectedRole.value !== "all") {
      if (selectedRole.value === "admin") {
        if (!pair.scoreboard?.isAdmin) return false;
      } else if (selectedRole.value === "commander") {
        if (!pair.scoreboard?.isCommander) return false;
      } else if (selectedRole.value === "live") {
        if (pair.runtime?.stale) return false;
      } else if (selectedRole.value === "stale") {
        if (!pair.runtime?.stale) return false;
      }
    }

    return true;
  });
});

const sortedFilteredPairs = computed(() => {
  const list = [...filteredPairs.value];
  const order = sortOrder.value === "asc" ? 1 : -1;
  const key = sortKey.value;

  list.sort((a, b) => {
    let valA: number | string = 0;
    let valB: number | string = 0;

    if (key === "playerIndex") {
      valA = Number(a.playerIndex);
      valB = Number(b.playerIndex);
    } else if (key === "playerId") {
      valA = a.runtime?.playerId ?? a.scoreboard?.playerId ?? 999999;
      valB = b.runtime?.playerId ?? b.scoreboard?.playerId ?? 999999;
    } else if (key === "teamId") {
      valA = a.scoreboard?.teamId ?? 999;
      valB = b.scoreboard?.teamId ?? 999;
    } else if (key === "squadId") {
      valA = a.scoreboard?.squadId ?? 999;
      valB = b.scoreboard?.squadId ?? 999;
    } else {
      valA = (a.scoreboard as any)?.[key] ?? 0;
      valB = (b.scoreboard as any)?.[key] ?? 0;
    }

    if (valA < valB) return -1 * order;
    if (valA > valB) return 1 * order;
    return 0;
  });

  return list;
});

const captureZones = computed<BzssCoreCaptureZoneInfo[]>(() => (
  payload.value?.captureZones ?? rawData.value?.captureZones ?? []
));

const fobs = computed<BzssCoreFobInfo[]>(() => (
  payload.value?.fobs ?? rawData.value?.fobs ?? []
));

const mainZones = computed<BzssCoreMainZoneInfo[]>(() => (
  payload.value?.mainZones ?? rawData.value?.mainZones ?? []
));

const explosions = computed<BzssCoreExplosionInfo[]>(() => (
  payload.value?.explosions ?? rawData.value?.explosions ?? []
));

const filteredCaptureZones = computed(() => {
  const needle = query.value.trim().toLowerCase();
  let list = captureZones.value;

  if (needle) {
    list = list.filter((zone) => 
      (zone.name ?? "").toLowerCase().includes(needle) ||
      (zone.raw ?? "").toLowerCase().includes(needle)
    );
  }

  if (selectedTeam.value !== null) {
    list = list.filter((zone) => 
      zone.teamId === selectedTeam.value || 
      zone.ownerTeamId === selectedTeam.value || 
      zone.captureDirection === selectedTeam.value
    );
  }

  return list;
});

const filteredFobs = computed(() => {
  const needle = query.value.trim().toLowerCase();
  let list = fobs.value;

  if (needle) {
    list = list.filter((fob) => 
      (fob.name ?? "").toLowerCase().includes(needle) ||
      (fob.fobId ?? "").toLowerCase().includes(needle) ||
      (fob.raw ?? "").toLowerCase().includes(needle)
    );
  }

  if (selectedTeam.value !== null) {
    list = list.filter((fob) => fob.teamId === selectedTeam.value);
  }

  return list;
});

const filteredMainZones = computed(() => {
  let list = mainZones.value;
  if (selectedTeam.value !== null) {
    list = list.filter((mz) => mz.teamId === selectedTeam.value);
  }
  return list;
});

const filteredExplosions = computed(() => {
  const needle = query.value.trim().toLowerCase();
  let list = explosions.value;

  if (needle) {
    list = list.filter((exp) => 
      (exp.damageCauser ?? "").toLowerCase().includes(needle) ||
      (exp.damageInstigator ?? "").toLowerCase().includes(needle) ||
      (exp.id ?? "").toLowerCase().includes(needle)
    );
  }
  return list;
});


const rawDataStatusLabel = computed(() => {
  const data = rawData.value;
  if (!data) return "尚未获取原始数据";
  if (data.lastError) return `原始数据错误: ${data.lastError}`;
  return `更新于 ${formatDateTime(data.updatedAt)}`;
});

const statusLabel = computed(() => {
  const status = String(payload.value?.status ?? "").trim();
  if (status === "ready") return "就绪";
  if (status === "error") return "故障";
  if (status === "unavailable") return "不可用";
  return "空闲";
});

const statusColorClass = computed(() => {
  const status = String(payload.value?.status ?? "").trim();
  if (status === "ready") return "text-success";
  if (status === "error") return "text-danger";
  return "text-warning";
});

const statusDetail = computed(() => {
  const state = payload.value?.state;
  if (!state) return "无运行时状态";
  if (state.lastError) return `错误: ${state.lastError}`;
  if (state.updatedAt) return `同步时间: ${formatDateTime(state.updatedAt)}`;
  return "等待数据刷新";
});

function formatDateTime(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatVector(value?: BzssCoreRuntimePlayerInfo["position"]) {
  if (!value) return "--";
  const x = value.x != null ? value.x.toFixed(1) : "--";
  const y = value.y != null ? value.y.toFixed(1) : "--";
  const z = value.z != null ? value.z.toFixed(1) : "--";
  return `X:${x}, Y:${y}, Z:${z}`;
}

function formatSceneVector(value?: BzssCoreCaptureZoneInfo["position"]) {
  if (!value) return "--";
  const formatAxis = (axis: number | null) => (axis == null ? "--" : axis.toFixed(1));
  return `X:${formatAxis(value.x)}, Y:${formatAxis(value.y)}, Z:${formatAxis(value.z)}`;
}

function formatCapturePercent(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "--";
  const percent = Math.abs(value) <= 1 ? value * 100 : value;
  return `${Math.max(0, Math.min(100, percent)).toFixed(1)}%`;
}

function formatCaptureDirection(value?: number | null) {
  if (value == null) return "--";
  if (value === 0) return "中立";
  if (value === 1) return `蓝军 (${getTeamShortLabel(1)})`;
  if (value === 2) return `红军 (${getTeamShortLabel(2)})`;
  return `阵营 ${value}`;
}

function formatPlayerPairJson(pair: PlayerPair) {
  return JSON.stringify(
    {
      runtime: pair.runtime ?? null,
      scoreboard: pair.scoreboard ?? null,
    },
    null,
    2,
  );
}

function rawPlayerGuid(pair: PlayerPair) {
  return (
    (pair.runtime as unknown as { playerGuid?: string })?.playerGuid ??
    (pair.scoreboard as unknown as { playerGuid?: string })?.playerGuid ??
    "--"
  );
}

function boolText(value: boolean | null | undefined) {
  if (value === true) return "是";
  if (value === false) return "否";
  return "--";
}

async function copyToClipboard(text: string, blockName: string) {
  try {
    await navigator.clipboard.writeText(text);
    copiedBlock.value = blockName;
    window.setTimeout(() => {
      if (copiedBlock.value === blockName) copiedBlock.value = null;
    }, 2000);
  } catch {
    // ignore clipboard failures
  }
}

let refreshTimer: number | null = null;

async function fetchData() {
  await bzssCoreStore.fetchSnapshot();
}

async function fetchRawData() {
  await bzssCoreStore.fetchRaw();
  if (!rawError.value) {
    rawLoaded.value = true;
    if (showRawPanel.value) refreshRawPreviews();
  }
}

async function openRawPanel() {
  showRawPanel.value = true;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (!rawLoaded.value) {
    await fetchRawData();
  } else {
    refreshRawPreviews();
  }
}

function closeRawPanel() {
  showRawPanel.value = false;
  rawPreviewBlocks.value = { full: "", runtime: "", scoreboard: "", scene: "" };
}

async function downloadFullRawJson() {
  if (!rawLoaded.value) await fetchRawData();
  const blob = new Blob([JSON.stringify(rawData.value ?? {}, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `bzss-core-raw-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function clearRefresh() {
  if (refreshTimer != null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function scheduleRefresh() {
  clearRefresh();
  refreshTimer = window.setTimeout(async () => {
    if (canAutoRefreshNow() && !bzssCoreStore.streamActive) {
      await fetchData();
      if (rawLoaded.value && showRawPanel.value) await fetchRawData();
    }
    scheduleRefresh();
  }, bzssCoreStore.streamActive ? 1500 : 1000);
}

function startStreamIfNeeded() {
  if (!bzssCoreStore.streamActive) {
    bzssCoreStore.startStream();
  }
}

function stopStreamIfNeeded() {
  if (bzssCoreStore.streamActive) {
    bzssCoreStore.stopStream();
  }
}

onMounted(async () => {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await fetchData();
  startStreamIfNeeded();
  scheduleRefresh();
});

onActivated(() => {
  startStreamIfNeeded();
  scheduleRefresh();
});

onDeactivated(() => {
  stopStreamIfNeeded();
  clearRefresh();
});

onBeforeUnmount(() => {
  stopStreamIfNeeded();
  clearRefresh();
});
</script>

<style scoped>
/* Page Base Layout */
.bzss-page {
  position: relative;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  overflow: hidden;
  background: var(--color-bg-page);
}

/* Floating Glassmorphism Hero Header */
.page-hero {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 24px;
  background: rgba(255, 255, 255, 0.015);
  border: 1px solid var(--color-border-soft);
  border-radius: var(--card-radius, 14px);
  backdrop-filter: blur(16px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.title-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.title-row h1 {
  font-size: 22px;
  font-weight: 800;
  margin: 0;
  letter-spacing: -0.5px;
  background: linear-gradient(135deg, var(--color-text-primary) 30%, var(--color-brand-primary) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.hero-subtitle {
  margin: 6px 0 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  max-width: 700px;
  line-height: 1.4;
}

.hero-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

/* SSE Stream Badge */
.stream-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-soft);
  transition: all 0.3s ease;
}

.stream-badge--active {
  color: var(--color-status-success);
  border-color: rgba(52, 211, 153, 0.3);
  background: rgba(52, 211, 153, 0.06);
  box-shadow: 0 0 12px rgba(52, 211, 153, 0.05);
}

.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 0 currentColor;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.5); }
  70% { box-shadow: 0 0 0 6px rgba(52, 211, 153, 0); }
  100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); }
}

/* Status Cards Grid */
/* Status Cards Grid */
.status-cards-grid {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}

@media (max-width: 1024px) {
  .status-cards-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .status-cards-grid {
    grid-template-columns: 1fr;
  }
}

.status-card {
  position: relative;
  background: rgba(255, 255, 255, 0.015);
  border: 1px solid var(--color-border-soft);
  border-radius: 12px;
  padding: 10px 16px;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.status-card:hover {
  transform: translateY(-2px);
  background: rgba(255, 255, 255, 0.03);
  border-color: var(--color-border-default);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
}

.status-card-inner {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-card-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.status-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-muted);
}
.status-dot-indicator.ready { background: var(--color-status-success); }
.status-dot-indicator.error { background: var(--color-status-danger); }
.status-dot-indicator.unavailable { background: var(--color-status-warning); }
.status-dot-indicator.idle { background: var(--color-text-muted); }

.status-card.ready {
  border-left: 3px solid var(--color-status-success);
}
.status-card.error {
  border-left: 3px solid var(--color-status-danger);
}
.status-card.unavailable {
  border-left: 3px solid var(--color-status-warning);
}

.status-card .lbl {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 500;
}

.status-card .val {
  font-size: 22px;
  font-weight: 800;
  color: var(--color-text-primary);
  line-height: 1.1;
}

.status-card .val-unit {
  font-size: 13px;
  font-weight: 400;
  color: var(--color-text-muted);
  margin-left: 2px;
}

.status-card .sub {
  font-size: 11px;
  color: var(--color-text-muted);
}

/* Dashboard Columns Grid Layout */
.dashboard-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(360px, 1fr);
  gap: 16px;
  transition: grid-template-columns 0.3s ease;
}

.dashboard-layout--full {
  grid-template-columns: 1fr !important;
}

.dashboard-col {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-border-default);
  border-radius: var(--card-radius, 14px);
  background: var(--color-bg-card, rgba(15, 23, 34, 0.94));
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
}

.panel-header-wrapper {
  flex-shrink: 0;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-border-soft);
  background: rgba(0, 0, 0, 0.1);
}

.panel-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.panel-title-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

.panel-header-top h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.filter-indicator-badge {
  background: rgba(55, 200, 255, 0.15);
  border: 1px solid rgba(55, 200, 255, 0.35);
  color: #a8ecff;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

/* Premium Filter Bar */
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed rgba(255, 255, 255, 0.08);
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.filter-label {
  color: var(--color-text-secondary);
  font-weight: 500;
  white-space: nowrap;
}

/* Faction Button Group */
.btn-group {
  display: inline-flex;
  padding: 2px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
}

.btn-tab {
  height: 28px;
  padding: 0 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-tab:hover {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.03);
}

.btn-tab--active {
  color: var(--color-text-primary) !important;
  background: rgba(255, 255, 255, 0.08) !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.btn-tab--blue.btn-tab--active {
  color: #c7d2fe !important;
  background: rgba(59, 130, 246, 0.2) !important;
  border: 1px solid rgba(59, 130, 246, 0.25);
}

.btn-tab--red.btn-tab--active {
  color: #fecaca !important;
  background: rgba(239, 68, 68, 0.2) !important;
  border: 1px solid rgba(239, 68, 68, 0.25);
}

/* Custom Select Dropdowns */
.filter-select {
  height: 32px;
  padding: 0 24px 0 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background: rgba(0, 0, 0, 0.25) url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2394a3b8' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e") no-repeat right 6px center / 16px;
  color: var(--color-text-primary);
  font-size: 12px;
  outline: none;
  cursor: pointer;
  appearance: none;
  transition: all 0.25s ease;
}

.filter-select:focus {
  border-color: var(--color-brand-primary);
  box-shadow: 0 0 0 3px rgba(55, 200, 255, 0.15);
}

.reset-filter-btn {
  height: 28px;
  padding: 0 10px;
  font-size: 11px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.25);
  color: #fecaca;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.25s ease;
}

.reset-filter-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.35);
}

/* Search Box and Input Wrapper */
.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 10px;
  font-size: 12px;
  opacity: 0.6;
  pointer-events: none;
}

.search-filter .search-input {
  min-width: 220px;
  height: 32px;
  padding: 0 30px 0 32px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background: rgba(0, 0, 0, 0.25);
  color: var(--color-text-primary);
  font-size: 12px;
  outline: none;
  transition: all 0.25s ease;
}

.search-filter .search-input:focus {
  border-color: var(--color-brand-primary);
  box-shadow: 0 0 0 3px rgba(55, 200, 255, 0.15);
  background: rgba(0, 0, 0, 0.35);
}

.clear-search {
  position: absolute;
  right: 8px;
  height: 20px;
  padding: 0 4px;
  border-radius: 4px;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-muted);
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.clear-search:hover {
  background: rgba(255, 255, 255, 0.2);
  color: var(--color-text-primary);
}

/* Toggle Switch Styles */
.toggle-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-secondary);
  user-select: none;
  cursor: pointer;
}

.toggle-switch input {
  accent-color: var(--color-brand-primary);
  width: 14px;
  height: 14px;
  cursor: pointer;
}

/* Scroll Container */
.player-list-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
}

/* Modern Player Table */
.table-view-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.table-responsive {
  overflow: auto;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.12);
}

.player-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.player-table th {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(20, 26, 38, 0.98);
  backdrop-filter: blur(10px);
  padding: 12px 10px;
  border-bottom: 1px solid var(--color-border-default);
  text-align: left;
  font-weight: 700;
  color: var(--color-text-secondary);
  white-space: nowrap;
  user-select: none;
}

.player-table th.sortable {
  cursor: pointer;
  transition: color 0.15s ease;
}

.player-table th.sortable:hover {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.02);
}

.player-table td {
  padding: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  white-space: nowrap;
  vertical-align: middle;
}

.player-row {
  cursor: pointer;
  transition: all 0.2s ease;
}

.player-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

/* Left Indicator Faction Row Styles */
.player-row--blue {
  border-left: 4px solid #3b82f6;
  background: linear-gradient(90deg, rgba(59, 130, 246, 0.04) 0%, transparent 100%);
}

.player-row--blue:hover {
  background: linear-gradient(90deg, rgba(59, 130, 246, 0.07) 0%, rgba(255, 255, 255, 0.01) 100%);
}

.player-row--red {
  border-left: 4px solid #ef4444;
  background: linear-gradient(90deg, rgba(239, 68, 68, 0.04) 0%, transparent 100%);
}

.player-row--red:hover {
  background: linear-gradient(90deg, rgba(239, 68, 68, 0.07) 0%, rgba(255, 255, 255, 0.01) 100%);
}

.player-row--expanded {
  background: rgba(255, 255, 255, 0.03) !important;
}

.player-name-cell {
  color: var(--color-text-primary);
  font-size: 13px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.table-expand-btn {
  min-width: 64px;
}

/* Expanded Detail Row */
.detail-row td {
  padding: 14px 18px;
  background: rgba(0, 0, 0, 0.18);
  border-bottom: 1px solid var(--color-border-soft);
}

.table-expanded-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.expanded-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.grid-card {
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  background: rgba(10, 15, 25, 0.6);
  padding: 14px;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3);
}

.grid-card h5 {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-brand-primary);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  padding-bottom: 6px;
}

.grid-card ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.grid-card li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  line-height: 1.4;
}

.grid-card li > span {
  color: var(--color-text-muted);
}

/* Expanded Copy Layout */
.val-copy-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.btn-copy-mini {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 11px;
  padding: 2px 4px;
  border-radius: 4px;
  color: var(--color-text-muted);
  opacity: 0.6;
  display: inline-flex;
  align-items: center;
  transition: all 0.2s ease;
}

.btn-copy-mini:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary);
}

.text-truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Expanded JSON Drawer inside card */
.player-json-details {
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.player-json-details summary {
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.01);
  transition: background 0.15s ease;
}

.player-json-details summary:hover {
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-primary);
}

.json-block {
  margin: 0;
  padding: 12px;
  border-top: 1px solid var(--color-border-soft);
  font-size: 11px;
  line-height: 1.5;
  background: rgba(0, 0, 0, 0.4);
  color: #38bdf8;
  max-height: 260px;
  overflow: auto;
}

/* Right Aside Panel Styles */
.raw-panel {
  min-width: 0;
}

.raw-data-panel {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
}

.raw-pill {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-soft);
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-muted);
}

.raw-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 11px;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid var(--color-border-soft);
  background: rgba(0, 0, 0, 0.18);
  color: var(--color-text-secondary);
}

.raw-meta-row strong {
  color: var(--color-text-primary);
}

/* Capture Zone Visual Panel with Progress Bar */
.capture-zone-section {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.05), rgba(0, 0, 0, 0.15));
}

.capture-zone-section__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.capture-zone-section h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.capture-zone-section p {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--color-text-muted);
}

.capture-zone-count {
  flex: 0 0 auto;
  min-width: 24px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.15);
  color: #93c5fd;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid rgba(59, 130, 246, 0.25);
}

.capture-zone-list {
  max-height: 320px;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: grid;
  gap: 10px;
  padding-right: 4px;
}

.capture-zone-card {
  padding: 12px;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  background: rgba(10, 15, 25, 0.5);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.capture-zone-card__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.capture-zone-card__title strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--color-text-primary);
}

.capture-zone-state {
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid rgba(52, 211, 153, 0.35);
  border-radius: 999px;
  color: var(--color-status-success);
  font-size: 10px;
  font-weight: 600;
  background: rgba(52, 211, 153, 0.05);
}

.capture-zone-state--locked {
  border-color: rgba(245, 158, 11, 0.35);
  color: var(--color-status-warning);
  background: rgba(245, 158, 11, 0.05);
}

/* Faction Progress Bar Design */
.capture-progress-wrapper {
  margin: 2px 0;
  width: 100%;
}

.capture-progress-track {
  height: 6px;
  width: 100%;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.05);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.02);
}

.capture-progress-bar {
  height: 100%;
  border-radius: 99px;
  transition: width 0.35s ease;
}

.capture-zone-facts {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 6px 10px;
  margin: 4px 0 0;
  border-top: 1px solid rgba(255, 255, 255, 0.03);
  padding-top: 6px;
}

.capture-zone-facts div:first-child {
  grid-column: 1 / -1;
}

.capture-zone-facts dt {
  margin-bottom: 2px;
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 500;
}

.capture-zone-facts dd {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 11px;
}

.capture-zone-empty {
  padding: 16px 0;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 12px;
}

/* Tabbed JSON interface styling */
.raw-tabs-container {
  border: 1px solid var(--color-border-soft);
  border-radius: 12px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
}

.raw-tabs-header {
  display: flex;
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid var(--color-border-soft);
  padding: 0 4px;
}

.raw-tab-btn {
  height: 36px;
  padding: 0 16px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
  background: transparent;
  border: none;
  cursor: pointer;
  position: relative;
  transition: all 0.2s ease;
}

.raw-tab-btn:hover {
  color: var(--color-text-primary);
}

.raw-tab-btn--active {
  color: var(--color-brand-primary);
}

.raw-tab-btn--active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 16px;
  right: 16px;
  height: 2px;
  background-color: var(--color-brand-primary);
  border-radius: 99px;
}

.raw-tab-content {
  padding: 12px;
  background: rgba(0, 0, 0, 0.08);
}

.raw-tab-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--color-text-muted);
  margin-bottom: 8px;
}

.raw-code-block {
  margin: 0;
  padding: 12px;
  border-radius: 8px;
  overflow: auto;
  font-size: 11px;
  line-height: 1.5;
  background: rgba(0, 0, 0, 0.35);
  color: #38bdf8;
  height: 280px;
  border: 1px solid rgba(255, 255, 255, 0.02);
}

/* Mini copy button */
.copy-btn {
  height: 24px;
  padding: 0 10px;
  font-size: 10px;
  border-radius: 6px;
}

.empty-list-state {
  text-align: center;
  padding: 32px 16px;
  color: var(--color-text-muted);
  border: 1px dashed var(--color-border-soft);
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.05);
}

/* Animations and Utilities */
.spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-right: 6px;
  vertical-align: middle;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.fade-in {
  animation: fadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--control-height-md, 34px);
  padding: 0 16px;
  border-radius: var(--control-radius, 10px);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
}

.btn-secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-sm {
  height: var(--control-height-sm, 30px);
  padding: 0 12px;
  font-size: 12px;
}

.error-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid rgba(248, 113, 113, 0.3);
  background: rgba(248, 113, 113, 0.08);
  color: var(--color-text-primary);
}

.error-banner--soft {
  border-color: rgba(245, 158, 11, 0.3);
  background: rgba(245, 158, 11, 0.08);
}

.warning-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: currentColor;
  color: #000;
  font-size: 11px;
  font-weight: 800;
}

.error-content {
  font-size: 12px;
  line-height: 1.4;
}

.text-muted {
  color: var(--color-text-muted) !important;
}

.text-danger {
  color: var(--color-status-danger) !important;
}

.text-success {
  color: var(--color-status-success) !important;
}

.text-warning {
  color: var(--color-status-warning) !important;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.flex-inline {
  display: inline-flex;
  align-items: center;
}

.gap-4 {
  gap: 4px;
}

.font-bold {
  font-weight: 700;
}

.text-center {
  text-align: center;
}

.text-right {
  text-align: right;
}

.text-green-glow {
  color: var(--color-status-success);
  text-shadow: 0 0 10px rgba(52, 211, 153, 0.15);
}

.text-red-soft {
  color: var(--color-status-danger);
  text-shadow: 0 0 10px rgba(248, 113, 113, 0.15);
}

.player-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.player-status-dot--live {
  background: var(--color-status-success);
}

.player-status-dot--stale {
  background: var(--color-status-warning);
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  border: 1px solid transparent;
}

.badge--blue {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.25);
  color: #93c5fd;
}

.badge--red {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.25);
  color: #fca5a5;
}

.badge--team {
  background: rgba(255, 255, 255, 0.04);
  border-color: var(--color-border-soft);
  color: var(--color-text-secondary);
}

.badge--gold {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.25);
  color: #fde047;
}

.badge--admin {
  background: rgba(6, 182, 212, 0.12);
  border-color: rgba(6, 182, 212, 0.25);
  color: #67e8f9;
}

/* Custom Styled Scrollbars */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  transition: background 0.15s ease;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.15);
}

/* Responsiveness */
@media (max-width: 1200px) {
  .dashboard-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .page-hero {
    flex-direction: column;
    align-items: stretch;
  }
  
  .hero-actions {
    justify-content: flex-end;
  }

  .panel-header-top {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .header-controls {
    width: 100%;
    justify-content: space-between;
  }

  .player-table {
    min-width: 980px;
  }

  .expanded-grid {
    grid-template-columns: 1fr;
  }
}

/* Tab Buttons */
.main-tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: none; /* Firefox */
}

.main-tabs::-webkit-scrollbar {
  display: none; /* Safari and Chrome */
}

.tab-link {
  height: 36px;
  padding: 0 16px;
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-muted);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tab-link:hover {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--color-border-default);
}

.tab-link--active {
  color: var(--color-brand-primary) !important;
  background: rgba(55, 200, 255, 0.08) !important;
  border-color: rgba(55, 200, 255, 0.35) !important;
  box-shadow: 0 0 12px rgba(55, 200, 255, 0.08);
}

/* Grids for other categories */
.zones-grid, .fobs-grid, .main-zones-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
  padding: 4px;
}

/* Zone Card */
.zone-card-main, .fob-card-main, .mz-card-main {
  background: rgba(255, 255, 255, 0.015);
  border: 1px solid var(--color-border-soft);
  border-radius: 12px;
  padding: 16px;
  transition: all 0.25s ease;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.zone-card-main:hover, .fob-card-main:hover, .mz-card-main:hover {
  transform: translateY(-2px);
  background: rgba(255, 255, 255, 0.03);
  border-color: var(--color-border-default);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
}

.zone-card--blue, .fob-card--blue, .mz-card--blue {
  border-left: 3px solid #3b82f6;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.04), transparent 80%);
}

.zone-card--red, .fob-card--red, .mz-card--red {
  border-left: 3px solid #ef4444;
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.04), transparent 80%);
}

.zone-card-header, .fob-card-header, .mz-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.zone-card-header h3, .fob-card-header h3, .mz-card-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.zone-status-badge, .fob-badge {
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 99px;
  border: 1px solid transparent;
}

.zone-status-badge {
  background: rgba(52, 211, 153, 0.1);
  border-color: rgba(52, 211, 153, 0.2);
  color: var(--color-status-success);
}

.zone-status-badge--locked {
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.2);
  color: var(--color-status-warning);
}

.fob-badge--bleeding {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.3);
  color: #fca5a5;
}

.fob-badge--health {
  background: rgba(255, 255, 255, 0.04);
  border-color: var(--color-border-soft);
  color: var(--color-text-secondary);
}

/* FOB Health bar */
.fob-health-wrapper {
  width: 100%;
}

.fob-health-track {
  height: 6px;
  width: 100%;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.05);
  overflow: hidden;
}

.fob-health-bar {
  height: 100%;
  border-radius: 99px;
  transition: width 0.35s ease;
}

.zone-info-grid, .fob-info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding-top: 10px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-item.full-width {
  grid-column: 1 / -1;
}

.info-item .label {
  font-size: 10px;
  color: var(--color-text-muted);
  font-weight: 500;
}

.info-item .value {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.mz-info {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding-top: 10px;
}

.explosion-row:hover {
  background: rgba(255, 255, 255, 0.02);
}

/* Expanded extra grid */
.expanded-extra-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
  border-top: 1px dashed rgba(255, 255, 255, 0.08);
  padding-top: 14px;
}

.grid-card--vehicle {
  border-color: rgba(59, 130, 246, 0.2) !important;
}

.grid-card--soldier {
  border-color: rgba(168, 85, 247, 0.2) !important;
}
</style>