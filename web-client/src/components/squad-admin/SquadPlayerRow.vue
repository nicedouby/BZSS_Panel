<template>
  <div
    class="squad-player-row player-row"
    :class="{
      selected: isSelected,
      'is-leader': player.isLeader,
      'is-checked': multiSelectMode && checked,
      'has-steam-avatar': Boolean(avatarUrl),
    }"
    @click="handleSelect"
  >
    <div class="player-side">
      <div v-if="multiSelectMode" class="player-checkbox-container" aria-hidden="true">
        <div class="player-checkbox-custom" :class="{ 'is-checked': checked }" />
      </div>
      <div v-else class="player-avatar-container">
        <div
          class="player-avatar"
          :title="`${displayRole(player.role)}${normalizedHealth != null ? `  HP: ${normalizedHealth.toFixed(0)}%` : ''}`"
        >
          <div
            v-if="normalizedHealth != null"
            class="health-liquid"
            :class="healthLiquidClass"
            :style="{ height: `${normalizedHealth}%` }"
          />
          <img
            v-if="isRoleIconImage"
            class="player-avatar-image"
            :src="roleIcon.icon"
            :alt="roleIcon.label"
            loading="lazy"
            decoding="async"
          >
          <span v-else class="player-avatar-text" aria-hidden="true">{{ roleIcon.icon }}</span>
          <span
            v-if="bzssCorePing != null"
            class="player-avatar-ping-badge"
            :class="pingBadgeClass"
            :title="`BZSS-Core 延迟: ${bzssCorePing}ms`"
          >
            {{ bzssCorePing }}ms
          </span>
        </div>
      </div>
    </div>

    <div class="player-main">
      <div class="player-title-line">
        <span class="player-name" :title="displayName">{{ displayName }}</span>
        <span
          v-if="bzssCoreFtBadge"
          class="bzss-core-ft-badge"
          :class="bzssCoreFtBadge.tone"
          :title="bzssCoreFtBadge.title"
        >
          {{ bzssCoreFtBadge.label }}
        </span>
        <span
          class="role-chip"
          :class="{ leader: player.isLeader }"
          :title="player.isLeader ? t('match.squadLeader') : t('match.squadMember')"
        >
          {{ player.isLeader ? "队长" : "成员" }}
        </span>
        <span v-if="playtimeText" class="playtime-chip" :title="playtimeTitle">
          {{ playtimeText }}
        </span>
      </div>

      <div v-if="secondaryIdentityText" class="player-sub-line" :title="secondaryIdentityText">
        {{ secondaryIdentityText }}
      </div>

      <div class="player-stat-line scoreboard-line">
        <span
          v-for="item in scoreboardItems"
          :key="item.key"
          class="scoreboard-chip"
          :class="item.tone"
          :title="`${item.label}: ${item.value}`"
        >
          <span class="label">{{ item.shortLabel }}</span>
          <span class="value">{{ item.value }}</span>
        </span>
      </div>
    </div>

    <a
      v-if="avatarUrl && player.steamId"
      class="player-steam-bg"
      :href="`https://steamcommunity.com/profiles/${player.steamId}`"
      target="_blank"
      rel="noopener noreferrer"
      :title="`查看 ${displayName} 的 Steam 个人资料`"
      @click.stop
    >
      <img
        class="player-steam-bg-img"
        :src="avatarUrl"
        alt=""
        width="52"
        height="52"
        loading="lazy"
        decoding="async"
        fetchpriority="low"
      >
    </a>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from "vue";
import type { CombatStats, PlayerRowViewModel } from "../../types/squad-admin.types";
import { buildCombatScoreboardItems } from "../../utils/combat-scoreboard";
import { resolveRoleIcon } from "../../utils/role-icons";
import { t } from "../../i18n";

