<template>
  <section class="death-quote-page">
    <PageHeader eyebrow="KILL ONLY · PRIVATE ADMINWARN" title="死亡名言警告" subtitle="只在死亡事件触发。Wound / 击倒、伤害和回放事件均不会发送。">
      <template #actions>
        <button class="btn ghost" :disabled="loading" @click="load">刷新</button>
        <button class="btn primary" :disabled="saving" @click="save">{{ saving ? "保存中…" : "保存配置" }}</button>
      </template>
    </PageHeader>

    <div v-if="error" class="error">{{ error }}</div>

    <section class="control-panel">
      <div class="switch-card">
        <div>
          <p class="eyebrow">状态</p>
          <h2>{{ draft.enabled ? "死亡名言已启用" : "死亡名言未启用" }}</h2>
          <p>仅向死亡玩家私发一条随机名言。</p>
        </div>
        <label class="switch">
          <input v-model="draft.enabled" type="checkbox">
          <span></span>
        </label>
      </div>

      <div class="probability-card">
        <div class="probability-head">
          <div><p class="eyebrow">每次 Kill 触发概率</p><strong>{{ probability }}<small>%</small></strong></div>
          <span class="status-dot" :data-ok="state?.subscribed === true">{{ state?.subscribed ? "事件已订阅" : "事件未订阅" }}</span>
        </div>
        <input v-model.number="draft.triggerProbabilityPercent" class="range" type="range" min="0" max="100">
        <div class="range-labels"><span>0% 不发送</span><span>100% 每次发送</span></div>
      </div>

      <div class="live-card">
        <p class="eyebrow">本次运行</p>
        <div class="stat-line"><strong>{{ state?.triggered ?? 0 }}</strong><span>已发送</span></div>
        <div class="micro-stats"><span>Kill {{ state?.killEvents ?? 0 }}</span><span>跳过 {{ state?.skipped ?? 0 }}</span><span>失败 {{ state?.failed ?? 0 }}</span></div>
        <p class="last-sent">最后发送：{{ formatTime(state?.lastSentAt) }}</p>
      </div>
    </section>

    <section class="workspace">
      <PageCard class="quote-card">
        <template #title>
          <div><p class="eyebrow">QUOTE LIBRARY</p><h2>名言库 <span>{{ enabledQuoteCount }} / {{ draft.quotes.length }} 已启用</span></h2></div>
        </template>
        <template #actions><button class="btn add" @click="addQuote">＋ 新增名言</button></template>

        <div class="quote-list">
          <article v-for="(quote, index) in draft.quotes" :key="quote.id" class="quote-row" :class="{ disabled: !quote.enabled }">
            <span class="order">{{ String(index + 1).padStart(2, "0") }}</span>
            <textarea v-model.trim="quote.text" maxlength="180" rows="2" placeholder="输入死亡后显示给玩家的名言"></textarea>
            <label class="quote-switch" :title="quote.enabled ? '点击停用' : '点击启用'"><input v-model="quote.enabled" type="checkbox"><span>{{ quote.enabled ? "启用" : "停用" }}</span></label>
            <button class="remove" title="删除名言" @click="draft.quotes.splice(index, 1)">×</button>
          </article>
          <div v-if="!draft.quotes.length" class="empty-state">
            <strong>名言库为空</strong><span>新增至少一条名言后，功能才会实际发送内容。</span><button class="btn ghost" @click="addQuote">添加第一条名言</button>
          </div>
        </div>
      </PageCard>

      <PageCard class="history-card">
        <template #title><div><p class="eyebrow">LATEST ACTIVITY</p><h2>近期触发</h2></div></template>
        <template #actions><button class="btn ghost tiny" @click="clearHistory">清空</button></template>
        <div class="history">
          <article v-for="item in history.slice(0, 8)" :key="item.id" class="history-row">
            <span class="result" :data-type="item.success ? 'ok' : item.skipped ? 'skip' : 'fail'">{{ item.success ? "已发" : item.skipped ? "跳过" : "失败" }}</span>
            <div><strong>{{ item.victim || "未知玩家" }}</strong><p>{{ item.quote || item.reason || item.error || "-" }}</p></div>
            <time>{{ formatShortTime(item.at) }}</time>
          </article>
          <div v-if="!history.length" class="empty-history">尚无死亡名言的运行记录。</div>
        </div>
      </PageCard>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import { useUiStore } from "../stores/ui.store";

