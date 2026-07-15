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

const containerMeta: Record<string, { title: string; icon: string }> = {
  "steam-friends": { title: "Steam 好友", icon: "♟" }, aliases: { title: "历史名称", icon: "A" }, ips: { title: "IP 历史", icon: "◎" }, sessions: { title: "进退服记录", icon: "↔" },
  tags: { title: "标签", icon: "#" }, violations: { title: "违规记录", icon: "!" }, reports: { title: "举报记录", icon: "⚑" }, commands: { title: "管理命令", icon: ">_" },
  matches: { title: "对局历史", icon: "▣" }, "ladder-history": { title: "天梯变动", icon: "↕" }, "squad-records": { title: "小队记录", icon: "⌘" }, audit: { title: "网页操作审计", icon: "◷" },
};
const containers = computed(() => (props.detail?.containers || []).map((row: any) => ({ ...row, ...(containerMeta[row.key] || { title: row.key, icon: "•" }) })));
const summaryCards = computed(() => [
  { label: "Steam 时长", value: formatHours(props.detail?.summary?.steamGameSeconds) }, { label: "服务器时长", value: formatHours(props.detail?.summary?.serverSeconds) },
  { label: "暖服时长", value: formatHours(props.detail?.summary?.warmupSeconds) }, { label: "对局", value: String(props.detail?.summary?.totalMatches ?? 0) },
  { label: "暖服分", value: formatValue((props.detail?.summary?.assets || {}).warmupPoints ?? 0) }, { label: "权限组", value: player.value.permission_group || "default" },
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
function formatValue(value: unknown) { return typeof value === "object" ? JSON.stringify(value) : new Intl.NumberFormat(currentLocale.value).format(Number.isFinite(Number(value)) ? Number(value) : 0); }
function primaryLine(item: any) { return String(item.alias_name || item.ip || item.tag_value || item.violation_label || item.violation_key || item.reason || item.command_text || item.map_name || item.kind || item.action || `${item.old_rating ?? ""} → ${item.new_rating ?? ""}` || "记录"); }
function secondaryLine(item: any) { const time = item.seen_at || item.joined_at || item.last_at || item.created_at || item.started_at || item.changed_at || item.time_ms || item.created_at_ms || item.updated_at; const extras = [item.status, item.relation, item.squad_name, item.team_name, item.result, item.command_result].filter(Boolean); return `${extras.join(" · ")}${extras.length && time ? " · " : ""}${formatTime(time)}`; }
</script>

<style scoped>
.db-detail{height:100%;display:flex;flex-direction:column;overflow:hidden;background:var(--color-bg-panel);border:1px solid var(--color-border-default);border-radius:16px}.detail-placeholder{flex:1;display:grid;place-content:center;gap:12px;text-align:center;color:var(--color-text-muted)}.placeholder-icon{font-size:44px;opacity:.35}.profile-header{display:flex;gap:15px;align-items:center;padding:18px 20px;border-bottom:1px solid var(--color-border-default);background:linear-gradient(115deg,rgba(64,153,255,.13),transparent 55%)}.profile-avatar{width:68px;height:68px;border-radius:16px;object-fit:cover;background:#18232c}.profile-avatar.fallback{display:grid;place-items:center;font-size:26px;font-weight:800}.profile-identity{min-width:0;flex:1}.profile-title{display:flex;align-items:center;gap:9px}.profile-title h1{margin:0;font-size:22px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.permission{font-size:11px;padding:3px 7px;border:1px solid var(--color-border-soft);border-radius:999px;color:var(--color-text-muted)}.profile-ids{display:flex;gap:8px;flex-wrap:wrap;margin-top:5px;font-size:12px;color:var(--color-text-muted)}.steam-link{display:inline-block;margin-top:8px;font-size:12px;color:#75baff}.close-btn,.modal-actions button,.more-btn{border:1px solid var(--color-border-soft);border-radius:8px;background:var(--color-bg-hover);color:var(--color-text-primary);padding:7px 10px;cursor:pointer}.detail-scroll{overflow:auto;padding:18px;display:grid;gap:20px}.summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.summary-card{padding:12px;border:1px solid var(--color-border-default);border-radius:11px;background:rgba(255,255,255,.025)}.summary-card span,.profile-fields span{display:block;font-size:11px;color:var(--color-text-muted)}.summary-card strong{display:block;margin-top:5px;font-size:16px}.profile-section{display:grid;gap:11px}.section-heading h2{margin:0;font-size:16px}.section-heading p{margin:3px 0 0;font-size:12px;color:var(--color-text-muted)}.profile-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.profile-fields>div{padding:10px;border-radius:9px;background:rgba(255,255,255,.025);border:1px solid var(--color-border-default);overflow:hidden}.profile-fields strong{display:block;margin-top:4px;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.json-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.json-groups>div{padding:10px;border:1px solid var(--color-border-default);border-radius:9px}.json-groups h3{margin:0 0 8px;font-size:13px}.key-values{display:flex;gap:6px;flex-wrap:wrap}.key-values span{font-size:11px;padding:4px 6px;background:var(--color-bg-hover);border-radius:5px}.key-values b{margin-left:4px}.container-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.record-container{display:flex;align-items:center;gap:10px;text-align:left;padding:11px;border:1px solid var(--color-border-default);border-radius:10px;background:rgba(255,255,255,.022);color:var(--color-text-primary);cursor:pointer}.record-container:hover{border-color:#4987b6;background:rgba(66,148,218,.08)}.container-icon{width:27px;height:27px;display:grid;place-items:center;border-radius:7px;background:rgba(67,155,232,.15);color:#8acaff;font-size:12px}.container-text{min-width:0;flex:1}.container-text b,.container-text small{display:block}.container-text b{font-size:13px}.container-text small{margin-top:3px;font-size:11px;color:var(--color-text-muted)}.container-arrow{font-size:22px;color:var(--color-text-muted)}.record-modal{position:fixed;inset:0;z-index:120;background:rgba(3,8,12,.68);display:grid;place-items:center;padding:20px}.record-panel{width:min(720px,100%);max-height:min(720px,calc(100vh - 40px));display:flex;flex-direction:column;background:var(--color-bg-panel);border:1px solid var(--color-border-default);border-radius:15px;box-shadow:0 25px 80px #0008}.record-panel>header{display:flex;justify-content:space-between;gap:15px;padding:16px 18px;border-bottom:1px solid var(--color-border-default)}.record-panel h2{margin:0;font-size:18px}.record-panel p{margin:4px 0 0;font-size:12px;color:var(--color-text-muted)}.modal-actions{display:flex;gap:7px}.record-body{overflow:auto;padding:12px;display:grid;gap:8px}.container-state{padding:28px;text-align:center;color:var(--color-text-muted)}.container-state.error{color:#ff9494}.record-item{min-height:48px;display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--color-border-default);border-radius:9px;background:rgba(255,255,255,.018)}.record-item img{width:34px;height:34px;border-radius:8px}.record-item b,.record-item small{display:block}.record-item b{font-size:13px}.record-item small{margin-top:3px;color:var(--color-text-muted);font-size:11px;word-break:break-word}.more-btn{justify-self:center;margin:5px}@media(max-width:700px){.profile-header{padding:14px;gap:10px;align-items:flex-start}.profile-avatar{width:48px;height:48px;border-radius:12px}.profile-title h1{font-size:18px}.profile-ids{font-size:10px}.close-btn{font-size:11px;padding:6px}.detail-scroll{padding:12px}.summary-grid,.container-grid,.json-groups{grid-template-columns:1fr 1fr}.profile-fields{grid-template-columns:1fr}.record-modal{padding:8px}.record-panel{max-height:calc(100vh - 16px)}.record-panel>header{padding:13px}.modal-actions button{font-size:11px;padding:6px}}
</style>
