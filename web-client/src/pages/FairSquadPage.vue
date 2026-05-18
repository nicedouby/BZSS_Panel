<template>
  <section class="squad-management-page page">
    <PageHeader
      title="公平建队"
      eyebrow="Squad Management"
      subtitle="围绕日志时钟窗口自动限制建队，超过阈值会对创建者执行踢出，所有解散动作都走同一个管理模块。"
    >
      <template #actions>
        <button type="button" @click="reload" :disabled="loading || actionBusy">
          {{ loading ? "刷新中..." : "刷新" }}
        </button>
      </template>
    </PageHeader>

    <div v-if="pageError" class="banner error">{{ pageError }}</div>
    <div v-if="info" class="banner info">{{ info }}</div>

    <DataState
      class="squad-state"
      :loading="loading && !state"
      :error="pageError"
      :empty="!pageError && !state && !loading"
      empty-title="暂无公平建队状态"
      empty-text="等待日志时钟锚定后会显示当前窗口、当前小队以及建队追踪结果。"
    >
      <div class="page-stack">
        <div class="policy-strip">
          <span class="status-chip" :data-tone="windowTone">{{ windowLabel }}</span>
          <span class="status-chip">日志 {{ clockLabel }}</span>
          <span class="status-chip" :data-tone="state?.isWarmup ? 'warn' : 'neutral'">
            {{ state?.isWarmup ? "暖服中" : "非暖服" }}
          </span>
          <span class="status-chip" :data-tone="state?.activationEnabled ? 'ok' : 'neutral'">
            启用 {{ state?.activationPopulation ?? 0 }}/{{ state?.activationPlayerThreshold ?? 0 }}
          </span>
          <span class="status-chip" :data-tone="state?.activationEnabled ? 'ok' : 'warn'">
            {{ state?.activationEnabled ? "已激活" : "未激活" }}
          </span>
          <span class="status-chip">阈值 {{ state?.kickThreshold ?? 10 }}</span>
          <span class="status-chip">解散 {{ state?.disbandPermission ?? "squad.disband" }}</span>
          <span class="status-chip">踢出 {{ state?.kickPermission ?? "squad.kick" }}</span>
        </div>

        <div class="overview-grid">
          <article class="overview-card accent">
            <span>当前窗口</span>
            <strong>{{ windowLabel }}</strong>
            <p>{{ clockDetail }}</p>
          </article>
          <article class="overview-card">
            <span>当前小队</span>
            <strong>{{ state?.summary.currentSquads ?? 0 }}</strong>
            <p>当前活跃的全部小队。</p>
          </article>
          <article class="overview-card">
            <span>违规小队</span>
            <strong>{{ state?.summary.violations ?? 0 }}</strong>
            <p>命中禁止建队或非步兵限制的对象。</p>
          </article>
          <article class="overview-card">
            <span>建队追踪</span>
            <strong>{{ state?.summary.creators ?? 0 }}</strong>
            <p>当前本局内被追踪的创建者数量。</p>
          </article>
        </div>

        <div class="content-grid">
          <PageCard
            title="当前小队"
            :description="`${state?.summary.currentSquads ?? 0} 个小队，违规项会高亮显示。`"
          >
            <div v-if="!orderedSquads.length" class="empty-inline">暂无小队。</div>
            <div v-else class="squad-list">
              <article
                v-for="squad in orderedSquads"
                :key="squadKey(squad)"
                class="squad-row"
                :class="{ danger: squad.shouldDisband, disbanded: squad.disbanded }"
              >
                <div class="squad-copy">
                  <div class="squad-title-row">
                    <strong>{{ squad.squadName || "未命名小队" }}</strong>
                    <span class="status-chip" :data-tone="squadTone(squad)">
                      {{ squadLabel(squad) }}
                    </span>
                  </div>

                  <p class="squad-meta">
                    Team {{ displayNumber(squad.teamId) }} · Squad {{ displayNumber(squad.squadId) }}
                    · {{ squad.teamName || "未知阵营" }}
                  </p>
                  <p class="squad-meta">
                    创建者 {{ squad.creatorName || "--" }}
                    · {{ creatorIdentity(squad) }}
                    · {{ formatCreationTime(squad.createdAt) }}
                  </p>
                  <p class="squad-meta">
                    建队时刻 {{ formatOffset(squad.createdSeconds) }}
                    · 当前追踪 {{ squad.currentCreatorCount }}
                    · {{ squad.creationSource || "LOG" }}
                  </p>
                </div>

                <div class="squad-actions">
                  <button
                    type="button"
                    class="secondary"
                    :disabled="!canDisband || actionBusy || !squad.teamId || !squad.squadId"
                    @click="handleDisbandSquad(squad)"
                  >
                    解散
                  </button>
                  <button
                    type="button"
                    :disabled="!canKick || actionBusy || !creatorActionId(squad)"
                    @click="handleKickSquadCreator(squad)"
                  >
                    踢出
                  </button>
                </div>
              </article>
            </div>
          </PageCard>

          <PageCard
            title="建队追踪"
            :description="`${state?.summary.creators ?? 0} 名创建者，超过 ${state?.kickThreshold ?? 10} 次会自动踢出。`"
          >
            <div v-if="!orderedCreators.length" class="empty-inline">暂无追踪对象。</div>
            <div v-else class="creator-list">
              <article
                v-for="creator in orderedCreators"
                :key="creator.creatorKey"
                class="creator-row"
                :class="{ danger: creator.count > (state?.kickThreshold ?? 10) }"
              >
                <div class="creator-copy">
                  <div class="creator-title-row">
                    <strong>{{ creator.creatorName || "未知创建者" }}</strong>
                    <span class="status-chip" :data-tone="creator.count > (state?.kickThreshold ?? 10) ? 'danger' : 'ok'">
                      {{ creator.count }} 次
                    </span>
                  </div>

                  <p class="creator-meta">
                    {{ creator.steamId || creator.eosId || creator.anyId || "--" }}
                    · 首次 {{ formatSimpleTime(creator.firstSeenAt) }}
                    · 最近 {{ formatSimpleTime(creator.lastSeenAt) }}
                  </p>
                  <p class="creator-meta">
                    最近小队 {{ creator.latestSquadName || "--" }}
                    · 最后动作 {{ formatSimpleTime(creator.lastActionAt) }}
                  </p>
                </div>

                <button
                  type="button"
                  class="secondary"
                  :disabled="!canKick || actionBusy || !creator.anyId"
                  @click="handleKickCreator(creator)"
                >
                  踢出
                </button>
              </article>
            </div>
          </PageCard>
        </div>

        <PageCard
          title="最近动作"
          description="自动解散与自动踢出都会写入这里，方便核对当前模块在做什么。"
        >
          <div v-if="!recentActions.length" class="empty-inline">暂无动作记录。</div>
          <div v-else class="action-list">
            <article v-for="action in recentActions" :key="`${action.time}-${action.action}-${action.source}`" class="action-row">
              <div class="action-main">
                <div class="action-title-row">
                  <strong>{{ action.action }}</strong>
                  <span class="status-chip" :data-tone="action.ok ? 'ok' : 'danger'">{{ action.ok ? "成功" : "失败" }}</span>
                </div>
                <p class="action-meta">
                  {{ formatSimpleTime(action.time) }}
                  · {{ action.source || "unknown" }}
                  · {{ action.message || action.error || action.reason || "--" }}
                </p>
              </div>
              <code class="action-command" v-if="action.command">{{ action.command }}</code>
            </article>
          </div>
        </PageCard>
      </div>
    </DataState>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import DataState from "../components/common/DataState.vue";
