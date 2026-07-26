<template>
  <section class="team-shuffle-page workspace-page">
    <WorkspaceToolbar>
      <span class="status-chip subtle">在线 {{ roster.length }}</span>
      <span class="status-chip subtle">待移动 {{ plannedMoveCount }}</span>

      <!-- Search input in the main toolbar region -->
      <div class="search-wrapper">
        <span class="search-icon">🔍</span>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索玩家名字/SteamID/EOS/小队..."
          class="search-input"
          aria-label="搜索玩家"
        />
        <button v-if="searchQuery" type="button" class="clear-search-btn" @click="searchQuery = ''">✕</button>
      </div>

      <template #actions>
        <select v-model="algorithm" class="algorithm-select" aria-label="打乱算法">
          <option v-for="item in algorithmOptions" :key="item.value" :value="item.value">
            {{ item.label }}
          </option>
        </select>
        <button
          v-if="isModified"
          type="button"
          class="ghost-btn reset-btn"
          @click="resetManualAdjustments"
        >
          重置调整
        </button>
        <button type="button" class="ghost-btn" :disabled="loading" @click="refreshData">
          {{ loading ? "刷新中..." : "刷新数据" }}
        </button>
        <button type="button" class="primary-btn" :disabled="creating || !canPlan" @click="handleCreatePlanClick">
          {{ creating ? "生成中..." : "生成打乱" }}
        </button>
      </template>
    </WorkspaceToolbar>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <section class="summary-grid" aria-label="打乱摘要">
      <article class="summary-card">
        <span>当前人数</span>
        <strong>T1 {{ currentTeam1Count }} / T2 {{ currentTeam2Count }}</strong>
      </article>
      <article class="summary-card">
        <span>目标人数</span>
        <strong>T1 {{ targetTeam1Count }} / T2 {{ targetTeam2Count }}</strong>
      </article>
      <article class="summary-card">
        <span>已知时长</span>
        <strong>{{ knownPlaytimeCount }}</strong>
      </article>
      <article class="summary-card">
        <span>目标均时差</span>
        <strong>{{ formatHours(targetAverageDeltaHours) }}</strong>
      </article>
    </section>

    <!-- Playtime balance visual scale -->
    <section class="balance-section" aria-label="平均时长平衡度">
      <div class="balance-card">
        <div class="balance-header">
          <div class="balance-title">
            <span class="balance-icon">⚖️</span>
            <strong>平均时长平衡性</strong>
          </div>
          <div class="balance-status" :class="deltaClass">
            <span class="status-dot"></span>
            <span>{{ deltaStatusText }}</span>
          </div>
        </div>
        <div class="balance-scale-wrapper">
          <div class="balance-labels">
            <div class="team-label t1-color">
              <strong>T1 目标均时:</strong>
              <span>{{ formatHours(t1Avg) }}</span>
            </div>
            <div class="delta-label">
              <strong>均时差:</strong>
              <span>{{ formatHours(targetAverageDeltaHours) }}</span>
            </div>
            <div class="team-label t2-color">
              <strong>T2 目标均时:</strong>
              <span>{{ formatHours(t2Avg) }}</span>
            </div>
          </div>
          <div class="balance-meter-bar">
            <div class="balance-progress t1-bar" :style="{ width: `${t1Percent}%` }"></div>
            <div class="balance-progress-center"></div>
            <div class="balance-progress t2-bar" :style="{ width: `${t2Percent}%` }"></div>
          </div>
          <p class="balance-hint">{{ balanceHintText }}</p>
        </div>
      </div>
    </section>

    <section class="shuffle-grid">
      <PageCard title="目标 T1" :description="teamDescription(1)" compact body-mode="fill" class="team-card-t1">
        <template #actions>
          <span class="status-chip">{{ targetTeam1Count }} 人</span>
        </template>
        <div
          class="player-list scroll-region-y"
          :class="{ 'drag-over-t1': dragOverTeam === 1 }"
          @dragover="onDragOver($event, 1)"
          @dragleave="onDragLeave"
          @drop="onDrop($event, 1)"
        >
          <article
            v-for="player in teamPlayers(1)"
            :key="playerKey(player)"
            class="player-row"
            :data-moving="player.fromTeamId !== player.targetTeamId"
            draggable="true"
            @dragstart="onDragStart($event, player)"
            @dblclick="switchPlayerTarget(player)"
          >
            <div class="player-main">
              <strong>{{ player.playerName }}</strong>
              <span class="player-id">{{ player.steamId || player.eosId || player.playerId || "-" }}</span>
            </div>
            <div class="player-meta">
              <StatusBadge v-if="player.isLeader" tone="ok" class="sl-badge">SL</StatusBadge>
              <span v-if="player.squadId != null" class="squad-badge" title="小队ID">#{{ player.squadId }}</span>
              <span class="team-chip">T{{ player.fromTeamId }}</span>
              <span>{{ formatHours(getPlayerPlaytimeHours(player)) }}</span>
              <span v-if="player.groupName" class="group-chip" :style="{ borderColor: player.groupColor || '#94a3b8', color: player.groupColor || '#94a3b8' }">
                {{ player.groupName }}
              </span>
            </div>
            <button type="button" class="move-btn" title="移动到 T2 (双击整行亦可)" @click="switchPlayerTarget(player)">
              T2 ➔
            </button>
          </article>
          <p v-if="!teamPlayers(1).length" class="empty-state">暂无目标 T1 玩家。</p>
        </div>
      </PageCard>

      <PageCard title="目标 T2" :description="teamDescription(2)" compact body-mode="fill" class="team-card-t2">
        <template #actions>
          <span class="status-chip">{{ targetTeam2Count }} 人</span>
        </template>
        <div
          class="player-list scroll-region-y"
          :class="{ 'drag-over-t2': dragOverTeam === 2 }"
          @dragover="onDragOver($event, 2)"
          @dragleave="onDragLeave"
          @drop="onDrop($event, 2)"
        >
          <article
            v-for="player in teamPlayers(2)"
            :key="playerKey(player)"
            class="player-row"
            :data-moving="player.fromTeamId !== player.targetTeamId"
            draggable="true"
            @dragstart="onDragStart($event, player)"
            @dblclick="switchPlayerTarget(player)"
          >
            <div class="player-main">
              <strong>{{ player.playerName }}</strong>
              <span class="player-id">{{ player.steamId || player.eosId || player.playerId || "-" }}</span>
            </div>
            <div class="player-meta">
              <StatusBadge v-if="player.isLeader" tone="ok" class="sl-badge">SL</StatusBadge>
              <span v-if="player.squadId != null" class="squad-badge" title="小队ID">#{{ player.squadId }}</span>
              <span class="team-chip">T{{ player.fromTeamId }}</span>
              <span>{{ formatHours(getPlayerPlaytimeHours(player)) }}</span>
              <span v-if="player.groupName" class="group-chip" :style="{ borderColor: player.groupColor || '#94a3b8', color: player.groupColor || '#94a3b8' }">
                {{ player.groupName }}
              </span>
            </div>
            <button type="button" class="move-btn" title="移动到 T1 (双击整行亦可)" @click="switchPlayerTarget(player)">
              ➔ T1
            </button>
          </article>
          <p v-if="!teamPlayers(2).length" class="empty-state">暂无目标 T2 玩家。</p>
        </div>
      </PageCard>
    </section>

    <!-- Execution area with collapsible pending moves tray -->
    <section class="execute-zone">
      <transition name="tray-slide">
        <div v-if="showPendingMoves && movingPlayers.length > 0" class="pending-moves-tray">
          <header class="tray-header">
            <div class="tray-title">
              <span class="tray-icon">📋</span>
              <strong>跳边名单预览 (共 {{ movingPlayers.length }} 人)</strong>
            </div>
            <button type="button" class="close-tray-btn" @click="showPendingMoves = false">收起 ✕</button>
          </header>
          <div class="tray-body scroll-region-y">
            <div v-for="player in movingPlayers" :key="playerKey(player)" class="tray-item">
              <span class="tray-player-name">{{ player.playerName }}</span>
              <div class="tray-player-direction">
                <span class="team-badge" :class="`team-${player.fromTeamId}`">T{{ player.fromTeamId }}</span>
                <span class="arrow-indicator">➔</span>
                <span class="team-badge" :class="`team-${player.targetTeamId}`">T{{ player.targetTeamId }}</span>
              </div>
              <button type="button" class="tray-undo-btn" title="撤销此次跳边调整" @click="switchPlayerTarget(player)">
                撤销
              </button>
            </div>
          </div>
        </div>
      </transition>

      <div class="execute-bar">
        <div>
          <strong>{{ activeAlgorithmLabel }}</strong>
          <span>
            {{ executeHint }}
            <button
              v-if="movingPlayers.length > 0"
              type="button"
              class="link-style-btn"
              @click="showPendingMoves = !showPendingMoves"
            >
              {{ showPendingMoves ? "收起预览" : "查看名单" }}
            </button>
          </span>
        </div>
        <button
          type="button"
          class="danger-btn execute-btn"
          :disabled="executing || planExecutionLocked || movingPlayers.length === 0"
          @click="executePlan"
        >
          {{ executing ? "提交中..." : planExecutionLocked ? `打乱执行中 ${shuffleBatch?.completed ?? 0} / ${shuffleBatch?.total ?? 0}` : "执行当前打乱" }}
        </button>
      </div>
    </section>

    <section v-if="shuffleBatch" class="shuffle-batch-card">
      <div class="shuffle-batch-card__header">
        <strong>{{ shuffleBatchStatusText }}</strong>
        <span v-if="shuffleBatch.id">{{ shuffleBatch.id }}</span>
      </div>
      <div class="shuffle-batch-card__stats">
        <span>总数：{{ shuffleBatch.total }}</span>
        <span>成功：{{ shuffleBatch.succeeded }}</span>
        <span>失败：{{ shuffleBatch.failed }}</span>
        <span>跳过：{{ shuffleBatch.skipped }}</span>
        <span>剩余：{{ Math.max(0, shuffleBatch.total - shuffleBatch.completed) }}</span>
      </div>
      <div v-if="shuffleBatch.currentPlayer" class="shuffle-batch-card__current">
        当前：{{ shuffleBatch.currentPlayer.playerName || shuffleBatch.currentPlayer.steamId }}
      </div>
      <div class="shuffle-batch-card__actions">
        <button
          v-if="shuffleBatch.status === 'queued' || shuffleBatch.status === 'running'"
          type="button"
          class="ghost-btn"
          :disabled="shuffleBatch.cancelRequested === true"
          @click="cancelShuffleBatch"
        >
          {{ shuffleBatch.cancelRequested ? "取消中..." : "停止剩余跳边" }}
        </button>
      </div>
    </section>

    <div v-if="executeResult" class="result-banner" :data-ok="executeResult.ok">
      {{ executeResult.message || (executeResult.ok ? "执行完成" : "执行失败") }}
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { apiGet } from "../app/apiClient";
import {
  createPlaytimeShufflePlan,
  executeTeamShufflePlan,
  getForceTeamChangeBatch,
  listForceTeamChangeBatches,
  cancelForceTeamChangeBatch,
  type TeamBalanceBatch,
  type TeamShuffleExecuteResponse,
  type TeamShufflePlanPlayer,
} from "../app/teamBalanceApi";
import { groupReportApi, type GroupReportGroup } from "../features/group-report/groupReport.api";
import { usePlayerStore } from "../stores/player.store";
import { useUiStore } from "../stores/ui.store";
import PageCard from "../components/common/PageCard.vue";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";
import StatusBadge from "../components/common/StatusBadge.vue";

