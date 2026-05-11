<template>
  <section class="page-card">
    <header v-if="$slots.header || title || $slots.actions" class="card-header">
      <div class="card-title-block">
        <slot name="header">
          <h2 v-if="title" class="card-title">{{ title }}</h2>
          <p v-if="description" class="card-description">{{ description }}</p>
        </slot>
      </div>
      <div v-if="$slots.actions" class="card-actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="card-body" :class="{ compact }">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
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
.page-card {
  border: 1px solid #2c343d;
  background: #171d23;
  border-radius: 8px;
}

.card-header {
  padding: 14px 16px 0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.card-title-block {
  min-width: 0;
}

.card-title {
  margin: 0;
  font-size: 16px;
}

.card-description {
  margin: 6px 0 0;
  font-size: 12px;
  color: #98a5af;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.card-body {
  padding: 16px;
}

.card-body.compact {
  padding: 12px;
}
</style>
