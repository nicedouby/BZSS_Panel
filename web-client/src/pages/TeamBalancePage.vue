<template>
  <section class="team-balance-page">
    <PageHeader
      title="队伍分配 / 抱团跳边"
      eyebrow="Team Balance"
      subtitle="容器数据来自抱团报备，RCON 执行统一走后端 team-balance 模块。"
    >
      <template #actions>
        <button type="button" @click="handleReload" :disabled="busy">
          {{ busy ? "刷新中..." : "刷新玩家" }}
        </button>
        <button type="button" @click="handleBalanceOnly" :disabled="!canManage || busy || !displayContainers.length">
          一键平衡目标
        </button>
        <button type="button" @click="handleGroupTogether" :disabled="!canManage || busy || !displayContainers.length">
          一键抱团并执行
        </button>
        <button type="button" class="danger" @click="handleExecutePlan" :disabled="!canManage || busy || !hasAnyTargetTeam">
          执行当前计划
        </button>
      </template>
    </PageHeader>

    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="info" class="banner info">{{ info }}</div>
    <div v-if="!canManage" class="banner warn">当前账号不是 SuperAdmin，只能查看容器和预估结果，不能写入计划或执行跳边。</div>

    <PageCard title="计划概览" description="目标阵营只表示计划，不会改写玩家当前 teamID。">
      <div class="summary-grid">
        <div class="summary-item">
          <span class="summary-label">容器数</span>
          <strong>{{ displayContainers.length }}</strong>
        </div>
        <div class="summary-item">
          <span class="summary-label">在线人数</span>
          <strong>{{ overallStats.onlinePlayers }}</strong>
        </div>
        <div class="summary-item">
          <span class="summary-label">当前 Team 1</span>
          <strong>{{ overallStats.team1 }}</strong>
        </div>
        <div class="summary-item">
          <span class="summary-label">当前 Team 2</span>
          <strong>{{ overallStats.team2 }}</strong>
        </div>
        <div class="summary-item">
          <span class="summary-label">预计跳边</span>
          <strong>{{ overallStats.needSwitch }}</strong>
        </div>
        <div class="summary-item">
          <span class="summary-label">当前计划</span>
          <strong>{{ state?.lastPlan?.mode || "--" }}</strong>
        </div>
      </div>

      <div v-if="state?.lastPlan || state?.lastExecution" class="plan-meta">
        <div>最近计划：{{ formatTime(state?.lastPlan?.createdAt) }} / {{ state?.lastPlan?.mode || "--" }}</div>
        <div>最近执行：{{ formatExecutionSummary(state?.lastExecution) }}</div>
      </div>
    </PageCard>

    <div v-if="!displayContainers.length" class="empty-state">
      没有可用容器。先到“抱团报备”创建团体并添加成员。
    </div>

    <div v-else class="container-grid">
      <PageCard
        v-for="container in displayContainers"
        :key="container.id"
        :title="container.name"
        :description="`${container.players.length} 人，在线 ${containerStats(container).onlinePlayers} 人`"
      >
        <template #actions>
          <span class="target-pill" :data-team="container.targetTeam ?? 0">
            目标阵营 {{ teamLabel(container.targetTeam) }}
          </span>
        </template>

        <div class="container-stats">
          <div>当前 Team 1：{{ containerStats(container).team1 }}</div>
          <div>当前 Team 2：{{ containerStats(container).team2 }}</div>
          <div>需要跳边：{{ containerStats(container).needSwitch }}</div>
          <div>已在目标阵营：{{ containerStats(container).alreadyOnTarget }}</div>
          <div>无法处理：{{ containerStats(container).invalid }}</div>
        </div>

        <div class="container-actions">
          <button type="button" @click="handleSetTarget(container, 1)" :disabled="!canManage || busy">设为 Team 1</button>
          <button type="button" @click="handleSetTarget(container, 2)" :disabled="!canManage || busy">设为 Team 2</button>
          <button type="button" @click="handleAutoBalanceContainer(container)" :disabled="!canManage || busy">容器一键平衡</button>
          <button type="button" class="danger" @click="handleExecuteContainer(container)" :disabled="!canManage || busy || !isValidTargetTeam(container.targetTeam)">
            执行该容器跳边
          </button>
        </div>

        <div class="player-table">
          <div class="player-row player-head">
            <span>玩家</span>
            <span>当前</span>
            <span>目标</span>
            <span>状态</span>
          </div>
          <div v-for="player in container.players" :key="playerKey(player)" class="player-row">
            <span class="player-name">
              {{ player.name || "--" }}
              <small>{{ player.online ? "在线" : "离线" }}</small>
            </span>
            <span>{{ teamLabel(player.teamID) }}</span>
            <span>{{ teamLabel(container.targetTeam) }}</span>
            <span>{{ playerActionLabel(player, container.targetTeam) }}</span>
          </div>
        </div>
      </PageCard>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { apiGet } from "../app/apiClient";
