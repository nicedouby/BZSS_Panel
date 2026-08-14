<template>
  <AppPage full-bleed class="kill-records-page">
    <WorkspaceToolbar>
      <template #actions>
        <button class="action-button" type="button" :disabled="loading" @click="refreshAll">刷新</button>
        <button class="action-button" type="button" :disabled="replayRunning" @click="restartReplay(false)">继续回溯</button>
        <button class="action-button danger" type="button" :disabled="replayRunning" @click="restartReplay(true)">清空并重新回溯</button>
      </template>
    </WorkspaceToolbar>

    <AppPageToolbar>
      <div class="filters">
        <select v-model="filters.source" @change="resetAndRefresh"><option value="all">全部来源</option><option value="live">实时</option><option value="replay">回溯</option></select>
        <select v-model="filters.type" @change="resetAndRefresh"><option value="all">全部类型</option><option value="kill">击杀</option><option value="tk">TK</option></select>
        <input v-model="filters.search" placeholder="玩家名字 / Steam64 / EOS / 武器" @keydown.enter.prevent="resetAndRefresh">
        <select v-model.number="filters.limit" @change="resetAndRefresh"><option :value="100">100</option><option :value="200">200</option><option :value="500">500</option></select>
        <button type="button" @click="resetAndRefresh">查询</button>
      </div>
    </AppPageToolbar>

    <div class="status-grid">
      <AppCard compact title="回溯状态">
        <div class="status-value">{{ statusLabel }}</div>
        <div class="progress"><span :style="{ width: `${progress}%` }"></span></div>
        <small>{{ formatBytes(replay.scannedBytes) }} / {{ formatBytes(replay.totalBytes) }} · {{ progress.toFixed(1) }}%</small>
      </AppCard>
      <AppCard compact title="扫描进度"><strong>{{ formatNumber(replay.scannedLines) }} 行</strong><small>发现 {{ formatNumber(replay.killsFound) }} · 导入 {{ formatNumber(replay.imported) }} · 重复 {{ formatNumber(replay.duplicates) }}</small></AppCard>
      <AppCard compact title="历史击杀"><strong>{{ formatNumber(overview.replayCount) }}</strong></AppCard>
      <AppCard compact title="实时击杀"><strong>{{ formatNumber(overview.liveCount) }}</strong></AppCard>
      <AppCard compact title="TK"><strong>{{ formatNumber(overview.teamKills) }}</strong></AppCard>
      <AppCard compact title="最后更新"><strong>{{ formatTime(overview.lastUpdatedAt) }}</strong></AppCard>
    </div>

    <AppCard compact title="击杀记录" class="records-card" padding="none">
      <div v-if="error" class="error-box">{{ error }}</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>时间</th><th>来源</th><th>类型</th><th>击杀者</th><th>Team</th><th>被击杀者</th><th>Team</th><th>武器</th><th>详情</th></tr></thead>
          <tbody>
            <tr v-if="!records.length"><td colspan="9" class="empty">{{ loading ? "加载中…" : "暂无击杀记录" }}</td></tr>
            <tr v-for="record in records" :key="record.id">
              <td>{{ formatTime(record.time) }}</td>
              <td><span class="pill" :class="record.source">{{ record.source === "live" ? "实时" : "回溯" }}</span></td>
              <td><span class="pill" :class="record.isTeamKill ? 'tk' : 'kill'">{{ record.isTeamKill ? "TK" : "击杀" }}</span></td>
              <td><strong>{{ record.attacker?.name || "未知" }}</strong><small>{{ shortId(record.attacker?.steam64ID || record.attacker?.eosID) }}</small></td>
              <td>{{ record.attacker?.teamID ?? "-" }}</td>
              <td><strong>{{ record.victim?.name || "未知" }}</strong><small>{{ shortId(record.victim?.steam64ID || record.victim?.eosID) }}</small></td>
              <td>{{ record.victim?.teamID ?? "-" }}</td>
              <td>{{ record.weapon || "-" }}</td>
              <td><button type="button" class="detail-button" @click="selected = record">查看</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination"><button :disabled="filters.offset <= 0" @click="previousPage">上一页</button><span>{{ filters.offset + 1 }}–{{ Math.min(filters.offset + filters.limit, total) }} / {{ total }}</span><button :disabled="filters.offset + filters.limit >= total" @click="nextPage">下一页</button></div>
    </AppCard>

    <div v-if="selected" class="modal-backdrop" @click.self="selected = null">
      <div class="detail-modal">
        <header><strong>击杀详情</strong><button type="button" @click="selected = null">×</button></header>
        <dl>
          <template v-for="row in detailRows(selected)" :key="row[0]"><dt>{{ row[0] }}</dt><dd>{{ row[1] || "-" }}</dd></template>
        </dl>
        <label>Raw Log</label><pre>{{ selected.rawLog || "-" }}</pre>
      </div>
    </div>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
