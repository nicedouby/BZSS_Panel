<template>
  <section class="squad-management-page page">
    <PageHeader
      title="小队管理"
      eyebrow="Squad Management"
      subtitle="拆分为解散、踢出、移出小队三个模块，统一审计记录。"
    >
      <template #actions>
        <button type="button" @click="reload" :disabled="loading || actionBusy">
          {{ loading ? "刷新中..." : "刷新" }}
        </button>
      </template>
    </PageHeader>

    <div v-if="pageError" class="banner error">{{ pageError }}</div>

    <div class="page-stack">
      <div class="overview-grid">
        <article class="overview-card accent">
          <span>记录总数</span>
          <strong>{{ summary?.total ?? 0 }}</strong>
        </article>
        <article class="overview-card">
          <span>解散</span>
          <strong>{{ summary?.disbanded ?? 0 }}</strong>
        </article>
        <article class="overview-card">
          <span>踢出 (服务器)</span>
          <strong>{{ summary?.kicked ?? 0 }}</strong>
        </article>
        <article class="overview-card">
          <span>移出 (小队)</span>
          <strong>{{ summary?.removed ?? 0 }}</strong>
        </article>
      </div>

      <div class="action-grid">
        <!-- Disband Card -->
        <PageCard title="解散小队" class="action-card">
          <form class="action-form" @submit.prevent="handleDisband">
            <div class="form-row">
              <label>
                <span>Team ID</span>
                <input v-model="disbandTeamId" type="number" min="1" max="2" placeholder="1 或 2" />
              </label>
              <label>
                <span>Squad ID</span>
                <input v-model="disbandSquadId" type="number" min="1" placeholder="例如 5" />
              </label>
            </div>
            <label>
              <span>来源</span>
              <input v-model="disbandSource" type="text" placeholder="例如：manual / discord" />
            </label>
            <label>
              <span>原因</span>
              <input v-model="disbandReason" type="text" placeholder="可选理由" />
            </label>
            <button type="submit" class="secondary full" :disabled="!viewerCanDisband || actionBusy || !canSubmitDisband">
              执行解散
            </button>
          </form>
        </PageCard>

        <!-- Kick Card -->
        <PageCard title="踢出玩家 (服务器)" class="action-card">
          <form class="action-form" @submit.prevent="handleKick">
            <label>
              <span>玩家名 / ID</span>
              <input v-model="kickTarget" type="text" placeholder="名称, Steam64 或 EOS" />
            </label>
            <label>
              <span>来源</span>
              <input v-model="kickSource" type="text" placeholder="例如：manual / anticheat" />
            </label>
            <label>
              <span>原因</span>
              <input v-model="kickReason" type="text" placeholder="可选理由" />
            </label>
            <button type="submit" class="secondary full" :disabled="!viewerCanKick || actionBusy || !canSubmitKick">
              执行踢出
            </button>
          </form>
        </PageCard>

        <!-- Remove Card -->
        <PageCard title="移出玩家 (仅小队)" class="action-card">
          <form class="action-form" @submit.prevent="handleRemove">
            <label>
              <span>玩家名 / ID</span>
              <input v-model="removeTarget" type="text" placeholder="名称, Steam64 或 EOS" />
            </label>
            <label>
              <span>来源</span>
              <input v-model="removeSource" type="text" placeholder="例如：manual / sl_req" />
            </label>
            <label>
              <span>原因</span>
              <input v-model="removeReason" type="text" placeholder="可选理由" />
            </label>
            <button type="submit" class="secondary full" :disabled="!viewerCanRemove || actionBusy || !canSubmitRemove">
              移出小队
            </button>
          </form>
        </PageCard>

        <!-- Creation Tracker Card -->
        <PageCard title="建队事件追踪" class="action-card tracker-card">
          <div class="tracker-console">
            <div v-if="!recentCreations.length" class="console-placeholder">等待建队数据...</div>
            <div v-for="log in recentCreations" :key="log.recordKey" class="console-row">
              <div class="row-meta">
                <span class="row-time">{{ formatTimeShort(log.time) }}</span>
                <span class="row-badge">NEW</span>
                <strong>T{{ log.teamId }} S{{ log.squadId }}</strong>
              </div>
              <div class="row-main">
                <span class="row-squad">{{ log.squadName }}</span>
                <span class="row-creator">{{ log.creatorName }}</span>
              </div>
            </div>
          </div>
        </PageCard>
      </div>

      <PageCard title="操作审计记录">
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
              <span class="count-tag">{{ item.count }}</span>
            </button>
          </div>
          <div class="record-meta">
            <span v-if="summary?.lastEventAt">最后更新 {{ formatTime(summary.lastEventAt) }}</span>
          </div>
        </div>

        <div v-if="loading && !records.length" class="placeholder-block">加载中...</div>
        <div v-else-if="!filteredRecords.length" class="placeholder-block">无记录。</div>
        <div v-else class="table-wrap">
          <table class="record-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作</th>
                <th>细节 (来源 / 操作者 / 目标)</th>
                <th>原因</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="record in filteredRecords" :key="record.recordKey">
                <td>
                  <div class="time-cell">
                    <strong>{{ formatTime(record.time) }}</strong>
                  </div>
                </td>
                <td>
                  <span class="status-chip" :data-tone="kindTone(record.kind)">
                    {{ kindLabel(record.kind) }}
                  </span>
                </td>
                <td>
                  <div class="detail-cell">
                    <div class="source-row">
                      <span class="source-label">{{ record.source || "manual" }}</span>
                      <span v-if="record.operatorName" class="operator-label">BY {{ record.operatorName }}</span>
                    </div>
                    <div class="target-row">
                      <strong>{{ recordTargetTitle(record) }}</strong>
                      <span class="target-sub">{{ recordTargetSubline(record) }}</span>
                    </div>
                  </div>
                </td>
                <td>{{ record.reason || "--" }}</td>
                <td>
                  <div class="result-cell">
                    <span class="status-chip" :data-tone="resultTone(record.result, record.error)">
                      {{ record.result || "failed" }}
                    </span>
                    <span v-if="record.error" class="error-text">{{ record.error }}</span>
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
import { useQuery } from "@tanstack/vue-query";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import { renderApiError } from "../app/errors";
import {
  disbandSquad,
  kickPlayer,
  removePlayerFromSquad,
  getSquadManagementRecords,
  type SquadManagementRecord,
  type SquadManagementRecordsResponse,
} from "../app/squadManagementApi";
import { useAuthStore } from "../stores/auth.store";
import { useUiStore } from "../stores/ui.store";

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

