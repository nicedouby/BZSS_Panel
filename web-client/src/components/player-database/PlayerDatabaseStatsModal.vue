<template>
  <div v-if="open" class="modal-overlay" v-backdrop-close="() => $emit('close')">
    <div class="modal-card">
      <header class="modal-header">
        <div class="header-title">
          <h2>{{ t("database.databaseStats") }}</h2>
          <p>{{ subtitle }}</p>
        </div>
        <div class="modal-actions">
          <select :value="days" class="modal-select" @change="$emit('update:days', ($event.target as HTMLSelectElement).value)">
            <option v-for="d in [7, 14, 30, 60, 90]" :key="d" :value="d">{{ d }} {{ t("database.days") }}</option>
          </select>
          <select :value="top" class="modal-select" @change="$emit('update:top', ($event.target as HTMLSelectElement).value)">
            <option v-for="topOption in [5, 10, 20, 50]" :key="topOption" :value="topOption">{{ t("database.top") }} {{ topOption }}</option>
          </select>
          <button type="button" class="refresh-btn" :disabled="loading" @click="$emit('refresh')">
            {{ loading ? t("common.refreshing") : t("database.refreshStats") }}
          </button>
          <button type="button" class="close-btn" @click="$emit('close')">✕</button>
        </div>
      </header>

      <div class="modal-body">
        <div v-if="loading && !stats" class="modal-placeholder">{{ t("database.loadingStats") }}</div>
        <div v-else-if="error" class="modal-placeholder error">{{ error }}</div>
        <div v-else-if="stats" class="analytics-content">
          <section class="analytics-section">
            <div class="section-heading">
              <div>
                <span class="section-kicker">{{ t("database.snapshot") }}</span>
                <h3>{{ t("database.operationsOverview") }}</h3>
              </div>
            </div>
            <div class="insight-grid">
              <article class="insight-card">
                <header>
                  <span>{{ t("database.activityDistribution") }}</span>
                  <strong>{{ stats.activity?.active7d ?? 0 }}</strong>
                </header>
                <div class="metric-row"><span>24h</span><b>{{ stats.activity?.active24h ?? 0 }}</b></div>
                <div class="metric-row"><span>7 {{ t("database.days") }}</span><b>{{ stats.activity?.active7d ?? 0 }}</b></div>
                <div class="metric-row"><span>30 {{ t("database.days") }}</span><b>{{ stats.activity?.active30d ?? 0 }}</b></div>
                <div class="metric-row muted"><span>{{ t("database.dormant30d") }}</span><b>{{ stats.activity?.dormant30d ?? 0 }}</b></div>
              </article>

              <article class="insight-card">
                <header>
                  <span>{{ t("database.playerComposition") }}</span>
                  <strong>{{ formatHours(stats.engagement?.averageGameSeconds ?? 0) }}h</strong>
                </header>
                <div class="metric-row"><span>{{ t("database.veteranPlayers") }}</span><b>{{ stats.engagement?.veteranPlayers ?? 0 }}</b></div>
                <div class="metric-row"><span>{{ t("database.regularPlayers") }}</span><b>{{ stats.engagement?.regularPlayers ?? 0 }}</b></div>
                <div class="metric-row"><span>{{ t("database.newcomerPlayers") }}</span><b>{{ stats.engagement?.newcomerPlayers ?? 0 }}</b></div>
                <div class="metric-row"><span>{{ t("database.warmupPlayers") }}</span><b>{{ stats.engagement?.warmupPlayers ?? 0 }}</b></div>
              </article>

              <article class="insight-card">
                <header>
                  <span>{{ t("database.dataCompleteness") }}</span>
                  <strong>{{ formatPercent(completenessAverage) }}</strong>
                </header>
                <div v-for="item in completenessRows" :key="item.label" class="health-row">
                  <div><span>{{ item.label }}</span><b>{{ item.value }} / {{ totalPlayers }}</b></div>
                  <div class="health-track"><i :style="{ width: `${item.rate * 100}%` }"></i></div>
                </div>
              </article>
            </div>
          </section>

          <!-- Leaderboards -->
          <section class="analytics-section">
            <h3>{{ t("database.leaderboards") }}</h3>
            <div class="leaderboard-grid">
              <div class="leaderboard-card">
                <h4>{{ t("database.playtime") }}</h4>
                <ol class="rank-list">
                  <li v-for="item in stats.leaderboards?.byPlaytime" :key="item.id">
                    <span class="player-name" @click="$emit('jump', item.id)">
                      {{ item.currentName || item.steamID || item.eosID || t("common.unknown") }}
                    </span>
                    <span class="rank-value">{{ formatHours(item.gameSeconds) }}h</span>
                  </li>
                </ol>
              </div>

              <div class="leaderboard-card">
                <h4>{{ t("database.warmupPoints") }}</h4>
                <ol class="rank-list">
                  <li v-for="item in stats.leaderboards?.byWarmupPoints" :key="`warmup-${item.id}`">
                    <span class="player-name" @click="$emit('jump', item.id)">
                      {{ item.currentName || item.steamID || item.eosID || t("common.unknown") }}
                    </span>
                    <span class="rank-value">{{ formatAssetAmount(item.warmupPoints ?? 0) }}</span>
                  </li>
                </ol>
              </div>

              <div class="leaderboard-card">
                <h4>{{ t("database.violations") }}</h4>
                <ol class="rank-list">
                  <li v-for="item in stats.leaderboards?.byViolations" :key="item.playerId">
                    <span class="player-name" @click="$emit('jump', item.playerId)">
                      {{ item.currentName || item.steamID || item.eosID || t("common.unknown") }}
                    </span>
                    <span class="rank-value">{{ item.totalViolations }}</span>
                  </li>
                </ol>
              </div>

              <div class="leaderboard-card">
                <h4>{{ t("database.matchVeterans") }}</h4>
                <ol class="rank-list">
                  <li v-for="item in stats.leaderboards?.byMatches" :key="`matches-${item.id}`">
                    <span class="player-name" @click="$emit('jump', item.id)">
                      {{ item.currentName || item.steamID || item.eosID || t("common.unknown") }}
                    </span>
                    <span class="rank-value">{{ item.totalMatches }} · {{ formatPercent(item.winRate) }}</span>
                  </li>
                </ol>
              </div>

              <div class="leaderboard-card">
                <h4>{{ t("database.commandTime") }}</h4>
                <ol class="rank-list">
                  <li v-for="item in stats.leaderboards?.byCommand" :key="`command-${item.id}`">
                    <span class="player-name" @click="$emit('jump', item.id)">
                      {{ item.currentName || item.steamID || item.eosID || t("common.unknown") }}
                    </span>
                    <span class="rank-value">{{ formatHours(item.commandSeconds) }}h</span>
                  </li>
                </ol>
              </div>
            </div>
          </section>

          <!-- Breakdowns -->
          <section class="analytics-section">
            <h3>{{ t("database.breakdowns") }}</h3>
            <div class="breakdown-grid">
              <div class="breakdown-card">
                <h4>{{ t("database.permissionGroups") }}</h4>
                <div class="chip-cloud">
                  <div v-for="group in stats.breakdowns?.permissionGroups" :key="group.permissionGroup" class="stat-chip">
                    <span class="chip-label">{{ group.permissionGroup }}</span>
                    <span class="chip-count">{{ group.players }}</span>
                  </div>
                </div>
              </div>

              <div class="breakdown-card">
                <h4>{{ t("database.roleTags") }}</h4>
                <div class="chip-cloud">
                  <div v-for="tag in stats.breakdowns?.roleTags" :key="tag.tagValue" class="stat-chip">
                    <span class="chip-label">{{ tag.tagValue }}</span>
                    <span class="chip-count">{{ tag.players }}</span>
                  </div>
                </div>
              </div>

              <div class="breakdown-card">
                <h4>违规大类</h4>
                <div class="chip-cloud">
                  <div v-for="v in stats.breakdowns?.violationCategories" :key="v.categoryKey" class="stat-chip">
                    <span class="chip-label">{{ v.categoryLabel || v.categoryKey }}</span>
                    <span class="chip-count">{{ v.totalCount }}</span>
                  </div>
                </div>
              </div>

              <div class="breakdown-card">
                <h4>{{ t("database.violationTypes") }}</h4>
                <div class="chip-cloud">
                  <div v-for="v in stats.breakdowns?.violationTypes" :key="v.violationKey" class="stat-chip">
                    <span class="chip-label">{{ v.violationLabel || v.violationKey }}</span>
                    <span class="chip-count">{{ v.totalCount }}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section class="analytics-section">
            <h3>{{ t("database.playerInsights7d") }}</h3>
            <div class="breakdown-grid">
              <div class="breakdown-card">
                <h4>{{ t("database.playerStats7d") }}</h4>
                <ul class="metric-list">
                  <li>
                    <span>{{ t("database.newPlayers7d") }}</span>
                    <strong>{{ stats.playerStats7d?.newPlayers ?? 0 }}</strong>
                  </li>
                  <li>
                    <span>{{ t("database.activePlayers7d") }}</span>
                    <strong>{{ stats.playerStats7d?.activePlayers ?? 0 }}</strong>
                  </li>
                  <li>
                    <span>{{ t("database.repeatPlayers7d") }}</span>
                    <strong>{{ stats.playerStats7d?.repeatPlayers ?? 0 }}</strong>
                  </li>
                  <li>
                    <span>{{ t("database.repeatRate7d") }}</span>
                    <strong>{{ formatPercent(stats.playerStats7d?.repeatRate ?? 0) }}</strong>
                  </li>
                  <li>
                    <span>{{ t("database.avgMatchesPerActive7d") }}</span>
                    <strong>{{ formatFloat(stats.playerStats7d?.avgMatchesPerActive ?? 0) }}</strong>
                  </li>
                </ul>
              </div>

              <div class="breakdown-card">
                <h4>{{ t("database.repeatPlayers7dTop") }}</h4>
                <ol class="rank-list">
                  <li v-for="item in stats.leaderboards?.byRepeat7d || []" :key="item.id">
                    <span class="player-name" @click="$emit('jump', item.id)">
                      {{ item.currentName || item.steamID || item.eosID || t("common.unknown") }}
                    </span>
                    <span class="rank-value">{{ item.matchCount }} / {{ item.activeDays }}{{ t("database.days") }}</span>
                  </li>
                </ol>
              </div>
            </div>
          </section>

          <!-- Trends -->
          <section class="analytics-section">
            <h3>{{ t("database.trends") }}</h3>
            <div class="trend-card">
              <h4>{{ t("database.matchesByDay") }}</h4>
              <div class="trend-list">
                <div v-for="item in stats.trends?.matchesByDay" :key="item.day" class="trend-item">
                  <span class="trend-day">{{ item.day }}</span>
                  <div class="trend-bar-wrap">
                    <div class="trend-bar" :style="{ width: `${(item.matchCount / maxMatches) * 100}%` }"></div>
                  </div>
                  <span class="trend-count">{{ item.matchCount }}</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { t } from "../../i18n";

