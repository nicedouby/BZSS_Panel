<template>
  <span class="badge" :data-tone="tone"><slot /></span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ tone?: "ok" | "warn" | "error" | "idle" }>(), {
  tone: "idle",
});
</script>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  min-width: 60px;
  border-radius: 999px;
  padding: 0 12px;
  font-size: 12px;
  line-height: 1;
  font-weight: 700;
  letter-spacing: 0.02em;
  border: 1px solid var(--color-border-default);
  color: var(--color-text-secondary);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.02)), rgba(255, 255, 255, 0.004)),
    rgba(122, 162, 184, 0.09);
  box-shadow: var(--shadow-sm);
  white-space: nowrap;
}

.badge[data-tone="ok"] {
  border-color: rgba(52, 211, 153, 0.28);
  color: var(--color-status-online);
  background: rgba(52, 211, 153, 0.12);
}

.badge[data-tone="warn"] {
  border-color: rgba(245, 158, 11, 0.28);
  color: var(--color-status-warning);
  background: rgba(245, 158, 11, 0.12);
}

.badge[data-tone="error"] {
  border-color: rgba(248, 113, 113, 0.28);
  color: var(--color-status-error);
  background: rgba(248, 113, 113, 0.12);
}

.badge[data-tone="idle"] {
  color: var(--color-text-secondary);
}
</style>