interface ShufflePlayer extends TeamShufflePlanPlayer {
  targetTeamId: number;
  isLeader?: boolean;
}

const algorithmOptions = [
  { value: "playtime_balanced", label: "按时长均衡" },
  { value: "random_even", label: "随机均分" },
  { value: "mirror", label: "整队对调" },
];

const playerStore = usePlayerStore();
const ui = useUiStore();

const algorithm = ref("playtime_balanced");
const stablePlaytimes = ref<Record<string, any>>({});
const groups = ref<GroupReportGroup[]>([]);
const planPlayers = ref<ShufflePlayer[]>([]);
const originalPlayersCopy = ref<ShufflePlayer[]>([]);
const loading = ref(false);
const creating = ref(false);
const executing = ref(false);
const error = ref("");
const executeResult = ref<TeamShuffleExecuteResponse | null>(null);
const autoPlanAttempted = ref(false);
const currentPlanId = ref("");
const currentRoundKey = ref("");
const submittedBatchId = ref("");
const shuffleBatch = ref<TeamBalanceBatch | null>(null);
let shuffleBatchPollTimer: ReturnType<typeof setInterval> | null = null;

// Interactive UI elements
const searchQuery = ref("");
const dragOverTeam = ref<number | null>(null);
const showPendingMoves = ref(false);

