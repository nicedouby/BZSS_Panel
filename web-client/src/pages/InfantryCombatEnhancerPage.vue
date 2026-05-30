<template>
  <section class="page ice-page">
    <div class="page-shell">
      <PageHeader
        eyebrow="Infantry Signal Layer"
        :title="t('routeTitle.infantryCombatEnhancer')"
        :subtitle="subtitle"
      >
        <template #actions>
          <button class="ghost-btn" type="button" @click="reload">刷新</button>
          <button class="ghost-btn danger" type="button" @click="clearEvents">清空记录</button>
        </template>
      </PageHeader>

      <section class="hero">
        <div class="hero-copy">
          <span class="hero-badge">独立页面</span>
          <h2>把 processed 事件变成更短、更直接的玩家提醒</h2>
          <p>
            这个页面展示的是步兵战斗增强自身的事件流，不再借用“战斗管理”的壳子。
            你可以在这里查看最近提醒、筛选类型、搜索目标，并清空内存缓冲。
          </p>
          <div class="hero-actions">
            <button type="button" class="primary-btn" @click="reload">立即刷新</button>
            <button type="button" class="secondary-btn" @click="clearEvents">清空当前缓冲</button>
          </div>
        </div>

        <div class="hero-stats">
          <div class="stat-tile stat-tile-primary">
            <span>总事件</span>
            <strong>{{ total }}</strong>
            <small>当前列表中的记录数</small>
          </div>
          <div class="stat-tile">
            <span>受害者告警</span>
            <strong>{{ overview?.stats?.victimWarned ?? 0 }}</strong>
            <small>已成功发送给受害者</small>
          </div>
          <div class="stat-tile">
            <span>攻击者告警</span>
            <strong>{{ overview?.stats?.attackerWarned ?? 0 }}</strong>
            <small>已成功发送给攻击者</small>
          </div>
          <div class="stat-tile">
            <span>同人抑制</span>
            <strong>{{ overview?.stats?.samePlayerSuppressed ?? 0 }}</strong>
            <small>同一玩家时自动跳过</small>
          </div>
        </div>
      </section>

      <PageCard compact class="control-card">
        <div class="toolbar">
          <select v-model="filters.type">
            <option value="all">全部类型</option>
            <option value="damage">伤害</option>
            <option value="wound">击倒</option>
            <option value="kill">击杀</option>
          </select>
          <input v-model="filters.q" placeholder="搜索攻击者 / 受害者 / 武器 / 原因">
          <select v-model="filters.limit">
            <option :value="25">25</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
            <option :value="200">200</option>
          </select>
          <button type="button" :disabled="filters.offset === 0" @click="previousPage">上一页</button>
          <button type="button" :disabled="!hasNextPage" @click="nextPage">下一页</button>
          <span class="toolbar-status" :class="{ loading: query.isFetching.value }">
            {{ query.isFetching.value ? "刷新中" : "实时更新" }}
          </span>
        </div>
      </PageCard>

      <DataState
        :loading="query.isLoading.value && !events.length"
        :error="pageError"
        :empty="!pageError && !events.length && !query.isLoading.value"
        empty-title="暂无步兵战斗增强记录"
        empty-text="这里展示的是 combat-clean 传来的 processed 事件，以及发送提醒后的结果。"
      >
        <div class="content-grid">
          <PageCard compact class="summary-card">
            <div class="summary">
              <span>总计 {{ total }}</span>
              <span>偏移 {{ filters.offset }}</span>
              <span v-if="overview?.stats?.rejected != null">拒绝 {{ overview.stats.rejected }}</span>
              <span v-if="overview?.lastUpdatedAt">更新 {{ formatTime(overview.lastUpdatedAt) }}</span>
            </div>
          </PageCard>

          <PageCard compact class="table-card">
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>类型</th>
                    <th>攻击者</th>
                    <th>受害者</th>
                    <th>伤害</th>
                    <th>武器</th>
                    <th>受害者告警</th>
                    <th>攻击者告警</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="event in events" :key="event.id">
                    <td class="mono">{{ formatTime(event.time) }}</td>
                    <td>
                      <span class="type-pill" :class="`type-${event.type}`">{{ labelForType(event.type) }}</span>
                    </td>
                    <td>
                      <div class="player-cell">
                        <strong>{{ event.attackerName || "-" }}</strong>
                        <span>{{ event.attackerSteam64ID || event.attackerEOSID || "-" }}</span>
                      </div>
                    </td>
                    <td>
                      <div class="player-cell">
                        <strong>{{ event.victimName || "-" }}</strong>
                        <span>{{ event.victimSteam64ID || event.victimEOSID || "-" }}</span>
                      </div>
                    </td>
                    <td class="mono">{{ formatDamage(event.damage) }}</td>
                    <td class="weapon-cell">{{ event.weapon || "-" }}</td>
                    <td>{{ formatDecision(event.victimWarning) }}</td>
                    <td>{{ formatDecision(event.attackerWarning) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </PageCard>
        </div>
      </DataState>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { apiGet, apiPost } from "../app/apiClient";
import { renderApiError } from "../app/errors";
import { useUiStore } from "../stores/ui.store";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import DataState from "../components/common/DataState.vue";
import { t } from "../i18n";

const route = useRoute();
const router = useRouter();
const ui = useUiStore();

const filters = reactive({
  type: String(route.query.type ?? "all"),
  q: String(route.query.q ?? ""),
  limit: Math.max(Number(route.query.limit ?? 50) || 50, 1),
  offset: Math.max(Number(route.query.offset ?? 0) || 0, 0),
});

const subtitle = "步兵战斗增强消费 combat-clean 的 processed 事件，为相关玩家发送短期提醒，并保留最近历史。";

watch(
  () => [filters.type, filters.q, filters.limit, filters.offset],
  () => {
    void router.replace({
      query: {
        ...route.query,
        panel: "infantry-combat-enhancer",
        type: filters.type !== "all" ? filters.type : undefined,
        q: filters.q || undefined,
        limit: filters.limit !== 50 ? String(filters.limit) : undefined,
        offset: filters.offset > 0 ? String(filters.offset) : undefined,
      },
    });
  },
);

watch(
  () => [filters.type, filters.q, filters.limit],
  () => {
    filters.offset = 0;
  },
);

const query = useQuery({
  queryKey: computed(() => [
    "infantry-combat-enhancer",
    filters.type,
    filters.q,
    filters.limit,
    filters.offset,
  ]),
  queryFn: async () => apiGet<{
    events: Array<any>;
    overview: any;
  }>(buildEndpoint()),
  placeholderData: (previousData) => previousData,
  refetchInterval: 3000,
  refetchIntervalInBackground: false,
});

const pageError = computed(() => query.error.value ? renderApiError(query.error.value, "加载步兵战斗增强记录失败") : "");
const events = computed(() => query.data.value?.events ?? []);
const overview = computed(() => query.data.value?.overview ?? null);
const total = computed(() => Number(overview.value?.count ?? events.value.length));
const hasNextPage = computed(() => filters.offset + filters.limit < total.value);

const clearMutation = useMutation({
  mutationFn: async () => apiPost("/api/plugins/infantry-combat-enhancer/clear", {}),
  onSuccess: async () => {
    ui.pushToast({
      title: "清空完成",
      message: "已清空步兵战斗增强记录。",
      tone: "ok",
    });
    await query.refetch();
  },
  onError: (error) => {
    ui.pushToast({
      title: "清空失败",
      message: renderApiError(error, "清空步兵战斗增强记录失败"),
      tone: "error",
    });
  },
});

function buildEndpoint() {
  const params = new URLSearchParams({
    type: filters.type,
    search: filters.q,
    limit: String(filters.limit),
    offset: String(filters.offset),
  });
  return `/api/plugins/infantry-combat-enhancer/events?${params.toString()}`;
}

function reload() {
  void query.refetch();
}

function previousPage() {
  filters.offset = Math.max(0, filters.offset - filters.limit);
}

function nextPage() {
  if (!hasNextPage.value) return;
  filters.offset += filters.limit;
}

async function clearEvents() {
  const confirmed = await ui.openConfirm({
    title: "清空步兵战斗增强记录",
    message: "这只会清空当前内存记录，不会影响数据库或原始日志。",
    confirmText: "清空",
    tone: "warn",
  });
  if (!confirmed) return;
  clearMutation.mutate();
}

function labelForType(value: unknown) {
  const type = String(value ?? "");
  if (type === "damage") return "伤害";
  if (type === "wound") return "击倒";
  if (type === "kill") return "击杀";
  return type || "-";
}

function formatDecision(decision: any) {
  if (!decision) return "-";
  if (decision.success) return "已发送";
  if (decision.skipped) return `跳过: ${decision.skipReason || "未知"}`;
  return `失败: ${decision.errorMessage || "未知"}`;
}

function formatDamage(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, "");
}

function formatTime(value: unknown) {
  const text = String(value ?? "");
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
}
</script>

<style scoped>
.ice-page {
  position: relative;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.page-shell {
  position: relative;
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  gap: 14px;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px 2px 10px;
  scrollbar-gutter: stable;
}

.page-shell::before,
.page-shell::after {
  content: "";
  position: fixed;
  inset: auto;
  pointer-events: none;
  z-index: 0;
  filter: blur(28px);
  opacity: 0.5;
}

.page-shell::before {
  width: 340px;
  height: 340px;
  left: -90px;
  top: 60px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(38, 117, 255, 0.24) 0%, rgba(38, 117, 255, 0) 70%);
}

.page-shell::after {
  width: 260px;
  height: 260px;
  right: 30px;
  top: 150px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(34, 197, 94, 0.18) 0%, rgba(34, 197, 94, 0) 72%);
}

