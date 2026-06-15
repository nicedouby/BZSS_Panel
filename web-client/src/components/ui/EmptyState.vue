<template>
  <div class="empty-state" :class="{ 'empty-state--compact': compact }">
    <div v-if="icon" class="empty-state__icon" aria-hidden="true">{{ icon }}</div>
    <strong v-if="title" class="empty-state__title">{{ title }}</strong>
    <p v-if="description" class="empty-state__description">{{ description }}</p>
    <div v-if="$slots.actions" class="empty-state__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  title?: string;
  description?: string;
  compact?: boolean;
  icon?: string;
}>(), {
  title: "暂无数据",
  description: "",
  compact: false,
  icon: "",
});
</script>

<style scoped>
.empty-state {
  min-height: 156px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  padding: 24px 18px;
  border: 1px dashed var(--color-border-highlight);
  border-radius: var(--card-radius, 14px);
  background: color-mix(in srgb, var(--color-bg-elevated) 70%, transparent);
  text-align: center;
}

.empty-state--compact {
  min-height: 0;
  padding: 12px;
}

.empty-state__icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--color-brand-primary) 24%, transparent);
  background: color-mix(in srgb, var(--color-brand-primary) 12%, transparent);
  color: color-mix(in srgb, var(--color-brand-primary) 72%, white 28%);
}

.empty-state__title {
  font-size: 14px;
}

.empty-state__description {
  max-width: 48ch;
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.empty-state__actions {
  display: flex;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