const roster = computed(() => {
  return (Array.isArray(playerStore.active) ? playerStore.active : [])
    .filter((player) => player && player.online !== false)
    .map((player) => {
      const teamId = Number(player.teamID);
      if (teamId !== 1 && teamId !== 2) return null;
      const steamId = String(player.steamID ?? "").trim();
      const cache = steamId ? stablePlaytimes.value[steamId] : null;
      const seconds = Number(cache?.gameSeconds);
      const playtimeSeconds = Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : null;
      return {
        playerId: player.playerID ?? null,
        steamId: steamId || null,
        eosId: String(player.eosID ?? "").trim() || null,
        playerName: String(player.name ?? "").trim() || "Unknown",
        role: String(player.role ?? "").trim() || null,
        squadId: player.squadID == null ? null : Number(player.squadID),
        teamId,
        online: true,
        playtimeSeconds,
        isLeader: Boolean(player.isLeader),
      };
    })
    .filter((player): player is NonNullable<typeof player> => Boolean(player));
});

const canPlan = computed(() => currentTeam1Count.value > 0 && currentTeam2Count.value > 0);
const currentTeam1Count = computed(() => roster.value.filter((player) => player.teamId === 1).length);
const currentTeam2Count = computed(() => roster.value.filter((player) => player.teamId === 2).length);
const targetTeam1Count = computed(() => planPlayers.value.filter((player) => player.targetTeamId === 1).length);
const targetTeam2Count = computed(() => planPlayers.value.filter((player) => player.targetTeamId === 2).length);
const knownPlaytimeCount = computed(() => roster.value.filter((player) => player.playtimeSeconds != null).length);
const plannedMoveCount = computed(() => planPlayers.value.filter((player) => player.fromTeamId !== player.targetTeamId).length);
const activeAlgorithmLabel = computed(() => algorithmOptions.find((item) => item.value === algorithm.value)?.label ?? algorithm.value);

const t1Avg = computed(() => averageHours(planPlayers.value.filter((p) => p.targetTeamId === 1)));
const t2Avg = computed(() => averageHours(planPlayers.value.filter((p) => p.targetTeamId === 2)));

const t1Percent = computed(() => {
  const a1 = t1Avg.value || 0;
  const a2 = t2Avg.value || 0;
  if (a1 === 0 && a2 === 0) return 50;
  const total = a1 + a2;
  return Math.round((a1 / total) * 100);
});

const t2Percent = computed(() => 100 - t1Percent.value);

const targetAverageDeltaHours = computed(() => {
  if (t1Avg.value == null || t2Avg.value == null) return null;
  return Math.abs(t1Avg.value - t2Avg.value);
});

const deltaClass = computed(() => {
  const delta = targetAverageDeltaHours.value;
  if (delta == null) return "delta-none";
  if (delta <= 1.0) return "delta-excellent";
  if (delta <= 2.5) return "delta-good";
  return "delta-unbalanced";
});

