<template>
  <section class="page"><header><div><small>SQUAD MODERATION</small><h1>弹劾队长</h1><p>实时查看玩家交互、加权投票、执行结果和审计记录。</p></div><div><button @click="refresh">刷新</button><button @click="clearCooldowns">清除冷却</button></div></header>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="metrics"><article><span>当前交互</span><b>{{ data.interactions?.length ?? 0 }}</b></article><article><span>进行中投票</span><b>{{ data.votes?.length ?? 0 }}</b></article><article><span>历史记录</span><b>{{ data.history?.length ?? 0 }}</b></article></div>
    <article class="panel"><h2>当前交互</h2><table><thead><tr><th>玩家</th><th>阶段</th><th>目标</th><th>剩余</th><th>错误输入</th></tr></thead><tbody><tr v-for="x in data.interactions" :key="x.sessionId"><td>{{ x.context?.actor?.name }}</td><td>{{ x.stageId }}</td><td>{{ x.context?.target?.squadId ?? '--' }}</td><td>{{ seconds(x.expiresAt) }}</td><td>{{ x.invalidInputCount }}</td></tr><tr v-if="!data.interactions?.length"><td colspan="5">暂无交互</td></tr></tbody></table></article>
    <article class="panel"><h2>当前投票</h2><table><thead><tr><th>发起人</th><th>目标</th><th>方式</th><th>阵营快照</th><th>赞成/反对</th><th>剩余</th><th></th></tr></thead><tbody><tr v-for="v in data.votes" :key="v.voteId"><td>{{ v.initiator?.name }}</td><td>{{ v.target?.name }} · {{ v.target?.squadId }}队</td><td>{{ v.action === 'disband' ? '解散小队' : '移出队长' }}</td><td>{{ v.teamPlayerCount }}</td><td>{{ v.yesWeight }} / {{ v.noWeight }}</td><td>{{ seconds(v.expiresAt) }}</td><td><button @click="cancel(v.voteId)">取消投票</button></td></tr><tr v-if="!data.votes?.length"><td colspan="7">暂无进行中的投票</td></tr></tbody></table></article>
    <article class="panel"><h2>历史与审计</h2><table><thead><tr><th>时间</th><th>事件</th><th>原因</th><th>发起人</th><th>目标</th></tr></thead><tbody><tr v-for="x in data.audit" :key="`${x.at}-${x.type}`"><td>{{ time(x.at) }}</td><td>{{ x.type }}</td><td>{{ x.reason ?? '--' }}</td><td>{{ x.initiator?.name ?? x.vote?.initiator?.name ?? '--' }}</td><td>{{ x.target?.name ?? x.vote?.target?.name ?? '--' }}</td></tr><tr v-if="!data.audit?.length"><td colspan="5">暂无审计记录</td></tr></tbody></table></article>
  </section>
</template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
const data:any=reactive({interactions:[],votes:[],history:[],audit:[]}); const error=ref(""); let timer:number|undefined;
async function refresh(){try{const r:any=await apiGet("/api/plugins/squad-leader-impeachment/debug");Object.assign(data,r?.data??r??{});error.value="";}catch(e:any){error.value=e?.message??"读取弹劾状态失败";}}
async function cancel(voteId:string){await apiPost("/api/plugins/squad-leader-impeachment/cancel",{voteId});await refresh();} async function clearCooldowns(){await apiPost("/api/plugins/squad-leader-impeachment/cooldowns/clear");await refresh();}
function seconds(at:number){return `${Math.max(0,Math.ceil((Number(at)-Date.now())/1000))} 秒`;} function time(v:string){return v?new Date(v).toLocaleTimeString("zh-CN",{hour12:false}):"--";}
onMounted(()=>{refresh();timer=window.setInterval(refresh,2000);});onBeforeUnmount(()=>timer&&window.clearInterval(timer));
</script>
<style scoped>
.page{padding:24px;color:#e5edf7;background:#0b1220;min-height:100%}header{display:flex;justify-content:space-between;gap:16px;margin-bottom:18px}small{color:#60a5fa;letter-spacing:.12em}h1{margin:6px 0}p{color:#94a3b8;margin:0}button{background:#1e293b;color:#e5edf7;border:1px solid #475569;border-radius:6px;padding:7px 10px;margin-left:6px;cursor:pointer}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px}.metrics article,.panel{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:14px}.metrics span{color:#94a3b8;display:block}.metrics b{font-size:24px}.panel{margin-bottom:14px}.panel h2{margin-top:0;font-size:16px}table{width:100%;border-collapse:collapse}th,td{padding:9px;text-align:left;border-top:1px solid #243244;font-size:13px}.error{color:#fca5a5}@media(max-width:700px){.metrics{grid-template-columns:1fr}header{display:block}.panel{overflow:auto}}
</style>
