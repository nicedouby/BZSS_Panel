<template>
  <article class="stat-card" :class="[`stat-card--${tone}`, { 'stat-card--clickable': clickable }]">
    <span class="stat-card__label">{{ label }}</span>
    <strong class="stat-card__value">{{ loading ? "..." : value }}</strong>
    <em v-if="description" class="stat-card__description">{{ description }}</em>
  </article>
</template>

<script setup lang="ts">
import type { StatusTone } from "./StatusBadge.vue";

withDefaults(defineProps<{
  label: string;
  value: string | number;
  description?: string;
  tone?: StatusTone;
  loading?: boolean;
  clickable?: boolean;
}>(), {
  description: "",
  tone: "neutral",
  loading: false,
  clickable: false,
});
</script>

<style scoped>
.stat-card {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: var(--card-padding-md, 16px);
  border-radius: var(--card-radius, 14px);
  border: 1px solid var(--color-border-default);
  background:
    var(--theme-panel-highlight),
    var(--color-bg-card);
  box-shadow: var(--shadow-sm);
}

.stat-card--clickable {
  cursor: pointer;
}

.stat-card--info {
  border-color: color-mix(in srgb, var(--color-status-info) 24%, var(--color-border-default));
}

.stat-card--success {
  border-color: color-mix(in srgb, var(--color-status-success, var(--color-status-online)) 24%, var(--color-border-default));
}

.stat-card--warning {
  border-color: color-mix(in srgb, var(--color-status-warning) 24%, var(--color-border-default));
}

.stat-card--danger {
  border-color: color-mix(in srgb, var(--color-status-danger, var(--color-status-error)) 24%, var(--color-border-default));
}

.stat-card__label,
.stat-card__description {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-style: normal;
}

.stat-card__value {
  font-size: 26px;
  line-height: 1;
}
</style>
