<template>
  <div class="db-detail">
    <div v-if="!id" class="detail-placeholder">
      <div class="placeholder-icon">👤</div>
      <p>{{ t("database.selectPlayer") }}</p>
    </div>
    <div v-else-if="loading && !detail" class="detail-placeholder">
      <p>{{ t("database.loadingDetail") }}</p>
    </div>
    <div v-else-if="error" class="detail-placeholder error">
      <p>{{ error }}</p>
      <button type="button" @click="$emit('retry')">{{ t("database.retry") }}</button>
    </div>
    <template v-else-if="detail">
      <header class="detail-header">
        <div class="header-main">
          <h1>{{ detail.player?.current_name || detail.player?.name || t("player.player") }}</h1>
          <div class="header-meta">
            <span>Steam64: {{ detail.player?.steam_id || "--" }}</span>
            <span class="separator">·</span>
            <span>EOS: {{ detail.player?.eos_id || "--" }}</span>
          </div>
        </div>
        <button type="button" class="close-btn" @click="$emit('close')">{{ t("database.closeDetail") }}</button>
      </header>

      <div class="detail-content">
        <div class="detail-cards">
          <!-- Overview Card -->
          <div class="detail-card">
            <h3>{{ t("database.overview") }}</h3>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">{{ t("database.permissionGroup") }}</span>
                <strong class="info-value">{{ detail.player?.permission_group || "default" }}</strong>
              </div>
              <div class="info-item">
                <span class="info-label">{{ t("database.gameTime") }}</span>
                <strong class="info-value">{{ formatSeconds(detail.summary?.gameSeconds ?? detail.player?.game_seconds ?? 0) }}</strong>
              </div>
              <div class="info-item">
                <span class="info-label">Steam 原始时长</span>
                <strong class="info-value">{{ formatSeconds(detail.summary?.steamGameSeconds ?? detail.player?.steam_game_seconds ?? 0) }}</strong>
              </div>
              <div class="info-item">
                <span class="info-label">覆盖时长</span>
                <strong class="info-value">
                  {{ detail.summary?.gameSecondsOverride == null ? "未覆盖" : formatSeconds(detail.summary.gameSecondsOverride) }}
                </strong>
              </div>
              <div class="info-item">
                <span class="info-label">{{ t("database.serverTime") }}</span>
                <strong class="info-value">{{ formatSeconds(detail.summary?.serverSeconds ?? detail.player?.server_seconds ?? 0) }}</strong>
              </div>
              <div class="info-item">
                <span class="info-label">暖服时长</span>
                <strong class="info-value">{{ formatSeconds(detail.player?.warmup_seconds ?? detail.player?.warmupSeconds ?? 0) }}</strong>
              </div>
              <div class="info-item">
                <span class="info-label">暖服分</span>
                <strong class="info-value">{{ formatAssetAmount(detail.player?.warmupPoints ?? detail.player?.assets?.warmupPoints ?? 0) }}</strong>
              </div>
              <div class="info-item">
                <span class="info-label">{{ t("database.updatedAt") }}</span>
                <strong class="info-value">{{ formatTime(detail.player?.updated_at) }}</strong>
              </div>
              <div class="info-item">
                <span class="info-label">当前 IP</span>
                <strong class="info-value">{{ detail.player?.current_ip || "--" }}</strong>
              </div>
            </div>
          </div>

          <!-- IP History Card -->
          <div class="detail-card">
            <h3>{{ t("database.ipHistory") }}</h3>
            <div class="ip-list">
              <div v-for="item in detail.ips || []" :key="item.ip" class="ip-item">
                <div class="ip-main">
                  <span class="ip-address" @click="copyIp(item.ip)">{{ item.ip }}</span>
                  <span class="ip-time">{{ formatTime(item.seen_at) }}</span>
                </div>
              </div>
              <p v-if="!(detail.ips || []).length" class="empty-hint">{{ t("common.none") }}</p>
            </div>
          </div>

          <!-- Alias History Card -->
          <div class="detail-card">
            <h3>{{ t("database.aliases") }}</h3>
            <div class="alias-list">
              <div v-for="alias in detail.aliases || []" :key="alias.alias_name" class="alias-item">
                <span class="alias-name">{{ alias.alias_name }}</span>
                <span class="alias-time">{{ formatTime(alias.seen_at) }}</span>
              </div>
              <p v-if="!(detail.aliases || []).length" class="empty-hint">{{ t("common.none") }}</p>
            </div>
          </div>

          <div class="detail-card detail-card-wide">
            <h3>进退服记录</h3>
            <div class="timeline-list">
              <div v-for="item in detail.sessionHistory || []" :key="item.id" class="timeline-item">
                <div class="timeline-main">
                  <strong>{{ formatSessionLine(item) }}</strong>
                  <small v-if="item.duration_seconds != null">{{ formatDuration(item.duration_seconds) }}</small>
                </div>
                <span class="timeline-time">{{ formatTime(item.joined_at) }}</span>
              </div>
              <p v-if="!(detail.sessionHistory || []).length" class="empty-hint">{{ t("common.none") }}</p>
            </div>
          </div>

          <!-- Combat Sessions Card -->
          <div class="detail-card">
            <h3>{{ t("database.combatSessions") }}</h3>
            <div class="session-list">
              <div v-for="log in (detail.combatSessions || []).slice(0, 20)" :key="log.id" class="session-item">
                <div class="session-main">
                  <strong>{{ log.filePath || "--" }}</strong>
                  <small>{{ log.dateKey || "--" }}</small>
                </div>
                <span class="session-time">{{ formatTime(log.firstEventAt) }}</span>
              </div>
              <p v-if="!(detail.combatSessions || []).length" class="empty-hint">{{ t("common.none") }}</p>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { currentLocale, t } from "../../i18n";
