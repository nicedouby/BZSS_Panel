<template>
  <div class="copyable-value">
    <span class="label">{{ label }}</span>
    <span class="value" :title="value || emptyText">
      {{ hasValue ? displayValue : emptyText }}
    </span>
    <button
      v-if="hasValue"
      type="button"
      :disabled="copying"
      class="copy-button"
      @click="copy"
      :title="copying ? 'Copied!' : 'Copy'"
    >
      {{ copying ? 'Copied' : 'Copy' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useUiStore } from "../../stores/ui.store";
import { copyTextWithToast } from "../../utils/clipboard";

const props = withDefaults(
  defineProps<{
    label: string;
    value: string | null | undefined;
    truncate?: number;
    emptyText?: string;
  }>(),
  {
    truncate: 0,
    emptyText: "Unknown",
  },
);

const ui = useUiStore();
const copying = ref(false);

const hasValue = computed(() => Boolean(props.value?.trim()));

const displayValue = computed(() => {
  if (!props.value) return "Unknown";
  if (!props.truncate || props.value.length <= props.truncate) {
    return props.value;
  }
  const half = Math.floor(props.truncate / 2);
  return `${props.value.substring(0, half)}...${props.value.substring(props.value.length - half)}`;
});

async function copy() {
  if (!props.value) return;
  try {
    copying.value = true;
    await copyTextWithToast(props.value, ui, {
      label: `${props.label} copied`,
      successMessage: props.value,
    });
  } finally {
    copying.value = false;
  }
}
</script>

<style scoped>
.copyable-value {
  display: grid;
  grid-template-columns: 100px 1fr auto;
  gap: var(--spacing-md);
  align-items: center;
  padding: var(--spacing-sm) 0;
  border-bottom: 1px solid var(--color-border-soft);
  min-height: 36px;
}

.label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-weight: 500;
}

.value {
  font-size: var(--font-size-base);
  color: var(--color-text-primary);
  font-family: "Courier New", monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.no-value {
  font-size: var(--font-size-base);
  color: var(--color-text-muted);
}

.copy-button {
  padding: 4px 10px;
  background: transparent;
  border: 1px solid var(--color-status-info);
  color: var(--color-status-info);
  font-size: var(--font-size-xs);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
  font-weight: 600;
}

.copy-button:hover:not(:disabled) {
  background: rgba(96, 165, 250, 0.1);
  border-color: var(--color-status-info);
}

.copy-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@media (max-width: 640px) {
  .copyable-value {
    grid-template-columns: 1fr;
    gap: var(--spacing-sm);
  }

  .label {
    font-size: var(--font-size-xs);
  }
}
</style>
