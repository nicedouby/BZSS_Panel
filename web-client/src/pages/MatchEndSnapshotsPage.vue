<template>
  <AppPage full-bleed>
    <AppPageHeader
      title="对局结束快照"
      subtitle="以对局为单位管理战绩图片、冻结数据与独立调试存档。"
      :status-items="headerStatusItems"
    >
      <template #actions>
        <button type="button" class="action-btn ghost" :disabled="loading" @click="loadAll">
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          {{ loading ? "刷新中..." : "刷新记录" }}
        </button>
        <button type="button" class="action-btn accent" :disabled="debugCapturing" @click="captureDebugSnapshot">
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v16m8-8H4"/></svg>
          {{ debugCapturing ? "写入中..." : "写入调试快照" }}
        </button>
      </template>
    </AppPageHeader>

    <!-- Top KPI Summary Bar -->
    <div class="kpi-strip">
      <div class="kpi-strip-item">
        <span class="kpi-icon-dot cyan"></span>
        <span class="kpi-strip-label">总快照数量</span>
        <strong class="kpi-strip-val">{{ statistics.total }}</strong>
        <small class="kpi-sub-text">(正式 {{ statistics.official }} / 调试 {{ statistics.debug }})</small>
      </div>
      <div class="kpi-strip-divider"></div>
      <div class="kpi-strip-item">
        <span class="kpi-icon-dot emerald"></span>
        <span class="kpi-strip-label">存储空间</span>
        <strong class="kpi-strip-val">{{ formatBytes(statistics.size) }}</strong>
      </div>
      <div class="kpi-strip-divider"></div>
      <div class="kpi-strip-item">
        <span class="kpi-icon-dot purple"></span>
        <span class="kpi-strip-label">本月新增</span>
        <strong class="kpi-strip-val">{{ statistics.thisMonth }} 场</strong>
      </div>
      <div class="kpi-strip-divider"></div>
      <div class="kpi-strip-item">
        <span class="kpi-icon-dot amber"></span>
        <span class="kpi-strip-label">平均单场</span>
        <strong class="kpi-strip-val">{{ formatBytes(statistics.averageSize) }}</strong>
      </div>
      <div class="kpi-strip-divider"></div>
      <div class="kpi-strip-item">
        <span class="kpi-icon-dot blue"></span>
        <span class="kpi-strip-label">最早记录</span>
        <strong class="kpi-strip-val date">{{ statistics.earliest ? formatDate(statistics.earliest, true) : "-" }}</strong>
      </div>
    </div>

    <!-- Main Split Layout -->
    <AppSplitLayout class="end-snapshot-layout" responsive-mode="stack">
      <template #left>
        <AppCard
          compact
          body-mode="fill"
          overflow="clip"
          title="快照记录"
          :description="`显示 ${filteredSnapshots.length} / ${snapshots.length} 条记录`"
          class="history-card"
        >
          <!-- Compact Integrated Filter Bar inside Card -->
          <div class="card-filter-toolbar">
            <div class="search-box">
              <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input v-model.trim="filters.search" type="search" placeholder="搜索地图、图层、模式..." class="search-input">
            </div>
            <button
              type="button"
              class="icon-filter-btn"
              :class="{ active: showAdvancedFilter || hasActiveFilters }"
              title="展开高级筛选"
              @click="showAdvancedFilter = !showAdvancedFilter"
            >
              ⚙️ 筛选 {{ hasActiveFilters ? '(已按条件)' : '' }}
            </button>
          </div>

          <!-- Expandable Collapsible Advanced Filters -->
          <div v-if="showAdvancedFilter" class="advanced-filter-drawer">
            <div class="filter-drawer-grid">
              <label class="field">
                <span>时间</span>
                <select v-model="filters.time">
                  <option value="all">全部时间</option>
                  <option value="today">今天</option>
                  <option value="yesterday">昨天</option>
                  <option value="7d">最近 7 天</option>
                  <option value="30d">最近 30 天</option>
                </select>
              </label>

              <label class="field">
                <span>地图</span>
                <select v-model="filters.map">
                  <option value="">全部地图</option>
                  <option v-for="map in mapOptions" :key="map" :value="map">{{ map }}</option>
                </select>
              </label>

              <label class="field">
                <span>模式</span>
                <select v-model="filters.mode">
                  <option value="">全部模式</option>
                  <option v-for="mode in modeOptions" :key="mode" :value="mode">{{ mode }}</option>
                </select>
              </label>

              <label class="field">
                <span>存档类型</span>
                <select v-model="filters.source">
                  <option value="">全部类型</option>
                  <option value="official">正式快照</option>
                  <option value="debug">调试快照</option>
                </select>
              </label>

              <label class="field">
                <span>比赛结果</span>
                <select v-model="filters.winner">
                  <option value="">全部结果</option>
                  <option value="team1">Team 1 胜利</option>
                  <option value="team2">Team 2 胜利</option>
                  <option value="draw">平局 / 未记录</option>
                </select>
              </label>

              <label class="field">
                <span>排序</span>
                <select v-model="filters.sort">
                  <option value="newest">最新优先</option>
                  <option value="oldest">最旧优先</option>
                  <option value="largest">最大体积</option>
                  <option value="longest">最长比赛</option>
                  <option value="players">最多玩家</option>
                </select>
              </label>
            </div>
            <div class="filter-drawer-actions">
              <button v-if="hasActiveFilters" type="button" class="reset-btn" @click="resetFilters">重置全部筛选</button>
            </div>
          </div>

          <div class="list-tools">
            <label class="select-all">
              <input
                type="checkbox"
                :checked="allVisibleSelected"
                :indeterminate="someVisibleSelected"
                @change="toggleSelectAll"
              >
              <span>全选结果</span>
            </label>
            <span class="result-count">共 {{ filteredSnapshots.length }} 条</span>
          </div>

          <div v-if="loading" class="empty-state">
            <div class="spinner-lg"></div>
            <span>正在加载快照资产...</span>
          </div>
          <div v-else-if="!filteredSnapshots.length" class="empty-state">没有符合条件的快照</div>
          <div v-else class="record-list">
            <article
              v-for="item in filteredSnapshots"
              :key="recordKey(item)"
              class="record-card"
              :class="{ active: selectedKey === recordKey(item), debug: item.source === 'debug' }"
              @click="selectSnapshot(item)"
            >
              <div class="card-chk-col" @click.stop>
                <input
                  type="checkbox"
                  :checked="selectedRecords.has(recordKey(item))"
                  @change="toggleRecord(item)"
                >
              </div>

              <div class="record-thumb-shell">
                <img
                  v-if="item.imageAvailable"
                  class="record-thumb"
                  :src="thumbnailUrl(item)"
                  alt=""
                  loading="lazy"
                >
                <div v-else class="record-thumb placeholder">
                  <span>NO IMAGE</span>
                </div>
              </div>

              <div class="record-body">
                <header class="record-header">
                  <strong class="map-name" :title="item.map || mapFromLayer(item.layer)">{{ item.map || mapFromLayer(item.layer) || "未知地图" }}</strong>
                  <div class="badge-group">
                    <span class="mode-badge">{{ item.mode || modeFromLayer(item.layer) || "-" }}</span>
                    <span class="source-badge" :class="item.source">{{ item.source === "debug" ? "DEBUG" : "正式" }}</span>
                  </div>
                </header>
                <div class="record-time">{{ formatDate(item.capturedAt) }}</div>
                <div class="record-metrics">
                  <span class="metric-tag duration">{{ formatDuration(item.duration) }}</span>
                  <span class="metric-tag players">{{ item.playerCount }} 玩家</span>
                  <span class="metric-tag winner" :class="normalizeWinner(item.winner)">{{ winnerLabel(item.winner) }}</span>
                  <span class="metric-tag size">{{ formatBytes(item.totalSize || item.size) }}</span>
                </div>
                <div v-if="item.renderStatus === 'failed'" class="render-error" :title="item.renderError">
                  ⚠️ 图片生成失败
                </div>
              </div>
            </article>
          </div>

          <footer v-if="selectedRecords.size" class="batch-bar">
            <div class="batch-info">
              <strong>已选择 {{ selectedRecords.size }} 个快照</strong>
              <span>共计 {{ formatBytes(selectedSize) }}</span>
            </div>
            <button type="button" class="action-btn sm danger" :disabled="busy" @click="deleteBatch">
              {{ busy ? "删除中..." : "批量删除" }}
            </button>
          </footer>
        </AppCard>
      </template>

      <template #right>
        <AppCard
          compact
          body-mode="scroll"
          overflow="clip"
          title="快照详情与战绩面板"
          :description="selectedSnapshot ? `${selectedSnapshot.map || '未知地图'} · ${selectedSnapshot.id}` : '请从左侧选择一条记录'"
          class="detail-card"
        >
          <div v-if="!selectedSnapshot" class="empty-state">从左侧列表中选择一场对局以查看完整战绩与快照工件。</div>
          <template v-else>
            <!-- Detail Toolbar -->
            <div class="detail-toolbar">
              <button type="button" class="action-btn sm" :disabled="!selectedSnapshot.imageAvailable" @click="imagePreviewOpen = !imagePreviewOpen">
                📷 {{ imagePreviewOpen ? "收起图片" : "查看战绩原图" }}
              </button>
              <button type="button" class="action-btn sm accent" :disabled="regenerating" @click="regenerateImage">
                ⚡ {{ regenerating ? "生成中..." : "重新生成图片" }}
              </button>
              <button type="button" class="action-btn sm" :disabled="!selectedSnapshot.imageAvailable" @click="downloadImage">⬇️ 下载 PNG</button>
              <button type="button" class="action-btn sm" @click="downloadSelected">📄 导出 JSON</button>
              <button type="button" class="action-btn sm danger" :disabled="busy" @click="deleteSelected">🗑️ 删除本条</button>
            </div>

            <div v-if="detailLoading" class="empty-state">
              <div class="spinner-lg"></div>
              <span>正在读取快照数据...</span>
            </div>
            <template v-else-if="detail">
              <!-- Overview Metric Cards -->
              <section class="overview-grid">
                <div class="metric-card wide">
                  <span class="m-label">地图图层</span>
                  <strong class="m-val">{{ detail.match?.layer || selectedSnapshot.layer || "-" }}</strong>
                  <small class="m-sub">{{ detail.match?.map || selectedSnapshot.map || "-" }} · {{ detail.match?.mode || selectedSnapshot.mode || "-" }}</small>
                </div>
                <div class="metric-card">
                  <span class="m-label">开始时间</span>
                  <strong class="m-val text-sm">{{ formatDate(selectedSnapshot.startedAt || "", true) }}</strong>
                </div>
                <div class="metric-card">
                  <span class="m-label">结束时间</span>
                  <strong class="m-val text-sm">{{ formatDate(selectedSnapshot.capturedAt, true) }}</strong>
                </div>
                <div class="metric-card">
                  <span class="m-label">持续时间</span>
                  <strong class="m-val">{{ formatDuration(selectedSnapshot.duration) }}</strong>
                </div>
                <div class="metric-card">
                  <span class="m-label">玩家 / 队列</span>
                  <strong class="m-val">{{ detail.server?.playerCount ?? detail.players?.length ?? 0 }} / {{ detail.server?.queueCount ?? 0 }}</strong>
                </div>
                <div class="metric-card">
                  <span class="m-label">胜利方</span>
                  <strong class="m-val" :class="normalizeWinner(selectedSnapshot.winner)">{{ winnerLabel(selectedSnapshot.winner) }}</strong>
                </div>
                <div class="metric-card">
                  <span class="m-label">原图大小</span>
                  <strong class="m-val">{{ formatBytes(selectedSnapshot.size) }}</strong>
                </div>
                <div class="metric-card">
                  <span class="m-label">生成时间</span>
                  <strong class="m-val text-sm">{{ formatDate(selectedSnapshot.generatedAt || "", true) }}</strong>
                </div>
              </section>

              <!-- Image Lightbox / Report Preview -->
              <section v-if="imagePreviewOpen && selectedSnapshot.imageAvailable" class="report-preview-box">
                <div class="report-preview-header">
                  <span>对局战绩快照原图 (PNG)</span>
                  <button type="button" class="close-preview-btn" @click="imagePreviewOpen = false">✕ 关闭预览</button>
                </div>
                <img :src="reportImageUrl" alt="对局结束快照原图" loading="lazy">
              </section>

              <!-- Scoreboard / Player Details Section -->
              <section class="player-section">
                <header class="section-header">
                  <div class="section-title-group">
                    <strong class="section-title">本场玩家战绩积分榜</strong>
                    <span class="player-count-badge">{{ detail.players?.length ?? 0 }} 玩家记录</span>
                  </div>

                  <div class="scoreboard-tools">
                    <input v-model.trim="playerSearch" type="search" placeholder="搜索玩家、ID、Role..." class="search-mini-input">

                    <div class="view-tab-group">
                      <button
                        type="button"
                        class="tab-mini-btn"
                        :class="{ active: scoreboardTab === 'versus' }"
                        @click="scoreboardTab = 'versus'"
                      >
                        ⚔️ 阵营对比
                      </button>
                      <button
                        type="button"
                        class="tab-mini-btn"
                        :class="{ active: scoreboardTab === 'team1' }"
                        @click="scoreboardTab = 'team1'"
                      >
                        🟦 Team 1 ({{ team1Players.length }})
                      </button>
                      <button
                        type="button"
                        class="tab-mini-btn"
                        :class="{ active: scoreboardTab === 'team2' }"
                        @click="scoreboardTab = 'team2'"
                      >
                        🟥 Team 2 ({{ team2Players.length }})
                      </button>
                      <button
                        type="button"
                        class="tab-mini-btn"
                        :class="{ active: scoreboardTab === 'all' }"
                        @click="scoreboardTab = 'all'"
                      >
                        📋 全员列表
                      </button>
                    </div>
                  </div>
                </header>

                <div v-if="detail.players?.length">
                  <!-- Mode 1: Side-by-side Overview (Versus Dashboard) -->
                  <div v-if="scoreboardTab === 'versus'" class="versus-dashboard">
                    <div class="team-summary-card team-1">
                      <div class="team-summary-header">
                        <span class="team-badge t1">Team 1</span>
                        <span class="team-size">{{ filteredTeam1Players.length }} 玩家</span>
                      </div>
                      <div class="team-summary-stats">
                        <div class="stat-box">
                          <span class="sb-label">总击杀 (K)</span>
                          <strong class="sb-val green">{{ team1Kills }}</strong>
                        </div>
                        <div class="stat-box">
                          <span class="sb-label">阵营总得分</span>
                          <strong class="sb-val cyan">{{ team1Score }}</strong>
                        </div>
                        <div class="stat-box" v-if="topPlayerTeam1">
                          <span class="sb-label">阵营 MVP</span>
                          <strong class="sb-val gold">{{ topPlayerTeam1.name }} ({{ topPlayerTeam1.bzssCore?.kills || 0 }}K)</strong>
                        </div>
                      </div>
                      <button type="button" class="team-view-more-btn t1" @click="scoreboardTab = 'team1'">
                        查看 Team 1 完整名单表格 →
                      </button>
                    </div>

                    <div class="team-summary-card team-2">
                      <div class="team-summary-header">
                        <span class="team-badge t2">Team 2</span>
                        <span class="team-size">{{ filteredTeam2Players.length }} 玩家</span>
                      </div>
                      <div class="team-summary-stats">
                        <div class="stat-box">
                          <span class="sb-label">总击杀 (K)</span>
                          <strong class="sb-val green">{{ team2Kills }}</strong>
                        </div>
                        <div class="stat-box">
                          <span class="sb-label">阵营总得分</span>
                          <strong class="sb-val cyan">{{ team2Score }}</strong>
                        </div>
                        <div class="stat-box" v-if="topPlayerTeam2">
                          <span class="sb-label">阵营 MVP</span>
                          <strong class="sb-val gold">{{ topPlayerTeam2.name }} ({{ topPlayerTeam2.bzssCore?.kills || 0 }}K)</strong>
                        </div>
                      </div>
                      <button type="button" class="team-view-more-btn t2" @click="scoreboardTab = 'team2'">
                        查看 Team 2 完整名单表格 →
                      </button>
                    </div>
                  </div>

                  <!-- Mode 2: Team 1 Roster -->
                  <div v-else-if="scoreboardTab === 'team1'" class="player-table-wrap">
                    <AppTable compact class="team-table t1-table">
                      <thead>
                        <tr>
                          <th>玩家</th><th>小队</th><th>Role</th><th>K/W/D</th><th>TK</th>
                          <th>复苏</th><th>战斗分</th><th>目标分</th><th>团队分</th><th>延迟</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="player in filteredTeam1Players" :key="playerKey(player)">
                          <td class="player-name">
                            <strong :title="player.name">{{ player.name || "Unknown" }}</strong>
                            <small class="font-mono">{{ player.steamID || player.eosID || "-" }}</small>
                          </td>
                          <td><span class="squad-tag">{{ player.squadInfo?.name || squadLabel(player.squadID) }}</span></td>
                          <td><span class="role-tag">{{ player.role || player.bzssCore?.soldierClass || "-" }}</span></td>
                          <td>
                            <div class="kwd-pill">
                              <span class="k">{{ stat(player.bzssCore?.kills) }}</span> /
                              <span class="w">{{ stat(player.bzssCore?.downs) }}</span> /
                              <span class="d">{{ stat(player.bzssCore?.deaths) }}</span>
                            </div>
                          </td>
                          <td><span v-if="Number(player.bzssCore?.teamKills) > 0" class="stat-tk">{{ stat(player.bzssCore?.teamKills) }}</span><span v-else>-</span></td>
                          <td><span class="stat-rev">{{ stat(player.bzssCore?.revives) }}</span></td>
                          <td>{{ stat(player.bzssCore?.combatScore) }}</td>
                          <td>{{ stat(player.bzssCore?.objectiveScore) }}</td>
                          <td>{{ stat(player.bzssCore?.teamworkScore) }}</td>
                          <td><span class="ping-tag">{{ pingLabel(player.bzssCore?.ping) }}</span></td>
                        </tr>
                      </tbody>
                    </AppTable>
                  </div>

                  <!-- Mode 3: Team 2 Roster -->
                  <div v-else-if="scoreboardTab === 'team2'" class="player-table-wrap">
                    <AppTable compact class="team-table t2-table">
                      <thead>
                        <tr>
                          <th>玩家</th><th>小队</th><th>Role</th><th>K/W/D</th><th>TK</th>
                          <th>复苏</th><th>战斗分</th><th>目标分</th><th>团队分</th><th>延迟</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="player in filteredTeam2Players" :key="playerKey(player)">
                          <td class="player-name">
                            <strong :title="player.name">{{ player.name || "Unknown" }}</strong>
                            <small class="font-mono">{{ player.steamID || player.eosID || "-" }}</small>
                          </td>
                          <td><span class="squad-tag">{{ player.squadInfo?.name || squadLabel(player.squadID) }}</span></td>
                          <td><span class="role-tag">{{ player.role || player.bzssCore?.soldierClass || "-" }}</span></td>
                          <td>
                            <div class="kwd-pill">
                              <span class="k">{{ stat(player.bzssCore?.kills) }}</span> /
                              <span class="w">{{ stat(player.bzssCore?.downs) }}</span> /
                              <span class="d">{{ stat(player.bzssCore?.deaths) }}</span>
                            </div>
                          </td>
                          <td><span v-if="Number(player.bzssCore?.teamKills) > 0" class="stat-tk">{{ stat(player.bzssCore?.teamKills) }}</span><span v-else>-</span></td>
                          <td><span class="stat-rev">{{ stat(player.bzssCore?.revives) }}</span></td>
                          <td>{{ stat(player.bzssCore?.combatScore) }}</td>
                          <td>{{ stat(player.bzssCore?.objectiveScore) }}</td>
                          <td>{{ stat(player.bzssCore?.teamworkScore) }}</td>
                          <td><span class="ping-tag">{{ pingLabel(player.bzssCore?.ping) }}</span></td>
                        </tr>
                      </tbody>
                    </AppTable>
                  </div>

                  <!-- Mode 4: Flat Full Player Table -->
                  <div v-else class="player-table-wrap">
                    <AppTable compact>
                      <thead>
                        <tr>
                          <th>玩家</th><th>队伍 / 小队</th><th>Role</th><th>K/W/D</th>
                          <th>TK</th><th>载具</th><th>复苏</th><th>战斗分</th><th>目标分</th><th>团队分</th><th>延迟</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="player in searchedPlayers" :key="playerKey(player)">
                          <td class="player-name"><strong>{{ player.name || "Unknown" }}</strong><small class="font-mono">{{ player.steamID || player.eosID || "-" }}</small></td>
                          <td>
                            <span class="team-pill" :class="`t${player.teamID}`">T{{ player.teamID ?? "-" }}</span>
                            <small>{{ player.squadInfo?.name || squadLabel(player.squadID) }}</small>
                          </td>
                          <td>{{ player.role || player.bzssCore?.soldierClass || "-" }}</td>
                          <td>
                            <div class="kwd-pill">
                              <span class="k">{{ stat(player.bzssCore?.kills) }}</span> /
                              <span class="w">{{ stat(player.bzssCore?.downs) }}</span> /
                              <span class="d">{{ stat(player.bzssCore?.deaths) }}</span>
                            </div>
                          </td>
                          <td>{{ stat(player.bzssCore?.teamKills) }}</td>
                          <td>{{ stat(player.bzssCore?.vehicleKills) }}</td><td><span class="stat-rev">{{ stat(player.bzssCore?.revives) }}</span></td>
                          <td>{{ stat(player.bzssCore?.combatScore) }}</td><td>{{ stat(player.bzssCore?.objectiveScore) }}</td>
                          <td>{{ stat(player.bzssCore?.teamworkScore) }}</td><td>{{ pingLabel(player.bzssCore?.ping) }}</td>
                        </tr>
                      </tbody>
                    </AppTable>
                  </div>
                </div>
              </section>

              <!-- Raw Data JSON View -->
              <details class="raw-data-box">
                <summary class="raw-data-summary">
                  <span>📄 Raw Data（原始 JSON 数据）</span>
                  <button type="button" class="copy-json-btn" @click.stop="copyJson(detail)">复制 JSON</button>
                </summary>
                <pre class="json-code"><code>{{ JSON.stringify(detail, null, 2) }}</code></pre>
              </details>
            </template>
          </template>
        </AppCard>
      </template>
    </AppSplitLayout>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
