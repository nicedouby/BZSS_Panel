<template>
  <button
    :type="type"
    class="app-button"
    :class="[
      `app-button--${variant}`,
      `app-button--${size}`,
      {
        'app-button--block': block,
        'app-button--icon-only': iconOnly,
      },
    ]"
    :disabled="disabled || loading"
    :aria-busy="loading ? 'true' : undefined"
  >
    <span v-if="loading" class="app-button__spinner" aria-hidden="true" />
    <span class="app-button__content">
      <slot />
    </span>
  </button>
</template>

<script setup lang="ts">
export type ButtonVariant = "default" | "primary" | "danger" | "warning" | "ghost" | "soft";
export type ButtonSize = "sm" | "md" | "lg";

withDefaults(defineProps<{
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  block?: boolean;
  iconOnly?: boolean;
  type?: "button" | "submit" | "reset";
}>(), {
  variant: "default",
  size: "md",
  loading: false,
  disabled: false,
  block: false,
  iconOnly: false,
  type: "button",
});
</script>

<style scoped>
.app-button {
  --app-button-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 0;
  min-height: var(--app-button-height);
  padding: 0 14px;
  border-radius: var(--control-radius, 10px);
  border: 1px solid var(--color-border-default);
  background:
    var(--theme-panel-highlight),
    color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
  color: var(--color-text-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
  white-space: nowrap;
}

.app-button:hover:not(:disabled) {
  border-color: var(--color-border-highlight);
  background: var(--color-bg-hover);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.app-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
}

.app-button--sm {
  --app-button-height: var(--control-height-sm, 30px);
  padding-inline: 10px;
  font-size: 12px;
}

.app-button--md {
  --app-button-height: var(--control-height-md, 34px);
}

.app-button--lg {
  --app-button-height: 40px;
  padding-inline: 16px;
}

.app-button--primary {
  border-color: color-mix(in srgb, var(--color-brand-primary) 55%, transparent);
  background: color-mix(in srgb, var(--color-brand-primary) 28%, transparent);
  box-shadow: 0 0 22px color-mix(in srgb, var(--theme-brand-glow) 80%, transparent);
}

.app-button--danger {
  border-color: color-mix(in srgb, var(--color-status-danger, var(--color-status-error)) 55%, transparent);
  background: color-mix(in srgb, var(--color-status-danger, var(--color-status-error)) 24%, transparent);
  color: color-mix(in srgb, var(--color-status-danger, var(--color-status-error)) 26%, white 74%);
}

.app-button--warning {
  border-color: color-mix(in srgb, var(--color-status-warning) 55%, transparent);
  background: color-mix(in srgb, var(--color-status-warning) 24%, transparent);
  color: color-mix(in srgb, var(--color-status-warning) 28%, white 72%);
}

.app-button--ghost {
  background: transparent;
}

.app-button--soft {
  background: color-mix(in srgb, var(--color-brand-primary) 12%, transparent);
  border-color: color-mix(in srgb, var(--color-brand-primary) 22%, transparent);
  color: color-mix(in srgb, var(--color-brand-primary) 70%, white 30%);
}

.app-button--block {
  width: 100%;
}

.app-button--icon-only {
  width: var(--app-button-height);
  padding-inline: 0;
}

.app-button__content {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.app-button__spinner {
  width: 1em;
  height: 1em;
  border-radius: 999px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  animation: app-button-spin 0.8s linear infinite;
}

@keyframes app-button-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
