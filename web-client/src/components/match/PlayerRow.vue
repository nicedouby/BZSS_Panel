<template>
  <div class="player-row">
    <div class="identity">
      <button type="button" class="name-button" @click="$emit('select', player)">
        {{ player.name || "Unknown" }}
      </button>
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

defineEmits<{
  (event: "select", player: RuntimePlayer): void;
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

.name-button {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0;
  border: 0;
  background: transparent;
  color: #edf2f4;
  font-weight: 700;
  text-align: left;
}

.name-button:hover {
  color: #9fd6ff;
}

.meta {
  color: #9aa7b2;
  font-size: 12px;
  flex-wrap: wrap;
}
</style>
