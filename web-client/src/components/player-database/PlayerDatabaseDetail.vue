<template>
  <div class="db-detail">
    <div v-if="!id" class="detail-placeholder"><div class="placeholder-icon">👤</div><p>{{ t("database.selectPlayer") }}</p></div>
    <div v-else-if="loading && !detail" class="detail-placeholder"><p>{{ t("database.loadingDetail") }}</p></div>
    <div v-else-if="error" class="detail-placeholder error"><p>{{ error }}</p><button type="button" @click="$emit('retry')">{{ t("database.retry") }}</button></div>
    <template v-else-if="detail">
      <header class="profile-header">
        <img v-if="avatar" class="profile-avatar" :src="avatar" alt="Steam avatar">
        <div v-else class="profile-avatar fallback">{{ playerName.slice(0, 1).toUpperCase() }}</div>
        <div class="profile-identity">
          <div class="profile-title"><h1>{{ playerName }}</h1><span class="permission">{{ player.permission_group || "default" }}</span></div>
          <div class="profile-ids"><span>Steam64 {{ player.steam_id || "--" }}</span><span>EOS {{ player.eos_id || "--" }}</span><span v-if="player.qq_number">QQ {{ player.qq_number }}</span></div>
          <a v-if="steamProfile?.profile_url" class="steam-link" :href="steamProfile.profile_url" target="_blank" rel="noopener noreferrer">打开 Steam 资料</a>
        </div>
        <button type="button" class="close-btn" @click="$emit('close')">{{ t("database.closeDetail") }}</button>
      </header>

      <main class="detail-scroll">
        <section class="summary-grid">
          <div v-for="card in summaryCards" :key="card.label" class="summary-card"><span>{{ card.label }}</span><strong>{{ card.value }}</strong></div>
        </section>

        <section class="profile-section career-section">
          <div class="section-heading">
            <div>
              <h2>生涯战绩</h2>
              <p>只累计真实对局结束快照；重复快照不会再次入账。</p>
            </div>
          </div>
          <div class="career-grid">
            <article v-for="card in careerCards" :key="card.label" class="career-card">
              <span>{{ card.label }}</span>
              <strong>{{ card.value }}</strong>
              <small>{{ card.hint }}</small>
            </article>
          </div>
        </section>

        <section class="profile-section">
          <div class="section-heading"><div><h2>常玩服务器排行</h2><p>保存 SquadBrowser 返回的最新前 15 名，含服务器名称与累计游玩时长。</p></div></div>
          <div v-if="squadBrowserServerRankings.length" class="server-playtime-list">
            <article v-for="server in squadBrowserServerRankings" :key="server.rank_position" class="server-playtime-item">
              <div><span>#{{ server.rank_position }} · {{ server.server_id || "未知服务器 ID" }}</span><strong>{{ server.server_name }}</strong><small>最近 {{ formatShortTime(server.last_played_at) }}</small></div>
              <b>{{ formatMinutes(server.playtime_minutes) }}</b>
            </article>
          </div>
          <p v-else class="empty-history">尚未查询到其他服务器游玩记录；后台查成分刷新后会自动显示。</p>
        </section>

        <section class="profile-section">
          <div class="section-heading"><div><h2>最近游玩记录</h2><p>游玩记录持续追加，不会覆盖之前保存的历史。</p></div></div>
          <div v-if="squadBrowserSessions.length" class="recent-session-list">
            <article v-for="session in squadBrowserSessions.slice(0, 10)" :key="session.id" class="recent-session-item">
              <div><span>{{ session.server_id || "未知服务器 ID" }}</span><strong>{{ formatSessionRange(session) }}</strong></div>
              <b>{{ formatMinutes(session.duration_minutes) }}</b>
            </article>
          </div>
          <p v-else class="empty-history">暂无游玩记录。</p>
        </section>

        <section class="profile-section">
          <div class="section-heading"><div><h2>玩家档案</h2><p>静态资料与当前汇总</p></div></div>
          <div class="profile-fields">
            <div><span>当前 IP</span><strong>{{ player.current_ip || "--" }}</strong></div>
            <div><span>首次记录</span><strong>{{ formatTime(player.created_at) }}</strong></div>
            <div><span>最后活跃</span><strong>{{ formatTime(player.updated_at) }}</strong></div>
            <div><span>Steam 同步</span><strong>{{ steamProfile?.profile_state || "未同步" }} · {{ formatTime(steamProfile?.last_success_at) }}</strong></div>
          </div>
          <div v-if="assetEntries.length || noteEntries.length" class="json-groups">
            <div v-if="assetEntries.length"><h3>资产</h3><div class="key-values"><span v-for="item in assetEntries" :key="item[0]">{{ item[0] }} <b>{{ formatValue(item[1]) }}</b></span></div></div>
            <div v-if="noteEntries.length"><h3>备注数据</h3><div class="key-values"><span v-for="item in noteEntries" :key="item[0]">{{ item[0] }} <b>{{ formatValue(item[1]) }}</b></span></div></div>
          </div>
        </section>

        <section class="profile-section violation-summary-section">
          <div class="section-heading"><div><h2>违规统计</h2><p>按具体违规行为累计；下方“违规记录”保存每一次警告时间、文案、说明与管理员。</p></div><strong class="violation-total">{{ totalViolations }} 次</strong></div>
          <div v-if="violationCounts.length" class="violation-count-grid">
            <article v-for="item in violationCounts" :key="item.violation_key">
              <span>{{ item.category_label || "违规警告" }}</span>
              <b>{{ item.violation_label || item.violation_key }}</b>
              <strong>{{ item.count }}</strong>
              <small>最近 {{ formatTime(item.last_at) }}</small>
            </article>
          </div>
          <p v-else class="empty-history">暂无违规记录。</p>
        </section>

        <section class="profile-section">
          <div class="section-heading"><div><h2>记录容器</h2><p>点击后按需读取历史数据，不会阻塞档案打开。</p></div></div>
          <div class="container-grid">
            <button v-for="container in containers" :key="container.key" type="button" class="record-container" @click="openContainer(container)">
              <span class="container-icon">{{ container.icon }}</span><span class="container-text"><b>{{ container.title }}</b><small>{{ container.count }} 条{{ container.lastAt ? ` · ${formatShortTime(container.lastAt)}` : "" }}</small></span><span class="container-arrow">›</span>
            </button>
          </div>
        </section>
      </main>
    </template>

    <div v-if="openedContainer" class="record-modal" @click.self="closeContainer">
      <section class="record-panel">
        <header><div><h2>{{ openedContainer.title }}</h2><p>{{ openedContainer.count }} 条关联记录</p></div><div class="modal-actions"><button v-if="openedContainer.key === 'steam-friends'" type="button" :disabled="containerLoading" @click="loadContainer(true)">刷新 Steam</button><button type="button" @click="closeContainer">关闭</button></div></header>
        <div class="record-body">
          <p v-if="containerLoading" class="container-state">正在读取记录…</p>
          <p v-else-if="containerError" class="container-state error">{{ containerError }}</p>
          <p v-else-if="!containerItems.length" class="container-state">暂无关联记录</p>
          <article v-for="(item, index) in containerItems" :key="item.id || item.steamID || `${index}-${JSON.stringify(item)}`" class="record-item">
            <template v-if="openedContainer.key === 'steam-friends'"><img v-if="item.avatar" :src="item.avatar" alt=""><div><b>{{ item.name || item.steamID }}</b><small>Steam {{ item.steamID }}{{ item.dbPlayerId ? ` · 本服档案 #${item.dbPlayerId}` : "" }}</small></div></template>
            <template v-else-if="openedContainer.key === 'squadbrowser-sessions'"><div><b>{{ item.server_id || "未知服务器 ID" }}</b><small>{{ formatMinutes(item.duration_minutes) }} · 进入 {{ formatTime(item.joined_at) }}{{ item.left_at ? ` · 离开 ${formatTime(item.left_at)}` : "" }}</small></div></template>
            <template v-else-if="openedContainer.key === 'matches'">
              <div class="match-result-record">
                <div class="match-result-heading">
                  <div>
                    <b>{{ item.map_name || "未知地图" }}</b>
                    <small>{{ item.layer_name || item.mode || "未知图层" }} · {{ formatTime(item.ended_at || item.started_at) }}</small>
                  </div>
                  <span :class="item.won ? 'won' : 'lost'">{{ item.won ? "胜利" : "失败" }}</span>
                </div>
                <div v-if="item.scoreboard_available" class="match-result-stats">
                  <span>K <b>{{ item.kills || 0 }}</b></span>
                  <span>D <b>{{ item.deaths || 0 }}</b></span>
                  <span>击倒 <b>{{ item.downs || 0 }}</b></span>
                  <span>TK <b>{{ item.team_kills || 0 }}</b></span>
                </div>
                <small v-else>该场没有可用的最终 PlayerScoreboard，未累计战斗数值。</small>
              </div>
            </template>
            <template v-else-if="openedContainer.key === 'violations'">
              <div class="violation-event">
                <span>{{ item.category_label || "违规警告" }}</span>
                <b>{{ item.violation_label || item.violation_key }}</b>
                <p>{{ item.message || [item.warning_text, item.detail].filter(Boolean).join("，") }}</p>
                <small>{{ item.operator_name ? `管理员 ${item.operator_name} · ` : "" }}{{ formatTime(item.created_at) }}</small>
              </div>
            </template>
            <template v-else><b>{{ primaryLine(item) }}</b><small>{{ secondaryLine(item) }}</small></template>
          </article>
          <button v-if="containerHasMore" type="button" class="more-btn" :disabled="containerLoading" @click="loadMore">加载更多</button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { apiGet } from "../../app/apiClient";
