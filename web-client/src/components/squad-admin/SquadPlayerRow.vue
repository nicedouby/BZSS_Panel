<template>
  <div
    class="squad-player-row player-row"
    :class="{ selected: isSelected, 'is-leader': player.isLeader, 'is-checked': multiSelectMode && checked, 'has-steam-avatar': !!avatarUrl }"
    @click="handleSelect"
  >
    <div class="player-side">
      <div v-if="multiSelectMode" class="player-checkbox-container">
        <div class="player-checkbox-custom" :class="{ 'is-checked': checked }"></div>
      </div>
      <div v-else class="player-avatar-container">
        <div
          class="player-avatar"
          :title="`${displayRole(player.role)}${health != null ? '  HP: ' + health.toFixed(0) + '%' : ''}`"
        >
          <!-- DNF-style liquid health fill -->
          <div
            v-if="health != null"
            class="health-liquid"
            :class="healthLiquidClass"
            :style="{ height: `${Math.max(0, Math.min(100, health))}%` }"
          />
          <!-- Role icon on top -->
          <img
            v-if="isRoleIconImage"
            class="player-avatar-image"
            :src="roleIcon.icon"
            :alt="roleIcon.label"
          />
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
          style="margin-left: 6px;"
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
        <div v-if="playtimeText" class="playtime-chip" :title="playtimeTitle">
          {{ playtimeText }}
        </div>
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

      <div class="player-stat-line legacy-combat-line">
        <span class="stat-chip wound" :title="`击倒: ${downs}`">
          <span class="label">倒</span>
          <span class="value">{{ downs }}</span>
        </span>
        <span class="stat-chip kill" :title="`击杀: ${kills}`">
          <span class="label">杀</span>
          <span class="value">{{ kills }}</span>
        </span>
        <span class="stat-chip death" :title="`死亡: ${deaths}`">
          <span class="label">亡</span>
          <span class="value">{{ deaths }}</span>
        </span>
        <span class="stat-chip tk" :title="`TK: ${tk}`">
          <span class="label">TK</span>
          <span class="value">{{ tk }}</span>
        </span>
        <span class="stat-chip revive" :title="`复苏: ${revives}`">
          <span class="label">苏</span>
          <span class="value">{{ revives }}</span>
        </span>
        <span v-if="squadlessText" class="stat-chip" :title="`游离时长: ${squadlessText}`">
          <span class="label">游离</span>
          <span class="value">{{ squadlessText }}</span>
        </span>
      </div>
    </div>

    <!-- Steam Avatar - Right side decorative with slanted fade -->
    <a
      v-if="avatarUrl"
      class="player-steam-bg"
      :href="`https://steamcommunity.com/profiles/${player.steamId}`"
      target="_blank"
      rel="noopener noreferrer"
      :title="`查看 ${displayName} 的 Steam 个人资料`"
      @click.stop
    >
      <img class="player-steam-bg-img" :src="avatarUrl" alt="" />
    </a>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from "vue";
import type { PlayerRowViewModel, CombatStats } from "../../types/squad-admin.types";
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
const isRoleIconImage = computed(() => roleIcon.value.icon.startsWith("/"));
const avatarUrl = computed(() => props.steamAvatar || props.player.steamAvatar || null);
const bzssCorePing = computed(() => props.player.bzssCorePing ?? null);
const bzssCoreFtBadge = computed(() => {
  const ftIndex = props.player.bzssCoreFtIndex;
  if (ftIndex == null || !Number.isFinite(Number(ftIndex))) return null;
  const index = Math.trunc(Number(ftIndex));
  const badgeMap: Record<number, { label: string; tone: string }> = {
    0: { label: "A组", tone: "ft-green" },
    1: { label: "B组", tone: "ft-purple" },
    2: { label: "C组", tone: "ft-blue" },
  };
  const badge = badgeMap[index];
  if (!badge) {
    return {
      label: `FT ${index}`,
      tone: "ft-neutral",
      title: `BZSS-Core ftIndex: ${index}`,
    };
  }
  return {
    ...badge,
    title: `BZSS-Core ftIndex: ${index}`,
  };
});
const pingBadgeClass = computed(() => {
  const ping = Number(bzssCorePing.value ?? 0);
  if (ping > 120) return "high";
  if (ping > 60) return "medium";
  return "low";
});

const displayName = computed(() => {
  const raw = String(props.player.name ?? "").trim();
  return raw || "未知玩家";
});

const playtimeText = computed(() => formatPlaytime(props.playtimeHours));
const playtimeTitle = computed(() => {
  const hours = props.playtimeHours;
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours === 0) return "Steam 时长未公开";
  return `Steam 游戏时长: ${hours.toFixed(1)}h`;
});

