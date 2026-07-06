<template>
  <section class="warmup-grant-page">
    <header class="page-header">
      <div>
        <h1>暖服赠送预留位</h1>
        <p>系统按符合条件的小队成员暖服时长自动续费预留位。</p>
      </div>
      <div class="header-actions">
        <button type="button" class="btn" :disabled="loading" @click="refreshState">
          {{ loading ? "刷新中..." : "刷新" }}
        </button>
        <button type="button" class="btn primary" :disabled="saving" @click="saveSettings">
          {{ saving ? "保存中..." : "保存设置" }}
        </button>
      </div>
    </header>

    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-else-if="notice" class="banner">{{ notice }}</div>

    <section class="summary-grid">
      <article class="summary-item" :class="{ good: !settings.requireWarmupMode || conditions.isWarmup, bad: settings.requireWarmupMode && !conditions.isWarmup }">
        <span>暖服模式</span>
        <strong>{{ conditions.isWarmup ? "开启" : "关闭" }}</strong>
      </article>
      <article class="summary-item" :class="{ good: conditions.belowPlayerLimit, bad: !conditions.belowPlayerLimit }">
        <span>当前人数</span>
        <strong>{{ conditions.playerCount }} / {{ settings.maxEligiblePlayers }}</strong>
      </article>
      <article class="summary-item" :class="{ good: conditions.matchedTimeWindow, bad: !conditions.matchedTimeWindow }">
        <span>有效时间区间</span>
        <strong>{{ conditions.matchedTimeWindow ? "命中" : "未命中" }}</strong>
      </article>
      <article class="summary-item">
        <span>正在累计的小队成员</span>
        <strong>{{ state?.status.accumulatingCount ?? 0 }}</strong>
      </article>
      <article class="summary-item">
        <span>今日已赠送</span>
        <strong>{{ state?.status.todayGrantCount ?? 0 }}</strong>
      </article>
    </section>

    <div class="layout-grid">
      <section class="panel settings-panel">
        <div class="panel-head">
          <h2>规则设置</h2>
          <span>{{ settings.enabled ? "已启用" : "已停用" }}</span>
        </div>

        <div class="form-grid">
          <label class="check-row wide">
            <input v-model="settings.enabled" type="checkbox">
            <span>启用暖服自动赠送</span>
          </label>
          <label class="field">
            <span>每多少分钟赠送</span>
            <input v-model.number="settings.grantEveryMinutes" type="number" min="1" step="1">
          </label>
          <label class="field">
            <span>赠送天数</span>
            <input v-model.number="settings.grantDays" type="number" min="1" step="1">
          </label>
          <label class="field">
            <span>提醒间隔分钟</span>
            <input v-model.number="settings.reminderEveryMinutes" type="number" min="1" step="1">
          </label>
          <label class="field">
            <span>人数上限</span>
            <input v-model.number="settings.maxEligiblePlayers" type="number" min="1" step="1">
          </label>
          <label class="field">
            <span>预留位组</span>
            <input v-model.trim="settings.group" type="text" maxlength="64">
          </label>
          <label class="check-row">
            <input v-model="settings.requireWarmupMode" type="checkbox">
            <span>要求暖服模式</span>
          </label>
          <label class="check-row">
            <input v-model="settings.requireSquad" type="checkbox">
            <span>必须在小队内</span>
          </label>
          <label class="check-row">
            <input v-model="settings.requireUnlockedSquad" type="checkbox">
            <span>小队不得锁定</span>
          </label>
        </div>

        <div class="window-head">
          <h3>时间区间</h3>
          <button type="button" class="mini-btn" @click="addWindow">新增</button>
        </div>
        <div class="window-list">
          <div v-for="(window, index) in settings.timeWindows" :key="index" class="window-row">
            <label class="check-row compact">
              <input v-model="window.enabled" type="checkbox">
              <span>启用</span>
            </label>
            <input v-model="window.start" type="time">
            <span class="dash">至</span>
            <input v-model="window.end" type="time">
            <button type="button" class="mini-btn danger" :disabled="settings.timeWindows.length <= 1" @click="removeWindow(index)">删除</button>
          </div>
        </div>
      </section>

      <section class="panel manual-panel">
        <div class="panel-head">
          <h2>记录管理</h2>
          <span>{{ state?.records.length ?? 0 }} 条</span>
        </div>

        <form class="manual-form" @submit.prevent="grantNow">
          <label class="field">
            <span>Steam64</span>
            <input v-model.trim="manualForm.steamId" type="text" placeholder="7656119...">
          </label>
          <label class="field">
            <span>玩家名</span>
            <input v-model.trim="manualForm.name" type="text">
          </label>
          <label class="field">
            <span>发放天数</span>
            <input v-model.number="manualForm.durationDays" type="number" min="1" step="1">
          </label>
          <button type="submit" class="btn primary" :disabled="granting || !manualForm.steamId">
            {{ granting ? "发放中..." : `立即发放 ${manualForm.durationDays || 1} 天` }}
          </button>
        </form>

        <div class="danger-actions">
          <button type="button" class="btn danger" :disabled="clearing" @click="clearRecords">清空历史记录</button>
          <button type="button" class="btn danger" :disabled="clearing" @click="clearProgress">清空累计进度</button>
        </div>
      </section>
    </div>

    <section class="panel">
      <div class="panel-head">
        <h2>玩家进度</h2>
        <input v-model.trim="searchText" class="search-input" type="search" placeholder="搜索 Steam64 / 玩家名">
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>玩家名</th>
              <th>Steam64</th>
              <th>当前累计</th>
              <th>还差</th>
              <th>上次提醒</th>
              <th>上次赠送</th>
              <th>已赠送天数</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && !state">
              <td colspan="8" class="empty-cell">加载中...</td>
            </tr>
            <tr v-else-if="!filteredProgress.length">
              <td colspan="8" class="empty-cell">暂无玩家进度。</td>
            </tr>
            <tr v-for="record in filteredProgress" :key="record.steamId">
              <td>{{ record.name || "-" }}</td>
              <td class="mono">{{ record.steamId }}</td>
              <td>{{ minutes(record.eligibleSeconds) }} 分钟</td>
              <td>{{ remainingMinutes(record.eligibleSeconds) }} 分钟</td>
              <td>{{ formatTime(record.lastReminderAt) }}</td>
              <td>{{ formatTime(record.lastGrantedAt) }}</td>
              <td>{{ record.totalGrantedDays }}</td>
              <td><span class="status-pill" :class="record.status">{{ statusLabel(record.status, record.pauseReason) }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>发放与提示记录</h2>
        <span>{{ state?.paths.grantsFilePath ?? "" }}</span>
      </div>
      <div class="record-list">
        <article v-for="record in records" :key="`${record.type}-${record.createdAt}-${record.steamId}`" class="record-row">
          <div>
            <strong>{{ recordTypeLabel(record.type) }}</strong>
            <span>{{ record.name || "-" }} / {{ record.steamId || "-" }}</span>
          </div>
          <p>{{ recordText(record) }}</p>
          <time>{{ formatTime(record.createdAt) }}</time>
        </article>
        <div v-if="loading && !state" class="empty-cell">加载中...</div>
        <div v-else-if="!records.length" class="empty-cell">暂无记录。</div>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import {
  clearWarmupReserveGrantProgress,
  clearWarmupReserveGrantRecords,
  fetchWarmupReserveGrantState,
  grantWarmupReserveNow,
  updateWarmupReserveGrantSettings,
  type WarmupReserveGrantSettings,
  type WarmupReserveGrantState,
  type WarmupReserveGrantRecord,
} from "../app/warmupReserveGrantApi";

const state = ref<WarmupReserveGrantState | null>(null);
const loading = ref(false);
const saving = ref(false);
const clearing = ref(false);
const granting = ref(false);
const error = ref("");
const notice = ref("");
const searchText = ref("");
let pollTimer: number | null = null;

const settings = reactive<WarmupReserveGrantSettings>({
  enabled: true,
  grantEveryMinutes: 120,
  grantDays: 1,
  reminderEveryMinutes: 5,
  maxEligiblePlayers: 50,
  requireWarmupMode: true,
  requireSquad: true,
  requireUnlockedSquad: true,
  group: "BZSSVIP",
  countMode: "accumulate_eligible_squad_member_time",
  timeWindows: [{ enabled: true, start: "00:00", end: "23:59" }],
  clearOfflineAfterHours: 24,
  maxRecentRecords: 500,
});

const manualForm = reactive({
  steamId: "",
  name: "",
  durationDays: 1,
});

const conditions = computed(() => state.value?.status.conditions ?? {
  eligible: false,
  isWarmup: false,
  playerCount: 0,
  maxEligiblePlayers: settings.maxEligiblePlayers,
  belowPlayerLimit: false,
  matchedTimeWindow: false,
  pauseReason: "loading",
  checkedAt: "",
});

const filteredProgress = computed(() => {
  const query = searchText.value.toLowerCase();
  const rows = state.value?.progress ?? [];
  if (!query) return rows;
  return rows.filter((record) => `${record.name} ${record.steamId}`.toLowerCase().includes(query));
});

const records = computed(() => state.value?.records.slice(0, settings.maxRecentRecords) ?? []);

onMounted(() => {
  void loadState();
  pollTimer = window.setInterval(() => void loadState({ silent: true }), 10_000);
});

onUnmounted(() => {
  if (pollTimer) window.clearInterval(pollTimer);
});

async function loadState(options: { silent?: boolean } = {}) {
  if (!options.silent) {
    loading.value = true;
    error.value = "";
    notice.value = "";
  }
  try {
    const next = await fetchWarmupReserveGrantState();
    state.value = next;
    applySettings(next.config);
  } catch (err: any) {
    error.value = err?.message ?? "加载暖服赠送预留位状态失败。";
  } finally {
    loading.value = false;
  }
}

function refreshState() {
  void loadState();
}

let noticeTimer: number | null = null;

function showNotice(msg: string) {
  notice.value = msg;
  if (noticeTimer) {
    window.clearTimeout(noticeTimer);
  }
  noticeTimer = window.setTimeout(() => {
    if (notice.value === msg) {
      notice.value = "";
    }
  }, 5000);
}

async function saveSettings() {
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    const next = await updateWarmupReserveGrantSettings(settings);
    state.value = next;
    applySettings(next.config);
    showNotice(next.message ?? "设置已保存。");
  } catch (err: any) {
    error.value = err?.message ?? "保存设置失败。";
  } finally {
    saving.value = false;
  }
}

