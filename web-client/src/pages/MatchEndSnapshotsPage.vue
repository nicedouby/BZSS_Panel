<template>
  <AppPage full-bleed>
    <AppPageHeader
      title="对局结束快照"
      subtitle="浏览每一局结束时冻结的数据记录。该页面与图片快照录制完全独立。"
      :status-items="headerStatusItems"
    >
      <template #actions>
        <button type="button" class="action-btn ghost" :disabled="loading" @click="loadSnapshots">
          {{ loading ? "刷新中..." : "刷新记录" }}
        </button>
      </template>
    </AppPageHeader>

    <AppSplitLayout class="end-snapshot-layout">
      <template #left>
        <AppCard compact title="历史对局" description="记录按结束时间倒序排列，每一条代表一局独立的数据快照。">
          <div v-if="loading" class="empty-state">正在加载结束快照...</div>
          <div v-else-if="!snapshots.length" class="empty-state">暂无对局结束快照</div>
          <div v-else class="record-list">
            <button
              v-for="item in snapshots"
              :key="item.id"
              type="button"
              class="record-card"
              :class="{ active: selectedId === item.id }"
              @click="selectedId = item.id"
            >
              <span class="record-time">{{ formatDate(item.capturedAt) }}</span>
              <strong>{{ item.layer || item.map || "未知地图" }}</strong>
              <span>{{ item.map || "-" }} → {{ item.nextMap || "下一地图未知" }}</span>
              <div class="record-metrics">
                <span>玩家 {{ item.playerCount }}</span>
                <span>队列 {{ item.queueCount }}</span>
                <span v-if="item.winner">胜方 {{ item.winner }}</span>
                <span :class="{ ready: item.imageAvailable }">{{ item.imageAvailable ? "战绩图已生成" : "可生成战绩图" }}</span>
              </div>
            </button>
          </div>
        </AppCard>
      </template>

      <template #right>
        <AppCard compact title="快照详情" :description="selectedSnapshot?.id || '请选择一条记录'">
          <div class="detail-toolbar">
            <button
              type="button"
              class="action-btn sm"
              :disabled="!selectedSnapshot"
              @click="imagePreviewOpen = !imagePreviewOpen"
            >
              {{ imagePreviewOpen ? "收起战绩图" : "预览 / 生成战绩图" }}
            </button>
            <button
              type="button"
              class="action-btn sm"
              :disabled="!selectedSnapshot"
              @click="downloadImage"
            >
              下载 PNG
            </button>
            <button
              type="button"
              class="action-btn sm"
              :disabled="!selectedSnapshot"
              @click="downloadSelected"
            >
              下载 JSON
            </button>
            <button
              type="button"
              class="action-btn sm danger"
              :disabled="!selectedSnapshot || busy"
              @click="deleteSelected"
            >
              删除记录
            </button>
          </div>

          <div v-if="detailLoading" class="empty-state">正在读取快照...</div>
          <div v-else-if="!detail" class="empty-state">选择左侧的一局后查看数据。</div>
          <template v-else>
            <section class="overview-grid">
              <div class="metric-card">
                <span>快照时间</span>
                <strong>{{ formatDate(detail.capturedAt) }}</strong>
              </div>
              <div class="metric-card">
                <span>当前地图</span>
                <strong>{{ detail.match?.map || "-" }}</strong>
                <small>{{ detail.match?.layer || "-" }}</small>
              </div>
              <div class="metric-card">
                <span>下一地图</span>
                <strong>{{ detail.match?.nextMap || "-" }}</strong>
                <small>{{ detail.match?.nextLayer || "-" }}</small>
              </div>
              <div class="metric-card">
                <span>玩家 / 队列</span>
                <strong>{{ detail.server?.playerCount ?? detail.players?.length ?? 0 }} / {{ detail.server?.queueCount ?? 0 }}</strong>
                <small>在线玩家 / 排队玩家</small>
              </div>
            </section>

            <section v-if="imagePreviewOpen" class="report-preview">
              <header>
                <strong>全员战绩长图</strong>
                <span>旧记录会在首次打开时自动补生成。</span>
              </header>
              <div class="report-preview-frame">
                <img :src="reportImageUrl" alt="对局结束全员战绩长图">
              </div>
            </section>

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
                      <th>玩家</th>
                      <th>队伍 / 小队</th>
                      <th>Role</th>
                      <th>生命值</th>
                      <th>K</th>
                      <th>W</th>
                      <th>D</th>
                      <th>TK</th>
                      <th>载具</th>
                      <th>复苏</th>
                      <th>治疗分</th>
                      <th>战斗分</th>
                      <th>目标分</th>
                      <th>团队分</th>
                      <th>延迟</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="player in detail.players" :key="playerKey(player)">
                      <td class="player-name">
                        <strong>{{ player.name || "Unknown" }}</strong>
                        <small>{{ player.steamID || player.eosID || "-" }}</small>
                      </td>
                      <td>
                        <strong>T{{ player.teamID ?? "-" }}</strong>
                        <small>{{ player.squadInfo?.name || squadLabel(player.squadID) }}</small>
                      </td>
                      <td>{{ player.role || player.bzssCore?.soldierClass || "-" }}</td>
                      <td>{{ healthLabel(player.health ?? player.bzssCore?.health) }}</td>
                      <td>{{ stat(player.bzssCore?.kills) }}</td>
                      <td>{{ stat(player.bzssCore?.downs) }}</td>
                      <td>{{ stat(player.bzssCore?.deaths) }}</td>
                      <td>{{ stat(player.bzssCore?.teamKills) }}</td>
                      <td>{{ stat(player.bzssCore?.vehicleKills) }}</td>
                      <td>{{ stat(player.bzssCore?.revives) }}</td>
                      <td>{{ stat(player.bzssCore?.healPoints) }}</td>
                      <td>{{ stat(player.bzssCore?.combatScore) }}</td>
                      <td>{{ stat(player.bzssCore?.objectiveScore) }}</td>
                      <td>{{ stat(player.bzssCore?.teamworkScore) }}</td>
                      <td>{{ pingLabel(player.bzssCore?.ping) }}</td>
                    </tr>
                  </tbody>
                </AppTable>
              </div>
              <div v-else class="empty-state">该局没有保存到玩家记录。</div>
            </section>
          </template>
        </AppCard>
      </template>
    </AppSplitLayout>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { apiDelete, apiGet } from "../app/apiClient";
