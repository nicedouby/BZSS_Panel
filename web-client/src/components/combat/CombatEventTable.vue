<template>
  <PageCard compact>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t("common.lastUpdated") }}</th>
            <th>{{ t("combat.eventType") }}</th>
            <th>标记</th>
            <th>{{ t("combat.attacker") }}</th>
            <th>{{ t("combat.victim") }}</th>
            <th>{{ t("combat.damage") }}</th>
            <th>{{ t("combat.weapon") }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(event, index) in events"
            :key="event.id || `${event.time}-${index}`"
            :class="rowClass(event, index)"
            @mouseenter="setHoverPair(event)"
            @mouseleave="clearHoverPair"
          >
            <td>{{ formatTime(event.time) }}</td>
            <td>
              <span class="event-type-pill">{{ eventType(event) }}</span>
            </td>
            <td>
              <div class="flag-row">
                <span v-for="label in eventFlagLabels(event)" :key="label" class="flag-chip">
                  {{ label }}
                </span>
                <span v-if="!eventFlagLabels(event).length" class="flag-empty">-</span>
              </div>
            </td>
            <td>
              <div class="identity-cell">
                <div v-if="attackerMeta(event)" class="identity-meta">
                  <button
                    v-if="attackerIdentity(event)"
                    type="button"
                    class="name-button"
                    :class="{ 'is-highlighted': isClusterHighlighted(event, index) }"
                    @click="emit('search-player', attackerIdentity(event))"
                  >
                    {{ attackerName(event) }}
                  </button>
                  <span v-else>{{ attackerName(event) }}</span>
                  <span v-if="attackerTeamText(event)">{{ attackerTeamText(event) }}</span>
                  <span v-if="attackerSquadText(event)">{{ attackerSquadText(event) }}</span>
                </div>
                <template v-else>
                  <button
                    v-if="attackerIdentity(event)"
                    type="button"
                    class="name-button"
                    :class="{ 'is-highlighted': isClusterHighlighted(event, index) }"
                    @click="emit('search-player', attackerIdentity(event))"
                  >
                    {{ attackerName(event) }}
                  </button>
                  <span v-else>{{ attackerName(event) }}</span>
                </template>
              </div>
            </td>
            <td>
              <div class="identity-cell">
                <div v-if="victimMeta(event)" class="identity-meta">
                  <button
                    type="button"
                    class="name-button"
                    :class="{ 'is-highlighted': isClusterHighlighted(event, index) }"
                    @click="emit('search-player', victimIdentity(event))"
                  >
                    {{ victimName(event) }}
                  </button>
                  <span v-if="victimTeamText(event)">{{ victimTeamText(event) }}</span>
                  <span v-if="victimSquadText(event)">{{ victimSquadText(event) }}</span>
                </div>
                <button
                  v-else
                  type="button"
                  class="name-button"
                  :class="{ 'is-highlighted': isClusterHighlighted(event, index) }"
                  @click="emit('search-player', victimIdentity(event))"
                >
                  {{ victimName(event) }}
                </button>
              </div>
            </td>
            <td>{{ event.damage ?? "-" }}</td>
            <td>
              <span>{{ weaponName(event) }}</span>
              <span v-if="weaponTypeLabel(event)" class="weapon-type-badge" :class="weaponTypeClass(event)">
                {{ weaponTypeLabel(event) }}
              </span>
            </td>
            <td><button type="button" @click="emit('select', event)">{{ t("common.open") }}</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </PageCard>
</template>

<script setup lang="ts">
import { ref } from "vue";
import PageCard from "../common/PageCard.vue";
import { t } from "../../i18n";

const props = defineProps<{
  events: any[];
  highlightKey?: string;
}>();

const emit = defineEmits<{
  (event: "select", value: any): void;
  (event: "search-player", value: string): void;
  (event: "hover-player", value: string): void;
}>();

const hoveredPairKey = ref("");

function eventType(event: any) {
  const type = String(event?.type ?? event?.friendlyFireType ?? event?.eventName ?? "").trim().toLowerCase();
  if (type === "revive") return t("combat.revive", "revive");
  if (type === "tk") return t("combat.teamKill");
  if (type === "friendly") return t("combat.friendly");
  if (type === "teamdamage") return t("combat.teamDamage");
  if (type === "teamwound") return t("combat.teamWound");
  if (type === "teamkill") return t("combat.teamKill");
  return type || "-";
}

function rowClass(event: any, index: number) {
  return [
    "combat-row",
    `combat-row--${eventRowKind(event)}`,
    isRowHighlighted(index) ? "combat-row--highlighted" : "",
    event.isFriendlyFire || event.isTeamKill || event.tk ? "combat-row--friendly" : "",
  ].filter(Boolean);
}

function eventRowKind(event: any) {
  const type = String(event?.type ?? event?.friendlyFireType ?? "").trim().toLowerCase();
  if (type === "revive") return "revive";
  if (type === "kill" || type === "death" || type === "tk") return "kill";
  if (type === "friendly" || type === "teamdamage" || type === "teamwound" || type === "teamkill") return "kill";
  if (type === "wound") return "wound";
  if (type === "damage") return "damage";
  return "unknown";
}

function attackerName(event: any) {
  return event.attacker?.displayName || event.attacker?.name || event.attackerName || "-";
}

function attackerIdentity(event: any) {
  if (event.attacker?.isBot) return "";
  return event.attacker?.name || event.attackerName || event.attacker?.steamID || event.attackerSteamID || event.attacker?.eosID || event.attackerEOSID || "";
}

function attackerMeta(event: any) {
  return formatIdentityMeta(event.attacker, event.attackerTeamID, event.attackerSquadID);
}

function attackerTeamText(event: any) {
  return formatTeamText(event.attacker?.teamID ?? event.attacker?.teamId ?? event.attackerTeamID);
}

function attackerSquadText(event: any) {
  return formatSquadText(event.attacker?.squadID ?? event.attacker?.squadId ?? event.attackerSquadID);
}

function victimName(event: any) {
  return event.victim?.displayName || event.victim?.name || event.victimName || "-";
}

function victimIdentity(event: any) {
  return event.victim?.name || event.victimName || event.victim?.steamID || event.victimSteamID || event.victim?.eosID || event.victimEOSID || "";
}

function victimMeta(event: any) {
  return formatIdentityMeta(event.victim, event.victimTeamID, event.victimSquadID);
}

function victimTeamText(event: any) {
  return formatTeamText(event.victim?.teamID ?? event.victim?.teamId ?? event.victimTeamID);
}

function victimSquadText(event: any) {
  return formatSquadText(event.victim?.squadID ?? event.victim?.squadId ?? event.victimSquadID);
}

function weaponName(event: any) {
  return event.weapon?.displayName || event.weapon?.cleaned || event.weapon || event.causedBy || "-";
}

function weaponTypeLabel(event: any) {
  return String(event?.weapon?.typeLabel ?? "").trim();
}

function weaponTypeClass(event: any) {
  const key = String(event?.weapon?.typeKey ?? "").trim().toLowerCase();
  return key ? key.replace(/[^a-z0-9]+/g, "-") : "other";
}

function formatTime(value: unknown) {
  const text = String(value ?? "");
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
}

function eventFlagLabels(event: any) {
  if (Array.isArray(event?.eventFlagLabels) && event.eventFlagLabels.length) {
    return event.eventFlagLabels.map((label: unknown) => String(label)).filter(Boolean);
  }
  if (Array.isArray(event?.eventFlags) && event.eventFlags.length) {
    return event.eventFlags.map((flag: any) => String(flag?.label ?? "")).filter(Boolean);
  }
  return [];
}

function formatIdentityMeta(entity: any, fallbackTeamId: unknown, fallbackSquadId: unknown) {
  const teamId = entity?.teamID ?? entity?.teamId ?? fallbackTeamId ?? null;
  const squadId = entity?.squadID ?? entity?.squadId ?? fallbackSquadId ?? null;
  const parts = [
    teamId == null || teamId === "" ? "" : `Team ID ${teamId}`,
    squadId == null || squadId === "" ? "" : `Squad ID ${squadId}`,
  ].filter(Boolean);
  return parts.join(" / ");
}

function formatTeamText(teamId: unknown) {
  const normalized = teamId == null || teamId === "" ? "" : String(teamId);
  return normalized ? `Team ID ${normalized}` : "";
}

function formatSquadText(squadId: unknown) {
  const normalized = squadId == null || squadId === "" ? "" : String(squadId);
  return normalized ? `Squad ID ${normalized}` : "";
}

function eventPairKey(event: any) {
  const attackerKey = displayedPlayerKey(attackerName(event));
  const victimKey = displayedPlayerKey(victimName(event));
  if (!attackerKey || !victimKey) return "";
  return `${attackerKey}::${victimKey}`;
}

function setHoverPair(event: any) {
  hoveredPairKey.value = eventPairKey(event);
  emit("hover-player", hoveredPairKey.value);
}

function clearHoverPair() {
  hoveredPairKey.value = "";
  emit("hover-player", "");
}

function displayedPlayerKey(value: unknown) {
  const key = String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return key && key !== "-" ? key : "";
}

function isRowHighlighted(index: number) {
  const hoverKey = hoveredPairKey.value || String(props.highlightKey ?? "");
  if (!hoverKey) return false;
  if (index < 0) return false;
  return eventPairKey(props.events[index]) === hoverKey;
}

function isClusterHighlighted(event: any, index: number) {
  return isRowHighlighted(index);
}
</script>

<style scoped>
.table-wrap {
  overflow: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 7px 10px;
  text-align: left;
  border-bottom: 1px solid #26303a;
  white-space: nowrap;
  line-height: 1.15;
}

th {
  color: #98a5af;
  font-size: 11px;
  font-weight: 600;
}

.combat-row td {
  transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.combat-row--damage td {
  background: rgba(69, 123, 157, 0.24);
  box-shadow: inset 0 0 0 1px rgba(121, 162, 191, 0.16);
}

.combat-row--wound td {
  background: rgba(245, 158, 11, 0.22);
  box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.18);
}

.combat-row--kill td {
  background: rgba(230, 57, 70, 0.28);
  box-shadow: inset 0 0 0 1px rgba(255, 125, 137, 0.18);
}

.combat-row--revive td {
  background: rgba(57, 176, 130, 0.24);
  box-shadow: inset 0 0 0 1px rgba(113, 206, 164, 0.16);
}

.combat-row--friendly td {
  box-shadow: inset 4px 0 0 rgba(244, 162, 97, 1);
}

.combat-row--highlighted td {
  background: linear-gradient(90deg, rgba(59, 130, 246, 0.35), rgba(96, 165, 250, 0.22)) !important;
  box-shadow: inset 0 0 0 1px rgba(191, 219, 254, 0.58), 0 0 0 1px rgba(96, 165, 250, 0.28);
  color: #f8fbff;
}

.combat-row--unknown td {
  background: rgba(148, 163, 184, 0.16);
}

.combat-row:hover td {
  background: rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 0 0 1px rgba(139, 182, 255, 0.22);
  filter: saturate(1.1);
}

.event-type-pill {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid #3a4651;
  background: rgba(255, 255, 255, 0.03);
  color: #edf2f4;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.name-button {
  border: 0;
  padding: 0;
  background: transparent;
  color: #edf2f4;
  font: inherit;
  cursor: pointer;
}

.name-button:hover {
  color: #8bb6ff;
  text-decoration: underline;
}

.name-button.is-highlighted {
  color: #ffffff;
  text-decoration: underline;
  text-shadow: 0 0 10px rgba(139, 182, 255, 0.45);
}

.identity-cell {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  padding: 1px 2px;
  border-radius: 6px;
  transition: background-color 0.15s ease, box-shadow 0.15s ease;
}

.identity-cell:hover {
  background: rgba(255, 255, 255, 0.07);
  box-shadow: inset 0 0 0 1px rgba(139, 182, 255, 0.30);
}

.identity-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.identity-meta span {
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid #3c4a57;
  background: rgba(10, 14, 18, 0.36);
  color: #b8c3cb;
  font-size: 10px;
}

.flag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 72px;
}

