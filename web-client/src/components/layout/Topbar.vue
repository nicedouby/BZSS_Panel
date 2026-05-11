<template>
  <header class="topbar">
    <div>
      <strong>{{ serverName }}</strong>
      <span>{{ layer }}</span>
    </div>
    <div class="topbar-metrics">
      <StatusBadge :tone="server.stale ? 'warn' : 'ok'">{{ server.stale ? "stale" : "live" }}</StatusBadge>
      <span>{{ playerCount }} players</span>
      <span>TPS {{ tps }}</span>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useServerStore } from "../../stores/server.store";
import { usePlayerStore } from "../../stores/player.store";
import StatusBadge from "../common/StatusBadge.vue";

const server = useServerStore();
const players = usePlayerStore();

const webStatus = computed(() => server.snapshot.webStatus ?? server.snapshot ?? {});
const serverName = computed(() => webStatus.value.serverName ?? "BZSS Panel");
const layer = computed(() => webStatus.value.currentLayer ?? webStatus.value.layer ?? "Unknown Layer");
const playerCount = computed(() => players.active.length);
const tps = computed(() => webStatus.value.tps ?? "--");
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

.topbar strong,
.topbar span {
  display: block;
}

.topbar span {
  color: #9aa7b2;
  font-size: 12px;
}

.topbar-metrics {
  display: flex;
  align-items: center;
  gap: 10px;
  white-space: nowrap;
}
</style>
