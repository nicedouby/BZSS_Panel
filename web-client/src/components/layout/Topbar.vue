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
    <div class="topbar-end">
      <div class="topbar-metrics">
        <StatusBadge :tone="runtimeTone">{{ runtimeLabel }}</StatusBadge>
        <span v-if="runtimeError">{{ runtimeError }}</span>
        <span>{{ t("topbar.players", "", { count: playerCount }) }}</span>
        <span>{{ t("topbar.tps", "", { value: tps }) }}</span>
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
const layer = computed(() => stableDisplayValue(
  server.snapshot.currentLayer,
  webStatus.value.currentLayer,
  server.snapshot.layer,
  webStatus.value.layer,
  server.snapshot.mapName,
  webStatus.value.mapName,
  t("topbar.unknownLayer", "Unknown Layer"),
));
const playerCount = computed(() => players.active.length);
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
</style>
