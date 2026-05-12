<template>
  <CombatEventsPage
    :page-title="t('combat.combatClean')"
    page-subtitle=""
    endpoint="/api/combat-clean/events"
    clear-endpoint="/api/combat-clean/clear"
    route-scope="combat-clean"
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