import { renderApiError } from "../app/errors";
import { disbandSquad, getSquadManagementState, kickSquadCreator, type SquadManagementCreator, type SquadManagementSquad } from "../app/squadManagementApi";
import { useAuthStore } from "../stores/auth.store";
import { useUiStore } from "../stores/ui.store";

const auth = useAuthStore();
const ui = useUiStore();

const actionBusy = ref(false);
const info = ref("");

const query = useQuery({
  queryKey: ["squad-management-state"],
  queryFn: async () => getSquadManagementState(),
  refetchInterval: 1000,
  refetchIntervalInBackground: false,
  staleTime: 0,
});

const state = computed(() => query.data.value?.state ?? null);
const viewer = computed(() => query.data.value?.viewer ?? null);
const pageError = computed(() => (query.error.value ? renderApiError(query.error.value, "无法加载公平建队状态") : ""));
const loading = computed(() => Boolean(query.isLoading.value || query.isFetching.value));
const canDisband = computed(() => Boolean(viewer.value?.canDisband || auth.user?.isSuperAdmin));
const canKick = computed(() => Boolean(viewer.value?.canKick || auth.user?.isSuperAdmin));

const orderedSquads = computed(() => {
  return [...(state.value?.squads ?? [])].sort((left, right) => {
    const leftTime = Number(left.createdAtMs ?? 0);
    const rightTime = Number(right.createdAtMs ?? 0);
    if (leftTime !== rightTime) return leftTime - rightTime;
    return Number(left.squadId ?? 0) - Number(right.squadId ?? 0);
  });
});

