<template>
  <section class="team-panel panel">
    <header class="team-head">
      <div>
        <h2>{{ team.teamName }}</h2>
        <span>Team {{ team.teamID }} / {{ team.playerCount }} players</span>
      </div>
    </header>
    <div class="squad-list">
      <SquadCard
        v-for="squad in team.squads"
        :key="squad.key"
        :squad="squad"
        :playtimes="playtimes"
        @select-player="($event) => $emit('select-player', $event)"
      />
      <SquadCard
        v-if="team.unassignedPlayers.length"
        :squad="unassignedSquad"
        :members="team.unassignedPlayers"
        :playtimes="playtimes"
        @select-player="($event) => $emit('select-player', $event)"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { RuntimePlayer } from "../../stores/player.store";
import type { RuntimeTeam } from "../../stores/match.store";
import SquadCard from "./SquadCard.vue";

const props = defineProps<{
  team: RuntimeTeam;
  playtimes: Record<string, any>;
}>();

defineEmits<{
  (event: "select-player", player: RuntimePlayer): void;
}>();

const unassignedSquad = computed(() => ({
  key: `${props.team.teamID}:unassigned`,
  teamID: props.team.teamID,
  squadID: null,
  squadName: "Unassigned",
  locked: false,
  creatorName: "",
}));
</script>

<style scoped>
.team-panel {
  padding: 12px;
}

.team-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

h2 {
  margin: 0;
  font-size: 18px;
}

.team-head span {
  color: #9aa7b2;
  font-size: 12px;
}

.squad-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
}
</style>
