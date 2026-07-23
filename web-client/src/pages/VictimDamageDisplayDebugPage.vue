<template>
  <section class="damage-debug-page">
    <header class="page-header">
      <div>
        <div class="eyebrow">COMBAT PIPELINE</div>
        <h1>被命中伤害调试</h1>
        <p>检查每条伤害最终是已向受害者发送、发送失败，还是在伤害显示插件中被拦截。</p>
      </div>
      <div class="actions">
        <span class="refresh-state">{{ loading ? "读取中..." : lastUpdated }}</span>
        <button class="btn" :disabled="loading" @click="refresh">刷新</button>
        <button class="btn" :class="{ active: autoRefresh }" @click="autoRefresh = !autoRefresh">
          {{ autoRefresh ? "自动刷新中" : "自动刷新" }}
        </button>
        <button class="btn danger" :disabled="clearing" @click="clearRecords">
          {{ clearing ? "清理中..." : "清空记录" }}
        </button>
      </div>
    </header>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <section class="metrics">
      <article v-for="item in metrics" :key="item.label" class="metric-card" :data-tone="item.tone">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </article>
    </section>

    <section class="diagnostic-grid">
      <article class="panel">
        <h2>插件状态</h2>
        <dl class="diagnostics">
          <div><dt>enabled</dt><dd>{{ state?.enabled ? "true" : "false" }}</dd></div>
          <div><dt>subscribed</dt><dd>{{ state?.subscribed ? "true" : "false" }}</dd></div>
          <div><dt>active</dt><dd>{{ state?.active ? "true" : "false" }}</dd></div>
          <div><dt>处理事件</dt><dd>{{ state?.received ?? 0 }}</dd></div>
          <div><dt>已发送成功</dt><dd class="ok-text">{{ state?.displayed ?? 0 }}</dd></div>
          <div><dt>插件跳过</dt><dd class="danger-text">{{ state?.skipped ?? 0 }}</dd></div>
          <div><dt>最近跳过原因</dt><dd>{{ reasonLabel(state?.lastSkipReason) }}</dd></div>
          <div><dt>最近错误</dt><dd>{{ state?.lastError || "--" }}</dd></div>
        </dl>
      </article>

      <article class="panel">
        <h2>拦截原因统计</h2>
        <div v-if="reasonEntries.length" class="reason-list">
          <div v-for="item in reasonEntries" :key="item.key" class="reason-row">
            <span>{{ reasonLabel(item.key) }}</span><strong>{{ item.value }}</strong>
          </div>
        </div>
        <div v-else class="empty">暂无调试记录</div>
      </article>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>伤害处理记录</h2>
          <p>内存中最多保留 {{ snapshot?.maxRecords ?? 500 }} 条，重启后清空。</p>
        </div>
        <div class="filters">
          <select v-model="statusFilter" class="input">
            <option value="">全部结果</option>
            <option value="warned">已警告</option>
            <option value="send_failed">发送失败</option>
            <option value="intercepted">已拦截</option>
          </select>
          <select v-model="reasonFilter" class="input">
            <option value="">全部原因</option>
            <option v-for="item in allReasons" :key="item" :value="item">{{ reasonLabel(item) }}</option>
          </select>
          <input v-model.trim="query" class="input search" placeholder="搜索玩家 / 武器 / 消息">
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>时间</th><th>结果</th><th>原因</th><th>伤害</th><th>攻击者</th><th>受害者</th><th>武器</th><th>AdminWarn 消息</th><th>错误</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in filteredRecords" :key="item.id">
              <td class="mono">{{ formatTime(item.createdAt) }}</td>
              <td><span class="status-pill" :data-tone="item.status">{{ statusLabel(item.status) }}</span></td>
              <td>{{ reasonLabel(item.reason) }}</td>
              <td>{{ item.damage ?? "--" }}</td>
              <td>{{ item.attacker || "自身/环境" }}</td>
              <td>{{ item.victim || "--" }}</td>
              <td>{{ item.weapon || "--" }}</td>
              <td class="message">{{ item.message || "--" }}</td>
              <td class="error-text">{{ item.error || "--" }}</td>
            </tr>
            <tr v-if="!filteredRecords.length"><td colspan="9" class="empty">当前筛选条件下没有记录</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { apiGet, apiPost } from "../app/apiClient";

