<template>
  <div
    class="player-row"
    :class="{ selected: isSelected }"
    @click="handleSelect"
  >
    <div class="player-row-left">
      <div class="player-role-stack">
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
        <div v-if="playtimeText" class="player-playtime stat-chip stat-playtime">
          {{ playtimeText }}
        </div>
      </div>
      <div class="player-row-content">
        <div class="player-identity">
          <span class="player-name">{{ player.name }}</span>
        </div>
        <div class="player-meta">
          <span class="player-role">{{ displayRole(player.role) }}</span>
        </div>
        <div class="player-combat-stats">
          <span class="stat-chip stat-down">击倒 {{ player.combatStats.downs }}</span>
          <span class="stat-chip stat-kill">击杀 {{ player.combatStats.kills }}</span>
          <span class="stat-chip stat-death">死亡 {{ player.combatStats.deaths }}</span>
          <span class="stat-chip stat-tk">TK {{ player.combatStats.tk }}</span>
          <span class="stat-chip stat-revive">复苏 {{ player.combatStats.revives }}</span>
          <span class="stat-chip stat-ping">Ping {{ player.ping ?? '--' }}</span>
        </div>
      </div>
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

const emit = defineEmits<{
  (event: "select", payload: { player: PlayerRowViewModel; event: MouseEvent }): void;
}>();

const isSelected = computed(() => props.selected ?? false);
const roleIcon = computed(() => resolveRoleIcon(props.player.role));
const isRoleIconImage = computed(() => roleIcon.value.icon.startsWith("/"));

const playtimeText = computed(() => {
  if (props.player.playtimeHours == null) return "";
  if (Number(props.player.playtimeHours) === 0) return "未公开";
  return `${props.player.playtimeHours}h`;
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
.player-row {
  padding: 10px var(--spacing-md);
  border-top: 1px solid var(--color-border-soft);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacing-md);
  background: rgba(255, 255, 255, 0.006);
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
  cursor: pointer;
}

.player-row:hover {
  background: rgba(96, 165, 250, 0.1);
}

.player-row.selected {
  background: var(--color-bg-selected);
}

.player-row-left {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  align-items: start;
  column-gap: 10px;
  min-width: 0;
  flex: 1;
}

.player-row-content {
  display: grid;
  grid-template-rows: 22px 16px minmax(18px, auto);
  align-content: start;
  gap: 3px;
  min-width: 0;
}

.player-identity {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  min-height: 22px;
}

.player-role-stack {
  display: grid;
  grid-template-rows: 22px 18px;
  align-content: start;
  justify-items: center;
  gap: 4px;
  width: 52px;
}

.player-name {
  font-weight: 500;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-meta {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
  font-size: var(--font-size-xs);
  line-height: 1.15;
  min-height: 16px;
  color: var(--color-text-muted);
  flex-wrap: wrap;
}

.player-combat-stats {
  font-size: 11px;
  line-height: 1.3;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-height: 18px;
  margin-top: 1px;
}

.stat-chip {
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid transparent;
  white-space: nowrap;
}

.stat-down {
  border-color: rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
}

.stat-kill {
  border-color: rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.stat-death {
  border-color: rgba(0, 0, 0, 0.3);
  background: rgba(0, 0, 0, 0.1);
  color: #000;
}

.stat-tk {
  border-color: rgba(168, 85, 247, 0.35);
  background: rgba(168, 85, 247, 0.12);
  color: #a855f7;
}

.stat-revive {
  border-color: rgba(34, 197, 94, 0.35);
  background: rgba(34, 197, 94, 0.12);
  color: #22c55e;
}

.stat-ping {
  border-color: rgba(148, 163, 184, 0.35);
  background: rgba(148, 163, 184, 0.12);
  color: #94a3b8;
}

.stat-playtime {
  border-color: rgba(96, 165, 250, 0.35);
  background: rgba(96, 165, 250, 0.12);
  color: #60a5fa;
  justify-content: center;
  width: 52px;
  max-width: 52px;
  box-sizing: border-box;
  padding: 1px 5px;
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

.player-playtime {
  font-size: 10px;
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
