<template>
  <AppPage full-bleed>
    <AppPageHeader
      eyebrow="COMMAND & CONTROL"
      title="小队管理"
      subtitle="解散、踢出、移出小队与审计记录"
      :status-items="headerStatusItems"
    >
      <template #actions>
        <button class="refresh-button" type="button" :disabled="loading" @click="reload">
          {{ loading ? "同步中..." : "刷新数据" }}
        </button>
      </template>
    </AppPageHeader>

    <AppPageToolbar>
      <div class="toolbar-status">
        <AppStatusBadge tone="idle">自动轮询 5s</AppStatusBadge>
        <AppStatusBadge :tone="stale ? 'warn' : 'ok'">
          {{ stale ? "缓存数据" : "实时数据" }}
        </AppStatusBadge>
      </div>

      <ErrorBlock v-if="staleErrorText" :message="staleErrorText" />
    </AppPageToolbar>

    <AppSplitLayout>
      <template #left>
        <AppCard title="核心指令" description="这些操作会直接发送到服务器，提交前会进行二次确认。">
          <AppSection title="解散小队" description="需要 Team ID、Squad ID 和理由。">
            <div class="command-form">
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
                <span>操作来源</span>
                <input v-model="disbandSource" type="text" placeholder="manual / discord" />
              </label>

              <label class="field">
                <span>审计理由</span>
                <input v-model="disbandReason" type="text" placeholder="为什么解散？" />
              </label>

              <AppDangerButton
                class="command-button"
                :disabled="!viewerCanDisband || actionBusy || !canSubmitDisband"
                tone="danger"
                variant="solid"
                @click="handleDisband"
              >
                确认执行解散
              </AppDangerButton>
            </div>
          </AppSection>

          <AppSection title="踢出玩家" description="支持名称、SteamID 或 EOS ID。">
            <div class="command-form">
              <label class="field">
                <span>目标玩家</span>
                <input v-model="kickTarget" type="text" placeholder="名称 / SteamID / EOS" />
              </label>

              <label class="field">
                <span>审计理由</span>
                <input v-model="kickReason" type="text" placeholder="踢出原因" />
              </label>

              <AppDangerButton
                class="command-button"
                :disabled="!viewerCanKick || actionBusy || !canSubmitKick"
                tone="danger"
                variant="outline"
                @click="handleKick"
              >
                将玩家踢出
              </AppDangerButton>
            </div>
          </AppSection>

          <AppSection title="移出小队" description="支持名称、SteamID 或 EOS ID。">
            <div class="command-form">
              <label class="field">
                <span>目标玩家</span>
                <input v-model="removeTarget" type="text" placeholder="名称 / SteamID / EOS" />
              </label>

              <label class="field">
                <span>审计理由</span>
                <input v-model="removeReason" type="text" placeholder="移出原因" />
              </label>

              <AppDangerButton
                class="command-button"
                :disabled="!viewerCanRemove || actionBusy || !canSubmitRemove"
                tone="warn"
                variant="outline"
                @click="handleRemove"
              >
                确认移出小队
              </AppDangerButton>
            </div>
          </AppSection>
        </AppCard>
      </template>

      <template #right>
        <DataState
          :loading="loading && !records.length"
          :error="errorText"
          :empty="!loading && !errorText && !records.length"
          :stale="stale"
          loading-title="正在加载小队管理数据"
          loading-text="同步最新记录与权限信息。"
          error-title="读取失败"
          empty-title="暂无小队管理记录"
          empty-text="当前没有可显示的审计记录。"
          stale-text="最新轮询失败，正在显示缓存数据。"
        >
          <div class="right-stack">
            <AppCard title="实时建队动态" description="最近 15 条建队记录。">
              <div class="creation-feed">
                <article v-if="!recentCreations.length" class="empty-feed">
                  等待数据扫描...
                </article>

                <article v-for="log in recentCreations" :key="log.recordKey" class="creation-item">
                  <div class="creation-item__head">
                    <AppStatusBadge tone="idle">TEAM {{ log.teamId ?? "-" }}</AppStatusBadge>
                    <AppStatusBadge tone="ok">#{{ log.squadId ?? "-" }}</AppStatusBadge>
                    <span class="creation-time">{{ formatTimeShort(log.time) }}</span>
                  </div>
                  <div class="creation-item__body">
                    <strong>{{ log.squadName || "Unknown Squad" }}</strong>
                    <span>BY: {{ log.creatorName || "Unknown" }}</span>
                  </div>
                </article>
              </div>
            </AppCard>

            <AppCard title="系统操作审计" description="按指令类型查看执行结果。">
              <div class="audit-filter-bar">
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

              <AppTable compact>
                <thead>
                  <tr>
                    <th>时间 / 节点</th>
                    <th>指令类型</th>
                    <th>详细负载（来源 / 操作 / 目标）</th>
                    <th>执行状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!filteredRecords.length">
                    <td colspan="4" class="empty-row">无审计记录数据</td>
                  </tr>
                  <tr v-for="record in filteredRecords" :key="record.recordKey">
                    <td class="col-time">
                      <div class="time-stack">
                        <span class="clock">{{ formatTime(record.time).split(" ")[1] }}</span>
                        <span class="date">{{ formatTime(record.time).split(" ")[0] }}</span>
                      </div>
                    </td>
                    <td class="col-type">
                      <AppStatusBadge :tone="kindTone(record.kind)">{{ kindLabel(record.kind) }}</AppStatusBadge>
                    </td>
                    <td class="col-detail">
                      <div class="detail-payload">
                        <div class="payload-meta">
                          <span class="source">{{ record.source || "Manual" }}</span>
                          <span v-if="record.operatorName" class="operator">BY {{ record.operatorName }}</span>
                        </div>
                        <div class="payload-main">
                          <strong>{{ recordTargetTitle(record) }}</strong>
                          <span class="sub">{{ recordTargetSubline(record) }}</span>
                        </div>
                        <div v-if="record.reason" class="payload-reason">
                          {{ record.reason }}
                        </div>
                      </div>
                    </td>
                    <td class="col-result">
                      <AppStatusBadge :tone="resultTone(record.result, record.error)">
                        {{ record.result || "FAILED" }}
                      </AppStatusBadge>
                      <div v-if="record.error" class="res-error">{{ record.error }}</div>
                    </td>
                  </tr>
                </tbody>
              </AppTable>
            </AppCard>
          </div>
        </DataState>
      </template>
    </AppSplitLayout>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { renderApiError } from "../app/errors";
