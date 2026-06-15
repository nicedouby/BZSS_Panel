<template>
  <span
    class="status-badge"
    :class="[
      `status-badge--${normalizedTone}`,
      `status-badge--${size}`,
      `status-badge--${normalizedVariant}`,
      { 'status-badge--dot': dot },
    ]"
  >
    <span v-if="dot" class="status-badge__dot" aria-hidden="true" />
    <slot />
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";
export type LegacyStatusTone = "ok" | "warn" | "error" | "muted" | "idle";
export type StatusVariant = "soft" | "outline" | "solid";

const props = withDefaults(defineProps<{
  tone?: StatusTone | LegacyStatusTone;
  size?: "sm" | "md";
  variant?: StatusVariant | "subtle";
  dot?: boolean;
}>(), {
  tone: "neutral",
  size: "md",
  variant: "soft",
  dot: false,
});

const normalizedTone = computed<StatusTone>(() => {
  if (props.tone === "ok") return "success";
  if (props.tone === "warn") return "warning";
  if (props.tone === "error") return "danger";
  if (props.tone === "muted" || props.tone === "idle") return "neutral";
  return props.tone;
});

const normalizedVariant = computed<StatusVariant>(() => props.variant === "subtle" ? "soft" : props.variant);
</script>

<style scoped>
.status-badge {
  --status-color: var(--color-text-secondary);
  --status-bg: color-mix(in srgb, var(--color-border-default) 55%, transparent);
  --status-border: color-mix(in srgb, var(--color-border-default) 88%, transparent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--status-border);
  background: var(--status-bg);
  color: var(--status-color);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  box-shadow: var(--shadow-sm);
}

.status-badge--sm {
  min-height: 20px;
  padding-inline: 8px;
  font-size: 11px;
}

.status-badge--info {
  --status-color: color-mix(in srgb, var(--color-status-info) 76%, white 24%);
  --status-bg: color-mix(in srgb, var(--color-status-info) 13%, transparent);
  --status-border: color-mix(in srgb, var(--color-status-info) 28%, transparent);
}

.status-badge--success {
  --status-color: color-mix(in srgb, var(--color-status-success, var(--color-status-online)) 78%, white 22%);
  --status-bg: color-mix(in srgb, var(--color-status-success, var(--color-status-online)) 13%, transparent);
  --status-border: color-mix(in srgb, var(--color-status-success, var(--color-status-online)) 28%, transparent);
}

.status-badge--warning {
  --status-color: color-mix(in srgb, var(--color-status-warning) 78%, white 22%);
  --status-bg: color-mix(in srgb, var(--color-status-warning) 13%, transparent);
  --status-border: color-mix(in srgb, var(--color-status-warning) 28%, transparent);
}

.status-badge--danger {
  --status-color: color-mix(in srgb, var(--color-status-danger, var(--color-status-error)) 78%, white 22%);
  --status-bg: color-mix(in srgb, var(--color-status-danger, var(--color-status-error)) 13%, transparent);
  --status-border: color-mix(in srgb, var(--color-status-danger, var(--color-status-error)) 28%, transparent);
}

.status-badge--outline {
  background: transparent;
}

.status-badge--solid {
  background: var(--status-color);
  border-color: transparent;
  color: var(--color-bg-page);
}

.status-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}
</style>