.flag-chip {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  border: 1px solid rgba(251, 191, 36, 0.34);
  background: rgba(120, 53, 15, 0.4);
  color: #fde68a;
  font-size: 11px;
  white-space: nowrap;
}

.flag-empty {
  color: #7f8c96;
  font-size: 12px;
}

.weapon-type-badge {
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  padding: 0 7px;
  margin-left: 6px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  background: rgba(148, 163, 184, 0.12);
  color: #dbe4ea;
  font-size: 11px;
  white-space: nowrap;
  vertical-align: middle;
}

.weapon-type-badge.light {
  border-color: rgba(96, 165, 250, 0.42);
  background: rgba(96, 165, 250, 0.16);
  color: #dbeafe;
}

.weapon-type-badge.anti-tank {
  border-color: rgba(244, 114, 182, 0.38);
  background: rgba(244, 114, 182, 0.14);
  color: #fbcfe8;
}

.weapon-type-badge.explosive {
  border-color: rgba(245, 158, 11, 0.42);
  background: rgba(245, 158, 11, 0.16);
  color: #fde68a;
}

.weapon-type-badge.melee {
  border-color: rgba(52, 211, 153, 0.4);
  background: rgba(52, 211, 153, 0.14);
  color: #bbf7d0;
}

.weapon-type-badge.other {
  border-color: rgba(148, 163, 184, 0.24);
  background: rgba(148, 163, 184, 0.1);
  color: #cbd5e1;
}

.weapon-type-badge.bot-weapon {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.14);
  color: #fecaca;
}
</style>
