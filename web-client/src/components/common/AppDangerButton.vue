<template>
  <AppButton :variant="resolvedVariant" :disabled="disabled">
    <slot />
  </AppButton>
</template>

<script setup lang="ts">
import { computed } from "vue";
import AppButton, { type ButtonVariant } from "../ui/AppButton.vue";

const props = withDefaults(defineProps<{
  tone?: "danger" | "warn" | "neutral";
  variant?: "solid" | "outline" | "ghost";
  disabled?: boolean;
}>(), {
  tone: "danger",
  variant: "solid",
  disabled: false,
});

const resolvedVariant = computed<ButtonVariant>(() => {
  if (props.variant === "ghost") return "ghost";
  if (props.variant === "outline") return "soft";
  if (props.tone === "danger") return "danger";
  if (props.tone === "warn") return "warning";
  return "default";
});
</script>
