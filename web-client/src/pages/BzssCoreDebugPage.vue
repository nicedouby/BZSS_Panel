<template>
  <section class="debug-page">
    <header class="page-header">
      <div>
        <h1>BZSS-Core 解析调试</h1>
        <p>用于确认原始日志是否进入后端、解析器输出了什么，以及位置数据在哪一步丢失。</p>
      </div>
      <div class="actions">
        <button class="btn btn-secondary" :disabled="loading" @click="refresh">
          {{ loading ? "读取中..." : "刷新调试数据" }}
        </button>
        <button class="btn btn-secondary" @click="showFullJson = !showFullJson">{{ showFullJson ? "隐藏 JSON" : "显示完整 JSON" }}</button>
        <button v-if="showFullJson" class="btn btn-secondary" @click="copyJson">复制 JSON</button>
      </div>
    </header>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <section class="metrics">
      <article v-for="item in metrics" :key="item.label" class="metric-card">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </article>
    </section>

    <section class="panel">
      <h2>状态与解析诊断</h2>
      <dl class="diagnostics">
        <div><dt>status</dt><dd>{{ snapshot?.status ?? "--" }}</dd></div>
        <div><dt>revision</dt><dd>{{ monitorState.revision ?? "--" }}</dd></div>
        <div><dt>updatedAt</dt><dd>{{ monitorState.updatedAt ?? "--" }}</dd></div>
        <div><dt>markerSeen</dt><dd>{{ monitorState.markerSeen ?? "--" }}</dd></div>
        <div><dt>rawLineHash</dt><dd class="mono">{{ monitorState.rawLineHash || "--" }}</dd></div>
        <div><dt>lastError</dt><dd>{{ monitorState.lastError || "--" }}</dd></div>
        <div><dt>rawFields</dt><dd class="mono">{{ (monitorState.rawFields ?? []).join(" | ") || "--" }}</dd></div>
      </dl>
    </section>

    <section class="panel">
      <h2>运行时玩家解析结果</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Position</th><th>Yaw</th><th>Observed At</th><th>Stale</th><th>Combat Info</th><th>Raw</th></tr></thead>
          <tbody>
            <tr v-for="player in runtimePlayers" :key="String(player.playerIndex ?? player.playerId)">
              <td>{{ player.playerIndex ?? player.playerId ?? "--" }}</td>
              <td class="mono">{{ formatPosition(player.position) }}</td>
              <td>{{ player.yaw ?? "--" }}</td>
              <td class="mono">{{ player.observedAt || "--" }}</td>
              <td>{{ player.stale ? "是" : "否" }}</td>
              <td>{{ player.combatInfo || "--" }}</td>
              <td class="raw-cell">{{ formatRaw(player.rawText) }}</td>
            </tr>
            <tr v-if="runtimePlayers.length === 0"><td colspan="7" class="empty">没有运行时玩家。说明当前 raw 没有被解析成 runtimePlayers。</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <h2>完整 API 返回（可复制）</h2>
      <pre v-if="showFullJson" ref="jsonRef" class="json">{{ formattedJson }}</pre>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { fetchBzssCorePlayerInfoList, fetchBzssCoreRawData } from "../app/bzssCoreApi";

const loading = ref(false);
const error = ref("");
const snapshot = ref<any>(null);
const raw = ref<any>(null);
const jsonRef = ref<HTMLElement | null>(null);
const showFullJson = ref(false);

const monitorState = computed(() => snapshot.value?.state ?? {});
const runtimePlayers = computed(() => Array.isArray(snapshot.value?.runtimePlayers) ? snapshot.value.runtimePlayers : []);
const metrics = computed(() => [
  { label: "运行时玩家", value: runtimePlayers.value.length },
  { label: "计分板玩家", value: Array.isArray(snapshot.value?.scoreboardPlayers) ? snapshot.value.scoreboardPlayers.length : 0 },
  { label: "合并玩家", value: Array.isArray(snapshot.value?.players) ? snapshot.value.players.length : 0 },
  { label: "位置有效", value: runtimePlayers.value.filter((p: any) => p.position && Number.isFinite(p.position.x) && Number.isFinite(p.position.y)).length },
  { label: "过期玩家", value: runtimePlayers.value.filter((p: any) => p.stale).length },
]);

const formattedJson = computed(() => JSON.stringify({ snapshot: snapshot.value, raw: raw.value }, null, 2));

function formatRaw(value: unknown) {
  const text = String(value ?? '').trim();
  return text.length > 1000 ? text.slice(0, 1000) + '…' : text || '--';
}

function formatPosition(position: any) {
  if (!position || position.x == null || position.y == null || position.z == null) return "--";
  return `(${position.x}, ${position.y}, ${position.z})`;
}

async function refresh() {
  loading.value = true;
  error.value = "";
  try {
    const [nextSnapshot, nextRaw] = await Promise.all([
      fetchBzssCorePlayerInfoList(),
      fetchBzssCoreRawData(),
    ]);
    snapshot.value = nextSnapshot;
    raw.value = nextRaw;
  } catch (err: any) {
    error.value = err?.message ?? "读取 BZSS-Core 调试数据失败";
  } finally {
    loading.value = false;
  }
}

async function copyJson() {
  await navigator.clipboard?.writeText(formattedJson.value);
}

onMounted(refresh);
</script>

<style scoped>
.debug-page { padding: 24px; color: var(--text-primary, #e5edf7); background: var(--bg-primary, #0b1220); min-height: 100%; }
.page-header { display:flex; justify-content:space-between; gap:20px; align-items:flex-start; margin-bottom:20px; }
.page-header h1 { margin:0 0 8px; }
.page-header p { margin:0; color:#9aa9bd; }
.actions { display:flex; gap:8px; }
.metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:16px; }
.metric-card, .panel { border:1px solid rgba(148,163,184,.2); border-radius:10px; background:rgba(15,23,42,.82); }
.metric-card { padding:14px; display:flex; flex-direction:column; gap:8px; }
.metric-card span { color:#94a3b8; font-size:12px; }
.metric-card strong { font-size:24px; }
.panel { padding:16px; margin-bottom:16px; overflow:hidden; }
.panel h2 { margin:0 0 14px; font-size:16px; }
.diagnostics { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:10px; margin:0; }
.diagnostics div { padding:10px; background:rgba(30,41,59,.65); border-radius:7px; }
.diagnostics dt { color:#94a3b8; font-size:12px; }
.diagnostics dd { margin:5px 0 0; word-break:break-word; }
.table-wrap { overflow:auto; }
table { border-collapse:collapse; width:100%; min-width:900px; }
th,td { text-align:left; padding:9px 10px; border-bottom:1px solid rgba(148,163,184,.15); vertical-align:top; }
th { color:#94a3b8; font-size:12px; }
.raw-cell { max-width:380px; white-space:pre-wrap; word-break:break-all; font-family:monospace; font-size:12px; }
.mono, .json { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; }
.json { max-height:520px; overflow:auto; margin:0; white-space:pre-wrap; word-break:break-word; font-size:12px; }
.empty { text-align:center; color:#fbbf24; padding:24px; }
.error-banner { margin-bottom:16px; padding:12px; border-radius:8px; color:#fecaca; background:rgba(127,29,29,.65); }
@media (max-width:700px) { .page-header { flex-direction:column; } .actions { width:100%; } }
</style>
