<template>
  <div class="responsive-data-table" :class="{ mobile: mobile }">
    <slot v-if="!mobile" name="table" />
    <slot v-else name="cards" />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  mobile: boolean;
}>();
</script>

<style scoped>
.responsive-data-table {
  min-width: 0;
}
</style>
