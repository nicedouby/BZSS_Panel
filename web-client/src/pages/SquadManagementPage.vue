<template>
  <section class="squad-management-page page">
    <PageHeader
      title="小队管理"
      eyebrow="Squad Management"
      subtitle="所有解散和踢出命令都经过这里，并统一写入审计记录。"
    >
      <template #actions>
        <button type="button" @click="reload" :disabled="loading || actionBusy">
          {{ loading ? "刷新中..." : "刷新" }}
        </button>
      </template>
    </PageHeader>

    <div v-if="pageError" class="banner error">{{ pageError }}</div>
    <div v-if="info" class="banner info">{{ info }}</div>

    <div class="page-stack">
      <div class="policy-strip">
        <span class="status-chip" :data-tone="viewerCanDisband ? 'ok' : 'neutral'">
          解散 {{ viewerCanDisband ? "可用" : "受限" }}
        </span>
        <span class="status-chip" :data-tone="viewerCanKick ? 'ok' : 'neutral'">
          踢出 {{ viewerCanKick ? "可用" : "受限" }}
        </span>
        <span class="status-chip">阈值 {{ policy?.kickThreshold ?? 0 }}</span>
        <span class="status-chip">解散权限 {{ policy?.disbandPermission || "squad.disband" }}</span>
        <span class="status-chip">踢出权限 {{ policy?.kickPermission || "squad.kick" }}</span>
        <span class="status-chip" :data-tone="policy?.enforcementEnabled ? 'ok' : 'warn'">
          {{ policy?.enforcementEnabled ? "模块已启用" : "模块未启用" }}
        </span>
      </div>

      <div class="overview-grid">
        <article class="overview-card accent">
          <span>记录总数</span>
          <strong>{{ summary?.total ?? 0 }}</strong>
          <p>建队、解散、踢出三类记录的总和。</p>
        </article>
        <article class="overview-card">
          <span>建队记录</span>
          <strong>{{ summary?.created ?? 0 }}</strong>
          <p>小队创建事件，包含 Team / Squad / 建队者。</p>
        </article>
        <article class="overview-card">
          <span>解散记录</span>
          <strong>{{ summary?.disbanded ?? 0 }}</strong>
          <p>所有手动或自动解散的结果和错误。</p>
        </article>
        <article class="overview-card">
          <span>踢出记录</span>
          <strong>{{ summary?.kicked ?? 0 }}</strong>
          <p>所有手动或自动踢出的结果和错误。</p>
        </article>
      </div>

      <div class="action-grid">
        <PageCard
          title="手动解散"
          description="输入 Team ID 和 Squad ID，命令会先走小队管理模块，再由后端执行并记录。"
        >
          <form class="action-form" @submit.prevent="handleDisband">
            <label>
              <span>Team ID</span>
              <input v-model="disbandTeamId" type="number" min="0" inputmode="numeric" placeholder="例如 1" />
            </label>
            <label>
              <span>Squad ID</span>
              <input v-model="disbandSquadId" type="number" min="0" inputmode="numeric" placeholder="例如 3" />
            </label>
            <label class="full">
              <span>原因</span>
              <input v-model="disbandReason" type="text" placeholder="例如 manual review / no-build" />
            </label>
            <div class="form-actions full">
              <button type="submit" class="secondary" :disabled="!viewerCanDisband || actionBusy || !canSubmitDisband">
                解散小队
              </button>
            </div>
          </form>
        </PageCard>

        <PageCard
          title="手动踢出"
          description="输入玩家名，必要时补 Steam ID 或 EOS ID。命令同样会经过小队管理模块并写入记录。"
        >
          <form class="action-form" @submit.prevent="handleKick">
            <label class="full">
              <span>玩家名</span>
              <input v-model="kickPlayerName" type="text" placeholder="例如 Builder123" />
            </label>
            <label>
              <span>Steam ID</span>
              <input v-model="kickSteamId" type="text" placeholder="可选" />
            </label>
            <label>
              <span>EOS ID</span>
              <input v-model="kickEosId" type="text" placeholder="可选" />
            </label>
            <label class="full">
              <span>原因</span>
              <input v-model="kickReason" type="text" placeholder="例如 count=11 / manual review" />
            </label>
            <div class="form-actions full">
              <button type="submit" class="secondary" :disabled="!viewerCanKick || actionBusy || !canSubmitKick">
                踢出玩家
              </button>
            </div>
          </form>
        </PageCard>
      </div>

      <PageCard
        title="记录"
        description="按时间倒序展示全部记录。默认显示建队、解散、踢出三类动作，不展示完整成员态势。"
      >
        <div class="record-toolbar">
          <div class="filter-group">
            <button
              v-for="item in kindOptions"
              :key="item.value"
              type="button"
              class="filter-chip"
              :data-active="selectedKind === item.value"
              @click="selectedKind = item.value"
            >
              {{ item.label }}
              <span>{{ item.count }}</span>
            </button>
          </div>
          <div class="record-meta">
            <span v-if="summary?.lastEventAt">最新 {{ formatTime(summary.lastEventAt) }}</span>
            <span>刷新 {{ refreshLabel }}</span>
          </div>
        </div>

        <div v-if="loading && !records.length" class="placeholder-block">记录加载中...</div>
        <div v-else-if="!filteredRecords.length" class="placeholder-block">暂无匹配记录。</div>
        <div v-else class="table-wrap">
          <table class="record-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>类型</th>
                <th>来源 / 操作者</th>
                <th>目标 / 细节</th>
                <th>原因</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="record in filteredRecords" :key="record.recordKey">
                <td>
                  <div class="time-cell">
                    <strong>{{ formatTime(record.time) }}</strong>
                    <span v-if="record.logTime && record.logTime !== record.time">日志 {{ formatTime(record.logTime) }}</span>
                  </div>
                </td>
                <td>
                  <span class="status-chip" :data-tone="kindTone(record.kind)">
                    {{ kindLabel(record.kind) }}
                  </span>
                </td>
                <td>
                  <div class="detail-cell">
                    <strong>{{ record.source || "--" }}</strong>
                    <span v-if="record.operatorName">操作者 {{ record.operatorName }}</span>
                  </div>
                </td>
                <td>
                  <div class="detail-cell">
                    <strong>{{ recordTargetTitle(record) }}</strong>
                    <span>{{ recordTargetSubline(record) }}</span>
                  </div>
                </td>
                <td>
                  <div class="detail-cell">
                    <strong>{{ record.reason || "--" }}</strong>
                    <span v-if="record.kind === 'squad_created'">{{ creationIdentity(record) }}</span>
                    <span v-else-if="record.kind === 'kick'">{{ kickIdentity(record) }}</span>
                    <span v-else>{{ record.command || "--" }}</span>
                  </div>
                </td>
                <td>
                  <div class="detail-cell">
                    <span class="status-chip" :data-tone="resultTone(record.result, record.error)">
                      {{ record.result || "--" }}
                    </span>
                    <span v-if="record.error">{{ record.error }}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </PageCard>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import { renderApiError } from "../app/errors";
