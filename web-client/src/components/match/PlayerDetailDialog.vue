<template>
  <div class="dialog-root" @click.self="$emit('close')">
    <section class="dialog-panel">
      <header class="dialog-head">
        <div>
          <h3>{{ player.name || "Unknown" }}</h3>
          <p>{{ player.online ? "Online" : "Offline" }} / {{ player.role || "Unknown role" }}</p>
        </div>
        <button type="button" class="close-button" @click="$emit('close')">Close</button>
      </header>

      <div class="detail-grid">
        <div><span>Player ID</span><strong>{{ player.playerID ?? "-" }}</strong></div>
        <div><span>Steam ID</span><strong>{{ player.steamID || "-" }}</strong></div>
        <div><span>EOS ID</span><strong>{{ player.eosID || "-" }}</strong></div>
        <div><span>Team</span><strong>{{ player.teamID ?? "-" }}</strong></div>
        <div><span>Squad</span><strong>{{ player.squadID ?? "-" }}</strong></div>
        <div><span>Leader</span><strong>{{ player.isLeader ? "Yes" : "No" }}</strong></div>
        <div><span>Steam Playtime</span><strong>{{ playtimeText }}</strong></div>
      </div>

      <pre v-if="player.raw" class="raw-block">{{ player.raw }}</pre>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { RuntimePlayer } from "../../stores/player.store";

const props = defineProps<{
  player: RuntimePlayer;
  playtime?: any;
}>();

defineEmits<{
  (event: "close"): void;
}>();

const playtimeText = computed(() => {
  const seconds = Number(props.playtime?.gameSeconds ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "Steam --";
  return `Steam ${(seconds / 3600).toFixed(1)}h`;
});
</script>

<style scoped>
.dialog-root {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(8, 12, 16, 0.72);
}

.dialog-panel {
  width: min(720px, 100%);
  display: grid;
  gap: 16px;
  border: 1px solid #2b3540;
  border-radius: 8px;
  background: #171d23;
  padding: 18px;
}

.dialog-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.dialog-head h3 {
  margin: 0;
  font-size: 22px;
}

.dialog-head p {
  margin: 6px 0 0;
  color: #9aa7b2;
  font-size: 13px;
}

.close-button {
  white-space: nowrap;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.detail-grid div {
  border: 1px solid #2b3540;
  border-radius: 8px;
  background: #11171d;
  padding: 10px 12px;
}

.detail-grid span,
.detail-grid strong {
  display: block;
}

.detail-grid span {
  color: #9aa7b2;
  font-size: 12px;
}

.detail-grid strong {
  margin-top: 5px;
}

.raw-block {
  margin: 0;
  overflow: auto;
  border: 1px solid #2b3540;
  border-radius: 8px;
  background: #11171d;
  padding: 12px;
  color: #cdd6dc;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 700px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
