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
          :title="displayRole(player.role)"
        >
          <img
            v-if="isRoleIconImage"
            class="player-avatar-image"
            :src="roleIcon.icon"
            :alt="roleIcon.label"
          />
          <span v-else class="player-avatar-text" aria-hidden="true">{{ roleIcon.icon }}</span>
        </div>
      </div>
      <div class="playtime-chip" :title="playtimeTitle">
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
          {{ player.isLeader ? "队长" : "成员" }}
        </span>
      </div>

      <div v-if="secondaryIdentityText" class="player-sub-line" :title="secondaryIdentityText">
        {{ secondaryIdentityText }}
      </div>

      <div class="player-stat-line">
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
import { resolveRoleIcon } from "../../utils/role-icons";
import { t } from "../../i18n";

const props = defineProps<{
  player: PlayerRowViewModel;
  playtimeHours: number | null;
  combatStats: CombatStats;
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

const kills = computed(() => normalizeStat(props.combatStats?.kills));
const downs = computed(() => normalizeStat(props.combatStats?.downs));
const deaths = computed(() => normalizeStat(props.combatStats?.deaths));
const tk = computed(() => normalizeStat(props.combatStats?.tk));
const revives = computed(() => normalizeStat(props.combatStats?.revives));

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