import { currentLocale, t } from "../../i18n";

const props = defineProps<{ id: number | null; detail: any | null; loading: boolean; error: string }>();
defineEmits<{ (event: "close"): void; (event: "retry"): void }>();

const openedContainer = ref<any | null>(null);
const containerItems = ref<any[]>([]);
const containerLoading = ref(false);
const containerError = ref("");
const containerHasMore = ref(false);
const containerOffset = ref(0);
const player = computed(() => props.detail?.player ?? {});
const steamProfile = computed(() => props.detail?.steamProfile ?? null);
const playerName = computed(() => String(player.value.current_name || player.value.name || t("player.player")));
const avatar = computed(() => steamProfile.value?.avatar_medium || player.value.steam_avatar || player.value.steamAvatar || "");
const assetEntries = computed(() => Object.entries(props.detail?.summary?.assets || player.value.assets || {}));
const noteEntries = computed(() => Object.entries(props.detail?.summary?.notes || {}));
const squadBrowserServerRankings = computed(() => props.detail?.squadBrowserServerRankings || []);
const squadBrowserSessions = computed(() => props.detail?.squadBrowserSessions || []);
const violationCounts = computed(() => props.detail?.violationCounts || []);
const career = computed(() => props.detail?.career || props.detail?.summary?.career || {});
const totalViolations = computed(() => violationCounts.value.reduce((total: number, item: any) => total + Math.max(0, Number(item?.count || 0)), 0));