import AppCard from "../components/common/AppCard.vue";
import AppPage from "../components/common/AppPage.vue";
import AppPageHeader from "../components/common/AppPageHeader.vue";
import AppSplitLayout from "../components/common/AppSplitLayout.vue";
import AppTable from "../components/common/AppTable.vue";
import { useUiStore } from "../stores/ui.store";

type SnapshotSource = "official" | "debug";

interface SnapshotListItem {
  id: string;
  source: SnapshotSource;
  debug?: boolean;
  capturedAt: string;
  startedAt?: string;
  generatedAt?: string;
  map?: string;
  layer?: string;
  mode?: string;
  nextMap?: string;
  nextLayer?: string;
  duration: number;
  playerCount: number;
  queueCount: number;
  winner?: string;
  size: number;
  totalSize?: number;
  imageAvailable?: boolean;
  thumbnailAvailable?: boolean;
  renderStatus?: string;
  renderError?: string;
}

interface SnapshotStatistics {
  total: number;
  size: number;
  thisMonth: number;
  averageSize: number;
  earliest: string;
  official: number;
  debug: number;
}

interface SnapshotPlayer {
  playerID?: number | null; name?: string; steamID?: string; eosID?: string;
  teamID?: number | null; squadID?: number | null; role?: string;
  squadInfo?: { name?: string } | null;
  bzssCore?: {
    soldierClass?: string; kills?: number | null; downs?: number | null; deaths?: number | null;
    teamKills?: number | null; vehicleKills?: number | null; revives?: number | null;
    combatScore?: number | null; objectiveScore?: number | null; teamworkScore?: number | null;
    ping?: number | null;
  } | null;
}

