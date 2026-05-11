<template>
  <PageCard compact>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Permission</th>
            <th>Steam</th>
            <th>Kills</th>
            <th>Deaths</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="player in rows"
            :key="player.id"
            class="row"
            :class="{ active: selectedId === player.id }"
            @click="$emit('select', player.id)"
          >
            <td>{{ player.name || player.current_name || "-" }}</td>
            <td>{{ player.permissionGroup || player.permission_group || "default" }}</td>
            <td>{{ player.steamID || player.steam_id || "-" }}</td>
            <td>{{ player.kills ?? 0 }}</td>
            <td>{{ player.deaths ?? 0 }}</td>
            <td>{{ formatTime(player.updatedAt ?? player.updated_at) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </PageCard>
</template>

<script setup lang="ts">
import PageCard from "../common/PageCard.vue";

defineProps<{
  rows: any[];
  selectedId: number | null;
}>();

defineEmits<{
  (event: "select", id: number): void;
}>();

function formatTime(value: unknown) {
  const time = Number(value ?? 0);
  if (!time) return "-";
  return new Date(time).toLocaleString();
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

.row {
  cursor: pointer;
}

.row.active {
  background: #121920;
}
</style>