const deltaStatusText = computed(() => {
  const delta = targetAverageDeltaHours.value;
  if (delta == null) return "无时长数据";
  if (delta <= 1.0) return "极佳平衡";
  if (delta <= 2.5) return "良好平衡";
  return "不平衡";
});

const balanceHintText = computed(() => {
  const delta = targetAverageDeltaHours.value;
  if (delta == null) return "需要更多在线玩家的 Steam 历史时长数据进行分析。";
  if (delta <= 1.0) return "队伍间平均游戏时长差距很小，实力均衡表现极佳！";
  if (delta <= 2.5) return "队伍间平均时长差距在可接受范围内，游戏体验较好。";
  return "队伍平均时长相差较大，可能会出现单方面碾压，建议通过拖拽或双击微调！";
});

const isModified = computed(() => {
  if (!originalPlayersCopy.value.length || !planPlayers.value.length) return false;
  for (let i = 0; i < planPlayers.value.length; i++) {
    const current = planPlayers.value[i];
    const original = originalPlayersCopy.value.find(
      (p) => p.steamId === current.steamId || p.playerId === current.playerId
    );
    if (original && current.targetTeamId !== original.targetTeamId) {
      return true;
    }
  }
  return false;
});

const movingPlayers = computed(() => {
  return planPlayers.value.filter((player) => player.fromTeamId !== player.targetTeamId);
});

const executeHint = computed(() => {
  if (!planPlayers.value.length) return "先生成一份打乱列表，再按需要手动调整个别玩家。";
  if (plannedMoveCount.value === 0) return "当前列表没有需要跳边的玩家。";
  return `将执行 ${plannedMoveCount.value} 名玩家的跳边。`;
});
const planExecutionLocked = computed(() => {
  if (!submittedBatchId.value) return false;
  const status = shuffleBatch.value?.status;
  return status === "queued" || status === "running" || status == null;
});

const shuffleBatchStatusText = computed(() => {
  const batch = shuffleBatch.value;
  if (!batch) return "";
  if (batch.status === "queued") return "随机打乱已排队";
  if (batch.status === "running") return "随机打乱执行中";
  if (batch.status === "completed") return "随机打乱完成";
  if (batch.status === "partial") return batch.cancelRequested ? "随机打乱已停止" : "随机打乱部分完成";
  if (batch.status === "cancelled") return `随机打乱已停止（${batch.cancelReason || "已取消"}）`;
  return "随机打乱任务";
});



onMounted(async () => {
  await restoreShuffleBatch();
  void refreshData();
  shuffleBatchPollTimer = setInterval(() => {
    if (submittedBatchId.value) void refreshShuffleBatch();
  }, 1_000);
});

onBeforeUnmount(() => {
  if (shuffleBatchPollTimer) clearInterval(shuffleBatchPollTimer);
  shuffleBatchPollTimer = null;
});

async function refreshData() {
  loading.value = true;
  error.value = "";
  try {
    await Promise.all([refreshPlaytimeCache(), loadGroups()]);
    if (!autoPlanAttempted.value && !planPlayers.value.length && canPlan.value) {
      autoPlanAttempted.value = true;
      await createPlan(false);
    }
  } catch (err: any) {
    error.value = String(err?.message || err || "刷新失败");
  } finally {
    loading.value = false;
  }
}

async function refreshPlaytimeCache() {
  const steamIDs = [...new Set(roster.value.map((player) => player.steamId).filter(Boolean))];
  if (!steamIDs.length) return;
  const res = await apiGet<{ items?: Record<string, any> }>(
    `/api/query/playtime-cache?steamIDs=${encodeURIComponent(steamIDs.join(","))}`,
  );
  stablePlaytimes.value = { ...stablePlaytimes.value, ...(res?.items ?? {}) };
}

async function loadGroups() {
  try {
    const snapshot = await groupReportApi.getSnapshot();
    groups.value = Array.isArray(snapshot?.groups) ? snapshot.groups.filter((group) => group.members?.length) : [];
  } catch {
    groups.value = [];
  }
}

async function createPlan(confirmAction = true) {
  if (!canPlan.value || creating.value || planExecutionLocked.value) return;
  if (confirmAction) {
    const confirmed = await ui.openConfirm({
      title: "重新生成打乱方案",
      message: `使用「${activeAlgorithmLabel.value}」生成新的打乱列表？当前手动调整会被覆盖。`,
      confirmText: "生成",
      cancelText: "取消",
      tone: "warn",
    });
    if (!confirmed) return;
  }

  creating.value = true;
  error.value = "";
  executeResult.value = null;
  try {
    const result = await createPlaytimeShufflePlan({
      source: "web.teamShuffle",
      reason: "team_shuffle_plan",
      algorithm: algorithm.value,
      groups: groups.value.map((group) => ({
        id: group.id,
        name: group.name,
        color: group.color ?? null,
        anchorPlayerKey: group.anchorPlayerKey,
        members: group.members.map((member) => ({
          playerKey: member.playerKey,
          steamId: member.steamId ?? null,
          eosId: member.eosId ?? null,
        })),
      })),
      players: roster.value,
    });
    if (!result.ok || !result.plan?.players) throw new Error(result.message || "生成打乱失败");
    
    currentPlanId.value = String(result.plan.planId ?? "");
    currentRoundKey.value = String(result.plan.roundKey ?? "");
    planPlayers.value = result.plan.players.map((player) => {
      const rosterPlayer = roster.value.find(r => r.steamId === player.steamId || r.playerId === player.playerId);
      return {
        ...player,
        targetTeamId: Number(player.targetTeamId) || Number(player.fromTeamId) || 1,
        isLeader: rosterPlayer ? rosterPlayer.isLeader : false,
      };
    });
    originalPlayersCopy.value = JSON.parse(JSON.stringify(planPlayers.value));
  } catch (err: any) {
    error.value = String(err?.message || err || "生成打乱失败");
  } finally {
    creating.value = false;
  }
}