interface SnapshotDetail {
  capturedAt: string;
  server?: { playerCount?: number; queueCount?: number };
  match?: { map?: string; layer?: string; mode?: string; nextMap?: string; nextLayer?: string };
  summary?: { bzssCorePlayerCount?: number };
  players?: SnapshotPlayer[];
}

interface CaptureResponse {
  snapshot?: SnapshotListItem;
}

const EMPTY_STATS: SnapshotStatistics = {
  total: 0, size: 0, thisMonth: 0, averageSize: 0, earliest: "", official: 0, debug: 0,
};

const ui = useUiStore();
const snapshots = ref<SnapshotListItem[]>([]);
const statistics = ref<SnapshotStatistics>({ ...EMPTY_STATS });
const selectedKey = ref("");
const selectedRecords = ref(new Set<string>());
const detail = ref<SnapshotDetail | null>(null);
const loading = ref(true);
const detailLoading = ref(false);
const busy = ref(false);
const regenerating = ref(false);
const debugCapturing = ref(false);
const imagePreviewOpen = ref(false);
const imageVersion = ref(String(Date.now()));
const errorMessage = ref("");
const loadedAt = ref("");
const scoreboardTab = ref<"versus" | "team1" | "team2" | "all">("versus");
const playerSearch = ref("");
const showAdvancedFilter = ref(false);

