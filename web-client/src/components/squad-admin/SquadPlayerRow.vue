<template>
  <div
    class="squad-player-row player-row"
    :class="{ selected: isSelected, 'is-leader': player.isLeader }"
    @click="handleSelect"
  >
    <div class="player-side">
      <div class="player-avatar" :title="displayRole(player.role)">
        <img
          v-if="isRoleIconImage"
          class="player-avatar-image"
          :src="roleIcon.icon"
          :alt="roleIcon.label"
        />
        <span v-else class="player-avatar-text" aria-hidden="true">{{ roleIcon.icon }}</span>
      </div>
      <div class="playtime-chip" :title="playtimeText">
        {{ playtimeText }}
      </div>
    </div>

    <div class="player-main">
      <div class="player-title-line">
        <span class="player-name" :title="displayName">{{ displayName }}</span>
        <span
          class="role-chip"
          :class="{ leader: player.isLeader }"
          :title="player.isLeader ? t('match.squadLeader') : t('match.squadMember')"
        >
          {{ player.isLeader ? t("match.squadLeader") : t("match.squadMember") }}
        </span>
      </div>

      <div class="player-sub-line" :title="secondaryIdentityText">
        {{ secondaryIdentityText }}
      </div>

      <div class="player-stat-line">
        <span class="stat-chip wound">
          <span class="label">击倒</span>
          <span class="value">{{ downs }}</span>
        </span>
        <span class="stat-chip kill">
          <span class="label">击杀</span>
          <span class="value">{{ kills }}</span>
        </span>
        <span class="stat-chip death">
          <span class="label">死亡</span>
          <span class="value">{{ deaths }}</span>
        </span>
        <span class="stat-chip tk">
          <span class="label">TK</span>
          <span class="value">{{ tk }}</span>
        </span>
        <span class="stat-chip revive">
          <span class="label">复苏</span>
          <span class="value">{{ revives }}</span>
        </span>
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

const displayName = computed(() => {
  const raw = String(props.player.name ?? "").trim();
  return raw || "未知玩家";
});

const playtimeText = computed(() => formatPlaytime(props.player.playtimeHours));

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

  return "未知 Steam 名";
});

const kills = computed(() => normalizeStat(props.player.combatStats?.kills));
const downs = computed(() => normalizeStat(props.player.combatStats?.downs));
const deaths = computed(() => normalizeStat(props.player.combatStats?.deaths));
const tk = computed(() => normalizeStat(props.player.combatStats?.tk));
const revives = computed(() => normalizeStat(props.player.combatStats?.revives));

function normalizeStat(value: unknown) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
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
