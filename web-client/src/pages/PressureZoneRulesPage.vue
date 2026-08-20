<template>
  <main class="pressure-rule-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">SERVER RULES · PRESSURE ZONE</p>
        <h1>压家圈服规</h1>
        <p>插件会根据当前地图自动识别规则，并在换图后广播当前地图的明确压家圈。</p>
      </div>
      <button class="button primary" :disabled="broadcasting || !state?.announcement" @click="broadcast">
        {{ broadcasting ? "广播中…" : "再次广播当前地图规则" }}
      </button>
    </header>

    <section v-if="state" class="current-card" :class="{ unknown: !state.rule }">
      <div><span>当前地图</span><strong>{{ state.map || "等待地图数据" }}</strong></div>
      <div><span>当前规则</span><strong>{{ state.rule?.label || "未配置明确规则" }}</strong></div>
      <div><span>状态</span><strong>{{ state.lastBroadcastSuccess === false ? "广播失败" : state.lastBroadcastAt ? "已广播" : "待广播" }}</strong></div>
    </section>

    <section class="announcement-card" v-if="state">
      <h2>当前地图广播内容</h2>
      <pre>{{ state.announcement }}</pre>
      <small v-if="state.lastError" class="error">{{ state.lastError }}</small>
    </section>

    <section class="rule-grid">
      <article v-for="group in state?.mapRules || []" :key="group.id" class="rule-card" :class="{ active: group.id === state?.rule?.id }">
        <h2>{{ group.label }}</h2>
        <p>{{ group.maps.join("、") }}</p>
      </article>
    </section>

    <section class="temporary-card">
      <h2>压家圈缩圈暂行规定</h2>
      <p v-for="line in shrinkLines" :key="line">{{ line }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { broadcastPressureZoneRule, fetchPressureZoneRulesState, type PressureZoneRulesState } from "../app/pressureZoneRulesApi";

const state = ref<PressureZoneRulesState | null>(null);
const broadcasting = ref(false);
let timer: number | null = null;
const shrinkLines = computed(() => String(state.value?.temporaryShrinkRules ?? "").split("\n").filter(Boolean));

async function load() {
  try { state.value = await fetchPressureZoneRulesState(); } catch {}
}
async function broadcast() {
  broadcasting.value = true;
  try { await broadcastPressureZoneRule(); await load(); } finally { broadcasting.value = false; }
}
onMounted(() => { void load(); timer = window.setInterval(load, 5000); });
onUnmounted(() => { if (timer != null) window.clearInterval(timer); });
</script>

<style scoped>
.pressure-rule-page{padding:24px;max-width:1180px;margin:0 auto;color:#dbeafe}.page-header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:20px}.eyebrow{color:#5eead4;font-size:11px;letter-spacing:.12em}.page-header h1{margin:4px 0 8px}.page-header p{color:#94a3b8}.button{border:1px solid #334155;border-radius:8px;padding:9px 13px;background:#0f172a;color:#dbeafe;cursor:pointer}.button.primary{border-color:#22d3ee;background:#164e63}.button:disabled{opacity:.55;cursor:wait}.current-card,.announcement-card,.temporary-card,.rule-card{border:1px solid rgba(148,163,184,.2);border-radius:12px;background:rgba(15,23,42,.72);padding:16px}.current-card{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:14px}.current-card span,.current-card small{display:block;color:#64748b;font-size:11px}.current-card strong{display:block;margin-top:5px;color:#f8fafc}.current-card.unknown{border-color:#f59e0b}.announcement-card{margin-bottom:14px}.announcement-card h2,.temporary-card h2,.rule-card h2{margin:0 0 10px;font-size:15px}.announcement-card pre{white-space:pre-wrap;margin:0;color:#a7f3d0;font:inherit;line-height:1.7}.error{color:#fca5a5}.rule-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:14px}.rule-card.active{border-color:#22d3ee;box-shadow:0 0 0 1px rgba(34,211,238,.25)}.rule-card p,.temporary-card p{margin:0;color:#cbd5e1;line-height:1.7}.temporary-card p+p{margin-top:8px}@media(max-width:760px){.page-header{display:block}.page-header .button{margin-top:10px}.current-card,.rule-grid{grid-template-columns:1fr}}
</style>