const filters = ref({
  search: "", time: "all", from: "", to: "", map: "", mode: "", players: "",
  winner: "", source: "", sort: "newest",
});

const selectedSnapshot = computed(() =>
  snapshots.value.find((item) => recordKey(item) === selectedKey.value) ?? null,
);

const mapOptions = computed<string[]>(() =>
  Array.from(new Set(snapshots.value.map((item) => item.map || mapFromLayer(item.layer)).filter((value): value is string => Boolean(value)))).sort(),
);
const modeOptions = computed<string[]>(() =>
  Array.from(new Set(snapshots.value.map((item) => item.mode || modeFromLayer(item.layer)).filter((value): value is string => Boolean(value)))).sort(),
);


const filteredSnapshots = computed(() => {
  const range = resolveTimeRange(filters.value.time, filters.value.from, filters.value.to);
  const search = filters.value.search.toLowerCase();
  const result = snapshots.value.filter((item) => {
    const capturedMs = Date.parse(item.capturedAt);
    if (range.from != null && (!Number.isFinite(capturedMs) || capturedMs < range.from)) return false;
    if (range.to != null && (!Number.isFinite(capturedMs) || capturedMs > range.to)) return false;
    if (filters.value.map && (item.map || mapFromLayer(item.layer)) !== filters.value.map) return false;
    if (filters.value.mode && (item.mode || modeFromLayer(item.layer)) !== filters.value.mode) return false;
    if (filters.value.source && item.source !== filters.value.source) return false;
    if (filters.value.players === "80+" && item.playerCount < 80) return false;
    if (filters.value.players === "50-79" && (item.playerCount < 50 || item.playerCount >= 80)) return false;
    if (filters.value.players === "0-49" && item.playerCount >= 50) return false;
    const winner = normalizeWinner(item.winner);
    if (filters.value.winner === "team1" && winner !== "team1") return false;
    if (filters.value.winner === "team2" && winner !== "team2") return false;
    if (filters.value.winner === "draw" && winner !== "draw") return false;
    if (search) {
      const haystack = [item.id, item.map, item.layer, item.mode, item.winner].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
  return result.sort((left, right) => {
    if (filters.value.sort === "oldest") return left.capturedAt.localeCompare(right.capturedAt);
    if (filters.value.sort === "largest") return (right.totalSize || right.size) - (left.totalSize || left.size);
    if (filters.value.sort === "longest") return right.duration - left.duration;
    if (filters.value.sort === "players") return right.playerCount - left.playerCount;
    return right.capturedAt.localeCompare(left.capturedAt);
  });
});

const visibleKeys = computed(() => filteredSnapshots.value.map(recordKey));
const allVisibleSelected = computed(() =>
  visibleKeys.value.length > 0 && visibleKeys.value.every((key) => selectedRecords.value.has(key)),
);
const someVisibleSelected = computed(() =>
  !allVisibleSelected.value && visibleKeys.value.some((key) => selectedRecords.value.has(key)),
);
const selectedSize = computed(() =>
  snapshots.value
    .filter((item) => selectedRecords.value.has(recordKey(item)))
    .reduce((sum, item) => sum + Number(item.totalSize || item.size || 0), 0),
);
const hasActiveFilters = computed(() =>
  Object.entries(filters.value).some(([key, value]) =>
    key === "sort" ? value !== "newest" : key === "time" ? value !== "all" : Boolean(value),
  ),
);

const reportImageUrl = computed(() => selectedSnapshot.value
  ? assetUrl("/api/match-end-snapshot/image", selectedSnapshot.value, imageVersion.value)
  : "",
);

const headerStatusItems = computed(() => {
  const items: Array<{ label: string; tone: "ok" | "error" | "idle" }> = [
    { label: `记录 ${snapshots.value.length}`, tone: "idle" },
  ];
  if (loadedAt.value) items.push({ label: `刷新于 ${loadedAt.value}`, tone: "ok" });
  if (errorMessage.value) items.push({ label: errorMessage.value, tone: "error" });
  return items;
});

// Dual-team scoreboard computed values
const allPlayersList = computed(() => detail.value?.players || []);
const searchedPlayers = computed(() => {
  if (!playerSearch.value) return allPlayersList.value;
  const q = playerSearch.value.toLowerCase();
  return allPlayersList.value.filter(p =>
    (p.name || "").toLowerCase().includes(q) ||
    (p.steamID || "").toLowerCase().includes(q) ||
    (p.role || "").toLowerCase().includes(q)
  );
});

const team1Players = computed(() => searchedPlayers.value.filter(p => p.teamID === 1));
const team2Players = computed(() => searchedPlayers.value.filter(p => p.teamID === 2));
const filteredTeam1Players = computed(() => team1Players.value);
const filteredTeam2Players = computed(() => team2Players.value);

const team1Kills = computed(() => team1Players.value.reduce((sum, p) => sum + (Number(p.bzssCore?.kills) || 0), 0));
const team2Kills = computed(() => team2Players.value.reduce((sum, p) => sum + (Number(p.bzssCore?.kills) || 0), 0));
const team1Score = computed(() => team1Players.value.reduce((sum, p) => sum + (Number(p.bzssCore?.combatScore) || 0) + (Number(p.bzssCore?.objectiveScore) || 0) + (Number(p.bzssCore?.teamworkScore) || 0), 0));
const team2Score = computed(() => team2Players.value.reduce((sum, p) => sum + (Number(p.bzssCore?.combatScore) || 0) + (Number(p.bzssCore?.objectiveScore) || 0) + (Number(p.bzssCore?.teamworkScore) || 0), 0));

const topPlayerTeam1 = computed(() => [...team1Players.value].sort((a, b) => (Number(b.bzssCore?.kills) || 0) - (Number(a.bzssCore?.kills) || 0))[0] || null);
const topPlayerTeam2 = computed(() => [...team2Players.value].sort((a, b) => (Number(b.bzssCore?.kills) || 0) - (Number(a.bzssCore?.kills) || 0))[0] || null);

async function copyJson(data: unknown) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    ui.pushToast({ title: "已复制", message: "JSON 数据已复制到剪贴板", tone: "ok" });
  } catch {
    ui.pushToast({ title: "复制失败", message: "剪贴板权限被拒绝", tone: "warn" });
  }
}

async function loadAll() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const [records, stats] = await Promise.all([
      apiGet<SnapshotListItem[]>("/api/match-end-snapshot/list?scope=all"),
      apiGet<SnapshotStatistics>("/api/match-end-snapshot/statistics?scope=all"),
    ]);
    snapshots.value = records;
    statistics.value = stats;
    if (!selectedKey.value || !records.some((item) => recordKey(item) === selectedKey.value)) {
      selectedKey.value = records[0] ? recordKey(records[0]) : "";
    }
    selectedRecords.value = new Set(
      Array.from(selectedRecords.value).filter((key) => records.some((item) => recordKey(item) === key)),
    );
    loadedAt.value = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
    ui.pushToast({ title: "加载失败", message: errorMessage.value, tone: "error" });
  } finally {
    loading.value = false;
  }
}