function handleCreatePlanClick() {
  void createPlan(true);
}

function switchPlayerTarget(player: ShufflePlayer) {
  player.targetTeamId = player.targetTeamId === 1 ? 2 : 1;
}

function resetManualAdjustments() {
  if (!originalPlayersCopy.value.length) return;
  planPlayers.value = JSON.parse(JSON.stringify(originalPlayersCopy.value));
  ui.pushToast({
    message: "已重置手动调整，恢复至初始打乱方案",
    tone: "ok"
  });
}

async function executePlan() {
  if (executing.value || planExecutionLocked.value || plannedMoveCount.value === 0) return;
  if (!currentPlanId.value || !currentRoundKey.value) {
    error.value = "当前方案缺少对局标识，请重新生成方案。";
    return;
  }

  const confirmed = await ui.openConfirm({
    title: "执行跳边计划",
    message: `确认执行当前打乱？将创建一个后台任务，处理 ${plannedMoveCount.value} 名玩家。`,
    confirmText: "执行",
    cancelText: "取消",
    tone: "error",
  });
  if (!confirmed) return;

  executing.value = true;
  error.value = "";
  executeResult.value = null;
  try {
    const result = await executeTeamShufflePlan({
      planId: currentPlanId.value,
      roundKey: currentRoundKey.value,
      clientRequestId: `shuffle:${currentPlanId.value}`,
      source: "web.teamShuffle",
      reason: "team_shuffle_execute",
      algorithm: algorithm.value,
      players: planPlayers.value.map((player) => ({
        playerId: player.playerId,
        steamId: player.steamId,
        eosId: player.eosId,
        playerName: player.playerName,
        role: player.role,
        squadId: player.squadId,
        teamId: player.fromTeamId,
        targetTeamId: player.targetTeamId,
        online: player.online,
        playtimeSeconds: player.playtimeSeconds,
      })),
    });
    executeResult.value = result;
    if (!result.ok || !result.batch) throw new Error(result.message || "提交打乱失败");

    submittedBatchId.value = result.batch.id;
    shuffleBatch.value = result.batch;
    ui.pushToast({
      message: result.duplicate ? "该打乱方案已经提交过。" : "随机打乱任务已提交，页面不会被阻塞。",
      tone: "ok",
    });
  } catch (err: any) {
    error.value = String(err?.message || err || "提交打乱失败");
    ui.pushToast({
      message: "提交打乱失败: " + error.value,
      tone: "error",
    });
  } finally {
    executing.value = false;
  }
}

function isTerminalShuffleBatch(batch: TeamBalanceBatch | null | undefined) {
  return Boolean(batch && ["completed", "partial", "cancelled"].includes(batch.status));
}

async function refreshShuffleBatch() {
  const batchId = submittedBatchId.value;
  if (!batchId) return;
  try {
    const response = await getForceTeamChangeBatch(batchId);
    if (!response?.ok || !response.batch) return;
    shuffleBatch.value = response.batch;
    if (!isTerminalShuffleBatch(response.batch)) return;

    const finalBatch = response.batch;
    submittedBatchId.value = "";
    planPlayers.value = [];
    originalPlayersCopy.value = [];
    currentPlanId.value = "";
    currentRoundKey.value = "";
    executeResult.value = {
      ok: finalBatch.status === "completed",
      accepted: true,
      planId: finalBatch.planId,
      roundKey: finalBatch.roundKey,
      batch: finalBatch,
      message: `随机打乱结束：成功 ${finalBatch.succeeded}，失败 ${finalBatch.failed}，跳过 ${finalBatch.skipped}。`,
      type: "shuffle_execute",
      action: "shuffle_execute",
      source: "web.teamShuffle",
      reason: "team_shuffle_execute",
      operator: null,
      system: false,
      error: finalBatch.status === "completed" ? "" : finalBatch.cancelReason || "partial",
      rconExecuted: finalBatch.succeeded > 0,
      summary: {
        plannedMoveCount: finalBatch.total,
        executedCount: finalBatch.succeeded,
        failedCount: finalBatch.failed,
      },
      plan: null,
    };
    await refreshData();
  } catch {
    // Keep the last batch snapshot and retry on the next interval.
  }
}

async function restoreShuffleBatch() {
  try {
    const response = await listForceTeamChangeBatches();
    const batches = Array.isArray(response?.batches) ? response.batches : [];
    const active = batches.find((batch) => (
      batch.type === "shuffle"
      && (batch.status === "queued" || batch.status === "running")
    ));
    if (!active) return;
    submittedBatchId.value = active.id;
    shuffleBatch.value = active;
    currentPlanId.value = active.planId || "";
    currentRoundKey.value = active.roundKey || "";
    autoPlanAttempted.value = true;
  } catch {
    // The page can still be used if the status endpoint is temporarily unavailable.
  }
}

