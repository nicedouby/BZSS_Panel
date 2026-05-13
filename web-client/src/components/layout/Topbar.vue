<template>
  <header class="topbar">
    <div class="topbar-start">
      <button type="button" class="menu-button" @click="toggleSidebar">
        {{ sidebarButtonLabel }}
      </button>
      <div class="topbar-copy">
        <strong>{{ pageTitle }}</strong>
        <span class="topbar-subtitle">{{ currentLayer }}</span>
      </div>
    </div>
    <div class="topbar-end">
      <div class="topbar-metrics">
        <StatusBadge :tone="runtimeTone">{{ runtimeLabel }}</StatusBadge>
        <span class="metric primary">{{ t("topbar.players", "", { count: playerCount }) }}</span>
        <span class="metric primary">{{ t("topbar.tps", "", { value: tps }) }}</span>
        <span class="metric optional">Queue {{ queueCount }}</span>
        <span class="metric optional">Next {{ nextLayer }}</span>
        <span v-if="runtimeError" class="metric error optional">{{ runtimeError }}</span>
      </div>
      <UserMenu />
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
import UserMenu from "./UserMenu.vue";
import { t } from "../../i18n";

const server = useServerStore();
const players = usePlayerStore();
const runtime = getRuntimeSyncState();
const route = useRoute();
const ui = useUiStore();

const webStatus = computed(() => server.snapshot.webStatus ?? server.snapshot ?? {});
const pageTitle = computed(() => {
  const titleKey = route.meta.titleKey ? String(route.meta.titleKey) : "";
  const title = route.meta.title ? String(route.meta.title) : "";
  if (titleKey) return t(titleKey, title);
  return String(title || server.snapshot.serverName || webStatus.value.serverName || server.snapshot.name || webStatus.value.name || "BZSS Panel");
});
const currentLayer = computed(() => stableDisplayValue(
  server.snapshot.currentLayer,
  webStatus.value.currentLayer,
  server.snapshot.layer,
  webStatus.value.layer,
  server.snapshot.map,
  webStatus.value.map,
  server.snapshot.mapName,
  webStatus.value.mapName,
  t("topbar.unknownLayer", "Unknown Layer"),
));
const nextLayer = computed(() => stableDisplayValue(
  server.snapshot.nextLayer,
  webStatus.value.nextLayer,
  t("topbar.unknownLayer", "Unknown Layer"),
));
const playerCount = computed(() => players.active.length);
const queueCount = computed(() => {
  const value = Number(server.snapshot?.queueCount ?? server.snapshot?.webStatus?.queueCount);
  return Number.isFinite(value) ? value : 0;
});
const tps = computed(() => {
  const value = Number(server.snapshot?.tps ?? server.snapshot?.webStatus?.tps);
  return Number.isFinite(value) && value > 0 ? value.toFixed(1) : "--";
});
const sidebarButtonLabel = computed(() => ui.sidebarCollapsed ? t("topbar.expand") : t("topbar.collapse"));
const runtimeLabel = computed(() => {
  if (runtime.inFlight) return t("common.syncing");
  if (runtime.errorType === "unauthorized") return t("common.unauthorized");
  if (runtime.errorType === "network" || runtime.errorType === "timeout") return t("common.apiOffline");
  if (runtime.lastError || server.stale) return t("common.stale");
  return t("common.live");
});
const runtimeTone = computed(() => {
  if (runtimeLabel.value === t("common.live")) return "ok";
  if (runtimeLabel.value === t("common.unauthorized") || runtimeLabel.value === t("common.apiOffline")) return "error";
  return "warn";
});
const runtimeError = computed(() => runtime.lastError ? briefRuntimeError(runtime.lastError) : "");

function briefRuntimeError(value: string) {
  if (value.length <= 52) return value;
  return `${value.slice(0, 49)}...`;
}

function stableDisplayValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) continue;
      if (text === "Unknown" || text === "Unknown Server" || text === "Unknown Map" || text === "Unknown Layer") continue;
      return text;
    }
    if (value !== undefined && value !== null) {
      return String(value);
    }
  }
  return t("topbar.unknownLayer", "Unknown Layer");
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
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.01)), rgba(255, 255, 255, 0.004)),
    #14191f;
}

.topbar-start {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.topbar-copy {
  min-width: 0;
}

.topbar-copy strong,
.topbar-copy span {
  display: block;
}

.topbar-subtitle {
  color: #9aa7b2;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-button {
  min-width: 70px;
}

.topbar-metrics {
  display: flex;
  align-items: center;
  gap: 10px;
  white-space: nowrap;
  min-width: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.metric {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  color: #dce4e8;
  font-size: 12px;
}

.metric.primary {
  color: #edf2f4;
  font-weight: 600;
}

.metric.error {
  color: #ffb1b1;
}

.metric.optional {
  display: inline-flex;
}

.topbar-end {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

@media (max-width: 780px) {
  .topbar {
    padding: 0 14px;
    height: auto;
    min-height: 58px;
    flex-wrap: wrap;
  }

  .topbar-end {
    width: 100%;
    justify-content: space-between;
  }

  .topbar-metrics {
    gap: 8px;
    overflow: hidden;
  }
}

@media (max-width: 1280px) {
  .metric.optional {
    display: none;
  }
}
</style>
