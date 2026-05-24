<template>
  <article class="squad-card">
    <header>
      <div class="squad-title-row">
        <span v-if="squad.squadID != null" class="squad-id-badge">#{{ squad.squadID }}</span>
        <div class="squad-title-text">
          <strong>{{ title }}</strong>
          <span>{{ subtitle }}</span>
        </div>
      </div>
      <StatusBadge :tone="squad.locked ? 'warn' : 'idle'">{{ squad.locked ? "Locked" : "Open" }}</StatusBadge>
    </header>
    <PlayerRow
      v-for="player in members"
      :key="player.steamID || player.eosID || player.playerID || player.name"
      :player="player"
      :playtime="player.steamID ? playtimes[player.steamID] : null"
      @select="$emit('select-player', $event)"
    />
    <div v-if="!members.length" class="empty">No members</div>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { RuntimePlayer } from "../../stores/player.store";
import type { RuntimeSquad } from "../../stores/squad.store";
import StatusBadge from "../common/StatusBadge.vue";
import PlayerRow from "./PlayerRow.vue";

const props = defineProps<{
  squad: RuntimeSquad & { members?: RuntimePlayer[] };
  members?: RuntimePlayer[];
  playtimes: Record<string, any>;
}>();

defineEmits<{
  (event: "select-player", player: RuntimePlayer): void;
}>();

const members = computed(() => props.members ?? props.squad.members ?? []);
const title = computed(() => props.squad.squadName || props.squad.name || `Squad ${props.squad.squadID ?? "-"}`);
const subtitle = computed(() => {
  const creator = props.squad.creatorName ? `Creator ${props.squad.creatorName}` : "Creator unknown";
  return `${props.squad.key || `${props.squad.teamID}:${props.squad.squadID}`} / ${creator}`;
});
</script>

<style scoped>
.squad-card {
  border: 1px solid #2b3540;
  border-radius: 8px;
  overflow: hidden;
  background: #171d23;
}

header {
  min-height: 58px;
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.squad-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.squad-id-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 19px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 900;
  color: #fff;
  background-color: #3b82f6;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  flex-shrink: 0;
}

.squad-title-text {
  min-width: 0;
  flex: 1;
}

header strong,
header span {
  display: block;
}

header span,
.empty {
  color: #9aa7b2;
  font-size: 12px;
}

.empty {
  padding: 12px;
  border-top: 1px solid #26303a;
}
</style>
