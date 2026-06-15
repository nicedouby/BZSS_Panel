<template>
  <div class="stat-grid">
    <StatCard
      v-for="item in items"
      :key="item.key"
      :label="item.label"
      :value="item.value"
      :description="item.description"
      :tone="item.tone"
      :loading="loading"
    />
  </div>
</template>

<script setup lang="ts">
import StatCard from "./StatCard.vue";
import type { StatusTone } from "./StatusBadge.vue";

export type StatItem = {
  key: string;
  label: string;
  value: string | number;
  description?: string;
  tone?: StatusTone;
};

withDefaults(defineProps<{
  items: StatItem[];
  loading?: boolean;
}>(), {
  loading: false,
});
</script>

<style scoped>
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--layout-gap-sm, 12px);
}
</style>