import { renderApiError } from "../app/errors";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";
import AppPage from "../components/common/AppPage.vue";
import AppCard from "../components/common/AppCard.vue";
import AppPageToolbar from "../components/common/AppPageToolbar.vue";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";

interface PlayerRef { name?: string; steam64ID?: string; eosID?: string; controllerID?: string; teamID?: number | null; squadID?: number | null }
interface KillRecord { id: string; source: "live" | "replay"; time: string; logTime?: string; attacker?: PlayerRef; victim?: PlayerRef; weapon?: string; damage?: number | null; isTeamKill?: boolean; parse?: any; sourceFile?: string; sourceFileId?: string; sourceOffset?: number; rawLog?: string }

const filters = reactive({ source: "all", type: "all", search: "", offset: 0, limit: 200 });
const records = ref<KillRecord[]>([]);
const total = ref(0);
const overview = reactive<any>({ replayCount: 0, liveCount: 0, teamKills: 0, lastUpdatedAt: "" });
const replay = reactive<any>({ status: "idle", scannedBytes: 0, totalBytes: 0, scannedLines: 0, killsFound: 0, imported: 0, duplicates: 0, progress: 0 });
const loading = ref(false);
const error = ref("");
const selected = ref<KillRecord | null>(null);
const active = ref(true);
let timer: number | null = null;

const replayRunning = computed(() => ["starting", "running"].includes(replay.status));
const progress = computed(() => Math.max(0, Math.min(100, Number(replay.progress) || (replay.totalBytes ? replay.scannedBytes / replay.totalBytes * 100 : 0))));
const statusLabel = computed(() => ({ idle: "等待回溯", starting: "正在启动", running: "历史回溯中", completed: "回溯完成", failed: "回溯失败", stopped: "已停止", source_changed: "源日志已变化" } as Record<string, string>)[replay.status] || replay.status);

onMounted(() => { void refreshAll(); startPolling(); });
onActivated(() => { active.value = true; void refreshAll(); startPolling(); });
onDeactivated(() => { active.value = false; stopPolling(); });
onBeforeUnmount(stopPolling);

function startPolling() { if (!timer) timer = window.setInterval(() => { if (active.value && canAutoRefreshNow()) void refreshAll(true); }, 2000); }
function stopPolling() { if (timer) window.clearInterval(timer); timer = null; }

async function refreshAll(silent = false) {
  if (!silent) loading.value = true;
  try {
    const params = new URLSearchParams(Object.entries(filters).map(([key, value]) => [key, String(value)]));
    const [data, state] = await Promise.all([apiGet<any>(`/api/kill-records?${params}`), apiGet<any>("/api/kill-records/status")]);
    records.value = data.records ?? [];
    total.value = Number(data.total) || 0;
    Object.assign(overview, data.overview ?? state.overview ?? {});
    Object.assign(replay, state.replay ?? {});
    error.value = "";
  } catch (cause) { if (!silent) error.value = renderApiError(cause); }
  finally { loading.value = false; }
}

async function restartReplay(clear: boolean) {
  if (clear && !window.confirm("这会清空已保存的回溯击杀并从头扫描，继续吗？")) return;
  try { await apiPost("/api/kill-records/replay", { clear }); await refreshAll(); }
  catch (cause) { error.value = renderApiError(cause); }
}

