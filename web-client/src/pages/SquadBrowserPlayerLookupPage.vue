<template>
  <section class="lookup-page">
    <header class="lookup-header">
      <div>
        <p class="eyebrow">PLAYER INTELLIGENCE</p>
        <h1>查成分</h1>
        <p class="subtitle">输入 Steam64，查询 SquadBrowser 上的玩家档案与最近服务器游玩记录。</p>
      </div>
      <a class="source-link" :href="result?.sourceUrl || 'https://squadbrowser.app/players'" target="_blank" rel="noreferrer">打开 SquadBrowser ↗</a>
    </header>

    <form class="lookup-form" @submit.prevent="lookup">
      <label for="steam64">Steam64</label>
      <div class="form-row">
        <input id="steam64" v-model.trim="steam64" inputmode="numeric" autocomplete="off" placeholder="例如 76561199047265478" :disabled="loading" />
        <button type="submit" :disabled="loading || !/^\d{17}$/.test(steam64)">{{ loading ? "查询中…" : "查询" }}</button>
      </div>
      <p class="hint">只接受 17 位 Steam64 数字。数据来源：SquadBrowser，通常最多返回最近 50 条记录。</p>
    </form>

    <div v-if="error" class="state error-state">{{ error }}</div>
    <div v-else-if="loading" class="state">正在读取玩家档案与服务器记录…</div>

    <template v-if="result && !loading">
      <section class="profile-card">
        <div class="identity">
          <div class="avatar">{{ initials }}</div>
          <div>
            <div class="name-line"><h2>{{ player.displayName || "未知玩家" }}</h2><span :class="['status', player.isOnline ? 'online' : 'offline']">{{ player.isOnline ? "在线" : "离线" }}</span></div>
            <code>{{ player.steamId }}</code>
            <p>EOS：{{ player.eosId || "未提供" }}</p>
          </div>
        </div>
        <div class="profile-meta">
          <span>首次出现<strong>{{ formatDate(player.firstSeen) }}</strong></span>
          <span>最近出现<strong>{{ formatDate(player.lastSeen) }}</strong></span>
          <span>Squad 时长<strong>{{ player.squadHours == null ? "—" : `${player.squadHours.toLocaleString()} 小时` }}</strong></span>
        </div>
      </section>

      <section class="metric-grid">
        <article v-for="item in metrics" :key="item.label" class="metric-card"><span>{{ item.label }}</span><strong>{{ item.value }}</strong></article>
      </section>

      <section class="two-column">
        <article class="panel">
          <header><h3>当前 / 主要服务器</h3></header>
          <div class="server-highlight" v-if="player.currentServer"><span class="dot online-dot"></span><div><strong>{{ cleanServerName(player.currentServer.serverName) }}</strong><small>{{ player.currentServer.serverId }} · {{ player.currentServer.currentMap || "地图未知" }}</small></div></div>
          <div v-else class="empty">当前不在线</div>
          <div class="top-server" v-if="player.topServer"><span>主要服务器</span><strong>{{ cleanServerName(player.topServer.serverName) }}</strong><small>{{ player.topServer.playtimeMinutes ?? 0 }} 分钟</small></div>
        </article>
        <article class="panel">
          <header><h3>常玩服务器</h3><span>{{ player.favoriteServers.length }} 个</span></header>
          <div v-if="player.favoriteServers.length" class="server-list"><div v-for="server in player.favoriteServers" :key="server.serverId" class="server-row"><span class="rank">{{ player.favoriteServers.indexOf(server) + 1 }}</span><strong>{{ cleanServerName(server.serverName) }}</strong><em>{{ server.playtimeMinutes ?? 0 }} 分钟</em></div></div>
          <div v-else class="empty">暂无服务器排行</div>
        </article>
      </section>

      <section class="panel records-panel">
        <header><div><h3>最近游玩记录</h3><p>已返回 {{ result.sessions.length }} 条{{ result.sessionLimit ? `，上游限制 ${result.sessionLimit} 条` : "" }}</p></div><button class="secondary" type="button" @click="lookup">刷新</button></header>
        <div v-if="result.sessions.length" class="table-wrap"><table><thead><tr><th>进入时间</th><th>离开时间</th><th>服务器</th><th>服务器 ID</th><th>时长</th></tr></thead><tbody><tr v-for="session in result.sessions" :key="session.id"><td>{{ formatDate(session.joinedAt) }}</td><td>{{ session.leftAt ? formatDate(session.leftAt) : "仍在游玩" }}</td><td class="server-cell">{{ cleanServerName(session.serverName) }}</td><td><code>{{ session.serverId || "—" }}</code></td><td>{{ session.durationMinutes == null ? "—" : `${session.durationMinutes} 分钟` }}</td></tr></tbody></table></div>
        <div v-else class="empty">没有找到游玩记录</div>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { apiGet } from "../app/apiClient";
