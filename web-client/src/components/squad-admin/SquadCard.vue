<template>
  <article
    class="squad-card"
    :class="[teamColorClass, { selected: hasSelectedPlayer, 'restriction-violation': squad.restrictionViolation }]"
  >
    <header class="squad-header" @click.stop="$emit('select-squad', squad)">
      <div class="squad-header-main">
        <!-- 标题行：ID + 名称 + 徽章 + 人数 + 锁定状态 -->
        <div class="squad-title-row">
          <span v-if="squad.squadId != null" class="squad-id-badge">#{{ squad.squadId }}</span>
          <strong class="squad-name">{{ squad.squadName }}</strong>
          <span class="squad-badges-group">
            <StatusBadge class="squad-nature-badge" :tone="natureTone(squad.squadNature)">
              {{ squad.squadNatureLabel }}
            </StatusBadge>
            <StatusBadge class="squad-type-badge" :tone="vehicleTone(squad.squadVehicleClass)">
              {{ squad.squadTypeLabel || squad.squadVehicleClassLabel || "其他" }}
            </StatusBadge>
          </span>
          <span class="squad-member-count">{{ squad.memberCount }}/{{ squad.maxMembers }}</span>
          <StatusBadge v-if="squad.restrictionViolation" class="squad-status-badge" tone="error">
            违规
          </StatusBadge>
          <StatusBadge class="squad-status-badge" :tone="squad.isLocked ? 'warn' : 'idle'">
            {{ squad.isLocked ? t("common.locked") : t("common.open") }}
          </StatusBadge>
        </div>

        <!-- 元信息行：均时 + 创建者 + 时间 -->
        <div class="squad-meta-row">
          <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
            <span class="squad-meta-playtime">{{ squadAveragePlaytimeText }}</span>
            <span v-if="squadAveragePingText !== '--'" class="squad-meta-ping" style="font-size: 10px; color: var(--color-text-secondary); white-space: nowrap;">
              · Ping {{ squadAveragePingText }}
            </span>
          </div>
          <span v-if="squad.creatorName || squad.createdAtLabel" class="squad-meta-right">
            <span v-if="squad.creatorName" class="squad-meta-creator">{{ squad.creatorName }}</span>
            <span v-if="squad.createdAtLabel" class="squad-created-time">
              {{ squad.createdDisplayText || squad.createdAtLabel }}
              <em v-if="squad.sourceLabel">·{{ squad.sourceLabel }}</em>
            </span>
          </span>
        </div>
      </div>

      <!-- 警告芯片行 -->
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
          :playtime-hours="getPlayerPlaytime(squad.leader.steamId)"
          :combat-stats="getPlayerCombatStats(squad.leader)"
          :health="getPlayerHealth(squad.leader)"
          :group-report="getGroupReport(squad.leader)"
          :steam-avatar="getPlayerSteamAvatar(squad.leader.steamId)"
          :server-playtime-seconds="getPlayerServerSeconds(squad.leader.steamId)"
          :warmup-playtime-seconds="getPlayerWarmupSeconds(squad.leader.steamId)"
          :loyal-player="isPlayerLoyal(squad.leader.steamId)"
          :newcomer-player="isPlayerNewcomer(squad.leader.steamId)"
          :playtime-known="hasPlaytimeRecord(squad.leader.steamId)"
          :multi-select-mode="multiSelectMode"
          :checked="isPlayerChecked(squad.leader.playerId)"
          @select="handlePlayerSelect"
          @toggle-check="handlePlayerToggleCheck"
        />

        <div v-if="squad.state === 'no_leader'" class="squad-warning">
          {{ t("match.noSquadLeader") }}
        </div>

        <SquadPlayerRow
          v-for="member in squad.members"
          :key="`player-${member.playerId}`"
          :player="member"
          :playtime-hours="getPlayerPlaytime(member.steamId)"
          :combat-stats="getPlayerCombatStats(member)"
          :health="getPlayerHealth(member)"
          :group-report="getGroupReport(member)"
          :steam-avatar="getPlayerSteamAvatar(member.steamId)"
          :server-playtime-seconds="getPlayerServerSeconds(member.steamId)"
          :warmup-playtime-seconds="getPlayerWarmupSeconds(member.steamId)"
          :loyal-player="isPlayerLoyal(member.steamId)"
          :newcomer-player="isPlayerNewcomer(member.steamId)"
          :playtime-known="hasPlaytimeRecord(member.steamId)"
          :multi-select-mode="multiSelectMode"
          :checked="isPlayerChecked(member.playerId)"
          @select="handlePlayerSelect"
          @toggle-check="handlePlayerToggleCheck"
        />
      </div>
    </template>
  </article>
