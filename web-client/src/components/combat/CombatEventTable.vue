<template>
  <PageCard compact>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Type</th>
            <th>Attacker</th>
            <th>Victim</th>
            <th>Damage</th>
            <th>Source</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(event, index) in events" :key="event.id || `${event.time}-${index}`">
            <td>{{ formatTime(event.time) }}</td>
            <td>{{ eventType(event) }}</td>
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
            <td><button type="button" @click="$emit('select', event)">Detail</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </PageCard>
</template>

<script setup lang="ts">
import PageCard from "../common/PageCard.vue";

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
</style>