import AppCard from "../components/common/AppCard.vue";
import AppPage from "../components/common/AppPage.vue";
import AppPageHeader from "../components/common/AppPageHeader.vue";
import AppSplitLayout from "../components/common/AppSplitLayout.vue";
import AppTable from "../components/common/AppTable.vue";
import { useUiStore } from "../stores/ui.store";

interface SnapshotListItem {
  id: string;
  capturedAt: string;
  map?: string;
  layer?: string;
  nextMap?: string;
  nextLayer?: string;
  playerCount: number;
  queueCount: number;
  winner?: string;
  imageAvailable?: boolean;
}

interface SnapshotPlayer {
  playerID?: number | null;
  name?: string;
  steamID?: string;
  eosID?: string;
  teamID?: number | null;
  squadID?: number | null;
  role?: string;
  health?: number | null;
  squadInfo?: { name?: string } | null;
  bzssCore?: {
    health?: number | null;
    soldierClass?: string;
    kills?: number | null;
    downs?: number | null;
    deaths?: number | null;
    teamKills?: number | null;
    vehicleKills?: number | null;
    revives?: number | null;
    healPoints?: number | null;
    combatScore?: number | null;
    objectiveScore?: number | null;
    teamworkScore?: number | null;
    ping?: number | null;
  } | null;
}

interface SnapshotDetail {
  capturedAt: string;
  server?: {
    playerCount?: number;
    queueCount?: number;
  };
  match?: {
    map?: string;
    layer?: string;
    nextMap?: string;
    nextLayer?: string;
  };
  summary?: {
    bzssCorePlayerCount?: number;
  };
  players?: SnapshotPlayer[];
}

const ui = useUiStore();
const snapshots = ref<SnapshotListItem[]>([]);
const selectedId = ref("");
const detail = ref<SnapshotDetail | null>(null);
const loading = ref(true);
const detailLoading = ref(false);
const busy = ref(false);
const imagePreviewOpen = ref(false);
const errorMessage = ref("");
const loadedAt = ref("");

const selectedSnapshot = computed(() =>
  snapshots.value.find((item) => item.id === selectedId.value) ?? null,
);

const reportImageUrl = computed(() =>
  selectedId.value
    ? "/api/match-end-snapshot/image?id=" + encodeURIComponent(selectedId.value) + "&refresh=1&layout=compact-v2"
    : "",
);

const headerStatusItems = computed(() => {
  const items: Array<{ label: string; tone: "ok" | "error" | "idle" }> = [
    { label: "记录数 " + snapshots.value.length, tone: "idle" },
  ];
  if (loadedAt.value) items.push({ label: "刷新于 " + loadedAt.value, tone: "ok" });
  if (errorMessage.value) items.push({ label: errorMessage.value, tone: "error" });
  return items;
});

async function loadSnapshots() {
  loading.value = true;
  errorMessage.value = "";
  try {
    snapshots.value = await apiGet<SnapshotListItem[]>("/api/match-end-snapshot/list");
    if (!selectedId.value || !snapshots.value.some((item) => item.id === selectedId.value)) {
      selectedId.value = snapshots.value[0]?.id ?? "";
    }
    loadedAt.value = new Date().toLocaleString("zh-CN", { hour12: false });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
    snapshots.value = [];
    ui.pushToast({ title: "加载失败", message: errorMessage.value, tone: "error" });
  } finally {
    loading.value = false;
  }
}

