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
        <p class="eyebrow">名言选择规则</p>
        <strong>按权重随机</strong>
        <p class="rule-copy">每条名言可单独设置“权重”。已启用名言的实际选中概率会自动按总权重计算；权重为 0 则不会被选中。</p>
        <span class="status-dot" :data-ok="state?.subscribed === true">{{ state?.subscribed ? "事件已订阅" : "事件未订阅" }}</span>
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
            <header class="quote-row-head">
              <span class="order">名言 {{ String(index + 1).padStart(2, "0") }}</span>
              <label class="quote-probability"><span>权重</span><input v-model.number="quote.weight" type="number" inputmode="numeric" min="0" max="100000"><small>{{ quotePercentage(quote) }}</small></label><label class="quote-switch"><input v-model="quote.enabled" type="checkbox"><span>{{ quote.enabled ? "已启用" : "已停用" }}</span></label>
              <button class="remove" type="button" title="删除名言" @click="draft.quotes.splice(index, 1)">删除</button>
            </header>
            <label class="quote-field">
              <span>名言内容</span>
              <textarea v-model="quote.text" maxlength="180" rows="3" placeholder="输入死亡后显示给玩家的名言。支持直接按 Enter 换行。"></textarea>
              <small>{{ quote.text.length }} / 180</small>
            </label>
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
          <article v-for="item in history" :key="item.id" class="history-row">
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
const draft = reactive({ enabled: false, quotes: [] as Array<{ id: string; text: string; enabled: boolean; weight: number }> });
const history = computed(() => Array.isArray(state.value?.history) ? state.value.history : []);
const enabledQuoteCount = computed(() => draft.quotes.filter(quote => quote.enabled && quote.text.trim()).length);

function apply(data: any) {
  state.value = data;
  const config = data?.config ?? {};
  draft.enabled = config.enabled === true;
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
    const quotes = draft.quotes.map((quote, index) => ({ id: quote.id || `quote-${index + 1}`, text: quote.text.trim(), enabled: quote.enabled !== false, weight: Math.max(0, Math.min(100000, Number(quote.weight) || 0)) })).filter(quote => quote.text);
    const response = await apiPost<any>("/api/plugins/death-quote-warning/config", { enabled: draft.enabled, quotes });
    apply(response.data);
    ui.pushToast({ title: "保存成功", message: `死亡名言已保存；当前启用 ${enabledQuoteCount.value} 条。`, tone: "ok" });
  } catch (err) { ui.pushToast({ title: "保存失败", message: err instanceof Error ? err.message : String(err), tone: "error" }); }
  finally { saving.value = false; }
}

function quotePercentage(quote: { enabled: boolean; weight: number }) { const total = draft.quotes.filter(item => item.enabled).reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0); return total > 0 && quote.enabled ? `${((Math.max(0, Number(quote.weight) || 0) / total) * 100).toFixed(1)}%` : "0%"; }
function addQuote() { draft.quotes.push({ id: `quote-${Date.now().toString(36)}`, text: "", enabled: true, weight: 1 }); }
async function clearHistory() {
  try { const response = await apiPost<any>("/api/plugins/death-quote-warning/clear", {}); apply(response.data); }
  catch (err) { ui.pushToast({ title: "清空失败", message: err instanceof Error ? err.message : String(err), tone: "error" }); }
}
function formatTime(value: any) { if (!value) return "尚未发送"; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false }); }
function formatShortTime(value: any) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
onMounted(load);
</script>