async function grantNow() {
  granting.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await grantWarmupReserveNow({ ...manualForm });
    state.value = result.state;
    showNotice(result.message ?? "已手动发放。");
    manualForm.steamId = "";
    manualForm.name = "";
  } catch (err: any) {
    error.value = err?.message ?? "手动发放失败。";
  } finally {
    granting.value = false;
  }
}

async function clearRecords() {
  if (!window.confirm("确认清空本模块历史记录？已经写入的预留位名单不会删除。")) return;
  clearing.value = true;
  error.value = "";
  notice.value = "";
  try {
    state.value = await clearWarmupReserveGrantRecords();
    showNotice("历史记录已清空。");
  } catch (err: any) {
    error.value = err?.message ?? "清空历史记录失败。";
  } finally {
    clearing.value = false;
  }
}

async function clearProgress() {
  if (!window.confirm("确认清空玩家当前累计进度？已经写入的预留位名单不会删除。")) return;
  clearing.value = true;
  error.value = "";
  notice.value = "";
  try {
    state.value = await clearWarmupReserveGrantProgress();
    showNotice("累计进度已清空。");
  } catch (err: any) {
    error.value = err?.message ?? "清空累计进度失败。";
  } finally {
    clearing.value = false;
  }
}

function applySettings(next: WarmupReserveGrantSettings) {
  Object.assign(settings, {
    ...next,
    timeWindows: next.timeWindows?.map((item) => ({ ...item })) ?? [{ enabled: true, start: "00:00", end: "23:59" }],
  });
  manualForm.durationDays = next.grantDays;
}