async function cancelShuffleBatch() {
  const batchId = submittedBatchId.value;
  if (!batchId || shuffleBatch.value?.cancelRequested) return;
  try {
    const response = await cancelForceTeamChangeBatch(batchId);
    if (response?.batch) shuffleBatch.value = response.batch;
    else if (shuffleBatch.value) shuffleBatch.value = { ...shuffleBatch.value, cancelRequested: true };
  } catch (err: any) {
    error.value = String(err?.message || err || "停止打乱失败");
  }
}

function onDragStart(event: DragEvent, player: ShufflePlayer) {
  if (event.dataTransfer) {
    event.dataTransfer.setData("text/plain", playerKey(player));
    event.dataTransfer.effectAllowed = "move";
  }
}

function onDragOver(event: DragEvent, teamId: number) {
  event.preventDefault();
  dragOverTeam.value = teamId;
}

function onDragLeave() {
  dragOverTeam.value = null;
}

function onDrop(event: DragEvent, teamId: number) {
  dragOverTeam.value = null;
  const key = event.dataTransfer?.getData("text/plain");
  if (!key) return;
  const player = planPlayers.value.find((p) => playerKey(p) === key);
  if (player && player.targetTeamId !== teamId) {
    player.targetTeamId = teamId;
  }
}

function teamPlayers(teamId: number) {
  let list = planPlayers.value.filter((player) => player.targetTeamId === teamId);
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase().trim();
    list = list.filter(
      (p) =>
        p.playerName.toLowerCase().includes(q) ||
        String(p.steamId || "").toLowerCase().includes(q) ||
        String(p.eosId || "").toLowerCase().includes(q) ||
        String(p.playerId || "").toLowerCase().includes(q) ||
        (p.squadId != null && String(p.squadId).includes(q)) ||
        String(p.groupName || "").toLowerCase().includes(q)
    );
  }
  return list.sort((left, right) => {
    const moveDiff = Number(right.fromTeamId !== right.targetTeamId) - Number(left.fromTeamId !== left.targetTeamId);
    if (moveDiff !== 0) return moveDiff;
    return String(left.playerName).localeCompare(String(right.playerName), "zh-CN");
  });
}

// Visual helpers
function teamDescription(teamId: number) {
  const players = planPlayers.value.filter((player) => player.targetTeamId === teamId);
  return `平均时长 ${formatHours(averageHours(players))}，需跳边 ${players.filter((player) => player.fromTeamId !== player.targetTeamId).length} 人`;
}

function playerKey(player: ShufflePlayer) {
  return `${player.steamId || player.eosId || player.playerId || player.playerName}-${player.fromTeamId}`;
}

watch(
  () => roster.value.map(p => p.steamId).filter(Boolean).join(","),
  async (newSteamIds) => {
    if (newSteamIds) {
      await refreshPlaytimeCache();
    }
  },
  { immediate: true }
);

function getPlayerPlaytimeSeconds(player: ShufflePlayer) {
  if (player.playtimeSeconds != null && player.playtimeSeconds > 0) {
    return player.playtimeSeconds;
  }
  const rosterPlayer = roster.value.find(r => r.steamId === player.steamId || r.playerId === player.playerId);
  return rosterPlayer?.playtimeSeconds ?? null;
}

function getPlayerPlaytimeHours(player: ShufflePlayer) {
  const seconds = getPlayerPlaytimeSeconds(player);
  if (seconds == null) return null;
  return seconds / 3600;
}

function averageHours(players: ShufflePlayer[]) {
  const playtimes = players
    .map(p => getPlayerPlaytimeSeconds(p))
    .filter((sec): sec is number => sec != null && Number.isFinite(sec));
  
  if (!playtimes.length) return null;
  const total = playtimes.reduce((sum, sec) => sum + sec, 0);
  return total / playtimes.length / 3600;
}