import { renderApiError } from "../app/errors";

type LookupResult = { sourceUrl: string; sessionLimit?: number; player: any; sessions: Array<any> };
const route = useRoute();
const steam64 = ref(String(route.query.steam64 ?? ""));
const result = ref<LookupResult | null>(null);
const loading = ref(false);
const error = ref("");
const player = computed(() => result.value?.player ?? {});
const initials = computed(() => String(player.value.displayName || "?").trim().slice(0, 1).toUpperCase());
const metrics = computed(() => [
  { label: "总游玩时长", value: minutes(player.value.stats?.totalPlaytimeMinutes) },
  { label: "总场次", value: number(player.value.stats?.totalSessions) },
  { label: "近 7 天场次", value: number(player.value.stats?.sessionsLast7Days) },
  { label: "近 30 天场次", value: number(player.value.stats?.sessionsLast30Days) },
  { label: "平均场次时长", value: minutes(player.value.stats?.avgSessionMinutes) },
]);

onMounted(() => { if (/^\d{17}$/.test(steam64.value)) void lookup(); });

async function lookup() {
  if (!/^\d{17}$/.test(steam64.value)) { error.value = "请输入正确的 17 位 Steam64。"; return; }
  loading.value = true; error.value = "";
  try { result.value = await apiGet<LookupResult>(`/api/squadbrowser/player?steam64=${encodeURIComponent(steam64.value)}`, {}, { timeoutMs: 15_000 }); }
  catch (err) { result.value = null; error.value = renderApiError(err, "查询 SquadBrowser 失败，请稍后重试。"); }
  finally { loading.value = false; }
}
function number(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n.toLocaleString() : "—"; }
function minutes(value: unknown) { const n = Number(value); return Number.isFinite(n) ? `${Math.floor(n / 60)} 小时 ${Math.round(n % 60)} 分钟` : "—"; }
function formatDate(value: unknown) { if (!value) return "—"; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false }); }
function cleanServerName(value: unknown) { return String(value ?? "未知服务器").replace(/^\s+/, "").replace(/\s+/g, " ").trim() || "未知服务器"; }
</script>