const containerMeta: Record<string, { title: string; icon: string }> = {
  "steam-friends": { title: "Steam 好友", icon: "♟" }, aliases: { title: "历史名称", icon: "A" }, ips: { title: "IP 历史", icon: "◎" }, sessions: { title: "进退服记录", icon: "↔" },
  "squadbrowser-sessions": { title: "SquadBrowser 游玩记录", icon: "◈" },  tags: { title: "标签", icon: "#" }, violations: { title: "违规记录", icon: "!" }, reports: { title: "举报记录", icon: "⚑" }, commands: { title: "管理命令", icon: ">_" },
  matches: { title: "对局历史", icon: "▣" }, "ladder-history": { title: "天梯变动", icon: "↕" }, "squad-records": { title: "小队记录", icon: "⌘" }, audit: { title: "网页操作审计", icon: "◷" },
};
const containers = computed(() => (props.detail?.containers || []).map((row: any) => ({ ...row, ...(containerMeta[row.key] || { title: row.key, icon: "•" }) })));
const careerCards = computed(() => {
  const matches = Math.max(0, Number(career.value.matches || 0));
  const wins = Math.max(0, Number(career.value.wins || 0));
  const kills = Math.max(0, Number(career.value.kills || 0));
  const deaths = Math.max(0, Number(career.value.deaths || 0));
  const winRate = matches > 0 ? (wins / matches) * 100 : 0;
  const kd = deaths > 0 ? kills / deaths : kills;
  return [
    { label: "胜场", value: formatValue(wins), hint: `${formatValue(matches)} 场 · 胜率 ${winRate.toFixed(1)}%` },
    { label: "击杀", value: formatValue(kills), hint: "Kills" },
    { label: "死亡", value: formatValue(deaths), hint: "Deaths" },
    { label: "击倒", value: formatValue(career.value.downs || 0), hint: "Downs" },
    { label: "TK", value: formatValue(career.value.teamKills || 0), hint: "Team Kills" },
    { label: "K/D", value: kd.toFixed(2), hint: "累计击杀 ÷ 累计死亡" },
  ];
});

