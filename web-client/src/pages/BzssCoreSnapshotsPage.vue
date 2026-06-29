<template>
  <section class="bzss-page">
    <!-- Header Hero -->
    <header class="page-hero">
      <div class="hero-left">
        <div class="title-row">
          <h1>BZSS-Core 玩家与战局快照</h1>
          <span class="stream-badge" :class="{ 'stream-badge--active': closeStream }">
            <span class="pulse-dot"></span>
            {{ closeStream ? "SSE 监听中" : "轮询更新" }}
          </span>
        </div>
      </div>
      <div class="hero-actions">
        <button type="button" class="btn btn-secondary btn-sm" :disabled="loading" @click="fetchData">
          <span v-if="loading" class="spinner"></span>
          {{ loading ? "同步中..." : "手动刷新" }}
        </button>
      </div>
    </header>

    <!-- Error Banner -->
    <div v-if="error" class="error-banner">
      <span class="warning-icon">⚠</span>
      <div class="error-content">
        <strong>同步出错: </strong><span>{{ error }}</span>
      </div>
    </div>

    <!-- Compact Unified Status Ribbon -->
    <section class="status-ribbon">
      <div class="status-item">
        <span class="status-dot-indicator" :class="payload?.status || 'idle'"></span>
        <span class="lbl">核心状态:</span>
        <strong class="val" :class="statusColorClass">{{ statusLabel }}</strong>
        <span class="sub text-muted">({{ statusDetail }})</span>
      </div>
      
      <div class="status-separator">|</div>
      
      <div class="status-item">
        <span class="lbl">存活玩家 (Runtime):</span>
        <strong class="val">{{ runtimePlayers.length }} 人</strong>
        <span class="sub text-muted">(数据特征: {{ payload?.state?.runtimePlayerCount ?? 0 }})</span>
      </div>

      <div class="status-separator">|</div>

      <div class="status-item">
        <span class="lbl">记分板上报 (Scoreboard):</span>
        <strong class="val">{{ scoreboardPlayers.length }} 人</strong>
        <span class="sub text-muted">(上报数: {{ payload?.state?.scoreboardPlayerCount ?? 0 }})</span>
      </div>

      <div class="status-separator">|</div>

      <div class="status-item">
        <span class="lbl">战场实体 (Scene):</span>
        <strong class="val">{{ totalSceneCount }} 个</strong>
        <span class="sub text-muted">({{ payload?.captureZones?.length ?? 0 }} 据点 / {{ payload?.fobs?.length ?? 0 }} FOB)</span>
      </div>
    </section>

    <!-- Main Dashboard Grid -->
    <div class="dashboard-layout">
      <!-- Left Column: Players List -->
      <section class="dashboard-col main-panel">
        <header class="panel-header-wrapper">
          <div class="panel-header-top">
            <h2>玩家快照 ({{ filteredPairs.length }} / {{ playerPairs.length }} 人)</h2>
            
            <div class="header-controls">
              <!-- View Switcher -->
              <div class="view-switcher">
                <button 
                  type="button" 
                  class="switcher-btn" 
                  :class="{ 'switcher-btn--active': viewMode === 'squad' }" 
                  @click="viewMode = 'squad'"
                  title="小队分组视图"
                >
                  小队
                </button>
                <button 
                  type="button" 
                  class="switcher-btn" 
                  :class="{ 'switcher-btn--active': viewMode === 'table' }" 
                  @click="viewMode = 'table'"
                  title="数据表格视图"
                >
                  表格
                </button>
                <button 
                  type="button" 
                  class="switcher-btn" 
                  :class="{ 'switcher-btn--active': viewMode === 'grid' }" 
                  @click="viewMode = 'grid'"
                  title="卡片网格视图"
                >
                  网格
                </button>
              </div>

              <!-- Search Box -->
              <div class="search-box">
                <input
                  v-model.trim="query"
                  class="search-input"
                  type="text"
                  placeholder="搜索玩家名 / ID / Squad..."
                />
                <span v-if="query" class="clear-search" @click="query = ''">✕</span>
              </div>

              <!-- Show JSON -->
              <label class="toggle-switch">
                <input v-model="showRaw" type="checkbox" />
                <span class="slider"></span>
                <span class="label-text">JSON</span>
              </label>
            </div>
          </div>

          <!-- Team Tabs Filter -->
          <div class="filter-tabs-wrapper">
            <div class="filter-tabs">
              <button 
                type="button" 
                class="tab-btn" 
                :class="{ 'tab-btn--active': teamFilter === 'all' }"
                @click="teamFilter = 'all'"
              >
                全部 <span class="tab-badge">{{ teamCounts.all }}</span>
              </button>
              <button 
                type="button" 
                class="tab-btn tab-btn--blue" 
                :class="{ 'tab-btn--active': teamFilter === '1' }"
                @click="teamFilter = '1'"
              >
                {{ teamNames[1] }} <span class="tab-badge">{{ teamCounts.t1 }}</span>
              </button>
              <button 
                type="button" 
                class="tab-btn tab-btn--red" 
                :class="{ 'tab-btn--active': teamFilter === '2' }"
                @click="teamFilter = '2'"
              >
                {{ teamNames[2] }} <span class="tab-badge">{{ teamCounts.t2 }}</span>
              </button>
              <button 
                type="button" 
                class="tab-btn tab-btn--neutral" 
                :class="{ 'tab-btn--active': teamFilter === 'unassigned' }"
                @click="teamFilter = 'unassigned'"
              >
                旁观/未分配 <span class="tab-badge">{{ teamCounts.unassigned }}</span>
              </button>
            </div>
          </div>
        </header>

        <!-- Player List Scrollable Container -->
        <div class="player-list-scroll">
          <div v-if="filteredPairs.length > 0" class="flex-column gap-12 w-full">
            <!-- 1. SQUAD VIEW -->
            <div v-if="viewMode === 'squad'" class="squad-teams-container fade-in">
              <div 
                v-for="teamGroup in squadGroupedTeams" 
                :key="teamGroup.teamId" 
                class="team-column"
                :class="`team-column--${teamGroup.teamId === 1 ? 'blue' : (teamGroup.teamId === 2 ? 'red' : 'neutral')}`"
              >
                <h3 class="team-column-title">
                  <span class="team-dot"></span>
                  {{ teamGroup.label }}
                  <span class="team-player-count">({{ teamGroup.squads.reduce((acc, sq) => acc + sq.players.length, 0) }}人)</span>
                </h3>
                
                <div class="squads-grid">
                  <div 
                    v-for="squad in teamGroup.squads" 
                    :key="squad.squadId" 
                    class="squad-card"
                  >
                    <div class="squad-card-header">
                      <strong class="squad-name">
                        {{ squad.squadId === 0 ? "未分配小队 (Unassigned)" : `Squad ${squad.squadId}` }}
                      </strong>
                      <span class="squad-count badge">{{ squad.players.length }} 人</span>
                    </div>
                    
                    <div class="squad-players-list">
                      <div 
                        v-for="pair in squad.players" 
                        :key="pair.playerIndex" 
                        class="squad-player-row-wrapper"
                      >
                        <div 
                          class="squad-player-row"
                          :class="{ 'squad-player-row--expanded': expandedPlayers[pair.playerIndex] }"
                          @click="togglePlayerExpand(pair.playerIndex)"
                        >
                          <div class="sq-player-main">
                            <span 
                              class="player-status-dot" 
                              :class="pair.runtime?.stale ? 'player-status-dot--stale' : 'player-status-dot--live'"
                            ></span>
                            <span class="sq-player-name">
                              {{ getPlayerName(pair) || `Player ${pair.playerIndex}` }}
                              <small class="text-muted font-normal">({{ pair.playerIndex }})</small>
                            </span>
                            <div class="sq-player-badges">
                              <span v-if="pair.scoreboard?.isCommander" class="badge badge--gold" title="指挥官">C</span>
                              <span v-if="pair.scoreboard?.isAdmin" class="badge badge--admin" title="管理员">A</span>
                            </div>
                          </div>
                          <div class="sq-player-stats-compact font-mono">
                            <span class="stat" title="击杀">K:{{ pair.scoreboard?.kills ?? 0 }}</span>
                            <span class="stat" title="死亡">D:{{ pair.scoreboard?.deaths ?? 0 }}</span>
                            <span class="stat" title="击倒">W:{{ pair.scoreboard?.woundeds ?? 0 }}</span>
                            <span class="stat text-muted" title="复活次数">L:{{ pair.scoreboard?.lives ?? 0 }}</span>
                          </div>
                        </div>
                        
                        <!-- Expanded inside squad player row -->
                        <div v-if="expandedPlayers[pair.playerIndex]" class="sq-player-detail-expanded">
                          <div class="detail-grid">
                            <div class="detail-item"><strong>ID:</strong> {{ pair.runtime?.playerId ?? pair.scoreboard?.playerId ?? "--" }}</div>
                            <div class="detail-item"><strong>坐标:</strong> {{ formatVector(pair.runtime?.position) }}</div>
                            <div class="detail-item"><strong>偏航:</strong> {{ pair.runtime?.yaw ?? "--" }}°</div>
                            <div class="detail-item" v-if="pair.runtime?.combatInfo"><strong>战息:</strong> {{ pair.runtime.combatInfo }}</div>
                          </div>
                          
                          <div class="scores-grid mt-6">
                            <span class="score-badge">团队: {{ pair.scoreboard?.teamworkScore ?? 0 }}</span>
                            <span class="score-badge">目标: {{ pair.scoreboard?.objectiveScore ?? 0 }}</span>
                            <span class="score-badge">战斗: {{ pair.scoreboard?.combatScore ?? 0 }}</span>
                            <span class="score-badge">治疗: {{ pair.scoreboard?.healPoints ?? 0 }}</span>
                            <span class="score-badge">拉人: {{ pair.scoreboard?.revivedPoints ?? 0 }}</span>
                            <span class="score-badge text-danger" v-if="pair.scoreboard?.teamKills">TK: {{ pair.scoreboard.teamKills }}</span>
                          </div>

                          <details v-if="showRaw" class="player-json-details mt-6">
                            <summary>查看日志快照 JSON</summary>
                            <pre class="json-block">{{ pair.runtime ?? pair.scoreboard ?? {} }}</pre>
                          </details>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 2. TABLE VIEW -->
            <div v-else-if="viewMode === 'table'" class="table-view-container fade-in">
              <div class="table-responsive">
                <table class="player-table">
                  <thead>
                    <tr>
                      <th @click="handleSort('playerIndex')" class="sortable">
                        玩家 Index <span v-if="sortKey === 'playerIndex'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                      </th>
                      <th @click="handleSort('playerId')" class="sortable">
                        ID <span v-if="sortKey === 'playerId'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                      </th>
                      <th @click="handleSort('teamId')" class="sortable">
                        阵营 <span v-if="sortKey === 'teamId'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                      </th>
                      <th @click="handleSort('squadId')" class="sortable">
                        小队 <span v-if="sortKey === 'squadId'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                      </th>
                      <th>角色/状态</th>
                      <th @click="handleSort('kills')" class="sortable text-center">
                        击杀 <span v-if="sortKey === 'kills'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                      </th>
                      <th @click="handleSort('deaths')" class="sortable text-center">
                        死亡 <span v-if="sortKey === 'deaths'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                      </th>
                      <th @click="handleSort('woundeds')" class="sortable text-center">
                        击倒 <span v-if="sortKey === 'woundeds'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                      </th>
                      <th @click="handleSort('lives')" class="sortable text-center">
                        复活 <span v-if="sortKey === 'lives'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                      </th>
                      <th @click="handleSort('teamworkScore')" class="sortable text-center">
                        团队 <span v-if="sortKey === 'teamworkScore'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                      </th>
                      <th @click="handleSort('objectiveScore')" class="sortable text-center">
                        目标 <span v-if="sortKey === 'objectiveScore'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                      </th>
                      <th @click="handleSort('combatScore')" class="sortable text-center">
                        战斗 <span v-if="sortKey === 'combatScore'">{{ sortOrder === 'asc' ? '▲' : '▼' }}</span>
                      </th>
                      <th class="text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <template v-for="pair in sortedFilteredPairs" :key="pair.playerIndex">
                      <tr 
                        class="player-row" 
                        :class="[
                          pair.scoreboard?.teamId === 1 ? 'player-row--blue' : (pair.scoreboard?.teamId === 2 ? 'player-row--red' : ''),
                          { 'player-row--expanded': expandedPlayers[pair.playerIndex] }
                        ]"
                        @click="togglePlayerExpand(pair.playerIndex)"
                      >
                         <td class="mono font-bold">
                          {{ getPlayerName(pair) || `Player ${pair.playerIndex}` }}
                          <span class="text-muted text-xs font-normal"> ({{ pair.playerIndex }})</span>
                        </td>
                        <td class="mono text-muted">{{ pair.runtime?.playerId ?? pair.scoreboard?.playerId ?? "--" }}</td>
                        <td>
                          <span 
                            v-if="pair.scoreboard?.teamId" 
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
                              :title="pair.runtime?.stale ? '数据已过期' : '在线'"
                            ></span>
                            <span v-if="pair.scoreboard?.isCommander" class="badge badge--gold">指挥官</span>
                            <span v-if="pair.scoreboard?.isAdmin" class="badge badge--admin">Admin</span>
                          </div>
                        </td>
                        <td class="mono text-center font-bold text-green-glow">
                          {{ pair.scoreboard?.kills ?? 0 }}
                        </td>
                        <td class="mono text-center text-red-soft">
                          {{ pair.scoreboard?.deaths ?? 0 }}
                        </td>
                        <td class="mono text-center">
                          {{ pair.scoreboard?.woundeds ?? 0 }}
                        </td>
                        <td class="mono text-center text-muted">
                          {{ pair.scoreboard?.lives ?? 0 }}
                        </td>
                        <td class="mono text-center">
                          {{ pair.scoreboard?.teamworkScore ?? 0 }}
                        </td>
                        <td class="mono text-center">
                          {{ pair.scoreboard?.objectiveScore ?? 0 }}
                        </td>
                        <td class="mono text-center">
                          {{ pair.scoreboard?.combatScore ?? 0 }}
                        </td>
                        <td class="text-right" @click.stop>
                          <button 
                            type="button" 
                            class="btn btn-secondary btn-sm table-expand-btn"
                            @click="togglePlayerExpand(pair.playerIndex)"
                          >
                            {{ expandedPlayers[pair.playerIndex] ? "收起 ▲" : "详情 ▼" }}
                          </button>
                        </td>
                      </tr>
                      <!-- Expanded Detail Row -->
                      <tr v-if="expandedPlayers[pair.playerIndex]" class="detail-row" @click.stop>
                        <td colspan="13">
                          <div class="table-expanded-content">
                            <div class="expanded-grid">
                              <div class="grid-card">
                                <h5>📍 空间定位</h5>
                                <ul>
                                  <li><span>坐标 (X, Y, Z):</span> <strong class="mono">{{ formatVector(pair.runtime?.position) }}</strong></li>
                                  <li><span>偏航角 (Yaw):</span> <strong class="mono">{{ pair.runtime?.yaw ?? "--" }}°</strong></li>
                                </ul>
                              </div>
                              <div class="grid-card" v-if="pair.runtime?.combatInfo">
                                <h5>⚔️ 战斗信息</h5>
                                <p class="combat-info-text mono">{{ pair.runtime.combatInfo }}</p>
                              </div>
                              <div class="grid-card">
                                <h5>📈 评分明细</h5>
                                <div class="scores-inline">
                                  <span>治疗分: <strong>{{ pair.scoreboard?.healPoints ?? 0 }}</strong></span>
                                  <span>拉人分: <strong>{{ pair.scoreboard?.revivedPoints ?? 0 }}</strong></span>
                                  <span>队友伤害/TK: <strong class="text-danger">{{ pair.scoreboard?.teamKills ?? 0 }}</strong></span>
                                  <span>受伤数: <strong>{{ pair.scoreboard?.wounds ?? 0 }}</strong></span>
                                  <span>载具击杀: <strong>{{ pair.scoreboard?.vehicleKills ?? 0 }}</strong></span>
                                </div>
                              </div>
                            </div>

                            <details v-if="showRaw" class="player-json-details mt-10">
                              <summary>查看日志快照 JSON</summary>
                              <pre class="json-block">{{ pair.runtime ?? pair.scoreboard ?? {} }}</pre>
                            </details>
                          </div>
                        </td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- 3. CARD GRID VIEW -->
            <div v-else class="player-cards-grid-layout fade-in">
              <article 
                v-for="pair in sortedFilteredPairs" 
                :key="pair.playerIndex" 
                class="player-card player-card-compact"
                :class="[
                  getPlayerTeamClass(pair),
                  { 'player-card--expanded': expandedPlayers[pair.playerIndex] }
                ]"
              >
                <header class="player-card-head" @click="togglePlayerExpand(pair.playerIndex)">
                  <div class="player-identity">
                    <div class="name-row">
                      <span 
                        class="player-status-dot" 
                        :class="pair.runtime?.stale ? 'player-status-dot--stale' : 'player-status-dot--live'"
                      ></span>
                      <h4>
                        {{ getPlayerName(pair) || `Player ${pair.playerIndex}` }}
                        <span class="text-muted text-xs font-normal"> ({{ pair.playerIndex }})</span>
                      </h4>
                    </div>
                    <small class="mono">ID: {{ pair.runtime?.playerId ?? pair.scoreboard?.playerId ?? "--" }}</small>
                  </div>
                  
                  <div class="badges-row">
                    <span v-if="pair.scoreboard?.isCommander" class="badge badge--gold">指挥官</span>
                    <span v-if="pair.scoreboard?.isAdmin" class="badge badge--admin">Admin</span>
                    <span v-if="pair.scoreboard?.teamId" class="badge" :class="pair.scoreboard.teamId === 1 ? 'badge--blue' : 'badge--red'">
                      {{ getTeamChineseName(pair.scoreboard.teamId) || `Team ${pair.scoreboard.teamId}` }}
                    </span>
                    <span class="badge badge--team">Squad {{ pair.scoreboard?.squadId ?? "--" }}</span>
                  </div>
                </header>

                <div class="player-card-body">
                  <!-- Compact stats text -->
                  <div class="stats-compact-line font-medium text-xs font-mono">
                    <span>K: <strong>{{ pair.scoreboard?.kills ?? 0 }}</strong></span>
                    <span>D: <strong>{{ pair.scoreboard?.deaths ?? 0 }}</strong></span>
                    <span>W: <strong>{{ pair.scoreboard?.woundeds ?? 0 }}</strong></span>
                    <span>L: <strong class="text-muted">{{ pair.scoreboard?.lives ?? 0 }}</strong></span>
                  </div>

                  <div class="actions-row mt-4">
                    <button 
                      type="button" 
                      class="btn btn-secondary btn-sm w-full"
                      @click="togglePlayerExpand(pair.playerIndex)"
                    >
                      {{ expandedPlayers[pair.playerIndex] ? "折叠详情" : "展开全部详情" }}
                    </button>
                  </div>

                  <!-- Expanded details in grid card -->
                  <div v-if="expandedPlayers[pair.playerIndex]" class="expanded-card-details fade-in mt-6">
                    <hr class="card-divider" />
                    
                    <div class="coordinate-row mt-4">
                      <span class="label">坐标 (X, Y, Z)</span>
                      <strong class="mono">{{ formatVector(pair.runtime?.position) }}</strong>
                    </div>
                    <div class="coordinate-row">
                      <span class="label">偏航朝向 (Yaw)</span>
                      <strong class="mono">{{ pair.runtime?.yaw ?? "--" }}°</strong>
                    </div>
                    <div class="combat-log-row" v-if="pair.runtime?.combatInfo">
                      <span class="label">战息</span>
                      <span class="combat-info mono">{{ pair.runtime?.combatInfo }}</span>
                    </div>

                    <hr class="card-divider" />

                    <!-- Detailed Scoreboard Stats -->
                    <div class="score-stat-grid">
                      <div v-for="item in getScoreboardItems(pair.scoreboard)" :key="item.key" class="score-item">
                        <span class="score-label">{{ item.label }}</span>
                        <strong class="score-val" :class="{ 'score-val--nonzero': item.value && item.value > 0 }">
                          {{ item.value ?? 0 }}
                        </strong>
                      </div>
                    </div>

                    <!-- JSON block inside player -->
                    <details v-if="showRaw" class="player-json-details mt-4">
                      <summary>查看日志快照 JSON</summary>
                      <pre class="json-block">{{ pair.runtime ?? pair.scoreboard ?? {} }}</pre>
                    </details>
                  </div>
                </div>
              </article>
            </div>
          </div>
          
          <div v-else class="empty-list-state">
            <p>没有找到符合过滤或搜索条件的玩家数据。</p>
          </div>
        </div>
      </section>

      <!-- Right Column: Scene Objectives & FOBs -->
      <section class="dashboard-col side-panel">
        <div class="side-panel-scroll">
          <!-- Capture Zones -->
          <div class="objective-group">
            <header class="panel-header border-none">
              <h2>🚩 战场控制点 (Capture Zones)</h2>
            </header>
            <div v-if="payload?.captureZones && payload.captureZones.length > 0" class="obj-list">
              <div 
                v-for="zone in payload.captureZones" 
                :key="zone.name" 
                class="objective-item"
              >
                <div class="obj-meta">
                  <div class="obj-title">
                    <span class="lock-indicator" :class="{ 'lock-indicator--locked': zone.isLocked }">
                      {{ zone.isLocked ? "🔒" : "🔓" }}
                    </span>
                    <h4>{{ zone.name }}</h4>
                  </div>
                  <span class="direction-badge" v-if="zone.captureDirection">
                    {{ zone.captureDirection > 0 ? "顺推" : "逆推" }}
                  </span>
                </div>
                <div class="progress-wrap">
                  <div class="progress-info">
                    <span>控制百分比</span>
                    <strong>{{ ((zone.capturePercent ?? 0) * 100).toFixed(0) }}%</strong>
                  </div>
                  <div class="progress-track">
                    <div 
                      class="progress-fill" 
                      :class="{ 'progress-fill--locked': zone.isLocked }"
                      :style="{ width: ((zone.capturePercent ?? 0) * 100) + '%' }"
                    ></div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="empty-list-state small-padding">
              <p>未解析到控制点信息</p>
            </div>
          </div>

          <!-- FOBs -->
          <div class="objective-group">
            <header class="panel-header border-none">
              <h2>⛺ 前哨基地 (FOBs)</h2>
            </header>
            <div v-if="payload?.fobs && payload.fobs.length > 0" class="obj-list">
              <div 
                v-for="fob in payload.fobs" 
                :key="fob.fobId || fob.name" 
                class="objective-item fob-item"
                :class="{ 'fob-item--bleeding': fob.isBleeding }"
              >
                <div class="obj-meta">
                  <div class="obj-title">
                    <span 
                      class="team-pill" 
                      :class="fob.teamId === 1 ? 'team-pill--blue' : (fob.teamId === 2 ? 'team-pill--red' : 'team-pill--neutral')"
                    >
                      阵营 {{ fob.teamId ?? "?" }}
                    </span>
                    <h4>{{ fob.name || "FOB" }}</h4>
                  </div>
                  <span v-if="fob.isBleeding" class="bleeding-alert">🚨 流血中</span>
                </div>

                <div class="fob-resources">
                  <div class="res-item">
                    <span class="res-lbl">建材</span>
                    <span class="res-val text-gold">{{ fob.constructionPoints ?? fob.construction ?? 0 }}</span>
                  </div>
                  <div class="res-item">
                    <span class="res-lbl">弹药</span>
                    <span class="res-val text-gold">{{ fob.ammo ?? 0 }}</span>
                  </div>
                  <div class="res-item" v-if="fob.size">
                    <span class="res-lbl">规模</span>
                    <span class="res-val">{{ fob.size }}</span>
                  </div>
                </div>

                <div class="progress-wrap">
                  <div class="progress-info">
                    <span>生命值: {{ fob.health ?? 0 }} HP</span>
                  </div>
                  <div class="progress-track">
                    <div 
                      class="progress-fill" 
                      :class="fob.health && fob.health < 100 ? 'progress-fill--danger' : 'progress-fill--success'"
                      :style="{ width: Math.min(100, ((fob.health || 0) / 300) * 100) + '%' }"
                    ></div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="empty-list-state small-padding">
              <p>未解析到 FOB 信息</p>
            </div>
          </div>

          <!-- Main Zones -->
          <div class="objective-group" v-if="payload?.mainZones && payload.mainZones.length > 0">
            <header class="panel-header border-none">
              <h2>🏰 大本营 (Main Zones)</h2>
            </header>
            <div class="main-zones-list">
              <div 
                v-for="(zone, idx) in payload.mainZones" 
                :key="zone.teamId ?? idx" 
                class="main-zone-item"
                :class="zone.teamId === 1 ? 'main-zone-item--blue' : 'main-zone-item--red'"
              >
                <span>阵营 {{ zone.teamId ?? "未知" }}</span>
                <strong class="mono">{{ formatVector(zone.position) }}</strong>
              </div>
            </div>
          </div>

          <!-- Raw JSON blocks in scroll area -->
          <section class="raw-data-panel">
            <header class="raw-data-head">
              <div>
                <h2>原始数据日志分包 (Raw JSON Blocks)</h2>
                <p class="text-muted">{{ rawDataStatusLabel }}</p>
              </div>
              <button type="button" class="btn btn-secondary btn-sm" :disabled="rawLoading" @click="fetchRawData">
                <span v-if="rawLoading" class="spinner"></span>
                {{ rawLoading ? "读取中..." : "重新读取" }}
              </button>
            </header>

            <div class="raw-cards-list">
              <details class="raw-accordion">
                <summary>
                  <span>运行时玩家数据 (runtimePlayers)</span>
                  <button type="button" class="btn btn-secondary btn-sm copy-btn" @click.stop="copyToClipboard(runtimeRawBlock, 'runtime')">
                    {{ copiedBlock === 'runtime' ? '已复制 ✔' : '复制' }}
                  </button>
                </summary>
                <pre class="raw-code-block">{{ runtimeRawBlock }}</pre>
              </details>

              <details class="raw-accordion">
                <summary>
                  <span>战局记分板数据 (scoreboardPlayers)</span>
                  <button type="button" class="btn btn-secondary btn-sm copy-btn" @click.stop="copyToClipboard(scoreboardRawBlock, 'scoreboard')">
                    {{ copiedBlock === 'scoreboard' ? '已复制 ✔' : '复制' }}
                  </button>
                </summary>
                <pre class="raw-code-block">{{ scoreboardRawBlock }}</pre>
              </details>

              <details class="raw-accordion">
                <summary>
                  <span>据点及要塞数据 (sceneZones)</span>
                  <button type="button" class="btn btn-secondary btn-sm copy-btn" @click.stop="copyToClipboard(sceneRawBlock, 'scene')">
                    {{ copiedBlock === 'scene' ? '已复制 ✔' : '复制' }}
                  </button>
                </summary>
                <pre class="raw-code-block">{{ sceneRawBlock }}</pre>
              </details>
            </div>
          </section>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from "vue";