const secondaryIdentityText = computed(() => {
  const raw: any = props.player.raw ?? {};

  const candidates: unknown[] = [
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

  const steamId = String(props.player.steamId ?? "").trim();
  if (steamId) return steamId;

  return "";
});

const scoreboardItems = computed(() => buildCombatScoreboardItems(props.combatStats));
const kills = computed(() => normalizeStat(props.combatStats?.kills));
const downs = computed(() => normalizeStat(props.combatStats?.downs));
const deaths = computed(() => normalizeStat(props.combatStats?.deaths));
const tk = computed(() => normalizeStat(props.combatStats?.tk));
const revives = computed(() => normalizeStat(props.combatStats?.revives));

const healthLiquidClass = computed(() => {
  const hp = props.health;
  if (hp == null) return "";
  if (hp > 70) return "hp-high";
  if (hp > 35) return "hp-mid";
  return "hp-low";
});

const squadlessText = computed(() => {
  if (props.player.squadId != null) return "";
  const raw: any = props.player.raw ?? {};
  const seconds = Number(raw.squadlessSeconds ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  return formatDurationShort(seconds);
});

function normalizeStat(value: unknown) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

function pingClass(ping: number, loss?: number | null) {
  const lossRate = Number(loss ?? 0);
  if (ping > 120 || lossRate > 20) return "high";
  if (ping > 60 || lossRate > 5) return "medium";
  return "low";
}

function formatPlaytime(hours?: number | null) {
  if (typeof hours !== "number" || !Number.isFinite(hours)) {
    return "未公开";
  }

  if (hours === 0) {
    return "未公开";
  }

  if (hours >= 1000) {
    return `${Math.round(hours)}h`;
  }

  return `${hours.toFixed(1)}h`;
}

function handleSelect(event: MouseEvent) {
  if (props.multiSelectMode) {
    emit("toggle-check", { player: props.player, event });
  } else {
    emit("select", { player: props.player, event });
  }
}

function formatDurationShort(secondsValue: number) {
  const total = Math.max(0, Math.floor(Number(secondsValue ?? 0)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
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
/* ─── DNF liquid health fill inside avatar ───────────────────────────────── */
.health-liquid {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  /* height is driven by inline style = HP% */
  transition: height 0.45s cubic-bezier(0.25, 0.8, 0.25, 1), background-color 0.4s ease;
  z-index: 0;
  pointer-events: none;
}

.health-liquid.hp-high {
  background: linear-gradient(0deg, rgba(34,197,94,0.55) 0%, rgba(74,222,128,0.28) 100%);
  box-shadow: 0 -2px 8px rgba(34, 197, 94, 0.4) inset;
}

.health-liquid.hp-mid {
  background: linear-gradient(0deg, rgba(245,158,11,0.55) 0%, rgba(251,191,36,0.28) 100%);
  box-shadow: 0 -2px 8px rgba(245, 158, 11, 0.4) inset;
}

.health-liquid.hp-low {
  background: linear-gradient(0deg, rgba(239,68,68,0.65) 0%, rgba(248,113,113,0.32) 100%);
  box-shadow: 0 -2px 10px rgba(239, 68, 68, 0.5) inset;
  animation: hp-liquid-pulse 1.4s ease-in-out infinite;
}

@keyframes hp-liquid-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.55; }
}

/* Role icon and text sit above the fill */
.player-avatar .player-avatar-image,
.player-avatar .player-avatar-text {
  position: relative;
  z-index: 1;
}

.player-avatar-container {
  position: relative;
}

.player-avatar {
  position: relative;
  overflow: visible;
}

.player-avatar-ping-badge {
  position: absolute;
  right: -6px;
  bottom: -6px;
  z-index: 3;
  min-width: 34px;
  padding: 1px 5px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 9px;
  line-height: 1.2;
  font-weight: 800;
  text-align: center;
  letter-spacing: 0.02em;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
}

.player-avatar-ping-badge.low {
  color: #d7ffe4;
  background: rgba(34, 197, 94, 0.85);
  border-color: rgba(34, 197, 94, 0.3);
}

.player-avatar-ping-badge.medium {
  color: #fff4d6;
  background: rgba(245, 158, 11, 0.88);
  border-color: rgba(245, 158, 11, 0.3);
}

.player-avatar-ping-badge.high {
  color: #ffe1e1;
  background: rgba(239, 68, 68, 0.9);
  border-color: rgba(239, 68, 68, 0.35);
}

.bzss-core-ft-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 10px;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.bzss-core-ft-badge.ft-green {
  color: #d7ffe4;
  background: rgba(34, 197, 94, 0.2);
  border-color: rgba(34, 197, 94, 0.35);
}

.bzss-core-ft-badge.ft-purple {
  color: #efe3ff;
  background: rgba(168, 85, 247, 0.2);
  border-color: rgba(168, 85, 247, 0.35);
}

.bzss-core-ft-badge.ft-blue {
  color: #d7ecff;
  background: rgba(59, 130, 246, 0.2);
  border-color: rgba(59, 130, 246, 0.35);
}

.bzss-core-ft-badge.ft-neutral {
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.12);
}
</style>