const records = computed(() => [...(query.data.value?.records ?? [])]);
const summary = computed(() => query.data.value?.summary ?? null);
const viewer = computed(() => query.data.value?.viewer ?? null);
const policy = computed(() => query.data.value?.policy ?? null);
const pageError = computed(() => query.error.value ? renderApiError(query.error.value, "加载失败") : "");
const loading = computed(() => Boolean(query.isLoading.value || query.isFetching.value));

const viewerCanDisband = computed(() => Boolean(viewer.value?.canDisband || auth.user?.isSuperAdmin));
const viewerCanKick = computed(() => Boolean(viewer.value?.canKick || auth.user?.isSuperAdmin));
const viewerCanRemove = computed(() => Boolean(viewer.value?.canRemove || auth.user?.isSuperAdmin));

const kindOptions = computed(() => [
  { value: "all", label: "全部", count: summary.value?.total ?? 0 },
  { value: "squad_created", label: "建队", count: summary.value?.created ?? 0 },
  { value: "disband", label: "解散", count: summary.value?.disbanded ?? 0 },
  { value: "kick", label: "踢出", count: summary.value?.kicked ?? 0 },
  { value: "remove", label: "移出", count: summary.value?.removed ?? 0 },
] as const);

const filteredRecords = computed(() => {
  if (selectedKind.value === "all") return records.value;
  return records.value.filter((record) => record.kind === selectedKind.value);
});

const recentCreations = computed(() => {
  return records.value
    .filter((r) => r.kind === "squad_created")
    .slice(0, 15);
});

const canSubmitDisband = computed(() => {
  return Boolean(disbandTeamId.value && disbandSquadId.value);
});

const canSubmitKick = computed(() => {
  return Boolean(kickTarget.value.trim());
});

const canSubmitRemove = computed(() => {
  return Boolean(removeTarget.value.trim());
});

async function reload() {
  await query.refetch();
}

