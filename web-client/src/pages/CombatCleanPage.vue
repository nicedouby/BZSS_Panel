<template>
  <CombatEventsPage
    page-title="Combat Clean"
    page-subtitle="Clean combat layer with route-persisted filters and paged rendering."
    endpoint="/api/combat-clean/events"
    clear-endpoint="/api/combat-clean/clear"
    route-scope="combat-clean"
    :type-options="typeOptions"
    empty-text="No clean combat events match the current filters."
  />
</template>

<script setup lang="ts">
import CombatEventsPage from "./shared/CombatEventsPage.vue";

const typeOptions = [
  { value: "all", label: "All" },
  { value: "damage", label: "Damage" },
  { value: "wound", label: "Wound" },
  { value: "kill", label: "Kill" },
];
</script>