const ui = useUiStore();
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const state = ref<any>(null);
const draft = reactive({ enabled: false, triggerProbabilityPercent: 100, quotes: [] as Array<{ id: string; text: string; enabled: boolean }> });
const history = computed(() => Array.isArray(state.value?.history) ? state.value.history : []);
const probability = computed(() => Math.max(0, Math.min(100, Number(draft.triggerProbabilityPercent) || 0)));
const enabledQuoteCount = computed(() => draft.quotes.filter(quote => quote.enabled && quote.text.trim()).length);

function apply(data: any) {
  state.value = data;
  const config = data?.config ?? {};
  draft.enabled = config.enabled === true;
  draft.triggerProbabilityPercent = Number(config.triggerProbabilityPercent ?? 100);
  draft.quotes.splice(0, draft.quotes.length, ...(Array.isArray(config.quotes) ? JSON.parse(JSON.stringify(config.quotes)) : []));
}

async function load() {
  loading.value = true; error.value = "";
  try { const response = await apiGet<any>("/api/plugins/death-quote-warning/state"); apply(response.data); }
  catch (err) { error.value = err instanceof Error ? err.message : String(err); }
  finally { loading.value = false; }
}

async function save() {
  saving.value = true;
  try {
    const quotes = draft.quotes.map((quote, index) => ({ id: quote.id || `quote-${index + 1}`, text: quote.text.trim(), enabled: quote.enabled !== false })).filter(quote => quote.text);
    const response = await apiPost<any>("/api/plugins/death-quote-warning/config", { enabled: draft.enabled, triggerProbabilityPercent: probability.value, quotes });
    apply(response.data);
    ui.pushToast({ title: "保存成功", message: `死亡名言已保存；当前启用 ${enabledQuoteCount.value} 条。`, tone: "ok" });
  } catch (err) { ui.pushToast({ title: "保存失败", message: err instanceof Error ? err.message : String(err), tone: "error" }); }
  finally { saving.value = false; }
}

function addQuote() { draft.quotes.push({ id: `quote-${Date.now().toString(36)}`, text: "", enabled: true }); }
async function clearHistory() {
  try { const response = await apiPost<any>("/api/plugins/death-quote-warning/clear", {}); apply(response.data); }
  catch (err) { ui.pushToast({ title: "清空失败", message: err instanceof Error ? err.message : String(err), tone: "error" }); }
}
function formatTime(value: any) { if (!value) return "尚未发送"; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false }); }
function formatShortTime(value: any) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
onMounted(load);
</script>

