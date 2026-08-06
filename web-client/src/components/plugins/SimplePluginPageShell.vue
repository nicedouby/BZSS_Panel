<template>
  <AppPage class="simple-plugin-page" mode="document">
    <PageHeader :eyebrow="eyebrow" :title="title" :subtitle="subtitle">
      <template #actions>
        <StatusBadge v-if="statusLabel" :tone="statusTone" dot>
          {{ statusLabel }}
        </StatusBadge>
        <span v-if="updatedAt" class="simple-plugin-page__updated">{{ updatedAt }}</span>
        <slot name="actions" />
        <AppButton
          v-if="refreshable"
          size="sm"
          :loading="loading"
          :disabled="refreshDisabled"
          @click="$emit('refresh')"
        >
          {{ refreshLabel }}
        </AppButton>
      </template>
    </PageHeader>

    <AlertBanner v-if="error" tone="danger" title="操作失败" :message="error" />
    <AlertBanner v-if="notice" tone="success" :message="notice" />

    <slot name="hero" />
    <slot name="metrics" />

    <div class="simple-plugin-page__content">
      <slot />
    </div>
  </AppPage>
</template>

<script setup lang="ts">
import AppPage from "../common/AppPage.vue";
import PageHeader from "../common/PageHeader.vue";
import AlertBanner from "../ui/AlertBanner.vue";
import AppButton from "../ui/AppButton.vue";
import StatusBadge from "../ui/StatusBadge.vue";
import type { StatusTone } from "../ui/StatusBadge.vue";

withDefaults(defineProps<{
  title: string;
  subtitle?: string;
  eyebrow?: string;
  statusLabel?: string;
  statusTone?: StatusTone;
  updatedAt?: string;
  loading?: boolean;
  refreshable?: boolean;
  refreshDisabled?: boolean;
  refreshLabel?: string;
  error?: string;
  notice?: string;
}>(), {
  subtitle: "",
  eyebrow: "PLUGIN",
  statusLabel: "",
  statusTone: "neutral",
  updatedAt: "",
  loading: false,
  refreshable: true,
  refreshDisabled: false,
  refreshLabel: "刷新",
  error: "",
  notice: "",
});

defineEmits<{
  refresh: [];
}>();
</script>

<style scoped>
.simple-plugin-page {
  width: min(100%, 1480px);
  margin-inline: auto;
}

.simple-plugin-page__updated {
  color: var(--color-text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.simple-plugin-page__content {
  display: grid;
  gap: var(--layout-gap-md, 16px);
  min-width: 0;
}
</style>
