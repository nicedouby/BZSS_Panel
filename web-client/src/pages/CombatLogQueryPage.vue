<template>
  <AppPage full-bleed class="combat-log-query-page">
    <header class="page-heading">
      <div>
        <div class="eyebrow">COMBAT LOG QUERY</div>
        <h1>战斗日志查询</h1>
        <p>按时间和关键字段检索战斗记录，无需选择月份或日志文件。</p>
      </div>
      <AppStatusBadge tone="idle">后端统一检索</AppStatusBadge>
    </header>

    <AppCard title="查询条件" description="留空的字段不会参与筛选。受害者字段同时支持玩家名称或 Team ID。" compact class="filter-card">
      <form class="filter-form" @submit.prevent="runSearch">
        <label class="field field-wide">
          <span>时间范围</span>
          <div class="range-inputs">
            <input v-model="filters.from" type="datetime-local" aria-label="开始时间">
            <span class="range-separator">至</span>
            <input v-model="filters.to" type="datetime-local" aria-label="结束时间">
          </div>
        </label>

        <label class="field">
          <span>攻击者</span>
          <input v-model.trim="filters.attacker" type="text" placeholder="玩家名称">
        </label>

        <label class="field">
          <span>事件类型</span>
          <select v-model="filters.eventType">
            <option value="">全部事件</option>
            <option value="damage">伤害 damage</option>
            <option value="wound">击倒 wound</option>
            <option value="kill">击杀 kill</option>
            <option value="tk">友伤 TK</option>
            <option value="revive">复活 revive</option>
          </select>
        </label>

        <label class="field">
          <span>受害者 / Team ID</span>
          <input v-model.trim="filters.victim" type="text" placeholder="名称或 1 / 2">
        </label>

        <label class="field">
          <span>武器</span>
          <input v-model.trim="filters.weapon" type="text" placeholder="武器名称">
        </label>

        <label class="field field-damage">
          <span>伤害</span>
          <input v-model.trim="filters.damage" type="number" step="any" placeholder="精确数值">
        </label>

        <div class="filter-actions">
          <button type="button" class="button secondary" :disabled="loading" @click="resetFilters">重置</button>
          <button type="submit" class="button primary" :disabled="loading">
            <span v-if="loading" class="spinner"></span>
            {{ loading ? "查询中..." : "查询日志" }}
          </button>
        </div>
      </form>
    </AppCard>

    <AppCard class="results-card" title="查询结果" compact body-mode="fill" overflow="clip">
      <template #actions>
        <div class="result-summary">
          <span>{{ formatNumber(result?.total ?? 0) }} 条匹配</span>
          <span v-if="result">扫描 {{ formatNumber(result.filesScanned ?? 0) }} 个日志文件</span>
        </div>
      </template>

      <DataState
        mode="fill"
        :loading="loading && !rows.length"
        :error="error"
        :empty="!loading && !error && searched && rows.length === 0"
        empty-title="没有匹配的战斗日志"
        empty-text="请调整时间范围或筛选条件后重新查询。"
      >
        <div class="results-shell">
          <div v-if="!searched && !loading" class="initial-state">
            <strong>输入条件后开始查询</strong>
            <span>默认查询最近 24 小时的记录。</span>
          </div>

          <div v-else class="table-shell">
            <div class="result-table-wrap">
              <table class="result-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>事件</th>
                    <th>标记</th>
                    <th>攻击者</th>
                    <th>受害者</th>
                    <th>Team ID</th>
                    <th>伤害</th>
                    <th>武器</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="line in rows" :key="`${line.date}-${line.lineNumber}`">
                    <td class="time-cell">{{ formatLogTime(line) }}</td>
                    <td><span class="event-pill" :class="`event-${line.type}`">{{ line.type || "--" }}</span></td>
                    <td class="muted-cell">{{ line.mark || "-" }}</td>
                    <td class="name-cell">{{ line.attacker || "-" }}</td>
                    <td class="name-cell">{{ line.victim || "-" }}</td>
                    <td class="team-cell">{{ line.victimTeamId || "-" }}</td>
                    <td class="damage-cell">{{ line.damage || "-" }}</td>
                    <td class="weapon-cell">{{ line.weapon || "-" }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <footer class="pagination-bar">
              <span class="pagination-note">第 {{ offset + 1 }}–{{ offset + rows.length }} 条</span>
              <div class="pagination-actions">
                <button type="button" class="button secondary" :disabled="loading || offset <= 0" @click="pageNewer">更新的</button>
                <button type="button" class="button secondary" :disabled="loading || !result?.hasMoreOlder" @click="pageOlder">更旧的</button>
              </div>
            </footer>
          </div>
        </div>
      </DataState>
    </AppCard>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { apiGet } from "../app/apiClient";
import { renderApiError } from "../app/errors";
import AppCard from "../components/common/AppCard.vue";
import AppPage from "../components/common/AppPage.vue";
import AppStatusBadge from "../components/common/AppStatusBadge.vue";
import DataState from "../components/common/DataState.vue";

interface CombatLogQueryLine {
  date: string;
  timestamp?: string;
  lineNumber: number;
  time: string;
  type: string;
  mark: string;
  attacker: string;
  victim: string;
  victimTeamId: string;
  damage: string;
  weapon: string;
}

interface CombatLogQueryResult {
  total: number;
  offset: number;
  limit: number;
  hasMoreOlder: boolean;
  filesScanned: number;
  lines: CombatLogQueryLine[];
}

const filters = reactive({
  from: "",
  to: "",
  attacker: "",
  eventType: "",
  victim: "",
  weapon: "",
  damage: "",
});

const result = ref<CombatLogQueryResult | null>(null);
const rows = computed(() => result.value?.lines ?? []);
const loading = ref(false);
const error = ref("");
const searched = ref(false);
const offset = ref(0);
const limit = 100;
let requestSerial = 0;

onMounted(() => {
  setDefaultRange();
});

async function runSearch() {
  const serial = ++requestSerial;
  loading.value = true;
  error.value = "";
  offset.value = 0;
  try {
    const data = await apiGet<CombatLogQueryResult>(buildQuery(0));
    if (serial !== requestSerial) return;
    result.value = data;
    searched.value = true;
  } catch (requestError) {
    if (serial !== requestSerial) return;
    error.value = renderApiError(requestError, "查询战斗日志失败");
    result.value = null;
    searched.value = true;
  } finally {
    if (serial === requestSerial) loading.value = false;
  }
}

async function loadPage(nextOffset: number) {
  if (loading.value) return;
  const serial = ++requestSerial;
  loading.value = true;
  error.value = "";
  try {
    const data = await apiGet<CombatLogQueryResult>(buildQuery(nextOffset));
    if (serial !== requestSerial) return;
    offset.value = nextOffset;
    result.value = data;
  } catch (requestError) {
    if (serial !== requestSerial) return;
    error.value = renderApiError(requestError, "查询战斗日志失败");
  } finally {
    if (serial === requestSerial) loading.value = false;
  }
}

function buildQuery(pageOffset: number) {
  const params = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    attacker: filters.attacker,
    eventType: filters.eventType,
    victim: filters.victim,
    weapon: filters.weapon,
    damage: filters.damage,
    offset: String(pageOffset),
    limit: String(limit),
  });
  return `/api/combat-logs/search?${params.toString()}`;
}

