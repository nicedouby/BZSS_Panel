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
  min-height: 24px;
  min-width: 60px;
  border-radius: 999px;
  padding: 0 10px;
  font-size: 12px;
  line-height: 1;
  font-weight: 600;
  letter-spacing: 0.01em;
  border: 1px solid #3a4651;
  color: #d7e0e5;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.02)), rgba(255, 255, 255, 0.004)),
    rgba(122, 162, 184, 0.08);
  white-space: nowrap;
}

.badge[data-tone="ok"] {
  border-color: #3f7158;
  color: #9ee0ba;
}

.badge[data-tone="warn"] {
  border-color: #786633;
  color: #f1d58b;
}

.badge[data-tone="error"] {
  border-color: #7a3a3a;
  color: #ffb1b1;
}
</style>
