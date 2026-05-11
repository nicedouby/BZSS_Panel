<template>
  <section class="team-panel panel">
    <header class="team-head">
      <div>
        <h2>{{ team.teamName }}</h2>
        <span>Team {{ team.teamID }} / {{ team.playerCount }} players</span>
      </div>
    </header>
    <div class="squad-grid">
      <SquadCard
        v-for="squad in team.squads"
        :key="squad.key"
        :squad="squad"
        :playtimes="playtimes"
      />
      <SquadCard
        v-if="team.unassignedPlayers.length"
        :squad="unassignedSquad"
        :members="team.unassignedPlayers"
        :playtimes="playtimes"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { RuntimeTeam } from "../../stores/match.store";
import SquadCard from "./SquadCard.vue";

const props = defineProps<{
  team: RuntimeTeam;
  playtimes: Record<string, any>;
}>();

const unassignedSquad = computed(() => ({
  key: `${props.team.teamID}:unassigned`,
  teamID: props.team.teamID,
  squadID: null,
  squadName: "未编队",
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

.squad-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 10px;
}
</style>
