<template>
  <div class="runtime-status-page">
    <div class="page-header">
      <div class="header-content">
        <h1>运行状态</h1>
        <p>系统内核、模块与插件的实时运行状况。</p>
      </div>
      <div class="header-actions">
        <button class="refresh-btn" @click="fetchStatus" :disabled="loading">
          {{ loading ? "刷新中..." : "手动刷新" }}
        </button>
      </div>
    </div>

    <div v-if="error" class="error-banner">
      加载失败: {{ error }}
    </div>

    <div v-if="status" class="status-content">
      <!-- System Overview -->
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

      <!-- Modules -->
      <section class="status-section">
        <h2 class="section-title">内置模块 ({{ status.modules.length }})</h2>
        <div class="item-grid">
          <div v-for="m in status.modules" :key="m.id" class="item-card">
            <div class="item-header">
              <span class="item-name">{{ m.name }}</span>
              <span class="status-badge running">Running</span>
            </div>
            <div class="item-meta">{{ m.id }} @ {{ m.version }}</div>
            <p class="item-desc">{{ m.description }}</p>
          </div>
        </div>
      </section>

      <!-- Plugins -->
      <section class="status-section">
        <h2 class="section-title">外部插件 ({{ status.plugins.length }})</h2>
        <div class="item-grid">
          <div v-for="p in status.plugins" :key="p.id" class="item-card">
            <div class="item-header">
              <span class="item-name">{{ p.name }}</span>
              <span class="status-badge running">Running</span>
            </div>
            <div class="item-meta">{{ p.id }} @ {{ p.version }}</div>
            <p class="item-desc">{{ p.description }}</p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { apiGet } from "../app/apiClient";

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

const status = ref<SystemStatus | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
let timer: number | null = null;

async function fetchStatus() {
  loading.value = true;
  error.value = null;
  try {
    status.value = await apiGet<SystemStatus>("/api/system/status");
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

function formatMemory(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

onMounted(() => {
  fetchStatus();
  timer = window.setInterval(fetchStatus, 5000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.runtime-status-page {
  padding: 24px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
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

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
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
