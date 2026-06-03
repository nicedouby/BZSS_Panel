<template>
  <AppPage full-bleed>
    <AppPageHeader
      eyebrow="PLUGIN"
      title="公平建队"
      subtitle="独立插件入口，集中查看规则窗口、违规候选、小队创建者与手动动作。"
      :status-items="headerStatusItems"
    >
      <template #actions>
        <button class="refresh-button" type="button" :disabled="loading" @click="refreshAll">
          {{ loading ? "刷新中..." : "刷新数据" }}
        </button>
      </template>
    </AppPageHeader>

    <AppPageToolbar>
      <div class="toolbar-status">
        <AppStatusBadge tone="idle">插件路由 {{ pluginRoute }}</AppStatusBadge>
        <AppStatusBadge :tone="pluginActive ? 'ok' : 'warn'">
          {{ pluginActive ? "插件运行中" : "插件未就绪" }}
        </AppStatusBadge>
        <AppStatusBadge :tone="policyEnforced ? 'warn' : 'idle'">
          {{ policyEnforced ? "策略开启" : "策略仅观察" }}
        </AppStatusBadge>
      </div>

      <ErrorBlock v-if="staleErrorText" :message="staleErrorText" />
    </AppPageToolbar>

    <DataState
      :loading="loading && !state"
      :error="errorText"
      :empty="!loading && !errorText && !state"
      :stale="stale"
      loading-title="正在加载公平建队数据"
      loading-text="并发读取规则状态、当前小队与审计记录。"
      error-title="公平建队页面加载失败"
      empty-title="没有可显示的数据"
      empty-text="插件已加载，但当前没有返回页面状态。"
    >
      <div class="page-stack">
        <AppCard title="概览" description="当前规则窗口、插件状态与阈值。">
          <div class="overview-grid">
            <article class="stat-card">
              <span>当前窗口</span>
              <strong>{{ state?.policy.window || "-" }}</strong>
            </article>
            <article class="stat-card">
              <span>Log Clock</span>
              <strong>{{ displayLogClock }}</strong>
            </article>
            <article class="stat-card">
              <span>No Build</span>
              <strong>{{ displayNoBuild }}</strong>
            </article>
            <article class="stat-card">
              <span>Infantry Only</span>
              <strong>{{ displayInfantryOnly }}</strong>
            </article>
            <article class="stat-card">
              <span>Kick Threshold</span>
              <strong>{{ displayKickThreshold }}</strong>
            </article>
            <article class="stat-card">
              <span>违规候选</span>
              <strong>{{ state?.summary.violations ?? 0 }}</strong>
            </article>
            <article class="stat-card">
              <span>当前小队</span>
              <strong>{{ state?.summary.currentSquads ?? 0 }}</strong>
            </article>
            <article class="stat-card">
              <span>超阈值创建者</span>
              <strong>{{ state?.summary.creatorsOverThreshold ?? 0 }}</strong>
            </article>
          </div>

          <div class="policy-meta">
            <span>允许步兵名单: {{ allowedInfantryText }}</span>
            <span>当前 Match: {{ state?.currentMatchId || "-" }}</span>
            <span>Tracked Creations: {{ state?.summary.trackedCreations ?? 0 }}</span>
          </div>
        </AppCard>

        <AppCard title="违规候选" description="服务端派生违规。点击动作会自动预填下方管理表单。">
          <div class="violation-toolbar">
            <AppStatusBadge tone="warn">No Build {{ violationCounts.noBuild }}</AppStatusBadge>
            <AppStatusBadge tone="warn">Infantry Only {{ violationCounts.infantryOnly }}</AppStatusBadge>
            <AppStatusBadge tone="error">Creator Threshold {{ violationCounts.creatorThreshold }}</AppStatusBadge>
          </div>

          <div v-if="!violations.length" class="empty-block">
            当前没有派生到违规候选。
          </div>

          <div v-else class="violation-grid">
            <article v-for="violation in violations" :key="violation.id" class="violation-card">
              <div class="violation-head">
                <strong>{{ violation.title }}</strong>
                <AppStatusBadge :tone="violationTone(violation.kind)">
                  {{ violation.kind }}
                </AppStatusBadge>
              </div>
              <p class="violation-reason">{{ violation.reason }}</p>
              <div class="violation-meta">
                <span v-if="violation.teamId != null || violation.squadId != null">
                  T{{ violation.teamId ?? "-" }} / S{{ violation.squadId ?? "-" }}
                </span>
                <span v-if="violation.creatorName">BY {{ violation.creatorName }}</span>
                <span v-if="violation.createdLogSeconds != null">{{ violation.createdLogSeconds }}s</span>
              </div>
              <div class="violation-actions">
                <button
                  v-if="violation.squad"
                  type="button"
                  class="ghost-button"
                  :disabled="!viewerCanDisband"
                  @click="prefillDisbandFromSquad(violation.squad, violation.reason)"
                >
                  预填解散
                </button>
                <button
                  v-if="violation.creator || violation.steamId || violation.eosId || violation.creatorName"
                  type="button"
                  class="ghost-button"
                  :disabled="!viewerCanKick"
                  @click="prefillKickFromViolation(violation)"
                >
                  预填踢出
                </button>
              </div>
            </article>
          </div>
        </AppCard>

        <div class="management-grid">
          <AppCard title="手动动作" description="继续复用 SquadManagement 的动作网关与审计。">
            <div class="command-stack">
              <section class="command-block">
                <div class="command-head">
                  <strong>解散小队</strong>
                  <span>需要 Team ID、Squad ID</span>
                </div>
                <div class="field-grid">
                  <label class="field">
                    <span>Team ID</span>
                    <input v-model="disbandTeamId" type="number" placeholder="1 / 2" />
                  </label>
                  <label class="field">
                    <span>Squad ID</span>
                    <input v-model="disbandSquadId" type="number" placeholder="ID" />
                  </label>
                </div>
                <label class="field">
                  <span>来源</span>
                  <input v-model="disbandSource" type="text" placeholder="web.fairSquadBuilding" />
                </label>
                <label class="field">
                  <span>原因</span>
                  <input v-model="disbandReason" type="text" placeholder="例如: no_build violation" />
                </label>
                <AppDangerButton
                  :disabled="!viewerCanDisband || actionBusy || !canSubmitDisband"
                  tone="danger"
                  variant="solid"
                  @click="handleDisband"
                >
                  提交解散
                </AppDangerButton>
              </section>

              <section class="command-block">
                <div class="command-head">
                  <strong>踢出创建者 / 玩家</strong>
                  <span>支持 SteamID / EOS / 名称</span>
                </div>
                <label class="field">
                  <span>目标</span>
                  <input v-model="kickTarget" type="text" placeholder="SteamID / EOS / Name" />
                </label>
                <label class="field">
                  <span>来源</span>
                  <input v-model="kickSource" type="text" placeholder="web.fairSquadBuilding" />
                </label>
                <label class="field">
                  <span>原因</span>
                  <input v-model="kickReason" type="text" placeholder="例如: creator threshold" />
                </label>
                <AppDangerButton
                  :disabled="!viewerCanKick || actionBusy || !canSubmitKick"
                  tone="danger"
                  variant="outline"
                  @click="handleKick"
                >
                  提交踢出
                </AppDangerButton>
              </section>

              <section class="command-block">
                <div class="command-head">
                  <strong>移出小队</strong>
                  <span>支持 SteamID / EOS / 名称</span>
                </div>
                <label class="field">
                  <span>目标</span>
                  <input v-model="removeTarget" type="text" placeholder="SteamID / EOS / Name" />
                </label>
                <label class="field">
                  <span>来源</span>
                  <input v-model="removeSource" type="text" placeholder="web.fairSquadBuilding" />
                </label>
                <label class="field">
                  <span>原因</span>
                  <input v-model="removeReason" type="text" placeholder="例如: manual correction" />
                </label>
                <AppDangerButton
                  :disabled="!viewerCanRemove || actionBusy || !canSubmitRemove"
                  tone="warn"
                  variant="outline"
                  @click="handleRemove"
                >
                  提交移出
                </AppDangerButton>
              </section>
            </div>
          </AppCard>

          <AppCard title="当前小队" description="按当前运行态列出活动小队，可快速预填解散。">
            <AppTable compact>
              <thead>
                <tr>
                  <th>Squad</th>
                  <th>Creator</th>
                  <th>Rule</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!squads.length">
                  <td colspan="4" class="empty-row">当前没有小队。</td>
                </tr>
                <tr v-for="squad in squads" :key="squad.recordKey || `${squad.teamId}-${squad.squadId}-${squad.generation}`">
                  <td>
                    <div class="table-main">
                      <strong>T{{ squad.teamId ?? "-" }} / S{{ squad.squadId ?? "-" }}</strong>
                      <span>{{ squad.squadName || "Unknown Squad" }}</span>
                    </div>
                  </td>
                  <td>
                    <div class="table-main">
                      <strong>{{ squad.creatorName || "Unknown" }}</strong>
                      <span>{{ squad.creatorSteamId || squad.creatorEosId || "-" }}</span>
                    </div>
                  </td>
                  <td>
                    <div class="table-main">
                      <span>{{ squad.squadNatureLabel || squad.squadNature || "-" }}</span>
                      <span>{{ squad.memberCount ?? 0 }} 人</span>
                    </div>
                  </td>
                  <td class="action-cell">
                    <button
                      type="button"
                      class="ghost-button"
                      :disabled="!viewerCanDisband"
                      @click="prefillDisbandFromSquad(squad)"
                    >
                      解散
                    </button>
                  </td>
                </tr>
              </tbody>
            </AppTable>
          </AppCard>

          <AppCard title="创建者排行" description="按创建次数排序，可快速预填踢出。">
            <AppTable compact>
              <thead>
                <tr>
                  <th>Creator</th>
                  <th>Count</th>
                  <th>Latest</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!creators.length">
                  <td colspan="4" class="empty-row">当前没有创建者数据。</td>
                </tr>
                <tr v-for="creator in creators" :key="creator.creatorKey">
                  <td>
                    <div class="table-main">
                      <strong>{{ creator.creatorName || "Unknown" }}</strong>
                      <span>{{ creator.steamId || creator.eosId || "-" }}</span>
                    </div>
                  </td>
                  <td>
                    <AppStatusBadge :tone="creator.overThreshold ? 'error' : 'idle'">
                      {{ creator.count }} / {{ creator.threshold || "-" }}
                    </AppStatusBadge>
                  </td>
                  <td>
                    <div class="table-main">
                      <strong>{{ creator.latestSquadName || "-" }}</strong>
                      <span>T{{ creator.latestTeamId ?? "-" }} / S{{ creator.latestSquadId ?? "-" }}</span>
                    </div>
                  </td>
                  <td class="action-cell">
                    <button
                      type="button"
                      class="ghost-button"
                      :disabled="!viewerCanKick"
                      @click="prefillKickFromCreator(creator)"
                    >
                      踢出
                    </button>
                  </td>
                </tr>
              </tbody>
            </AppTable>
          </AppCard>
        </div>

        <div class="records-grid">
          <AppCard title="最近建队流" description="从审计记录中摘取最近的建队事件。">
            <div v-if="recordsErrorText" class="inline-error">{{ recordsErrorText }}</div>
            <div v-else-if="!recentCreations.length" class="empty-block">
              当前没有建队记录。
            </div>
            <div v-else class="creation-feed">
              <article v-for="record in recentCreations" :key="record.recordKey" class="creation-item">
                <div class="creation-head">
                  <AppStatusBadge tone="idle">T{{ record.teamId ?? "-" }}</AppStatusBadge>
                  <AppStatusBadge tone="ok">S{{ record.squadId ?? "-" }}</AppStatusBadge>
                  <span>{{ formatTimeShort(record.time) }}</span>
                </div>
                <strong>{{ record.squadName || "Unknown Squad" }}</strong>
                <span>BY {{ record.creatorName || "Unknown" }}</span>
              </article>
            </div>
          </AppCard>

          <AppCard title="审计记录" description="复用原有 kind 过滤与执行结果展示。">
            <div class="records-toolbar">
              <AppStatusBadge
                v-for="item in kindOptions"
                :key="item.value"
                interactive
                :active="selectedKind === item.value"
                :tone="selectedKind === item.value ? item.tone : 'idle'"
                @click="selectedKind = item.value"
              >
                {{ item.label }} {{ item.count }}
              </AppStatusBadge>
            </div>

            <div v-if="recordsErrorText" class="inline-error">{{ recordsErrorText }}</div>

            <AppTable v-else compact>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th>目标</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!filteredRecords.length">
                  <td colspan="4" class="empty-row">当前筛选条件下没有记录。</td>
                </tr>
                <tr v-for="record in filteredRecords" :key="record.recordKey">
                  <td>
                    <div class="table-main">
                      <strong>{{ formatTimeShort(record.time) }}</strong>
                      <span>{{ formatDate(record.time) }}</span>
                    </div>
                  </td>
                  <td>
                    <AppStatusBadge :tone="kindTone(record.kind)">
                      {{ kindLabel(record.kind) }}
                    </AppStatusBadge>
                  </td>
                  <td>
                    <div class="table-main">
                      <strong>{{ recordTargetTitle(record) }}</strong>
                      <span>{{ recordTargetSubline(record) }}</span>
                    </div>
                  </td>
                  <td>
                    <div class="table-main">
                      <AppStatusBadge :tone="resultTone(record.result, record.error)">
                        {{ record.result || "failed" }}
                      </AppStatusBadge>
                      <span>{{ record.error || record.reason || "-" }}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </AppTable>
          </AppCard>
        </div>
      </div>
    </DataState>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { renderApiError } from "../app/errors";