import {
  balanceTeamContainer,
  executeCurrentTeamBalancePlan,
  executeTeamContainer,
  getTeamBalanceState,
  runTeamBalanceOnly,
  runTeamGroupTogether,
  setTeamBalanceContainers,
  type TeamBalanceContainer,
  type TeamBalanceExecution,
  type TeamBalancePlan,
  type TeamBalancePlayer,
  type TeamBalanceState,
} from "../app/teamBalanceApi";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import { groupReportApi, type GroupReportGroup } from "../features/group-report/groupReport.api";
import { useAuthStore } from "../stores/auth.store";
import { useUiStore } from "../stores/ui.store";

interface RuntimePlayerLike {
  playerID?: number | null;
  steamID?: string;
  eosID?: string;
  name?: string;
  teamID?: number | null;
  squadID?: number | null;
  online?: boolean;
}

const auth = useAuthStore();
const ui = useUiStore();

const busy = ref(false);
const error = ref("");
const info = ref("");
const groups = ref<GroupReportGroup[]>([]);
const runtimePlayers = ref<RuntimePlayerLike[]>([]);
const state = ref<TeamBalanceState | null>(null);
const previewContainers = ref<TeamBalanceContainer[]>([]);

const canManage = computed(() => Boolean(auth.user?.isSuperAdmin));
const displayContainers = computed(() => state.value?.containers?.length ? state.value.containers : previewContainers.value);
const hasAnyTargetTeam = computed(() => displayContainers.value.some((container) => isValidTargetTeam(container.targetTeam)));
const overallStats = computed(() => {
  return displayContainers.value.reduce((summary, container) => {
    const stats = containerStats(container);
    summary.onlinePlayers += stats.onlinePlayers;
    summary.team1 += stats.team1;
    summary.team2 += stats.team2;
    summary.needSwitch += stats.needSwitch;
    return summary;
  }, {
    onlinePlayers: 0,
    team1: 0,
    team2: 0,
    needSwitch: 0,
  });
});

onMounted(() => {
  void loadAll();
});

