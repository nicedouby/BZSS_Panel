<template>
  <div class="mobile-segment-tabs" role="tablist" :aria-label="ariaLabel">
    <button
      v-for="item in items"
      :key="item.value"
      type="button"
      class="mobile-segment-tabs__item"
      :class="{ active: item.value === modelValue }"
      role="tab"
      :aria-selected="item.value === modelValue"
      @click="$emit('update:modelValue', item.value)"
    >
      <span class="mobile-segment-tabs__label">{{ item.label }}</span>
      <span v-if="item.badge" class="mobile-segment-tabs__badge">{{ item.badge }}</span>
    </button>
  </div>
</template>

<script setup lang="ts" generic="T extends string | number">
defineProps<{
  modelValue: T;
  ariaLabel: string;
  items: Array<{ value: T; label: string; badge?: string | number | null }>;
}>();

defineEmits<{
  (event: "update:modelValue", value: T): void;
}>();
</script>

<style scoped>
.mobile-segment-tabs {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 8px;
  padding: 6px;
  border-radius: 16px;
  border: 1px solid var(--color-border-default);
  background: color-mix(in srgb, var(--color-bg-card) 88%, transparent);
  box-shadow: var(--shadow-sm);
}

.mobile-segment-tabs__item {
  min-width: 0;
  min-height: var(--touch-target-min);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 12px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 700;
}

.mobile-segment-tabs__item.active {
  background: color-mix(in srgb, var(--color-brand-primary) 18%, var(--color-bg-hover));
  color: var(--color-text-primary);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-brand-primary) 28%, transparent);
}

.mobile-segment-tabs__badge {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 11px;
}

@media (orientation: landscape) and (max-height: 520px) {
  .mobile-segment-tabs {
    gap: 5px;
    padding: 4px;
    border-radius: 12px;
  }

  .mobile-segment-tabs__item {
    gap: 4px;
    padding: 0 8px;
    border-radius: 9px;
    font-size: 12px;
  }

  .mobile-segment-tabs__badge {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    font-size: 10px;
  }
}
</style>
