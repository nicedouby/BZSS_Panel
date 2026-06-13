<template>
  <section
    class="app-split-layout"
    :class="[
      { 'right-fixed': rightFixed },
      `responsive-${responsiveMode}`,
      { 'is-stack': isStack },
      { 'has-active-left': activePane === 'left' },
      { 'has-active-right': activePane === 'right' },
    ]"
  >
    <div class="split-left">
      <slot name="left" />
    </div>
    <div class="split-right">
      <slot name="right" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{
  rightFixed?: boolean;
  responsiveMode?: "tabs" | "stack" | "first-only";
  activePane?: "left" | "right";
}>(), {
  rightFixed: false,
  responsiveMode: "tabs",
  activePane: "left",
});

const isStack = computed(() => props.responsiveMode === "stack");
</script>

<style scoped>
.app-split-layout {
  display: grid;
  grid-template-columns: minmax(320px, 360px) minmax(0, 1fr);
  gap: 16px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  align-items: stretch;
}

.app-split-layout.right-fixed {
  grid-template-columns: minmax(0, 1fr) minmax(340px, 420px);
}

.app-split-layout.is-stack {
  grid-template-columns: minmax(0, 1fr);
}

.app-split-layout.responsive-first-only.is-stack .split-right {
  display: none;
}

.app-split-layout.responsive-first-only.is-stack .split-left {
  overflow: visible;
}

.split-left,
.split-right {
  min-width: 0;
  min-height: 0;
  display: grid;
  gap: 16px;
  height: 100%;
  overflow: auto;
  scrollbar-gutter: stable both-edges;
}

.split-right {
  align-content: start;
}

@media (max-width: 1100px) {
  .app-split-layout,
  .app-split-layout.right-fixed {
    grid-template-columns: minmax(0, 1fr);
  }

  .app-split-layout.responsive-stack .split-left,
  .app-split-layout.responsive-stack .split-right,
  .app-split-layout.responsive-first-only .split-left {
    height: auto;
    overflow: visible;
  }

  .app-split-layout.responsive-first-only .split-right {
    display: none;
  }
}
</style>