function addWindow() {
  settings.timeWindows.push({ enabled: true, start: "00:00", end: "23:59" });
}

function removeWindow(index: number) {
  settings.timeWindows.splice(index, 1);
}

function minutes(seconds: number) {
  return Math.floor((Number(seconds) || 0) / 60);
}

function remainingMinutes(seconds: number) {
  const remaining = Math.max(0, settings.grantEveryMinutes * 60 - (Number(seconds) || 0));
  return Math.ceil(remaining / 60);
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function statusLabel(status: string, pauseReason?: string | null) {
  if (status === 'active') return 'Accumulating';
  if (status === 'granted') return 'Granted';
  if (status === 'offline') return 'Offline';
  if (pauseReason === 'not_warmup') return 'Paused: not warmup';
  if (pauseReason === 'not_in_squad') return 'Paused: not in squad';
  if (pauseReason === 'squad_locked') return 'Paused: squad locked';
  if (pauseReason === 'player_limit') return 'Paused: player limit';
  if (pauseReason === 'time_window') return 'Paused: time window';
  if (pauseReason === 'disabled') return 'Paused: disabled';
  return 'Paused';
}

function recordTypeLabel(type: string) {
  if (type === 'grant') return 'Grant';
  if (type === 'grant_failed') return 'Grant failed';
  if (type === 'reminder') return 'Reminder';
  if (type === 'invalid_reminder') return 'Invalid reminder';
  if (type === 'pause') return 'Pause';
  if (type === 'offline') return 'Offline';
  return type;
}

function recordText(record: WarmupReserveGrantRecord) {
  if (record.type === 'grant') return 'Granted ' + (record.grantedDays ?? 1) + ' day(s), expire at ' + (record.expireAt ?? '-');
  if (record.type === 'grant_failed') return record.error ?? 'Grant failed';
  if (record.type === 'reminder') return 'Accumulated ' + minutes(record.eligibleSeconds ?? 0) + ' minutes, reminder ' + (record.result ?? '-');
  if (record.type === 'invalid_reminder') return 'Paused: ' + (record.pauseReason ?? '-');
  if (record.type === 'pause') return statusLabel('paused', record.pauseReason);
  if (record.type === 'offline') return 'Offline after accumulating ' + minutes(record.eligibleSeconds ?? 0) + ' minutes';
  return JSON.stringify(record);
}
</script>

<style scoped>
.warmup-grant-page {
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
  padding: clamp(14px, 2vw, 24px);
  color: var(--color-text-primary);
  background: var(--app-background, var(--color-bg-page));
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

/* Header */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}

.page-header h1 {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
  text-shadow: 0 0 12px rgba(55, 200, 255, 0.15);
}

.page-header p {
  margin: 6px 0 0;
  color: var(--color-text-muted);
  font-size: 14px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Banners */
.banner {
  margin-bottom: 20px;
  padding: 12px 16px;
  border: 1px solid var(--color-border-highlight);
  border-radius: var(--control-radius, 10px);
  background: var(--color-bg-selected);
  color: var(--color-text-primary);
  font-size: 14px;
  animation: slideDown 0.3s ease;
}

.banner.error {
  border-color: rgba(248, 113, 113, 0.4);
  background: rgba(248, 113, 113, 0.1);
  color: var(--color-status-danger);
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Buttons */
.btn,
.mini-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  border-radius: var(--control-radius, 10px);
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.btn {
  min-height: 38px;
  padding: 0 16px;
  font-weight: 600;
}

.mini-btn {
  min-height: 28px;
  padding: 0 10px;
  font-size: 12px;
  border-radius: 6px;
}

.btn:hover:not(:disabled),
.mini-btn:hover:not(:disabled) {
  border-color: var(--color-border-highlight);
  background: var(--color-bg-hover);
  transform: translateY(-1px);
}

.btn:active:not(:disabled),
.mini-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.btn.primary {
  border: none;
  background: linear-gradient(135deg, var(--color-brand-primary) 0%, #00b0ff 100%);
  color: #06090f;
  box-shadow: 0 4px 12px rgba(55, 200, 255, 0.25);
}

.btn.primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #5ed8ff 0%, #33c3ff 100%);
  box-shadow: 0 6px 16px rgba(55, 200, 255, 0.35);
}

.btn.danger,
.mini-btn.danger {
  border-color: rgba(248, 113, 113, 0.3);
  background: rgba(248, 113, 113, 0.05);
  color: var(--color-status-danger);
}

.btn.danger:hover:not(:disabled),
.mini-btn.danger:hover:not(:disabled) {
  border-color: var(--color-status-danger);
  background: rgba(248, 113, 113, 0.12);
}

.btn:disabled,
.mini-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
  transform: none !important;
  box-shadow: none !important;
}

/* Summary Grid */
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.summary-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 20px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.02) 0%, rgba(255, 255, 255, 0.005) 100%), var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: var(--card-radius, 14px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  transition: all 0.3s ease;
}

