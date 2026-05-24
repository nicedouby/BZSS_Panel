<template>
  <div class="player-row">
    <div class="identity">
      <button type="button" class="name-button" @click="$emit('select', player)">
        {{ player.name || "Unknown" }}
      </button>
      <button v-if="player.name || player.steamID || player.eosID" type="button" class="db-link-button" @click="searchPlayerDatabase">DB</button>
      <StatusBadge v-if="player.isLeader" tone="ok">SL</StatusBadge>
    </div>
    <div class="meta">
      <span v-if="player.squadID != null" class="player-squad-badge">#{{ player.squadID }}</span>
      <span>{{ player.role || "Unknown role" }}</span>
      <span>ID {{ player.playerID ?? "-" }}</span>
      <span>{{ playtimeText }}</span>
    </div>
    <div v-if="currentIp" class="ip-row">
      <span class="ip-text">{{ currentIp }}</span>
      <button type="button" class="copy-button" @click="copyIp">Copy IP</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import type { RuntimePlayer } from "../../stores/player.store";
import { useUiStore } from "../../stores/ui.store";
import { copyTextWithToast } from "../../utils/clipboard";
import { goToPlayerDatabaseSearch } from "../../utils/player-database";
import StatusBadge from "../common/StatusBadge.vue";

const props = defineProps<{
  player: RuntimePlayer;
  playtime?: any;
}>();

const router = useRouter();
const ui = useUiStore();

defineEmits<{
  (event: "select", player: RuntimePlayer): void;
}>();

const currentIp = computed(() => String(props.player?.current_ip ?? props.player?.ip ?? "").trim());
const playtimeText = computed(() => {
  const seconds = Number(props.playtime?.gameSeconds ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "Steam --";
  return `Steam ${(seconds / 3600).toFixed(1)}h`;
});

async function copyIp() {
  if (!currentIp.value) return;
  await copyTextWithToast(currentIp.value, ui, {
    label: "IP copied",
    successMessage: currentIp.value,
  });
}

function searchPlayerDatabase() {
  goToPlayerDatabaseSearch(router, props.player.name || props.player.steamID || props.player.eosID || "");
}
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

.ip-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: #8a93a8;
  font-size: 12px;
}

.ip-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.db-link-button,
.copy-button {
  border: 0;
  background: transparent;
  padding: 0;
  color: #8bb6ff;
  font-size: 12px;
}

.db-link-button:hover,
.copy-button:hover {
  text-decoration: underline;
}

.meta {
  color: #9aa7b2;
  font-size: 12px;
  flex-wrap: wrap;
}

.player-squad-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 15px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 800;
  color: #fff;
  background-color: #3b82f6;
  opacity: 0.85;
}
</style>
