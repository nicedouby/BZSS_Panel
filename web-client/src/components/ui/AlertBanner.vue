<template>
  <section class="alert-banner" :class="`alert-banner--${tone}`" role="status">
    <div class="alert-banner__body">
      <strong v-if="title" class="alert-banner__title">{{ title }}</strong>
      <p v-if="message" class="alert-banner__message">{{ message }}</p>
      <div v-if="$slots.default" class="alert-banner__slot">
        <slot />
      </div>
    </div>
    <div v-if="$slots.actions || dismissible" class="alert-banner__actions">
      <slot name="actions" />
      <AppButton v-if="dismissible" variant="ghost" size="sm" icon-only class="alert-banner__close" aria-label="关闭" @click="$emit('dismiss')">×</AppButton>
    </div>
  </section>
</template>

<script setup lang="ts">
import AppButton from "./AppButton.vue";
export type AlertTone = "info" | "success" | "warning" | "danger";

defineEmits<{
  dismiss: [];
}>();

withDefaults(defineProps<{
  tone: AlertTone;
  title?: string;
  message?: string;
  dismissible?: boolean;
}>(), {
  title: "",
  message: "",
  dismissible: false,
});
</script>

<style scoped>
.alert-banner {
  --alert-color: var(--color-status-info);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--alert-color) 30%, var(--color-border-default));
  border-radius: var(--card-radius, 14px);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--alert-color) 12%, transparent), rgba(255, 255, 255, 0.012)),
    var(--color-bg-card);
  color: color-mix(in srgb, var(--alert-color) 58%, var(--color-text-primary) 42%);
  box-shadow: var(--shadow-sm);
}

.alert-banner--success {
  --alert-color: var(--color-status-success, var(--color-status-online));
}

.alert-banner--warning {
  --alert-color: var(--color-status-warning);
}

.alert-banner--danger {
  --alert-color: var(--color-status-danger, var(--color-status-error));
}

.alert-banner__body {
  min-width: 0;
}

.alert-banner__title {
  display: block;
  font-size: 13px;
}

.alert-banner__message,
.alert-banner__slot {
  margin: 4px 0 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.alert-banner__actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.alert-banner__close { color: inherit; }
</style>