.summary-item span {
  color: var(--color-text-muted);
  font-size: 13px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.summary-item strong {
  font-size: 26px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.summary-item.good {
  border-color: rgba(52, 211, 153, 0.35);
  background: linear-gradient(180deg, rgba(52, 211, 153, 0.04) 0%, transparent 100%), var(--color-bg-card);
  box-shadow: 0 4px 20px rgba(52, 211, 153, 0.05);
}

.summary-item.good strong {
  color: var(--color-status-success);
  text-shadow: 0 0 10px rgba(52, 211, 153, 0.2);
}

.summary-item.bad {
  border-color: rgba(248, 113, 113, 0.35);
  background: linear-gradient(180deg, rgba(248, 113, 113, 0.04) 0%, transparent 100%), var(--color-bg-card);
  box-shadow: 0 4px 20px rgba(248, 113, 113, 0.05);
}

.summary-item.bad strong {
  color: var(--color-status-danger);
  text-shadow: 0 0 10px rgba(248, 113, 113, 0.2);
}

/* Layout Grid */
.layout-grid {
  display: grid;
  grid-template-columns: minmax(0, 2.2fr) minmax(320px, 1fr);
  gap: 20px;
  margin-bottom: 24px;
}

.panel {
  padding: 20px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.015) 0%, rgba(255, 255, 255, 0.005) 100%), var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: var(--card-radius, 14px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(12px);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--color-border-soft);
  padding-bottom: 12px;
}