import {
  disbandSquad,
  getSquadManagementRecords,
  kickSquadCreator,
  type SquadManagementRecord,
  type SquadManagementRecordsResponse,
} from "../app/squadManagementApi";
import { useAuthStore } from "../stores/auth.store";
import { useUiStore } from "../stores/ui.store";

const auth = useAuthStore();
const ui = useUiStore();
const queryClient = useQueryClient();

const actionBusy = ref(false);
const info = ref("");
const selectedKind = ref<"all" | "squad_created" | "disband" | "kick">("all");
const disbandTeamId = ref("");
const disbandSquadId = ref("");
const disbandReason = ref("manual");
const kickPlayerName = ref("");
const kickSteamId = ref("");
const kickEosId = ref("");
const kickReason = ref("manual");

const query = useQuery<SquadManagementRecordsResponse>({
  queryKey: ["squad-management-records"],
  queryFn: async () => getSquadManagementRecords({ limit: 1000, offset: 0 }),
  refetchInterval: 5000,
  refetchIntervalInBackground: false,
  staleTime: 0,
});

const records = computed(() => [...(query.data.value?.records ?? [])]);
const summary = computed(() => query.data.value?.summary ?? null);
const viewer = computed(() => query.data.value?.viewer ?? null);
const policy = computed(() => query.data.value?.policy ?? null);
const pageError = computed(() => query.error.value ? renderApiError(query.error.value, "无法加载小队管理记录") : "");
const loading = computed(() => Boolean(query.isLoading.value || query.isFetching.value));
const refreshLabel = computed(() => loading.value ? "刷新中" : "5 秒");
const viewerCanDisband = computed(() => Boolean(viewer.value?.canDisband || auth.user?.isSuperAdmin));
const viewerCanKick = computed(() => Boolean(viewer.value?.canKick || auth.user?.isSuperAdmin));