const orderedCreators = computed(() => {
  return [...(state.value?.creators ?? [])].sort((left, right) => {
    const countDiff = Number(right.count ?? 0) - Number(left.count ?? 0);
    if (countDiff !== 0) return countDiff;
    return String(left.creatorName ?? "").localeCompare(String(right.creatorName ?? ""), "zh-CN");
  });
});

const recentActions = computed(() => [...(state.value?.recentActions ?? [])].slice().reverse());
const clockLabel = computed(() => formatOffset(state.value?.logClockSeconds ?? 0));
const windowLabel = computed(() => formatWindow(state.value?.window ?? "waiting", Boolean(state.value?.isWarmup)));
const windowTone = computed(() => {
  const current = state.value?.window ?? "waiting";
  if (state.value?.isWarmup) return "warn";
  if (current === "waiting") return "neutral";
  if (current === "open") return "ok";
  return "danger";
});
const clockDetail = computed(() => {
  if (!state.value) return "等待状态同步。";
  if (!state.value.logClockHasAnchor && !state.value.logClockManual) {
    return "日志时钟尚未锚定，模块会等待有效的日志时间。";
  }
  return `${formatOffset(state.value.logClockSeconds)} · ${state.value.logClockLastResetReason || "anchor"}`;
});

async function reload() {
  await query.refetch();
}

function squadKey(squad: SquadManagementSquad) {
  return squad.creationSignature || `${squad.teamId ?? "?"}:${squad.squadId ?? "?"}:${squad.squadName}`;
}

function creatorIdentity(squad: SquadManagementSquad) {
  return squad.creatorSteamId || squad.creatorEosId || squad.anyId || "--";
}

function creatorActionId(value: SquadManagementSquad | SquadManagementCreator) {
  if ("anyId" in value && value.anyId) return value.anyId;
  if ("creatorSteamId" in value && value.creatorSteamId) return value.creatorSteamId;
  if ("creatorEosId" in value && value.creatorEosId) return value.creatorEosId;
  if ("creatorName" in value && value.creatorName) return value.creatorName;
  return "";
}

function squadLabel(squad: SquadManagementSquad) {
  if (squad.shouldDisband) {
    return squad.violationType === "no-build" ? "禁建队" : "步兵限制违规";
  }
  if (squad.allowedInfantry) return "允许";
  return "待巡检";
}

function squadTone(squad: SquadManagementSquad) {
  if (squad.disbanded) return "neutral";
  if (squad.shouldDisband) return "danger";
  if (squad.allowedInfantry) return "ok";
  return "neutral";
}

function formatWindow(window: string, isWarmup: boolean) {
  if (isWarmup) return "暖服中";
  switch (window) {
    case "waiting":
      return "等待锚定";
    case "no-build":
      return "00:00-00:20 禁止建队";
    case "infantry-only":
      return "00:20-00:50 仅允许步兵队";
    case "open":
      return "00:50+ 开放建队";
    default:
      return "未知窗口";
  }
}