const summaryCards = computed(() => [
  { label: "Steam 时长", value: formatHours(props.detail?.summary?.steamGameSeconds) }, { label: "服务器时长", value: formatHours(props.detail?.summary?.serverSeconds) },
  { label: "暖服时长", value: formatHours(props.detail?.summary?.warmupSeconds) }, { label: "对局", value: String(props.detail?.summary?.totalMatches ?? 0) },
  { label: "暖服分", value: formatValue((props.detail?.summary?.assets || {}).warmupPoints ?? 0) }, { label: "违规", value: String(totalViolations.value) },
  { label: "权限组", value: player.value.permission_group || "default" },
]);

async function openContainer(container: any) { openedContainer.value = container; containerItems.value = []; containerOffset.value = 0; await loadContainer(); }
function closeContainer() { openedContainer.value = null; containerItems.value = []; containerError.value = ""; }
async function loadContainer(refresh = false) {
  if (!openedContainer.value || !props.id) return;
  containerLoading.value = true; containerError.value = "";
  try {
    const params = new URLSearchParams({ id: String(props.id), limit: "30", offset: "0" });
    if (refresh) params.set("refresh", "true");
    const result = await apiGet<any>(`/api/player-database/detail/container/${encodeURIComponent(openedContainer.value.key)}?${params}`);
    containerItems.value = result.items || []; containerOffset.value = containerItems.value.length; containerHasMore.value = Boolean(result.hasMore);
  } catch (error: any) { containerError.value = error?.message || "读取记录失败"; } finally { containerLoading.value = false; }
}
async function loadMore() {
  if (!openedContainer.value || !props.id) return;
  containerLoading.value = true;
  try { const result = await apiGet<any>(`/api/player-database/detail/container/${encodeURIComponent(openedContainer.value.key)}?id=${props.id}&limit=30&offset=${containerOffset.value}`); const items = result.items || []; containerItems.value.push(...items); containerOffset.value += items.length; containerHasMore.value = Boolean(result.hasMore); } catch (error: any) { containerError.value = error?.message || "读取记录失败"; } finally { containerLoading.value = false; }
}
function formatTime(value: unknown) { const time = Number(value || 0); return time ? new Date(time).toLocaleString(currentLocale.value) : "--"; }
function formatShortTime(value: unknown) { const time = Number(value || 0); return time ? new Date(time).toLocaleDateString(currentLocale.value) : ""; }
function formatHours(value: unknown) { return `${(Math.max(0, Number(value || 0)) / 3600).toFixed(1)} h`; }
function formatMinutes(value: unknown) { const minutes = Math.max(0, Number(value || 0)); return minutes >= 60 ? `${(minutes / 60).toFixed(1)} h` : `${Math.floor(minutes)} 分钟`; }
function formatSessionRange(session: any) { const joined = formatTime(session?.joined_at); const left = session?.left_at ? formatTime(session.left_at) : "仍在游玩或未记录离开"; return `${joined} → ${left}`; }
function formatValue(value: unknown) { return typeof value === "object" ? JSON.stringify(value) : new Intl.NumberFormat(currentLocale.value).format(Number.isFinite(Number(value)) ? Number(value) : 0); }
function primaryLine(item: any) { return String(item.alias_name || item.ip || item.tag_value || item.violation_label || item.violation_key || item.reason || item.command_text || item.map_name || item.kind || item.action || `${item.old_rating ?? ""} → ${item.new_rating ?? ""}` || "记录"); }
function secondaryLine(item: any) { const time = item.seen_at || item.joined_at || item.last_at || item.created_at || item.started_at || item.changed_at || item.time_ms || item.created_at_ms || item.updated_at; const extras = [item.status, item.relation, item.squad_name, item.team_name, item.result, item.command_result].filter(Boolean); return `${extras.join(" · ")}${extras.length && time ? " · " : ""}${formatTime(time)}`; }
</script>

