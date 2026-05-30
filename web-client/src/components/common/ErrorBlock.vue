<template>
  <div class="block">{{ message }}</div>
</template>

<script setup lang="ts">
defineProps<{ message: string }>();
</script>

<style scoped>
.block {
  border: 1px solid rgba(248, 113, 113, 0.3);
  background:
    linear-gradient(180deg, rgba(248, 113, 113, 0.09), rgba(255, 255, 255, 0.02)),
    var(--color-bg-card);
  border-radius: 16px;
  padding: 16px 18px;
  color: #ffc4c4;
  box-shadow: var(--shadow-sm);
}
</style>