const loading = ref(false);
const clearing = ref(false);
const error = ref("");
const autoRefresh = ref(true);
const snapshot = ref<any>(null);
const lastUpdated = ref("--");
const statusFilter = ref("");
const reasonFilter = ref("");
const query = ref("");
let timer: number | null = null;

const state = computed(() => snapshot.value?.state ?? null);
const records = computed(() => Array.isArray(snapshot.value?.records) ? snapshot.value.records : []);
const reasonEntries = computed(() => Object.entries(snapshot.value?.byReason ?? {})
  .map(([key, value]) => ({ key, value: Number(value) }))
  .sort((a, b) => b.value - a.value));
const allReasons = computed(() => [...new Set(records.value.map((item: any) => item.reason).filter(Boolean))]);
const filteredRecords = computed(() => {
  const needle = query.value.toLowerCase();
  return records.value.filter((item: any) => {
    if (statusFilter.value && item.status !== statusFilter.value) return false;
    if (reasonFilter.value && item.reason !== reasonFilter.value) return false;
    if (!needle) return true;
    return [item.attacker, item.victim, item.weapon, item.message, item.error, item.reason]
      .some((value) => String(value ?? "").toLowerCase().includes(needle));
  });
});
const metrics = computed(() => [
  { label: "伤害事件", value: state.value?.received ?? 0, tone: "" },
  { label: "已向受害者警告", value: snapshot.value?.byStatus?.warned ?? 0, tone: "ok" },
  { label: "发送失败", value: snapshot.value?.byStatus?.send_failed ?? 0, tone: "danger" },
  { label: "已拦截", value: snapshot.value?.byStatus?.intercepted ?? 0, tone: "warn" },
  { label: "当前记录", value: records.value.length, tone: "" },
]);

async function refresh(silent = false) {
  if (loading.value) return;
  loading.value = true;
  if (!silent) error.value = "";
  try {
    const response: any = await apiGet("/api/plugins/victim-damage-display/debug");
    snapshot.value = response?.data ?? response;
    lastUpdated.value = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  } catch (err: any) {
    if (!silent) error.value = err?.message ?? "读取伤害调试数据失败";
  } finally {
    loading.value = false;
  }
}

async function clearRecords() {
  clearing.value = true;
  try {
    const response: any = await apiPost("/api/plugins/victim-damage-display/debug/clear");
    snapshot.value = response?.data ?? response;
    error.value = "";
  } catch (err: any) {
    error.value = err?.message ?? "清空调试记录失败";
  } finally {
    clearing.value = false;
  }
}

function statusLabel(value: string) {
  return ({ warned: "已警告", intercepted: "已拦截", send_failed: "发送失败" } as Record<string, string>)[value] ?? value;
}
function reasonLabel(value: string) {
  return ({
    admin_punishment_damage: "管理员一百万伤害",
    self_attacker: "攻击者是自己",
    invalid_victim: "无效受害者",
    invalid_attacker: "无效攻击者",
    duplicate: "重复事件",
    invalid_damage: "无效伤害",
    admin_warn_sent: "AdminWarn 已发送",
    admin_warn_failed: "AdminWarn 返回失败",
    admin_warn_exception: "AdminWarn 异常",
  } as Record<string, string>)[value] ?? value || "--";
}
function formatTime(value: string) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("zh-CN", { hour12: false });
}
function restartTimer() {
  if (timer) window.clearInterval(timer);
  timer = autoRefresh.value ? window.setInterval(() => refresh(true), 2000) : null;
}
watch(autoRefresh, restartTimer);
onMounted(() => { refresh(); restartTimer(); });
onBeforeUnmount(() => { if (timer) window.clearInterval(timer); });
</script>

