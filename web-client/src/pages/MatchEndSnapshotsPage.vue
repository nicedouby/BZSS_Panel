<template>
  <AppPage full-bleed class="end-snapshot-page">
    <!-- Streamlined Single-Row Command Header -->
    <header class="page-cmd-header">
      <div class="header-left">
        <h1 class="page-title">对局结束快照</h1>
        <div class="kpi-inline-group">
          <span class="kpi-tag cyan">
            <span class="dot"></span>
            总数 <strong>{{ statistics.total }}</strong>
            <em>(正式{{ statistics.official }}/Debug{{ statistics.debug }})</em>
          </span>
          <span class="kpi-tag emerald">
            <span class="dot"></span>
            存储 <strong>{{ formatBytes(statistics.size) }}</strong>
          </span>
          <span class="kpi-tag purple">
            <span class="dot"></span>
            本月 <strong>{{ statistics.thisMonth }} 场</strong>
          </span>
          <span class="kpi-tag amber">
            <span class="dot"></span>
            均重 <strong>{{ formatBytes(statistics.averageSize) }}</strong>
          </span>
        </div>
      </div>

      <div class="header-right">
        <button type="button" class="btn-compact ghost" :disabled="loading" @click="loadAll">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          {{ loading ? "刷新中..." : "刷新" }}
        </button>
        <button type="button" class="btn-compact accent" :disabled="debugCapturing" @click="captureDebugSnapshot">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v16m8-8H4"/></svg>
          {{ debugCapturing ? "写入中..." : "写入调试快照" }}
        </button>
      </div>
    </header>

    <!-- Main Split Layout -->
    <AppSplitLayout class="compact-split">
      <template #left>
        <div class="card-panel list-panel">
          <!-- Toolbar Search & Quick Filter -->
          <div class="panel-toolbar">
            <div class="search-input-wrap">
              <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input v-model.trim="filters.search" type="search" placeholder="搜索地图、模式、ID..." class="search-field">
            </div>
            <button
              type="button"
              class="btn-icon-filter"
              :class="{ active: showAdvancedFilter || hasActiveFilters }"
              title="高级筛选"
              @click="showAdvancedFilter = !showAdvancedFilter"
            >
              ⚙️
            </button>
          </div>

          <!-- Expandable Filter Drawer -->
          <div v-if="showAdvancedFilter" class="filter-drawer">
            <div class="drawer-grid">
              <label class="f-field">
                <span>时间</span>
                <select v-model="filters.time">
                  <option value="all">全时</option>
                  <option value="today">今天</option>
                  <option value="yesterday">昨天</option>
                  <option value="7d">7天</option>
                </select>
              </label>

              <label class="f-field">
                <span>地图</span>
                <select v-model="filters.map">
                  <option value="">全部</option>
                  <option v-for="map in mapOptions" :key="map" :value="map">{{ map }}</option>
                </select>
              </label>

              <label class="f-field">
                <span>类型</span>
                <select v-model="filters.source">
                  <option value="">全部</option>
                  <option value="official">正式</option>
                  <option value="debug">调试</option>
                </select>
              </label>

              <label class="f-field">
                <span>结果</span>
                <select v-model="filters.winner">
                  <option value="">全部</option>
                  <option value="team1">Team1 胜</option>
                  <option value="team2">Team2 胜</option>
                  <option value="draw">平局</option>
                </select>
              </label>
            </div>
            <div class="drawer-foot">
              <button v-if="hasActiveFilters" type="button" class="btn-reset" @click="resetFilters">重置筛选</button>
            </div>
          </div>

          <div class="panel-sub-bar">
            <label class="select-all-label">
              <input
                type="checkbox"
                :checked="allVisibleSelected"
                :indeterminate="someVisibleSelected"
                @change="toggleSelectAll"
              >
              <span>全选</span>
            </label>
            <span class="count-text">显示 {{ filteredSnapshots.length }} / {{ snapshots.length }} 条</span>
          </div>

          <!-- High-Density Record Stream -->
          <div v-if="loading" class="empty-state">
            <div class="spinner"></div>
            <span>正在读取记录...</span>
          </div>
          <div v-else-if="!filteredSnapshots.length" class="empty-state">无匹配快照</div>
          <div v-else class="record-feed">
            <div
              v-for="item in filteredSnapshots"
              :key="recordKey(item)"
              class="feed-row"
              :class="{ active: selectedKey === recordKey(item), debug: item.source === 'debug' }"
              @click="selectSnapshot(item)"
            >
              <div class="chk-wrap" @click.stop>
                <input type="checkbox" :checked="selectedRecords.has(recordKey(item))" @change="toggleRecord(item)">
              </div>

              <div class="thumb-box">
                <img v-if="item.imageAvailable" :src="thumbnailUrl(item)" alt="" class="thumb-img" loading="lazy">
                <div v-else class="thumb-img placeholder">NO IMG</div>
              </div>

              <div class="row-main">
                <div class="row-top">
                  <strong class="map-title" :title="item.map || mapFromLayer(item.layer)">{{ item.map || mapFromLayer(item.layer) || "未知地图" }}</strong>
                  <span class="mode-tag">{{ item.mode || modeFromLayer(item.layer) || "-" }}</span>
                  <span class="source-tag" :class="item.source">{{ item.source === "debug" ? "DEBUG" : "正式" }}</span>
                </div>
                <div class="row-sub">
                  <span class="time-str">{{ formatDate(item.capturedAt, true) }}</span>
                  <span class="tag-sm">{{ formatDuration(item.duration) }}</span>
                  <span class="tag-sm">{{ item.playerCount }}人</span>
                  <span class="tag-sm winner" :class="normalizeWinner(item.winner)">{{ winnerLabel(item.winner) }}</span>
                </div>
              </div>
            </div>
          </div>

          <footer v-if="selectedRecords.size" class="batch-foot">
            <span>已选 <strong>{{ selectedRecords.size }}</strong> 项 ({{ formatBytes(selectedSize) }})</span>
            <button type="button" class="btn-compact danger" :disabled="busy" @click="deleteBatch">批量删除</button>
          </footer>
        </div>
      </template>

      <template #right>
        <div class="card-panel detail-panel">
          <div v-if="!selectedSnapshot" class="empty-state">从左侧选择一场对局查看完整战绩</div>
          <template v-else>
            <!-- Stage Tabs Header -->
            <div class="stage-nav">
              <div class="nav-tabs">
                <button type="button" class="stage-tab-btn" :class="{ active: activeTab === 'scoreboard' }" @click="activeTab = 'scoreboard'">
                  📊 战绩积分榜
                </button>
                <button type="button" class="stage-tab-btn" :class="{ active: activeTab === 'image' }" @click="activeTab = 'image'">
                  📷 快照原图 (PNG)
                </button>
                <button type="button" class="stage-tab-btn" :class="{ active: activeTab === 'json' }" @click="activeTab = 'json'">
                  📄 Raw JSON
                </button>
              </div>

              <div class="nav-actions">
                <button type="button" class="btn-compact accent" :disabled="regenerating" @click="regenerateImage">⚡ 重新生成</button>
                <button type="button" class="btn-compact ghost" :disabled="!selectedSnapshot.imageAvailable" @click="downloadImage">⬇️ PNG</button>
                <button type="button" class="btn-compact ghost" @click="downloadSelected">📄 JSON</button>
                <button type="button" class="btn-compact danger" :disabled="busy" @click="deleteSelected">🗑️ 删除</button>
              </div>
            </div>

            <!-- Tab 1: Scoreboard Stage -->
            <div v-if="activeTab === 'scoreboard'" class="stage-body scoreboard-stage">
              <!-- Compact Match Overview Bar + Image Banner Toggle -->
              <div class="match-meta-bar">
                <div class="meta-item wide">
                  <span class="lbl">图层:</span>
                  <strong>{{ detail?.match?.layer || selectedSnapshot.layer || "-" }}</strong>
                </div>
                <div class="meta-item">
                  <span class="lbl">时长:</span>
                  <strong>{{ formatDuration(selectedSnapshot.duration) }}</strong>
                </div>
                <div class="meta-item">
                  <span class="lbl">玩家:</span>
                  <strong>{{ detail?.server?.playerCount ?? detail?.players?.length ?? 0 }} 人</strong>
                </div>
                <div class="meta-item">
                  <span class="lbl">胜利:</span>
                  <strong :class="normalizeWinner(selectedSnapshot.winner)">{{ winnerLabel(selectedSnapshot.winner) }}</strong>
                </div>
                <button
                  type="button"
                  class="btn-compact ghost image-toggle-btn"
                  :disabled="!selectedSnapshot.imageAvailable"
                  @click="showInlineImage = !showInlineImage"
                >
                  📷 {{ showInlineImage ? "隐藏战绩图片" : "显示战绩图片" }}
                </button>
              </div>

              <!-- Inline Battle Snapshot Image Banner Stage -->
              <div v-if="showInlineImage && selectedSnapshot.imageAvailable" class="inline-image-banner">
                <div class="banner-header">
                  <span>对局战绩图片原图 (PNG)</span>
                  <a :href="reportImageUrl" target="_blank" rel="noopener noreferrer" class="link-open">全屏查看 ↗</a>
                </div>
                <img :src="reportImageUrl" alt="对局战绩快照" loading="lazy" class="banner-img">
              </div>

              <div v-if="detailLoading" class="empty-state">
                <div class="spinner"></div>
                <span>正在加载积分榜...</span>
              </div>
              <template v-else-if="detail?.players?.length">
                <!-- Dual Team Header Filter Toolbar -->
                <div class="scoreboard-toolbar">
                  <input v-model.trim="playerSearch" type="search" placeholder="搜索玩家、ID、Role..." class="search-mini">

                  <div class="sub-tab-group">
                    <button type="button" class="btn-sub" :class="{ active: scoreboardSubTab === 'versus' }" @click="scoreboardSubTab = 'versus'">
                      ⚔️ 阵营对比
                    </button>
                    <button type="button" class="btn-sub" :class="{ active: scoreboardSubTab === 'team1' }" @click="scoreboardSubTab = 'team1'">
                      🟦 Team 1 ({{ team1Players.length }})
                    </button>
                    <button type="button" class="btn-sub" :class="{ active: scoreboardSubTab === 'team2' }" @click="scoreboardSubTab = 'team2'">
                      🟥 Team 2 ({{ team2Players.length }})
                    </button>
                    <button type="button" class="btn-sub" :class="{ active: scoreboardSubTab === 'all' }" @click="scoreboardSubTab = 'all'">
                      📋 全员
                    </button>
                  </div>
                </div>

                <!-- Scoreboard Views -->
                <div v-if="scoreboardSubTab === 'versus'" class="versus-cards-grid">
                  <div class="team-summary-box t1">
                    <div class="t-head"><span class="t-badge t1">Team 1</span><span>{{ filteredTeam1Players.length }} 玩家</span></div>
                    <div class="t-stats">
                      <div class="stat-line"><span>总击杀 (K)</span><strong class="green">{{ team1Kills }}</strong></div>
                      <div class="stat-line"><span>总得分</span><strong class="cyan">{{ team1Score }}</strong></div>
                      <div class="stat-line" v-if="topPlayerTeam1"><span>阵营 MVP</span><strong class="gold">{{ topPlayerTeam1.name }} ({{ topPlayerTeam1.bzssCore?.kills || 0 }}K)</strong></div>
                    </div>
                    <button type="button" class="btn-team-more t1" @click="scoreboardSubTab = 'team1'">查看 Team 1 完整名单 →</button>
                  </div>

                  <div class="team-summary-box t2">
                    <div class="t-head"><span class="t-badge t2">Team 2</span><span>{{ filteredTeam2Players.length }} 玩家</span></div>
                    <div class="t-stats">
                      <div class="stat-line"><span>总击杀 (K)</span><strong class="green">{{ team2Kills }}</strong></div>
                      <div class="stat-line"><span>总得分</span><strong class="cyan">{{ team2Score }}</strong></div>
                      <div class="stat-line" v-if="topPlayerTeam2"><span>阵营 MVP</span><strong class="gold">{{ topPlayerTeam2.name }} ({{ topPlayerTeam2.bzssCore?.kills || 0 }}K)</strong></div>
                    </div>
                    <button type="button" class="btn-team-more t2" @click="scoreboardSubTab = 'team2'">查看 Team 2 完整名单 →</button>
                  </div>
                </div>

                <div v-else-if="scoreboardSubTab === 'team1'" class="player-table-container">
                  <AppTable compact class="p-table">
                    <thead><tr><th>玩家</th><th>小队</th><th>Role</th><th>K/W/D</th><th>TK</th><th>复苏</th><th>战斗分</th><th>目标分</th><th>团队分</th><th>延迟</th></tr></thead>
                    <tbody>
                      <tr v-for="player in filteredTeam1Players" :key="playerKey(player)">
                        <td class="p-name"><strong>{{ player.name || "Unknown" }}</strong><small class="font-mono">{{ player.steamID || player.eosID || "-" }}</small></td>
                        <td>{{ player.squadInfo?.name || squadLabel(player.squadID) }}</td>
                        <td><span class="role-tag">{{ player.role || player.bzssCore?.soldierClass || "-" }}</span></td>
                        <td><span class="kwd font-mono"><em class="k">{{ stat(player.bzssCore?.kills) }}</em>/<em class="w">{{ stat(player.bzssCore?.downs) }}</em>/<em class="d">{{ stat(player.bzssCore?.deaths) }}</em></span></td>
                        <td><span v-if="Number(player.bzssCore?.teamKills) > 0" class="tk-tag">{{ stat(player.bzssCore?.teamKills) }}</span><span v-else>-</span></td>
                        <td><span class="rev-tag">{{ stat(player.bzssCore?.revives) }}</span></td>
                        <td>{{ stat(player.bzssCore?.combatScore) }}</td>
                        <td>{{ stat(player.bzssCore?.objectiveScore) }}</td>
                        <td>{{ stat(player.bzssCore?.teamworkScore) }}</td>
                        <td class="font-mono text-muted">{{ pingLabel(player.bzssCore?.ping) }}</td>
                      </tr>
                    </tbody>
                  </AppTable>
                </div>

                <div v-else-if="scoreboardSubTab === 'team2'" class="player-table-container">
                  <AppTable compact class="p-table">
                    <thead><tr><th>玩家</th><th>小队</th><th>Role</th><th>K/W/D</th><th>TK</th><th>复苏</th><th>战斗分</th><th>目标分</th><th>团队分</th><th>延迟</th></tr></thead>
                    <tbody>
                      <tr v-for="player in filteredTeam2Players" :key="playerKey(player)">
                        <td class="p-name"><strong>{{ player.name || "Unknown" }}</strong><small class="font-mono">{{ player.steamID || player.eosID || "-" }}</small></td>
                        <td>{{ player.squadInfo?.name || squadLabel(player.squadID) }}</td>
                        <td><span class="role-tag">{{ player.role || player.bzssCore?.soldierClass || "-" }}</span></td>
                        <td><span class="kwd font-mono"><em class="k">{{ stat(player.bzssCore?.kills) }}</em>/<em class="w">{{ stat(player.bzssCore?.downs) }}</em>/<em class="d">{{ stat(player.bzssCore?.deaths) }}</em></span></td>
                        <td><span v-if="Number(player.bzssCore?.teamKills) > 0" class="tk-tag">{{ stat(player.bzssCore?.teamKills) }}</span><span v-else>-</span></td>
                        <td><span class="rev-tag">{{ stat(player.bzssCore?.revives) }}</span></td>
                        <td>{{ stat(player.bzssCore?.combatScore) }}</td>
                        <td>{{ stat(player.bzssCore?.objectiveScore) }}</td>
                        <td>{{ stat(player.bzssCore?.teamworkScore) }}</td>
                        <td class="font-mono text-muted">{{ pingLabel(player.bzssCore?.ping) }}</td>
                      </tr>
                    </tbody>
                  </AppTable>
                </div>

                <div v-else class="player-table-container">
                  <AppTable compact class="p-table">
                    <thead><tr><th>玩家</th><th>队伍/小队</th><th>Role</th><th>K/W/D</th><th>TK</th><th>载具</th><th>复苏</th><th>战斗分</th><th>目标分</th><th>团队分</th><th>延迟</th></tr></thead>
                    <tbody>
                      <tr v-for="player in searchedPlayers" :key="playerKey(player)">
                        <td class="p-name"><strong>{{ player.name || "Unknown" }}</strong><small class="font-mono">{{ player.steamID || player.eosID || "-" }}</small></td>
                        <td><span class="team-pill" :class="`t${player.teamID}`">T{{ player.teamID ?? "-" }}</span> {{ player.squadInfo?.name || squadLabel(player.squadID) }}</td>
                        <td><span class="role-tag">{{ player.role || player.bzssCore?.soldierClass || "-" }}</span></td>
                        <td><span class="kwd font-mono"><em class="k">{{ stat(player.bzssCore?.kills) }}</em>/<em class="w">{{ stat(player.bzssCore?.downs) }}</em>/<em class="d">{{ stat(player.bzssCore?.deaths) }}</em></span></td>
                        <td>{{ stat(player.bzssCore?.teamKills) }}</td>
                        <td>{{ stat(player.bzssCore?.vehicleKills) }}</td>
                        <td><span class="rev-tag">{{ stat(player.bzssCore?.revives) }}</span></td>
                        <td>{{ stat(player.bzssCore?.combatScore) }}</td>
                        <td>{{ stat(player.bzssCore?.objectiveScore) }}</td>
                        <td>{{ stat(player.bzssCore?.teamworkScore) }}</td>
                        <td class="font-mono text-muted">{{ pingLabel(player.bzssCore?.ping) }}</td>
                      </tr>
                    </tbody>
                  </AppTable>
                </div>
              </template>
            </div>

            <!-- Tab 2: Image Stage -->
            <div v-else-if="activeTab === 'image'" class="stage-body image-stage">
              <img v-if="selectedSnapshot.imageAvailable" :src="reportImageUrl" alt="对局结束快照" loading="lazy">
              <div v-else class="empty-state">战绩原图不可用</div>
            </div>

            <!-- Tab 3: JSON Stage -->
            <div v-else-if="activeTab === 'json'" class="stage-body json-stage">
              <div class="json-header font-mono">
                <span>{{ selectedSnapshot.id }}.json</span>
                <button type="button" class="btn-compact ghost" @click="copyJson(detail)">复制 JSON</button>
              </div>
              <pre class="json-code font-mono"><code>{{ JSON.stringify(detail, null, 2) }}</code></pre>
            </div>
          </template>
        </div>
      </template>
    </AppSplitLayout>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