async function loadDetail(item: SnapshotListItem | null) {
  if (!item) { detail.value = null; return; }
  detailLoading.value = true;
  try {
    detail.value = await apiGet<SnapshotDetail>(
      `/api/match-end-snapshot/view?id=${encodeURIComponent(item.id)}&scope=${item.source}`,
    );
  } catch (error) {
    detail.value = null;
    ui.pushToast({ title: "读取失败", message: error instanceof Error ? error.message : String(error), tone: "error" });
  } finally {
    detailLoading.value = false;
  }
}

async function captureDebugSnapshot() {
  if (debugCapturing.value) return;
  debugCapturing.value = true;
  try {
    const result = await apiPost<CaptureResponse>(
      "/api/match-end-snapshot/debug/capture", {}, {}, { timeoutMs: 120_000 },
    );
    await loadAll();
    if (result?.snapshot?.id) selectedKey.value = `debug:${result.snapshot.id}`;
    ui.pushToast({
      title: "调试快照已写入",
      message: "当前对局的 JSON、原图和缩略图已保存到独立调试存档。",
      tone: "ok",
    });
  } catch (error) {
    await loadAll();
    ui.pushToast({ title: "调试快照写入失败", message: error instanceof Error ? error.message : String(error), tone: "error" });
  } finally {
    debugCapturing.value = false;
  }
}