const props = defineProps<{
  open: boolean;
  loading: boolean;
  error: string;
  stats: any;
  days: string;
  top: string;
  subtitle: string;
}>();

defineEmits<{
  (event: "close"): void;
  (event: "refresh"): void;
  (event: "jump", id: number): void;
  (event: "update:days", value: string): void;
  (event: "update:top", value: string): void;
}>();

const maxMatches = computed(() => {
  const counts = props.stats?.trends?.matchesByDay?.map((i: any) => i.matchCount) || [1];
  return Math.max(...counts, 1);
});

const totalPlayers = computed(() => Math.max(0, Number(props.stats?.overview?.totalPlayers ?? 0)));
const completenessRows = computed(() => {
  const total = totalPlayers.value;
  const rows = [
    { label: "Steam", value: Number(props.stats?.dataHealth?.steamBound ?? 0) },
    { label: "EOS", value: Number(props.stats?.dataHealth?.eosBound ?? 0) },
    { label: "QQ", value: Number(props.stats?.dataHealth?.qqBound ?? 0) },
    { label: "IP", value: Number(props.stats?.dataHealth?.ipKnown ?? 0) },
  ];
  return rows.map((row) => ({ ...row, rate: total > 0 ? Math.min(1, row.value / total) : 0 }));
});
const completenessAverage = computed(() => {
  if (!completenessRows.value.length) return 0;
  return completenessRows.value.reduce((sum, row) => sum + row.rate, 0) / completenessRows.value.length;
});