const props = defineProps<{
  player: PlayerRowViewModel;
  playtimeHours: number | null;
  combatStats: CombatStats;
  health?: number | null;
  multiSelectMode?: boolean;
  checked?: boolean;
  steamAvatar?: string | null;
}>();

const emit = defineEmits<{
  (event: "select", payload: { player: PlayerRowViewModel; event: MouseEvent }): void;
  (event: "toggle-check", payload: { player: PlayerRowViewModel; event: MouseEvent }): void;
}>();

const selectedPlayerId = inject<any>("selectedPlayerId", ref(null));
const isSelected = computed(() => {
  if (selectedPlayerId.value == null || props.player.playerId == null) return false;
  return String(selectedPlayerId.value) === String(props.player.playerId);
});

const roleIcon = computed(() => resolveRoleIcon(props.player.role));
const isRoleIconImage = computed(() => String(roleIcon.value.icon ?? "").startsWith("/"));
const avatarUrl = computed(() => props.steamAvatar || props.player.steamAvatar || null);
const bzssCorePing = computed(() => {
  const value = Number(props.player.bzssCorePing);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
});
const pingBadgeClass = computed(() => {
  const ping = bzssCorePing.value ?? 0;
  if (ping > 120) return "high";
  if (ping > 60) return "medium";
  return "low";
});
const bzssCoreFtBadge = computed(() => {
  const value = Number(props.player.bzssCoreFtIndex);
  if (!Number.isFinite(value)) return null;
  const index = Math.trunc(value);
  const badges: Record<number, { label: string; tone: string }> = {
    0: { label: "A组", tone: "ft-green" },
    1: { label: "B组", tone: "ft-purple" },
    2: { label: "C组", tone: "ft-blue" },
  };
  const badge = badges[index] ?? { label: `FT ${index}`, tone: "ft-neutral" };
  return { ...badge, title: `BZSS-Core ftIndex: ${index}` };
});

const displayName = computed(() => String(props.player.name ?? "").trim() || "未知玩家");
const playtimeText = computed(() => formatPlaytime(props.playtimeHours));
const playtimeTitle = computed(() => {
  const hours = props.playtimeHours;
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0) return "Steam 时长未公开";
  return `Steam 游戏时长: ${hours.toFixed(1)}h`;
});
const secondaryIdentityText = computed(() => {
  const raw: any = props.player.raw ?? {};
  const candidates = [
    raw.steamName,
    raw.steam_name,
    raw.platformName,
    raw.platform_name,
    raw.rgfName,
    raw.rgf_name,
    raw.rawName,
    raw.raw_name,
    raw.name,
    raw.playerName,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim();
    if (normalized && normalized !== displayName.value) return normalized;
  }
  return "";
});
const scoreboardItems = computed(() => buildCombatScoreboardItems(props.combatStats, true, bzssCorePing.value));
const normalizedHealth = computed(() => {
  const value = Number(props.health);
  if (props.health == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
});
const healthLiquidClass = computed(() => {
  const hp = normalizedHealth.value;
  if (hp == null) return "";
  if (hp > 70) return "hp-high";
  if (hp > 35) return "hp-mid";
  return "hp-low";
});

function formatPlaytime(hours?: number | null) {
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0) return "未公开";
  return hours >= 1000 ? `${Math.round(hours)}h` : `${hours.toFixed(1)}h`;
}