import {
  fetchBzssCorePlayerInfoList,
  fetchBzssCoreRawData,
  streamBzssCorePlayerInfoList,
  type BzssCorePlayerInfoResponse,
  type BzssCoreRawDataResponse,
  type BzssCoreRuntimePlayerInfo,
  type BzssCoreScoreboardPlayerInfo,
} from "../app/bzssCoreApi";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";
import { useSquadStore } from "../stores/squad.store";
import { useServerStore } from "../stores/server.store";
import { usePlayerStore } from "../stores/player.store";
import { getChineseNameFromTeamName } from "../shared/faction-assets/faction-data";

type PlayerPair = {
  playerIndex: number | string;
  runtime: BzssCoreRuntimePlayerInfo | null;
  scoreboard: BzssCoreScoreboardPlayerInfo | null;
};

// Core reactive states
const payload = ref<BzssCorePlayerInfoResponse | null>(null);
const rawData = ref<BzssCoreRawDataResponse | null>(null);
const loading = ref(false);
const rawLoading = ref(false);
const error = ref("");
const rawError = ref("");
const query = ref("");
const showRaw = ref(false);
const active = ref(true);

const viewMode = ref<'squad' | 'table' | 'grid'>('squad');
const teamFilter = ref<'all' | '1' | '2' | 'unassigned'>('all');
const sortKey = ref<string>('playerIndex');
const sortOrder = ref<'asc' | 'desc'>('asc');
const expandedPlayers = ref<Record<string | number, boolean>>({});

