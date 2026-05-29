<template>
  <div class="runtime-status-page">
    <div class="page-header">
      <div class="header-content">
        <h1>运行状态</h1>
        <p>系统内核、模块与插件的实时运行状态。</p>
      </div>
      <div class="header-actions">
        <button class="refresh-btn" type="button" @click="fetchStatus" :disabled="loading">
          {{ loading ? "刷新中..." : "手动刷新" }}
        </button>
      </div>
    </div>

    <div v-if="error" class="error-banner">
      加载失败: {{ error }}
    </div>

    <div v-if="status" class="status-content">
      <section class="status-section">
        <h2 class="section-title">系统信息</h2>
        <div class="system-grid">
          <div class="system-card">
            <span class="label">Uptime</span>
            <span class="value">{{ formatUptime(status.system.uptime) }}</span>
          </div>
          <div class="system-card">
            <span class="label">Memory (RSS)</span>
            <span class="value">{{ formatMemory(status.system.memory.rss) }}</span>
          </div>
          <div class="system-card">
            <span class="label">Node.js</span>
            <span class="value">{{ status.system.nodeVersion }}</span>
          </div>
          <div class="system-card">
            <span class="label">Platform</span>
            <span class="value">{{ status.system.platform }} ({{ status.system.arch }})</span>
          </div>
        </div>
      </section>

      <section class="status-section">
        <h2 class="section-title">内置模块 ({{ status.modules.length }})</h2>
        <div class="item-grid">
          <button
            v-for="m in status.modules"
            :key="m.id"
            type="button"
            class="item-card runtime-item-card"
            :title="`查看 ${m.name} 日志`"
            @click="openLogWindow({ ...m, kind: 'module' })"
          >
            <div class="item-header">
              <span class="item-name">{{ m.name }}</span>
              <span class="status-badge running">Running</span>
            </div>
            <div class="item-meta">{{ m.id }} @ {{ m.version }}</div>
            <p class="item-desc">{{ m.description }}</p>
          </button>
        </div>
      </section>

      <section class="status-section">
        <h2 class="section-title">外部插件 ({{ status.plugins.length }})</h2>
        <div class="item-grid">
          <button
            v-for="p in status.plugins"
            :key="p.id"
            type="button"
            class="item-card runtime-item-card"
            :title="`查看 ${p.name} 日志`"
            @click="openLogWindow({ ...p, kind: 'plugin' })"
          >
            <div class="item-header">
              <span class="item-name">{{ p.name }}</span>
              <span class="status-badge running">Running</span>
            </div>
            <div class="item-meta">{{ p.id }} @ {{ p.version }}</div>
            <p class="item-desc">{{ p.description }}</p>
          </button>
        </div>
      </section>
    </div>

    <RuntimeLogModal
      :open="Boolean(selectedTarget)"
      :target="selectedTarget"
      @close="closeLogWindow"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { apiGet } from "../app/apiClient";
import RuntimeLogModal from "../components/runtime/RuntimeLogModal.vue";

interface SystemStatus {
  ok: boolean;
  system: {
    uptime: number;
    memory: { rss: number };
    nodeVersion: string;
    platform: string;
    arch: string;
  };
  modules: Array<{
    id: string;
    name: string;
    version: string;
    description: string;
    status: string;
  }>;
  plugins: Array<{
    id: string;
    name: string;
    version: string;
    description: string;
    status: string;
  }>;
}

interface RuntimeTarget {
  id: string;
  name: string;
  version?: string;
  description?: string;
  status?: string;
  kind: "module" | "plugin";
}

const status = ref<SystemStatus | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const selectedTarget = ref<RuntimeTarget | null>(null);
let timer: number | null = null;

const hasSelection = computed(() => Boolean(selectedTarget.value));

async function fetchStatus() {
  loading.value = true;
  error.value = null;
  try {
    status.value = await apiGet<SystemStatus>("/api/system/status");
  } catch (err: any) {
    error.value = err?.message || "未知错误";
  } finally {
    loading.value = false;
  }
}

function openLogWindow(target: RuntimeTarget) {
  selectedTarget.value = target;
}

function closeLogWindow() {
  selectedTarget.value = null;
}

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

function formatMemory(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function onWindowKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape" && hasSelection.value) {
    closeLogWindow();
  }
}

onMounted(() => {
  void fetchStatus();
  timer = window.setInterval(fetchStatus, 5000);
  window.addEventListener("keydown", onWindowKeyDown);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
  window.removeEventListener("keydown", onWindowKeyDown);
});
</script>

<style scoped>
.runtime-status-page {
  padding: 24px;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 32px;
}

.header-content h1 {
  font-size: 24px;
  margin: 0 0 8px 0;
}

.header-content p {
  color: #9aa7b2;
  margin: 0;
}

.refresh-btn {
  padding: 8px 16px;
  background: #2d3944;
  border: 1px solid #41505d;
  color: #edf2f4;
  border-radius: 6px;
  cursor: pointer;
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error-banner {
  padding: 12px 16px;
  background: rgba(255, 107, 107, 0.1);
  border: 1px solid #ff6b6b;
  color: #ff6b6b;
  border-radius: 8px;
  margin-bottom: 24px;
}

.status-section {
  margin-bottom: 40px;
}

.section-title {
  font-size: 18px;
  margin-bottom: 16px;
  color: #edf2f4;
}

.system-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.system-card {
  padding: 16px;
  background: #1b2229;
  border: 1px solid #2e3944;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.system-card .label {
  font-size: 12px;
  color: #9aa7b2;
}

.system-card .value {
  font-size: 18px;
  font-weight: 600;
  color: #edf2f4;
}

.item-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.item-card {
  padding: 16px;
  background: #1b2229;
  border: 1px solid #2e3944;
  border-radius: 12px;
}

.runtime-item-card {
  width: 100%;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease, background-color 0.15s ease;
}

.runtime-item-card:hover {
  border-color: #4f6c86;
  background: #212a33;
}

.runtime-item-card:focus-visible {
  outline: 2px solid #6aa6ff;
  outline-offset: 2px;
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
  gap: 12px;
}

.item-name {
  font-weight: 600;
  color: #edf2f4;
}

.status-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  text-transform: uppercase;
  font-weight: 700;
  flex: 0 0 auto;
}

.status-badge.running {
  background: rgba(46, 204, 113, 0.1);
  color: #2ecc71;
}

.item-meta {
  font-size: 11px;
  color: #6c7a89;
  font-family: monospace;
  margin-bottom: 8px;
}

.item-desc {
  font-size: 13px;
  color: #9aa7b2;
  margin: 0;
  line-height: 1.4;
}
</style>
