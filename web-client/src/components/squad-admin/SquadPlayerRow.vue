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
          :title="`${displayRole(player.role)}${normalizedHealth != null ? '  HP: ' + normalizedHealth.toFixed(0) + '%' : ''}`"
        >
          <!-- DNF-style liquid health fill -->
          <div
            v-if="health != null"
            class="health-liquid"
            :class="healthLiquidClass"
            :style="{ height: `${normalizedHealth ?? 0}%` }"
          />
          <!-- Role icon on top -->
          <img
            v-if="isRoleIconImage"
            class="player-avatar-image"
            :src="roleIcon.icon"
            :alt="roleIcon.label"
            loading="lazy"
            decoding="async"
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

    </div>

    <div class="player-steam-profile">
      <div class="player-time-tags" aria-label="玩家服务器时长">
        <span class="player-time-tag player-time-tag--server">游玩时长 {{ serverPlaytimeText }}</span>
        <span class="player-time-tag player-time-tag--warmup">暖服时长 {{ warmupPlaytimeText }}</span>
      </div>
      <a
        v-if="avatarUrl"
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
          width="48"
          height="48"
          loading="lazy"
          decoding="async"
          fetchpriority="low"
        />
      </a>
      <div v-else class="player-steam-bg player-steam-bg--empty" aria-hidden="true">?</div>
    </div>
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
  serverPlaytimeSeconds?: number | null;
  warmupPlaytimeSeconds?: number | null;
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
const serverPlaytimeText = computed(() => formatTrackedDuration(props.serverPlaytimeSeconds));
const warmupPlaytimeText = computed(() => formatTrackedDuration(props.warmupPlaytimeSeconds));
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

  // Do not expose the player's Steam64 identifier in the compact list.
  return "";
});

const scoreboardItems = computed(() => buildCombatScoreboardItems(props.combatStats, true, bzssCorePing.value));
const normalizedHealth = computed(() => {
  if (props.health == null || !Number.isFinite(Number(props.health))) return null;
  return Math.max(0, Math.min(100, Number(props.health)));
});