function formatHours(seconds: number) {
  return (seconds / 3600).toFixed(1);
}

function formatPercent(ratio: number) {
  const safe = Number.isFinite(ratio) ? Math.max(0, ratio) : 0;
  return `${(safe * 100).toFixed(1)}%`;
}

function formatFloat(value: number) {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toFixed(2);
}

function formatAssetAmount(value: number) {
  const safe = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: safe % 1 === 0 ? 0 : 2,
  }).format(safe);
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.modal-card {
  width: 100%;
  max-width: 1000px;
  max-height: 90vh;
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border-default);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
}

.modal-header {
  padding: 24px;
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
}

.header-title h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}

.header-title p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--color-text-muted);
}

.modal-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.modal-select {
  padding: 6px 12px;
  background: var(--color-bg-input);
  border: 1px solid var(--color-border-soft);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-size: 13px;
}

.refresh-btn {
  padding: 6px 16px;
  background: var(--color-status-online);
  color: white;
  border: 0;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.close-btn {
  padding: 6px;
  background: transparent;
  border: 0;
  color: var(--color-text-muted);
  font-size: 18px;
  cursor: pointer;
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.analytics-content {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
}

.section-kicker {
  display: block;
  margin-bottom: 4px;
  color: #6cb8f3;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .15em;
  text-transform: uppercase;
}

.insight-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.insight-card {
  padding: 16px;
  border: 1px solid var(--color-border-soft);
  border-radius: 12px;
  background:
    linear-gradient(150deg, rgba(74, 168, 255, .07), transparent 52%),
    rgba(255, 255, 255, .025);
}

.insight-card header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.insight-card header span {
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 700;
}

.insight-card header strong {
  color: #8acaff;
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}

.metric-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px dashed rgba(255, 255, 255, .07);
  color: var(--color-text-secondary);
  font-size: 12px;
}

.metric-row:last-child { border-bottom: 0; }
.metric-row b { color: var(--color-text-primary); font-variant-numeric: tabular-nums; }
.metric-row.muted { color: var(--color-text-muted); }

.health-row { margin-top: 9px; }
.health-row > div:first-child {
  display: flex;
  justify-content: space-between;
  color: var(--color-text-secondary);
  font-size: 10px;
}
.health-row b { color: var(--color-text-muted); font-variant-numeric: tabular-nums; }
.health-track {
  height: 4px;
  margin-top: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, .06);
}
.health-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #4aa8ff, #3fcf8e);
}