const squadStore = useSquadStore();
const serverStore = useServerStore();
const playerStore = usePlayerStore();

function getPlayerName(pair: PlayerPair) {
  const playerId = pair.runtime?.playerId ?? pair.scoreboard?.playerId;
  if (playerId != null) {
    const p = playerStore.byPlayerID[playerId];
    if (p?.name) return p.name;
  }
  return "";
}

const teamNames = computed(() => {
  let t1Raw = "";
  let t2Raw = "";
  
  const t1Squad = squadStore.list.find((s) => s.teamID === 1);
  if (t1Squad?.teamName) t1Raw = t1Squad.teamName;
  const t2Squad = squadStore.list.find((s) => s.teamID === 2);
  if (t2Squad?.teamName) t2Raw = t2Squad.teamName;
  
  const snapshotTeams = serverStore.snapshot?.matchState?.teams;
  if (Array.isArray(snapshotTeams)) {
    const t1 = snapshotTeams.find((t: any) => t.teamId === 1 || t.teamID === 1);
    if (t1?.teamName) t1Raw = t1.teamName;
    const t2 = snapshotTeams.find((t: any) => t.teamId === 2 || t.teamID === 2);
    if (t2?.teamName) t2Raw = t2.teamName;
  }
  
  const webStatus = serverStore.snapshot?.webStatus;
  if (webStatus) {
    if (webStatus.team1Name) t1Raw = webStatus.team1Name;
    if (webStatus.team2Name) t2Raw = webStatus.team2Name;
  }
  
  const t1Ch = t1Raw ? getChineseNameFromTeamName(t1Raw) : "Team 1";
  const t2Ch = t2Raw ? getChineseNameFromTeamName(t2Raw) : "Team 2";
  
  return {
    1: t1Ch !== "Team 1" ? `${t1Ch} (Team 1)` : "Team 1",
    2: t2Ch !== "Team 2" ? `${t2Ch} (Team 2)` : "Team 2",
    t1Raw: t1Raw || "Team 1",
    t2Raw: t2Raw || "Team 2",
  };
});