async function handleDisband() {
  if (!viewerCanDisband.value || actionBusy.value || !canSubmitDisband.value) return;
  const confirmed = await ui.openConfirm({
    title: "确认解散小队？",
    message: `Team ${disbandTeamId.value} Squad ${disbandSquadId.value}`,
    tone: "warn",
  });
  if (!confirmed) return;

  actionBusy.value = true;
  try {
    const res = await disbandSquad({
      teamId: Number(disbandTeamId.value),
      squadId: Number(disbandSquadId.value),
      source: disbandSource.value,
      reason: disbandReason.value.trim(),
    });
    if (!res.ok) throw new Error(res.result?.message || "解散失败");
    ui.pushToast({ title: "解散成功", message: "已处理解散请求", tone: "ok" });
    disbandTeamId.value = ""; disbandSquadId.value = ""; disbandReason.value = "";
    void reload();
  } catch (e) {
    ui.pushToast({ title: "操作失败", message: String(e), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

async function handleKick() {
  if (!viewerCanKick.value || actionBusy.value || !canSubmitKick.value) return;
  const confirmed = await ui.openConfirm({
    title: "确认将玩家踢出服务器？",
    message: kickTarget.value,
    tone: "warn",
  });
  if (!confirmed) return;

  actionBusy.value = true;
  try {
    const res = await kickPlayer({
      anyId: kickTarget.value.trim(),
      source: kickSource.value,
      reason: kickReason.value.trim(),
    });
    if (!res.ok) throw new Error(res.result?.message || "踢出失败");
    ui.pushToast({ title: "踢出成功", message: "已处理踢出请求", tone: "ok" });
    kickTarget.value = ""; kickReason.value = "";
    void reload();
  } catch (e) {
    ui.pushToast({ title: "操作失败", message: String(e), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

async function handleRemove() {
  if (!viewerCanRemove.value || actionBusy.value || !canSubmitRemove.value) return;
  const confirmed = await ui.openConfirm({
    title: "确认将玩家从所在小队移出？",
    message: removeTarget.value,
    tone: "warn",
  });
  if (!confirmed) return;

  actionBusy.value = true;
  try {
    const res = await removePlayerFromSquad({
      anyId: removeTarget.value.trim(),
      source: removeSource.value,
      reason: removeReason.value.trim(),
    });
    if (!res.ok) throw new Error(res.result?.message || "移出失败");
    ui.pushToast({ title: "移出成功", message: "已处理移出请求", tone: "ok" });
    removeTarget.value = ""; removeReason.value = "";
    void reload();
  } catch (e) {
    ui.pushToast({ title: "操作失败", message: String(e), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

function kindLabel(kind: string) {
  if (kind === "squad_created") return "小队创建";
  if (kind === "disband") return "解散小队";
  if (kind === "kick") return "踢出玩家";
  if (kind === "remove") return "移出小队";
  return kind;
}

function kindTone(kind: string) {
  if (kind === "squad_created") return "ok";
  if (kind === "disband") return "danger";
  if (kind === "kick") return "danger";
  if (kind === "remove") return "warn";
  return "neutral";
}

function resultTone(result: string, error: string) {
  if (error) return "danger";
  if (result === "success" || result === "created") return "ok";
  return "neutral";
}

function recordTargetTitle(record: SquadManagementRecord) {
  if (record.kind === "kick" || record.kind === "remove") return record.playerName || "Unknown Player";
  return `Team ${record.teamId ?? "?"} Squad ${record.squadId ?? "?"}`;
}

function recordTargetSubline(record: SquadManagementRecord) {
  if (record.kind === "kick" || record.kind === "remove") return record.steamId || record.eosId || "";
  return record.squadName || "";
}

function formatTime(v: any) {
  if (!v) return "--";
  return new Date(v).toLocaleString("zh-CN", { hour12: false });
}

function formatTimeShort(v: any) {
  if (!v) return "--";
  const date = new Date(v);
  return date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
</script>

<style scoped>
.squad-management-page {
  height: 100%;
  overflow-y: auto;
  padding: 0 0 40px; /* Let content-shell handle horizontal, add bottom padding for scroll */
  background: var(--app-background, var(--color-bg-page, #070b10));
}

.page-stack {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 1400px; /* Reduced from 1600 for better readability */
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.overview-card {
  background: var(--color-bg-card, #121c27);
  border: 1px solid var(--color-border-soft, rgba(130, 154, 180, 0.12));
  padding: 16px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: transform 0.2s ease, border-color 0.2s ease;
}

.overview-card:hover {
  border-color: var(--color-border-default);
}

.overview-card span {
  font-size: 12px;
  color: var(--color-text-muted, #74869a);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.overview-card strong {
  font-size: 28px;
  font-weight: 700;
  color: var(--color-text-primary, #eef5fb);
}

.overview-card.accent {
  background: linear-gradient(135deg, rgba(96, 165, 250, 0.1), transparent);
  border-color: var(--color-status-info, #60a5fa);
}

.overview-card.accent strong {
  color: var(--color-status-info, #60a5fa);
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr) 320px;
  gap: 16px;
}

.action-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.action-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.action-form label span {
  font-size: 12px;
  color: var(--color-text-secondary, #aebdca);
}

.action-form input {
  background: var(--color-bg-elevated, #182536);
  border: 1px solid var(--color-border-default, rgba(130, 154, 180, 0.22));
  color: var(--color-text-primary);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.2s ease;
}

.action-form input:focus {
  outline: none;
  border-color: var(--color-status-info);
}

button.full {
  width: 100%;
}

button.secondary {
  background: var(--color-bg-elevated);
  border-color: var(--color-border-default);
}

button.secondary:hover:not(:disabled) {
  border-color: var(--color-status-info);
  background: var(--color-bg-hover);
}

.record-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 16px;
}

.filter-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.filter-chip {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-soft);
  color: var(--color-text-secondary);
  padding: 4px 12px;
  border-radius: 100px;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s ease;
}

.filter-chip[data-active="true"] {
  background: var(--color-status-info);
  border-color: var(--color-status-info);
  color: #fff;
}

.count-tag {
  background: rgba(0, 0, 0, 0.2);
  padding: 0 6px;
  border-radius: 10px;
  font-size: 11px;
}

.record-meta {
  font-size: 12px;
  color: var(--color-text-muted);
}

.table-wrap {
  overflow-x: auto;
  margin: 0 -16px;
  padding: 0 16px;
}

.record-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.record-table th {
  text-align: left;
  padding: 12px;
  color: var(--color-text-muted);
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  border-bottom: 1px solid var(--color-border-soft);
}

.record-table td {
  padding: 12px;
  border-bottom: 1px solid var(--color-border-soft);
  vertical-align: middle;
}

.record-table tr:last-child td {
  border-bottom: none;
}

.time-cell strong {
  display: block;
  font-weight: 500;
}

.detail-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.source-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.source-label {
  color: var(--color-text-muted);
  background: rgba(255, 255, 255, 0.05);
  padding: 1px 4px;
  border-radius: 3px;
}

.operator-label {
  color: var(--color-status-info);
  font-weight: 600;
}

.target-row {
  display: flex;
  flex-direction: column;
}

.target-sub {
  font-size: 12px;
  color: var(--color-text-muted);
  font-family: monospace;
}

.result-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.error-text {
  font-size: 11px;
  color: var(--color-status-error);
  max-width: 200px;
  word-break: break-all;
}

.status-chip {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-soft);
}

.status-chip[data-tone="ok"] {
  background: rgba(34, 197, 94, 0.1);
  color: var(--color-status-online);
  border-color: rgba(34, 197, 94, 0.2);
}

.status-chip[data-tone="warn"] {
  background: rgba(245, 158, 11, 0.1);
  color: var(--color-status-warning);
  border-color: rgba(245, 158, 11, 0.2);
}

.status-chip[data-tone="danger"] {
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-status-error);
  border-color: rgba(239, 68, 68, 0.2);
}

.placeholder-block {
  padding: 40px;
  text-align: center;
  color: var(--color-text-muted);
  background: rgba(0, 0, 0, 0.05);
  border-radius: 8px;
  border: 1px dashed var(--color-border-soft);
}

.tracker-card {
  grid-column: span 1;
}

.tracker-console {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  height: 260px;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: monospace;
}

.console-placeholder {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: 13px;
}

.console-row {
  display: grid;
  gap: 4px;
  padding: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 12px;
}

.row-meta {
  display: flex;
  gap: 8px;
  align-items: center;
}

.row-time {
  color: var(--color-text-muted);
}

.row-badge {
  background: var(--color-status-online);
  color: white;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
}

.row-main {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.row-squad {
  color: var(--color-text-primary);
  font-weight: 600;
}

.row-creator {
  color: var(--color-text-secondary);
  opacity: 0.8;
}

@media (max-width: 1400px) {
  .action-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 1200px) {
  .overview-grid { grid-template-columns: 1fr 1fr; }
  .action-grid { grid-template-columns: 1fr; }
}
</style>