import {
  executeFairSquadBuildingAction,
  getFairSquadBuildingRecords,
  getFairSquadBuildingState,
  type FairSquadBuildingCreator,
  type FairSquadBuildingPageState,
  type FairSquadBuildingViolation,
} from "../app/fairSquadBuildingApi";
import type { SquadManagementActionResponse, SquadManagementRecord, SquadManagementSquad } from "../app/squadManagementApi";
import { useUiStore } from "../stores/ui.store";

import AppCard from "../components/common/AppCard.vue";
import AppDangerButton from "../components/common/AppDangerButton.vue";
import AppPage from "../components/common/AppPage.vue";
import AppPageHeader from "../components/common/AppPageHeader.vue";
import AppPageToolbar from "../components/common/AppPageToolbar.vue";
import AppStatusBadge from "../components/common/AppStatusBadge.vue";
import AppTable from "../components/common/AppTable.vue";
import DataState from "../components/common/DataState.vue";
import ErrorBlock from "../components/common/ErrorBlock.vue";

const ui = useUiStore();

const actionBusy = ref(false);
const selectedKind = ref("all");

const disbandTeamId = ref("");
const disbandSquadId = ref("");
const disbandSource = ref("web.fairSquadBuilding");
const disbandReason = ref("");

const kickTarget = ref("");
const kickSource = ref("web.fairSquadBuilding");
const kickReason = ref("");