const kindOptions = computed(() => [
  { value: "all", label: "全部", count: summary.value?.total ?? 0 },
  { value: "squad_created", label: "建队", count: summary.value?.created ?? 0 },
  { value: "disband", label: "解散", count: summary.value?.disbanded ?? 0 },
  { value: "kick", label: "踢出", count: summary.value?.kicked ?? 0 },
] as const);

const filteredRecords = computed(() => {
  if (selectedKind.value === "all") return records.value;
  return records.value.filter((record) => record.kind === selectedKind.value);
});

const canSubmitDisband = computed(() => {
  return Boolean(normalizeNumericInput(disbandTeamId.value) != null && normalizeNumericInput(disbandSquadId.value) != null);
});

const canSubmitKick = computed(() => {
  return Boolean(kickPlayerName.value.trim() || kickSteamId.value.trim() || kickEosId.value.trim());
});

async function reload() {
  await query.refetch();
}

async function handleDisband() {
  if (!viewerCanDisband.value || actionBusy.value || !canSubmitDisband.value) return;

  const teamId = normalizeNumericInput(disbandTeamId.value);
  const squadId = normalizeNumericInput(disbandSquadId.value);
  if (teamId == null || squadId == null) return;

  const confirmed = await ui.openConfirm({
    title: "确认解散",
    message: `将解散 Team ${teamId} / Squad ${squadId}，并写入记录。`,
    confirmText: "确认解散",
    cancelText: "取消",
    tone: "warn",
  });

  if (!confirmed) return;

  actionBusy.value = true;
  try {
    const response = await disbandSquad({
      teamId,
      squadId,
      reason: disbandReason.value.trim() || "manual",
    });

    if (!response.ok || !response.result.ok) {
      throw new Error(response.result.message || response.result.error || "解散失败");
    }

    info.value = `已提交解散 Team ${teamId} / Squad ${squadId}`;
    ui.pushToast({
      title: "解散成功",
      message: `Team ${teamId} / Squad ${squadId} 已处理。`,
      tone: "ok",
    });
    await query.refetch();
    await queryClient.invalidateQueries({ queryKey: ["squad-management-records"] });
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

async function handleKick() {
  if (!viewerCanKick.value || actionBusy.value || !canSubmitKick.value) return;

  const targetName = kickPlayerName.value.trim() || kickSteamId.value.trim() || kickEosId.value.trim();
  const confirmed = await ui.openConfirm({
    title: "确认踢出",
    message: `将踢出 ${targetName}，并写入记录。`,
    confirmText: "确认踢出",
    cancelText: "取消",
    tone: "warn",
  });

  if (!confirmed) return;

  actionBusy.value = true;
  try {
    const response = await kickSquadCreator({
      anyId: targetName,
      creatorName: kickPlayerName.value.trim(),
      steamId: kickSteamId.value.trim(),
      eosId: kickEosId.value.trim(),
      reason: kickReason.value.trim() || "manual",
    });

    if (!response.ok || !response.result.ok) {
      throw new Error(response.result.message || response.result.error || "踢出失败");
    }

    info.value = `已提交踢出 ${targetName}`;
    ui.pushToast({
      title: "踢出成功",
      message: `${targetName} 已处理。`,
      tone: "ok",
    });
    await query.refetch();
    await queryClient.invalidateQueries({ queryKey: ["squad-management-records"] });
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

function kindLabel(kind: string) {
  if (kind === "squad_created") return "建队记录";
  if (kind === "disband") return "解散记录";
  if (kind === "kick") return "踢出记录";
  return kind || "记录";
}

function kindTone(kind: string) {
  if (kind === "squad_created") return "ok";
  if (kind === "disband") return "warn";
  if (kind === "kick") return "warn";
  return "neutral";
}

function resultTone(result: string, error: string) {
  if (error) return "danger";
  if (result === "success" || result === "created") return "ok";
  return "neutral";
}

function recordTargetTitle(record: SquadManagementRecord) {
  if (record.kind === "squad_created") {
    return `${record.teamId == null ? "--" : `Team ${record.teamId}`} / ${record.squadId == null ? "--" : `Squad ${record.squadId}`}`;
  }

  if (record.kind === "kick") {
    return record.playerName || record.creatorName || "--";
  }

  if (record.teamId == null && record.squadId == null) {
    return record.squadName || "--";
  }

  return `${record.teamId == null ? "--" : `Team ${record.teamId}`} / ${record.squadId == null ? "--" : `Squad ${record.squadId}`}`;
}

function recordTargetSubline(record: SquadManagementRecord) {
  if (record.kind === "squad_created") {
    return [record.squadName, creationIdentity(record)].filter(Boolean).join(" · ") || "--";
  }

  if (record.kind === "kick") {
    return [kickIdentity(record), record.reason].filter(Boolean).join(" · ") || "--";
  }

  return [record.squadName, record.creatorName].filter(Boolean).join(" · ") || "--";
}

function creationIdentity(record: SquadManagementRecord) {
  const parts = [record.creatorName, record.steamId, record.eosId];
  return parts.filter(Boolean).join(" / ") || "--";
}

function kickIdentity(record: SquadManagementRecord) {
  const parts = [record.playerName, record.steamId, record.eosId];
  return parts.filter(Boolean).join(" / ") || "--";
}

function formatTime(value: string | number | null | undefined) {
  if (value == null || value === "") return "--";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function normalizeNumericInput(value: string) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? Math.floor(number) : null;
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

.page-stack {
  display: grid;
  gap: 14px;
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
  border-radius: 14px;
  padding: 14px;
  background:
    radial-gradient(circle at 100% 0%, rgba(96, 165, 250, 0.08), transparent 36%),
    linear-gradient(180deg, rgba(24, 29, 35, 0.96), rgba(18, 22, 28, 0.96));
}

.overview-card.accent {
  background:
    radial-gradient(circle at 0% 100%, rgba(251, 146, 60, 0.1), transparent 32%),
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

.action-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.action-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 12px;
}

.action-form label {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.action-form label span {
  color: #8f98a8;
  font-size: 12px;
}

.action-form input {
  min-width: 0;
}

.action-form .full,
.form-actions.full {
  grid-column: 1 / -1;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
}

.record-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  border: 1px solid rgba(105, 123, 141, 0.18);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: #d8deea;
  padding: 0 12px;
}

.filter-chip[data-active="true"] {
  border-color: rgba(96, 165, 250, 0.42);
  background: rgba(96, 165, 250, 0.14);
}

.filter-chip span {
  color: #8f98a8;
}

.record-meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  color: #93a0ad;
  font-size: 12px;
}

.placeholder-block {
  padding: 12px 2px;
  color: #93a0ad;
  font-size: 13px;
}

.table-wrap {
  overflow: auto;
  max-height: 54vh;
}

.record-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.record-table th,
.record-table td {
  padding: 12px 10px;
  border-bottom: 1px solid rgba(105, 123, 141, 0.12);
  vertical-align: top;
  text-align: left;
}

.record-table th {
  color: #8f98a8;
  font-weight: 600;
  white-space: nowrap;
}

.time-cell,
.detail-cell {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.time-cell strong,
.detail-cell strong {
  color: #e8edf4;
  font-weight: 600;
}

.time-cell span,
.detail-cell span {
  color: #93a0ad;
  line-height: 1.45;
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

.banner {
  border-radius: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(105, 123, 141, 0.18);
}

.banner.error {
  border-color: rgba(239, 68, 68, 0.28);
  background: rgba(239, 68, 68, 0.08);
  color: #ffb1b1;
}

.banner.info {
  border-color: rgba(96, 165, 250, 0.28);
  background: rgba(96, 165, 250, 0.08);
  color: #a9d8ff;
}

button.secondary {
  background: rgba(255, 255, 255, 0.06);
}

:deep(.page-stack > .page-card) {
  min-height: 0;
}

:deep(.page-stack > .page-card .card-body) {
  min-height: 0;
}

@media (max-width: 1180px) {
  .overview-grid,
  .action-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .action-form {
    grid-template-columns: 1fr;
  }

  .record-table {
    min-width: 880px;
  }
}
</style>
