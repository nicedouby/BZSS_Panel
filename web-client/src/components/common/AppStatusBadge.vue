<template>
  <StatusBadge :tone="tone" size="lg" :interactive="interactive" :active="active">
    <slot />
  </StatusBadge>
</template>

<script setup lang="ts">
import StatusBadge from "../ui/StatusBadge.vue";

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
