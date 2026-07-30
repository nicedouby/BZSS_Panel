<template>
  <AppPage full-bleed>
    <AppPageHeader
      title="对局结束快照"
      subtitle="以对局为单位管理战绩图片、冻结数据与独立调试存档。"
      :status-items="headerStatusItems"
    >
      <template #actions>
        <button type="button" class="action-btn ghost" :disabled="loading" @click="loadAll">
          {{ loading ? "刷新中..." : "刷新记录" }}
        </button>
        <button type="button" class="action-btn accent" :disabled="debugCapturing" @click="captureDebugSnapshot">
          {{ debugCapturing ? "写入中..." : "写入调试快照" }}
        </button>
      </template>
    </AppPageHeader>

    <section class="statistics-grid" aria-label="快照统计">
      <article class="stat-card">
        <span>总快照</span>
        <strong>{{ statistics.total }}</strong>
        <small>正式 {{ statistics.official }} / 调试 {{ statistics.debug }}</small>
      </article>
      <article class="stat-card">
        <span>占用空间</span>
        <strong>{{ formatBytes(statistics.size) }}</strong>
        <small>JSON、原图、缩略图与清单</small>
      </article>
      <article class="stat-card">
        <span>本月</span>
        <strong>{{ statistics.thisMonth }} 场</strong>
        <small>当前自然月生成记录</small>
      </article>
      <article class="stat-card">
        <span>平均大小</span>
        <strong>{{ formatBytes(statistics.averageSize) }}</strong>
        <small>每场全部快照资产</small>
      </article>
      <article class="stat-card">
        <span>最早记录</span>
        <strong class="date-value">{{ statistics.earliest ? formatDate(statistics.earliest, true) : "-" }}</strong>
        <small>用于判断清理范围</small>
      </article>
    </section>

    <AppCard compact title="筛选与排序" class="filter-card">
      <div class="filter-grid">
        <label class="field search-field">
          <span>搜索</span>
          <input v-model.trim="filters.search" type="search" placeholder="地图、图层、模式或快照 ID">
        </label>
        <label class="field">
          <span>时间</span>
          <select v-model="filters.time">
            <option value="all">全部</option>
            <option value="today">今天</option>
            <option value="yesterday">昨天</option>
            <option value="7d">最近 7 天</option>
            <option value="30d">最近 30 天</option>
            <option value="custom">自定义</option>
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
          <span>玩家</span>
          <select v-model="filters.players">
            <option value="">全部人数</option>
            <option value="80+">80 人以上</option>
            <option value="50-79">50–79 人</option>
            <option value="0-49">少于 50 人</option>
          </select>
        </label>
        <label class="field">
          <span>结果</span>
          <select v-model="filters.winner">
            <option value="">全部结果</option>
            <option value="team1">Team 1 胜利</option>
            <option value="team2">Team 2 胜利</option>
            <option value="draw">平局 / 无结果</option>
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
          <span>排序</span>
          <select v-model="filters.sort">
            <option value="newest">最新</option>
            <option value="oldest">最旧</option>
            <option value="largest">最大文件</option>
            <option value="longest">最长比赛</option>
            <option value="players">人数最多</option>
          </select>
        </label>
      </div>
      <div v-if="filters.time === 'custom'" class="custom-date-row">
        <label class="field"><span>开始日期</span><input v-model="filters.from" type="date"></label>
        <label class="field"><span>结束日期</span><input v-model="filters.to" type="date"></label>
      </div>
    </AppCard>

    <AppSplitLayout class="end-snapshot-layout" responsive-mode="stack">
      <template #left>
        <AppCard
          compact
          body-mode="fill"
          overflow="clip"
          title="快照记录"
          :description="`显示 ${filteredSnapshots.length} / ${snapshots.length} 条`"
          class="history-card"
        >
          <div class="list-tools">
            <label class="select-all">
              <input
                type="checkbox"
                :checked="allVisibleSelected"
                :indeterminate="someVisibleSelected"
                @change="toggleSelectAll"
              >
              <span>选择当前结果</span>
            </label>
            <button v-if="hasActiveFilters" type="button" class="text-btn" @click="resetFilters">清除筛选</button>
          </div>

          <div v-if="loading" class="empty-state">正在加载快照资产...</div>
          <div v-else-if="!filteredSnapshots.length" class="empty-state">没有符合条件的快照</div>
          <div v-else class="record-list">
            <article
              v-for="item in filteredSnapshots"
              :key="recordKey(item)"
              class="record-card"
              :class="{ active: selectedKey === recordKey(item), debug: item.source === 'debug' }"
              @click="selectSnapshot(item)"
            >
              <label class="record-check" @click.stop>
                <input
                  type="checkbox"
                  :checked="selectedRecords.has(recordKey(item))"
                  @change="toggleRecord(item)"
                >
                <span class="sr-only">选择 {{ item.layer || item.map }}</span>
              </label>
              <img
                v-if="item.imageAvailable"
                class="record-thumb"
                :src="thumbnailUrl(item)"
                alt=""
                loading="lazy"
              >
              <div v-else class="record-thumb placeholder">NO IMAGE</div>
              <div class="record-body">
                <header>
                  <div>
                    <strong>{{ item.map || mapFromLayer(item.layer) || "未知地图" }}</strong>
                    <span>{{ item.mode || modeFromLayer(item.layer) || "-" }}</span>
                  </div>
                  <span class="source-badge" :class="item.source">{{ item.source === "debug" ? "DEBUG" : "正式" }}</span>
                </header>
                <div class="record-time">{{ formatDate(item.capturedAt) }}</div>
                <div class="record-metrics">
                  <span>{{ formatDuration(item.duration) }}</span>
                  <span>{{ item.playerCount }} 玩家</span>
                  <span>{{ winnerLabel(item.winner) }}</span>
                  <span>{{ formatBytes(item.totalSize || item.size) }}</span>
                </div>
                <div v-if="item.renderStatus === 'failed'" class="render-error" :title="item.renderError">
                  图片生成失败
                </div>
              </div>
            </article>
          </div>

          <footer v-if="selectedRecords.size" class="batch-bar">
            <div>
              <strong>已选择 {{ selectedRecords.size }} 个</strong>
              <span>{{ formatBytes(selectedSize) }}</span>
            </div>
            <button type="button" class="action-btn sm danger" :disabled="busy" @click="deleteBatch">
              {{ busy ? "删除中..." : "删除选中" }}
            </button>
          </footer>
        </AppCard>
      </template>

      <template #right>
        <AppCard
          compact
          body-mode="scroll"
          overflow="clip"
          title="快照详情"
          :description="selectedSnapshot ? `${selectedSnapshot.map || '未知地图'} · ${selectedSnapshot.id}` : '请选择一条记录'"
          class="detail-card"
        >
          <div v-if="!selectedSnapshot" class="empty-state">从左侧选择一场对局查看详情。</div>
          <template v-else>
            <div class="detail-toolbar">
              <button type="button" class="action-btn sm" :disabled="!selectedSnapshot.imageAvailable" @click="imagePreviewOpen = !imagePreviewOpen">
                {{ imagePreviewOpen ? "收起图片" : "查看原图" }}
              </button>
              <button type="button" class="action-btn sm accent" :disabled="regenerating" @click="regenerateImage">
                {{ regenerating ? "生成中..." : "重新生成图片" }}
              </button>
              <button type="button" class="action-btn sm" :disabled="!selectedSnapshot.imageAvailable" @click="downloadImage">下载 PNG</button>
              <button type="button" class="action-btn sm" @click="downloadSelected">下载 JSON</button>
              <button type="button" class="action-btn sm danger" :disabled="busy" @click="deleteSelected">删除</button>
            </div>

            <div v-if="detailLoading" class="empty-state">正在读取快照...</div>
            <template v-else-if="detail">
              <section class="overview-grid">
                <div class="metric-card wide">
                  <span>图层</span>
                  <strong>{{ detail.match?.layer || selectedSnapshot.layer || "-" }}</strong>
                  <small>{{ detail.match?.map || selectedSnapshot.map || "-" }} · {{ detail.match?.mode || selectedSnapshot.mode || "-" }}</small>
                </div>
                <div class="metric-card">
                  <span>开始时间</span>
                  <strong>{{ formatDate(selectedSnapshot.startedAt || "", true) }}</strong>
                </div>
                <div class="metric-card">
                  <span>结束时间</span>
                  <strong>{{ formatDate(selectedSnapshot.capturedAt, true) }}</strong>
                </div>
                <div class="metric-card">
                  <span>持续时间</span>
                  <strong>{{ formatDuration(selectedSnapshot.duration) }}</strong>
                </div>
                <div class="metric-card">
                  <span>玩家 / 队列</span>
                  <strong>{{ detail.server?.playerCount ?? detail.players?.length ?? 0 }} / {{ detail.server?.queueCount ?? 0 }}</strong>
                </div>
                <div class="metric-card">
                  <span>胜利方</span>
                  <strong>{{ winnerLabel(selectedSnapshot.winner) }}</strong>
                </div>
                <div class="metric-card">
                  <span>原图大小</span>
                  <strong>{{ formatBytes(selectedSnapshot.size) }}</strong>
                </div>
                <div class="metric-card">
                  <span>生成时间</span>
                  <strong>{{ formatDate(selectedSnapshot.generatedAt || "", true) }}</strong>
                </div>
              </section>

              <section v-if="imagePreviewOpen && selectedSnapshot.imageAvailable" class="report-preview">
                <img :src="reportImageUrl" alt="对局结束快照原图">
              </section>

              <details class="raw-data">
                <summary>Raw Data（原始数据）</summary>
                <pre>{{ JSON.stringify(detail, null, 2) }}</pre>
              </details>

              <section class="player-section">
                <header>
                  <div>
                    <strong>结束时玩家列表</strong>
                    <span>{{ detail.players?.length ?? 0 }} 条记录</span>
                  </div>
                  <span>BZSS Core 覆盖 {{ detail.summary?.bzssCorePlayerCount ?? 0 }} 人</span>
                </header>
                <div v-if="detail.players?.length" class="player-table-wrap">
                  <AppTable compact>
                    <thead>
                      <tr>
                        <th>玩家</th><th>队伍 / 小队</th><th>Role</th><th>K</th><th>W</th><th>D</th>
                        <th>TK</th><th>载具</th><th>复苏</th><th>战斗分</th><th>目标分</th><th>团队分</th><th>延迟</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="player in detail.players" :key="playerKey(player)">
                        <td class="player-name"><strong>{{ player.name || "Unknown" }}</strong><small>{{ player.steamID || player.eosID || "-" }}</small></td>
                        <td><strong>T{{ player.teamID ?? "-" }}</strong><small>{{ player.squadInfo?.name || squadLabel(player.squadID) }}</small></td>
                        <td>{{ player.role || player.bzssCore?.soldierClass || "-" }}</td>
                        <td>{{ stat(player.bzssCore?.kills) }}</td><td>{{ stat(player.bzssCore?.downs) }}</td>
                        <td>{{ stat(player.bzssCore?.deaths) }}</td><td>{{ stat(player.bzssCore?.teamKills) }}</td>
                        <td>{{ stat(player.bzssCore?.vehicleKills) }}</td><td>{{ stat(player.bzssCore?.revives) }}</td>
                        <td>{{ stat(player.bzssCore?.combatScore) }}</td><td>{{ stat(player.bzssCore?.objectiveScore) }}</td>
                        <td>{{ stat(player.bzssCore?.teamworkScore) }}</td><td>{{ pingLabel(player.bzssCore?.ping) }}</td>
                      </tr>
                    </tbody>
                  </AppTable>
                </div>
              </section>
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
const filters = ref({
  search: "", time: "all", from: "", to: "", map: "", mode: "", players: "",
  winner: "", source: "", sort: "newest",
});

