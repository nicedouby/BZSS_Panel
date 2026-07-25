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
      <label for="player-query">玩家名称或 Steam64</label>
      <div class="form-row search-row">
        <div class="query-box">
          <input id="player-query" v-model.trim="queryInput" inputmode="search" autocomplete="off" placeholder="输入玩家名称，或 17 位 Steam64" :disabled="loading" @input="onQueryInput" @keydown.esc="suggestions = []" />
          <div v-if="suggestions.length" class="suggestions" role="listbox">
            <button v-for="candidate in suggestions" :key="candidate.id" type="button" class="suggestion" @click="selectPlayer(candidate)">
              <span class="suggestion-avatar">{{ String(candidate.name || "?").slice(0, 1).toUpperCase() }}</span>
              <span class="suggestion-main"><strong>{{ candidate.name || "未命名玩家" }}</strong><small>{{ candidate.steam64 || "无 Steam64" }}<span v-if="candidate.eos"> · {{ candidate.eos }}</span></small></span>
              <span class="suggestion-time">{{ formatDate(candidate.updatedAt) }}</span>
            </button>
          </div>
        </div>
        <button type="submit" :disabled="loading || !/^\d{17}$/.test(steam64)">{{ loading ? "查询中…" : "查询" }}</button>
      </div>
      <p class="hint">输入名称后从玩家数据库选择，系统会自动填写 Steam64；也可以直接输入 Steam64。数据来源：SquadBrowser。</p>
    </form>

    <div v-if="error" class="state error-state">{{ error }}</div>
    <div v-else-if="loading" class="state">正在读取玩家档案与服务器记录…</div>

    <template v-if="result && !loading">
      <section class="profile-card">
        <div class="identity">
          <img v-if="player.steamAvatar" class="avatar avatar-image" :src="player.steamAvatar" alt="玩家头像" loading="lazy" /><div v-else class="avatar">{{ initials }}</div>
          <div>
            <div class="name-line"><h2>{{ player.displayName || "未知玩家" }}</h2><span :class="['status', player.isOnline ? 'online' : 'offline']">{{ player.isOnline ? "在线" : "离线" }}</span></div>
            <code>{{ player.steamId }}</code>
            <p>EOS：{{ player.eosId || "未提供" }}</p><small v-if="result.database?.playerId" class="db-note">已同步到玩家数据库 · 新增/更新 {{ result.database.savedSessions }} 条游玩记录</small>
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

      <details class="panel complete-info">
        <summary><strong>完整玩家资料</strong><span>已保留上游返回的全部字段，点击可收起</span></summary>
        <div class="detail-groups">
          <div>
            <h4>统计资料</h4>
            <div class="detail-grid"><div v-for="[key, value] in statEntries" :key="`stat-${key}`" class="detail-item"><span>{{ key }}</span><strong>{{ formatDetailValue(value) }}</strong></div></div>
          </div>
          <div>
            <h4>其他字段</h4>
            <div v-if="profileEntries.length" class="detail-grid"><div v-for="[key, value] in profileEntries" :key="key" class="detail-item"><span>{{ key }}</span><strong>{{ formatDetailValue(value) }}</strong></div></div>
            <div v-else class="empty">没有额外字段</div>
          </div>
        </div>
      </details>

      <section class="panel records-panel">
        <header><div><h3>最近游玩记录</h3><p>已返回 {{ result.sessions.length }} 条{{ result.sessionLimit ? `，上游限制 ${result.sessionLimit} 条` : "" }}</p></div><button class="secondary" type="button" @click="lookup">刷新</button></header>
        <div v-if="result.sessions.length" class="table-wrap"><table><thead><tr><th>进入时间</th><th>离开时间</th><th>服务器</th><th>服务器 ID</th><th>时长</th><th>其他资料</th></tr></thead><tbody><tr v-for="session in result.sessions" :key="session.id"><td>{{ formatDate(session.joinedAt) }}</td><td>{{ session.leftAt ? formatDate(session.leftAt) : "仍在游玩" }}</td><td class="server-cell">{{ cleanServerName(session.serverName) }}</td><td><code>{{ session.serverId || "—" }}</code></td><td>{{ session.durationMinutes == null ? "—" : `${session.durationMinutes} 分钟` }}</td><td><span v-if="extraSessionFields(session).length" class="session-extra">{{ extraSessionFields(session).map(([key, value]) => `${key}: ${formatDetailValue(value)}`).join(" · ") }}</span><span v-else>—</span></td></tr></tbody></table></div>
        <div v-else class="empty">没有找到游玩记录</div>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { apiGet } from "../app/apiClient";
