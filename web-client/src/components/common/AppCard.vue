<template>
  <PageCard
    :title="title"
    :description="description"
    :compact="compact"
    :overflow="overflow"
    :body-mode="bodyMode"
    class="app-card"
  >
    <template v-if="$slots.header" #header>
      <slot name="header" />
    </template>

    <template v-if="$slots.actions" #actions>
      <slot name="actions" />
    </template>

    <slot />
  </PageCard>
</template>

<script setup lang="ts">
import PageCard from "./PageCard.vue";

withDefaults(defineProps<{
  title?: string;
  description?: string;
  compact?: boolean;
  overflow?: "visible" | "clip" | "auto";
  bodyMode?: "normal" | "fill" | "scroll";
}>(), {
  title: "",
  description: "",
  compact: false,
  overflow: "visible",
  bodyMode: "normal",
});
</script>

<style scoped>
.app-card {
  min-width: 0;
}
</style>