<style scoped>
.damage-debug-page { min-height:100%; padding:24px; color:var(--text-primary,#e5edf7); background:var(--bg-primary,#0b1220); }
.page-header,.panel-head { display:flex; justify-content:space-between; gap:20px; align-items:flex-start; }
.page-header { margin-bottom:20px; }
.eyebrow { color:#60a5fa; font-size:11px; letter-spacing:.14em; margin-bottom:7px; }
h1 { margin:0 0 8px; font-size:28px; } h2 { margin:0 0 12px; font-size:16px; }
.page-header p,.panel-head p { margin:0; color:#94a3b8; font-size:13px; }
.actions,.filters { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.btn,.input { border:1px solid rgba(148,163,184,.25); border-radius:7px; color:inherit; background:rgba(30,41,59,.8); padding:8px 11px; }
.btn { cursor:pointer; } .btn.active { border-color:#60a5fa; color:#93c5fd; } .btn.danger { color:#fca5a5; }
.btn:disabled { opacity:.5; cursor:not-allowed; }
.refresh-state { color:#94a3b8; font-size:12px; }
.error-banner { margin-bottom:16px; padding:12px; border-radius:8px; color:#fecaca; background:rgba(127,29,29,.7); }
.metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:16px; }
.metric-card,.panel { border:1px solid rgba(148,163,184,.2); border-radius:10px; background:rgba(15,23,42,.84); }
.metric-card { padding:14px; display:flex; flex-direction:column; gap:7px; } .metric-card span { color:#94a3b8; font-size:12px; } .metric-card strong { font-size:25px; }
.metric-card[data-tone=ok] strong,.ok-text { color:#86efac; } .metric-card[data-tone=danger] strong,.danger-text,.error-text { color:#fca5a5; } .metric-card[data-tone=warn] strong { color:#fcd34d; }
.diagnostic-grid { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(260px,.65fr); gap:16px; margin-bottom:16px; }
.panel { padding:16px; margin-bottom:16px; overflow:hidden; } .diagnostics { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:8px; margin:0; }
.diagnostics div { padding:10px; border-radius:7px; background:rgba(30,41,59,.6); } .diagnostics dt { color:#94a3b8; font-size:11px; } .diagnostics dd { margin:4px 0 0; word-break:break-word; }
.reason-list { display:flex; flex-direction:column; gap:8px; } .reason-row { display:flex; justify-content:space-between; padding:9px 10px; border-radius:7px; background:rgba(30,41,59,.6); }
.panel-head { margin-bottom:14px; } .filters { justify-content:flex-end; } .search { min-width:220px; }
.table-wrap { overflow:auto; } table { width:100%; min-width:1250px; border-collapse:collapse; } th,td { padding:9px 10px; text-align:left; border-bottom:1px solid rgba(148,163,184,.14); vertical-align:top; } th { color:#94a3b8; font-size:11px; white-space:nowrap; } td { font-size:12px; } .mono { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; white-space:nowrap; } .message { max-width:300px; } .error-text { max-width:220px; word-break:break-word; }
.status-pill { display:inline-block; padding:3px 7px; border-radius:999px; font-size:11px; background:#334155; } .status-pill[data-tone=warned] { color:#86efac; background:rgba(22,101,52,.35); } .status-pill[data-tone=intercepted] { color:#fcd34d; background:rgba(133,77,14,.35); } .status-pill[data-tone=send_failed] { color:#fca5a5; background:rgba(127,29,29,.35); }
.empty { padding:24px; text-align:center; color:#fbbf24; }
@media (max-width:800px) { .page-header,.panel-head { flex-direction:column; } .filters { justify-content:flex-start; } .diagnostic-grid { grid-template-columns:1fr; } }
</style>