function pageOlder() {
  if (result.value?.hasMoreOlder) void loadPage(offset.value + limit);
}

function pageNewer() {
  if (offset.value > 0) void loadPage(Math.max(0, offset.value - limit));
}

function resetFilters() {
  setDefaultRange();
  filters.attacker = "";
  filters.eventType = "";
  filters.victim = "";
  filters.weapon = "";
  filters.damage = "";
  result.value = null;
  error.value = "";
  searched.value = false;
  offset.value = 0;
}

function setDefaultRange() {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  filters.from = toDateTimeLocal(dayAgo);
  filters.to = toDateTimeLocal(now);
}

function toDateTimeLocal(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatLogTime(line: CombatLogQueryLine) {
  if (!line.timestamp) return `${line.date || "--"} ${line.time || "--"}`;
  const date = new Date(line.timestamp);
  return Number.isNaN(date.getTime()) ? `${line.date || "--"} ${line.time || "--"}` : date.toLocaleString();
}

function formatNumber(value: unknown) {
  return new Intl.NumberFormat("zh-CN").format(Number(value ?? 0));
}
</script>

<style scoped>
.combat-log-query-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
  padding: 18px;
  background:
    radial-gradient(circle at 0% 0%, color-mix(in srgb, var(--theme-brand-glow) 72%, transparent), transparent 30%),
    var(--theme-background-flat);
}

