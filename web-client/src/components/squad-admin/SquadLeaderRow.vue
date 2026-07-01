<template>
  <div
    class="squad-leader-row"
    :class="{ selected: isSelected }"
    @click="handleSelect"
  >
    <div class="leader-row-left">
      <div class="leader-role-stack">
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
        <div v-if="playtimeText" class="leader-playtime stat-chip stat-playtime">
          {{ playtimeText }}
        </div>
      </div>
      <div class="leader-row-content">
        <div class="leader-identity">
          <span class="leader-name">{{ player.name }}</span>
          <StatusBadge tone="ok">{{ t("match.squadLeader") }}</StatusBadge>
        </div>
        <div class="leader-meta">
          <span class="leader-role">{{ displayRole(player.role) }}</span>
        </div>
        <div class="leader-combat-stats scoreboard-line-compact">
          <span
            v-for="item in scoreboardItems"
            :key="item.key"
            class="stat-chip stat-scoreboard"
            :title="`${item.label}: ${item.value}`"
          >
            {{ item.shortLabel }} {{ item.value }}
          </span>
        </div>
        <div class="leader-combat-stats legacy-combat-line">
          <span class="stat-chip stat-down">击倒 {{ player.combatStats.downs }}</span>
          <span class="stat-chip stat-kill">击杀 {{ player.combatStats.kills }}</span>
          <span class="stat-chip stat-death">死亡 {{ player.combatStats.deaths }}</span>
          <span class="stat-chip stat-tk">TK {{ player.combatStats.tk }}</span>
          <span class="stat-chip stat-revive">复苏 {{ player.combatStats.revives }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { SquadLeaderRowViewModel } from "../../types/squad-admin.types";
import StatusBadge from "../common/StatusBadge.vue";
import { buildCombatScoreboardItems } from "../../utils/combat-scoreboard";
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
const scoreboardItems = computed(() => buildCombatScoreboardItems(props.player.combatStats));

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
  grid-template-columns: 52px minmax(0, 1fr);
  align-items: start;
  column-gap: 10px;
  min-width: 0;
  flex: 1;
}

.leader-row-content {
  display: grid;
  grid-template-rows: 22px 16px minmax(18px, auto);
  align-content: start;
  gap: 3px;
  min-width: 0;
}

.leader-identity {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
  min-height: 22px;
  flex-wrap: nowrap;
}

.leader-role-stack {
  display: grid;
  grid-template-rows: 22px 18px;
  align-content: start;
  justify-items: center;
  gap: 4px;
  width: 52px;
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
  line-height: 1.15;
  min-height: 16px;
  color: var(--color-text-muted);
  flex-wrap: wrap;
}

.leader-combat-stats {
  font-size: 10px;
  line-height: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-height: 16px;
  margin-top: 1px;
}

.leader-combat-stats.legacy-combat-line {
  display: none;
}

.scoreboard-line-compact {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  width: 100%;
}

.stat-scoreboard {
  gap: 3px;
  border-color: rgba(140, 160, 185, 0.15);
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-secondary);
}
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

.leader-role {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.leader-playtime {
  font-size: 10px;
  white-space: nowrap;
  flex-shrink: 0;
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
