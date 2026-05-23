<template>
  <div v-if="open" class="modal-overlay" @click.self="$emit('close')">
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

function formatHours(seconds: number) {
  return (seconds / 3600).toFixed(1);
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
</style>
