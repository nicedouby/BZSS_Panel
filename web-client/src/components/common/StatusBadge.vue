<template>
  <UiStatusBadge :tone="tone" v-bind="$attrs">
    <slot />
  </UiStatusBadge>
</template>

<script setup lang="ts">
import UiStatusBadge from "../ui/StatusBadge.vue";
defineOptions({ inheritAttrs: false });

withDefaults(defineProps<{ tone?: "ok" | "warn" | "error" | "idle" | "neutral" | "info" | "success" | "warning" | "danger" }>(), {
  tone: "idle",
});
</script>