<style scoped>
.db-detail{height:100%;display:flex;flex-direction:column;overflow:hidden;background:var(--color-bg-panel);border:1px solid var(--color-border-default);border-radius:16px}.detail-placeholder{flex:1;display:grid;place-content:center;gap:12px;text-align:center;color:var(--color-text-muted)}.placeholder-icon{font-size:44px;opacity:.35}.profile-header{display:flex;gap:15px;align-items:center;padding:18px 20px;border-bottom:1px solid var(--color-border-default);background:linear-gradient(115deg,rgba(64,153,255,.13),transparent 55%)}.profile-avatar{width:68px;height:68px;border-radius:16px;object-fit:cover;background:#18232c}.profile-avatar.fallback{display:grid;place-items:center;font-size:26px;font-weight:800}.profile-identity{min-width:0;flex:1}.profile-title{display:flex;align-items:center;gap:9px}.profile-title h1{margin:0;font-size:22px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.permission{font-size:11px;padding:3px 7px;border:1px solid var(--color-border-soft);border-radius:999px;color:var(--color-text-muted)}.profile-ids{display:flex;gap:8px;flex-wrap:wrap;margin-top:5px;font-size:12px;color:var(--color-text-muted)}.steam-link{display:inline-block;margin-top:8px;font-size:12px;color:#75baff}.close-btn,.modal-actions button,.more-btn{border:1px solid var(--color-border-soft);border-radius:8px;background:var(--color-bg-hover);color:var(--color-text-primary);padding:7px 10px;cursor:pointer}.detail-scroll{overflow:auto;padding:18px;display:grid;gap:20px}.summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.summary-card{padding:12px;border:1px solid var(--color-border-default);border-radius:11px;background:rgba(255,255,255,.025)}.summary-card span,.profile-fields span{display:block;font-size:11px;color:var(--color-text-muted)}.summary-card strong{display:block;margin-top:5px;font-size:16px}.profile-section{display:grid;gap:11px}.section-heading h2{margin:0;font-size:16px}.section-heading p{margin:3px 0 0;font-size:12px;color:var(--color-text-muted)}.profile-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.profile-fields>div{padding:10px;border-radius:9px;background:rgba(255,255,255,.025);border:1px solid var(--color-border-default);overflow:hidden}.profile-fields strong{display:block;margin-top:4px;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.json-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.json-groups>div{padding:10px;border:1px solid var(--color-border-default);border-radius:9px}.json-groups h3{margin:0 0 8px;font-size:13px}.key-values{display:flex;gap:6px;flex-wrap:wrap}.key-values span{font-size:11px;padding:4px 6px;background:var(--color-bg-hover);border-radius:5px}.key-values b{margin-left:4px}.container-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.record-container{display:flex;align-items:center;gap:10px;text-align:left;padding:11px;border:1px solid var(--color-border-default);border-radius:10px;background:rgba(255,255,255,.022);color:var(--color-text-primary);cursor:pointer}.record-container:hover{border-color:#4987b6;background:rgba(66,148,218,.08)}.container-icon{width:27px;height:27px;display:grid;place-items:center;border-radius:7px;background:rgba(67,155,232,.15);color:#8acaff;font-size:12px}.container-text{min-width:0;flex:1}.container-text b,.container-text small{display:block}.container-text b{font-size:13px}.container-text small{margin-top:3px;font-size:11px;color:var(--color-text-muted)}.container-arrow{font-size:22px;color:var(--color-text-muted)}.record-modal{position:fixed;inset:0;z-index:120;background:rgba(3,8,12,.68);display:grid;place-items:center;padding:20px}.record-panel{width:min(720px,100%);max-height:min(720px,calc(var(--app-viewport-height) - 40px));display:flex;flex-direction:column;background:var(--color-bg-panel);border:1px solid var(--color-border-default);border-radius:15px;box-shadow:0 25px 80px #0008}.record-panel>header{display:flex;justify-content:space-between;gap:15px;padding:16px 18px;border-bottom:1px solid var(--color-border-default)}.record-panel h2{margin:0;font-size:18px}.record-panel p{margin:4px 0 0;font-size:12px;color:var(--color-text-muted)}.modal-actions{display:flex;gap:7px}.record-body{overflow:auto;padding:12px;display:grid;gap:8px}.container-state{padding:28px;text-align:center;color:var(--color-text-muted)}.container-state.error{color:#ff9494}.record-item{min-height:48px;display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--color-border-default);border-radius:9px;background:rgba(255,255,255,.018)}.record-item img{width:34px;height:34px;border-radius:8px}.record-item b,.record-item small{display:block}.record-item b{font-size:13px}.record-item small{margin-top:3px;color:var(--color-text-muted);font-size:11px;word-break:break-word}.more-btn{justify-self:center;margin:5px}@media(max-width:700px){.profile-header{padding:14px;gap:10px;align-items:flex-start}.profile-avatar{width:48px;height:48px;border-radius:12px}.profile-title h1{font-size:18px}.profile-ids{font-size:10px}.close-btn{font-size:11px;padding:6px}.detail-scroll{padding:12px}.summary-grid,.container-grid,.json-groups{grid-template-columns:1fr 1fr}.profile-fields{grid-template-columns:1fr}.record-modal{padding:8px}.record-panel{max-height:calc(var(--app-viewport-height) - 16px)}.record-panel>header{padding:13px}.modal-actions button{font-size:11px;padding:6px}}
.server-playtime-list,.recent-session-list{display:grid;gap:8px}.server-playtime-item,.recent-session-item{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:11px 12px;border:1px solid var(--color-border-default);border-radius:10px;background:rgba(255,255,255,.022)}.server-playtime-item strong,.server-playtime-item small,.recent-session-item span,.recent-session-item strong{display:block}.server-playtime-item strong{font-size:13px;word-break:break-all}.server-playtime-item small,.empty-history,.recent-session-item strong{margin-top:4px;font-size:11px;color:var(--color-text-muted)}.server-playtime-item>b,.recent-session-item>b{color:#8acaff;white-space:nowrap}.recent-session-item span{font-size:12px;font-weight:700}.empty-history{padding:13px;border:1px dashed var(--color-border-default);border-radius:10px}
.career-section{padding:14px;border:1px solid rgba(71,167,255,.2);border-radius:12px;background:linear-gradient(120deg,rgba(38,142,235,.075),transparent)}.career-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}.career-card{min-width:0;padding:11px;border:1px solid var(--color-border-default);border-radius:10px;background:rgba(0,0,0,.12)}.career-card span,.career-card small{display:block;color:var(--color-text-muted);font-size:10px}.career-card strong{display:block;margin:5px 0;color:#a9d7ff;font-size:20px}.match-result-record{display:grid;gap:8px;width:100%}.match-result-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.match-result-heading>div{min-width:0}.match-result-heading b,.match-result-heading small{display:block}.match-result-heading small{margin-top:3px}.match-result-heading>span{padding:3px 7px;border-radius:999px;font-size:10px;font-weight:800}.match-result-heading>span.won{color:#8de8b0;background:rgba(45,180,102,.14)}.match-result-heading>span.lost{color:#ff9d9d;background:rgba(229,75,75,.14)}.match-result-stats{display:flex;gap:7px;flex-wrap:wrap}.match-result-stats>span{padding:4px 7px;border:1px solid var(--color-border-soft);border-radius:6px;color:var(--color-text-muted);font-size:10px}.match-result-stats b{display:inline;color:var(--color-text-primary);font-size:11px}@media(max-width:1050px){.career-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:700px){.career-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.violation-summary-section{padding:14px;border:1px solid rgba(239,68,68,.2);border-radius:12px;background:linear-gradient(120deg,rgba(239,68,68,.055),transparent)}.violation-summary-section .section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.violation-total{color:#fca5a5;font-size:15px}.violation-count-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.violation-count-grid article{padding:10px;border:1px solid var(--color-border-default);border-radius:9px;background:rgba(0,0,0,.1)}.violation-count-grid span,.violation-count-grid small{display:block;color:var(--color-text-muted);font-size:10px}.violation-count-grid b{display:block;margin-top:4px;font-size:12px}.violation-count-grid strong{display:block;margin:5px 0;color:#fecaca;font-size:18px}.violation-event{display:grid;gap:3px;width:100%}.violation-event>span{color:#fca5a5;font-size:9px;font-weight:800}.violation-event p{margin:2px 0;color:var(--color-text-secondary);font-size:12px;line-height:1.45}.violation-event small{color:var(--color-text-muted)}
@media(max-width:900px){.violation-count-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
