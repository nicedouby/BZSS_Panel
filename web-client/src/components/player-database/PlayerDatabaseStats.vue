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
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 8px;
}

.stat-card {
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border-default);
  border-radius: 10px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
}

.stat-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
  line-height: 1.1;
}

.stat-value {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.12;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 780px) {
  .db-stats {
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 6px;
  }

  .stat-card {
    padding: 7px 10px;
    border-radius: 9px;
  }

  .stat-value {
    font-size: 14px;
  }
}
</style>
