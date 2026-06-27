<template>
  <button
    type="button"
    class="touch-icon-button"
    :class="[tone && `tone-${tone}`, { active, compact }]"
    :aria-label="ariaLabel || label"
    :title="title || label || ariaLabel"
  >
    <span v-if="$slots.icon" class="touch-icon-button__icon" aria-hidden="true">
      <slot name="icon" />
    </span>
    <span v-if="label" class="touch-icon-button__label">{{ label }}</span>
    <slot />
  </button>
</template>

<script setup lang="ts">
defineProps<{
  label?: string;
  ariaLabel?: string;
  title?: string;
  active?: boolean;
  compact?: boolean;
  tone?: "primary" | "danger" | "neutral";
}>();
</script>

<style scoped>
.touch-icon-button {
  min-width: var(--touch-target-min);
  min-height: var(--touch-target-min);
  padding: 10px 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 14px;
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.016)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-elevated);
  color: var(--color-text-primary);
  box-shadow: var(--shadow-sm);
  transition: border-color 0.15s ease, background-color 0.15s ease, transform 0.15s ease;
}

.touch-icon-button:hover,
.touch-icon-button.active {
  border-color: var(--color-border-highlight);
  background: color-mix(in srgb, var(--color-brand-primary) 14%, var(--color-bg-elevated));
}

.touch-icon-button.compact {
  min-width: 40px;
  min-height: 40px;
  padding: 8px 10px;
}

.touch-icon-button.tone-danger.active,
.touch-icon-button.tone-danger:hover {
  background: rgba(248, 113, 113, 0.14);
  border-color: rgba(248, 113, 113, 0.32);
}

.touch-icon-button__icon {
  display: inline-grid;
  place-items: center;
}

.touch-icon-button__label {
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}
</style>
