<template>
  <article
    class="squad-card"
    :class="[
      teamColorClass,
      { selected: hasSelectedPlayer },
    ]"
  >
    <header class="squad-header">
      <div class="squad-header-title">
        <strong>{{ squad.squadName }}</strong>
        <span class="squad-member-count">{{ squad.memberCount }}/{{ squad.maxMembers }}</span>
      </div>
      <div class="squad-header-creator">
        {{ squad.creatorName }}
      </div>
      <StatusBadge :tone="squad.isLocked ? 'warn' : 'idle'">
        {{ squad.isLocked ? t("common.locked") : t("common.open") }}
      </StatusBadge>
    </header>

    <div v-if="squad.state === 'empty'" class="squad-empty">
      <div class="squad-empty-text">{{ t("match.noMembers") }}</div>
    </div>

    <template v-else>
      <SquadLeaderRow
        v-if="squad.leader"
        :player="squad.leader"
        :selected="String(selectedPlayerId) === String(squad.leader.playerId)"
        @select="$emit('select-player', squad.leader)"
      />

      <div v-if="squad.state === 'no_leader'" class="squad-warning">
        ⚠ {{ t("match.noSquadLeader") }}
      </div>

      <PlayerRow
        v-for="member in squad.members"
        :key="`player-${member.playerId}`"
        :player="member"
        :selected="String(selectedPlayerId) === String(member.playerId)"
        @select="$emit('select-player', member)"
      />
    </template>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { SquadViewModel, PlayerRowViewModel } from "../../types/squad-admin.types";
import StatusBadge from "../common/StatusBadge.vue";
import PlayerRow from "./PlayerRow.vue";
import SquadLeaderRow from "./SquadLeaderRow.vue";
import { t } from "../../i18n";

const props = defineProps<{
  squad: SquadViewModel;
  selectedPlayerId?: string | number | null;
}>();

defineEmits<{
  (event: "select-player", player: PlayerRowViewModel): void;
}>();

const teamColorClass = computed(() => {
  if (props.squad.teamId === 1) return "team1-context";
  if (props.squad.teamId === 2) return "team2-context";
  return "";
});

const hasSelectedPlayer = computed(() => {
  if (props.selectedPlayerId == null) return false;
  if (props.squad.leader && String(props.squad.leader.playerId) === String(props.selectedPlayerId)) {
    return true;
  }
  return props.squad.members.some((member) => String(member.playerId) === String(props.selectedPlayerId));
});
</script>

<style scoped>
.squad-card {
  flex: 0 0 auto;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  overflow: visible;
  transition: all 0.2s ease;
}

.squad-card:hover {
  border-color: var(--color-border-soft);
  background: var(--color-bg-elevated);
}

.squad-card.selected {
  border-color: var(--color-status-info);
  box-shadow: inset 0 0 0 1px var(--color-status-info);
}

.squad-card.team1-context {
  border-left: 3px solid var(--color-team1-primary);
}

.squad-card.team2-context {
  border-left: 3px solid var(--color-team2-primary);
}

.squad-header {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: var(--spacing-md);
  align-items: center;
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--color-border-soft);
}

.squad-header strong {
  font-size: var(--font-size-md);
  font-weight: 700;
  color: var(--color-text-primary);
}

.squad-header-title {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
  min-width: 0;
}

.squad-member-count {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-weight: 500;
}

.squad-header-creator {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.squad-empty {
  padding: var(--spacing-lg);
  text-align: center;
}

.squad-empty-text {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.squad-warning {
  padding: var(--spacing-md);
  background-color: rgba(245, 158, 11, 0.08);
  border-top: 1px solid var(--color-border-soft);
  color: var(--color-status-warning);
  font-size: var(--font-size-sm);
  border-left: 2px solid var(--color-status-warning);
}
</style>
