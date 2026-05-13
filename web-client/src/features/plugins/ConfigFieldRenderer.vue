<template>
  <div class="config-field">
    <label class="config-label">
      {{ field.label }}
      <span v-if="field.required" class="required-mark">*</span>
    </label>

    <template v-if="field.type === 'string'">
      <input
        class="config-input"
        :value="displayValue"
        @input="onStringInput"
      >
    </template>

    <template v-else-if="field.type === 'number'">
      <input
        class="config-input"
        type="number"
        :value="displayValue"
        @input="onNumberInput"
      >
    </template>

    <template v-else-if="field.type === 'boolean'">
      <label class="config-switch-row">
        <input
          type="checkbox"
          :checked="Boolean(modelValue)"
          @change="onBooleanInput"
        >
        <span>{{ Boolean(modelValue) ? "已开启" : "已关闭" }}</span>
      </label>
    </template>

    <template v-else-if="field.type === 'select'">
      <select
        class="config-input"
        :value="displayValue"
        @change="onSelectInput"
      >
        <option v-if="!field.options?.length" value="">
          请选择
        </option>
        <option
          v-for="option in field.options ?? []"
          :key="String(option.value)"
          :value="String(option.value)"
        >
          {{ option.label }}
        </option>
      </select>
    </template>

    <template v-else>
      <textarea
        class="config-textarea"
        :value="displayValue"
        @input="onStringInput"
      />
    </template>

    <p v-if="field.description" class="config-description">
      {{ field.description }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PluginConfigField } from "./plugin.types";

const props = defineProps<{
  field: PluginConfigField;
  modelValue: unknown;
}>();

const emit = defineEmits<{
  (event: "update:modelValue", value: unknown): void;
}>();

const displayValue = computed(() => {
  if (props.modelValue === undefined || props.modelValue === null) {
    return "";
  }
  return props.modelValue;
});

function onStringInput(event: Event) {
  const input = event.target as HTMLInputElement | HTMLTextAreaElement;
  emit("update:modelValue", input.value);
}

function onNumberInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const raw = input.value;
  if (raw === "") {
    emit("update:modelValue", "");
    return;
  }

  const parsed = Number(raw);
  emit("update:modelValue", Number.isFinite(parsed) ? parsed : raw);
}

function onBooleanInput(event: Event) {
  const input = event.target as HTMLInputElement;
  emit("update:modelValue", input.checked);
}

function onSelectInput(event: Event) {
  const input = event.target as HTMLSelectElement;
  const selected = props.field.options?.find((option) => String(option.value) === input.value);
  emit("update:modelValue", selected?.value ?? input.value);
}
</script>