async function regenerateImage() {
  const selected = selectedSnapshot.value;
  if (!selected || regenerating.value) return;
  regenerating.value = true;
  try {
    await apiPost("/api/match-end-snapshot/regenerate", { id: selected.id, scope: selected.source }, {}, { timeoutMs: 120_000 });
    imageVersion.value = String(Date.now());
    imagePreviewOpen.value = true;
    await loadAll();
    ui.pushToast({ title: "图片已重新生成", message: "原图与列表缩略图均已更新。", tone: "ok" });
  } catch (error) {
    ui.pushToast({ title: "重新生成失败", message: error instanceof Error ? error.message : String(error), tone: "error" });
  } finally {
    regenerating.value = false;
  }
}

async function deleteSelected() {
  const selected = selectedSnapshot.value;
  if (!selected) return;
  await confirmAndDelete([selected]);
}

async function deleteBatch() {
  const records = snapshots.value.filter((item) => selectedRecords.value.has(recordKey(item)));
  if (records.length) await confirmAndDelete(records);
}

async function confirmAndDelete(records: SnapshotListItem[]) {
  const summary = records.slice(0, 4)
    .map((item) => `${item.map || mapFromLayer(item.layer) || "未知地图"} ${formatDate(item.capturedAt, true)} · ${formatBytes(item.totalSize || item.size)}`)
    .join("\n");
  const more = records.length > 4 ? `\n另有 ${records.length - 4} 条记录` : "";
  const confirmed = await ui.openConfirm({
    title: `删除 ${records.length} 个快照`,
    message: `${summary}${more}\n\n将同时删除 JSON、原图、缩略图和清单，删除后不可恢复。`,
    confirmText: "确认删除", cancelText: "取消", tone: "warn",
  });
  if (!confirmed) return;
  busy.value = true;
  try {
    await apiPost("/api/match-end-snapshot/delete-batch", {
      records: records.map((item) => ({ id: item.id, scope: item.source })),
    });
    selectedRecords.value = new Set();
    if (records.some((item) => recordKey(item) === selectedKey.value)) {
      selectedKey.value = "";
      detail.value = null;
    }
    await loadAll();
    ui.pushToast({ title: "删除完成", message: `已删除 ${records.length} 个快照及其全部资产。`, tone: "ok" });
  } catch (error) {
    ui.pushToast({ title: "删除失败", message: error instanceof Error ? error.message : String(error), tone: "error" });
  } finally {
    busy.value = false;
  }
}

function selectSnapshot(item: SnapshotListItem) {
  selectedKey.value = recordKey(item);
}
function toggleRecord(item: SnapshotListItem) {
  const next = new Set(selectedRecords.value);
  const key = recordKey(item);
  next.has(key) ? next.delete(key) : next.add(key);
  selectedRecords.value = next;
}
function toggleSelectAll() {
  const next = new Set(selectedRecords.value);
  const select = !allVisibleSelected.value;
  for (const key of visibleKeys.value) select ? next.add(key) : next.delete(key);
  selectedRecords.value = next;
}
function resetFilters() {
  filters.value = { search: "", time: "all", from: "", to: "", map: "", mode: "", players: "", winner: "", source: "", sort: "newest" };
}
function downloadImage() {
  const selected = selectedSnapshot.value;
  if (selected) window.open(`${assetUrl("/api/match-end-snapshot/image", selected, imageVersion.value)}&download=1`, "_blank", "noopener,noreferrer");
}
function downloadSelected() {
  const selected = selectedSnapshot.value;
  if (selected) window.open(`/api/match-end-snapshot/view?id=${encodeURIComponent(selected.id)}&scope=${selected.source}&download=1`, "_blank", "noopener,noreferrer");
}
function thumbnailUrl(item: SnapshotListItem) {
  return assetUrl("/api/match-end-snapshot/thumbnail", item);
}
function assetUrl(path: string, item: SnapshotListItem, version = "") {
  return `${path}?id=${encodeURIComponent(item.id)}&scope=${item.source}${version ? `&v=${encodeURIComponent(version)}` : ""}`;
}
function recordKey(item: SnapshotListItem) { return `${item.source || "official"}:${item.id}`; }
function formatBytes(value: number | null | undefined) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index >= 2 ? 1 : 0)} ${units[index]}`;
}
function formatDate(value: string, compact = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return date.toLocaleString("zh-CN", {
    hour12: false, year: compact ? "2-digit" : "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: compact ? undefined : "2-digit",
  });
}
function formatDuration(seconds: number | null | undefined) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${secs}s` : `${secs}s`;
}
function modeFromLayer(layer?: string) {
  return String(layer || "").match(/(?:^|_)(RAAS|AAS|Invasion|TC|Seed|Skirmish|Destruction)(?:_|$)/i)?.[1] || "";
}
function mapFromLayer(layer?: string) {
  return String(layer || "").replace(/_(?:RAAS|AAS|Invasion|TC|Seed|Skirmish|Destruction).*$/i, "");
}
function normalizeWinner(value?: string) {
  const text = String(value || "").toLowerCase().replace(/\s+/g, "");
  if (/team?1|blue|1队/.test(text)) return "team1";
  if (/team?2|red|2队/.test(text)) return "team2";
  return "draw";
}
function winnerLabel(value?: string) {
  const winner = normalizeWinner(value);
  return winner === "team1" ? "Team 1 胜利" : winner === "team2" ? "Team 2 胜利" : "平局 / 未记录";
}
function resolveTimeRange(type: string, from: string, to: string) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (type === "today") return { from: startOfToday, to: null };
  if (type === "yesterday") return { from: startOfToday - 86_400_000, to: startOfToday - 1 };
  if (type === "7d") return { from: now.getTime() - 7 * 86_400_000, to: null };
  if (type === "30d") return { from: now.getTime() - 30 * 86_400_000, to: null };
  if (type === "custom") {
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : null;
    return { from: Number.isFinite(fromMs) ? fromMs : null, to: Number.isFinite(toMs) ? toMs : null };
  }
  return { from: null, to: null };
}
function playerKey(player: SnapshotPlayer) {
  return [player.steamID, player.eosID, player.playerID, player.teamID, player.squadID, player.name].map((value) => String(value ?? "")).join("|");
}
function squadLabel(value: number | null | undefined) { return value == null ? "无小队" : `Squad ${value}`; }
function stat(value: number | null | undefined) { const number = Number(value); return Number.isFinite(number) ? Math.trunc(number) : "-"; }
function pingLabel(value: number | null | undefined) { const number = Number(value); return Number.isFinite(number) ? `${Math.round(number)} ms` : "-"; }

