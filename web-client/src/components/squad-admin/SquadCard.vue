<template>
  <article
    class="squad-card"
    :class="[
      teamColorClass,
      { selected: hasSelectedPlayer },
    ]"
  >
    <header class="squad-header">
      <div class="squad-header-main">
        <div class="squad-title-row">
          <strong class="squad-name">{{ squad.squadName }}</strong>
          <span class="squad-member-count">{{ squad.memberCount }}/{{ squad.maxMembers }}</span>
          <StatusBadge :tone="squad.isLocked ? 'warn' : 'idle'">
            {{ squad.isLocked ? t("common.locked") : t("common.open") }}
          </StatusBadge>
        </div>

        <div class="squad-meta-row">
          <span class="squad-meta-chip">{{ squadAveragePlaytimeText }}</span>
          <span v-if="squad.creatorName" class="squad-meta-chip subtle">
            Created by {{ squad.creatorName }}
          </span>
        </div>
      </div>

      <div v-if="squadWarnings.length > 0" class="squad-warning-row">
        <span
          v-for="warning in squadWarnings"
          :key="warning"
          class="squad-warning-chip"
          :class="`tone-${warningTone(warning)}`"
        >
          {{ warning }}
        </span>
      </div>
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
        {{ t("match.noSquadLeader") }}
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
import type { PlayerRowViewModel, SquadViewModel } from "../../types/squad-admin.types";
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

const squadAveragePlaytimeText = computed(() => {
  if (props.squad.knownPlaytimePlayers <= 0) return "Steam time unavailable";

  const publicText = `Public ${props.squad.publicPlaytimePlayers}`;
  const privateText = props.squad.privatePlaytimePlayers > 0
    ? `Private ${props.squad.privatePlaytimePlayers}`
    : "";

  if (props.squad.averagePlaytimeHours == null) {
    return `Avg -- / ${publicText}${privateText ? ` / ${privateText}` : ""}`;
  }

  return `Avg ${props.squad.averagePlaytimeHours}h / ${publicText}${privateText ? ` / ${privateText}` : ""}`;
});

const squadWarnings = computed(() => {
  const items: string[] = [];

  if (props.squad.state === "empty") {
    items.push("Empty");
  }
  if (props.squad.state === "no_leader") {
    items.push("No leader");
  }
  if (props.squad.isLocked) {
    items.push("Locked");
  }
  if (props.squad.knownPlaytimePlayers <= 0) {
    items.push("Steam time missing");
  }
  if (props.squad.averagePlaytimeHours != null && props.squad.averagePlaytimeHours < 10) {
    items.push("Low avg");
  }

  return items.slice(0, 3);
});

function warningTone(label: string): "warn" | "idle" {
  if (label === "Locked" || label === "No leader" || label === "Low avg" || label === "Steam time missing") {
    return "warn";
  }
  return "idle";
}
</script>

<style scoped>
.squad-card {
  flex: 0 0 auto;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.015)), rgba(255, 255, 255, 0.012)),
    var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--shadow-md);
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease,
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.squad-card:hover {
  border-color: var(--color-border-highlight);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.025)), rgba(255, 255, 255, 0.018)),
    var(--color-bg-elevated);
}

.squad-card.selected {
  border-color: var(--color-status-info);
  box-shadow:
    inset 0 0 0 1px var(--color-status-info),
    var(--shadow-md);
}

.squad-card.team1-context {
  border-left: 4px solid var(--color-team1-primary);
}

.squad-card.team2-context {
  border-left: 4px solid var(--color-team2-primary);
}

.squad-header {
  display: grid;
  gap: 10px;
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.008));
}

.squad-header-main {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.squad-title-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-width: 0;
  flex-wrap: wrap;
}

.squad-name {
  font-size: var(--font-size-md);
  font-weight: 800;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.squad-member-count {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-weight: 700;
  padding: 2px 7px;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid var(--color-border-soft);
}

.squad-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.squad-meta-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.squad-meta-chip.subtle {
  color: var(--color-text-muted);
}

.squad-warning-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-start;
}

.squad-warning-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  border: 1px solid var(--color-border-soft);
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.02);
}

.squad-warning-chip.tone-warn {
  color: var(--color-status-warning);
  border-color: rgba(245, 158, 11, 0.22);
  background: rgba(245, 158, 11, 0.08);
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

@media (max-width: 1100px) {
  .squad-header {
    gap: 8px;
  }
}
</style>
