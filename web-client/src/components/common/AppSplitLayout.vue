<template>
  <section class="app-split-layout" :class="{ 'right-fixed': rightFixed }">
    <div class="split-left">
      <slot name="left" />
    </div>
    <div class="split-right">
      <slot name="right" />
    </div>
  </section>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  rightFixed?: boolean;
}>(), {
  rightFixed: false,
});
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
}
</style>
