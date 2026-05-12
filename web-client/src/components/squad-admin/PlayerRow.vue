<template>
  <div
    class="player-row"
    :class="{ selected: isSelected }"
    @click="$emit('select')"
  >
    <div class="player-row-left">
      <div class="player-identity">
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
        <span class="player-name">{{ player.name }}</span>
      </div>
      <div class="player-meta">
        <span class="player-role">{{ displayRole(player.role) }}</span>
        <span class="player-id">{{ t("field.id") }} {{ player.playerId ?? "-" }}</span>
      </div>
    </div>
    <div v-if="playtimeText" class="player-playtime">
      {{ playtimeText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PlayerRowViewModel } from "../../types/squad-admin.types";
import { resolveRoleIcon } from "../../utils/role-icons";
import { t } from "../../i18n";

const props = defineProps<{
  player: PlayerRowViewModel;
  selected?: boolean;
}>();

defineEmits<{
  (event: "select"): void;
}>();

const isSelected = computed(() => props.selected ?? false);
const roleIcon = computed(() => resolveRoleIcon(props.player.role));
const isRoleIconImage = computed(() => roleIcon.value.icon.startsWith("/"));

const playtimeText = computed(() => {
  if (props.player.playtimeHours == null) return "";
  if (Number(props.player.playtimeHours) === 0) return `${t("player.steamTime")} 未公开`;
  return `${t("player.steamTime")} ${props.player.playtimeHours}h`;
});

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
.player-row {
  padding: var(--spacing-md);
  border-top: 1px solid var(--color-border-soft);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacing-md);
  transition: all 0.15s ease;
  cursor: pointer;
}

.player-row:hover {
  background-color: var(--color-bg-hover);
}

.player-row.selected {
  background-color: var(--color-bg-selected);
}

.player-row-left {
  display: grid;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.player-identity {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.player-name {
  font-weight: 600;
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-meta {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  flex-wrap: wrap;
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

.player-role {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-id {
  white-space: nowrap;
}

.player-playtime {
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

@media (max-width: 640px) {
  .player-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .player-playtime {
    font-size: var(--font-size-xs);
  }
}
</style>