import { renderApiError } from "../app/errors";

type LookupResult = { sourceUrl: string; sessionLimit?: number; player: any; sessions: Array<any>; database?: { playerId?: number; avatar?: string | null; savedSessions?: number } | null };
const route = useRoute();
const steam64 = ref(String(route.query.steam64 ?? ""));
const queryInput = ref(steam64.value);
const suggestions = ref<Array<any>>([]);
let suggestionTimer: ReturnType<typeof setTimeout> | null = null;
const result = ref<LookupResult | null>(null);
const loading = ref(false);
const error = ref("");
const player = computed(() => result.value?.player ?? {});
const initials = computed(() => String(player.value.displayName || "?").trim().slice(0, 1).toUpperCase());
const statEntries = computed(() => Object.entries(player.value.stats || {}));
const profileEntries = computed(() => Object.entries(player.value || {}).filter(([key]) => !["steamAvatar", "stats"].includes(key)));
const metrics = computed(() => [
  { label: "总游玩时长", value: minutes(player.value.stats?.totalPlaytimeMinutes) },
  { label: "总场次", value: number(player.value.stats?.totalSessions) },
  { label: "近 7 天场次", value: number(player.value.stats?.sessionsLast7Days) },
  { label: "近 30 天场次", value: number(player.value.stats?.sessionsLast30Days) },
  { label: "平均场次时长", value: minutes(player.value.stats?.avgSessionMinutes) },
]);

onMounted(() => { if (/^\d{17}$/.test(steam64.value)) void lookup(); });
onBeforeUnmount(() => { if (suggestionTimer) clearTimeout(suggestionTimer); });

function onQueryInput() {
  const value = queryInput.value.trim();
  steam64.value = /^\d{17}$/.test(value) ? value : "";
  suggestions.value = [];
  if (suggestionTimer) clearTimeout(suggestionTimer);
  if (!value || /^\d{17}$/.test(value)) return;
  suggestionTimer = setTimeout(() => void searchPlayers(value), 220);
}

async function searchPlayers(value: string) {
  try {
    const response = await apiGet<any>(`/api/player-database/list?q=${encodeURIComponent(value)}&limit=12&offset=0&sort=name_asc`, {}, { timeoutMs: 5_000 });
    const rows = Array.isArray(response?.players) ? response.players : (Array.isArray(response?.items) ? response.items : []);
    suggestions.value = rows.filter((row: any) => row?.steam64 || row?.steamID).slice(0, 12).map((row: any) => ({
      id: row.id,
      name: row.name ?? row.current_name,
      steam64: row.steam64 ?? row.steamID ?? row.steam_id,
      eos: row.eos ?? row.eosID ?? row.eos_id,
      updatedAt: row.updatedAt ?? row.updated_at,
    }));
  } catch { suggestions.value = []; }
}

function selectPlayer(candidate: any) {
  const id = String(candidate.steam64 ?? "").trim();
  if (!/^\d{17}$/.test(id)) return;
  queryInput.value = candidate.name || id;
  steam64.value = id;
  suggestions.value = [];
  void lookup();
}

async function lookup() {
  if (!/^\d{17}$/.test(steam64.value)) { error.value = "请输入正确的 17 位 Steam64。"; return; }
  loading.value = true; error.value = "";
  try {\n    const response = await apiGet<LookupResult>(`/api/squadbrowser/player?steam64=${encodeURIComponent(steam64.value)}`, {}, { timeoutMs: 15_000 });\n    result.value = normalizeLookupResponse(response);\n  }
  catch (err) { result.value = null; error.value = renderApiError(err, "查询 SquadBrowser 失败，请稍后重试。"); }
  finally { loading.value = false; }
}
function normalizeLookupResponse(value: any): LookupResult {\n  const candidate = value?.data?.player ? value.data : (value?.result?.player ? value.result : value);\n  return {\n    ...candidate,\n    player: candidate?.player ?? {},\n    sessions: Array.isArray(candidate?.sessions) ? candidate.sessions : (Array.isArray(candidate?.records) ? candidate.records : []),\n  };\n}\nfunction number(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n.toLocaleString() : "—"; }
function minutes(value: unknown) { const n = Number(value); return Number.isFinite(n) ? `${Math.floor(n / 60)} 小时 ${Math.round(n % 60)} 分钟` : "—"; }
function formatDate(value: unknown) { if (!value) return "—"; const numeric = typeof value === "number" ? value : (typeof value === "string" && /^\\d+$/.test(value) ? Number(value) : null); const date = new Date(numeric != null ? (numeric < 1e12 ? numeric * 1000 : numeric) : String(value)); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false }); }
function cleanServerName(value: unknown) { return String(value ?? "未知服务器").replace(/^\s+/, "").replace(/\s+/g, " ").trim() || "未知服务器"; }
function formatDetailValue(value: unknown) { if (value == null || value === "") return "—"; if (typeof value === "object") { try { return JSON.stringify(value); } catch { return String(value); } } return String(value); }
function extraSessionFields(session: any) { const known = new Set(["id", "serverId", "serverName", "joinedAt", "leftAt", "durationMinutes"]); return Object.entries(session || {}).filter(([key]) => !known.has(key)); }
</script>