const removeTarget = ref("");
const removeSource = ref("web.fairSquadBuilding");
const removeReason = ref("");

const stateQuery = useQuery({
  queryKey: ["fair-squad-building", "state"],
  queryFn: async () => {
    const response = await getFairSquadBuildingState();
    return response.data;
  },
  refetchInterval: 5000,
});

const recordsQuery = useQuery({
  queryKey: ["fair-squad-building", "records"],
  queryFn: async () => getFairSquadBuildingRecords({ limit: 1000, offset: 0 }),
  refetchInterval: 5000,
});

const state = computed<FairSquadBuildingPageState | null>(() => stateQuery.data.value ?? null);
const records = computed<SquadManagementRecord[]>(() => {
  const list = recordsQuery.data.value?.records ?? [];
  return [...list].sort((left, right) => timeValue(right.time) - timeValue(left.time));
});
const recordsSummary = computed(() => recordsQuery.data.value?.summary ?? null);

const loading = computed(() => Boolean(
  (stateQuery.isLoading.value && !stateQuery.data.value)
  || (recordsQuery.isLoading.value && !recordsQuery.data.value),
));
const stale = computed(() => Boolean(
  (stateQuery.data.value && stateQuery.isFetching.value)
  || (recordsQuery.data.value && recordsQuery.isFetching.value),
));