const selectedSnapshot = computed(() =>
  snapshots.value.find((item) => recordKey(item) === selectedKey.value) ?? null,
);

const mapOptions = computed<string[]>(() =>
  [...new Set(snapshots.value.map((item) => item.map || mapFromLayer(item.layer)).filter((value): value is string => Boolean(value)))].sort(),
);
const modeOptions = computed<string[]>(() =>
  [...new Set(snapshots.value.map((item) => item.mode || modeFromLayer(item.layer)).filter((value): value is string => Boolean(value)))].sort(),
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
      [...selectedRecords.value].filter((key) => records.some((item) => recordKey(item) === key)),
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
.statistics-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.stat-card, .metric-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
  padding: 13px;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  background: var(--color-surface-raised);
}
.stat-card span, .metric-card span, .stat-card small, .metric-card small {
  color: var(--color-text-muted);
  font-size: 11px;
}
.stat-card strong { color: var(--color-text-primary); font-size: 21px; }
.stat-card .date-value { font-size: 15px; }
.filter-card { margin-bottom: 12px; }
.filter-grid {
  display: grid;
  grid-template-columns: minmax(220px, 1.5fr) repeat(7, minmax(112px, 1fr));
  gap: 9px;
}
.field { display: flex; min-width: 0; flex-direction: column; gap: 5px; color: var(--color-text-muted); font-size: 11px; }
.field input, .field select {
  min-width: 0;
  height: 34px;
  padding: 0 9px;
  border: 1px solid var(--color-border-soft);
  border-radius: 7px;
  background: var(--color-surface-soft);
  color: var(--color-text-primary);
}
.custom-date-row { display: flex; gap: 10px; margin-top: 10px; }
.custom-date-row .field { width: 180px; }
.end-snapshot-layout {
  grid-template-columns: minmax(360px, 430px) minmax(0, 1fr) !important;
  min-height: 0;
}
.history-card, .detail-card { height: 100%; min-height: 0; }
.list-tools {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 9px;
  border-bottom: 1px solid var(--color-border-soft);
}
.select-all { display: flex; align-items: center; gap: 7px; color: var(--color-text-secondary); font-size: 12px; }
.text-btn { border: 0; background: transparent; color: var(--color-accent); cursor: pointer; }
.record-list {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 9px;
  padding: 10px 3px 10px 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
}
.record-card {
  position: relative;
  display: grid;
  width: 100%;
  min-height: 104px;
  flex: 0 0 auto;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 11px;
  padding: 10px 10px 10px 35px;
  overflow: hidden;
  border: 1px solid var(--color-border-soft);
  border-radius: 9px;
  background: var(--color-surface-raised);
  color: var(--color-text-secondary);
  cursor: pointer;
}
.record-card:hover, .record-card.active {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 9%, var(--color-surface-raised));
}
.record-card.debug { border-left: 3px solid #f59e0b; }
.record-check { position: absolute; top: 13px; left: 11px; z-index: 2; }
.record-thumb {
  width: 112px;
  height: 63px;
  align-self: center;
  border-radius: 5px;
  background: #020611;
  object-fit: cover;
}
.record-thumb.placeholder { display: grid; place-items: center; color: #607086; font: 10px monospace; }
.record-body { display: flex; min-width: 0; flex-direction: column; gap: 5px; }
.record-body header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.record-body header > div { display: flex; min-width: 0; flex-direction: column; }
.record-body strong { overflow: hidden; color: var(--color-text-primary); text-overflow: ellipsis; white-space: nowrap; }
.record-body header span, .record-time { color: var(--color-text-muted); font-size: 11px; }
.source-badge { flex: 0 0 auto; padding: 2px 5px; border-radius: 4px; background: var(--color-surface-soft); font-size: 9px !important; font-weight: 800; }
.source-badge.debug { color: #fbbf24; }
.source-badge.official { color: var(--color-accent); }
.record-metrics { display: flex; flex-wrap: wrap; gap: 4px 8px; font-size: 10px; }
.render-error { color: #fb7185; font-size: 10px; }
.batch-bar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border-top: 1px solid var(--color-border-soft);
  background: var(--color-surface-soft);
}
.batch-bar div { display: flex; flex-direction: column; }
.batch-bar span { color: var(--color-text-muted); font-size: 10px; }
.detail-toolbar { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; margin-bottom: 12px; }
.overview-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 9px; }
.metric-card.wide { grid-column: span 2; }
.metric-card strong { overflow: hidden; color: var(--color-text-primary); text-overflow: ellipsis; white-space: nowrap; }
.report-preview { max-height: 680px; margin-top: 13px; overflow: auto; border: 1px solid var(--color-border-soft); border-radius: 8px; background: #020611; }
.report-preview img { display: block; width: 100%; height: auto; }
.raw-data { margin-top: 13px; border: 1px solid var(--color-border-soft); border-radius: 8px; background: var(--color-surface-raised); }
.raw-data summary { padding: 11px 13px; color: var(--color-text-secondary); cursor: pointer; }
.raw-data pre { max-height: 420px; margin: 0; padding: 13px; overflow: auto; border-top: 1px solid var(--color-border-soft); color: var(--color-text-secondary); font-size: 11px; }
.player-section { margin-top: 13px; }
.player-section > header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }
.player-section > header div { display: flex; align-items: baseline; gap: 8px; }
.player-section header span, .player-name small, .player-table-wrap td small { color: var(--color-text-muted); font-size: 11px; }
.player-table-wrap { max-height: 560px; overflow: auto; border: 1px solid var(--color-border-soft); border-radius: 8px; }
.player-table-wrap table { min-width: 1050px; }
.player-table-wrap th, .player-table-wrap td { white-space: nowrap; }
.player-name strong, .player-name small, .player-table-wrap td strong, .player-table-wrap td small { display: block; }
.empty-state { padding: 36px 16px; color: var(--color-text-muted); text-align: center; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 1500px) {
  .filter-grid { grid-template-columns: repeat(4, minmax(130px, 1fr)); }
  .search-field { grid-column: span 2; }
}
@media (max-width: 1100px) {
  .statistics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .end-snapshot-layout { grid-template-columns: 1fr !important; }
  .history-card { max-height: 620px; }
  .overview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 720px) {
  .filter-grid { grid-template-columns: 1fr 1fr; }
  .search-field { grid-column: span 2; }
  .record-card { grid-template-columns: 86px minmax(0, 1fr); }
  .record-thumb { width: 86px; height: 49px; }
}
</style>
