<template>
  <UiStatusBadge :tone="tone">
    <slot />
  </UiStatusBadge>
</template>

<script setup lang="ts">
import UiStatusBadge from "../ui/StatusBadge.vue";

withDefaults(defineProps<{ tone?: "ok" | "warn" | "error" | "idle" }>(), {
  tone: "idle",
});
</script>
