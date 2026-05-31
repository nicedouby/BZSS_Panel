<template>
  <section class="app-section">
    <header v-if="title || description || $slots.header" class="section-head">
      <slot name="header">
        <h2 v-if="title" class="section-title">{{ title }}</h2>
        <p v-if="description" class="section-description">{{ description }}</p>
      </slot>
    </header>
    <div class="section-body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  title?: string;
  description?: string;
}>(), {
  title: "",
  description: "",
});
</script>

<style scoped>
.app-section {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.section-head {
  min-width: 0;
}

.section-title {
  margin: 0;
  font-size: 15px;
  line-height: 1.3;
}

.section-description {
  margin: 6px 0 0;
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.section-body {
  min-width: 0;
}
</style>
