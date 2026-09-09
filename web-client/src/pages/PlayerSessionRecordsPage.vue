<template>
  <section class="page-shell">
    <h1 class="sr-only">进出服记录</h1>
    <WorkspaceToolbar><template #actions>
      <button class="btn" :disabled="loading" @click="loadState">{{ loading ? "刷新中…" : "刷新" }}</button>
      <button :class="['btn', autoRefresh ? 'live' : '']" @click="toggleAutoRefresh">{{ autoRefresh ? "实时刷新" : "开启实时刷新" }}</button>
      <button class="btn danger" :disabled="busy || !canClear" @click="clearRecords">{{ busy ? "清理中…" : "清空历史" }}</button>
    </template></WorkspaceToolbar>
    <div v-if="error" class="banner error">{{ error }}</div><div v-if="info" class="banner info">{{ info }}</div>
    <div class="overview">
      <article class="online-total"><span>当前服务器</span><strong>{{ state?.onlineCount ?? 0 }}</strong><b>名玩家在线</b><small>在线态会从进服、退服日志自动重建，重启面板后仍保留。</small></article>
      <article><span>累计进入</span><strong>{{ state?.joinCount ?? 0 }}</strong><small>最近：{{ formatTime(state?.lastJoinAt) }}</small></article>
      <article><span>累计离开</span><strong>{{ state?.leaveCount ?? 0 }}</strong><small>最近：{{ formatTime(state?.lastLeaveAt) }}</small></article>
      <article><span>历史事件</span><strong>{{ state?.totalCount ?? 0 }}</strong><small>最多保存 {{ state?.maxRecords ?? 0 }} 条</small></article>
    </div>
    <PageCard title="智能查询" description="名字、Steam64、EOS、IP、事件、服务器和对局 ID 都可直接搜索" compact>
      <div class="filters"><input v-model.trim="query" class="input" placeholder="搜索玩家、Steam64、EOS、IP、事件…" /><select v-model="kind" class="input"><option value="all">全部事件</option><option value="join">仅进服</option><option value="leave">仅离开</option></select><select v-model="server" class="input"><option value="">全部服务器</option><option v-for="value in servers" :key="value" :value="value">{{ value }}</option></select><select v-model.number="limit" class="input" @change="loadState"><option :value="200">最近 200 条</option><option :value="500">最近 500 条</option><option :value="1000">最近 1000 条</option></select></div>
      <div class="query-result">匹配 {{ events.length }} 条 <button v-if="query || kind !== 'all' || server" @click="reset">重置筛选</button></div>
    </PageCard>
    <div class="panes">
      <PageCard title="正在游戏" :description="'已确认在线 ' + online.length + ' 人'" compact body-mode="fill"><div class="scroll">
        <div v-if="!online.length" class="empty">暂无已确认的在线玩家</div>
        <article v-for="item in online" :key="item.id" class="online"><i></i><div><strong>{{ item.playerName || "未解析玩家" }}</strong><small>{{ identity(item) }}</small></div><aside><strong>{{ duration(item.durationMs) }}</strong><small>{{ item.serverId || "未知服务器" }} · {{ formatTime(item.joinedAt || item.time) }}</small></aside></article>
      </div></PageCard>
      <PageCard title="事件时间线" :description="'按发生时间倒序 · 当前显示 ' + events.length + ' 条'" compact body-mode="fill"><div class="scroll timeline">
        <div v-if="!events.length" class="empty">没有符合筛选条件的记录</div>
        <article v-for="item in events" :key="item.id" :class="['event',item.kind]"><div class="rail"><i></i></div><div><header><strong>{{ item.playerName || "未解析玩家" }}</strong><span>{{ item.kind === "join" ? "进入服务器" : "离开服务器" }}</span></header><p>{{ item.serverId || "未知服务器" }}<template v-if="item.matchId"> · 对局 {{ item.matchId }}</template></p><small>{{ identity(item) }}<template v-if="item.eventName"> · {{ item.eventName }}</template></small></div><time>{{ formatTime(item.time || item.at) }}</time></article>
      </div></PageCard>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed,onMounted,onUnmounted,ref } from "vue";