.analytics-section h3 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.leaderboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
}

.leaderboard-card, .breakdown-card {
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-soft);
  border-radius: 12px;
}

.leaderboard-card h4, .breakdown-card h4 {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.rank-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rank-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 8px;
  font-size: 14px;
}

.player-name {
  color: var(--color-text-primary);
  cursor: pointer;
}

.player-name:hover {
  text-decoration: underline;
  color: var(--color-status-online);
}

.rank-value {
  font-weight: 700;
  color: var(--color-text-secondary);
}

.chip-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.stat-chip {
  display: flex;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 999px;
  font-size: 13px;
}

.chip-count {
  font-weight: 700;
  color: var(--color-status-online);
}

.modal-placeholder {
  padding: 48px;
  text-align: center;
  color: var(--color-text-muted);
}

.breakdown-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.trend-card {
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-soft);
  border-radius: 12px;
}

.trend-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.trend-item {
  display: grid;
  grid-template-columns: 100px 1fr 40px;
  align-items: center;
  gap: 12px;
}

.trend-day {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.trend-bar-wrap {
  height: 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  overflow: hidden;
}

.trend-bar {
  height: 100%;
  background: var(--color-status-online);
  border-radius: inherit;
  transition: width 0.3s ease;
}

.trend-count {
  font-size: 13px;
  font-weight: 700;
  text-align: right;
  color: var(--color-text-primary);
}

.metric-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.metric-list li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  padding: 8px 0;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.08);
}

.metric-list li:last-child {
  border-bottom: 0;
}

.metric-list strong {
  color: var(--color-text-primary);
}

@media (max-width: 820px) {
  .modal-overlay { padding: 8px; }
  .modal-card { max-height: 90vh; border-radius: 12px; }
  .modal-header { padding: 15px; display: block; }
  .modal-actions { margin-top: 12px; flex-wrap: wrap; }
  .modal-body { padding: 15px; }
  .insight-grid { grid-template-columns: 1fr; }
  .leaderboard-grid, .breakdown-grid { grid-template-columns: 1fr; }
}
</style>