const errorText = computed(() => {
  if (!stateQuery.error.value || stateQuery.data.value) return "";
  return renderApiError(stateQuery.error.value, "加载公平建队状态失败");
});

const staleErrorText = computed(() => {
  const errors = [];
  if (stateQuery.error.value && stateQuery.data.value) {
    errors.push(renderApiError(stateQuery.error.value, "状态刷新失败"));
  }
  if (recordsQuery.error.value && recordsQuery.data.value) {
    errors.push(renderApiError(recordsQuery.error.value, "记录刷新失败"));
  }
  return errors.join("；");
});

const recordsErrorText = computed(() => {
  if (!recordsQuery.error.value) return "";
  return renderApiError(recordsQuery.error.value, "审计记录加载失败");
});

const pluginRoute = computed(() => state.value?.plugin.route || "/plugins/fair-squad-building");
const pluginActive = computed(() => Boolean(state.value?.plugin.active));
const policyEnforced = computed(() => Boolean(state.value?.policy.enforcementEnabled));

const viewerCanDisband = computed(() => Boolean(state.value?.viewer.canDisband || state.value?.viewer.isSuperAdmin));
const viewerCanKick = computed(() => Boolean(state.value?.viewer.canKick || state.value?.viewer.isSuperAdmin));
const viewerCanRemove = computed(() => Boolean(state.value?.viewer.canRemove || state.value?.viewer.isSuperAdmin));

