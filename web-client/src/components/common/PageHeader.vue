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
  padding-bottom: 4px;
}

.text-block {
  flex: 1 1 420px;
  min-width: 0;
}

.eyebrow {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 700;
  color: var(--color-status-info);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.title {
  margin: 0;
  font-size: clamp(22px, 2.1vw, 30px);
  line-height: 1.15;
  letter-spacing: -0.03em;
}

.subtitle {
  margin: 8px 0 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.55;
  max-width: 72ch;
}

.actions {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

@media (max-width: 640px) {
  .page-header {
    gap: 12px;
  }

  .text-block,
  .actions {
    flex-basis: 100%;
    width: 100%;
  }

  .actions {
    justify-content: flex-start;
  }

  .actions :deep(button),
  .actions :deep(a),
  .actions :deep(select) {
    max-width: 100%;
  }
}
</style>
