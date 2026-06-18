<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-root" v-backdrop-close="() => emit('close')">
      <section class="dialog-panel" role="dialog" aria-modal="true" :aria-label="title">
        <header class="dialog-head">
          <div class="title-block">
            <span class="eyebrow">{{ targetLabel }}</span>
            <h3>{{ title }}</h3>
            <p>
              <span>{{ target?.id || "--" }}</span>
              <span v-if="target?.version">· v{{ target.version }}</span>
              <span v-if="target?.status">· {{ target.status }}</span>
            </p>
          </div>

          <div class="dialog-actions">
            <button
              type="button"
              class="icon-button"
              :disabled="loading"
              :title="loading ? '正在刷新' : '刷新日志'"
              @click="refreshLogs"
            >
              ↻
            </button>
            <button type="button" class="icon-button close" title="关闭" @click="emit('close')">
              ×
            </button>
          </div>
        </header>

        <div v-if="target?.description" class="dialog-summary">
          {{ target.description }}
        </div>

        <div class="dialog-meta">
          <span class="meta-chip" :class="target?.kind || 'module'">{{ targetLabel }}</span>
          <span class="meta-chip scope">scope: {{ target?.id || "--" }}</span>
        </div>

        <div v-if="error" class="error-banner">
          {{ error }}
        </div>

        <div class="log-shell">
          <div v-if="loading && !lines.length" class="empty-state">正在加载日志...</div>
          <div v-else-if="!lines.length" class="empty-state">暂无日志</div>
          <LogVirtualList v-else :lines="lines" />
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import LogVirtualList from "../console/LogVirtualList.vue";
import type { ConsoleLine } from "../../composables/useConsoleLines";
import { apiGet } from "../../app/apiClient";
import { canAutoRefreshNow } from "../../composables/useAutoRefreshGate";

interface RuntimeLogTarget {
  id: string;
  name: string;
  version?: string;
  description?: string;
  status?: string;
  kind: "module" | "plugin";
}

const props = defineProps<{
  open: boolean;
  target: RuntimeLogTarget | null;
}>();

const emit = defineEmits<{
  (event: "close"): void;
}>();

const lines = ref<ConsoleLine[]>([]);
const loading = ref(false);
const error = ref("");
let refreshTimer: number | null = null;
let fetchToken = 0;

const title = computed(() => props.target?.name || props.target?.id || "运行日志");
const targetLabel = computed(() => props.target?.kind === "plugin" ? "插件日志" : "模块日志");

watch(
  () => props.open,
  (open) => {
    if (open) {
      void refreshLogs();
      startAutoRefresh();
      window.addEventListener("keydown", onWindowKeyDown);
      return;
    }

    fetchToken += 1;
    stopAutoRefresh();
    window.removeEventListener("keydown", onWindowKeyDown);
  },
  { immediate: true },
);

watch(
  () => props.target?.id,
  () => {
    if (props.open) {
      void refreshLogs();
    }
  },
);

onBeforeUnmount(() => {
  stopAutoRefresh();
  window.removeEventListener("keydown", onWindowKeyDown);
});

async function refreshLogs() {
  const scope = props.target?.id;
  if (!scope) {
    lines.value = [];
    return;
  }

  const token = ++fetchToken;
  loading.value = true;
  error.value = "";

  try {
    const params = new URLSearchParams({
      stream: "modules",
      scope,
      level: "all",
      limit: "200",
    });
    const response = await apiGet<{ lines?: ConsoleLine[] }>(`/api/console/lines?${params.toString()}`);
    if (token !== fetchToken) return;
    lines.value = Array.isArray(response.lines) ? response.lines : [];
  } catch (err) {
    if (token !== fetchToken) return;
    error.value = err instanceof Error ? err.message : "日志加载失败";
  } finally {
    if (token !== fetchToken) return;
    loading.value = false;
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = window.setInterval(() => {
    if (canAutoRefreshNow()) void refreshLogs();
  }, 2000);
}

function stopAutoRefresh() {
  if (refreshTimer != null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function onWindowKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape" && props.open) {
    emit("close");
  }
}
</script>

<style scoped>
.dialog-root {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(6, 10, 16, 0.72);
  backdrop-filter: blur(4px);
}

.dialog-panel {
  width: min(1100px, calc(100vw - 48px));
  height: min(78vh, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid #2b3540;
  border-radius: 10px;
  background: #10161d;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.48);
  padding: 18px;
  min-width: 0;
  min-height: 0;
}

.dialog-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.title-block {
  min-width: 0;
}

.eyebrow {
  display: inline-flex;
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 700;
  color: #8fb3ff;
  text-transform: uppercase;
  letter-spacing: 0;
}

.dialog-head h3 {
  margin: 0;
  font-size: 18px;
  color: #edf2f4;
}

.dialog-head p {
  margin: 6px 0 0;
  color: #9aa7b2;
  font-size: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.dialog-actions {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
}

.icon-button {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid #334155;
  background: rgba(255, 255, 255, 0.05);
  color: #edf2f4;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}

.icon-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

.icon-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.icon-button.close {
  font-size: 24px;
}

.dialog-summary {
  color: #9aa7b2;
  font-size: 13px;
  line-height: 1.5;
}

.dialog-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.meta-chip {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.08);
  color: #d5dde5;
}

.meta-chip.plugin {
  color: #8ee3a6;
  background: rgba(46, 204, 113, 0.12);
}

.meta-chip.module {
  color: #8fb3ff;
  background: rgba(96, 165, 250, 0.12);
}

.meta-chip.scope {
  color: #f0c56a;
}

.error-banner {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 107, 107, 0.1);
  border: 1px solid rgba(255, 107, 107, 0.3);
  color: #ff8f8f;
  font-size: 13px;
}

.log-shell {
  min-height: 0;
  flex: 1;
  border: 1px solid #27313a;
  border-radius: 8px;
  overflow: hidden;
  background: #0d1117;
}

.empty-state {
  height: 100%;
  display: grid;
  place-items: center;
  color: #8b949e;
  font-size: 13px;
}
</style>