<style scoped>
.lookup-page{max-width:1440px;margin:0 auto;padding:28px 34px 60px;color:#e5edf7}.lookup-header{display:flex;justify-content:space-between;gap:20px;align-items:end;margin-bottom:24px}.eyebrow{margin:0 0 8px;color:#55c7ff;font:700 11px/1.2 ui-monospace,monospace;letter-spacing:.18em}.lookup-header h1{margin:0;font-size:30px}.subtitle{margin:8px 0 0;color:#91a1b6}.source-link{color:#6ed6ff;text-decoration:none;white-space:nowrap}.lookup-form,.panel,.profile-card,.metric-card{border:1px solid rgba(148,163,184,.18);background:rgba(15,23,42,.72);border-radius:12px;box-shadow:0 12px 35px rgba(0,0,0,.12)}.lookup-form{padding:18px 20px;margin-bottom:20px}.lookup-form label{display:block;font-size:12px;color:#9fb0c3;margin-bottom:8px}.form-row{display:flex;gap:10px}.form-row input{flex:1;min-width:0;border:1px solid #42526a;border-radius:8px;background:#0b1220;color:#fff;padding:11px 13px;font:14px ui-monospace,monospace}.form-row button,.secondary{border:0;border-radius:8px;background:#159bd2;color:white;padding:0 20px;font-weight:700;cursor:pointer}.form-row button:disabled{opacity:.45;cursor:not-allowed}.hint{margin:9px 0 0;color:#718299;font-size:12px}.state{padding:28px;text-align:center;border:1px dashed #334155;border-radius:10px;color:#9fb0c3}.error-state{border-color:#873b51;color:#ff9cac}.profile-card{display:flex;justify-content:space-between;gap:24px;padding:22px;margin-bottom:16px}.identity{display:flex;gap:14px;align-items:center}.avatar{width:54px;height:54px;display:grid;place-items:center;border-radius:50%;background:linear-gradient(135deg,#1da1d5,#6759d4);font-size:23px;font-weight:800}.name-line{display:flex;gap:10px;align-items:center}.name-line h2{margin:0;font-size:22px}.identity code{display:block;color:#8edbff;margin-top:5px}.identity p{margin:5px 0 0;color:#8da0b5;font-size:12px}.status{padding:3px 8px;border-radius:99px;font-size:11px}.status.online{background:#123e32;color:#68e2ac}.status.offline{background:#263245;color:#9aa9bc}.profile-meta{display:flex;gap:28px;align-items:center}.profile-meta span,.metric-card span{display:flex;flex-direction:column;color:#8292a7;font-size:12px}.profile-meta strong{margin-top:5px;color:#eef6ff;font-size:14px}.metric-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px}.metric-card{padding:15px 17px}.metric-card strong{margin-top:7px;font-size:20px;color:#e9f7ff}.two-column{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}.panel{padding:18px}.panel header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(148,163,184,.12);padding-bottom:13px;margin-bottom:14px}.panel h3{margin:0;font-size:16px}.panel header span,.panel header p{margin:4px 0 0;color:#8292a7;font-size:12px}.server-highlight{display:flex;gap:10px;align-items:start}.server-highlight strong,.top-server strong{display:block;font-size:14px;line-height:1.4}.server-highlight small,.top-server small{display:block;color:#8292a7;margin-top:5px}.dot{width:9px;height:9px;border-radius:50%;margin-top:5px}.online-dot{background:#45dc9a;box-shadow:0 0 10px #45dc9a}.top-server{margin-top:16px;padding-top:13px;border-top:1px solid rgba(148,163,184,.12)}.top-server span{font-size:12px;color:#8292a7}.server-list{display:grid;gap:4px}.server-row{display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:center;padding:8px;border-radius:7px}.server-row:hover{background:rgba(148,163,184,.08)}.server-row strong{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.server-row em{color:#8edbff;font-size:12px;font-style:normal}.rank{color:#6f8299;font:12px ui-monospace,monospace}.records-panel header{align-items:center}.secondary{padding:7px 14px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:11px 9px;text-align:left;border-bottom:1px solid rgba(148,163,184,.1);white-space:nowrap}th{color:#8292a7;font-weight:600}td{color:#d9e4f0}td code{color:#8edbff}.server-cell{max-width:400px;overflow:hidden;text-overflow:ellipsis}.empty{padding:18px 0;color:#718299;text-align:center}@media(max-width:900px){.profile-card,.lookup-header{align-items:flex-start;flex-direction:column}.profile-meta{width:100%;justify-content:space-between;gap:12px}.metric-grid{grid-template-columns:repeat(2,1fr)}.two-column{grid-template-columns:1fr}.lookup-page{padding:20px 16px 40px}}@media(max-width:540px){.form-row{flex-direction:column}.form-row button{height:40px}.profile-meta{display:grid;grid-template-columns:1fr 1fr}.metric-card strong{font-size:17px}}
</style>
