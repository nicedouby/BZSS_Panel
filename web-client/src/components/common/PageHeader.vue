<template>
  <header class="page-header">
    <div class="text-block">
      <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
      <h1 class="title">{{ title }}</h1>
      <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.actions" class="actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  subtitle?: string;
  eyebrow?: string;
}>();
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}

.text-block {
  min-width: 0;
}

.eyebrow {
  margin: 0 0 8px;
  font-size: 12px;
  color: #8da0ad;
  text-transform: uppercase;
}

.title {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
}

.subtitle {
  margin: 6px 0 0;
  color: #9aa7b2;
  font-size: 13px;
}

.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}
</style>