watch(selectedKey, () => {
  imagePreviewOpen.value = false;
  imageVersion.value = String(Date.now());
  void loadDetail(selectedSnapshot.value);
});
onMounted(loadAll);
</script>

<style scoped>
/* Compact Top KPI Strip */
.kpi-strip {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 18px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(8px);
  margin-bottom: 14px;
}

.kpi-strip-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.kpi-icon-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.kpi-icon-dot.cyan { background: #38bdf8; box-shadow: 0 0 8px #38bdf8; }
.kpi-icon-dot.emerald { background: #22c55e; box-shadow: 0 0 8px #22c55e; }
.kpi-icon-dot.purple { background: #a78bfa; box-shadow: 0 0 8px #a78bfa; }
.kpi-icon-dot.amber { background: #f59e0b; box-shadow: 0 0 8px #f59e0b; }
.kpi-icon-dot.blue { background: #60a5fa; box-shadow: 0 0 8px #60a5fa; }

.kpi-strip-label {
  color: var(--color-text-muted);
}

.kpi-strip-val {
  color: var(--color-text-primary);
  font-weight: 700;
}

.kpi-strip-val.date {
  font-size: 11px;
}

.kpi-sub-text {
  font-size: 10px;
  color: var(--color-text-muted);
}

.kpi-strip-divider {
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.08);
}

/* Integrated Card Toolbar Filter */
.card-filter-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.search-box {
  position: relative;
  flex: 1;
}

.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  color: var(--color-text-muted);
}

.search-input {
  width: 100%;
  height: 32px;
  padding: 0 10px 0 30px;
  border-radius: 6px;
  border: 1px solid var(--color-border-soft);
  background: rgba(15, 23, 42, 0.8);
  color: var(--color-text-primary);
  font-size: 12px;
}

.icon-filter-btn {
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.icon-filter-btn.active {
  border-color: rgba(56, 189, 248, 0.4);
  background: rgba(56, 189, 248, 0.12);
  color: #38bdf8;
}

.advanced-filter-drawer {
  padding: 10px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid var(--color-border-soft);
  margin-bottom: 10px;
}

.filter-drawer-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 10px;
  color: var(--color-text-muted);
}

.field select {
  height: 28px;
  padding: 0 6px;
  border-radius: 4px;
  border: 1px solid var(--color-border-soft);
  background: rgba(15, 23, 42, 0.9);
  color: var(--color-text-primary);
  font-size: 11px;
}

.filter-drawer-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.reset-btn {
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid rgba(245, 158, 11, 0.3);
  background: rgba(245, 158, 11, 0.1);
  color: #fbbf24;
  font-size: 10px;
  cursor: pointer;
}

/* Layout */
.end-snapshot-layout {
  grid-template-columns: minmax(360px, 420px) minmax(0, 1fr) !important;
  gap: 14px;
}

.history-card, .detail-card {
  height: 100%;
}

.list-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  background: rgba(15, 23, 42, 0.5);
  border-radius: 6px;
  margin-bottom: 8px;
  font-size: 11px;
  color: var(--color-text-muted);
}

.select-all {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.record-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
  flex: 1 1 auto;
  min-height: 420px;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

/* Card Feed Row */
.record-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid var(--color-border-soft);
  cursor: pointer;
  transition: all 0.15s ease;
}

.record-card:hover, .record-card.active {
  border-color: rgba(56, 189, 248, 0.4);
  background: rgba(56, 189, 248, 0.06);
}

.record-card.debug {
  border-left: 3px solid #f59e0b;
}

.card-chk-col {
  padding: 0 2px;
}

.record-thumb-shell {
  width: 100px;
  height: 56px;
  border-radius: 6px;
  overflow: hidden;
  background: #060a12;
  border: 1px solid rgba(255, 255, 255, 0.05);
  flex-shrink: 0;
}

.record-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.record-thumb.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: 9px;
  font-family: monospace;
}

.record-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.record-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.map-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.mode-badge {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-secondary);
}

.source-badge {
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 800;
}

