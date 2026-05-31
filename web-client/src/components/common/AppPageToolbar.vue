<template>
  <div class="app-page-toolbar">
    <slot />
  </div>
</template>

<style scoped>
.app-page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  min-width: 0;
}
</style>
