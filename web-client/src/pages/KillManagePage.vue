<template>
  <CombatEventsPage
    :page-title="t('combat.killManage')"
    page-subtitle=""
    endpoint="/api/combat/events"
    clear-endpoint="/api/combat/clear"
    route-scope="kill-manage"
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
  { value: "death", label: t("combat.death") },
  { value: "revive", label: t("combat.revive", "复苏") },
  { value: "friendly", label: t("combat.friendly") },
  { value: "teamDamage", label: t("combat.teamDamage") },
  { value: "teamWound", label: t("combat.teamWound") },
  { value: "teamKill", label: t("combat.teamKill") },
];
</script>
