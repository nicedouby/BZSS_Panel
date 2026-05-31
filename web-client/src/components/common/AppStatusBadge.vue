<template>
  <component
    :is="interactive ? 'button' : 'span'"
    class="app-status-badge"
    :class="{ interactive, active }"
    :data-tone="tone"
    :type="interactive ? 'button' : undefined"
  >
    <slot />
  </component>
</template>

<script setup lang="ts">
type AppTone = "ok" | "warn" | "error" | "idle";

withDefaults(defineProps<{
  tone?: AppTone;
  interactive?: boolean;
  active?: boolean;
}>(), {
  tone: "idle",
  interactive: false,
  active: false,
});
</script>

<style scoped>
.app-status-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  min-width: 0;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.02)), rgba(255, 255, 255, 0.004)),
    rgba(122, 162, 184, 0.09);
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  box-shadow: var(--shadow-sm);
}

.app-status-badge.interactive {
  cursor: pointer;
}

.app-status-badge.active {
  border-color: rgba(96, 165, 250, 0.26);
  background: rgba(96, 165, 250, 0.12);
  color: var(--color-text-primary);
}

.app-status-badge[data-tone="ok"] {
  border-color: rgba(52, 211, 153, 0.28);
  color: var(--color-status-online);
  background: rgba(52, 211, 153, 0.12);
}

.app-status-badge[data-tone="warn"] {
  border-color: rgba(245, 158, 11, 0.28);
  color: var(--color-status-warning);
  background: rgba(245, 158, 11, 0.12);
}

.app-status-badge[data-tone="error"] {
  border-color: rgba(248, 113, 113, 0.28);
  color: var(--color-status-error);
  background: rgba(248, 113, 113, 0.12);
}

.app-status-badge.interactive:hover {
  border-color: rgba(96, 165, 250, 0.4);
}
</style>