.panel-head h2 {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.panel-head span {
  color: var(--color-text-muted);
  font-size: 13px;
  background: rgba(255, 255, 255, 0.04);
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border-soft);
}

/* Form Layout */
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.field span {
  font-weight: 500;
  color: var(--color-text-secondary);
}

.check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}

.check-row.wide {
  grid-column: 1 / -1;
  border-bottom: 1px solid var(--color-border-soft);
  padding-bottom: 12px;
  margin-bottom: 4px;
}

.check-row.compact {
  min-width: 72px;
}

/* Inputs & Form Controls */
input[type="text"],
input[type="number"],
input[type="time"],
input[type="search"],
select {
  width: 100%;
  min-height: 38px;
  box-sizing: border-box;
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  padding: 0 12px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: 14px;
  transition: all 0.2s ease;
}

input:focus,
select:focus {
  border-color: var(--color-brand-primary);
  box-shadow: 0 0 0 3px rgba(55, 200, 255, 0.2);
  outline: none;
}

input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: var(--color-brand-primary);
  cursor: pointer;
}

/* Time Window Controls */
.window-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 24px;
  margin-bottom: 14px;
}

.window-head h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.window-list {
  display: grid;
  gap: 10px;
  background: rgba(0, 0, 0, 0.15);
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--color-border-soft);
}