.source-badge.debug { color: #fbbf24; background: rgba(245, 158, 11, 0.15); }
.source-badge.official { color: #38bdf8; background: rgba(56, 189, 248, 0.15); }

.record-time {
  font-size: 10px;
  color: var(--color-text-muted);
}

.record-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.metric-tag {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary);
}

.metric-tag.winner.team1 { color: #60a5fa; background: rgba(59, 130, 246, 0.12); }
.metric-tag.winner.team2 { color: #f87171; background: rgba(239, 68, 68, 0.12); }
.metric-tag.winner.draw { color: #fbbf24; background: rgba(245, 158, 11, 0.12); }

.batch-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px;
  border-top: 1px solid var(--color-border-soft);
  background: rgba(239, 68, 68, 0.06);
  border-radius: 6px;
  margin-top: 6px;
}

.batch-info strong { font-size: 11px; color: #fecaca; }
.batch-info span { font-size: 10px; color: var(--color-text-muted); }

/* Detail Card */
.detail-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border-soft);
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 14px;
}

.metric-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid var(--color-border-soft);
}

.metric-card.wide { grid-column: span 2; }

.m-label { font-size: 10px; color: var(--color-text-muted); }
.m-val { font-size: 13px; font-weight: 700; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m-val.team1 { color: #60a5fa; }
.m-val.team2 { color: #f87171; }
.m-val.draw { color: #fbbf24; }
.m-sub { font-size: 10px; color: var(--color-text-muted); }

.report-preview-box {
  margin-bottom: 14px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--color-border-soft);
  background: #050811;
}

.report-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: rgba(15, 23, 42, 0.8);
  font-size: 11px;
  color: var(--color-text-secondary);
}

.close-preview-btn { background: transparent; border: 0; color: var(--color-text-muted); cursor: pointer; }
.close-preview-btn:hover { color: #fff; }
.report-preview-box img { width: 100%; height: auto; display: block; }

/* Scoreboard Section */
.player-section { margin-top: 14px; }

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.section-title-group { display: flex; align-items: center; gap: 6px; }
.section-title { font-size: 13px; font-weight: 700; color: var(--color-text-primary); }
.player-count-badge { font-size: 10px; padding: 1px 6px; border-radius: 999px; background: rgba(56, 189, 248, 0.1); color: #38bdf8; }

.scoreboard-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.search-mini-input { height: 26px; padding: 0 8px; border-radius: 4px; border: 1px solid var(--color-border-soft); background: rgba(15, 23, 42, 0.8); color: var(--color-text-primary); font-size: 11px; width: 130px; }

.view-tab-group { display: flex; gap: 3px; background: rgba(15, 23, 42, 0.7); padding: 2px; border-radius: 6px; }
.tab-mini-btn { padding: 3px 7px; border-radius: 4px; border: 0; background: transparent; color: var(--color-text-muted); font-size: 11px; cursor: pointer; }
.tab-mini-btn.active { background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 600; }

/* Versus Dashboard Overview */
.versus-dashboard {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.team-summary-card {
  padding: 12px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid var(--color-border-soft);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.team-summary-card.team-1 { border-top: 3px solid #3b82f6; }
.team-summary-card.team-2 { border-top: 3px solid #ef4444; }

.team-summary-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.team-badge { padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 11px; }
.team-badge.t1 { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
.team-badge.t2 { background: rgba(239, 68, 68, 0.2); color: #f87171; }
.team-size { font-size: 11px; color: var(--color-text-muted); }

.team-summary-stats {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stat-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.02);
}

.sb-label { color: var(--color-text-muted); }
.sb-val { font-size: 12px; }
.sb-val.green { color: #22c55e; }
.sb-val.cyan { color: #38bdf8; }
.sb-val.gold { color: #fbbf24; }

.team-view-more-btn {
  margin-top: 4px;
  padding: 6px;
  border-radius: 4px;
  border: 0;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.team-view-more-btn.t1 { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
.team-view-more-btn.t2 { background: rgba(239, 68, 68, 0.15); color: #f87171; }
.team-view-more-btn:hover { opacity: 0.85; }

/* Table styling */
.player-table-wrap {
  max-height: 480px;
  overflow: auto;
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
}

.player-name strong { display: block; font-size: 11px; color: var(--color-text-primary); }
.player-name small { display: block; font-size: 9px; color: var(--color-text-muted); }

.squad-tag { font-size: 11px; color: var(--color-text-secondary); }
.role-tag { font-size: 10px; padding: 1px 5px; border-radius: 3px; background: rgba(255, 255, 255, 0.05); color: var(--color-text-secondary); }

.kwd-pill {
  display: inline-flex;
  gap: 2px;
  font-size: 11px;
  font-family: monospace;
}

.kwd-pill .k { color: #22c55e; font-weight: 700; }
.kwd-pill .w { color: var(--color-text-muted); }
.kwd-pill .d { color: #f87171; }

.stat-tk { color: #fb7185; font-weight: 700; }
.stat-rev { color: #38bdf8; }
.ping-tag { font-family: monospace; font-size: 10px; opacity: 0.7; }

.team-pill { padding: 1px 4px; border-radius: 3px; font-size: 9px; font-weight: 700; }
.team-pill.t1 { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
.team-pill.t2 { background: rgba(239, 68, 68, 0.2); color: #f87171; }

/* Raw JSON Accordion */
.raw-data-box {
  margin-top: 14px;
  border-radius: 6px;
  border: 1px solid var(--color-border-soft);
  background: rgba(15, 23, 42, 0.5);
}

.raw-data-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 11px;
  color: var(--color-text-secondary);
}

.copy-json-btn { padding: 2px 6px; border-radius: 4px; border: 1px solid var(--color-border-soft); background: rgba(255, 255, 255, 0.04); color: var(--color-text-muted); font-size: 10px; cursor: pointer; }

.json-code {
  margin: 0; padding: 10px; max-height: 300px; overflow: auto;
  border-top: 1px solid var(--color-border-soft); font-family: monospace; font-size: 11px; color: #7dd3fc;
}

.action-btn {
  display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 4px 10px;
  border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer;
  border: 1px solid var(--color-border-default); background: rgba(255, 255, 255, 0.04); color: var(--color-text-secondary);
}

.btn-icon { width: 14px; height: 14px; }
.action-btn:hover { border-color: var(--color-border-hover); color: var(--color-text-primary); background: rgba(255, 255, 255, 0.08); }
.action-btn.accent { background: rgba(56, 189, 248, 0.15); border-color: rgba(56, 189, 248, 0.3); color: #38bdf8; }
.action-btn.accent:hover { background: rgba(56, 189, 248, 0.25); }
.action-btn.danger { border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.08); color: #fecaca; }
.action-btn.danger:hover { background: rgba(239, 68, 68, 0.18); }
.action-btn.ghost { background: rgba(255, 255, 255, 0.02); }
.action-btn.sm { min-height: 24px; padding: 2px 6px; font-size: 11px; }

.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 36px 16px; text-align: center; color: var(--color-text-muted); font-size: 12px; }
.spinner-lg { width: 22px; height: 22px; border: 2px solid rgba(56, 189, 248, 0.2); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 1100px) {
  .end-snapshot-layout { grid-template-columns: 1fr !important; }
  .versus-dashboard { grid-template-columns: 1fr; }
}
</style>


