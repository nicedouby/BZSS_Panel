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
          <StatusBadge class="squad-status-badge" :tone="squad.isLocked ? 'warn' : 'idle'">
            {{ squad.isLocked ? t("common.locked") : t("common.open") }}
          </StatusBadge>
        </div>

        <div class="squad-meta-row">
          <span class="squad-meta-summary">{{ squadAveragePlaytimeText }}</span>
          <span v-if="squad.creatorName" class="squad-meta-creator">by {{ squad.creatorName }}</span>
        </div>

        <span v-if="squad.createdAtLabel" class="squad-created-time">
          {{ squad.createdDisplayText || squad.createdAtLabel }}
          <em v-if="squad.sourceLabel">· {{ squad.sourceLabel }}</em>
        </span>
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
  densityMode?: "comfortable" | "compact";
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
    return `Avg -- · ${publicText}${privateText ? ` · ${privateText}` : ""}`;
  }

  return `Avg ${props.squad.averagePlaytimeHours}h · ${publicText}${privateText ? ` · ${privateText}` : ""}`;
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
  border-radius: 9px;
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
  gap: 4px;
  padding: 7px 10px 8px;
  border-bottom: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.008));
}

.squad-header-main {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.squad-title-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-width: 0;
  flex-wrap: wrap;
  line-height: 1;
}

.squad-name {
  font-size: 13px;
  font-weight: 800;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.squad-member-count {
  font-size: 11px;
  color: var(--color-text-secondary);
  font-weight: 700;
  padding: 2px 6px;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid var(--color-border-soft);
}

.squad-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  line-height: 1.1;
}

.squad-meta-summary {
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.squad-status-badge {
  min-height: 20px;
  padding-inline: 7px;
  font-size: 11px;
}

.squad-status-badge :deep(.badge) {
  min-height: 20px;
  padding: 1px 7px;
  font-size: 11px;
}

.squad-meta-creator {
  color: var(--color-text-muted);
  flex: 0 0 auto;
  font-size: 10px;
  white-space: nowrap;
}

.squad-created-time {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  color: var(--color-text-muted);
  font-size: 10px;
  line-height: 1.1;
  white-space: nowrap;
}

.squad-created-time em {
  font-style: normal;
  color: var(--color-text-secondary);
}

.squad-warning-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-start;
}

.squad-warning-chip {
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  font-size: 10px;
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
  padding: 10px 12px 12px;
  text-align: center;
}

.squad-empty-text {
  color: var(--color-text-muted);
  font-size: 11px;
}

.squad-warning {
  padding: 8px 10px;
  background-color: rgba(245, 158, 11, 0.08);
  border-top: 1px solid var(--color-border-soft);
  color: var(--color-status-warning);
  font-size: 11px;
  border-left: 2px solid var(--color-status-warning);
}



@media (max-width: 1100px) {
  .squad-header {
    gap: 3px;
  }
}
</style>
