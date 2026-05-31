<template>
  <section class="app-page" :class="{ 'full-bleed': fullBleed }">
    <slot />
  </section>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  fullBleed?: boolean;
}>(), {
  fullBleed: false,
});
</script>

<style scoped>
.app-page {
  display: grid;
  gap: 16px;
  min-width: 0;
  min-height: 0;
}

.app-page.full-bleed {
  height: 100%;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
}
</style>
