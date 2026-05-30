<template>
  <CombatEventsPage
    :page-title="t('routeTitle.infantryCombatEnhancer')"
    page-subtitle="Processed combat warnings for the current infantry flow."
    endpoint="/api/plugins/infantry-combat-enhancer/events"
    clear-endpoint="/api/plugins/infantry-combat-enhancer/clear"
    route-scope="infantry-combat-enhancer"
    :type-options="typeOptions"
    :empty-text="t('combat.noEvents')"
  />
</template>

<script setup lang="ts">
import CombatEventsPage from "./shared/CombatEventsPage.vue";
import { t } from "../i18n";

const typeOptions = [
  { value: "all", label: t("combat.all") },
  { value: "damage", label: t("combat.damage") },
  { value: "wound", label: t("combat.wound") },
  { value: "kill", label: t("combat.kill") },
];
</script>