.page-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex: 0 0 auto;
}

.eyebrow {
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.16em;
}

h1 {
  margin: 4px 0 0;
  font-size: 22px;
  line-height: 1.2;
}

.page-heading p {
  margin: 6px 0 0;
  color: var(--color-text-muted);
  font-size: 13px;
}

.filter-card {
  flex: 0 0 auto;
}

.filter-form {
  display: grid;
  grid-template-columns: minmax(230px, 1.5fr) repeat(4, minmax(130px, 1fr)) auto;
  gap: 12px;
  align-items: end;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.field > span {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.field input,
.field select {
  width: 100%;
  height: 36px;
  min-width: 0;
  padding: 0 10px;
  border: 1px solid var(--color-border-default);
  border-radius: 9px;
  outline: none;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font: inherit;
  font-size: 12px;
}

.field input:focus,
.field select:focus {
  border-color: var(--color-border-highlight);
  box-shadow: var(--theme-field-glow);
}

.range-inputs {
  display: flex;
  align-items: center;
  gap: 6px;
}

.range-inputs input {
  flex: 1 1 0;
}

.range-separator {
  color: var(--color-text-muted);
  font-size: 12px;
}

.filter-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 13px;
  border: 1px solid transparent;
  border-radius: 9px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.button.primary {
  border-color: color-mix(in srgb, var(--color-status-info) 50%, transparent);
  background: var(--color-status-info);
  color: #fff;
}

.button.secondary {
  border-color: var(--color-border-default);
  background: color-mix(in srgb, var(--color-bg-elevated) 90%, transparent);
  color: var(--color-text-secondary);
}

.button:hover:not(:disabled) {
  filter: brightness(1.08);
}

.button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.results-card {
  flex: 1 1 auto;
  min-height: 0;
}

.result-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--color-text-muted);
  font-size: 12px;
}

.results-shell,
.table-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.initial-state {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--color-text-muted);
  font-size: 13px;
}

.initial-state strong {
  color: var(--color-text-secondary);
  font-size: 15px;
}

.result-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.result-table {
  width: 100%;
  min-width: 920px;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
}

.result-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 11px 12px;
  border-bottom: 1px solid var(--color-border-default);
  background: color-mix(in srgb, var(--color-bg-card) 96%, transparent);
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 800;
  text-align: left;
  white-space: nowrap;
}

.result-table td {
  padding: 10px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border-default) 60%, transparent);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.result-table tbody tr:hover td {
  background: color-mix(in srgb, var(--color-status-info) 7%, transparent);
}

.time-cell,
.damage-cell,
.team-cell {
  color: var(--color-text-primary) !important;
  font-variant-numeric: tabular-nums;
}

.name-cell {
  max-width: 180px;
  overflow: hidden;
  color: var(--color-text-primary) !important;
  text-overflow: ellipsis;
}

.muted-cell {
  color: var(--color-text-muted) !important;
}

.weapon-cell {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.event-pill {
  display: inline-flex;
  min-width: 54px;
  justify-content: center;
  padding: 4px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-bg-elevated) 90%, transparent);
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 800;
}

.event-kill { color: #fda4af; background: rgba(244, 63, 94, 0.13); }
.event-damage,
.event-wound { color: #fcd34d; background: rgba(245, 158, 11, 0.13); }
.event-tk { color: #fb923c; background: rgba(249, 115, 22, 0.14); }
.event-revive { color: #86efac; background: rgba(34, 197, 94, 0.13); }

.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 12px;
}

.pagination-note {
  color: var(--color-text-muted);
  font-size: 12px;
}

.pagination-actions {
  display: flex;
  gap: 8px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 1250px) {
  .filter-form {
    grid-template-columns: repeat(3, minmax(150px, 1fr));
  }

  .field-wide {
    grid-column: span 2;
  }

  .filter-actions {
    justify-content: flex-end;
  }
}

@media (max-width: 760px) {
  .combat-log-query-page {
    padding: 12px;
  }

  .page-heading {
    flex-direction: column;
  }

  .filter-form {
    grid-template-columns: 1fr;
  }

  .field-wide {
    grid-column: auto;
  }

  .filter-actions {
    justify-content: stretch;
  }

  .filter-actions .button {
    flex: 1;
  }
}
</style>
