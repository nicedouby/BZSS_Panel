<template>
  <PageCard
    :title="title"
    :description="description"
    :compact="compact"
    :body-mode="bodyMode"
    class="app-card"
  >
    <slot />
  </PageCard>
</template>

<script setup lang="ts">
import PageCard from "./PageCard.vue";

withDefaults(defineProps<{
  title?: string;
  description?: string;
  compact?: boolean;
  bodyMode?: "normal" | "fill" | "scroll";
}>(), {
  title: "",
  description: "",
  compact: false,
  bodyMode: "normal",
});
</script>

<style scoped>
.app-card {
  min-width: 0;
}
</style>
