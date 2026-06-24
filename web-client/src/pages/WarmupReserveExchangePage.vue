<template>
  <section class="bz-page warmup-reserve-page">
    <header class="hero">
      <div>
        <p class="eyebrow">WarmupReserveExchangePlugin</p>
        <h1>暖服自动兑换预留位</h1>
        <p class="subtle">
          当前状态：<strong>{{ gateLabel }}</strong>，{{ gateReasonLabel }}。
        </p>
      </div>
      <div class="actions">
        <button type="button" @click="refresh">刷新</button>
        <button type="button" @click="tick">立即 tick</button>
        <button type="button" class="danger" @click="resetProgress">清空未兑换进度</button>
        <button type="button" class="danger" @click="resetAll">清空全部统计</button>
      </div>
    </header>

    <div class="grid">
      <article class="card">
        <h2>状态</h2>
        <ul>
          <li>玩家数：{{ state?.gate.playerCount ?? 0 }}</li>
          <li>累计阈值：{{ formatSeconds(state?.settings.requiredSeconds ?? 3600) }}</li>
          <li>提醒间隔：{{ formatSeconds(state?.settings.notifyIntervalSeconds ?? 60) }}</li>
          <li>兑换天数：{{ state?.settings.rewardReserveDays ?? 1 }} 天</li>
          <li>tick 间隔：{{ state?.settings.tickIntervalSeconds ?? 30 }} 秒</li>
        </ul>
      </article>

      <article class="card">
        <h2>最近兑换</h2>
        <ul class="compact-list">
          <li v-for="reward in rewards" :key="reward.id">
            <strong>{{ reward.playerName || reward.steamId }}</strong>
            <span>{{ formatDays(reward.rewardDays) }} / {{ formatDateTime(reward.createdAt) }}</span>
          </li>
        </ul>
      </article>
    </div>

    <section class="card">
      <h2>玩家进度</h2>
      <table>
        <thead>
          <tr>
            <th>玩家</th>
            <th>SteamID</th>
            <th>已暖服</th>
            <th>剩余</th>
            <th>最近在线</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in progress" :key="item.steamId">
            <td>{{ item.playerName || "未命名" }}</td>
            <td>{{ item.steamId }}</td>
            <td>{{ formatSeconds(item.totalSeconds) }}</td>
            <td>{{ formatSeconds(Math.max(0, requiredSeconds - item.totalSeconds)) }}</td>
            <td>{{ formatDateTime(item.lastSeenAt) }}</td>
          </tr>
          <tr v-if="!progress.length">
            <td colspan="5" class="empty">暂无记录</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  fetchWarmupReserveExchangeState,
  resetLegacyWarmupPoints,
  resetWarmupReserveAll,
  resetWarmupReserveProgress,
  tickWarmupReserveExchange,
  type WarmupReserveExchangeState,
  type WarmupReserveProgressItem,
  type WarmupReserveRewardItem,
} from "../app/warmupReserveExchangeApi";

const state = ref<WarmupReserveExchangeState | null>(null);
const progress = ref<WarmupReserveProgressItem[]>([]);
const rewards = ref<WarmupReserveRewardItem[]>([]);

const requiredSeconds = computed(() => state.value?.settings.requiredSeconds ?? 3600);
const gateLabel = computed(() => (state.value?.gate.active ? "已纳入暖服模式" : "未纳入暖服模式"));
const gateReasonLabel = computed(() => state.value?.gate.reason || "unknown");

async function refresh() {
  const response = await fetchWarmupReserveExchangeState();
  state.value = response.data;
  progress.value = response.data.progress ?? [];
  rewards.value = response.data.rewards ?? [];
}

async function tick() {
  await tickWarmupReserveExchange();
  await refresh();
}

async function resetProgress() {
  await resetWarmupReserveProgress();
  await refresh();
}

async function resetAll() {
  if (!window.confirm("确认清空全部暖服统计？")) return;
  await resetWarmupReserveAll();
  await refresh();
}

async function resetLegacyPoints() {
  await resetLegacyWarmupPoints();
  await refresh();
}

function formatSeconds(seconds: number) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(value / 60);
  const remain = value % 60;
  return `${minutes} 分 ${remain} 秒`;
}

function formatDays(days: number) {
  return `${Math.max(0, Math.floor(Number(days) || 0))} 天`;
}

function formatDateTime(value: number | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "--";
}

onMounted(() => {
  void refresh();
});
</script>

<style scoped>
.warmup-reserve-page {
  display: grid;
  gap: 16px;
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: 20px;
  background:
    radial-gradient(circle at top left, rgba(255, 182, 72, 0.16), transparent 32%),
    linear-gradient(180deg, #0f172a 0%, #111827 100%);
  color: #e5e7eb;
}

.hero,
.card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 18px;
  background: rgba(15, 23, 42, 0.8);
  backdrop-filter: blur(12px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
}

.hero {
  padding: 20px;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.eyebrow {
  margin: 0 0 6px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: #fbbf24;
  font-size: 12px;
}

h1, h2 {
  margin: 0;
}

.subtle {
  margin: 8px 0 0;
  color: #cbd5e1;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

button {
  border: 0;
  border-radius: 999px;
  padding: 10px 14px;
  background: #f59e0b;
  color: #111827;
  font-weight: 700;
}

button.danger {
  background: #ef4444;
  color: white;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.card {
  padding: 16px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 10px 8px;
  text-align: left;
}

.compact-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}

.compact-list li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.empty {
  text-align: center;
  color: #94a3b8;
}

@media (max-width: 900px) {
  .hero,
  .grid {
    grid-template-columns: 1fr;
    flex-direction: column;
  }
}
</style>
