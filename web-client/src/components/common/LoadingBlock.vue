<template>
  <div class="block">{{ t("common.loading") }}</div>
</template>

<script setup lang="ts">
import { t } from "../../i18n";
</script>

<style scoped>
.block {
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.016)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-card);
  border-radius: 16px;
  padding: 16px 18px;
  color: var(--color-text-secondary);
  box-shadow: var(--shadow-sm);
}
</style>
