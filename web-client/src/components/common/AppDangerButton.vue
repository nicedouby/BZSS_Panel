<template>
  <button
    type="button"
    class="app-danger-button"
    :class="[`tone-${tone}`, `variant-${variant}`]"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  tone?: "danger" | "warn" | "neutral";
  variant?: "solid" | "outline" | "ghost";
  disabled?: boolean;
}>(), {
  tone: "danger",
  variant: "solid",
  disabled: false,
});
</script>

<style scoped>
.app-danger-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  transition: transform 0.15s ease, background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  white-space: nowrap;
}

.app-danger-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.app-danger-button:not(:disabled):hover {
  transform: translateY(-1px);
}

.app-danger-button.variant-solid.tone-danger {
  background: linear-gradient(180deg, rgba(248, 113, 113, 0.92), rgba(220, 38, 38, 0.92));
  color: #fff;
  border-color: rgba(248, 113, 113, 0.45);
}

.app-danger-button.variant-solid.tone-warn {
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.92), rgba(217, 119, 6, 0.92));
  color: #1a1200;
  border-color: rgba(245, 158, 11, 0.45);
}

.app-danger-button.variant-outline.tone-danger {
  background: rgba(248, 113, 113, 0.08);
  color: #fda4af;
  border-color: rgba(248, 113, 113, 0.3);
}

.app-danger-button.variant-outline.tone-warn {
  background: rgba(245, 158, 11, 0.08);
  color: #facc15;
  border-color: rgba(245, 158, 11, 0.3);
}

.app-danger-button.variant-ghost.tone-neutral {
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary);
  border-color: var(--color-border-default);
}

.app-danger-button.variant-ghost.tone-neutral:hover:not(:disabled) {
  color: var(--color-text-primary);
  border-color: var(--color-status-info);
}
</style>
