<template>
  <section class="death-quote-page">
    <PageHeader eyebrow="Broadcast Ops" title="死亡名言警告" subtitle="仅在 Kill（死亡）事件发生时，按概率向死亡玩家发送一条随机名言；Wound/击倒不会触发。">
      <template #actions>
        <button class="btn ghost" :disabled="loading" @click="load">刷新</button>
        <button class="btn primary" :disabled="saving" @click="save">{{ saving ? "保存中..." : "保存配置" }}</button>
      </template>
    </PageHeader>
    <div v-if="error" class="error">{{ error }}</div>
    <div class="grid">
      <PageCard title="触发设置">
        <label class="toggle"><span>启用死亡名言警告</span><input v-model="draft.enabled" type="checkbox"></label>
        <label class="field"><span>触发概率（%）</span><input v-model.number="draft.triggerProbabilityPercent" type="number" min="0" max="100"></label>
        <p class="hint">每次确认的 Kill/death 独立抽取。概率为 0 时永不发送，100 时每次都发送。</p>
      </PageCard>
      <PageCard title="运行状态">
        <dl class="metrics">
          <div><dt>Kill 事件</dt><dd>{{ state?.killEvents ?? 0 }}</dd></div><div><dt>已发送</dt><dd>{{ state?.triggered ?? 0 }}</dd></div>
          <div><dt>已跳过</dt><dd>{{ state?.skipped ?? 0 }}</dd></div><div><dt>失败</dt><dd>{{ state?.failed ?? 0 }}</dd></div>
        </dl>
        <p class="hint">事件订阅：{{ state?.subscribed ? "正常" : "未订阅" }}；最后发送：{{ formatTime(state?.lastSentAt) }}</p>
      </PageCard>
    </div>
    <PageCard title="名言列表">
      <template #actions><button class="btn ghost" @click="addQuote">新增名言</button></template>
      <div class="quotes">
        <article v-for="(quote,index) in draft.quotes" :key="quote.id" class="quote">
          <label class="toggle compact"><span>启用</span><input v-model="quote.enabled" type="checkbox"></label>
          <textarea v-model.trim="quote.text" maxlength="180" rows="2" placeholder="输入死亡后显示给玩家的名言"></textarea>
          <button class="remove" title="删除" @click="draft.quotes.splice(index,1)">×</button>
        </article>
        <p v-if="!draft.quotes.length" class="empty">尚未添加名言；启用后也不会发送。</p>
      </div>
    </PageCard>
    <PageCard title="发送历史">
      <template #actions><button class="btn ghost" @click="clearHistory">清空历史</button></template>
      <table><thead><tr><th>时间</th><th>玩家</th><th>结果</th><th>名言 / 原因</th></tr></thead>
        <tbody><tr v-if="!history.length"><td colspan="4" class="empty">暂无记录。</td></tr><tr v-for="item in history" :key="item.id"><td>{{ formatTime(item.at) }}</td><td>{{ item.victim || "-" }}</td><td>{{ item.success ? "已发送" : item.skipped ? "跳过" : "失败" }}</td><td>{{ item.quote || item.reason || item.error || "-" }}</td></tr></tbody>
      </table>
    </PageCard>
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import { useUiStore } from "../stores/ui.store";
const ui=useUiStore(); const loading=ref(false); const saving=ref(false); const error=ref(""); const state=ref<any>(null);
const draft=reactive({enabled:false,triggerProbabilityPercent:100,quotes:[] as Array<{id:string;text:string;enabled:boolean}>});
const history=computed(()=>Array.isArray(state.value?.history)?state.value.history:[]);
function apply(data:any){ state.value=data; const config=data?.config??{}; draft.enabled=config.enabled===true; draft.triggerProbabilityPercent=Number(config.triggerProbabilityPercent??100); draft.quotes.splice(0,draft.quotes.length,...(Array.isArray(config.quotes)?JSON.parse(JSON.stringify(config.quotes)):[])); }
async function load(){loading.value=true;error.value="";try{const r=await apiGet<any>("/api/plugins/death-quote-warning/state");apply(r.data)}catch(e){error.value=e instanceof Error?e.message:String(e)}finally{loading.value=false}}
async function save(){saving.value=true;try{const quotes=draft.quotes.map((q,i)=>({id:q.id||`quote-${i+1}`,text:q.text.trim(),enabled:q.enabled!==false})).filter(q=>q.text);const r=await apiPost<any>("/api/plugins/death-quote-warning/config",{enabled:draft.enabled,triggerProbabilityPercent:Math.max(0,Math.min(100,Number(draft.triggerProbabilityPercent)||0)),quotes});apply(r.data);ui.pushToast({title:"保存成功",message:"死亡名言配置已保存。",tone:"ok"})}catch(e){ui.pushToast({title:"保存失败",message:e instanceof Error?e.message:String(e),tone:"error"})}finally{saving.value=false}}
function addQuote(){draft.quotes.push({id:`quote-${Date.now().toString(36)}`,text:"",enabled:true})}
async function clearHistory(){try{const r=await apiPost<any>("/api/plugins/death-quote-warning/clear",{});apply(r.data)}catch(e){ui.pushToast({title:"清空失败",message:e instanceof Error?e.message:String(e),tone:"error"})}}
function formatTime(value:any){if(!value)return "-";const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString("zh-CN",{hour12:false})}
onMounted(load);
</script>
<style scoped>
.death-quote-page{display:grid;gap:16px;padding:16px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.toggle{display:flex;justify-content:space-between;align-items:center;gap:12px;color:var(--color-text-secondary)}.field{display:grid;gap:6px;margin-top:14px;color:var(--color-text-muted);font-size:12px}.field input,textarea{border:1px solid var(--color-border-default);border-radius:8px;background:var(--color-bg-elevated);color:var(--color-text-primary);padding:8px}.hint,.empty{color:var(--color-text-muted);font-size:12px;line-height:1.5}.metrics{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:0}.metrics div{border:1px solid var(--color-border-soft);border-radius:8px;padding:8px}.metrics dt{color:var(--color-text-muted);font-size:11px}.metrics dd{margin:3px 0 0;font-weight:800}.quotes{display:grid;gap:8px}.quote{display:grid;grid-template-columns:80px 1fr 32px;gap:8px;align-items:center;border:1px solid var(--color-border-soft);border-radius:8px;padding:8px}.compact{font-size:12px}.remove,.btn{border:1px solid var(--color-border-default);border-radius:8px;background:transparent;color:var(--color-text-primary);padding:7px 10px;cursor:pointer}.remove{color:#fca5a5;font-size:20px;padding:0;height:32px}.btn.primary{background:rgba(96,165,250,.15);border-color:rgba(96,165,250,.5);color:#93c5fd}.error{padding:10px;border:1px solid rgba(248,113,113,.4);border-radius:8px;color:#fca5a5}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid var(--color-border-soft);padding:9px;text-align:left}th{color:var(--color-text-muted)}@media(max-width:800px){.grid{grid-template-columns:1fr}.quote{grid-template-columns:1fr 32px}.quote textarea{grid-column:1/3}}
</style>