const displayLogClock = computed(() => state.value?.policy.logClockSeconds != null ? `${state.value.policy.logClockSeconds}s` : "-");
const displayNoBuild = computed(() => state.value ? `${state.value.policy.noBuildUntilSeconds}s` : "-");
const displayInfantryOnly = computed(() => state.value ? `${state.value.policy.infantryOnlyUntilSeconds}s` : "-");
const displayKickThreshold = computed(() => state.value ? String(state.value.policy.kickThreshold) : "-");
const allowedInfantryText = computed(() => {
  const values = state.value?.policy.allowedInfantryNames ?? [];
  return values.length ? values.join(", ") : "-";
});

const squads = computed(() => state.value?.squads ?? []);
const creators = computed(() => state.value?.creators ?? []);
const violations = computed(() => state.value?.violations ?? []);

const violationCounts = computed(() => ({
  noBuild: violations.value.filter((item) => item.kind === "no_build").length,
  infantryOnly: violations.value.filter((item) => item.kind === "infantry_only").length,
  creatorThreshold: violations.value.filter((item) => item.kind === "creator_threshold").length,
}));

const kindOptions = computed(() => [
  { value: "all", label: "全部记录", count: recordsSummary.value?.total ?? records.value.length, tone: "idle" as const },
  { value: "squad_created", label: "建队动态", count: recordsSummary.value?.created ?? 0, tone: "ok" as const },
  { value: "disband", label: "解散", count: recordsSummary.value?.disbanded ?? 0, tone: "warn" as const },
  { value: "kick", label: "踢出", count: recordsSummary.value?.kicked ?? 0, tone: "error" as const },
  { value: "remove", label: "移出", count: recordsSummary.value?.removed ?? 0, tone: "warn" as const },
  { value: "switch_team", label: "换边", count: recordsSummary.value?.switched ?? 0, tone: "idle" as const },
]);

const filteredRecords = computed(() => {
  if (selectedKind.value === "all") return records.value;
  return records.value.filter((record) => record.kind === selectedKind.value);
});

const recentCreations = computed(() => records.value.filter((record) => record.kind === "squad_created").slice(0, 12));