</template>

<script setup lang="ts">
import { computed, inject, ref } from "vue";
import type { PlayerRowViewModel, SquadViewModel, CombatStats } from "../../types/squad-admin.types";
import StatusBadge from "../common/StatusBadge.vue";
import SquadPlayerRow from "./SquadPlayerRow.vue";
import { t } from "../../i18n";
import { extractPlaytimeHours, resolveCombatStats } from "../../utils/squad-admin-adapter";

const props = defineProps<{
  squad: SquadViewModel;
  playtimes: Record<string, any>;
  combatStatsLookup: Record<string, CombatStats>;
  healthLookup?: Record<string, number | null>;
  groupReportMemberships?: Record<string, { id: string; number: number; name: string; color: string }>;
  densityMode?: "comfortable" | "compact";
  multiSelectMode?: boolean;
  selectedPlayerIds?: Set<string | number>;
}>();

const emit = defineEmits<{
  (event: "select-player", payload: { player: PlayerRowViewModel; event: MouseEvent }): void;
  (event: "toggle-player-check", payload: { player: PlayerRowViewModel; event: MouseEvent }): void;
  (event: "select-squad", squad: SquadViewModel): void;
}>();

const selectedPlayerId = inject<any>("selectedPlayerId", ref(null));

const teamColorClass = computed(() => {
  if (props.squad.teamId === 1) return "team1-context";
  if (props.squad.teamId === 2) return "team2-context";
  return "";
});

const hasSelectedPlayer = computed(() => {
  if (selectedPlayerId.value == null) return false;
  if (props.squad.leader && String(props.squad.leader.playerId) === String(selectedPlayerId.value)) return true;
  return props.squad.members.some((member) => String(member.playerId) === String(selectedPlayerId.value));
});

const squadPlayers = computed(() => {
  return [
    ...(props.squad.leader ? [props.squad.leader] : []),
    ...props.squad.members,
  ];
});

const squadPlaytimeSummary = computed(() => {
  const playersList = squadPlayers.value;
  const hoursList = playersList.map(p => extractPlaytimeHours(p.steamId, props.playtimes));

  const known = hoursList.filter((h) => h != null) as number[];
  const publicPlayers = known.filter((h) => h > 0);
  const privatePlayers = known.filter((h) => h === 0);

  const totalHours = publicPlayers.reduce((sum, h) => sum + h, 0);
  const average = publicPlayers.length > 0
    ? Math.round((totalHours / publicPlayers.length) * 10) / 10
    : null;

  return {
    averagePlaytimeHours: average,
    publicPlaytimePlayers: publicPlayers.length,
    privatePlaytimePlayers: privatePlayers.length,
    knownPlaytimePlayers: known.length,
  };
});

const squadAveragePlaytimeText = computed(() => {
  const summary = squadPlaytimeSummary.value;
  if (summary.knownPlaytimePlayers <= 0) return "时长未知";

  const publicText = `公开 ${summary.publicPlaytimePlayers}`;
  const privateText = summary.privatePlaytimePlayers > 0 ? `私密 ${summary.privatePlaytimePlayers}` : "";

  if (summary.averagePlaytimeHours == null) {
    return `Avg -- · ${publicText}${privateText ? ` · ${privateText}` : ""}`;
  }

  return `Avg ${summary.averagePlaytimeHours}h · ${publicText}${privateText ? ` · ${privateText}` : ""}`;
});

const squadAveragePingText = computed(() => {
  const playersList = squadPlayers.value;
  const pings = playersList
    .map(p => p.bzssCorePing ?? p.ping)
    .filter((ping): ping is number => ping != null && Number.isFinite(ping) && ping >= 0);

  if (pings.length === 0) return "--";
  const sum = pings.reduce((acc, val) => acc + val, 0);
  return `${Math.round(sum / pings.length)}ms`;
});

const squadWarnings = computed(() => {
  const items: string[] = [];
  if (props.squad.restrictionViolation) {
    const reason = props.squad.restrictionReasons[0] || "队伍限制违规";
    items.push(`违规：${reason}`);
  }
  if (props.squad.state === "empty") items.push("Empty");
  if (props.squad.state === "no_leader") items.push("No leader");
  if (props.squad.isLocked) items.push("Locked");

  const summary = squadPlaytimeSummary.value;
  if (summary.knownPlaytimePlayers <= 0) items.push("No time data");
  if (summary.averagePlaytimeHours != null && summary.averagePlaytimeHours < 10) items.push("Low avg");
  return items.slice(0, 4);
});

