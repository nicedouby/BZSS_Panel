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
  min-height: 22px;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 12px;
  border: 1px solid #3a4651;
  color: #d7e0e5;
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