async function loadAll() {
  busy.value = true;
  error.value = "";

  try {
    const [snapshot, runtimeSnapshot, currentState] = await Promise.all([
      groupReportApi.getSnapshot(),
      apiGet<any>("/api/snapshot/players"),
      getTeamBalanceState().catch(() => ({ ok: false, state: null as TeamBalanceState | null })),
    ]);

    groups.value = snapshot.groups ?? [];
    runtimePlayers.value = Array.isArray(runtimeSnapshot?.active)
      ? runtimeSnapshot.active
      : Array.isArray(runtimeSnapshot?.players)
        ? runtimeSnapshot.players
        : [];

    const mapped = buildContainersFromGroups(groups.value, runtimePlayers.value, currentState.state?.containers ?? []);
    previewContainers.value = mapped;
    state.value = currentState.state ?? null;

    if (canManage.value) {
      const synced = await setTeamBalanceContainers(mapped);
      state.value = synced.state;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function handleReload() {
  await loadAll();
  info.value = "已刷新容器与玩家状态。";
}

async function handleBalanceOnly() {
  await syncContainers();
  busy.value = true;
  error.value = "";

  try {
    const response = await runTeamBalanceOnly();
    state.value = response.state;
    info.value = `已生成平衡计划：Team 1 = ${response.plan.totals.team1}，Team 2 = ${response.plan.totals.team2}。`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function handleGroupTogether() {
  const previewPlan = buildPlanPreview(displayContainers.value, "groupTogether");
  const ok = await confirmExecution(displayContainers.value, previewPlan);
  if (!ok) return;

  await syncContainers();
  busy.value = true;
  error.value = "";

  try {
    const response = await runTeamGroupTogether();
    state.value = response.state;
    info.value = `执行完成：跳边 ${response.result.switched}，跳过 ${response.result.skipped}，失败 ${response.result.failed}。`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function handleExecutePlan() {
  const ok = await confirmExecution(displayContainers.value);
  if (!ok) return;

  await syncContainers();
  busy.value = true;
  error.value = "";

  try {
    const response = await executeCurrentTeamBalancePlan();
    state.value = response.state;
    info.value = `执行完成：跳边 ${response.result.switched}，跳过 ${response.result.skipped}，失败 ${response.result.failed}。`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function handleSetTarget(container: TeamBalanceContainer, targetTeam: 1 | 2) {
  await syncContainers();
  busy.value = true;
  error.value = "";

  try {
    const response = await balanceTeamContainer(container.id, targetTeam);
    state.value = response.state;
    info.value = `${container.name} 已设置为 Team ${targetTeam}。`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function handleAutoBalanceContainer(container: TeamBalanceContainer) {
  await syncContainers();
  busy.value = true;
  error.value = "";

  try {
    const response = await balanceTeamContainer(container.id);
    state.value = response.state;
    info.value = `${container.name} 已设置统一目标阵营。`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function handleExecuteContainer(container: TeamBalanceContainer) {
  const ok = await confirmExecution([container]);
  if (!ok) return;

  await syncContainers();
  busy.value = true;
  error.value = "";

  try {
    const response = await executeTeamContainer(container.id);
    state.value = response.state;
    info.value = `${container.name} 执行完成：跳边 ${response.result.switched}，跳过 ${response.result.skipped}，失败 ${response.result.failed}。`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function syncContainers() {
  if (!canManage.value) return;
  const mapped = buildContainersFromGroups(groups.value, runtimePlayers.value, displayContainers.value);
  previewContainers.value = mapped;
  const response = await setTeamBalanceContainers(mapped);
  state.value = response.state;
}

async function confirmExecution(containers: TeamBalanceContainer[], plan?: TeamBalancePlan) {
  const executionSummary = summarizeExecution(containers, plan);
  return ui.openConfirm({
    title: "确认执行跳边",
    message: `即将执行跳边：容器数量 ${executionSummary.containerCount}，涉及玩家 ${executionSummary.totalPlayers}，预计跳边 ${executionSummary.needSwitch}。`,
    confirmText: "确认执行",
    cancelText: "取消",
    tone: "warn",
  });
}

function buildContainersFromGroups(
  inputGroups: GroupReportGroup[],
  runtimeList: RuntimePlayerLike[],
  previousContainers: TeamBalanceContainer[] = [],
): TeamBalanceContainer[] {
  const previousById = new Map(previousContainers.map((container) => [container.id, container]));
  return inputGroups.map((group) => ({
    id: group.id,
    name: group.name,
    targetTeam: previousById.get(group.id)?.targetTeam ?? null,
    locked: Boolean(previousById.get(group.id)?.locked),
    players: group.members.map((member) => {
      const runtime = findRuntimePlayer(member.steamId, member.eosId, runtimeList);
      return {
        playerID: numberValue(runtime?.playerID),
        name: runtime?.name?.trim() || member.name,
        steamID: runtime?.steamID?.trim() || member.steamId || "",
        eosID: runtime?.eosID?.trim() || member.eosId || "",
        teamID: numberValue(runtime?.teamID) ?? numberValue(member.teamId),
        squadID: numberValue(runtime?.squadID) ?? numberValue(member.squadId),
        online: runtime?.online === true,
      };
    }),
  }));
}

function buildPlanPreview(containers: TeamBalanceContainer[], mode: TeamBalancePlan["mode"]): TeamBalancePlan {
  const sorted = [...containers]
    .map((container) => ({
      ...container,
      size: container.players.filter((player) => player.online !== false).length,
    }))
    .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name, "zh-CN"));

  const totals = { 1: 0, 2: 0 };
  const actual = sorted.reduce((acc, container) => {
    acc[1] += container.players.filter((player) => player.online !== false && Number(player.teamID) === 1).length;
    acc[2] += container.players.filter((player) => player.online !== false && Number(player.teamID) === 2).length;
    return acc;
  }, { 1: 0, 2: 0 });

  const planned = sorted.map((container) => {
    let targetTeam: 1 | 2 = 1;
    if (container.locked && isValidTargetTeam(container.targetTeam)) {
      targetTeam = container.targetTeam;
    } else if (totals[1] < totals[2]) {
      targetTeam = 1;
    } else if (totals[2] < totals[1]) {
      targetTeam = 2;
    } else if (actual[1] < actual[2]) {
      targetTeam = 1;
    } else if (actual[2] < actual[1]) {
      targetTeam = 2;
    }

    totals[targetTeam] += container.size;

    return {
      containerId: container.id,
      name: container.name,
      size: container.size,
      targetTeam,
      locked: container.locked,
      playerIDs: container.players.map((player) => Number(player.playerID)).filter((value) => Number.isFinite(value)),
    };
  });

  return {
    id: "preview",
    mode,
    execute: false,
    containers: planned,
    totals: {
      team1: totals[1],
      team2: totals[2],
    },
    createdAt: new Date().toISOString(),
  };
}

function summarizeExecution(containers: TeamBalanceContainer[], plan?: TeamBalancePlan | null) {
  const targetMap = new Map<string, 1 | 2 | null>();
  if (plan?.containers?.length) {
    for (const item of plan.containers) {
      targetMap.set(item.containerId, item.targetTeam);
    }
  }

  let totalPlayers = 0;
  let needSwitch = 0;

  for (const container of containers) {
    const targetTeam = targetMap.get(container.id) ?? container.targetTeam;
    for (const player of container.players) {
      totalPlayers += 1;
      if (!player.online) continue;
      if (!isValidTargetTeam(targetTeam)) continue;
      if (![1, 2].includes(Number(player.teamID))) continue;
      if (Number(player.teamID) !== Number(targetTeam)) needSwitch += 1;
    }
  }

  return {
    containerCount: containers.length,
    totalPlayers,
    needSwitch,
  };
}

function containerStats(container: TeamBalanceContainer) {
  let onlinePlayers = 0;
  let team1 = 0;
  let team2 = 0;
  let needSwitch = 0;
  let alreadyOnTarget = 0;
  let invalid = 0;

  for (const player of container.players) {
    if (player.online) onlinePlayers += 1;
    if (Number(player.teamID) === 1) team1 += 1;
    if (Number(player.teamID) === 2) team2 += 1;

    if (!player.online) {
      invalid += 1;
      continue;
    }

    if (![1, 2].includes(Number(player.teamID)) || !isValidTargetTeam(container.targetTeam)) {
      invalid += 1;
      continue;
    }

    if (Number(player.teamID) === Number(container.targetTeam)) alreadyOnTarget += 1;
    else needSwitch += 1;
  }

  return {
    onlinePlayers,
    team1,
    team2,
    needSwitch,
    alreadyOnTarget,
    invalid,
  };
}

function playerActionLabel(player: TeamBalancePlayer, targetTeam: 1 | 2 | null) {
  if (!player.online) return "离线跳过";
  if (!isValidTargetTeam(targetTeam)) return "无目标";
  if (![1, 2].includes(Number(player.teamID))) return "当前队伍无效";
  if (Number(player.teamID) === Number(targetTeam)) return "已在目标阵营";
  if (!player.steamID && !player.eosID && !player.name) return "缺少标识";
  return "待跳边";
}

function teamLabel(teamId: number | null | undefined) {
  if (teamId === 1 || teamId === 2) return `Team ${teamId}`;
  return "--";
}

function formatTime(value?: string | null) {
  if (!value) return "--";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : value;
}

function formatExecutionSummary(execution?: TeamBalanceExecution | null) {
  if (!execution) return "--";
  return `${formatTime(execution.executedAt)} / switched ${execution.switched} / skipped ${execution.skipped} / failed ${execution.failed}`;
}

function playerKey(player: TeamBalancePlayer) {
  return `${player.playerID ?? ""}:${player.steamID ?? ""}:${player.eosID ?? ""}:${player.name}`;
}

function isValidTargetTeam(teamId: number | null | undefined): teamId is 1 | 2 {
  return teamId === 1 || teamId === 2;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function findRuntimePlayer(steamId: string | undefined, eosId: string | undefined, runtimeList: RuntimePlayerLike[]) {
  const steam = String(steamId ?? "").trim();
  const eos = String(eosId ?? "").trim();

  return runtimeList.find((item) => {
    if (steam && String(item.steamID ?? "").trim() === steam) return true;
    if (eos && String(item.eosID ?? "").trim() === eos) return true;
    return false;
  }) ?? null;
}
</script>

<style scoped>
.team-balance-page {
  display: grid;
  gap: 16px;
  padding: 16px;
}

.banner {
  border-radius: 8px;
  padding: 12px 14px;
  border: 1px solid transparent;
  font-size: 13px;
}

.banner.error {
  background: rgba(127, 29, 29, 0.28);
  border-color: rgba(248, 113, 113, 0.3);
  color: #fecaca;
}

.banner.info {
  background: rgba(15, 118, 110, 0.22);
  border-color: rgba(45, 212, 191, 0.24);
  color: #ccfbf1;
}

.banner.warn {
  background: rgba(120, 53, 15, 0.22);
  border-color: rgba(251, 191, 36, 0.28);
  color: #fde68a;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}

.summary-item {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid #2a323b;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.summary-label {
  font-size: 12px;
  color: #93a4b8;
}

.plan-meta {
  margin-top: 14px;
  display: grid;
  gap: 6px;
  color: #9eb0c3;
  font-size: 13px;
}

.empty-state {
  border: 1px dashed #39434d;
  border-radius: 10px;
  padding: 26px 18px;
  text-align: center;
  color: #9aa7b2;
}

.container-grid {
  display: grid;
  gap: 14px;
}

.target-pill {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: rgba(148, 163, 184, 0.14);
  color: #dbe7f2;
}

.target-pill[data-team="1"] {
  background: rgba(59, 130, 246, 0.18);
  color: #bfdbfe;
}

.target-pill[data-team="2"] {
  background: rgba(249, 115, 22, 0.18);
  color: #fed7aa;
}

.container-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
  color: #cbd5e1;
  font-size: 13px;
}

.container-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.player-table {
  border: 1px solid #27313a;
  border-radius: 8px;
  overflow: hidden;
}

.player-row {
  display: grid;
  grid-template-columns: minmax(180px, 2fr) repeat(3, minmax(90px, 1fr));
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border-top: 1px solid #232c34;
  font-size: 13px;
}

.player-row:first-child {
  border-top: none;
}

.player-head {
  background: rgba(255, 255, 255, 0.03);
  color: #93a4b8;
  font-size: 12px;
  text-transform: uppercase;
}

.player-name {
  display: grid;
  gap: 2px;
}

.player-name small {
  color: #7f93a8;
}

button.danger {
  border-color: rgba(248, 113, 113, 0.4);
  color: #fecaca;
}

@media (max-width: 860px) {
  .player-row {
    grid-template-columns: 1fr;
  }
}
</style>
