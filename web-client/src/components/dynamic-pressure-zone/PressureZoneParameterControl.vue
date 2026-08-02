<template>
  <label class="parameter-control">
    <span class="parameter-control__copy">
      <span class="parameter-control__label">{{ label }}</span>
      <span class="parameter-control__description">{{ description }}</span>
    </span>
    <span class="parameter-control__inputs">
      <input
        class="parameter-control__range"
        type="range"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        @input="updateValue"
      />
      <span class="parameter-control__number-wrap">
        <input
          class="parameter-control__number"
          type="number"
          :min="min"
          :max="max"
          :step="step"
          :value="modelValue"
          @input="updateValue"
        />
        <span v-if="unit">{{ unit }}</span>
      </span>
    </span>
  </label>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: number;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}>();

const emit = defineEmits<{ (event: "update:modelValue", value: number): void }>();

function updateValue(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value)) emit("update:modelValue", value);
}
</script>

<style scoped>
.parameter-control {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(200px, 1.2fr);
  align-items: center;
  gap: 16px;
  min-height: 64px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(148, 163, 184, .12);
}
.parameter-control:last-child { border-bottom: 0; }
.parameter-control__copy { display: flex; flex-direction: column; gap: 3px; }
.parameter-control__label { color: #e7eef8; font-size: 13px; font-weight: 700; line-height: 1.3; }
.parameter-control__description { color: #7f95aa; font-size: 11px; line-height: 1.4; }
.parameter-control__inputs { display: grid; grid-template-columns: minmax(80px, 1fr) 100px; align-items: center; gap: 10px; }
.parameter-control__range { width: 100%; accent-color: #2dd4bf; cursor: pointer; }
.parameter-control__number-wrap { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding-right: 6px; border: 1px solid rgba(148, 163, 184, .28); border-radius: 8px; background: rgba(4, 12, 22, .82); color: #7890a7; font: 10px ui-monospace, monospace; }
.parameter-control__number { width: 100%; min-width: 0; padding: 6px 6px 6px 8px; border: 0; outline: 0; background: transparent; color: #e2e8f0; font: 12px ui-monospace, monospace; text-align: right; }
@media (max-width: 640px) {
  .parameter-control { grid-template-columns: 1fr; gap: 8px; }
  .parameter-control__inputs { grid-template-columns: minmax(80px, 1fr) 96px; }
}
</style>
