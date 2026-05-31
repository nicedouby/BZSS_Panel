<template>
  <PageCard :title="title" :description="description" :compact="compact" class="app-card">
    <slot />
  </PageCard>
</template>

<script setup lang="ts">
import PageCard from "./PageCard.vue";

withDefaults(defineProps<{
  title?: string;
  description?: string;
  compact?: boolean;
}>(), {
  title: "",
  description: "",
  compact: false,
});
</script>

<style scoped>
.app-card {
  min-width: 0;
}
</style>
