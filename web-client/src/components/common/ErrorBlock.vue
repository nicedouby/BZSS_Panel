<template>
  <div class="block">{{ message }}</div>
</template>

<script setup lang="ts">
defineProps<{ message: string }>();
</script>

<style scoped>
.block {
  border: 1px solid #5d3131;
  background: #211719;
  border-radius: 8px;
  padding: 16px;
  color: #ffb5b5;
}
</style>
