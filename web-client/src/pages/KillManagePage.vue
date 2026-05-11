<template>
  <CombatEventsPage
    page-title="Kill Manage"
    page-subtitle="Structured combat events from the combat state module."
    endpoint="/api/combat/events"
    clear-endpoint="/api/combat/clear"
    route-scope="kill-manage"
    :type-options="typeOptions"
    empty-text="No combat events match the current filters."
  />
</template>

<script setup lang="ts">
import CombatEventsPage from "./shared/CombatEventsPage.vue";

const typeOptions = [
  { value: "all", label: "All" },
  { value: "damage", label: "Damage" },
  { value: "wound", label: "Wound" },
  { value: "death", label: "Death" },
  { value: "friendly", label: "Friendly" },
  { value: "teamDamage", label: "Team Damage" },
  { value: "teamWound", label: "Team Wound" },
  { value: "teamKill", label: "Team Kill" },
];
</script>