import {
  disbandSquad,
  kickPlayer,
  removePlayerFromSquad,
  getSquadManagementRecords,
  type SquadManagementRecord,
  type SquadManagementRecordsResponse,
  type SquadManagementActionResponse,
} from "../app/squadManagementApi";
import { useAuthStore } from "../stores/auth.store";
import { useUiStore } from "../stores/ui.store";

import AppPage from "../components/common/AppPage.vue";
import AppPageHeader from "../components/common/AppPageHeader.vue";
import AppPageToolbar from "../components/common/AppPageToolbar.vue";
import AppCard from "../components/common/AppCard.vue";
import AppSection from "../components/common/AppSection.vue";
import AppStatusBadge from "../components/common/AppStatusBadge.vue";
import AppDangerButton from "../components/common/AppDangerButton.vue";
import AppTable from "../components/common/AppTable.vue";
import AppSplitLayout from "../components/common/AppSplitLayout.vue";
import DataState from "../components/common/DataState.vue";
import ErrorBlock from "../components/common/ErrorBlock.vue";

const auth = useAuthStore();
const ui = useUiStore();

const actionBusy = ref(false);
const selectedKind = ref<string>("all");

const disbandTeamId = ref("");
const disbandSquadId = ref("");
const disbandSource = ref("manual");
const disbandReason = ref("");

const kickTarget = ref("");
const kickSource = ref("manual");
const kickReason = ref("");

const removeTarget = ref("");
const removeSource = ref("manual");
const removeReason = ref("");

const query = useQuery<SquadManagementRecordsResponse>({
  queryKey: ["squad-management-records"],
  queryFn: async () => getSquadManagementRecords({ limit: 1000, offset: 0 }),
  refetchInterval: 5000,
});

const records = computed(() => {
  return [...(query.data.value?.records ?? [])].sort((a, b) => timeValue(b.time) - timeValue(a.time));
});