import AppPage from "../components/common/AppPage.vue";
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
const activeTab = ref<"scoreboard" | "image" | "json">("scoreboard");
const scoreboardSubTab = ref<"versus" | "team1" | "team2" | "all">("versus");
const imageVersion = ref(String(Date.now()));
const errorMessage = ref("");
const playerSearch = ref("");
const showAdvancedFilter = ref(false);
const showInlineImage = ref(true);

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

const filteredSnapshots = computed(() => {
  const range = resolveTimeRange(filters.value.time, filters.value.from, filters.value.to);
  const search = filters.value.search.toLowerCase();
  const result = snapshots.value.filter((item) => {
    const capturedMs = Date.parse(item.capturedAt);
    if (range.from != null && (!Number.isFinite(capturedMs) || capturedMs < range.from)) return false;
    if (range.to != null && (!Number.isFinite(capturedMs) || capturedMs > range.to)) return false;
    if (filters.value.map && (item.map || mapFromLayer(item.layer)) !== filters.value.map) return false;
    if (filters.value.source && item.source !== filters.value.source) return false;
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
  return result.sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
});

const visibleKeys = computed(() => filteredSnapshots.value.map(recordKey));
const allVisibleSelected = computed(() => visibleKeys.value.length > 0 && visibleKeys.value.every((key) => selectedRecords.value.has(key)));
const someVisibleSelected = computed(() => !allVisibleSelected.value && visibleKeys.value.some((key) => selectedRecords.value.has(key)));
const selectedSize = computed(() =>
  snapshots.value.filter((item) => selectedRecords.value.has(recordKey(item))).reduce((sum, item) => sum + Number(item.totalSize || item.size || 0), 0),
);
const hasActiveFilters = computed(() => Boolean(filters.value.search || filters.value.time !== "all" || filters.value.map || filters.value.source || filters.value.winner));

const reportImageUrl = computed(() => selectedSnapshot.value ? assetUrl("/api/match-end-snapshot/image", selectedSnapshot.value, imageVersion.value) : "");

const allPlayersList = computed(() => detail.value?.players || []);
const searchedPlayers = computed(() => {
  if (!playerSearch.value) return allPlayersList.value;
  const q = playerSearch.value.toLowerCase();
  return allPlayersList.value.filter(p => (p.name || "").toLowerCase().includes(q) || (p.steamID || "").toLowerCase().includes(q) || (p.role || "").toLowerCase().includes(q));
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
    ui.pushToast({ title: "复制失败", message: "剪贴板权限未获得", tone: "warn" });
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
    selectedRecords.value = new Set(Array.from(selectedRecords.value).filter((key) => records.some((item) => recordKey(item) === key)));
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
    detail.value = await apiGet<SnapshotDetail>(`/api/match-end-snapshot/view?id=${encodeURIComponent(item.id)}&scope=${item.source}`);
  } catch {
    detail.value = null;
  } finally {
    detailLoading.value = false;
  }
}

async function captureDebugSnapshot() {
  if (debugCapturing.value) return;
  debugCapturing.value = true;
  try {
    const result = await apiPost<CaptureResponse>("/api/match-end-snapshot/debug/capture", {}, {}, { timeoutMs: 120_000 });
    await loadAll();
    if (result?.snapshot?.id) selectedKey.value = `debug:${result.snapshot.id}`;
    ui.pushToast({ title: "调试快照已写入", message: "已保存调试存档。", tone: "ok" });
  } catch (error) {
    await loadAll();
    ui.pushToast({ title: "写入失败", message: error instanceof Error ? error.message : String(error), tone: "error" });
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
    activeTab.value = "image";
    await loadAll();
    ui.pushToast({ title: "图片已重新生成", message: "原图及缩略图已更新。", tone: "ok" });
  } catch (error) {
    ui.pushToast({ title: "重新生成失败", message: String(error instanceof Error ? error.message : error), tone: "error" });
  } finally {
    regenerating.value = false;
  }
}

async function deleteSelected() {
  const selected = selectedSnapshot.value;
  if (selected) await confirmAndDelete([selected]);
}

async function deleteBatch() {
  const records = snapshots.value.filter((item) => selectedRecords.value.has(recordKey(item)));
  if (records.length) await confirmAndDelete(records);
}

async function confirmAndDelete(records: SnapshotListItem[]) {
  const confirmed = await ui.openConfirm({
    title: `删除 ${records.length} 个快照`,
    message: `确认彻底删除选中的 ${records.length} 个快照文件及其全部资产吗？`,
    confirmText: "确认删除", cancelText: "取消", tone: "warn",
  });
  if (!confirmed) return;
  busy.value = true;
  try {
    await apiPost("/api/match-end-snapshot/delete-batch", { records: records.map((item) => ({ id: item.id, scope: item.source })) });
    selectedRecords.value = new Set();
    if (records.some((item) => recordKey(item) === selectedKey.value)) {
      selectedKey.value = ""; detail.value = null;
    }
    await loadAll();
    ui.pushToast({ title: "已删除", message: `成功删除 ${records.length} 个快照。`, tone: "ok" });
  } catch (error) {
    ui.pushToast({ title: "删除失败", message: String(error instanceof Error ? error.message : error), tone: "error" });
  } finally {
    busy.value = false;
  }
}

function selectSnapshot(item: SnapshotListItem) { selectedKey.value = recordKey(item); }
function toggleRecord(item: SnapshotListItem) {
  const next = new Set(selectedRecords.value); const key = recordKey(item);
  next.has(key) ? next.delete(key) : next.add(key); selectedRecords.value = next;
}
function toggleSelectAll() {
  const next = new Set(selectedRecords.value); const select = !allVisibleSelected.value;
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
function thumbnailUrl(item: SnapshotListItem) { return assetUrl("/api/match-end-snapshot/thumbnail", item); }
function assetUrl(path: string, item: SnapshotListItem, version = "") { return `${path}?id=${encodeURIComponent(item.id)}&scope=${item.source}${version ? `&v=${encodeURIComponent(version)}` : ""}`; }
function recordKey(item: SnapshotListItem) { return `${item.source || "official"}:${item.id}`; }
function formatBytes(value: number | null | undefined) {
  const bytes = Number(value || 0); if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"]; const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index >= 2 ? 1 : 0)}${units[index]}`;
}
function formatDate(value: string, compact = false) {
  const date = new Date(value); if (Number.isNaN(date.getTime())) return value || "-";
  if (compact) return date.toLocaleTimeString("zh-CN", { hour12: false });
  return date.toLocaleString("zh-CN", { hour12: false });
}
function formatDuration(seconds: number | null | undefined) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); const secs = total % 60;
  return hours ? `${hours}h${minutes}m` : minutes ? `${minutes}m${secs}s` : `${secs}s`;
}
function modeFromLayer(layer?: string) { return String(layer || "").match(/(?:^|_)(RAAS|AAS|Invasion|TC|Seed|Skirmish|Destruction)(?:_|$)/i)?.[1] || ""; }
function mapFromLayer(layer?: string) { return String(layer || "").replace(/_(?:RAAS|AAS|Invasion|TC|Seed|Skirmish|Destruction).*$/i, ""); }
function normalizeWinner(value?: string) {
  const text = String(value || "").toLowerCase().replace(/\s+/g, "");
  if (/team?1|blue|1队/.test(text)) return "team1"; if (/team?2|red|2队/.test(text)) return "team2"; return "draw";
}
function winnerLabel(value?: string) {
  const winner = normalizeWinner(value); return winner === "team1" ? "Team 1 胜" : winner === "team2" ? "Team 2 胜" : "平局";
}
function resolveTimeRange(type: string, from: string, to: string) {
  const now = new Date(); const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (type === "today") return { from: startOfToday, to: null };
  if (type === "yesterday") return { from: startOfToday - 86_400_000, to: startOfToday - 1 };
  if (type === "7d") return { from: now.getTime() - 7 * 86_400_000, to: null };
  return { from: null, to: null };
}
function playerKey(player: SnapshotPlayer) { return [player.steamID, player.eosID, player.playerID, player.teamID, player.name].map(v => String(v ?? "")).join("|"); }
function squadLabel(value: number | null | undefined) { return value == null ? "-" : `Sq.${value}`; }
function stat(value: number | null | undefined) { const num = Number(value); return Number.isFinite(num) ? Math.trunc(num) : "-"; }
function pingLabel(value: number | null | undefined) { const num = Number(value); return Number.isFinite(num) ? `${Math.round(num)}ms` : "-"; }

watch(selectedKey, () => { imageVersion.value = String(Date.now()); void loadDetail(selectedSnapshot.value); });
onMounted(loadAll);
</script>

<style scoped>
.end-snapshot-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 6px;
}

