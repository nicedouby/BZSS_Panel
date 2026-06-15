<template>
  <dl class="definition-grid">
    <div
      v-for="item in items"
      :key="item.key"
      class="definition-grid__item"
      :class="{
        'definition-grid__item--mono': item.mono,
        'definition-grid__item--break-all': item.breakAll,
      }"
    >
      <dt>{{ item.label }}</dt>
      <dd>
        <StatusBadge v-if="item.tone" :tone="item.tone" size="sm">{{ item.value }}</StatusBadge>
        <template v-else>{{ item.value }}</template>
      </dd>
    </div>
  </dl>
</template>

<script setup lang="ts">
import StatusBadge from "./StatusBadge.vue";
import type { StatusTone } from "./StatusBadge.vue";

export type DefinitionItemData = {
  key: string;
  label: string;
  value: string | number;
  tone?: StatusTone;
  mono?: boolean;
  breakAll?: boolean;
};

defineProps<{
  items: DefinitionItemData[];
}>();
</script>

<style scoped>
.definition-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.definition-grid__item {
  min-width: 0;
}

.definition-grid dt {
  color: var(--color-text-muted);
  font-size: 12px;
  margin-bottom: 4px;
}

.definition-grid dd {
  margin: 0;
  min-width: 0;
}

.definition-grid__item--mono dd {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.definition-grid__item--break-all dd {
  word-break: break-all;
}

@media (max-width: 900px) {
  .definition-grid {
    grid-template-columns: 1fr;
  }
}
</style>