.page-shell > * {
  position: relative;
  z-index: 1;
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
  gap: 14px;
  align-items: stretch;
}

.hero-copy,
.hero-stats {
  border: 1px solid rgba(60, 72, 83, 0.9);
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(18, 25, 32, 0.92), rgba(14, 19, 25, 0.96));
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.24);
}

.hero-copy {
  padding: 24px;
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #95c3ff;
  background: rgba(79, 129, 255, 0.14);
  border: 1px solid rgba(79, 129, 255, 0.28);
}

.hero-copy h2 {
  margin: 14px 0 12px;
  font-size: clamp(26px, 3vw, 38px);
  line-height: 1.08;
  letter-spacing: -0.03em;
  max-width: 12ch;
}

.hero-copy p {
  margin: 0;
  max-width: 68ch;
  color: #a8b3bd;
  font-size: 14px;
  line-height: 1.7;
}

.hero-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 20px;
}

.primary-btn,
.secondary-btn,
.ghost-btn {
  border: 1px solid rgba(90, 105, 118, 0.9);
  border-radius: 10px;
  min-height: 38px;
  padding: 0 14px;
  color: #eef3f7;
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
}

.primary-btn {
  border-color: rgba(79, 129, 255, 0.5);
  background: linear-gradient(180deg, rgba(79, 129, 255, 0.96), rgba(45, 92, 222, 0.94));
  box-shadow: 0 10px 20px rgba(46, 92, 222, 0.22);
}