function getPlayerPlaytime(steamId: string | null | undefined): number | null {
  return extractPlaytimeHours(steamId, props.playtimes);
}

function getPlayerSteamAvatar(steamId: string | null | undefined): string | null {
  if (!steamId) return null;
  const playtime = props.playtimes[steamId];
  return playtime?.steam_avatar || playtime?.steamAvatar || null;
}

function getPlayerServerSeconds(steamId: string | null | undefined): number | null {
  return getCachedDurationSeconds(steamId, "serverSeconds", "server_seconds");
}

function getPlayerWarmupSeconds(steamId: string | null | undefined): number | null {
  return getCachedDurationSeconds(steamId, "warmupSeconds", "warmup_seconds");
}

function hasPlaytimeRecord(steamId: string | null | undefined): boolean {
  if (!steamId) return false;
  const record = props.playtimes[steamId];
  return Boolean(record?.playtimeKnown ?? record?.playtime_known);
}

function isPlayerLoyal(steamId: string | null | undefined): boolean {
  if (!steamId) return false;
  const record = props.playtimes[steamId];
  return Boolean(record?.loyalPlayer ?? record?.loyal_player ?? record?.is_loyal_player);
}

function isPlayerNewcomer(steamId: string | null | undefined): boolean {
  if (!steamId) return false;
  const record = props.playtimes[steamId];
  if (!record || !Boolean(record.squadBrowserRefreshed ?? record.squadbrowser_refreshed)) return false;
  const totalMinutes = Number(record.squadBrowserTotalMinutes ?? record.squadbrowser_total_minutes);
  const bzssMinutes = Number(record.squadBrowserBzssMinutes ?? record.squadbrowser_bzss_minutes);
  return Number.isFinite(totalMinutes) && Number.isFinite(bzssMinutes)
    && totalMinutes < 10 * 60
    && bzssMinutes < 10 * 60;
}

function getCachedDurationSeconds(
  steamId: string | null | undefined,
  camelKey: string,
  snakeKey: string,
): number | null {
  if (!steamId) return null;
  const record = props.playtimes[steamId];
  const value = Number(record?.[camelKey] ?? record?.[snakeKey]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function getPlayerCombatStats(player: PlayerRowViewModel): CombatStats {
  return resolveCombatStats(player.raw || player, props.combatStatsLookup);
}

function getPlayerHealth(player: PlayerRowViewModel): number | null {
  if (!props.healthLookup) return null;
  const name = String(player.name ?? "").trim();
  if (!name) return null;
  const hp = props.healthLookup[name];
  return hp != null && Number.isFinite(hp) ? hp : null;
}
function getGroupReport(player: PlayerRowViewModel) { const raw = player.raw && typeof player.raw === "object" ? player.raw as Record<string, any> : {}; const steam = String(player.steamId ?? raw.steamID ?? raw.steamId ?? "").trim().toLowerCase(); const eos = String(player.eosId ?? raw.eosID ?? raw.eosId ?? "").trim().toLowerCase(); return (steam && props.groupReportMemberships?.[`steam:${steam}`]) || (eos && props.groupReportMemberships?.[`eos:${eos}`]) || undefined; }

function warningTone(label: string): "error" | "warn" | "idle" {
  if (label.startsWith("违规：")) return "error";
  if (label === "Locked" || label === "No leader" || label === "Low avg" || label === "No time data") {
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

function isPlayerChecked(playerId: string | number | null) {
  if (playerId == null || !props.selectedPlayerIds) return false;
  return props.selectedPlayerIds.has(playerId)
    || props.selectedPlayerIds.has(String(playerId))
    || props.selectedPlayerIds.has(Number(playerId));
}

function handlePlayerToggleCheck(payload: { player: PlayerRowViewModel; event: MouseEvent }) {
  emit("toggle-player-check", payload);
}
</script>

<style scoped>
/* ─── 卡片主体 ───────────────────────────────────────────────────────────── */
.squad-card {
  flex: 0 0 auto;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.015)), rgba(255, 255, 255, 0.012)),
    var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: var(--shadow-md);
  transition: border-color 0.14s ease, box-shadow 0.14s ease, transform 0.14s ease;
}

.squad-card:hover {
  border-color: var(--color-border-highlight);
  transform: translateY(-1px);
  box-shadow:
    0 16px 40px rgba(0, 0, 0, 0.38),
    0 0 0 1px rgba(96, 165, 250, 0.1) inset;
}

.squad-card.selected {
  border-color: var(--color-status-info);
  box-shadow:
    inset 0 0 0 1px var(--color-status-info),
    0 0 12px rgba(96, 165, 250, 0.12),
    var(--shadow-md);
}

.squad-card.restriction-violation {
  border-color: rgba(248, 113, 113, 0.78);
  box-shadow:
    inset 0 0 0 1px rgba(248, 113, 113, 0.32),
    0 0 18px rgba(239, 68, 68, 0.13);
}

.squad-card.restriction-violation .squad-header {
  background: rgba(127, 29, 29, 0.14) !important;
}

/* 左侧团队色彩条 */
.squad-card.team1-context {
  border-left: 3px solid var(--color-team1-primary);
}

.squad-card.team2-context {
  border-left: 3px solid var(--color-team2-primary);
}

/* ─── 卡片头部 ───────────────────────────────────────────────────────────── */
.squad-header {
  display: grid;
  gap: 3px;
  padding: 6px 9px 7px;
  border-bottom: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.008));
  cursor: pointer;
  transition: background-color 0.14s ease;
}