function getTeamChineseName(teamId: number) {
  if (teamId === 1) return getChineseNameFromTeamName(teamNames.value.t1Raw);
  if (teamId === 2) return getChineseNameFromTeamName(teamNames.value.t2Raw);
  return "";
}

function togglePlayerExpand(playerIndex: string | number) {
  expandedPlayers.value[playerIndex] = !expandedPlayers.value[playerIndex];
}

function handleSort(key: string) {
  if (sortKey.value === key) {
    sortOrder.value = sortOrder.value === "asc" ? "desc" : "asc";
  } else {
    sortKey.value = key;
    sortOrder.value = "desc";
  }
}



let refreshTimer: number | null = null;
let closeStream: (() => void) | null = null;

const runtimePlayers = computed(() => payload.value?.runtimePlayers ?? []);
const scoreboardPlayers = computed(() => payload.value?.scoreboardPlayers ?? []);

// Total Scene elements
const totalSceneCount = computed(() => {
  return (payload.value?.captureZones?.length ?? 0) + 
         (payload.value?.fobs?.length ?? 0) + 
         (payload.value?.mainZones?.length ?? 0);
});

// Resolve full Player list sorted by index
const playerPairs = computed<PlayerPair[]>(() => {
  const map = new Map<string, PlayerPair>();
  const addPlayer = (player: BzssCoreRuntimePlayerInfo | BzssCoreScoreboardPlayerInfo | undefined, side: "runtime" | "scoreboard") => {
    if (!player) return;
    const key = String(player.playerIndex ?? player.playerId ?? "");
    if (!key) return;
    const current = map.get(key) ?? { playerIndex: player.playerIndex ?? player.playerId ?? key, runtime: null, scoreboard: null };
    if (side === "runtime") current.runtime = player as BzssCoreRuntimePlayerInfo;
    if (side === "scoreboard") current.scoreboard = player as BzssCoreScoreboardPlayerInfo;
    map.set(key, current);
  };
  runtimePlayers.value.forEach((player) => addPlayer(player, "runtime"));
  scoreboardPlayers.value.forEach((player) => addPlayer(player, "scoreboard"));
  return [...map.values()].sort((a, b) => Number(a.playerIndex) - Number(b.playerIndex));
});

