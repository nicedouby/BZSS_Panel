<template>
  <div class="player-row">
    <div class="identity">
      <strong>{{ player.name || "Unknown" }}</strong>
      <StatusBadge v-if="player.isLeader" tone="ok">SL</StatusBadge>
    </div>
    <div class="meta">
      <span>{{ player.role || "Unknown role" }}</span>
      <span>ID {{ player.playerID ?? "-" }}</span>
      <span>{{ playtimeText }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { RuntimePlayer } from "../../stores/player.store";
import StatusBadge from "../common/StatusBadge.vue";

const props = defineProps<{
  player: RuntimePlayer;
  playtime?: any;
}>();

const playtimeText = computed(() => {
  const seconds = Number(props.playtime?.gameSeconds ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "Steam --";
  return `Steam ${(seconds / 3600).toFixed(1)}h`;
});
</script>

<style scoped>
.player-row {
  display: grid;
  gap: 5px;
  padding: 9px 10px;
  border-top: 1px solid #26303a;
}

.identity,
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.identity strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  color: #9aa7b2;
  font-size: 12px;
  flex-wrap: wrap;
}
</style>
