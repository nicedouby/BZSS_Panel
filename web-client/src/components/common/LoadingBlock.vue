<template>
  <div class="block">{{ t("common.loading") }}</div>
</template>

<script setup lang="ts">
import { t } from "../../i18n";
</script>

<style scoped>
.block {
  border: 1px solid #2c343d;
  background: #171d23;
  border-radius: 8px;
  padding: 16px;
  color: #9aa7b2;
}
</style>