const summary = computed(() => query.data.value?.summary ?? null);
const viewer = computed(() => query.data.value?.viewer ?? null);

const loading = computed(() => Boolean(query.isLoading.value && !query.data.value));
const stale = computed(() => Boolean(query.data.value && query.isFetching.value && !loading.value));

const errorText = computed(() => {
  if (!query.error.value || query.data.value) return "";
  return renderApiError(query.error.value, "加载失败");
});

const staleErrorText = computed(() => {
  if (!query.error.value || !query.data.value) return "";
  return renderApiError(query.error.value, "刷新失败");
});

const viewerCanDisband = computed(() => Boolean(viewer.value?.canDisband || auth.user?.isSuperAdmin));
const viewerCanKick = computed(() => Boolean(viewer.value?.canKick || auth.user?.isSuperAdmin));
const viewerCanRemove = computed(() => Boolean(viewer.value?.canRemove || auth.user?.isSuperAdmin));

const kindOptions = computed(() => [
  { value: "all", label: "全部记录", count: summary.value?.total ?? records.value.length, tone: "idle" as const },
  { value: "squad_created", label: "建队动态", count: summary.value?.created ?? 0, tone: "ok" as const },
  { value: "disband", label: "解散指令", count: summary.value?.disbanded ?? 0, tone: "warn" as const },
  { value: "kick", label: "踢出指令", count: summary.value?.kicked ?? 0, tone: "warn" as const },
  { value: "remove", label: "移出指令", count: summary.value?.removed ?? 0, tone: "warn" as const },
  { value: "switch_team", label: "换边指令", count: summary.value?.switched ?? 0, tone: "idle" as const },
]);

const filteredRecords = computed(() => {
  if (selectedKind.value === "all") return records.value;
  return records.value.filter((record) => record.kind === selectedKind.value);
});

const recentCreations = computed(() => {
  return records.value
    .filter((record) => record.kind === "squad_created")
    .slice(0, 15);
});

const canSubmitDisband = computed(() => Boolean(disbandTeamId.value && disbandSquadId.value));
const canSubmitKick = computed(() => Boolean(kickTarget.value.trim()));
const canSubmitRemove = computed(() => Boolean(removeTarget.value.trim()));

const headerStatusItems = computed<Array<{ label: string; tone?: "ok" | "warn" | "error" | "idle" }>>(() => [
  { label: loading.value ? "同步中" : stale.value ? "缓存显示" : "实时同步", tone: loading.value ? "warn" : stale.value ? "warn" : "ok" },
  { label: `${summary.value?.total ?? records.value.length} 条记录`, tone: "idle" as const },
  { label: viewerCanDisband.value || viewerCanKick.value || viewerCanRemove.value ? "可执行操作" : "只读模式", tone: viewerCanDisband.value || viewerCanKick.value || viewerCanRemove.value ? "ok" : "idle" as const },
]);

async function reload() {
  await query.refetch();
}