const teamCounts = computed(() => {
  let t1 = 0;
  let t2 = 0;
  let unassigned = 0;
  playerPairs.value.forEach((p) => {
    const t = p.scoreboard?.teamId;
    if (t === 1) t1++;
    else if (t === 2) t2++;
    else unassigned++;
  });
  return {
    all: playerPairs.value.length,
    t1,
    t2,
    unassigned,
  };
});

// Sub-filters with searches applied
const filteredPairs = computed(() => {
  const needle = query.value.trim().toLowerCase();
  let list = playerPairs.value;

  if (teamFilter.value === "1") {
    list = list.filter((p) => p.scoreboard?.teamId === 1);
  } else if (teamFilter.value === "2") {
    list = list.filter((p) => p.scoreboard?.teamId === 2);
  } else if (teamFilter.value === "unassigned") {
    list = list.filter((p) => p.scoreboard?.teamId !== 1 && p.scoreboard?.teamId !== 2);
  }

  if (!needle) return list;
  return list.filter((pair) => {
    const values = [
      pair.playerIndex,
      pair.runtime?.playerId,
      pair.runtime?.combatInfo,
      pair.scoreboard?.playerId,
      pair.scoreboard?.teamId,
      pair.scoreboard?.squadId,
    ];
    return values.some((value) => String(value ?? "").toLowerCase().includes(needle));
  });
});