const healthLiquidClass = computed(() => {
  const hp = normalizedHealth.value;
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

function formatTrackedDuration(secondsValue?: number | null) {
  const seconds = Number(secondsValue);
  if (!Number.isFinite(seconds) || seconds < 0) return "--";

  const totalMinutes = Math.floor(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}分钟`;

  const hours = seconds / 3600;
  if (hours < 100) return `${hours.toFixed(1)}小时`;
  return `${Math.floor(hours)}小时`;
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

/* ─── 玩家网格视觉重构：身份、状态、战绩分层 ─────────────────────────────── */
.squad-player-row.player-row {
  position: relative;
  display: grid !important;
  grid-template-columns: 48px minmax(0, 1fr) !important;
  gap: 10px;
  min-height: 76px !important;
  padding: 9px 11px 9px 9px !important;
  border: 1px solid rgba(148, 163, 184, 0.32) !important;
  border-left: 4px solid var(--player-accent, #37c8ff) !important;
  border-radius: 12px !important;
  background: linear-gradient(135deg, rgba(28, 42, 68, .94), rgba(8, 13, 24, .96)) !important;
  box-shadow: 0 5px 16px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.035);
  overflow: hidden;
  isolation: isolate;
  transition: transform .18s ease, border-color .18s ease, background .18s ease, box-shadow .18s ease;
}

.squad-player-row.player-row::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: radial-gradient(circle at 0% 50%, color-mix(in srgb, var(--player-accent, #94a3b8) 15%, transparent), transparent 42%);
  opacity: .8;
}

.squad-player-row.player-row::after {
  content: "";
  position: absolute;
  top: 0;
  right: 0;
  width: 34%;
  height: 100%;
  z-index: -1;
  pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.035));
  mask-image: linear-gradient(90deg, transparent, #000);
}

.squad-player-row.player-row:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--player-accent, #94a3b8) 68%, white 12%);
  background:
    linear-gradient(105deg, color-mix(in srgb, var(--player-accent, #94a3b8) 13%, transparent), transparent 44%),
    rgba(11, 18, 32, .94);
  box-shadow: 0 9px 24px rgba(0,0,0,.28), 0 0 18px color-mix(in srgb, var(--player-accent, #94a3b8) 12%, transparent);
}

.squad-player-row.player-row.selected {
  border-color: color-mix(in srgb, var(--player-accent, #94a3b8) 78%, white 18%);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--player-accent, #94a3b8) 28%, transparent), 0 10px 26px rgba(0,0,0,.3);
}

.team1-context,
.team1-context.squad-player-row {
  --player-accent: var(--color-team1-primary, #37c8ff);
}

.team2-context,
.team2-context.squad-player-row {
  --player-accent: var(--color-team2-primary, #ff9b45);
}

.squad-player-row .player-side {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
}

.squad-player-row .player-avatar {
  width: 44px;
  height: 44px;
  border: 1px solid color-mix(in srgb, var(--player-accent, #94a3b8) 58%, white 8%);
  border-radius: 13px;
  background: rgba(2, 6, 23, .78);
  box-shadow:
    0 0 0 3px rgba(2,6,23,.5),
    0 0 15px color-mix(in srgb, var(--player-accent, #94a3b8) 22%, transparent),
    inset 0 1px 0 rgba(255,255,255,.14);
  overflow: visible;
}

.squad-player-row .player-avatar::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background: linear-gradient(135deg, rgba(255,255,255,.22), transparent 35%, rgba(0,0,0,.22));
  mix-blend-mode: screen;
  opacity: .45;
}

.squad-player-row .player-main {
  display: grid;
  gap: 4px;
  min-width: 0;
  align-content: center;
}

.squad-player-row .player-title-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  line-height: 1.1;
}

.squad-player-row .player-name {
  max-width: min(42%, 260px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #f8fafc;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  font-size: 13px;
  font-weight: 850;
  letter-spacing: .01em;
  text-shadow: 0 1px 8px rgba(0,0,0,.45);
}

.squad-player-row .player-sub-line {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(148,163,184,.72);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 9px;
  letter-spacing: .035em;
}

.squad-player-row .role-chip,
.squad-player-row .playtime-chip,
.squad-player-row .bzss-core-ft-badge {
  flex: 0 0 auto;
  min-height: 18px;
  padding: 0 7px;
  border-radius: 999px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 9px;
  font-weight: 800;
  line-height: 18px;
  letter-spacing: .02em;
}

.squad-player-row .role-chip {
  color: #cbd5e1;
  border: 1px solid rgba(148,163,184,.24);
  background: rgba(148,163,184,.08);
}

.squad-player-row .role-chip.leader {
  color: #fde68a;
  border-color: rgba(250,204,21,.38);
  background: rgba(250,204,21,.12);
  box-shadow: 0 0 10px rgba(250,204,21,.1);
}

.squad-player-row .playtime-chip {
  color: #a7f3d0;
  border: 1px solid rgba(52,211,153,.25);
  background: rgba(52,211,153,.08);
}

.squad-player-row .scoreboard-line,
.squad-player-row .legacy-combat-line {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.squad-player-row .scoreboard-chip,
.squad-player-row .stat-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  min-height: 17px;
  padding: 1px 6px;
  border: 1px solid rgba(148,163,184,.14);
  border-radius: 5px;
  background: rgba(255,255,255,.035);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  line-height: 1.25;
}

.squad-player-row .scoreboard-chip .label,
.squad-player-row .stat-chip .label {
  color: rgba(148,163,184,.72);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: .04em;
}

.squad-player-row .scoreboard-chip .value,
.squad-player-row .stat-chip .value {
  color: #e2e8f0;
  font-size: 10px;
  font-weight: 850;
  font-variant-numeric: tabular-nums;
}

.squad-player-row .scoreboard-chip.kill,
.squad-player-row .stat-chip.kill { border-color: rgba(248,113,113,.24); }
.squad-player-row .scoreboard-chip.kill .value,
.squad-player-row .stat-chip.kill .value { color: #fda4af; }
.squad-player-row .scoreboard-chip.wound,
.squad-player-row .stat-chip.wound { border-color: rgba(96,165,250,.24); }
.squad-player-row .scoreboard-chip.wound .value,
.squad-player-row .stat-chip.wound .value { color: #93c5fd; }
.squad-player-row .scoreboard-chip.revive,
.squad-player-row .stat-chip.revive { border-color: rgba(52,211,153,.24); }
.squad-player-row .scoreboard-chip.revive .value,
.squad-player-row .stat-chip.revive .value { color: #6ee7b7; }
.squad-player-row .scoreboard-chip.tk,
.squad-player-row .stat-chip.tk { border-color: rgba(251,191,36,.26); }
.squad-player-row .scoreboard-chip.tk .value,
.squad-player-row .stat-chip.tk .value { color: #fcd34d; }

@media (max-width: 720px) {
  .squad-player-row.player-row {
    grid-template-columns: 42px minmax(0, 1fr);
    gap: 8px;
    padding: 8px;
  }

  .squad-player-row .player-avatar {
    width: 38px;
    height: 38px;
    border-radius: 11px;
  }

  .squad-player-row .player-name {
    max-width: 48%;
    font-size: 12px;
  }

  .squad-player-row .scoreboard-chip,
  .squad-player-row .stat-chip {
    padding-inline: 5px;
  }
}


/* Compact player tile: one identity row plus one scoreboard row. */
.squad-player-row.player-row {
  grid-template-columns: 40px minmax(0, 1fr) !important;
  gap: 7px !important;
  min-height: 56px !important;
  padding: 5px 8px 5px 6px !important;
  border-radius: 9px !important;
}

.squad-player-row .player-avatar {
  width: 36px !important;
  height: 36px !important;
  border-radius: 10px !important;
}

.squad-player-row .player-main {
  gap: 2px !important;
}

.squad-player-row .player-title-line {
  gap: 4px !important;
  min-height: 17px !important;
}

.squad-player-row .player-name {
  font-size: 12px !important;
}

.squad-player-row .role-chip,
.squad-player-row .playtime-chip,
.squad-player-row .bzss-core-ft-badge {
  min-height: 15px !important;
  padding-inline: 5px !important;
  font-size: 8px !important;
  line-height: 15px !important;
}

.squad-player-row .player-sub-line {
  display: none !important;
}

.squad-player-row .scoreboard-line {
  flex-wrap: nowrap !important;
  gap: 3px !important;
  overflow: hidden !important;
}

.squad-player-row .scoreboard-chip {
  min-height: 15px !important;
  padding: 0 4px !important;
  gap: 2px !important;
  border-radius: 4px !important;
  line-height: 1 !important;
}

.squad-player-row .scoreboard-chip .label {
  font-size: 8px !important;
}

.squad-player-row .scoreboard-chip .value {
  font-size: 9px !important;
}

.squad-player-row .player-avatar-ping-badge {
  right: -4px !important;
  bottom: -4px !important;
  min-width: 28px !important;
  padding: 1px 3px !important;
  font-size: 8px !important;
}

@media (max-width: 720px) {
  .squad-player-row.player-row {
    grid-template-columns: 36px minmax(0, 1fr) !important;
    min-height: 52px !important;
    padding: 4px 6px !important;
  }

  .squad-player-row .player-avatar {
    width: 32px !important;
    height: 32px !important;
  }
}



/* Balanced density + theme-safe surfaces. */
.squad-player-row.player-row {
  grid-template-columns: 44px minmax(0, 1fr) !important;
  gap: 9px !important;
  min-height: 64px !important;
  padding: 7px 10px 7px 8px !important;
  border: 1px solid var(--color-border-default) !important;
  border-left: 3px solid var(--player-accent, var(--color-brand-primary)) !important;
  border-radius: 11px !important;
  background:
    linear-gradient(
      115deg,
      color-mix(in srgb, var(--player-accent, var(--color-brand-primary)) 10%, transparent),
      transparent 42%
    ),
    var(--color-bg-card, var(--color-bg-panel)) !important;
  box-shadow:
    0 4px 12px color-mix(in srgb, var(--color-bg-page) 28%, transparent),
    inset 0 1px 0 color-mix(in srgb, var(--color-text-primary) 7%, transparent) !important;
}

.squad-player-row.player-row:hover {
  background:
    linear-gradient(
      115deg,
      color-mix(in srgb, var(--player-accent, var(--color-brand-primary)) 16%, transparent),
      transparent 48%
    ),
    var(--color-bg-elevated, var(--color-bg-card)) !important;
  border-color: color-mix(in srgb, var(--player-accent, var(--color-brand-primary)) 52%, var(--color-border-default)) !important;
  box-shadow:
    0 7px 18px color-mix(in srgb, var(--color-bg-page) 34%, transparent),
    0 0 14px color-mix(in srgb, var(--player-accent, var(--color-brand-primary)) 10%, transparent) !important;
}

.squad-player-row.player-row.selected {
  border-color: color-mix(in srgb, var(--player-accent, var(--color-brand-primary)) 68%, var(--color-border-default)) !important;
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--player-accent, var(--color-brand-primary)) 24%, transparent),
    0 7px 18px color-mix(in srgb, var(--color-bg-page) 30%, transparent) !important;
}

.squad-player-row .player-avatar {
  width: 40px !important;
  height: 40px !important;
  border: 1px solid color-mix(in srgb, var(--player-accent, var(--color-brand-primary)) 52%, var(--color-border-default)) !important;
  border-radius: 12px !important;
  background: var(--color-bg-page, var(--color-bg-panel)) !important;
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--color-bg-page) 55%, transparent),
    0 0 12px color-mix(in srgb, var(--player-accent, var(--color-brand-primary)) 18%, transparent),
    inset 0 1px 0 color-mix(in srgb, var(--color-text-primary) 12%, transparent) !important;
}

.squad-player-row .player-main {
  gap: 3px !important;
}

.squad-player-row .player-title-line {
  gap: 5px !important;
  min-height: 17px !important;
}

.squad-player-row .player-name {
  color: var(--color-text-primary) !important;
  font-size: 12px !important;
  text-shadow: none !important;
}

.squad-player-row .player-sub-line {
  display: block !important;
  color: var(--color-text-muted) !important;
  font-size: 9px !important;
  opacity: .82;
}

.squad-player-row .role-chip,
.squad-player-row .playtime-chip,
.squad-player-row .bzss-core-ft-badge {
  min-height: 16px !important;
  padding-inline: 6px !important;
  color: var(--color-text-secondary) !important;
  border-color: var(--color-border-soft) !important;
  background: color-mix(in srgb, var(--color-bg-elevated) 72%, transparent) !important;
  font-size: 8px !important;
  line-height: 16px !important;
}

.squad-player-row .role-chip.leader {
  color: var(--color-status-warning, var(--color-text-primary)) !important;
  border-color: color-mix(in srgb, var(--color-status-warning) 38%, var(--color-border-default)) !important;
  background: color-mix(in srgb, var(--color-status-warning) 12%, transparent) !important;
  box-shadow: none !important;
}

.squad-player-row .scoreboard-line {
  flex-wrap: nowrap !important;
  gap: 4px !important;
  overflow: hidden !important;
}

.squad-player-row .scoreboard-chip {
  min-height: 16px !important;
  padding: 1px 5px !important;
  gap: 3px !important;
  border-color: var(--color-border-soft) !important;
  border-radius: 5px !important;
  background: color-mix(in srgb, var(--color-bg-elevated) 70%, transparent) !important;
}

.squad-player-row .scoreboard-chip .label {
  color: var(--color-text-muted) !important;
  font-size: 8px !important;
}

.squad-player-row .scoreboard-chip .value {
  color: var(--color-text-primary) !important;
  font-size: 10px !important;
}

.squad-player-row .scoreboard-chip.kills,
.squad-player-row .scoreboard-chip.deaths {
  border-color: color-mix(in srgb, var(--color-status-error) 32%, var(--color-border-soft)) !important;
}

.squad-player-row .scoreboard-chip.kills .value,
.squad-player-row .scoreboard-chip.deaths .value {
  color: var(--color-status-error, var(--color-text-primary)) !important;
}

.squad-player-row .scoreboard-chip.woundeds,
.squad-player-row .scoreboard-chip.revived {
  border-color: color-mix(in srgb, var(--color-status-online) 30%, var(--color-border-soft)) !important;
}

.squad-player-row .scoreboard-chip.woundeds .value,
.squad-player-row .scoreboard-chip.revived .value {
  color: var(--color-status-online, var(--color-text-primary)) !important;
}

.squad-player-row .scoreboard-chip.tk {
  border-color: color-mix(in srgb, var(--color-status-warning) 34%, var(--color-border-soft)) !important;
}

.squad-player-row .scoreboard-chip.tk .value {
  color: var(--color-status-warning, var(--color-text-primary)) !important;
}

@media (max-width: 720px) {
  .squad-player-row.player-row {
    grid-template-columns: 40px minmax(0, 1fr) !important;
    min-height: 60px !important;
    padding: 6px 8px !important;
  }

  .squad-player-row .player-avatar {
    width: 36px !important;
    height: 36px !important;
  }

  .squad-player-row .player-sub-line {
    font-size: 8px !important;
  }
}



/* Semantic status colors also follow the active theme. */
.squad-player-row .health-liquid.hp-high {
  background: linear-gradient(
    0deg,
    color-mix(in srgb, var(--color-status-online) 58%, transparent),
    color-mix(in srgb, var(--color-status-online) 18%, transparent)
  ) !important;
  box-shadow: 0 -2px 8px color-mix(in srgb, var(--color-status-online) 26%, transparent) inset !important;
}

.squad-player-row .health-liquid.hp-mid {
  background: linear-gradient(
    0deg,
    color-mix(in srgb, var(--color-status-warning) 58%, transparent),
    color-mix(in srgb, var(--color-status-warning) 18%, transparent)
  ) !important;
  box-shadow: 0 -2px 8px color-mix(in srgb, var(--color-status-warning) 26%, transparent) inset !important;
}

.squad-player-row .health-liquid.hp-low {
  background: linear-gradient(
    0deg,
    color-mix(in srgb, var(--color-status-error) 64%, transparent),
    color-mix(in srgb, var(--color-status-error) 22%, transparent)
  ) !important;
  box-shadow: 0 -2px 10px color-mix(in srgb, var(--color-status-error) 30%, transparent) inset !important;
}

.squad-player-row .player-avatar-ping-badge.low {
  color: var(--color-text-primary) !important;
  background: color-mix(in srgb, var(--color-status-online) 78%, var(--color-bg-elevated)) !important;
  border-color: color-mix(in srgb, var(--color-status-online) 42%, var(--color-border-default)) !important;
}

.squad-player-row .player-avatar-ping-badge.medium {
  color: var(--color-text-primary) !important;
  background: color-mix(in srgb, var(--color-status-warning) 78%, var(--color-bg-elevated)) !important;
  border-color: color-mix(in srgb, var(--color-status-warning) 42%, var(--color-border-default)) !important;
}

.squad-player-row .player-avatar-ping-badge.high {
  color: var(--color-text-primary) !important;
  background: color-mix(in srgb, var(--color-status-error) 78%, var(--color-bg-elevated)) !important;
  border-color: color-mix(in srgb, var(--color-status-error) 42%, var(--color-border-default)) !important;
}

.squad-player-row .player-avatar::after {
  mix-blend-mode: normal !important;
  opacity: .16 !important;
}



/* Final presentation pass: clearer identity / status / score hierarchy. */
.squad-player-row.player-row {
  grid-template-columns: 46px minmax(0, 1fr) !important;
  min-height: 72px !important;
  padding: 8px 11px 8px 9px !important;
  gap: 10px !important;
  border-radius: 13px !important;
  background:
    linear-gradient(
      100deg,
      color-mix(in srgb, var(--player-accent, var(--color-brand-primary)) 11%, transparent),
      transparent 38%
    ),
    var(--color-bg-card, var(--color-bg-panel)) !important;
}

.squad-player-row.player-row::before {
  background:
    radial-gradient(
      circle at 0% 50%,
      color-mix(in srgb, var(--player-accent, var(--color-brand-primary)) 18%, transparent),
      transparent 52%
    ) !important;
  opacity: .9 !important;
}

.squad-player-row.player-row::after {
  width: 48% !important;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--color-text-primary) 5%, transparent)
  ) !important;
  opacity: .7 !important;
}

.squad-player-row .player-avatar {
  width: 42px !important;
  height: 42px !important;
  border-radius: 13px !important;
}

.squad-player-row .player-main {
  gap: 4px !important;
  align-content: center !important;
}

.squad-player-row .player-title-line {
  gap: 6px !important;
  min-height: 18px !important;
}

.squad-player-row .player-name {
  font-size: 13px !important;
  font-weight: 800 !important;
  letter-spacing: 0 !important;
}

.squad-player-row .player-sub-line {
  font-size: 9px !important;
  letter-spacing: .02em !important;
  opacity: .72 !important;
}

.squad-player-row .role-chip,
.squad-player-row .playtime-chip,
.squad-player-row .bzss-core-ft-badge {
  min-height: 17px !important;
  padding-inline: 7px !important;
  border-radius: 6px !important;
  font-size: 9px !important;
  line-height: 17px !important;
}

.squad-player-row .scoreboard-line {
  gap: 5px !important;
  overflow: visible !important;
}

.squad-player-row .scoreboard-chip {
  position: relative;
  min-height: 19px !important;
  padding: 2px 6px !important;
  gap: 4px !important;
  border-radius: 6px !important;
  background: color-mix(in srgb, var(--color-bg-elevated) 78%, transparent) !important;
  transition: transform .15s ease, border-color .15s ease, background-color .15s ease !important;
}

.squad-player-row .scoreboard-chip:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--player-accent, var(--color-brand-primary)) 12%, var(--color-bg-elevated)) !important;
}

.squad-player-row .scoreboard-chip .label {
  font-size: 8px !important;
  font-weight: 800 !important;
  text-transform: uppercase;
  letter-spacing: .06em !important;
}

.squad-player-row .scoreboard-chip .value {
  font-size: 10px !important;
  font-weight: 850 !important;
}

.squad-player-row .scoreboard-chip.kills {
  border-color: color-mix(in srgb, var(--color-status-online) 38%, var(--color-border-soft)) !important;
}

.squad-player-row .scoreboard-chip.deaths {
  border-color: color-mix(in srgb, var(--color-status-error) 38%, var(--color-border-soft)) !important;
}

.squad-player-row .scoreboard-chip.woundeds {
  border-color: color-mix(in srgb, var(--color-status-warning) 38%, var(--color-border-soft)) !important;
}

.squad-player-row .scoreboard-chip.tk {
  border-color: color-mix(in srgb, var(--color-status-error) 46%, var(--color-border-soft)) !important;
}

.squad-player-row .scoreboard-chip.revived {
  border-color: color-mix(in srgb, var(--player-accent, var(--color-brand-primary)) 40%, var(--color-border-soft)) !important;
}

.squad-player-row .player-steam-bg {
  width: 110px !important;
  opacity: .18 !important;
  -webkit-mask-image: linear-gradient(110deg, transparent 0%, rgba(0,0,0,.08) 28%, rgba(0,0,0,.85) 100%) !important;
  mask-image: linear-gradient(110deg, transparent 0%, rgba(0,0,0,.08) 28%, rgba(0,0,0,.85) 100%) !important;
}

.squad-player-row .player-steam-bg-img {
  filter: saturate(.65) contrast(.92) brightness(.9) !important;
}

.squad-player-row:hover .player-steam-bg {
  width: 124px !important;
  opacity: .32 !important;
}

.squad-player-row:hover .player-steam-bg-img {
  filter: saturate(.85) contrast(1) brightness(1) !important;
}

@media (max-width: 720px) {
  .squad-player-row.player-row {
    grid-template-columns: 40px minmax(0, 1fr) !important;
    min-height: 66px !important;
    padding: 7px 8px !important;
    gap: 8px !important;
  }

  .squad-player-row .player-avatar {
    width: 36px !important;
    height: 36px !important;
  }

  .squad-player-row .scoreboard-line {
    gap: 3px !important;
  }

  .squad-player-row .scoreboard-chip {
    padding-inline: 5px !important;
  }
}



/* Match-performance view: remove the left glow and emphasize the right Steam avatar. */
.squad-player-row.player-row::before {
  display: none !important;
  background: none !important;
  opacity: 0 !important;
}

.squad-player-row.player-row::after {
  background: linear-gradient(
    90deg,
    transparent 48%,
    color-mix(in srgb, var(--color-text-primary) 5%, transparent)
  ) !important;
  opacity: .45 !important;
}

.squad-player-row .player-steam-bg {
  width: 148px !important;
  opacity: .42 !important;
  -webkit-mask-image: linear-gradient(108deg, transparent 0%, rgba(0,0,0,.22) 26%, rgba(0,0,0,.92) 78%, #000 100%) !important;
  mask-image: linear-gradient(108deg, transparent 0%, rgba(0,0,0,.22) 26%, rgba(0,0,0,.92) 78%, #000 100%) !important;
}

.squad-player-row .player-steam-bg-img {
  filter: saturate(.9) contrast(1.02) brightness(.98) !important;
}

.squad-player-row:hover .player-steam-bg {
  width: 164px !important;
  opacity: .58 !important;
}

.squad-player-row:hover .player-steam-bg-img {
  filter: saturate(1.08) contrast(1.04) brightness(1.04) !important;
}

.squad-player-row.player-row {
  min-height: 84px !important;
  padding-block: 9px !important;
}

.squad-player-row .player-main {
  gap: 4px !important;
}

.squad-player-row .scoreboard-line {
  flex-wrap: wrap !important;
  row-gap: 4px !important;
  column-gap: 5px !important;
  max-height: 39px;
  overflow: hidden !important;
  padding-right: 6px;
}

.squad-player-row .scoreboard-chip {
  min-height: 18px !important;
  padding: 2px 6px !important;
  border-radius: 6px !important;
}

.squad-player-row .scoreboard-chip .label {
  font-size: 8px !important;
}

.squad-player-row .scoreboard-chip .value {
  font-size: 10px !important;
}

@media (max-width: 720px) {
  .squad-player-row.player-row {
    min-height: 78px !important;
    padding-block: 7px !important;
  }

  .squad-player-row .player-steam-bg {
    width: 116px !important;
    opacity: .34 !important;
  }

  .squad-player-row:hover .player-steam-bg {
    width: 128px !important;
    opacity: .48 !important;
  }

  .squad-player-row .scoreboard-line {
    column-gap: 3px !important;
  }

  .squad-player-row .scoreboard-chip {
    padding-inline: 5px !important;
  }
}



/* Player role avatar stays square across desktop and mobile. */
.squad-player-row .player-avatar {
  border-radius: 2px !important;
}

.squad-player-row .player-avatar::after,
.squad-player-row .player-avatar .health-liquid {
  border-radius: 0 !important;
}

@media (max-width: 720px) {
  .squad-player-row .player-avatar {
    border-radius: 2px !important;
  }
}


/* Steam profile avatar: compact square thumbnail with the full image visible. */
.squad-player-row.has-steam-avatar .player-main {
  padding-right: 48px !important;
}

.squad-player-row .player-steam-bg {
  position: absolute !important;
  top: 50% !important;
  right: 9px !important;
  bottom: auto !important;
  width: 34px !important;
  height: 34px !important;
  z-index: 2 !important;
  display: grid !important;
  place-items: center !important;
  overflow: hidden !important;
  border: 1px solid var(--color-border-default) !important;
  border-radius: 2px !important;
  background: var(--color-bg-elevated, var(--color-bg-card)) !important;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--color-bg-page) 36%, transparent) !important;
  opacity: 1 !important;
  transform: translateY(-50%) !important;
  -webkit-mask-image: none !important;
  mask-image: none !important;
}

.squad-player-row .player-steam-bg-img {
  width: 100% !important;
  height: 100% !important;
  object-fit: contain !important;
  object-position: center !important;
  filter: none !important;
}

.squad-player-row:hover .player-steam-bg {
  width: 34px !important;
  opacity: 1 !important;
  transform: translateY(-50%) scale(1.04) !important;
}

.squad-player-row:hover .player-steam-bg-img {
  filter: none !important;
}

@media (max-width: 720px) {
  .squad-player-row.has-steam-avatar .player-main {
    padding-right: 42px !important;
  }

  .squad-player-row .player-steam-bg {
    right: 7px !important;
    width: 30px !important;
    height: 30px !important;
  }

  .squad-player-row:hover .player-steam-bg {
    width: 30px !important;
  }
}


/* Enlarged role avatar: nearly fills the player tile while staying square. */
.squad-player-row.player-row {
  grid-template-columns: 66px minmax(0, 1fr) !important;
}

.squad-player-row .player-avatar {
  width: 62px !important;
  height: 62px !important;
  border-radius: 2px !important;
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--player-accent, var(--color-brand-primary)) 58%, transparent),
    0 0 10px color-mix(in srgb, var(--player-accent, var(--color-brand-primary)) 34%, transparent),
    0 0 22px color-mix(in srgb, var(--player-accent, var(--color-brand-primary)) 18%, transparent),
    inset 0 1px 0 color-mix(in srgb, var(--color-text-primary) 12%, transparent) !important;
}

.squad-player-row .player-avatar-image {
  filter:
    drop-shadow(0 0 4px color-mix(in srgb, var(--player-accent, var(--color-brand-primary)) 72%, transparent))
    drop-shadow(0 0 9px color-mix(in srgb, var(--player-accent, var(--color-brand-primary)) 34%, transparent)) !important;
}

.squad-player-row .player-avatar-text {
  text-shadow:
    0 0 5px color-mix(in srgb, var(--player-accent, var(--color-brand-primary)) 78%, transparent),
    0 0 12px color-mix(in srgb, var(--player-accent, var(--color-brand-primary)) 38%, transparent) !important;
}

@media (max-width: 720px) {
  .squad-player-row.player-row {
    grid-template-columns: 62px minmax(0, 1fr) !important;
  }

  .squad-player-row .player-avatar {
    width: 58px !important;
    height: 58px !important;
  }
}


/* Full-server performance guard: keep the rich layout without forcing every
   off-screen player tile through paint and GPU compositing. */
.squad-player-row.player-row {
  contain: layout paint style !important;
  content-visibility: auto;
  contain-intrinsic-size: 84px;
  box-shadow: none !important;
  transition: border-color .15s ease, background-color .15s ease !important;
}

.squad-player-row .health-liquid {
  animation: none !important;
  transition: height .2s linear, background-color .2s ease !important;
}

.squad-player-row .player-avatar,
.squad-player-row .player-steam-bg {
  box-shadow: none !important;
}

.squad-player-row .player-avatar-image,
.squad-player-row .player-steam-bg-img {
  filter: none !important;
}

.squad-player-row .player-avatar-text {
  text-shadow: none !important;
}

.squad-player-row .scoreboard-chip {
  transition: none !important;
}


/* Player time summary: two compact labels above a larger Steam avatar. */
.squad-player-row.player-row {
  min-height: 108px !important;
  contain-intrinsic-size: 108px !important;
}

.squad-player-row .player-main,
.squad-player-row.has-steam-avatar .player-main {
  padding-right: 126px !important;
}

.squad-player-row .player-steam-profile {
  position: absolute;
  top: 7px;
  right: 9px;
  z-index: 3;
  width: 116px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
  pointer-events: none;
}

.squad-player-row .player-time-tags {
  width: 100%;
  display: grid;
  gap: 3px;
}

.squad-player-row .player-time-tag {
  display: block;
  min-width: 0;
  padding: 2px 6px;
  overflow: hidden;
  border: 1px solid var(--color-border-soft);
  border-radius: 5px;
  color: var(--color-text-secondary);
  background: color-mix(in srgb, var(--color-bg-elevated) 92%, transparent);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 9px;
  font-weight: 750;
  line-height: 15px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.squad-player-row .player-time-tag--server {
  border-color: color-mix(in srgb, var(--color-brand-primary) 38%, var(--color-border-soft));
}

.squad-player-row .player-time-tag--warmup {
  border-color: color-mix(in srgb, var(--color-status-warning) 38%, var(--color-border-soft));
}

.squad-player-row .player-steam-profile .player-steam-bg {
  position: relative !important;
  top: auto !important;
  right: auto !important;
  bottom: auto !important;
  width: 48px !important;
  height: 48px !important;
  transform: none !important;
  pointer-events: auto;
}

.squad-player-row .player-steam-profile .player-steam-bg--empty {
  display: grid !important;
  place-items: center;
  color: var(--color-text-muted);
  font-size: 16px;
  font-weight: 800;
  pointer-events: none;
}

.squad-player-row:hover .player-steam-profile .player-steam-bg {
  width: 48px !important;
  transform: scale(1.04) !important;
}

@media (max-width: 720px) {
  .squad-player-row.player-row {
    min-height: 100px !important;
    contain-intrinsic-size: 100px !important;
  }

  .squad-player-row .player-main,
  .squad-player-row.has-steam-avatar .player-main {
    padding-right: 103px !important;
  }

  .squad-player-row .player-steam-profile {
    top: 6px;
    right: 7px;
    width: 94px;
    gap: 4px;
  }

  .squad-player-row .player-time-tag {
    padding-inline: 4px;
    font-size: 8px;
    line-height: 14px;
  }

  .squad-player-row .player-steam-profile .player-steam-bg,
  .squad-player-row:hover .player-steam-profile .player-steam-bg {
    width: 42px !important;
    height: 42px !important;
  }
}

</style>