function formatOffset(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "--";
  const seconds = Math.max(0, Math.floor(Number(value)));
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function formatSimpleTime(value: string | number | null | undefined) {
  if (value == null || value === "") return "--";
  const text = String(value);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleTimeString();
}

function formatCreationTime(value: string | number | null | undefined) {
  if (value == null || value === "") return "--";
  const text = String(value);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString();
}

async function handleDisbandSquad(squad: SquadManagementSquad) {
  if (!canDisband.value) return;
  const confirmed = await ui.openConfirm({
    title: "确认解散",
    message: `即将解散 ${squad.squadName || "未命名小队"}，Team ${displayNumber(squad.teamId)} / Squad ${displayNumber(squad.squadId)}。`,
    confirmText: "确认解散",
    cancelText: "取消",
    tone: "warn",
  });

  if (!confirmed) return;
  actionBusy.value = true;
  try {
    const response = await disbandSquad({
      teamId: squad.teamId,
      squadId: squad.squadId,
      reason: squad.violationType || "manual",
    });
    if (!response.ok || !response.result.ok) {
      throw new Error(response.result.message || response.result.error || "解散失败");
    }
    ui.pushToast({
      title: "解散完成",
      message: `${squad.squadName || "未命名小队"} 已解散。`,
      tone: "ok",
    });
    await query.refetch();
  } catch (error) {
    ui.pushToast({
      title: "解散失败",
      message: renderApiError(error, "解散失败"),
      tone: "error",
    });
  } finally {
    actionBusy.value = false;
  }
}

async function handleKickSquadCreator(squad: SquadManagementSquad) {
  if (!canKick.value) return;
  const anyId = creatorActionId(squad);
  if (!anyId) return;

  const confirmed = await ui.openConfirm({
    title: "确认踢出",
    message: `即将踢出 ${squad.creatorName || "未知创建者"}，当前追踪次数 ${squad.currentCreatorCount}。`,
    confirmText: "确认踢出",
    cancelText: "取消",
    tone: "warn",
  });

  if (!confirmed) return;
  actionBusy.value = true;
  try {
    const response = await kickSquadCreator({
      anyId,
      creatorKey: squad.creatorKey,
      creatorName: squad.creatorName,
      steamId: squad.creatorSteamId,
      eosId: squad.creatorEosId,
      count: squad.currentCreatorCount,
      reason: `count=${squad.currentCreatorCount}`,
    });
    if (!response.ok || !response.result.ok) {
      throw new Error(response.result.message || response.result.error || "踢出失败");
    }
    ui.pushToast({
      title: "踢出完成",
      message: `${squad.creatorName || "创建者"} 已踢出服务器。`,
      tone: "ok",
    });
    await query.refetch();
  } catch (error) {
    ui.pushToast({
      title: "踢出失败",
      message: renderApiError(error, "踢出失败"),
      tone: "error",
    });
  } finally {
    actionBusy.value = false;
  }
}

async function handleKickCreator(creator: SquadManagementCreator) {
  if (!canKick.value || !creator.anyId) return;

  const confirmed = await ui.openConfirm({
    title: "确认踢出创建者",
    message: `即将踢出 ${creator.creatorName || "未知创建者"}，当前次数 ${creator.count}。`,
    confirmText: "确认踢出",
    cancelText: "取消",
    tone: "warn",
  });

  if (!confirmed) return;
  actionBusy.value = true;
  try {
    const response = await kickSquadCreator({
      anyId: creator.anyId,
      creatorKey: creator.creatorKey,
      creatorName: creator.creatorName,
      steamId: creator.steamId,
      eosId: creator.eosId,
      count: creator.count,
      reason: `count=${creator.count}`,
    });
    if (!response.ok || !response.result.ok) {
      throw new Error(response.result.message || response.result.error || "踢出失败");
    }
    ui.pushToast({
      title: "踢出完成",
      message: `${creator.creatorName || "创建者"} 已踢出服务器。`,
      tone: "ok",
    });
    await query.refetch();
  } catch (error) {
    ui.pushToast({
      title: "踢出失败",
      message: renderApiError(error, "踢出失败"),
      tone: "error",
    });
  } finally {
    actionBusy.value = false;
  }
}

function displayNumber(value: number | null | undefined) {
  return value == null ? "--" : String(value);
}
</script>

<style scoped>
.squad-management-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.squad-state {
  flex: 1;
  min-height: 0;
}

.page-stack {
  display: grid;
  gap: 14px;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.policy-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.overview-card {
  border: 1px solid rgba(105, 123, 141, 0.18);
  border-radius: 16px;
  padding: 14px;
  background:
    radial-gradient(circle at 0% 0%, rgba(96, 165, 250, 0.08), transparent 36%),
    linear-gradient(180deg, rgba(24, 29, 35, 0.96), rgba(18, 22, 28, 0.96));
}

.overview-card.accent {
  background:
    radial-gradient(circle at 100% 0%, rgba(251, 146, 60, 0.1), transparent 28%),
    radial-gradient(circle at 0% 100%, rgba(56, 189, 248, 0.12), transparent 34%),
    linear-gradient(180deg, rgba(24, 29, 35, 0.98), rgba(18, 22, 28, 0.96));
}

.overview-card span {
  display: block;
  color: #8f98a8;
  font-size: 12px;
}

.overview-card strong {
  display: block;
  margin-top: 8px;
  font-size: 24px;
}

.overview-card p {
  margin: 8px 0 0;
  color: #aab2c0;
  font-size: 12px;
  line-height: 1.5;
}

.content-grid {
  display: grid;
  grid-template-columns: 1.25fr 0.95fr;
  gap: 14px;
  min-height: 0;
  height: 100%;
  align-items: stretch;
}

.empty-inline {
  color: #93a0ad;
  font-size: 13px;
}

.squad-list,
.creator-list,
.action-list {
  display: grid;
  gap: 10px;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;
}

.action-list {
  max-height: 240px;
}

.squad-row,
.creator-row,
.action-row {
  border: 1px solid rgba(105, 123, 141, 0.14);
  border-radius: 14px;
  background: rgba(13, 17, 22, 0.68);
  padding: 14px;
}

.squad-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.creator-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.action-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.squad-row.danger,
.creator-row.danger {
  border-color: rgba(239, 68, 68, 0.34);
  box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.1);
}

.squad-row.disbanded {
  opacity: 0.72;
}

.squad-copy,
.creator-copy,
.action-main {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.squad-title-row,
.creator-title-row,
.action-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.squad-meta,
.creator-meta,
.action-meta {
  margin: 0;
  color: #aab2c0;
  font-size: 12px;
  line-height: 1.5;
}

.squad-actions {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
}

.action-command {
  max-width: 320px;
  overflow: auto;
  white-space: nowrap;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  padding: 8px 10px;
  color: #d8deea;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.08);
  color: #d8deea;
  white-space: nowrap;
}

.status-chip[data-tone="ok"] {
  background: rgba(34, 197, 94, 0.14);
  color: #7ee7a6;
}

.status-chip[data-tone="warn"] {
  background: rgba(245, 158, 11, 0.18);
  color: #f5cf79;
}

.status-chip[data-tone="danger"] {
  background: rgba(239, 68, 68, 0.16);
  color: #ff9494;
}

.status-chip[data-tone="neutral"] {
  background: rgba(255, 255, 255, 0.08);
  color: #d8deea;
}

button.secondary {
  background: rgba(255, 255, 255, 0.06);
}

:deep(.content-grid > .page-card) {
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

:deep(.content-grid > .page-card .card-body) {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

@media (max-width: 1180px) {
  .overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .content-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .overview-grid {
    grid-template-columns: 1fr;
  }

  .squad-row,
  .creator-row,
  .action-row {
    flex-direction: column;
  }

  .squad-actions {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .action-command {
    max-width: 100%;
    width: 100%;
  }
}
</style>
