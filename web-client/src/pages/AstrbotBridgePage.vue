<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

type BridgeState = {
  enabled?: boolean;
  tokenConfigured?: boolean;
  websocket?: {
    enabled?: boolean;
    path?: string;
    connected?: boolean;
    clients?: number;
    connectedAt?: string | null;
    lastHeartbeat?: string | null;
  };
  metrics?: {
    eventsSent?: number;
    eventsFailed?: number;
    lastEvent?: string | null;
    recentEvents?: Array<{ time?: string; type?: string; serverId?: string }>;
  };
};

const state = ref<BridgeState | null>(null);
const loading = ref(true);
const error = ref("");
let timer: ReturnType<typeof setInterval> | null = null;

async function load() {
  try {
    const response = await fetch("/api/astrbot/panel-status", { credentials: "include" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.value = payload.data ?? null;
    error.value = "";
  } catch (err) {
    error.value = err instanceof Error ? err.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

onMounted(() => {
  load();
  timer = setInterval(load, 2000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <section class="astrbot-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">SYSTEM / INTEGRATION</p>
        <h1>AstrBot 网关</h1>
        <p class="subtitle">Panel 与 AstrBot 的只读状态、心跳和事件摘要。</p>
      </div>
      <span class="status" :class="{ online: state?.enabled }">
        {{ state?.enabled ? "● 已启用" : "● 未启用" }}
      </span>
    </header>

    <p v-if="loading" class="muted">正在加载…</p>
    <p v-if="error" class="error">无法读取网关状态：{{ error }}</p>

    <div v-if="state" class="grid">
      <article class="card">
        <h2>连接配置</h2>
        <dl>
          <div><dt>WebSocket</dt><dd>{{ state.websocket?.enabled ? "已启用" : "已关闭" }}</dd></div>
          <div><dt>通道</dt><dd>{{ state.websocket?.path || "/ws/astrbot" }}</dd></div>
          <div><dt>客户端</dt><dd>{{ state.websocket?.clients ?? 0 }}</dd></div>
          <div><dt>Token</dt><dd>{{ state.tokenConfigured ? "已配置" : "未配置" }}</dd></div>
        </dl>
      </article>

      <article class="card">
        <h2>事件统计</h2>
        <dl>
          <div><dt>发送成功</dt><dd>{{ state.metrics?.eventsSent ?? 0 }}</dd></div>
          <div><dt>发送失败</dt><dd>{{ state.metrics?.eventsFailed ?? 0 }}</dd></div>
          <div><dt>最后事件</dt><dd>{{ state.metrics?.lastEvent || "—" }}</dd></div>
          <div><dt>最后心跳</dt><dd>{{ formatTime(state.websocket?.lastHeartbeat) }}</dd></div>
        </dl>
      </article>

      <article class="card events">
        <h2>最近事件摘要</h2>
        <p v-if="!state.metrics?.recentEvents?.length" class="muted">暂无事件。</p>
        <div v-for="(event, index) in state.metrics?.recentEvents || []" :key="`${event.time}-${index}`" class="event-row">
          <time>{{ formatTime(event.time) }}</time>
          <strong>{{ event.type || "core.event" }}</strong>
          <span>{{ event.serverId || "—" }}</span>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.astrbot-page { min-height: 100%; padding: 28px; color: #e5edf7; background: #0b1220; }
.page-header { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; margin-bottom:24px; }
.eyebrow { margin:0 0 8px; color:#67e8f9; font-size:11px; letter-spacing:.16em; }
h1 { margin:0; font-size:28px; }
.subtitle, .muted { color:#94a3b8; }
.status { border:1px solid #475569; border-radius:999px; padding:8px 12px; color:#94a3b8; }
.status.online { color:#86efac; border-color:#166534; }
.grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
.card { border:1px solid #1e293b; border-radius:14px; padding:18px; background:#111827; }
.card h2 { margin:0 0 16px; font-size:15px; }
dl { margin:0; }
dl div { display:flex; justify-content:space-between; gap:16px; padding:9px 0; border-bottom:1px solid #1e293b; }
dl div:last-child { border-bottom:0; }
dt { color:#94a3b8; } dd { margin:0; text-align:right; overflow-wrap:anywhere; }
.events { grid-column:1 / -1; }
.event-row { display:grid; grid-template-columns:190px 1fr 160px; gap:12px; padding:10px 0; border-bottom:1px solid #1e293b; font-size:13px; }
.event-row time, .event-row span { color:#94a3b8; }
.error { color:#fca5a5; }
@media (max-width: 800px) { .grid { grid-template-columns:1fr; } .events { grid-column:auto; } .event-row { grid-template-columns:1fr; gap:4px; } }
</style>