<style scoped>
.lookup-page{max-width:1180px;margin:0 auto;padding:18px 20px 40px;color:#e7eef8}
.lookup-header{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-bottom:14px}
.eyebrow{margin:0 0 9px;color:#60d6ff;font:700 11px/1.2 ui-monospace,monospace;letter-spacing:.2em}
.lookup-header h1{margin:0;font-size:26px;letter-spacing:-.03em}
.subtitle{max-width:720px;margin:9px 0 0;color:#91a4ba;font-size:14px}
.source-link{padding:9px 12px;border:1px solid rgba(119,196,255,.28);border-radius:9px;color:#8cddff;text-decoration:none;background:rgba(18,47,72,.45);white-space:nowrap}
.source-link:hover{background:rgba(35,102,145,.42)}
.lookup-form,.panel,.profile-card,.metric-card{border:1px solid rgba(148,163,184,.17);background:linear-gradient(145deg,rgba(18,31,52,.9),rgba(10,18,32,.88));border-radius:14px;box-shadow:0 18px 46px rgba(0,0,0,.16)}
.lookup-form{padding:14px 16px;margin-bottom:14px}.query-box{position:relative;flex:1;min-width:0}.query-box input{width:100%;box-sizing:border-box}.suggestions{position:absolute;z-index:10;top:calc(100% + 8px);left:0;right:0;padding:6px;border:1px solid #40546e;border-radius:10px;background:#0b1626;box-shadow:0 18px 36px rgba(0,0,0,.35)}.suggestion{width:100%;display:flex;align-items:center;gap:10px;padding:9px;border:0;border-radius:7px;background:transparent;color:#e8f2fc;text-align:left;cursor:pointer}.suggestion:hover{background:rgba(66,199,255,.12)}.suggestion-avatar{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:#1b6f98;font-weight:800}.suggestion-main{display:flex;flex:1;min-width:0;flex-direction:column;gap:3px}.suggestion-main strong,.suggestion-main small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.suggestion-main small,.suggestion-time{color:#8196ab;font-size:11px}.suggestion-time{white-space:nowrap}
.lookup-form label{display:block;margin-bottom:9px;color:#9fb1c5;font-size:12px;font-weight:650}
.form-row{display:flex;gap:10px}.form-row input{flex:1;min-width:0;border:1px solid #40546e;border-radius:9px;background:#091321;color:#f5f9ff;padding:12px 14px;font:14px ui-monospace,monospace;outline:none}.form-row input:focus{border-color:#42c7ff;box-shadow:0 0 0 3px rgba(66,199,255,.13)}
.form-row button,.secondary{border:0;border-radius:9px;background:linear-gradient(135deg,#159dd6,#2872db);color:#fff;padding:0 22px;font-weight:750;cursor:pointer;box-shadow:0 7px 18px rgba(21,157,214,.2)}.form-row button:hover,.secondary:hover{filter:brightness(1.1)}.form-row button:disabled{opacity:.45;cursor:not-allowed}
.hint{margin:10px 0 0;color:#71859d;font-size:12px}.state{padding:32px;text-align:center;border:1px dashed #39506a;border-radius:12px;color:#9fb1c5}.error-state{border-color:#873b51;color:#ff9cac}
.profile-card{display:flex;justify-content:space-between;gap:20px;padding:16px;margin-bottom:12px;overflow:hidden;position:relative}.profile-card:before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:linear-gradient(#42d8ff,#6e68ed)}
.identity{display:flex;gap:16px;align-items:center;min-width:0}.avatar{width:52px;height:52px;display:grid;place-items:center;flex:none;border-radius:18px;background:linear-gradient(135deg,#1da1d5,#6759d4);font-size:21px;font-weight:850;box-shadow:0 8px 20px rgba(33,151,211,.2)}.avatar-image{object-fit:cover}
.name-line{display:flex;gap:10px;align-items:center}.name-line h2{margin:0;font-size:19px;letter-spacing:-.02em}.identity code{display:block;color:#8edbff;margin-top:6px}.identity p{margin:5px 0 0;color:#8da0b5;font-size:12px}.db-note{display:block;margin-top:7px;color:#62d7a8;font-size:11px}.status{padding:4px 9px;border-radius:99px;font-size:11px;font-weight:700}.status.online{background:#123e32;color:#68e2ac}.status.offline{background:#263245;color:#9aa9bc}
.profile-meta{display:flex;gap:30px;align-items:center}.profile-meta span,.metric-card span{display:flex;flex-direction:column;color:#8292a7;font-size:12px}.profile-meta strong{margin-top:6px;color:#eef6ff;font-size:14px}
.metric-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin-bottom:12px}.metric-card{padding:12px 14px}.metric-card strong{margin-top:6px;color:#e9f7ff;font-size:16px}
.two-column{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}.panel{padding:14px}.panel header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(148,163,184,.12);padding-bottom:14px;margin-bottom:15px}.panel h3{margin:0;font-size:16px}.panel header span,.panel header p{margin:4px 0 0;color:#8292a7;font-size:12px}
.server-highlight{display:flex;gap:11px;align-items:flex-start}.server-highlight strong,.top-server strong{display:block;font-size:14px;line-height:1.45}.server-highlight small,.top-server small{display:block;color:#8292a7;margin-top:5px}.dot{width:9px;height:9px;border-radius:50%;margin-top:6px}.online-dot{background:#45dc9a;box-shadow:0 0 12px #45dc9a}.top-server{margin-top:18px;padding-top:14px;border-top:1px solid rgba(148,163,184,.12)}.top-server span{font-size:12px;color:#8292a7}.server-list{display:grid;gap:4px}.server-row{display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:center;padding:9px;border-radius:8px}.server-row:hover{background:rgba(148,163,184,.08)}.server-row strong{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.server-row em{color:#8edbff;font-size:12px;font-style:normal}.rank{color:#6f8299;font:12px ui-monospace,monospace}
.records-panel header{align-items:center}.records-panel .table-wrap{max-height:620px;overflow:auto}.records-panel th{position:sticky;top:0;background:#101d31;z-index:1}.complete-info{margin-bottom:16px}.complete-info summary{display:flex;justify-content:space-between;gap:16px;cursor:pointer;list-style:none}.complete-info summary::-webkit-details-marker{display:none}.complete-info summary span{color:#8292a7;font-size:12px;font-weight:400}.detail-groups{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:14px}.detail-groups h4{margin:0 0 12px;color:#8edbff;font-size:13px}.detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.detail-item{min-width:0;padding:9px 10px;border:1px solid rgba(148,163,184,.12);border-radius:8px;background:rgba(7,15,27,.35)}.detail-item span{display:block;color:#8292a7;font-size:11px}.detail-item strong{display:block;margin-top:4px;color:#e2edf7;overflow-wrap:anywhere;font-size:12px;font-weight:500}.secondary{padding:8px 15px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:8px 8px;text-align:left;border-bottom:1px solid rgba(148,163,184,.1);white-space:nowrap}th{color:#8292a7;font-weight:650}td{color:#d9e4f0}td code{color:#8edbff}.server-cell{min-width:220px;max-width:560px;white-space:normal;word-break:break-word}.session-extra{display:block;max-width:420px;white-space:normal;word-break:break-word;color:#9fb6cc}.empty{padding:18px 0;color:#718299;text-align:center}
@media(max-width:1050px){.profile-card,.lookup-header{align-items:flex-start;flex-direction:column}.profile-meta{width:100%;justify-content:space-between;gap:12px}.metric-grid{grid-template-columns:repeat(3,1fr)}}
@media(max-width:900px){.detail-groups{grid-template-columns:1fr}.two-column{grid-template-columns:1fr}.lookup-page{padding:22px 18px 45px}}
@media(max-width:600px){.detail-grid{grid-template-columns:1fr}.form-row{flex-direction:column}.form-row button{height:42px}.profile-meta{display:grid;grid-template-columns:1fr 1fr}.metric-grid{grid-template-columns:repeat(2,1fr)}.metric-card strong{font-size:17px}.profile-card,.panel{padding:16px}.name-line{align-items:flex-start;flex-direction:column;gap:6px}}
</style>