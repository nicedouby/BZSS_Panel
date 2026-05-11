<template>
  <header class="topbar">
    <div class="topbar-start">
      <button type="button" class="menu-button" @click="toggleSidebar">
        {{ sidebarButtonLabel }}
      </button>
      <div>
        <strong>{{ pageTitle }}</strong>
        <span>{{ layer }}</span>
      </div>
    </div>
    <div class="topbar-metrics">
      <StatusBadge :tone="runtimeTone">{{ runtimeLabel }}</StatusBadge>
      <span v-if="runtimeError">{{ runtimeError }}</span>
      <span>{{ playerCount }} players</span>
      <span>TPS {{ tps }}</span>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useServerStore } from "../../stores/server.store";
import { usePlayerStore } from "../../stores/player.store";
import { getRuntimeSyncState } from "../../app/runtimeSync";
import { useUiStore } from "../../stores/ui.store";
import StatusBadge from "../common/StatusBadge.vue";

const server = useServerStore();
const players = usePlayerStore();
const runtime = getRuntimeSyncState();
const route = useRoute();
const ui = useUiStore();

const webStatus = computed(() => server.snapshot.webStatus ?? server.snapshot ?? {});
const pageTitle = computed(() => String(route.meta.title ?? webStatus.value.serverName ?? "BZSS Panel"));
const layer = computed(() => webStatus.value.currentLayer ?? webStatus.value.layer ?? "Unknown Layer");
const playerCount = computed(() => players.active.length);
const tps = computed(() => webStatus.value.tps ?? "--");
const sidebarButtonLabel = computed(() => ui.sidebarCollapsed ? "Expand" : "Collapse");
const runtimeLabel = computed(() => {
  if (runtime.inFlight) return "syncing";
  if (runtime.errorType === "unauthorized") return "unauthorized";
  if (runtime.errorType === "network" || runtime.errorType === "timeout") return "api offline";
  if (runtime.lastError || server.stale) return "stale";
  return "live";
});
const runtimeTone = computed(() => {
  if (runtimeLabel.value === "live") return "ok";
  if (runtimeLabel.value === "unauthorized" || runtimeLabel.value === "api offline") return "error";
  return "warn";
});
const runtimeError = computed(() => runtime.lastError ? briefRuntimeError(runtime.lastError) : "");

function briefRuntimeError(value: string) {
  if (value.length <= 52) return value;
  return `${value.slice(0, 49)}...`;
}

function toggleSidebar() {
  if (window.matchMedia("(max-width: 780px)").matches) {
    ui.toggleMobileSidebar();
    return;
  }
  ui.toggleSidebarCollapsed();
}
</script>

<style scoped>
.topbar {
  height: 58px;
  padding: 0 18px;
  border-bottom: 1px solid #273039;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  background: #14191f;
}

.topbar-start {
  display: flex;
  align-items: center;
  gap: 12px;
}

.topbar strong,
.topbar span {
  display: block;
}

.topbar span {
  color: #9aa7b2;
  font-size: 12px;
}

.menu-button {
  min-width: 70px;
}

.topbar-metrics {
  display: flex;
  align-items: center;
  gap: 10px;
  white-space: nowrap;
}

@media (max-width: 780px) {
  .topbar {
    padding: 0 14px;
  }

  .topbar-metrics {
    gap: 8px;
    overflow: hidden;
  }
}
</style>
