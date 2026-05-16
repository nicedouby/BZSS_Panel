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
          <tr v-for="(event, index) in events" :key="event.id || `${event.time}-${index}`">
            <td>{{ formatTime(event.time) }}</td>
            <td>{{ eventType(event) }}</td>
            <td>
              <div class="flag-row">
                <span v-for="label in eventFlagLabels(event)" :key="label" class="flag-chip">
                  {{ label }}
                </span>
                <span v-if="!eventFlagLabels(event).length" class="flag-empty">-</span>
              </div>
            </td>
            <td>
              <button type="button" class="name-button" @click="$emit('search-player', attackerIdentity(event))">
                {{ attackerName(event) }}
              </button>
            </td>
            <td>
              <button type="button" class="name-button" @click="$emit('search-player', victimIdentity(event))">
                {{ victimName(event) }}
              </button>
            </td>
            <td>{{ event.damage ?? "-" }}</td>
            <td>{{ event.weapon?.displayName || event.weapon || event.causedBy || "-" }}</td>
            <td><button type="button" @click="$emit('select', event)">{{ t("common.open") }}</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </PageCard>
</template>

<script setup lang="ts">
import PageCard from "../common/PageCard.vue";
import { t } from "../../i18n";

defineProps<{
  events: any[];
}>();

defineEmits<{
  (event: "select", value: any): void;
  (event: "search-player", value: string): void;
}>();

function eventType(event: any) {
  return event.type || event.friendlyFireType || event.eventName || "-";
}

function attackerName(event: any) {
  return event.attacker?.name || event.attackerName || "-";
}

function attackerIdentity(event: any) {
  return event.attacker?.name || event.attackerName || event.attacker?.steamID || event.attackerSteamID || event.attacker?.eosID || event.attackerEOSID || "";
}

function victimName(event: any) {
  return event.victim?.name || event.victimName || "-";
}

function victimIdentity(event: any) {
  return event.victim?.name || event.victimName || event.victim?.steamID || event.victimSteamID || event.victim?.eosID || event.victimEOSID || "";
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
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #26303a;
  white-space: nowrap;
}

th {
  color: #98a5af;
  font-size: 12px;
  font-weight: 600;
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

.flag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 72px;
}

.flag-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid #3a4651;
  background: rgba(255, 255, 255, 0.03);
  color: #d7e0e5;
  font-size: 12px;
  white-space: nowrap;
}

.flag-empty {
  color: #7f8c96;
  font-size: 12px;
}
</style>