import { apiGet,apiPost } from "../app/apiClient";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";
import { useAuthStore } from "../stores/auth.store";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";
import PageCard from "../components/common/PageCard.vue";
type Row={id:string;kind:"join"|"leave";at?:string;time?:string;joinedAt?:string;durationMs?:number;eventName?:string;serverId?:string;matchId?:string;playerName?:string;eosId?:string;steam64Id?:string;ip?:string};
type State={enabled:boolean;maxRecords:number;joinCount:number;leaveCount:number;totalCount:number;onlineCount:number;lastJoinAt:string;lastLeaveAt:string;records:Row[];online:Row[]};
const auth=useAuthStore(),state=ref<State|null>(null),loading=ref(false),busy=ref(false),error=ref(""),info=ref(""),query=ref(""),kind=ref("all"),server=ref(""),limit=ref(500),autoRefresh=ref(true);let timer:number|null=null;
const canClear=computed(()=>auth.user?.isSuperAdmin===true),online=computed(()=>state.value?.online??[]);
const servers=computed(()=>Array.from(new Set([...(state.value?.records??[]),...(state.value?.online??[])].map(x=>x.serverId).filter(Boolean) as string[])).sort());
const events=computed(()=>{const q=query.value.toLowerCase();return(state.value?.records??[]).filter(x=>(kind.value==="all"||x.kind===kind.value)&&(!server.value||x.serverId===server.value)&&(!q||[x.playerName,x.steam64Id,x.eosId,x.ip,x.eventName,x.serverId,x.matchId].some(v=>String(v??"").toLowerCase().includes(q))));});
onMounted(()=>{void loadState();setup();});onUnmounted(()=>{if(timer!=null)window.clearInterval(timer);});
function setup(){if(timer!=null)window.clearInterval(timer);timer=autoRefresh.value?window.setInterval(()=>{if(canAutoRefreshNow())void loadState();},2500):null;}function toggleAutoRefresh(){autoRefresh.value=!autoRefresh.value;setup();}function reset(){query.value="";kind.value="all";server.value="";}
async function loadState(){loading.value=true;error.value="";try{const r=await apiGet<{ok:boolean;data:State}>("/api/modules/player-session-records/state?limit="+limit.value);state.value=r.data??null;}catch(e){error.value=e instanceof Error?e.message:String(e);}finally{loading.value=false;}}
async function clearRecords(){if(!canClear.value){error.value="只有超级管理员可以清空历史记录。";return;}busy.value=true;try{await apiPost("/api/modules/player-session-records/clear",{});info.value="进出服历史已清空。";await loadState();}catch(e){error.value=e instanceof Error?e.message:String(e);}finally{busy.value=false;}}
function formatTime(v?:string|number|null){if(!v)return"暂无";const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString();}function identity(x:Row){return x.steam64Id?"Steam64 "+x.steam64Id:x.eosId?"EOS "+x.eosId:x.ip?"IP "+x.ip:"身份待解析";}function duration(v?:number){const s=Math.floor((v??0)/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h?h+"小时"+m+"分钟":m+"分钟";}
</script>
<style scoped>
.page-shell{display:grid;grid-template-rows:auto auto auto minmax(0,1fr);gap:16px;height:100%;min-height:0;padding:18px;overflow:hidden}.overview{display:grid;grid-template-columns:1.35fr repeat(3,1fr);gap:12px}.overview article{display:flex;min-height:108px;flex-direction:column;gap:6px;padding:15px;border:1px solid var(--line-soft,rgba(255,255,255,.1));border-radius:14px;background:rgba(255,255,255,.025)}.overview span,.overview small{font-size:12px;opacity:.7}.overview strong{font-size:25px;line-height:1.1}.overview small{margin-top:auto}.online-total{background:linear-gradient(135deg,rgba(67,160,71,.2),rgba(255,255,255,.025))!important}.online-total strong{font-size:36px!important;color:#74d680}.filters{display:grid;grid-template-columns:2fr repeat(3,1fr);gap:10px}.input{width:100%;min-width:0;padding:9px 10px;border:1px solid var(--line-soft,rgba(255,255,255,.12));border-radius:9px;background:rgba(255,255,255,.025);color:inherit}.query-result{display:flex;justify-content:space-between;margin-top:10px;font-size:12px;opacity:.75}.query-result button{border:0;background:none;color:#72b8ff;cursor:pointer}.panes{display:grid;grid-template-columns:.8fr 1.7fr;gap:16px;min-height:0}.scroll{height:100%;min-height:0;overflow:auto;padding:4px}.online{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:12px 10px;border-bottom:1px solid var(--line-soft,rgba(255,255,255,.07))}.online i{width:8px;height:8px;border-radius:50%;background:#63d471;box-shadow:0 0 0 4px rgba(99,212,113,.13)}.online div,.online aside{display:flex;min-width:0;flex-direction:column;gap:4px}.online aside{text-align:right;font-size:12px}.online small,.event small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;opacity:.65}.event{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:10px;min-height:72px;padding:10px 8px}.rail{display:flex;justify-content:center;position:relative}.rail:after{content:"";position:absolute;top:20px;bottom:-14px;width:1px;background:var(--line-soft,rgba(255,255,255,.1))}.event:last-child .rail:after{display:none}.rail i{position:relative;z-index:1;width:10px;height:10px;margin-top:6px;border-radius:50%;background:#6ed47a}.leave .rail i{background:#f5aa4c}.event header{display:flex;gap:8px;align-items:center}.event header strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.event header span{padding:2px 7px;border-radius:999px;font-size:11px;color:#8ee49a;background:rgba(99,212,113,.14);white-space:nowrap}.leave header span{color:#ffc371;background:rgba(245,170,76,.14)}.event p{margin:5px 0;font-size:12px;opacity:.78}.event time{padding-top:3px;font-size:11px;opacity:.62;white-space:nowrap}.empty{display:grid;place-items:center;height:100%;min-height:150px;opacity:.6}.btn{border:1px solid var(--line-soft,rgba(255,255,255,.16));background:rgba(255,255,255,.02);color:inherit;border-radius:8px;padding:8px 12px;cursor:pointer}.btn.live{background:rgba(82,196,26,.18);border-color:rgba(82,196,26,.48)}.btn.danger{background:rgba(255,77,79,.15);border-color:rgba(255,77,79,.45)}.banner{border-radius:10px;padding:10px 12px;font-size:13px}.error{background:rgba(255,77,79,.16)}.info{background:rgba(24,144,255,.14)}@media(max-width:1100px){.page-shell{overflow:auto;height:auto}.overview,.panes{grid-template-columns:1fr 1fr}.online-total{grid-column:span 2}.panes>:last-child{grid-column:span 2;min-height:460px}}@media(max-width:720px){.page-shell{padding:12px}.overview,.panes,.filters{grid-template-columns:1fr}.online-total,.panes>:last-child{grid-column:auto}.event{grid-template-columns:18px minmax(0,1fr)}.event time{grid-column:2;padding:0}.online{grid-template-columns:auto minmax(0,1fr)}.online aside{grid-column:2;text-align:left}}
</style>