.secondary-btn {
  background: rgba(255, 255, 255, 0.03);
}

.ghost-btn.danger {
  border-color: rgba(239, 68, 68, 0.36);
  color: #ffc7c7;
}

.hero-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 14px;
}

.stat-tile {
  border-radius: 16px;
  padding: 16px 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.stat-tile-primary {
  grid-column: 1 / -1;
  background: linear-gradient(180deg, rgba(79, 129, 255, 0.18), rgba(79, 129, 255, 0.06));
  border-color: rgba(79, 129, 255, 0.24);
}

.stat-tile span {
  display: block;
  color: #92a0ad;
  font-size: 12px;
}

.stat-tile strong {
  display: block;
  margin-top: 8px;
  font-size: 30px;
  line-height: 1;
  letter-spacing: -0.03em;
}

.stat-tile small {
  display: block;
  margin-top: 8px;
  color: #71808d;
  font-size: 12px;
  line-height: 1.5;
}

.toolbar,
.summary {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.toolbar input,
.toolbar select {
  min-width: 0;
  border: 1px solid #38414c;
  background: #11171d;
  color: #edf2f4;
  border-radius: 10px;
  padding: 9px 12px;
  min-height: 38px;
}

.toolbar input {
  flex: 1 1 280px;
}

.toolbar-status {
  margin-left: auto;
  font-size: 12px;
  color: #89a1b5;
}

.toolbar-status.loading {
  color: #9dc4ff;
}

.content-grid {
  display: grid;
  gap: 14px;
  min-height: 0;
  height: 100%;
  overflow: visible;
}

.summary {
  color: #a5b0b8;
  font-size: 12px;
}

.table-wrap {
  overflow: auto;
  max-height: 100%;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #26303a;
  vertical-align: top;
}

th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: #98a5af;
  font-size: 11px;
  font-weight: 700;
  background: rgba(18, 24, 30, 0.98);
  backdrop-filter: blur(8px);
}

tbody tr:hover {
  background: rgba(255, 255, 255, 0.03);
}

.player-cell {
  display: grid;
  gap: 2px;
}

.player-cell strong {
  font-weight: 600;
}

.player-cell span,
.weapon-cell,
.mono {
  color: #95a3af;
  font-size: 12px;
}

.mono {
  font-variant-numeric: tabular-nums;
}

.type-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.05);
}

.type-damage {
  color: #ffd59d;
  background: rgba(245, 158, 11, 0.12);
}

.type-wound {
  color: #b7d8ff;
  background: rgba(96, 165, 250, 0.12);
}

.type-kill {
  color: #ffb1b1;
  background: rgba(239, 68, 68, 0.14);
}

.ice-page :deep(.page-header) {
  align-items: flex-end;
}

.ice-page :deep(.page-header .title) {
  font-size: clamp(24px, 2.8vw, 36px);
  letter-spacing: -0.03em;
}

.ice-page :deep(.page-card) {
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(19, 24, 30, 0.94), rgba(15, 20, 26, 0.96));
  border-color: rgba(52, 63, 74, 0.95);
  overflow: hidden;
}

.ice-page :deep(.page-card .card-body.compact) {
  overflow-x: auto;
}

.ice-page :deep(.card-body.compact) {
  padding: 14px 16px;
}

@media (max-width: 1100px) {
  .hero {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .hero-stats {
    grid-template-columns: 1fr;
  }

  .toolbar-status {
    margin-left: 0;
    width: 100%;
  }
}
</style>
