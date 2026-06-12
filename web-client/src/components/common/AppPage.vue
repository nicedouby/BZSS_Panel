<template>
  <section class="app-page" :class="pageClass">
    <slot />
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{
  fullBleed?: boolean;
  mode?: "document" | "workspace";
}>(), {
  fullBleed: false,
  mode: "document",
});

const pageClass = computed(() => {
  const mode = props.fullBleed ? "workspace" : props.mode;
  return {
    "app-page--document": mode === "document",
    "app-page--workspace": mode === "workspace",
    "full-bleed": props.fullBleed,
  };
});
</script>

<style scoped>
.app-page {
  display: grid;
  gap: 16px;
  min-width: 0;
  min-height: 0;
}

.app-page--document {
  align-content: start;
}

.app-page--workspace {
  height: 100%;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
}

.app-page--workspace > .page-content {
  min-height: 0;
}
</style>