.squad-header:hover {
  background: rgba(255, 255, 255, 0.06);
}

.squad-header-main {
  display: grid;
  gap: 3px;
  min-width: 0;
}

/* ─── 标题行 ─────────────────────────────────────────────────────────────── */
.squad-title-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex-wrap: wrap;
  line-height: 1;
}

.squad-id-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 17px;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 900;
  color: #fff;
  background-color: var(--color-status-info);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.24);
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.25);
  flex: 0 0 auto;
}

.team1-context .squad-id-badge {
  background-color: var(--color-team1-primary);
  box-shadow: 0 1px 4px rgba(55, 200, 255, 0.35);
}

.team2-context .squad-id-badge {
  background-color: var(--color-team2-primary);
  box-shadow: 0 1px 4px rgba(255, 155, 69, 0.35);
}

.squad-name {
  font-size: 12px;
  font-weight: 800;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.squad-badges-group {
  display: inline-flex;
  gap: 3px;
  flex: 0 0 auto;
}

.squad-nature-badge,
.squad-type-badge {
  min-height: 18px;
  padding-inline: 6px;
  font-size: 10px;
}

.squad-member-count {
  font-size: 10px;
  color: var(--color-text-secondary);
  font-weight: 700;
  padding: 1px 5px;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-soft);
  flex: 0 0 auto;
}

.squad-status-badge {
  min-height: 18px;
  padding-inline: 6px;
  font-size: 10px;
  flex: 0 0 auto;
}

/* ─── 元信息行 ───────────────────────────────────────────────────────────── */
.squad-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  line-height: 1.1;
}

.squad-meta-playtime {
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.squad-meta-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.squad-meta-creator {
  color: var(--color-text-muted);
  font-size: 9px;
  white-space: nowrap;
}

.squad-created-time {
  display: inline-flex;
  gap: 3px;
  align-items: center;
  color: var(--color-text-muted);
  font-size: 9px;
  white-space: nowrap;
}

.squad-created-time em {
  font-style: normal;
  color: var(--color-text-secondary);
}

/* ─── 警告芯片 ───────────────────────────────────────────────────────────── */
.squad-warning-row {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 2px;
}

.squad-warning-chip {
  display: inline-flex;
  align-items: center;
  min-height: 17px;
  padding: 0 6px;
  border-radius: var(--radius-full);
  font-size: 9px;
  font-weight: 600;
  border: 1px solid var(--color-border-soft);
  color: var(--color-text-muted);
  background: rgba(255, 255, 255, 0.02);
}

.squad-warning-chip.tone-warn {
  color: #fde68a;
  border-color: rgba(245, 158, 11, 0.3);
  background: rgba(245, 158, 11, 0.09);
}

.squad-warning-chip.tone-error {
  color: #fecaca;
  border-color: rgba(248, 113, 113, 0.45);
  background: rgba(127, 29, 29, 0.28);
}

/* ─── 空小队 ─────────────────────────────────────────────────────────────── */
.squad-empty {
  padding: 8px 10px 10px;
  text-align: center;
}

.squad-empty-text {
  color: var(--color-text-muted);
  font-size: 10px;
}

/* ─── 无队长警告 ─────────────────────────────────────────────────────────── */
.squad-warning {
  padding: 6px 9px;
  background-color: rgba(245, 158, 11, 0.07);
  border-top: 1px solid var(--color-border-soft);
  color: var(--color-status-warning);
  font-size: 10px;
  border-left: 2px solid rgba(245, 158, 11, 0.6);
}

.squad-card.team1-context {
  --player-accent: var(--color-team1-primary, #37c8ff);
}

.squad-card.team2-context {
  --player-accent: var(--color-team2-primary, #ff9b45);
}

</style>
