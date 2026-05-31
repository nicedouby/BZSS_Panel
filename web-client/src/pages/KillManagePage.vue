<template>
  <CombatEventsPage
    :page-title="t('combat.combatManager')"
    page-subtitle="统一展示伤害、击倒、击杀、死亡、TK 与战斗事件。"
    endpoint="/api/combat-manager/events"
    clear-endpoint="/api/combat-manager/clear"
    rate-endpoint="/api/combat-manager/rates"
    route-scope="combat-manager"
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
  { value: "death", label: t("combat.death") },
  { value: "revive", label: t("combat.revive", "复苏") },
  { value: "friendly", label: t("combat.friendly") },
  { value: "teamDamage", label: t("combat.teamDamage") },
  { value: "teamWound", label: t("combat.teamWound") },
  { value: "teamKill", label: t("combat.teamKill") },
  { value: "tk", label: t("combat.teamKill") },
];
</script>