async function confirmDangerAction(
  title: string,
  message: string,
  submit: () => Promise<SquadManagementActionResponse>,
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
    const res = await submit();
    if (!res.ok) throw new Error(res.message || "操作执行失败");
    ui.pushToast({
      title: successTitle,
      message: successMessage,
      tone: "ok",
    });
    onSuccess();
    void reload();
  } catch (error) {
    ui.pushToast({
      title: "操作失败",
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
    `TEAM ${disbandTeamId.value} / SQUAD ${disbandSquadId.value}`,
    () => disbandSquad({
      teamId: Number(disbandTeamId.value),
      squadId: Number(disbandSquadId.value),
      source: disbandSource.value,
      reason: disbandReason.value.trim(),
    }),
    () => {
      disbandTeamId.value = "";
      disbandSquadId.value = "";
      disbandReason.value = "";
    },
    "解散请求已送达",
    "小队解散请求已提交。",
  );
}

async function handleKick() {
  if (!viewerCanKick.value || actionBusy.value || !canSubmitKick.value) return;

  await confirmDangerAction(
    "确认踢出玩家",
    kickTarget.value.trim(),
    () => kickPlayer({
      anyId: kickTarget.value.trim(),
      source: kickSource.value,
      reason: kickReason.value.trim(),
    }),
    () => {
      kickTarget.value = "";
      kickReason.value = "";
    },
    "踢出请求已送达",
    "玩家踢出请求已提交。",
  );
}

async function handleRemove() {
  if (!viewerCanRemove.value || actionBusy.value || !canSubmitRemove.value) return;

  await confirmDangerAction(
    "确认移出小队",
    removeTarget.value.trim(),
    () => removePlayerFromSquad({
      anyId: removeTarget.value.trim(),
      source: removeSource.value,
      reason: removeReason.value.trim(),
    }),
    () => {
      removeTarget.value = "";
      removeReason.value = "";
    },
    "移出请求已送达",
    "移出小队请求已提交。",
  );
}

function kindLabel(kind: string) {
  if (kind === "squad_created") return "新建小队";
  if (kind === "disband") return "解散指令";
  if (kind === "kick") return "踢出指令";
  if (kind === "remove") return "移出指令";
  if (kind === "switch_team") return "换边指令";
  return kind;
}

function kindTone(kind: string) {
  if (kind === "squad_created") return "ok";
  if (kind === "disband") return "error";
  if (kind === "kick") return "error";
  if (kind === "remove") return "warn";
  return "idle";
}

function resultTone(result: string, error: string) {
  if (error) return "error";
  if (result === "success" || result === "created") return "ok";
  return "idle";
}

function recordTargetTitle(record: SquadManagementRecord) {
  if (record.kind === "kick" || record.kind === "remove") return record.playerName || "Unknown Player";
  return `T${record.teamId ?? "?"} S${record.squadId ?? "?"}`;
}

function recordTargetSubline(record: SquadManagementRecord) {
  if (record.kind === "kick" || record.kind === "remove") return record.steamId || record.eosId || "";
  return record.squadName || "";
}

function formatTime(value: string) {
  if (!value) return "-- --";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatTimeShort(value: string) {
  if (!value) return "--";
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
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
  min-width: 0;
}

.refresh-button {
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

.refresh-button:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: var(--color-status-info);
  color: var(--color-text-primary);
}

.refresh-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.command-form {
  display: grid;
  gap: 12px;
}

.command-form + .command-form {
  margin-top: 18px;
}

.field-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
}

.field {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.field span {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.field input {
  width: 100%;
  min-width: 0;
  height: 38px;
  border-radius: 10px;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-primary);
  padding: 0 12px;
  font-size: 13px;
  transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
}

.field input:focus {
  outline: none;
  border-color: var(--color-status-info);
  box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.14);
}

.command-button {
  width: 100%;
}

.creation-feed {
  display: grid;
  gap: 10px;
}

.right-stack {
  display: grid;
  gap: 16px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: auto;
  scrollbar-gutter: stable both-edges;
  align-content: start;
}

.empty-feed {
  padding: 18px 0;
  color: var(--color-text-muted);
  text-align: center;
  font-size: 13px;
}

.creation-item {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.012)),
    var(--color-bg-card);
  box-shadow: var(--shadow-sm);
}

.creation-item__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.creation-time {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.creation-item__body {
  display: grid;
  gap: 4px;
}

.creation-item__body strong {
  font-size: 14px;
  line-height: 1.3;
}

.creation-item__body span {
  color: var(--color-text-secondary);
  font-size: 12px;
}

.audit-filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.time-stack {
  display: grid;
  gap: 2px;
}

.clock {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.date {
  font-size: 11px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.col-type,
.col-result {
  white-space: nowrap;
}

.detail-payload {
  display: grid;
  gap: 6px;
}

.payload-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 11px;
}

.source {
  color: var(--color-text-muted);
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
}

.operator {
  color: var(--color-status-info);
  font-weight: 700;
}

.payload-main {
  display: grid;
  gap: 4px;
}

.payload-main strong {
  font-size: 14px;
  line-height: 1.3;
}

.sub {
  color: var(--color-text-secondary);
  font-size: 12px;
}

.payload-reason {
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.res-error {
  margin-top: 6px;
  color: var(--color-status-error);
  font-size: 12px;
  line-height: 1.45;
  white-space: normal;
  word-break: break-word;
}

.empty-row {
  text-align: center;
  color: var(--color-text-muted);
  padding: 18px 12px;
}

@media (max-width: 920px) {
  .field-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
