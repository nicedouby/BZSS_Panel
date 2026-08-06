<template>
  <PageCard class="simple-plugin-power-card" :tone="enabled ? 'info' : 'warning'" compact>
    <div class="simple-plugin-power-card__layout">
      <div class="simple-plugin-power-card__copy">
        <div class="simple-plugin-power-card__label-row">
          <span class="simple-plugin-power-card__label">{{ label }}</span>
          <StatusBadge :tone="enabled ? 'success' : 'neutral'" size="sm" dot>
            {{ enabled ? enabledText : disabledText }}
          </StatusBadge>
        </div>
        <strong class="simple-plugin-power-card__title">{{ title }}</strong>
        <p v-if="description" class="simple-plugin-power-card__description">{{ description }}</p>
      </div>

      <AppButton
        :variant="enabled ? 'danger' : 'primary'"
        :loading="loading"
        :disabled="disabled"
        @click="$emit('toggle')"
      >
        {{ enabled ? disableActionLabel : enableActionLabel }}
      </AppButton>
    </div>
  </PageCard>
</template>

<script setup lang="ts">
import PageCard from "../common/PageCard.vue";
import AppButton from "../ui/AppButton.vue";
import StatusBadge from "../ui/StatusBadge.vue";

withDefaults(defineProps<{
  enabled: boolean;
  title: string;
  description?: string;
  label?: string;
  enabledText?: string;
  disabledText?: string;
  enableActionLabel?: string;
  disableActionLabel?: string;
  loading?: boolean;
  disabled?: boolean;
}>(), {
  description: "",
  label: "功能状态",
  enabledText: "运行中",
  disabledText: "已关闭",
  enableActionLabel: "启用功能",
  disableActionLabel: "关闭功能",
  loading: false,
  disabled: false,
});

defineEmits<{
  toggle: [];
}>();
</script>

<style scoped>
.simple-plugin-power-card {
  min-width: 0;
}

.simple-plugin-power-card__layout {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.simple-plugin-power-card__copy {
  min-width: 0;
}

.simple-plugin-power-card__label-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.simple-plugin-power-card__label {
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.simple-plugin-power-card__title {
  display: block;
  margin-top: 10px;
  font-size: clamp(19px, 1.7vw, 24px);
  line-height: 1.2;
}

.simple-plugin-power-card__description {
  margin: 7px 0 0;
  max-width: 78ch;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.55;
}

@media (max-width: 720px) {
  .simple-plugin-power-card__layout {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
