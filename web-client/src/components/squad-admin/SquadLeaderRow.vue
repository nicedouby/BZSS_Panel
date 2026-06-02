<template>
  <div
    class="squad-leader-row"
    :class="{ selected: isSelected }"
    @click="handleSelect"
  >
    <div class="leader-row-left">
      <div class="leader-identity">
        <span
          class="role-icon"
          :class="`tone-${roleIcon.tone}`"
          :title="`${roleIcon.label}: ${displayRole(player.role)}`"
          aria-hidden="true"
        >
          <img
            v-if="isRoleIconImage"
            class="role-icon-image"
            :src="roleIcon.icon"
            :alt="roleIcon.label"
          />
          <span v-else>{{ roleIcon.icon }}</span>
        </span>
        <span class="leader-name">{{ player.name }}</span>
        <StatusBadge tone="ok">{{ t("match.squadLeader") }}</StatusBadge>
      </div>
      <div class="leader-meta">
        <span v-if="player.squadId != null" class="player-squad-badge">#{{ player.squadId }}</span>
        <span class="leader-role">{{ displayRole(player.role) }}</span>
        <span class="leader-id">{{ t("field.id") }} {{ player.playerId ?? "-" }}</span>
      </div>
    </div>
    <div v-if="playtimeText" class="leader-playtime">
      {{ playtimeText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { SquadLeaderRowViewModel } from "../../types/squad-admin.types";
import StatusBadge from "../common/StatusBadge.vue";
import { resolveRoleIcon } from "../../utils/role-icons";
import { t } from "../../i18n";

const props = defineProps<{
  player: SquadLeaderRowViewModel;
  selected?: boolean;
}>();

const emit = defineEmits<{
  (event: "select", payload: { player: SquadLeaderRowViewModel; event: MouseEvent }): void;
}>();

const isSelected = computed(() => props.selected ?? false);
const roleIcon = computed(() => resolveRoleIcon(props.player.role));
const isRoleIconImage = computed(() => roleIcon.value.icon.startsWith("/"));

const playtimeText = computed(() => {
  if (props.player.playtimeHours == null) return "";
  if (Number(props.player.playtimeHours) === 0) return `${t("player.steamTime")} 未公开`;
  return `${t("player.steamTime")} ${props.player.playtimeHours}h`;
});

function handleSelect(event: MouseEvent) {
  emit("select", { player: props.player, event });
}

function displayRole(role: string | null | undefined) {
  const raw = String(role ?? "").trim();
  if (!raw) return t("role.unknownRole");
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const keyMap: Record<string, string> = {
    squadleader: "role.squadLeader",
    medic: "role.medic",
    heavyantitank: "role.heavyAntiTank",
    lightantitank: "role.lightAntiTank",
    machinegunner: "role.machineGunner",
    automaticrifleman: "role.automaticRifleman",
    engineer: "role.engineer",
    sapper: "role.sapper",
    marksman: "role.marksman",
    sniper: "role.sniper",
    grenadier: "role.grenadier",
    crewman: "role.crewman",
    pilot: "role.pilot",
    rifleman: "role.rifleman",
  };
  const key = keyMap[normalized];
  return key ? t(key, raw) : raw;
}
</script>

<style scoped>
.squad-leader-row {
  padding: var(--spacing-md);
  border-top: 1px solid var(--color-border-soft);
  border-left: 4px solid var(--color-status-leader);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacing-md);
  background:
    linear-gradient(90deg, rgba(250, 204, 21, 0.14), rgba(250, 204, 21, 0.03));
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
  cursor: pointer;
}

.squad-leader-row:hover {
  background:
    linear-gradient(90deg, rgba(250, 204, 21, 0.2), rgba(250, 204, 21, 0.05));
}

.squad-leader-row.selected {
  background-color: var(--color-bg-selected);
  border-left-color: var(--color-status-info);
}

.leader-row-left {
  display: grid;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.leader-identity {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
  flex-wrap: nowrap;
}

.role-icon {
  width: 22px;
  height: 22px;
  display: inline-grid;
  place-items: center;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  flex: 0 0 auto;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
}

.role-icon-image {
  width: 16px;
  height: 16px;
  object-fit: contain;
  display: block;
}

.tone-leader {
  color: #facc15;
  background: rgba(250, 204, 21, 0.1);
}

.tone-medic {
  color: #fb7185;
  background: rgba(251, 113, 133, 0.1);
}

.tone-at {
  color: #f97316;
  background: rgba(249, 115, 22, 0.1);
}

.tone-mg {
  color: #a78bfa;
  background: rgba(167, 139, 250, 0.1);
}

.tone-engineer {
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.1);
}

.tone-marksman {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.1);
}

.tone-rifleman {
  color: #cbd5e1;
  background: rgba(203, 213, 225, 0.08);
}

.tone-crewman {
  color: #94a3b8;
  background: rgba(148, 163, 184, 0.1);
}

.tone-pilot {
  color: #60a5fa;
  background: rgba(96, 165, 250, 0.1);
}

.tone-default {
  color: #94a3b8;
  background: rgba(148, 163, 184, 0.06);
}

.leader-name {
  font-weight: 800;
  color: var(--color-text-primary);
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.leader-meta {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  flex-wrap: wrap;
}

.leader-role {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.leader-id {
  white-space: nowrap;
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
  background-color: var(--color-status-info);
  opacity: 0.9;
}

.leader-playtime {
  font-size: var(--font-size-xs);
  color: var(--color-status-leader);
  white-space: nowrap;
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: var(--radius-full);
  background: rgba(250, 204, 21, 0.09);
  border: 1px solid rgba(250, 204, 21, 0.18);
}

@media (max-width: 640px) {
  .squad-leader-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .leader-playtime {
    font-size: var(--font-size-xs);
  }
}
</style>