// Utility
function formatHours(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toFixed(1)}h`;
}
</script>

<style scoped>
.team-shuffle-page {
  display: grid;
  grid-template-rows: auto auto auto auto minmax(0, 1fr) auto auto;
  gap: 12px;
  height: 100%;
  min-height: 0;
  padding: 14px;
  overflow: hidden;
}

.team-shuffle-page > * {
  min-width: 0;
}

.search-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  margin-left: 12px;
  min-width: 200px;
  max-width: 320px;
  flex: 1 1 auto;
}

.search-icon {
  position: absolute;
  left: 10px;
  font-size: 13px;
  opacity: 0.6;
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 32px;
  padding: 0 30px 0 28px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(15, 23, 42, 0.3);
  color: var(--color-text-primary);
  font-size: 12px;
  transition: all 0.2s ease;
}

.search-input:focus {
  outline: none;
  border-color: var(--color-primary, #3b82f6);
  background: rgba(15, 23, 42, 0.5);
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.25);
}

.clear-search-btn {
  position: absolute;
  right: 10px;
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.clear-search-btn:hover {
  color: var(--color-text-primary);
}

.reset-btn {
  border-color: rgba(245, 158, 11, 0.3) !important;
  background: rgba(245, 158, 11, 0.08) !important;
  color: #fde68a !important;
}

.reset-btn:hover {
  border-color: rgba(245, 158, 11, 0.5) !important;
  background: rgba(245, 158, 11, 0.15) !important;
}

.algorithm-select {
  min-height: 32px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 8px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  padding: 0 10px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.summary-card {
  display: grid;
  gap: 3px;
  min-height: 54px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.018));
  align-content: center;
}

.summary-card span,
.player-main span,
.player-meta,
.execute-bar span,
.empty-state {
  color: var(--color-text-muted);
  font-size: 11px;
}

.summary-card strong {
  font-size: 18px;
  line-height: 1.15;
}

.balance-section {
  width: 100%;
  flex: 0 0 auto;
}

.balance-card {
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.01));
  box-shadow: var(--shadow-sm);
}

.balance-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.balance-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.balance-title strong {
  font-size: 13px;
  color: var(--color-text-primary);
}

.balance-icon {
  font-size: 14px;
}

.balance-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.delta-excellent {
  color: #4ade80;
  border-color: rgba(74, 222, 128, 0.2);
  background: rgba(74, 222, 128, 0.05);
}
.delta-excellent .status-dot {
  background-color: #4ade80;
  box-shadow: 0 0 6px #4ade80;
}

.delta-good {
  color: #fbbf24;
  border-color: rgba(251, 191, 36, 0.2);
  background: rgba(251, 191, 36, 0.05);
}
.delta-good .status-dot {
  background-color: #fbbf24;
  box-shadow: 0 0 6px #fbbf24;
}

.delta-unbalanced {
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.2);
  background: rgba(248, 113, 113, 0.05);
}
.delta-unbalanced .status-dot {
  background-color: #f87171;
  box-shadow: 0 0 6px #f87171;
}

.balance-scale-wrapper {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.balance-labels {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}

.team-label {
  display: flex;
  gap: 4px;
}

.t1-color {
  color: #93c5fd;
}

.t2-color {
  color: #fca5a5;
}

.delta-label {
  color: var(--color-text-muted);
}

.balance-meter-bar {
  position: relative;
  height: 8px;
  background: rgba(15, 23, 42, 0.5);
  border-radius: 999px;
  overflow: hidden;
  display: flex;
}

.balance-progress {
  height: 100%;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.t1-bar {
  background: linear-gradient(90deg, #1e40af, #3b82f6);
  border-radius: 999px 0 0 999px;
}

.t2-bar {
  background: linear-gradient(90deg, #ef4444, #991b1b);
  border-radius: 0 999px 999px 0;
}

.balance-progress-center {
  width: 2px;
  height: 100%;
  background-color: rgba(255, 255, 255, 0.3);
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
}

.balance-hint {
  margin: 0;
  font-size: 10.5px;
  color: var(--color-text-muted);
  text-align: center;
  opacity: 0.85;
}

.shuffle-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  min-height: 0;
}

.shuffle-grid :deep(.page-card),
.shuffle-grid :deep(.card-body) {
  min-height: 0;
}

.team-card-t1 {
  border-color: rgba(59, 130, 246, 0.2) !important;
  box-shadow: 0 4px 20px rgba(59, 130, 246, 0.03) !important;
}

.team-card-t1 :deep(.card-title) {
  color: #93c5fd;
  text-shadow: 0 0 10px rgba(59, 130, 246, 0.3);
}

.team-card-t2 {
  border-color: rgba(239, 68, 68, 0.2) !important;
  box-shadow: 0 4px 20px rgba(239, 68, 68, 0.03) !important;
}

.team-card-t2 :deep(.card-title) {
  color: #fca5a5;
  text-shadow: 0 0 10px rgba(239, 68, 68, 0.3);
}

.player-list {
  display: grid;
  align-content: start;
  gap: 4px;
  min-height: 0;
  overflow: auto;
  padding: 4px;
  transition: all 0.2s ease;
}

.drag-over-t1 {
  background: rgba(59, 130, 246, 0.08) !important;
  outline: 2px dashed rgba(59, 130, 246, 0.4) !important;
  outline-offset: -2px;
  border-radius: 8px;
}

.drag-over-t2 {
  background: rgba(239, 68, 68, 0.08) !important;
  outline: 2px dashed rgba(239, 68, 68, 0.4) !important;
  outline-offset: -2px;
  border-radius: 8px;
}

.player-row {
  display: grid;
  grid-template-columns: minmax(120px, 1.4fr) minmax(130px, 0.8fr) 58px;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 5px 6px 5px 9px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.2);
  cursor: grab;
  transition: all 0.15s ease;
  user-select: none;
}

.player-row:hover {
  background: rgba(15, 23, 42, 0.35);
  border-color: rgba(148, 163, 184, 0.3);
}

.player-row:active {
  cursor: grabbing;
}

.player-row[data-moving="true"] {
  border-color: rgba(245, 158, 11, 0.4);
  background: rgba(245, 158, 11, 0.06);
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.03);
}

.player-row[data-moving="true"]:hover {
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.5);
}

.player-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.player-main strong {
  min-width: 0;
  font-size: 13px;
}

.player-main strong,
.player-main span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-id {
  max-width: 150px;
  opacity: 0.72;
}

.player-meta {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
  white-space: nowrap;
}

.sl-badge {
  font-size: 9px;
  font-weight: 800;
  padding: 1px 4px;
  height: 16px;
  min-height: auto;
  border-radius: 4px;
}

.squad-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 800;
  padding: 0 5px;
  height: 16px;
  background: rgba(59, 130, 246, 0.15);
  border: 1px solid rgba(59, 130, 246, 0.3);
  color: #93c5fd;
  border-radius: 4px;
}

.group-chip,
.status-chip,
.team-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 22px;
  padding: 0 7px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(255, 255, 255, 0.04);
  font-size: 11px;
  font-weight: 700;
}

.group-chip {
  max-width: 86px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-chip.subtle {
  color: var(--color-text-muted);
}

.move-btn {
  min-height: 26px;
  width: 58px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid rgba(96, 165, 250, 0.26);
  background: rgba(59, 130, 246, 0.1);
  color: #cfe2ff;
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  transition: all 0.2s ease;
}

.move-btn:hover {
  border-color: rgba(96, 165, 250, 0.46);
  background: rgba(59, 130, 246, 0.18);
}

.execute-zone {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.pending-moves-tray {
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(16px);
  padding: 10px 14px;
  box-shadow: var(--shadow-lg), 0 0 20px rgba(0, 0, 0, 0.3);
  max-height: 220px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tray-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}

.tray-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tray-title strong {
  font-size: 12px;
  color: var(--color-text-primary);
}

.close-tray-btn {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 11px;
}

.close-tray-btn:hover {
  color: var(--color-text-primary);
}

.tray-body {
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 6px;
  padding: 4px;
}

.tray-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 11px;
}

.tray-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.tray-player-name {
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 90px;
}

.tray-player-direction {
  display: flex;
  align-items: center;
  gap: 4px;
}

.team-badge {
  font-size: 9px;
  font-weight: 800;
  padding: 0 4px;
  border-radius: 4px;
}

.team-badge.team-1 {
  background: rgba(59, 130, 246, 0.2);
  color: #cfe2ff;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.team-badge.team-2 {
  background: rgba(239, 68, 68, 0.2);
  color: #fecaca;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.arrow-indicator {
  font-size: 10px;
  color: var(--color-text-muted);
}

.tray-undo-btn {
  background: rgba(244, 63, 94, 0.1);
  border: 1px solid rgba(244, 63, 94, 0.3);
  color: #fca5a5;
  border-radius: 4px;
  padding: 2px 6px;
  cursor: pointer;
  font-size: 10px;
  font-weight: 700;
}

.tray-undo-btn:hover {
  background: rgba(244, 63, 94, 0.25);
  border-color: rgba(244, 63, 94, 0.5);
}

.link-style-btn {
  background: transparent;
  border: none;
  color: #8bb6ff;
  cursor: pointer;
  font-size: 11px;
  text-decoration: underline;
  padding: 0;
  margin-left: 6px;
}

.link-style-btn:hover {
  color: #bbf7d0;
}

.execute-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.22);
}

.execute-bar > div {
  display: grid;
  gap: 4px;
}

.ghost-btn,
.primary-btn,
.danger-btn {
  min-height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  cursor: pointer;
  font-weight: 700;
}

.ghost-btn {
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
}

.primary-btn {
  border-color: rgba(34, 197, 94, 0.3);
  background: rgba(34, 197, 94, 0.12);
  color: #bbf7d0;
}

.danger-btn {
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.1);
  color: #fecaca;
}

.ghost-btn:disabled,
.primary-btn:disabled,
.danger-btn:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.error-banner,
.result-banner {
  border-radius: 8px;
  padding: 10px 12px;
}

.error-banner {
  border: 1px solid rgba(239, 68, 68, 0.24);
  background: rgba(239, 68, 68, 0.12);
  color: #fecaca;
}

.result-banner {
  border: 1px solid rgba(34, 197, 94, 0.24);
  background: rgba(34, 197, 94, 0.1);
  color: #bbf7d0;
}

.result-banner[data-ok="false"] {
  border-color: rgba(245, 158, 11, 0.28);
  background: rgba(245, 158, 11, 0.1);
  color: #fde68a;
}

/* Animations for tray-slide */
.tray-slide-enter-active,
.tray-slide-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.tray-slide-enter-from,
.tray-slide-leave-to {
  transform: translateY(20px);
  opacity: 0;
}

@media (max-width: 980px) {
  .summary-grid,
  .shuffle-grid {
    grid-template-columns: 1fr;
  }

  .team-shuffle-page {
    overflow: auto;
    grid-template-rows: auto;
  }
}

@media (max-width: 720px) {
  .execute-bar {
    align-items: stretch;
    flex-direction: column;
  }

  .player-row {
    grid-template-columns: minmax(0, 1fr) 58px;
  }

  .player-meta {
    grid-column: 1 / -1;
    grid-row: 2;
    justify-content: flex-start;
  }
}

.shuffle-batch-card {
  margin: 12px 0;
  padding: 12px 14px;
  border: 1px solid rgba(248, 113, 113, 0.35);
  border-radius: 9px;
  background: rgba(51, 20, 26, 0.72);
}
.shuffle-batch-card__header,
.shuffle-batch-card__stats,
.shuffle-batch-card__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.shuffle-batch-card__header {
  justify-content: space-between;
}
.shuffle-batch-card__header span {
  color: rgba(255, 225, 225, 0.62);
  font-size: 12px;
}
.shuffle-batch-card__stats {
  margin-top: 8px;
  color: #ffe4e6;
  font-size: 13px;
}
.shuffle-batch-card__current {
  margin-top: 8px;
  color: #fda4af;
  font-size: 13px;
}
.shuffle-batch-card__actions {
  justify-content: flex-end;
  margin-top: 8px;
}
</style>