const canSubmitDisband = computed(() => Boolean(disbandTeamId.value && disbandSquadId.value));
const canSubmitKick = computed(() => Boolean(kickTarget.value.trim()));
const canSubmitRemove = computed(() => Boolean(removeTarget.value.trim()));

const headerStatusItems = computed<Array<{ label: string; tone?: "ok" | "warn" | "error" | "idle" }>>(() => [
  {
    label: loading.value ? "加载中" : stale.value ? "显示缓存数据" : "实时同步",
    tone: loading.value ? "warn" : stale.value ? "warn" : "ok",
  },
  {
    label: `${state.value?.summary.violations ?? 0} 个违规候选`,
    tone: (state.value?.summary.violations ?? 0) > 0 ? "warn" : "idle",
  },
  {
    label: viewerCanDisband.value || viewerCanKick.value || viewerCanRemove.value ? "可执行动作" : "只读模式",
    tone: viewerCanDisband.value || viewerCanKick.value || viewerCanRemove.value ? "ok" : "idle",
  },
]);

async function refreshAll() {
  await Promise.all([stateQuery.refetch(), recordsQuery.refetch()]);
}

async function confirmDangerAction(
  title: string,
  message: string,
  payload: Record<string, unknown>,
  onSuccess: () => void,
  successTitle: string,
  successMessage: string,
) {
  const confirmed = await ui.openConfirm({
    title,
    message,
    tone: "warn",
  });
  if (!confirmed) return;

  actionBusy.value = true;
  try {
    const response = await executeFairSquadBuildingAction(payload as any);
    ensureActionSucceeded(response);
    ui.pushToast({
      title: successTitle,
      message: successMessage,
      tone: "ok",
    });
    onSuccess();
    await refreshAll();
  } catch (error) {
    ui.pushToast({
      title: "动作执行失败",
      message: error instanceof Error ? error.message : String(error),
      tone: "error",
    });
  } finally {
    actionBusy.value = false;
  }
}

async function handleDisband() {
  if (!viewerCanDisband.value || actionBusy.value || !canSubmitDisband.value) return;

  await confirmDangerAction(
    "确认解散小队",
    `T${disbandTeamId.value} / S${disbandSquadId.value}`,
    {
      type: "disband_squad",
      teamId: Number(disbandTeamId.value),
      squadId: Number(disbandSquadId.value),
      source: disbandSource.value,
      reason: disbandReason.value.trim(),
    },
    () => {
      disbandTeamId.value = "";
      disbandSquadId.value = "";
      disbandReason.value = "";
    },
    "解散请求已提交",
    "小队解散动作已通过公平建队插件页发出。",
  );
}

async function handleKick() {
  if (!viewerCanKick.value || actionBusy.value || !canSubmitKick.value) return;

  await confirmDangerAction(
    "确认踢出目标",
    kickTarget.value.trim(),
    {
      type: "kick_player",
      anyId: kickTarget.value.trim(),
      source: kickSource.value,
      reason: kickReason.value.trim(),
    },
    () => {
      kickTarget.value = "";
      kickReason.value = "";
    },
    "踢出请求已提交",
    "踢出动作已通过公平建队插件页发出。",
  );
}

async function handleRemove() {
  if (!viewerCanRemove.value || actionBusy.value || !canSubmitRemove.value) return;

  await confirmDangerAction(
    "确认移出小队",
    removeTarget.value.trim(),
    {
      type: "remove_from_squad",
      anyId: removeTarget.value.trim(),
      source: removeSource.value,
      reason: removeReason.value.trim(),
    },
    () => {
      removeTarget.value = "";
      removeReason.value = "";
    },
    "移出请求已提交",
    "移出小队动作已通过公平建队插件页发出。",
  );
}

function prefillDisbandFromSquad(squad: SquadManagementSquad, reason = "") {
  disbandTeamId.value = String(squad.teamId ?? "");
  disbandSquadId.value = String(squad.squadId ?? "");
  if (reason) disbandReason.value = reason;
}