function resetAndRefresh() { filters.offset = 0; void refreshAll(); }
function previousPage() { filters.offset = Math.max(0, filters.offset - filters.limit); void refreshAll(); }
function nextPage() { filters.offset += filters.limit; void refreshAll(); }
function formatNumber(value: unknown) { return new Intl.NumberFormat("zh-CN").format(Number(value) || 0); }
function formatBytes(value: unknown) { const size = Number(value) || 0; if (size < 1024) return `${size} B`; const units = ["KB", "MB", "GB", "TB"]; let n = size / 1024; let unit = units[0]; for (let i = 1; n >= 1024 && i < units.length; i += 1) { n /= 1024; unit = units[i]; } return `${n.toFixed(n >= 100 ? 0 : 2)} ${unit}`; }
function formatTime(value: unknown) { if (!value) return "-"; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false }); }
function shortId(value: unknown) { const text = String(value ?? ""); return text.length > 20 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text; }
function detailRows(record: KillRecord): string[][] { return [["时间", formatTime(record.time)], ["来源", record.source === "live" ? "实时" : "回溯"], ["击杀者", record.attacker?.name ?? ""], ["击杀者 Steam64", record.attacker?.steam64ID ?? ""], ["击杀者 EOS", record.attacker?.eosID ?? ""], ["击杀者 ControllerID", record.attacker?.controllerID ?? ""], ["击杀者 Team / Squad", `${record.attacker?.teamID ?? "-"} / ${record.attacker?.squadID ?? "-"}`], ["被击杀者", record.victim?.name ?? ""], ["被击杀者 Steam64", record.victim?.steam64ID ?? ""], ["被击杀者 EOS", record.victim?.eosID ?? ""], ["被击杀者 ControllerID", record.victim?.controllerID ?? ""], ["被击杀者 Team / Squad", `${record.victim?.teamID ?? "-"} / ${record.victim?.squadID ?? "-"}`], ["武器", record.weapon ?? ""], ["伤害", String(record.damage ?? "")], ["是否 TK", record.isTeamKill ? "是" : "否"], ["解析置信度", record.parse?.confidence ?? record.parse?.parseConfidence ?? ""], ["Source File", record.sourceFile ?? ""], ["Source Offset", String(record.sourceOffset ?? "")]]; }
</script>

<style scoped>
.kill-records-page { gap: 12px; padding: 12px; overflow: auto; }
.action-button, .filters button, .pagination button, .detail-button { border: 1px solid var(--color-border); background: var(--color-surface-raised); color: var(--color-text); border-radius: 7px; padding: 7px 12px; cursor: pointer; }
.action-button.danger { color: var(--color-danger, #ef4444); }
.action-button:disabled, button:disabled { opacity: .45; cursor: default; }
.filters { display: flex; gap: 8px; flex-wrap: wrap; }
.filters input { min-width: 280px; flex: 1; }
.filters input, .filters select { border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text); border-radius: 7px; padding: 7px 10px; }
.status-grid { display: grid; grid-template-columns: repeat(6, minmax(130px, 1fr)); gap: 10px; }
.status-grid strong, .status-value { display: block; font-size: 20px; }
.status-grid small { display: block; margin-top: 5px; color: var(--color-text-muted); }
.progress { height: 6px; margin: 8px 0; background: var(--color-border); border-radius: 10px; overflow: hidden; }
.progress span { display: block; height: 100%; background: #22c55e; }
.records-card { min-height: 360px; }
.table-wrap { overflow: auto; max-height: 58vh; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 9px 10px; border-bottom: 1px solid var(--color-border); text-align: left; vertical-align: top; white-space: nowrap; }
td small { display: block; color: var(--color-text-muted); }
.pill { display: inline-flex; padding: 2px 7px; border-radius: 999px; background: #334155; color: #fff; }
.pill.live { background: #2563eb; } .pill.replay { background: #64748b; } .pill.tk { background: #dc2626; } .pill.kill { background: #16a34a; }
.empty { text-align: center; color: var(--color-text-muted); padding: 40px; }
.pagination { display: flex; justify-content: flex-end; align-items: center; gap: 12px; padding: 10px; }
.error-box { padding: 10px; color: #ef4444; }
.modal-backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,.62); display: grid; place-items: center; padding: 24px; }
.detail-modal { width: min(900px, 96vw); max-height: 90vh; overflow: auto; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface-raised); padding: 18px; }
.detail-modal header { display: flex; justify-content: space-between; font-size: 18px; }
.detail-modal header button { border: 0; background: transparent; color: inherit; font-size: 24px; cursor: pointer; }
dl { display: grid; grid-template-columns: 170px 1fr; gap: 6px 12px; } dt { color: var(--color-text-muted); } dd { margin: 0; overflow-wrap: anywhere; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: rgba(0,0,0,.25); padding: 12px; border-radius: 8px; }
@media (max-width: 1200px) { .status-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 700px) { .status-grid { grid-template-columns: 1fr 1fr; } }
</style>
