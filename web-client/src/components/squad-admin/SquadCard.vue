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
        <div class="squad-header-title-main">
          <strong>{{ squad.squadName }}</strong>
          <span class="squad-member-count">{{ squad.memberCount }}/{{ squad.maxMembers }}</span>
          <StatusBadge :tone="squad.isLocked ? 'warn' : 'idle'">
            {{ squad.isLocked ? t("common.locked") : t("common.open") }}
          </StatusBadge>
        </div>

        <div class="squad-header-subtitle">
          <span class="squad-average-playtime">{{ squadAveragePlaytimeText }}</span>
          <span v-if="squad.creatorName" class="squad-header-creator">
            Created by {{ squad.creatorName }}
          </span>
        </div>
      </div>

      <div class="squad-header-actions">
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
  if (props.squad.knownPlaytimePlayers <= 0) return "Steam 时长未加载";

  const privateText = props.squad.privatePlaytimePlayers > 0
    ? ` / 未公开 ${props.squad.privatePlaytimePlayers}`
    : "";

  if (props.squad.averagePlaytimeHours == null) {
    return `平均时长 -- / 公开 0${privateText}`;
  }

  return `平均 ${props.squad.averagePlaytimeHours}h / 公开 ${props.squad.publicPlaytimePlayers}${privateText}`;
});

const squadWarnings = computed(() => {
  const items: string[] = [];

  if (props.squad.state === "empty") {
    items.push("空队");
  }
  if (props.squad.state === "no_leader") {
    items.push("无队长");
  }
  if (props.squad.isLocked) {
    items.push("锁队");
  }
  if (props.squad.knownPlaytimePlayers <= 0) {
    items.push("时长缺失");
  }
  if (props.squad.averagePlaytimeHours != null && props.squad.averagePlaytimeHours < 10) {
    items.push("低时长");
  }

  return items.slice(0, 3);
});

function warningTone(label: string): "warn" | "idle" {
  if (label === "锁队" || label === "无队长" || label === "低时长" || label === "时长缺失") {
    return "warn";
  }
  return "idle";
}
</script>

<style scoped>
.squad-card {
  flex: 0 0 auto;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.012)),
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
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.018)),
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
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--spacing-md);
  align-items: center;
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.025);
}

.squad-header-title {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.squad-header-title-main {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-width: 0;
  flex-wrap: wrap;
}

.squad-header strong {
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

.squad-header-subtitle {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
  flex-wrap: wrap;
  min-width: 0;
}

.squad-average-playtime {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  white-space: nowrap;
}

.squad-header-creator {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  white-space: nowrap;
}

.squad-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
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
    grid-template-columns: 1fr;
    align-items: start;
  }

  .squad-header-actions {
    justify-content: flex-start;
  }
}
</style>