function prefillKickFromCreator(creator: FairSquadBuildingCreator) {
  kickTarget.value = creator.steamId || creator.eosId || creator.creatorName || "";
  kickReason.value = creator.overThreshold
    ? `Creating too many squads (${creator.count} > ${creator.threshold})`
    : kickReason.value;
}

function prefillKickFromViolation(violation: FairSquadBuildingViolation) {
  kickTarget.value = violation.steamId || violation.eosId || violation.creatorName || "";
  kickReason.value = violation.reason || kickReason.value;
}

function ensureActionSucceeded(response: SquadManagementActionResponse) {
  if (!response?.ok) {
    throw new Error(response?.message || response?.error || "动作执行失败");
  }
}

function violationTone(kind: FairSquadBuildingViolation["kind"]) {
  if (kind === "creator_threshold") return "error";
  return "warn";
}

function kindLabel(kind: string) {
  if (kind === "squad_created") return "建队";
  if (kind === "disband") return "解散";
  if (kind === "kick") return "踢出";
  if (kind === "remove") return "移出";
  if (kind === "switch_team") return "换边";
  return kind;
}

function kindTone(kind: string) {
  if (kind === "squad_created") return "ok";
  if (kind === "kick") return "error";
  if (kind === "disband" || kind === "remove") return "warn";
  return "idle";
}

function resultTone(result: string, error: string) {
  if (error) return "error";
  if (result === "success" || result === "created") return "ok";
  return "idle";
}

function recordTargetTitle(record: SquadManagementRecord) {
  if (record.kind === "kick" || record.kind === "remove") return record.playerName || "Unknown Player";
  return `T${record.teamId ?? "?"} / S${record.squadId ?? "?"}`;
}

function recordTargetSubline(record: SquadManagementRecord) {
  if (record.kind === "kick" || record.kind === "remove") return record.steamId || record.eosId || "-";
  return record.squadName || "-";
}

function formatTimeShort(value: string) {
  if (!value) return "--";
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDate(value: string) {
  if (!value) return "--";
  return new Date(value).toLocaleDateString("zh-CN");
}

function timeValue(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
</script>

<style scoped>
.toolbar-status {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
}

.refresh-button,
.ghost-button {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease;
}

.refresh-button:disabled,
.ghost-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.refresh-button:not(:disabled):hover,
.ghost-button:not(:disabled):hover {
  transform: translateY(-1px);
  border-color: var(--color-status-info);
  color: var(--color-text-primary);
}

.page-stack {
  display: grid;
  gap: 16px;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.overview-grid,
.violation-grid,
.management-grid,
.records-grid {
  display: grid;
  gap: 12px;
}

.overview-grid {
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
}

.stat-card,
.violation-card,
.creation-item,
.command-block {
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.03);
  padding: 14px;
}

.stat-card {
  display: grid;
  gap: 8px;
}

.stat-card span,
.policy-meta span,
.table-main span,
.command-head span,
.violation-meta span,
.creation-item span,
.inline-error,
.empty-block {
  color: var(--color-text-secondary);
}

.stat-card strong {
  font-size: 20px;
}

.policy-meta,
.violation-toolbar,
.records-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.violation-grid {
  margin-top: 14px;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

.violation-card {
  display: grid;
  gap: 10px;
}

.violation-head,
.violation-actions,
.creation-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.violation-reason {
  margin: 0;
  line-height: 1.5;
}

.violation-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
}

.management-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.records-grid {
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
}

.command-stack {
  display: grid;
  gap: 12px;
}

.command-block {
  display: grid;
  gap: 12px;
}

.command-head,
.field,
.table-main,
.creation-feed {
  display: grid;
  gap: 6px;
}

.field span {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.field input {
  min-height: 38px;
  border-radius: 10px;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  padding: 0 12px;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.action-cell {
  width: 1%;
  white-space: nowrap;
}

.empty-row {
  text-align: center;
  color: var(--color-text-secondary);
}

.creation-feed {
  gap: 10px;
}

.creation-item {
  display: grid;
  gap: 8px;
}

.inline-error,
.empty-block {
  margin-top: 12px;
}

@media (max-width: 1180px) {
  .management-grid,
  .records-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