<style scoped>
.death-quote-page{display:grid;gap:16px;padding:16px;max-width:1560px;margin:0 auto;box-sizing:border-box;height:100%;min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}.control-panel{display:grid;grid-template-columns:1.1fr 1.25fr .8fr;gap:12px}.switch-card,.probability-card,.live-card{border:1px solid var(--color-border-soft);border-radius:12px;padding:16px;background:linear-gradient(135deg,color-mix(in srgb,var(--color-bg-elevated) 92%,transparent),rgba(30,41,59,.28));min-width:0}.eyebrow{margin:0 0 5px;color:var(--color-text-muted);font-size:10px;font-weight:800;letter-spacing:.12em}.switch-card{display:flex;align-items:center;justify-content:space-between;gap:16px}.switch-card h2,.quote-card h2,.history-card h2{margin:0;color:var(--color-text-primary);font-size:17px}.switch-card p:not(.eyebrow){margin:6px 0 0;color:var(--color-text-muted);font-size:12px}.switch{position:relative;width:48px;height:27px;flex:0 0 auto}.switch input{opacity:0;width:0;height:0}.switch span{position:absolute;inset:0;border-radius:999px;background:#475569;cursor:pointer;transition:.2s}.switch span::after{content:"";position:absolute;width:21px;height:21px;left:3px;top:3px;border-radius:50%;background:#fff;transition:.2s}.switch input:checked+span{background:#22c55e}.switch input:checked+span::after{transform:translateX(21px)}.probability-head{display:flex;justify-content:space-between;gap:12px;align-items:start}.probability-field>label,.quote-field>span{display:block;margin-bottom:6px;color:var(--color-text-secondary);font-size:12px;font-weight:700}.number-control{display:flex;align-items:center;width:150px;border:1px solid var(--color-border-default);border-radius:8px;background:var(--color-bg-elevated);overflow:hidden}.number-control input{width:100%;border:0;outline:0;background:transparent;color:var(--color-text-primary);padding:9px 10px;font-size:18px;font-weight:800}.number-control span{padding-right:10px;color:var(--color-text-muted);font-size:13px}.number-control:focus-within{border-color:#60a5fa;box-shadow:0 0 0 3px rgba(96,165,250,.12)}.status-dot{border:1px solid rgba(248,113,113,.35);border-radius:999px;padding:4px 8px;color:#fca5a5;font-size:11px;white-space:nowrap}.status-dot[data-ok="true"]{color:#86efac;border-color:rgba(134,239,172,.35)}.range{width:100%;margin:14px 0 7px;accent-color:#60a5fa}.range-labels,.micro-stats{display:flex;justify-content:space-between;color:var(--color-text-muted);font-size:11px}.stat-line{display:flex;align-items:baseline;gap:8px}.stat-line strong{color:#86efac;font-size:30px}.stat-line span{color:var(--color-text-secondary);font-size:12px}.last-sent{margin:12px 0 0;color:var(--color-text-muted);font-size:11px}.workspace{display:grid;min-width:0;min-height:0;grid-template-columns:minmax(0,1.45fr) minmax(340px,.8fr);gap:16px;align-items:start}.quote-card :deep(.page-card__title),.history-card :deep(.page-card__title){display:flex;align-items:center}.quote-card h2 span{margin-left:6px;color:var(--color-text-muted);font-size:12px;font-weight:500}.quote-list,.history{display:grid;gap:10px}.quote-row{display:grid;gap:10px;border:1px solid var(--color-border-soft);border-radius:10px;padding:12px;background:rgba(255,255,255,.018)}.quote-row:focus-within{border-color:rgba(96,165,250,.65);background:rgba(59,130,246,.05)}.quote-row.disabled{opacity:.58}.quote-row-head{display:flex;align-items:center;gap:8px}.order{color:var(--color-text-secondary);font-size:12px;font-weight:800}.quote-probability{display:grid;grid-template-columns:auto 56px auto;align-items:center;gap:5px;margin-left:auto;color:var(--color-text-muted);font-size:11px}.quote-probability input{width:56px;box-sizing:border-box;border:1px solid var(--color-border-default);border-radius:6px;background:var(--color-bg-elevated);color:var(--color-text-primary);padding:5px}.quote-probability small{color:#93c5fd;min-width:36px}.quote-switch.quote-switch input{display:none}.quote-switch span{display:block;border:1px solid var(--color-border-default);border-radius:6px;padding:5px 8px;color:var(--color-text-muted);font-size:11px;cursor:pointer}.quote-switch input:checked+span{color:#86efac;border-color:rgba(134,239,172,.4);background:rgba(34,197,94,.08)}.quote-field{display:grid;gap:6px}.quote-field textarea{width:100%;box-sizing:border-box;min-height:80px;resize:vertical;white-space:pre-wrap;border:1px solid var(--color-border-default);border-radius:8px;outline:0;background:var(--color-bg-elevated);color:var(--color-text-primary);padding:10px;font:13px/1.5 inherit}.quote-field textarea::placeholder{color:var(--color-text-muted)}.quote-field textarea:focus{border-color:#60a5fa;box-shadow:0 0 0 3px rgba(96,165,250,.12)}.quote-field small{justify-self:end;color:var(--color-text-muted);font-size:11px}.remove,.btn{border:1px solid var(--color-border-default);border-radius:8px;background:transparent;color:var(--color-text-primary);padding:7px 10px;cursor:pointer;font-weight:700}.remove{color:#fca5a5;border-color:rgba(248,113,113,.3);font-size:11px}.btn.primary,.btn.add{border-color:rgba(96,165,250,.5);background:rgba(59,130,246,.14);color:#bfdbfe}.btn.tiny{padding:5px 8px;font-size:11px}.empty-state{display:grid;justify-items:center;gap:7px;padding:42px 18px;border:1px dashed var(--color-border-default);border-radius:10px;color:var(--color-text-muted);font-size:12px}.empty-state strong{color:var(--color-text-secondary);font-size:14px}.history-row{display:grid;grid-template-columns:38px minmax(0,1fr) 62px;gap:9px;align-items:start;border-bottom:1px solid var(--color-border-soft);padding:9px 0}.history-row:last-child{border-bottom:0}.history-row strong{display:block;color:var(--color-text-secondary);font-size:12px}.history-row p{margin:3px 0 0;white-space:pre-wrap;color:var(--color-text-muted);font-size:11px;line-height:1.4;word-break:break-word}.history-row time{color:var(--color-text-muted);font-size:10px;text-align:right}.result{border-radius:5px;padding:3px 0;text-align:center;font-size:10px;font-weight:800;color:#fca5a5;background:rgba(248,113,113,.1)}.result[data-type="ok"]{color:#86efac;background:rgba(34,197,94,.1)}.result[data-type="skip"]{color:#fcd34d;background:rgba(234,179,8,.1)}.empty-history{padding:34px 12px;text-align:center;color:var(--color-text-muted);font-size:12px}.error{padding:10px 12px;border:1px solid rgba(248,113,113,.4);border-radius:10px;color:#fca5a5;background:rgba(127,29,29,.13)}@media(max-width:1050px){.control-panel,.workspace{grid-template-columns:1fr}.live-card{display:grid;grid-template-columns:auto 1fr;gap:8px}.last-sent{grid-column:1/-1}}@media(max-width:640px){.death-quote-page{padding:10px}.quote-row-head{flex-wrap:wrap}.quote-switch{margin-left:0}.control-panel{gap:8px}}
</style>