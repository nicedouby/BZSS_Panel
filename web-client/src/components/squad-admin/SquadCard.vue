<template>
  <article
    class="squad-card"
    :class="[teamColorClass, { selected: hasSelectedPlayer }]"
  >
    <header class="squad-header" @click.stop="$emit('select-squad', squad)">
      <div class="squad-header-main">
        <div class="squad-title-row">
          <span v-if="squad.squadId != null" class="squad-id-badge">#{{ squad.squadId }}</span>
          <strong class="squad-name">{{ squad.squadName }}</strong>
          <StatusBadge class="squad-nature-badge" :tone="natureTone(squad.squadNature)">
            {{ squad.squadNatureLabel }}
          </StatusBadge>
          <StatusBadge class="squad-type-badge" :tone="vehicleTone(squad.squadVehicleClass)">
            {{ squad.squadVehicleClassLabel || "其他" }}
          </StatusBadge>
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
          <em v-if="squad.sourceLabel">路 {{ squad.sourceLabel }}</em>
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
      <div class="squad-player-list">
        <SquadPlayerRow
          v-if="squad.leader"
          :player="squad.leader"
          :selected="String(selectedPlayerId) === String(squad.leader.playerId)"
          @select="handlePlayerSelect"
        />

        <div v-if="squad.state === 'no_leader'" class="squad-warning">
          {{ t("match.noSquadLeader") }}
        </div>

        <SquadPlayerRow
          v-for="member in squad.members"
          :key="`player-${member.playerId}`"
          :player="member"
          :selected="String(selectedPlayerId) === String(member.playerId)"
          @select="handlePlayerSelect"
        />
      </div>
    </template>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PlayerRowViewModel, SquadViewModel } from "../../types/squad-admin.types";
import StatusBadge from "../common/StatusBadge.vue";
import SquadPlayerRow from "./SquadPlayerRow.vue";
import { t } from "../../i18n";

const props = defineProps<{
  squad: SquadViewModel;
  selectedPlayerId?: string | number | null;
  densityMode?: "comfortable" | "compact";
}>();

const emit = defineEmits<{
  (event: "select-player", payload: { player: PlayerRowViewModel; event: MouseEvent }): void;
  (event: "select-squad", squad: SquadViewModel): void;
}>();

const teamColorClass = computed(() => {
  if (props.squad.teamId === 1) return "team1-context";
  if (props.squad.teamId === 2) return "team2-context";
  return "";
});

const hasSelectedPlayer = computed(() => {
  if (props.selectedPlayerId == null) return false;
  if (props.squad.leader && String(props.squad.leader.playerId) === String(props.selectedPlayerId)) return true;
  return props.squad.members.some((member) => String(member.playerId) === String(props.selectedPlayerId));
});

const squadAveragePlaytimeText = computed(() => {
  if (props.squad.knownPlaytimePlayers <= 0) return "Steam time unavailable";

  const publicText = `Public ${props.squad.publicPlaytimePlayers}`;
  const privateText = props.squad.privatePlaytimePlayers > 0 ? `Private ${props.squad.privatePlaytimePlayers}` : "";

  if (props.squad.averagePlaytimeHours == null) {
    return `Avg -- 路 ${publicText}${privateText ? ` 路 ${privateText}` : ""}`;
  }

  return `Avg ${props.squad.averagePlaytimeHours}h 路 ${publicText}${privateText ? ` 路 ${privateText}` : ""}`;
});

const squadWarnings = computed(() => {
  const items: string[] = [];
  if (props.squad.state === "empty") items.push("Empty");
  if (props.squad.state === "no_leader") items.push("No leader");
  if (props.squad.isLocked) items.push("Locked");
  if (props.squad.knownPlaytimePlayers <= 0) items.push("Steam time missing");
  if (props.squad.averagePlaytimeHours != null && props.squad.averagePlaytimeHours < 10) items.push("Low avg");
  return items.slice(0, 3);
});

function warningTone(label: string): "warn" | "idle" {
  if (label === "Locked" || label === "No leader" || label === "Low avg" || label === "Steam time missing") {
    return "warn";
  }
  return "idle";
}

function natureTone(nature: SquadViewModel["squadNature"]): "ok" | "warn" | "idle" {
  if (nature === "vehicle") return "warn";
  if (nature === "infantry" || nature === "support") return "ok";
  return "idle";
}

function vehicleTone(vehicleClass: SquadViewModel["squadVehicleClass"]): "ok" | "warn" | "idle" {
  if (vehicleClass === "tank" || vehicleClass === "spg") return "warn";
  if (vehicleClass === "ifv" || vehicleClass === "light_vehicle") return "ok";
  return "idle";
}

function handlePlayerSelect(payload: { player: PlayerRowViewModel; event: MouseEvent }) {
  emit("select-player", payload);
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
  transition: border-color 0.15s ease, background-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
}

.squad-card:hover {
  border-color: var(--color-border-highlight);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.025)), rgba(255, 255, 255, 0.018)),
    var(--color-bg-elevated);
}

.squad-card.selected {
  border-color: var(--color-status-info);
  box-shadow: inset 0 0 0 1px var(--color-status-info), var(--shadow-md);
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
  cursor: pointer;
  transition: background-color 0.2s;
}

.squad-header:hover {
  background: rgba(255, 255, 255, 0.08);
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

.squad-nature-badge,
.squad-type-badge {
  min-height: 20px;
  padding-inline: 7px;
  font-size: 11px;
}

.squad-id-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 18px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 900;
  color: #fff;
  background-color: var(--color-status-info);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.2);
}

.team1-context .squad-id-badge {
  background-color: var(--color-team1-primary);
}

.team2-context .squad-id-badge {
  background-color: var(--color-team2-primary);
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
