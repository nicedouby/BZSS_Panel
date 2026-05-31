<template>
  <PageHeader :title="title" :subtitle="subtitle" :eyebrow="eyebrow">
    <template #actions>
      <div v-if="statusItems.length" class="status-items">
        <AppStatusBadge
          v-for="item in statusItems"
          :key="`${item.label}-${item.tone ?? 'idle'}`"
          :tone="item.tone ?? 'idle'"
        >
          {{ item.label }}
        </AppStatusBadge>
      </div>
      <slot name="actions" />
    </template>
  </PageHeader>
</template>

<script setup lang="ts">
import PageHeader from "./PageHeader.vue";
import AppStatusBadge from "./AppStatusBadge.vue";

type AppStatusTone = "ok" | "warn" | "error" | "idle";

withDefaults(defineProps<{
  title: string;
  subtitle?: string;
  eyebrow?: string;
  statusItems?: Array<{
    label: string;
    tone?: AppStatusTone;
  }>;
}>(), {
  subtitle: "",
  eyebrow: "",
  statusItems: () => [],
});
</script>

<style scoped>
.status-items {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