const sortedFilteredPairs = computed(() => {
  const list = [...filteredPairs.value];
  const key = sortKey.value;
  const order = sortOrder.value === "asc" ? 1 : -1;

  list.sort((a, b) => {
    let valA: any = null;
    let valB: any = null;

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

type SquadGroup = {
  squadId: number | string;
  players: PlayerPair[];
};

type TeamGroup = {
  teamId: number;
  label: string;
  squads: SquadGroup[];
};

const squadGroupedTeams = computed(() => {
  const teamsMap = new Map<number, Map<string | number, PlayerPair[]>>();
  teamsMap.set(1, new Map<string | number, PlayerPair[]>());
  teamsMap.set(2, new Map<string | number, PlayerPair[]>());
  teamsMap.set(0, new Map<string | number, PlayerPair[]>());

  filteredPairs.value.forEach((pair) => {
    const teamId = pair.scoreboard?.teamId ?? 0;
    if (!teamsMap.has(teamId)) {
      teamsMap.set(teamId, new Map<string | number, PlayerPair[]>());
    }

    const teamSquads = teamsMap.get(teamId)!;
    const squadId = pair.scoreboard?.squadId ?? 0;

    if (!teamSquads.has(squadId)) {
      teamSquads.set(squadId, []);
    }
    teamSquads.get(squadId)!.push(pair);
  });

  const result: TeamGroup[] = [];
  [1, 2, 0].forEach((teamId) => {
    const squadsMap = teamsMap.get(teamId);
    if (!squadsMap || squadsMap.size === 0) return;

    const squadsList: SquadGroup[] = [];
    squadsMap.forEach((players, squadId) => {
      players.sort((a, b) => {
        if (a.scoreboard?.isCommander && !b.scoreboard?.isCommander) return -1;
        if (!a.scoreboard?.isCommander && b.scoreboard?.isCommander) return 1;
        return Number(a.playerIndex) - Number(b.playerIndex);
      });
      squadsList.push({ squadId, players });
    });

    squadsList.sort((a, b) => {
      const idA = Number(a.squadId);
      const idB = Number(b.squadId);
      if (idA === 0) return 1;
      if (idB === 0) return -1;
      return idA - idB;
    });

    let label = `阵营 ${teamId}`;
    if (teamId === 1) label = teamNames.value[1];
    if (teamId === 2) label = teamNames.value[2];
    if (teamId === 0) label = "未分配/旁观";

    result.push({
      teamId,
      label,
      squads: squadsList,
    });
  });

  return result;
});


// Get team CSS classes
function getPlayerTeamClass(pair: PlayerPair) {
  const teamId = pair.scoreboard?.teamId;
  if (teamId === 1) return "player-card--blue";
  if (teamId === 2) return "player-card--red";
  return "";
}

// JSON Block strings
const runtimeRawBlock = computed(() => JSON.stringify(runtimePlayers.value, null, 2));
const scoreboardRawBlock = computed(() => JSON.stringify(scoreboardPlayers.value, null, 2));
const sceneRawBlock = computed(() => JSON.stringify({
  captureZones: payload.value?.captureZones ?? [],
  fobs: payload.value?.fobs ?? [],
  mainZones: payload.value?.mainZones ?? [],
}, null, 2));

// Clipboard copy helper
const copiedBlock = ref<string | null>(null);
async function copyToClipboard(text: string, blockName: string) {
  try {
    await navigator.clipboard.writeText(text);
    copiedBlock.value = blockName;
    setTimeout(() => {
      if (copiedBlock.value === blockName) copiedBlock.value = null;
    }, 2000);
  } catch (err) {
    // ignore
  }
}

// Parsed texts labels
const rawDataStatusLabel = computed(() => {
  const data = rawData.value;
  if (!data) return "未载入任何原始快照文件块。";
  if (data.lastError) return `解析错误: ${data.lastError}`;
  return `原始包同步于 ${formatDateTime(data.updatedAt)}，更新正常。`;
});

const statusLabel = computed(() => {
  const status = String(payload.value?.status ?? "").trim();
  if (status === "ready") return "已解析";
  if (status === "error") return "解析失败";
  if (status === "unavailable") return "不可用";
  return "空闲中";
});

const statusColorClass = computed(() => {
  const status = String(payload.value?.status ?? "").trim();
  if (status === "ready") return "text-success";
  if (status === "error") return "text-danger";
  return "text-warning";
});

const statusDetail = computed(() => {
  const state = payload.value?.state;
  if (!state) return "无运行期信息。";
  if (state.lastError) return `错误: ${state.lastError}`;
  if (state.updatedAt) return `同步时间: ${formatDateTime(state.updatedAt)}`;
  return "等待轮询首包中...";
});

// Data fetches
async function fetchData() {
  if (!active.value) return;
  loading.value = true;
  error.value = "";
  try {
    payload.value = await fetchBzssCorePlayerInfoList();
  } catch (err: any) {
    error.value = err?.message ?? "加载 BZSS-Core 玩家快照列表失败。";
  } finally {
    loading.value = false;
  }
}

async function fetchRawData() {
  rawLoading.value = true;
  rawError.value = "";
  try {
    rawData.value = await fetchBzssCoreRawData();
  } catch (err: any) {
    rawError.value = err?.message ?? "读取原始日志数据分块失败。";
  } finally {
    rawLoading.value = false;
  }
}

function scheduleRefresh() {
  clearRefresh();
  refreshTimer = window.setTimeout(async () => {
    if (active.value && canAutoRefreshNow() && !closeStream) {
      await fetchData();
    }
    scheduleRefresh();
  }, closeStream ? 1500 : 1000);
}

function clearRefresh() {
  if (refreshTimer != null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function startStream() {
  if (closeStream || typeof EventSource === "undefined") return;
  closeStream = streamBzssCorePlayerInfoList(
    (data) => {
      if (!active.value) return;
      payload.value = data;
      error.value = "";
      loading.value = false;
    },
    (_err, source) => {
      if (!active.value) return;
      if (source.readyState === EventSource.CLOSED) {
        stopStream();
        scheduleRefresh();
      }
    },
  );
}

function stopStream() {
  if (!closeStream) return;
  closeStream();
  closeStream = null;
}

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

function getScoreboardItems(player?: BzssCoreScoreboardPlayerInfo | null) {
  const values: Array<[string, string, number | null | undefined]> = [
    ["lives", "复活次数", player?.lives],
    ["kills", "击杀数", player?.kills],
    ["deaths", "死亡数", player?.deaths],
    ["woundeds", "击倒 (Wounded)", player?.woundeds],
    ["wounds", "受伤", player?.wounds],
    ["teamKills", "队友击杀 (TK)", player?.teamKills],
    ["healPoints", "治疗分", player?.healPoints],
    ["revivedPoints", "复苏分", player?.revivedPoints],
    ["teamworkScore", "团队得分", player?.teamworkScore],
    ["objectiveScore", "目标得分", player?.objectiveScore],
    ["combatScore", "战斗得分", player?.combatScore],
  ];
  return values.map(([key, label, value]) => ({ key, label, value }));
}

// Lifecycle Events
onMounted(async () => {
  await fetchData();
  await fetchRawData();
  startStream();
  scheduleRefresh();
});

onActivated(() => {
  active.value = true;
  startStream();
  scheduleRefresh();
});

onDeactivated(() => {
  active.value = false;
  stopStream();
  clearRefresh();
});

onBeforeUnmount(() => {
  active.value = false;
  stopStream();
  clearRefresh();
});
</script>

<style scoped>
/* Page Layout */
.bzss-page {
  position: relative;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  overflow: hidden;
  background: var(--color-bg-page);
}

/* Common Typography & Classes */
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
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
.text-gold {
  color: var(--color-status-warning) !important;
}

/* Spinner component */
.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  border-top-color: #fff;
  animation: spin 0.8s linear infinite;
  margin-right: 6px;
  vertical-align: middle;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Fade-in Animation */
.fade-in {
  animation: fadeIn 0.35s ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Buttons Styling */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--control-height-md, 34px);
  padding: 0 16px;
  border-radius: var(--control-radius, 10px);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid transparent;
}
.btn-secondary {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
}
.btn-secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 255, 255, 0.25);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none !important;
  box-shadow: none !important;
}
.btn-sm {
  height: var(--control-height-sm, 30px);
  padding: 0 10px;
  font-size: 12px;
}

/* Hero Section */
.page-hero {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--color-border-soft);
}
.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.title-row h1 {
  font-size: 18px;
  font-weight: 800;
  margin: 0;
  background: linear-gradient(135deg, var(--color-text-primary) 30%, var(--color-brand-primary) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.stream-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 99px;
  font-size: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-soft);
  color: var(--color-text-secondary);
}
.stream-badge--active {
  color: var(--color-status-success);
  border-color: rgba(52, 211, 153, 0.2);
  background: rgba(52, 211, 153, 0.04);
}
.pulse-dot {
  width: 5px;
  height: 5px;
  background: var(--color-text-disabled);
  border-radius: 50%;
}
.stream-badge--active .pulse-dot {
  background: var(--color-status-success);
  animation: pulse 1.6s infinite alternate;
}
@keyframes pulse {
  0% { transform: scale(0.9); box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.7); }
  100% { transform: scale(1.1); box-shadow: 0 0 0 4px rgba(52, 211, 153, 0); }
}

/* Error Banner */
.error-banner {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(248, 113, 113, 0.08);
  border: 1px solid rgba(248, 113, 113, 0.2);
  color: var(--color-text-primary);
  font-size: 12px;
}
.warning-icon {
  font-size: 14px;
  color: var(--color-status-danger);
}
.error-content strong {
  font-weight: 700;
}

/* Compact Ribbon Status Bar */
.status-ribbon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border-soft);
  font-size: 12px;
}
.status-item {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.status-dot-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-disabled);
}
.status-dot-indicator.ready {
  background: var(--color-status-success);
  box-shadow: 0 0 6px var(--color-status-success);
}
.status-dot-indicator.error {
  background: var(--color-status-danger);
  box-shadow: 0 0 6px var(--color-status-danger);
}
.status-separator {
  color: var(--color-border-default);
  font-weight: 300;
  user-select: none;
}
.status-item .lbl {
  color: var(--color-text-muted);
}
.status-item .val {
  font-weight: 700;
  color: var(--color-text-primary);
}
.status-item .sub {
  font-size: 11px;
  color: var(--color-text-disabled);
}

/* Dashboard Columns Layout */
.dashboard-layout {
  flex: 1;
  min-height: 0; /* Critical for fixed layout nested scroll */
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 16px;
  overflow: hidden;
}
@media (max-width: 1024px) {
  .dashboard-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
.dashboard-col {
  height: 100%;
  box-sizing: border-box;
  border-radius: var(--card-radius, 14px);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  backdrop-filter: blur(12px);
  box-shadow: var(--theme-panel-glow);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

/* Header inside panel */
.panel-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--color-border-soft);
  padding-bottom: 8px;
}
.border-none {
  border-bottom: none;
  padding-bottom: 0;
}
.panel-header h2 {
  font-size: 13px;
  font-weight: 700;
  margin: 0;
  color: var(--color-text-primary);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

/* Search Box */
.search-box {
  position: relative;
  width: 180px;
}
.search-input {
  width: 100%;
  height: var(--control-height-sm, 30px);
  padding: 0 24px 0 8px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--color-border-default);
  border-radius: var(--control-radius, 10px);
  color: var(--color-text-primary);
  font-size: 12px;
  transition: all 0.2s ease;
  outline: none;
}
.search-input:focus {
  border-color: var(--color-brand-primary);
  background: rgba(0, 0, 0, 0.3);
}
.clear-search {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: 11px;
}
.clear-search:hover {
  color: var(--color-text-primary);
}

