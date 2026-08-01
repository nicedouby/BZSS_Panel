<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

type Player = {
  steamID: string;
  playerName: string;
  totalSteps: number;
  matchSteps: number;
  totalDistanceMeters: number;
  matchDistanceMeters: number;
  currentSpeedMps?: number;
  lastReason?: string;
};

const players = ref<Player[]>([]);
const updatedAt = ref<string | null>(null);
const lastReason = ref("");
let timer: number | undefined;

async function refresh() {
  const response = await fetch("/api/step-counter/stats");
  if (!response.ok) return;
  const data = await response.json();
  players.value = data.players ?? [];
  updatedAt.value = data.updatedAt ?? null;
  lastReason.value = data.lastReason ?? "";
}

onMounted(() => {
  void refresh();
  timer = window.setInterval(refresh, 3000);
});
onUnmounted(() => window.clearInterval(timer));
const topPlayers = computed(() => players.value.slice(0, 100));
const meters = (value: number) => `${Number(value ?? 0).toFixed(1)} m`;
</script>

<template>
  <section class="step-counter-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">BZSS · INFANTRY METRICS</p>
        <h1>步数统计</h1>
        <p class="muted">仅统计有效步兵移动（无 OV，速度 0.3–10 m/s）。</p>
      </div>
      <div class="status">
        <span>更新：{{ updatedAt ? new Date(updatedAt).toLocaleTimeString() : "尚未写入" }}</span>
        <span v-if="lastReason">最近跳过：{{ lastReason }}</span>
      </div>
    </header>
    <div class="table-shell">
      <table>
        <thead><tr><th>#</th><th>玩家</th><th>本局步数</th><th>本局距离</th><th>累计步数</th><th>速度</th></tr></thead>
        <tbody>
          <tr v-for="(player, index) in topPlayers" :key="player.steamID">
            <td>{{ index + 1 }}</td>
            <td><strong>{{ player.playerName || player.steamID }}</strong><small>{{ player.steamID }}</small></td>
            <td>{{ player.matchSteps.toLocaleString() }}</td>
            <td>{{ meters(player.matchDistanceMeters) }}</td>
            <td>{{ player.totalSteps.toLocaleString() }}</td>
            <td>{{ Number(player.currentSpeedMps ?? 0).toFixed(2) }} m/s</td>
          </tr>
          <tr v-if="!topPlayers.length"><td colspan="6" class="empty">暂无可统计玩家</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.step-counter-page { color: #d9e5f2; }
.page-header { display:flex; justify-content:space-between; gap:24px; padding:22px; margin-bottom:18px; border:1px solid #24384e; background:rgba(10,20,32,.82); border-radius:12px; }
.eyebrow { color:#57d6a0; letter-spacing:.12em; font-size:11px; margin:0 0 6px; }
h1 { margin:0 0 6px; } .muted, .status { color:#8da3b8; font-size:13px; }
.status { display:flex; flex-direction:column; gap:8px; text-align:right; }
.table-shell { overflow:auto; border:1px solid #24384e; border-radius:12px; background:rgba(8,16,27,.86); }
table { width:100%; border-collapse:collapse; min-width:760px; }
th, td { padding:11px 14px; border-bottom:1px solid #1b2b3c; text-align:left; }
th { color:#80a0ba; font-size:12px; text-transform:uppercase; }
td small { display:block; color:#71869b; font-size:11px; margin-top:3px; }
.empty { text-align:center; padding:35px; color:#71869b; }
</style>