async function loadDetail(id: string) {
  if (!id) {
    detail.value = null;
    return;
  }
  detailLoading.value = true;
  try {
    detail.value = await apiGet<SnapshotDetail>(
      "/api/match-end-snapshot/view?id=" + encodeURIComponent(id),
    );
  } catch (error) {
    detail.value = null;
    ui.pushToast({
      title: "读取失败",
      message: error instanceof Error ? error.message : String(error),
      tone: "error",
    });
  } finally {
    detailLoading.value = false;
  }
}

function downloadImage() {
  if (!selectedId.value) return;
  window.open(
    "/api/match-end-snapshot/image?id=" + encodeURIComponent(selectedId.value) + "&download=1",
    "_blank",
    "noopener,noreferrer",
  );
}

function downloadSelected() {
  if (!selectedId.value) return;
  window.open(
    "/api/match-end-snapshot/view?id=" + encodeURIComponent(selectedId.value) + "&download=1",
    "_blank",
    "noopener,noreferrer",
  );
}

async function deleteSelected() {
  const selected = selectedSnapshot.value;
  if (!selected) return;
  const confirmed = await ui.openConfirm({
    title: "删除结束快照",
    message: "确认删除 " + selected.id + " 吗？",
    confirmText: "确认删除",
    cancelText: "取消",
    tone: "warn",
  });
  if (!confirmed) return;

  busy.value = true;
  try {
    await apiDelete("/api/match-end-snapshot/delete?id=" + encodeURIComponent(selected.id));
    selectedId.value = "";
    detail.value = null;
    await loadSnapshots();
    ui.pushToast({ title: "已删除", message: "结束快照已删除。", tone: "ok" });
  } catch (error) {
    ui.pushToast({
      title: "删除失败",
      message: error instanceof Error ? error.message : String(error),
      tone: "error",
    });
  } finally {
    busy.value = false;
  }
}

function playerKey(player: SnapshotPlayer) {
  return [
    player.steamID,
    player.eosID,
    player.playerID,
    player.teamID,
    player.squadID,
    player.name,
  ].map((value) => String(value ?? "")).join("|");
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value || "-"
    : date.toLocaleString("zh-CN", { hour12: false });
}

function squadLabel(value: number | null | undefined) {
  return value == null ? "无小队" : "Squad " + value;
}

function stat(value: number | null | undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : "-";
}

function healthLabel(value: number | null | undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : "-";
}

function pingLabel(value: number | null | undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) + " ms" : "-";
}

watch(selectedId, (id) => {
  imagePreviewOpen.value = false;
  void loadDetail(id);
});

onMounted(loadSnapshots);
</script>

<style scoped>
.end-snapshot-layout {
  grid-template-columns: minmax(300px, 0.72fr) minmax(0, 1.8fr) !important;
}

.record-list {
  display: flex;
  max-height: 720px;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}

.record-card {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 5px;
  padding: 12px;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  background: var(--color-surface-raised);
  color: var(--color-text-secondary);
  text-align: left;
  cursor: pointer;
}

.record-card:hover,
.record-card.active {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 10%, var(--color-surface-raised));
}

.record-card strong {
  color: var(--color-text-primary);
}

.record-time {
  color: var(--color-text-muted);
  font-size: 11px;
}

.record-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.record-metrics span {
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--color-surface-soft);
  font-size: 11px;
}

.detail-toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 12px;
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.metric-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  background: var(--color-surface-raised);
}

.metric-card span,
.metric-card small,
.player-section header span,
.player-name small,
.player-table-wrap td small {
  color: var(--color-text-muted);
  font-size: 11px;
}

.metric-card strong {
  overflow: hidden;
  color: var(--color-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.report-preview {
  margin-top: 14px;
}

.report-preview > header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.report-preview > header span {
  color: var(--color-text-muted);
  font-size: 11px;
}

.report-preview-frame {
  max-height: 680px;
  overflow: auto;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  background: #020611;
}

.report-preview-frame img {
  display: block;
  width: 100%;
  height: auto;
}

.record-metrics .ready {
  color: var(--color-success, #22c55e);
}

.player-section {
  margin-top: 14px;
}

.player-section > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.player-section > header div {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.player-table-wrap {
  max-height: 590px;
  overflow: auto;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
}

.player-table-wrap table {
  min-width: 1180px;
}

.player-table-wrap th,
.player-table-wrap td {
  white-space: nowrap;
}

.player-name strong,
.player-name small,
.player-table-wrap td strong,
.player-table-wrap td small {
  display: block;
}

.empty-state {
  padding: 32px 16px;
  color: var(--color-text-muted);
  text-align: center;
}

@media (max-width: 1000px) {
  .end-snapshot-layout {
    grid-template-columns: 1fr !important;
  }

  .record-list {
    max-height: 320px;
  }

  .overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