function handleSelect(event: MouseEvent) {
  if (props.multiSelectMode) emit("toggle-check", { player: props.player, event });
  else emit("select", { player: props.player, event });
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
.squad-player-row {
  position: relative;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  align-items: center;
  min-height: 56px;
  gap: 9px;
  padding: 6px 8px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 9px;
  background: rgba(7, 13, 24, 0.2);
  cursor: pointer;
  contain: layout paint style;
  content-visibility: auto;
  contain-intrinsic-size: 56px;
}

.squad-player-row:hover {
  border-color: rgba(96, 165, 250, 0.38);
  background: rgba(30, 64, 175, 0.12);
}

.squad-player-row.selected,
.squad-player-row.is-checked {
  border-color: rgba(56, 189, 248, 0.68);
  background: rgba(14, 116, 144, 0.18);
}

.squad-player-row.is-leader {
  border-left: 3px solid rgba(250, 204, 21, 0.78);
}

.player-side,
.player-avatar-container,
.player-checkbox-container {
  display: grid;
  place-items: center;
  min-width: 0;
}

.player-avatar {
  position: relative;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 9px;
  background: rgba(15, 23, 42, 0.78);
}

.health-liquid {
  position: absolute;
  inset: auto 0 0;
  pointer-events: none;
  opacity: 0.58;
}

.health-liquid.hp-high { background: rgba(34, 197, 94, 0.72); }
.health-liquid.hp-mid { background: rgba(245, 158, 11, 0.76); }
.health-liquid.hp-low { background: rgba(239, 68, 68, 0.82); }

.player-avatar-image {
  position: relative;
  z-index: 1;
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.player-avatar-text {
  position: relative;
  z-index: 1;
  font-size: 18px;
  line-height: 1;
}

.player-avatar-ping-badge {
  position: absolute;
  right: -5px;
  bottom: -5px;
  z-index: 2;
  min-width: 31px;
  padding: 1px 4px;
  border-radius: 999px;
  background: #111827;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
  white-space: nowrap;
}

.player-avatar-ping-badge.low { color: #86efac; }
.player-avatar-ping-badge.medium { color: #fde68a; }
.player-avatar-ping-badge.high { color: #fca5a5; }

.player-checkbox-custom {
  width: 18px;
  height: 18px;
  border: 1px solid rgba(148, 163, 184, 0.58);
  border-radius: 5px;
  background: rgba(15, 23, 42, 0.72);
}

.player-checkbox-custom.is-checked {
  border-color: #38bdf8;
  background: #0284c7;
  box-shadow: inset 0 0 0 4px #0c4a6e;
}

.player-main {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.player-title-line,
.player-stat-line {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 5px;
}

.player-name {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-primary, #f8fafc);
  font-size: 13px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-sub-line {
  overflow: hidden;
  color: var(--color-text-muted, #94a3b8);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-chip,
.playtime-chip,
.bzss-core-ft-badge,
.scoreboard-chip {
  flex: 0 0 auto;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.52);
  color: var(--color-text-secondary, #cbd5e1);
  font-size: 9px;
  font-weight: 700;
  line-height: 16px;
  padding: 0 5px;
  white-space: nowrap;
}

.role-chip.leader { color: #fde68a; }
.playtime-chip { color: #93c5fd; }
.bzss-core-ft-badge.ft-green { color: #86efac; }
.bzss-core-ft-badge.ft-purple { color: #d8b4fe; }
.bzss-core-ft-badge.ft-blue { color: #93c5fd; }
.bzss-core-ft-badge.ft-neutral { color: #cbd5e1; }

.scoreboard-line {
  overflow: hidden;
}

.scoreboard-chip {
  display: inline-flex;
  gap: 3px;
  padding-inline: 4px;
}

.scoreboard-chip .label { color: var(--color-text-muted, #94a3b8); }
.scoreboard-chip .value { color: var(--color-text-primary, #f8fafc); }

.player-steam-bg {
  position: relative;
  z-index: 1;
  display: block;
  width: 52px;
  height: 52px;
  overflow: hidden;
  border-radius: 8px;
  opacity: 0.72;
}

.player-steam-bg-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

@media (max-width: 720px) {
  .squad-player-row {
    grid-template-columns: 40px minmax(0, 1fr) 42px;
    gap: 6px;
  }

  .player-steam-bg {
    width: 42px;
    height: 42px;
  }

  .scoreboard-chip:nth-child(n + 5) {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .squad-player-row,
  .health-liquid {
    transition: none !important;
    animation: none !important;
  }
}
</style>