<style scoped>
.death-quote-page{display:grid;gap:16px;padding:16px;max-width:1560px;margin:0 auto}.control-panel{display:grid;grid-template-columns:1.1fr 1.25fr .8fr;gap:12px}.switch-card,.probability-card,.live-card{border:1px solid var(--color-border-soft);border-radius:12px;padding:16px;background:linear-gradient(135deg,color-mix(in srgb,var(--color-bg-elevated) 92%,transparent),rgba(30,41,59,.28));min-width:0}.eyebrow{margin:0 0 5px;color:var(--color-text-muted);font-size:10px;font-weight:800;letter-spacing:.12em}.switch-card{display:flex;align-items:center;justify-content:space-between;gap:16px}.switch-card h2,.quote-card h2,.history-card h2{margin:0;color:var(--color-text-primary);font-size:17px}.switch-card p:not(.eyebrow){margin:6px 0 0;color:var(--color-text-muted);font-size:12px}.switch{position:relative;width:48px;height:27px;flex:0 0 auto}.switch input{opacity:0;width:0;height:0}.switch span{position:absolute;inset:0;border-radius:999px;background:#475569;cursor:pointer;transition:.2s}.switch span::after{content:"";position:absolute;width:21px;height:21px;left:3px;top:3px;border-radius:50%;background:#fff;transition:.2s}.switch input:checked+span{background:#22c55e}.switch input:checked+span::after{transform:translateX(21px)}.probability-head{display:flex;justify-content:space-between;gap:12px;align-items:start}.probability-head strong{color:#93c5fd;font-size:32px;line-height:1}.probability-head small{font-size:15px;margin-left:2px}.status-dot{border:1px solid rgba(248,113,113,.35);border-radius:999px;padding:4px 8px;color:#fca5a5;font-size:11px;white-space:nowrap}.status-dot[data-ok="true"]{color:#86efac;border-color:rgba(134,239,172,.35)}.range{width:100%;margin:14px 0 7px;accent-color:#60a5fa}.range-labels,.micro-stats{display:flex;justify-content:space-between;color:var(--color-text-muted);font-size:11px}.stat-line{display:flex;align-items:baseline;gap:8px}.stat-line strong{color:#86efac;font-size:30px}.stat-line span{color:var(--color-text-secondary);font-size:12px}.last-sent{margin:12px 0 0;color:var(--color-text-muted);font-size:11px}.workspace{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(340px,.8fr);gap:16px;align-items:start}.quote-card :deep(.page-card__title),.history-card :deep(.page-card__title){display:flex;align-items:center}.quote-card h2 span{margin-left:6px;color:var(--color-text-muted);font-size:12px;font-weight:500}.quote-list,.history{display:grid;gap:8px}.quote-row{display:grid;grid-template-columns:32px minmax(0,1fr) 54px 30px;gap:8px;align-items:center;border:1px solid var(--color-border-soft);border-radius:10px;padding:9px;background:rgba(255,255,255,.018)}.quote-row:focus-within{border-color:rgba(96,165,250,.55);background:rgba(59,130,246,.05)}.quote-row.disabled{opacity:.55}.order{color:var(--color-text-muted);font:700 11px ui-monospace,SFMono-Regular,Consolas}.quote-row textarea{width:100%;resize:vertical;border:0;outline:0;background:transparent;color:var(--color-text-primary);font:13px/1.45 inherit}.quote-row textarea::placeholder{color:var(--color-text-muted)}.quote-switch input{display:none}.quote-switch span{display:block;border:1px solid var(--color-border-soft);border-radius:999px;padding:4px 0;text-align:center;color:var(--color-text-muted);font-size:10px;cursor:pointer}.quote-switch input:checked+span{color:#86efac;border-color:rgba(134,239,172,.4);background:rgba(34,197,94,.08)}.remove,.btn{border:1px solid var(--color-border-default);border-radius:8px;background:transparent;color:var(--color-text-primary);padding:7px 10px;cursor:pointer;font-weight:700}.btn.primary,.btn.add{border-color:rgba(96,165,250,.5);background:rgba(59,130,246,.14);color:#bfdbfe}.btn.tiny{padding:5px 8px;font-size:11px}.remove{height:28px;padding:0;color:#fca5a5;font-size:20px}.empty-state{display:grid;justify-items:center;gap:7px;padding:42px 18px;border:1px dashed var(--color-border-default);border-radius:10px;color:var(--color-text-muted);font-size:12px}.empty-state strong{color:var(--color-text-secondary);font-size:14px}.history-row{display:grid;grid-template-columns:38px minmax(0,1fr) 62px;gap:9px;align-items:start;border-bottom:1px solid var(--color-border-soft);padding:9px 0}.history-row:last-child{border-bottom:0}.history-row strong{display:block;color:var(--color-text-secondary);font-size:12px}.history-row p{margin:3px 0 0;color:var(--color-text-muted);font-size:11px;line-height:1.4;word-break:break-word}.history-row time{color:var(--color-text-muted);font-size:10px;text-align:right}.result{border-radius:5px;padding:3px 0;text-align:center;font-size:10px;font-weight:800;color:#fca5a5;background:rgba(248,113,113,.1)}.result[data-type="ok"]{color:#86efac;background:rgba(34,197,94,.1)}.result[data-type="skip"]{color:#fcd34d;background:rgba(234,179,8,.1)}.empty-history{padding:34px 12px;text-align:center;color:var(--color-text-muted);font-size:12px}.error{padding:10px 12px;border:1px solid rgba(248,113,113,.4);border-radius:10px;color:#fca5a5;background:rgba(127,29,29,.13)}@media(max-width:1050px){.control-panel,.workspace{grid-template-columns:1fr}.live-card{display:grid;grid-template-columns:auto 1fr;gap:8px}.last-sent{grid-column:1/-1}}@media(max-width:640px){.death-quote-page{padding:10px}.quote-row{grid-template-columns:26px minmax(0,1fr) 30px}.quote-switch{display:none}.control-panel{gap:8px}}
</style>