/* Toggle Switch */
.toggle-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.toggle-switch input {
  display: none;
}
.toggle-switch .slider {
  position: relative;
  width: 32px;
  height: 16px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 99px;
  transition: background 0.3s;
}
.toggle-switch .slider::after {
  content: "";
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #fff;
  top: 3px;
  left: 3px;
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.toggle-switch input:checked + .slider {
  background: var(--color-brand-primary);
}
.toggle-switch input:checked + .slider::after {
  transform: translateX(16px);
}
.toggle-switch .label-text {
  font-size: 11px;
  color: var(--color-text-secondary);
}

/* New layout headers & wrappers */
.panel-header-wrapper {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-bottom: 1px solid var(--color-border-soft);
  padding-bottom: 12px;
}
.panel-header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.panel-header-top h2 {
  font-size: 14px;
  font-weight: 700;
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: var(--color-text-primary);
}
.header-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

/* View Switcher button group */
.view-switcher {
  display: inline-flex;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--color-border-soft);
  border-radius: var(--control-radius, 8px);
  padding: 2px;
  gap: 2px;
}
.switcher-btn {
  background: transparent;
  border: none;
  border-radius: calc(var(--control-radius, 8px) - 2px);
  padding: 4px 10px;
  font-size: 11px;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s ease;
  white-space: nowrap;
}
.switcher-btn:hover {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.03);
}
.switcher-btn--active {
  color: #fff !important;
  background: var(--color-brand-primary) !important;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

/* Team Filter Tabs */
.filter-tabs-wrapper {
  overflow-x: auto;
  scrollbar-width: none;
}
.filter-tabs-wrapper::-webkit-scrollbar {
  display: none;
}
.filter-tabs {
  display: flex;
  gap: 8px;
}
.tab-btn {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border-soft);
  border-radius: 99px;
  padding: 4px 12px;
  font-size: 11px;
  color: var(--color-text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s ease;
  font-weight: 500;
}
.tab-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.2);
  color: var(--color-text-primary);
}
.tab-btn--active {
  background: rgba(255, 255, 255, 0.08) !important;
  border-color: var(--color-text-primary) !important;
  color: var(--color-text-primary) !important;
}
.tab-btn--blue.tab-btn--active {
  background: rgba(55, 200, 255, 0.15) !important;
  border-color: var(--color-brand-primary) !important;
  color: var(--color-brand-primary) !important;
}
.tab-btn--red.tab-btn--active {
  background: rgba(255, 155, 69, 0.15) !important;
  border-color: var(--color-brand-secondary) !important;
  color: var(--color-brand-secondary) !important;
}
.tab-badge {
  font-size: 9px;
  background: rgba(0, 0, 0, 0.3);
  padding: 1px 5px;
  border-radius: 99px;
  font-weight: bold;
}

/* Squad grouped view layout */
.squad-teams-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  width: 100%;
}
@media (max-width: 1200px) {
  .squad-teams-container {
    grid-template-columns: 1fr;
  }
}
.team-column {
  background: rgba(0, 0, 0, 0.1);
  border: 1px solid var(--color-border-soft);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.team-column--blue {
  border-top: 3px solid var(--color-brand-primary);
}
.team-column--red {
  border-top: 3px solid var(--color-brand-secondary);
}
.team-column--neutral {
  border-top: 3px solid var(--color-text-muted);
}
.team-column-title {
  font-size: 13px;
  font-weight: 700;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-primary);
  text-transform: uppercase;
}
.team-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.team-column--blue .team-dot { background: var(--color-brand-primary); box-shadow: 0 0 6px var(--color-brand-primary); }
.team-column--red .team-dot { background: var(--color-brand-secondary); box-shadow: 0 0 6px var(--color-brand-secondary); }
.team-column--neutral .team-dot { background: var(--color-text-muted); }
.team-player-count {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-muted);
}

.squads-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.squad-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.squad-card-header {
  background: rgba(255, 255, 255, 0.03);
  padding: 4px 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid var(--color-border-soft);
}
.squad-icon {
  font-size: 12px;
}
.squad-name {
  font-size: 12px;
  color: var(--color-text-secondary);
  flex: 1;
}
.squad-count {
  font-size: 9px;
  padding: 2px 6px;
}
.squad-players-list {
  display: flex;
  flex-direction: column;
}
.squad-player-row-wrapper {
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
}
.squad-player-row-wrapper:last-child {
  border-bottom: none;
}
.squad-player-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  cursor: pointer;
  transition: background 0.2s ease;
  user-select: none;
}
.squad-player-row:hover {
  background: rgba(255, 255, 255, 0.03);
}
.squad-player-row--expanded {
  background: rgba(255, 255, 255, 0.04) !important;
}
.sq-player-main {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sq-player-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
}
.sq-player-badges {
  display: flex;
  gap: 2px;
}
.sq-player-stats-compact {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.sq-player-stats-compact .stat {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-weight: 500;
}

/* Squad player expansion details */
.sq-player-detail-expanded {
  background: rgba(0, 0, 0, 0.2);
  padding: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.02);
  display: flex;
  flex-direction: column;
  gap: 8px;
  animation: slideDown 0.2s ease-out;
}
@keyframes slideDown {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  font-size: 11px;
}
.detail-item {
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-item strong {
  color: var(--color-text-muted);
}
.scores-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.score-badge {
  font-size: 9px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.05);
  padding: 1px 4px;
  border-radius: 4px;
  color: var(--color-text-secondary);
  font-family: ui-monospace, SFMono-Regular, monospace;
}

/* Table view layout */
.table-view-container {
  width: 100%;
  overflow: hidden;
}
.table-responsive {
  width: 100%;
  overflow-x: auto;
  border-radius: 8px;
  border: 1px solid var(--color-border-soft);
  background: rgba(0, 0, 0, 0.15);
}
.player-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
.player-table th, .player-table td {
  padding: 6px 8px;
  font-size: 11px;
  border-bottom: 1px solid var(--color-border-soft);
  vertical-align: middle;
}
.player-table th {
  background: rgba(255, 255, 255, 0.02);
  font-weight: 700;
  color: var(--color-text-muted);
  user-select: none;
  font-size: 11px;
  text-transform: uppercase;
}
.player-table th.sortable {
  cursor: pointer;
}
.player-table th.sortable:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
}
.player-row {
  cursor: pointer;
  transition: background 0.2s ease;
}
.player-row:hover {
  background: rgba(255, 255, 255, 0.03);
}
.player-row--expanded {
  background: rgba(255, 255, 255, 0.04) !important;
}
.player-row--blue td:first-child {
  border-left: 3px solid var(--color-brand-primary);
}
.player-row--red td:first-child {
  border-left: 3px solid var(--color-brand-secondary);
}
.text-center {
  text-align: center !important;
}
.text-right {
  text-align: right !important;
}
.flex-inline {
  display: inline-flex;
  align-items: center;
}
.gap-4 { gap: 4px; }
.flex-column {
  display: flex;
  flex-direction: column;
}
.gap-12 { gap: 12px; }
.w-full { width: 100%; }
.mt-4 { margin-top: 4px; }
.mt-6 { margin-top: 6px; }
.mt-10 { margin-top: 10px; }
.font-bold { font-weight: 700; }
.text-green-glow {
  color: #34d399 !important;
  text-shadow: 0 0 4px rgba(52, 211, 153, 0.2);
}
.text-red-soft {
  color: #f87171 !important;
}
.table-expand-btn {
  height: 24px;
  padding: 0 8px;
  font-size: 11px;
}

/* Detail expanded row inside table */
.detail-row {
  background: rgba(0, 0, 0, 0.25);
}
.table-expanded-content {
  padding: 12px 16px;
  animation: slideDown 0.2s ease-out;
}
.expanded-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}
.grid-card {
  background: rgba(255, 255, 255, 0.01);
  border: 1px solid rgba(255, 255, 255, 0.03);
  border-radius: 6px;
  padding: 10px;
}
.grid-card h5 {
  margin: 0 0 6px 0;
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
}
.grid-card ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
}
.grid-card ul li {
  display: flex;
  justify-content: space-between;
}
.grid-card ul li span {
  color: var(--color-text-muted);
}
.combat-info-text {
  font-size: 11px;
  color: var(--color-text-secondary);
  line-height: 1.4;
  margin: 0;
  word-break: break-all;
  white-space: pre-wrap;
}
.scores-inline {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  font-size: 11px;
}
.scores-inline span {
  color: var(--color-text-muted);
}
.scores-inline span strong {
  color: var(--color-text-secondary);
}