.window-row {
  display: grid;
  grid-template-columns: 80px 1fr 24px 1fr auto;
  align-items: center;
  gap: 8px;
}

.dash {
  text-align: center;
  color: var(--color-text-muted);
  font-weight: bold;
}

/* Manual Form */
.manual-form {
  display: grid;
  gap: 16px;
}

.danger-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
  border-top: 1px solid var(--color-border-soft);
  padding-top: 20px;
}

/* Search bar */
.search-input {
  width: min(300px, 100%);
}

/* Tables */
.table-wrap {
  max-height: 480px;
  overflow: auto;
  border-radius: 10px;
  border: 1px solid var(--color-border-default);
  background: rgba(0, 0, 0, 0.15);
}

table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

th,
td {
  padding: 12px 16px;
  white-space: nowrap;
}

th {
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--color-border-default);
}

td {
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border-soft);
  font-size: 14px;
}

tr:last-child td {
  border-bottom: none;
}

tr:hover td {
  background: rgba(255, 255, 255, 0.015);
  color: var(--color-text-primary);
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  color: var(--color-text-primary);
  opacity: 0.95;
}

.empty-cell {
  padding: 32px;
  color: var(--color-text-muted);
  text-align: center;
  font-size: 14px;
}

/* Status Pills */
.status-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-muted);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.status-pill.active {
  background: rgba(52, 211, 153, 0.12);
  color: var(--color-status-success);
  border-color: rgba(52, 211, 153, 0.25);
}

.status-pill.paused {
  background: rgba(245, 158, 11, 0.12);
  color: var(--color-status-warning);
  border-color: rgba(245, 158, 11, 0.25);
}

.status-pill.granted {
  background: rgba(96, 165, 250, 0.12);
  color: var(--color-status-info);
  border-color: rgba(96, 165, 250, 0.25);
}

.status-pill.offline {
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-disabled);
  border-color: rgba(255, 255, 255, 0.05);
}

/* Records List */
.record-list {
  display: grid;
  gap: 10px;
  max-height: 480px;
  overflow-y: auto;
  padding-right: 4px;
}

.record-row {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(220px, 2fr) auto;
  gap: 16px;
  align-items: center;
  padding: 12px;
  background: rgba(255, 255, 255, 0.01);
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  transition: all 0.2s ease;
}

.record-row:hover {
  background: rgba(255, 255, 255, 0.02);
  border-color: var(--color-border-default);
}

.record-row strong {
  display: block;
  font-size: 14px;
  color: var(--color-text-primary);
  margin-bottom: 2px;
}

.record-row span {
  display: block;
  font-size: 12px;
  color: var(--color-text-muted);
}

.record-row p {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.record-row time {
  font-size: 12px;
  color: var(--color-text-muted);
  white-space: nowrap;
}

/* Responsive Queries */
@media (max-width: 1100px) {
  .summary-grid {
    grid-template-columns: repeat(3, 1fr);
  }
  
  .layout-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .warmup-grant-page {
    padding: 12px;
  }

  .page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .header-actions {
    width: 100%;
    justify-content: flex-end;
  }

  .summary-grid {
    grid-template-columns: 1fr 1fr;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .record-row {
    grid-template-columns: 1fr;
    gap: 8px;
    align-items: flex-start;
  }
  
  .record-row time {
    align-self: flex-end;
  }

  .window-row {
    grid-template-columns: 1fr 1fr;
  }

  .dash {
    display: none;
  }
}
</style>
