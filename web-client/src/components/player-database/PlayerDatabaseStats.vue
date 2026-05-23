<template>
  <section class="db-stats">
    <div v-for="item in stats" :key="item.label" class="stat-card">
      <span class="stat-label">{{ item.label }}</span>
      <strong class="stat-value">{{ item.value }}</strong>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  stats: Array<{ label: string; value: string }>;
}>();
</script>

<style scoped>
.db-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}

.stat-card {
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-text-muted);
  letter-spacing: 0.05em;
}

.stat-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text-primary);
}
</style>