/* Streamlined Single Command Header */
.page-cmd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.header-left { display: flex; align-items: center; gap: 12px; }

.page-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--color-text-primary);
  margin: 0;
  letter-spacing: -0.01em;
}

.kpi-inline-group { display: flex; align-items: center; gap: 6px; }

.kpi-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  color: var(--color-text-secondary);
}

.kpi-tag .dot { width: 6px; height: 6px; border-radius: 50%; }
.kpi-tag.cyan .dot { background: #38bdf8; }
.kpi-tag.emerald .dot { background: #22c55e; }
.kpi-tag.purple .dot { background: #a78bfa; }
.kpi-tag.amber .dot { background: #f59e0b; }
.kpi-tag strong { color: var(--color-text-primary); font-weight: 700; }
.kpi-tag em { font-style: normal; font-size: 9px; opacity: 0.7; }

.header-right { display: flex; gap: 6px; }

/* Split Layout & Panels */
.compact-split {
  flex: 1;
  min-height: 0;
  grid-template-columns: minmax(320px, 380px) minmax(0, 1fr) !important;
  gap: 6px;
}

.card-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid var(--color-border-soft);
  overflow: hidden;
}

.panel-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  border-bottom: 1px solid var(--color-border-soft);
  background: rgba(15, 23, 42, 0.4);
}

.search-input-wrap { position: relative; flex: 1; }
.search-icon { position: absolute; left: 6px; top: 50%; transform: translateY(-50%); width: 12px; height: 12px; color: var(--color-text-muted); }

.search-field {
  width: 100%;
  height: 24px;
  padding: 0 6px 0 22px;
  border-radius: 4px;
  border: 1px solid var(--color-border-soft);
  background: rgba(15, 23, 42, 0.9);
  color: var(--color-text-primary);
  font-size: 11px;
}

.btn-icon-filter { width: 24px; height: 24px; border-radius: 4px; border: 1px solid var(--color-border-soft); background: rgba(255, 255, 255, 0.03); color: var(--color-text-secondary); font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.btn-icon-filter.active { border-color: #38bdf8; background: rgba(56, 189, 248, 0.15); color: #38bdf8; }

.filter-drawer { padding: 6px; background: rgba(0, 0, 0, 0.3); border-bottom: 1px solid var(--color-border-soft); display: flex; flex-direction: column; gap: 4px; }
.drawer-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
.f-field { display: flex; flex-direction: column; gap: 2px; font-size: 9.5px; color: var(--color-text-muted); }
.f-field select { height: 22px; padding: 0 4px; border-radius: 3px; border: 1px solid var(--color-border-soft); background: rgba(15, 23, 42, 0.9); color: var(--color-text-primary); font-size: 10.5px; }
.drawer-foot { display: flex; justify-content: flex-end; }
.btn-reset { padding: 1px 5px; border-radius: 3px; border: 1px solid rgba(245, 158, 11, 0.3); background: rgba(245, 158, 11, 0.1); color: #fbbf24; font-size: 9.5px; cursor: pointer; }

.panel-sub-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 6px;
  background: rgba(0, 0, 0, 0.2);
  font-size: 10px;
  color: var(--color-text-muted);
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
}

.select-all-label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
.select-all-label input { width: 12px; height: 12px; }

/* Record Feed Items */
.record-feed {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  scrollbar-gutter: stable;
}

.feed-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.1s ease;
}

.feed-row:hover { background: rgba(255, 255, 255, 0.04); border-color: rgba(255, 255, 255, 0.08); }
.feed-row.active { background: rgba(56, 189, 248, 0.08); border-color: rgba(56, 189, 248, 0.3); }
.feed-row.debug { border-left: 2.5px solid #f59e0b; }

.chk-wrap input { width: 12px; height: 12px; display: block; }

.thumb-box { width: 68px; height: 38px; border-radius: 4px; overflow: hidden; background: #060a12; flex-shrink: 0; }
.thumb-img { width: 100%; height: 100%; object-fit: cover; }
.thumb-img.placeholder { display: flex; align-items: center; justify-content: center; font-size: 8px; font-family: monospace; color: var(--color-text-muted); }

.row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.row-top { display: flex; align-items: center; gap: 4px; }

.map-title { font-size: 11.5px; font-weight: 700; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mode-tag { font-size: 8.5px; padding: 0 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.05); color: var(--color-text-secondary); }
.source-tag { font-size: 8px; font-weight: 800; padding: 0 3px; border-radius: 2px; }
.source-tag.debug { color: #fbbf24; background: rgba(245, 158, 11, 0.15); }
.source-tag.official { color: #38bdf8; background: rgba(56, 189, 248, 0.15); }

.row-sub { display: flex; align-items: center; gap: 4px; font-size: 9px; }
.time-str { color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
.tag-sm { padding: 0 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.03); color: var(--color-text-secondary); }
.tag-sm.winner.team1 { color: #60a5fa; background: rgba(59, 130, 246, 0.12); }
.tag-sm.winner.team2 { color: #f87171; background: rgba(239, 68, 68, 0.12); }

.batch-foot { display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; background: rgba(239, 68, 68, 0.08); border-top: 1px solid rgba(239, 68, 68, 0.2); font-size: 10px; color: #fecaca; }

/* Right Detail Stage Panel */
.detail-panel { display: flex; flex-direction: column; }

.stage-nav { display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; background: rgba(15, 23, 42, 0.8); border-bottom: 1px solid var(--color-border-soft); }
.nav-tabs { display: flex; gap: 2px; }

.stage-tab-btn { padding: 3px 8px; border-radius: 4px; border: 0; background: transparent; color: var(--color-text-muted); font-size: 11px; font-weight: 600; cursor: pointer; }
.stage-tab-btn.active { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }

.nav-actions { display: flex; gap: 4px; }

.stage-body { flex: 1; min-height: 0; overflow: auto; position: relative; }

.scoreboard-stage { display: flex; flex-direction: column; gap: 6px; padding: 6px; }

.match-meta-bar { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 4px; background: rgba(0, 0, 0, 0.3); border: 1px solid var(--color-border-soft); font-size: 10.5px; }
.meta-item { display: flex; gap: 4px; color: var(--color-text-secondary); }
.meta-item.wide { flex: 1; }
.meta-item .lbl { color: var(--color-text-muted); }

.scoreboard-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.search-mini { height: 22px; padding: 0 6px; border-radius: 4px; border: 1px solid var(--color-border-soft); background: rgba(15, 23, 42, 0.9); color: var(--color-text-primary); font-size: 10px; width: 110px; }

.sub-tab-group { display: flex; gap: 2px; background: rgba(0, 0, 0, 0.3); padding: 2px; border-radius: 4px; }
.btn-sub { padding: 2px 6px; border-radius: 3px; border: 0; background: transparent; color: var(--color-text-muted); font-size: 10px; cursor: pointer; }
.btn-sub.active { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }

.versus-cards-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.team-summary-box { padding: 6px 8px; border-radius: 5px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--color-border-soft); display: flex; flex-direction: column; gap: 4px; }
.team-summary-box.t1 { border-top: 2px solid #3b82f6; }
.team-summary-box.t2 { border-top: 2px solid #ef4444; }

.t-head { display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: var(--color-text-muted); }
.t-badge { padding: 1px 5px; border-radius: 3px; font-weight: 700; }
.t-badge.t1 { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
.t-badge.t2 { background: rgba(239, 68, 68, 0.2); color: #f87171; }

.t-stats { display: flex; flex-direction: column; gap: 2px; }
.stat-line { display: flex; justify-content: space-between; font-size: 10px; padding: 2px 4px; background: rgba(0, 0, 0, 0.2); border-radius: 2px; }
.stat-line .green { color: #22c55e; }
.stat-line .cyan { color: #38bdf8; }
.stat-line .gold { color: #fbbf24; }

.btn-team-more { padding: 3px; border-radius: 3px; border: 0; font-size: 9.5px; font-weight: 600; cursor: pointer; text-align: center; }
.btn-team-more.t1 { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
.btn-team-more.t2 { background: rgba(239, 68, 68, 0.15); color: #f87171; }

.player-table-container { flex: 1; overflow: auto; border: 1px solid var(--color-border-soft); border-radius: 4px; }
.p-table { width: 100%; font-size: 10px; }
.p-name strong { display: block; color: var(--color-text-primary); }
.p-name small { font-size: 8px; color: var(--color-text-muted); }

.role-tag { padding: 1px 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.05); color: var(--color-text-secondary); font-size: 9px; }
.kwd { display: inline-flex; gap: 1px; }
.kwd .k { color: #22c55e; font-style: normal; font-weight: 700; }
.kwd .w { color: var(--color-text-muted); font-style: normal; }
.kwd .d { color: #f87171; font-style: normal; }
.tk-tag { color: #fb7185; font-weight: 700; }
.rev-tag { color: #38bdf8; }
.team-pill { padding: 1px 3px; border-radius: 2px; font-size: 8px; font-weight: 700; }
.team-pill.t1 { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
.team-pill.t2 { background: rgba(239, 68, 68, 0.2); color: #f87171; }

.image-stage { display: flex; align-items: center; justify-content: center; background: #060911; padding: 6px; }
.image-stage img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px; }

.json-stage { display: flex; flex-direction: column; background: #060911; }
.json-header { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; background: rgba(15, 23, 42, 0.6); border-bottom: 1px solid var(--color-border-soft); font-size: 10px; color: var(--color-text-muted); }
.json-code { flex: 1; margin: 0; padding: 8px; overflow: auto; font-size: 10px; color: #7dd3fc; }

.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 30px; color: var(--color-text-muted); font-size: 11px; text-align: center; }
.spinner { width: 16px; height: 16px; border: 2px solid rgba(56, 189, 248, 0.2); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.btn-compact { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 6px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer; border: 1px solid var(--color-border-default); background: rgba(255, 255, 255, 0.04); color: var(--color-text-secondary); }
.btn-compact .icon { width: 12px; height: 12px; }
.btn-compact:hover { border-color: var(--color-border-hover); color: var(--color-text-primary); background: rgba(255, 255, 255, 0.08); }
.btn-compact.accent { background: rgba(56, 189, 248, 0.15); border-color: rgba(56, 189, 248, 0.3); color: #38bdf8; }
.btn-compact.danger { border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.1); color: #fecaca; }
.btn-compact.ghost { background: transparent; border-color: rgba(255, 255, 255, 0.06); }

.inline-image-banner {
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--color-border-soft);
  background: #060911;
  display: flex;
  flex-direction: column;
}

.banner-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: rgba(15, 23, 42, 0.8);
  font-size: 10px;
  color: var(--color-text-secondary);
}

.link-open { color: #38bdf8; text-decoration: none; font-size: 10px; }
.link-open:hover { text-decoration: underline; }

.banner-img {
  width: 100%;
  max-height: 280px;
  object-fit: contain;
  background: #000;
  display: block;
}

@media (max-width: 1000px) {
  .compact-split { grid-template-columns: 1fr !important; }
}
</style>