import { useUiStore } from "../../stores/ui.store";
import { copyTextWithToast } from "../../utils/clipboard";
import { normalizeIp } from "../../utils/ip";

const props = defineProps<{
  id: number | null;
  detail: any | null;
  loading: boolean;
  error: string;
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "retry"): void;
}>();

const ui = useUiStore();

function formatTime(value: unknown) {
  const time = Number(value ?? 0);
  if (!time) return "--";
  return new Date(time).toLocaleString(currentLocale.value);
}

function formatSeconds(value: unknown) {
  const totalSeconds = Math.max(0, Math.floor(Number(value ?? 0)));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m (${totalSeconds}s)`;
}

function formatAssetAmount(value: unknown) {
  const amount = Math.max(0, Number(value ?? 0));
  if (!Number.isFinite(amount)) return "0";
  return new Intl.NumberFormat(currentLocale.value, {
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

function formatDuration(value: unknown) {
  const totalSeconds = Math.max(0, Math.floor(Number(value ?? 0)));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatSessionLine(item: any) {
  const joined = formatTime(item?.joined_at);
  const left = item?.left_at ? formatTime(item.left_at) : "";
  if (left) return `${joined} 加入，${left} 离开`;
  return `${joined} 加入了游戏`;
}

async function copyIp(ip: string) {
  await copyTextWithToast(ip, ui, {
    label: "IP",
    successMessage: `已复制 IP：${ip}`,
  });
}
</script>

<style scoped>
.db-detail {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  overflow: hidden;
}

.detail-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--color-text-muted);
}

.placeholder-icon {
  font-size: 48px;
  opacity: 0.2;
}

.detail-header {
  padding: 20px 24px;
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  background: rgba(255, 255, 255, 0.02);
}

.header-main h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.header-meta {
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text-muted);
}

.separator {
  opacity: 0.3;
}

.close-btn {
  padding: 6px 12px;
  background: var(--color-bg-hover);
  border: 1px solid var(--color-border-soft);
  border-radius: 6px;
  color: var(--color-text-primary);
  font-size: 12px;
  cursor: pointer;
}

.detail-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.detail-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
}

.detail-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--color-border-soft);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-card-wide {
  grid-column: 1 / -1;
}

.detail-card h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.info-grid {
  display: grid;
  gap: 12px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.info-label {
  font-size: 11px;
  color: var(--color-text-muted);
}

.info-value {
  font-size: 14px;
  color: var(--color-text-primary);
}

.ip-list, .alias-list {
  display: grid;
  gap: 8px;
}

.ip-item, .alias-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 6px;
  font-size: 13px;
}

.ip-address, .alias-name {
  color: var(--color-text-primary);
  font-family: monospace;
}

.ip-address {
  cursor: pointer;
}

.ip-address:hover {
  text-decoration: underline;
  color: var(--color-status-online);
}

.ip-time, .alias-time {
  font-size: 11px;
  color: var(--color-text-muted);
}

.empty-hint {
  font-size: 13px;
  color: var(--color-text-muted);
  text-align: center;
  margin: 12px 0;
}

.session-list {
  display: grid;
  gap: 8px;
}

.timeline-list {
  display: grid;
  gap: 8px;
}

.timeline-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 8px;
}

.timeline-main {
  display: grid;
  gap: 4px;
}

.timeline-main strong {
  color: var(--color-text-primary);
  font-size: 13px;
}

.timeline-main small,
.timeline-time {
  color: var(--color-text-muted);
  font-size: 11px;
}

.session-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 6px;
  font-size: 12px;
}

.session-main {
  display: flex;
  flex-direction: column;
}

.session-main strong {
  color: var(--color-text-primary);
}

.session-main small {
  color: var(--color-text-muted);
}

.session-time {
  color: var(--color-text-muted);
}
</style>