/* Card Grid view layout */
.player-cards-grid-layout {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  width: 100%;
}
.player-card-compact {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.player-card-compact:hover {
  background: rgba(255, 255, 255, 0.035);
  border-color: rgba(255, 255, 255, 0.15);
}
.player-card-compact.player-card--expanded {
  background: rgba(255, 255, 255, 0.04);
}
.stats-compact-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.015);
  border-radius: 4px;
  padding: 4px 8px;
}
.stats-compact-line span {
  color: var(--color-text-muted);
}
.stats-compact-line strong {
  color: var(--color-text-secondary);
}
.expanded-card-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.player-list-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.player-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: all 0.22s ease;
}
.player-card:hover {
  background: rgba(255, 255, 255, 0.035);
  border-color: rgba(255, 255, 255, 0.15);
}
.player-card--blue {
  border-left: 3px solid var(--color-brand-primary);
}
.player-card--red {
  border-left: 3px solid var(--color-brand-secondary);
}
.player-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.player-identity .name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.player-identity h4 {
  font-size: 13px;
  font-weight: 700;
  margin: 0;
  color: var(--color-text-primary);
}
.player-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.player-status-dot--live {
  background: var(--color-status-success);
  box-shadow: 0 0 6px var(--color-status-success);
}
.player-status-dot--stale {
  background: var(--color-status-warning);
}
.player-identity small {
  display: block;
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 1px;
}
.badges-row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.badge {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-soft);
  color: var(--color-text-secondary);
  font-weight: 500;
}
.badge--gold {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.3);
  color: #fbbf24;
}
.badge--admin {
  background: rgba(244, 114, 182, 0.12);
  border-color: rgba(244, 114, 182, 0.3);
  color: #f472b6;
}
.badge--blue {
  background: rgba(55, 200, 255, 0.12);
  border-color: rgba(55, 200, 255, 0.3);
  color: var(--color-brand-primary);
}
.badge--red {
  background: rgba(255, 155, 69, 0.12);
  border-color: rgba(255, 155, 69, 0.3);
  color: var(--color-brand-secondary);
}

.player-card-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.coordinate-row, .combat-log-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}
.coordinate-row .label, .combat-log-row .label {
  color: var(--color-text-muted);
}
.coordinate-row strong {
  color: var(--color-text-secondary);
}
.combat-info {
  max-width: 200px;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-secondary);
}
.card-divider {
  border: 0;
  height: 1px;
  background: var(--color-border-soft);
  margin: 4px 0;
}

/* Stats grid */
.score-stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}
@media (max-width: 600px) {
  .score-stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.score-item {
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.01);
  border: 1px solid rgba(255, 255, 255, 0.015);
  border-radius: 4px;
  padding: 3px 5px;
}
.score-label {
  font-size: 8px;
  color: var(--color-text-muted);
}
.score-val {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-secondary);
}
.score-val--nonzero {
  color: var(--color-text-primary);
}

.player-json-details {
  margin-top: 6px;
}
.player-json-details summary {
  font-size: 10px;
  color: var(--color-brand-primary);
  cursor: pointer;
  user-select: none;
}
.player-json-details summary:hover {
  text-decoration: underline;
}
.json-block {
  margin: 4px 0 0;
  padding: 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.25);
  font-size: 11px;
  overflow: auto;
  max-height: 100px;
  border: 1px solid var(--color-border-soft);
}


/* Scroll wrapper for side panel */
.side-panel-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}

/* Right column Objectives & FOBs */
.objective-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(255, 255, 255, 0.01);
  border-radius: 10px;
  border: 1px solid var(--color-border-soft);
  padding: 10px;
}
.obj-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.objective-item {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.obj-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.obj-title {
  display: flex;
  align-items: center;
  gap: 4px;
}
.obj-title h4 {
  font-size: 12px;
  font-weight: bold;
  margin: 0;
}
.lock-indicator {
  font-size: 10px;
}
.direction-badge {
  font-size: 9px;
  color: var(--color-text-muted);
}
.progress-wrap {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.progress-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 9px;
  color: var(--color-text-muted);
}
.progress-track {
  height: 4px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 2px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--color-brand-primary);
}
.progress-fill--locked {
  background: var(--color-text-disabled);
}

/* FOB Item Cards */
.fob-item--bleeding {
  border-color: rgba(248, 113, 113, 0.4);
}
.bleeding-alert {
  font-size: 9px;
  font-weight: bold;
  color: var(--color-status-danger);
}
.team-pill {
  font-size: 8px;
  padding: 1px 3px;
  border-radius: 3px;
  font-weight: bold;
}
.team-pill--blue { background: rgba(55, 200, 255, 0.15); color: var(--color-brand-primary); }
.team-pill--red { background: rgba(255, 155, 69, 0.15); color: var(--color-brand-secondary); }
.team-pill--neutral { background: rgba(255, 255, 255, 0.08); color: var(--color-text-secondary); }

.fob-resources {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
}
.res-item {
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.01);
  border: 1px solid rgba(255, 255, 255, 0.015);
  border-radius: 4px;
  padding: 3px;
}
.res-lbl {
  font-size: 8px;
  color: var(--color-text-muted);
}
.res-val {
  font-size: 10px;
  font-weight: 800;
  margin-top: 1px;
}
.progress-fill--success { background: var(--color-status-success); }
.progress-fill--danger { background: var(--color-status-danger); }

/* Main zones list */
.main-zones-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.main-zone-item {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-border-soft);
  background: rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.main-zone-item span {
  font-size: 10px;
  color: var(--color-text-muted);
}
.main-zone-item strong {
  font-size: 11px;
  color: var(--color-text-primary);
}
.main-zone-item--blue { border-left: 3px solid var(--color-brand-primary); }
.main-zone-item--red { border-left: 3px solid var(--color-brand-secondary); }

/* Empty state list styles */
.empty-list-state {
  text-align: center;
  padding: 20px 10px;
  color: var(--color-text-muted);
  font-size: 11px;
  border: 1px dashed var(--color-border-soft);
  border-radius: 8px;
}
.small-padding {
  padding: 10px;
}

/* Bottom Raw Blocks Panel */
.raw-data-panel {
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.1);
  border: 1px solid var(--color-border-default);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.raw-data-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--color-border-soft);
  padding-bottom: 6px;
}
.raw-data-head h2 {
  font-size: 13px;
  font-weight: 700;
  margin: 0;
  color: var(--color-text-primary);
}
.raw-data-head p {
  font-size: 11px;
  margin-top: 2px;
}
.raw-meta-row {
  display: flex;
  gap: 12px;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.16);
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-border-soft);
}
.raw-meta-row strong {
  color: var(--color-text-primary);
}

.raw-cards-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.raw-accordion {
  border: 1px solid var(--color-border-soft);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.1);
  overflow: hidden;
}
.raw-accordion summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  font-weight: bold;
  color: var(--color-text-secondary);
}
.raw-accordion summary::-webkit-details-marker {
  display: none;
}
.copy-btn {
  height: 22px;
  padding: 0 6px;
  font-size: 10px;
}
.raw-code-block {
  margin: 0;
  padding: 8px;
  max-height: 150px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  background: rgba(0, 0, 0, 0.3);
  color: var(--color-text-primary);
  border-top: 1px solid var(--color-border-soft);
}
</style>
