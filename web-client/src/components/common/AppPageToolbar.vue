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

.app-page-toolbar > * {
  min-width: 0;
}

@media (max-width: 640px) {
  .app-page-toolbar {
    align-items: stretch;
  }

  .app-page-toolbar > * {
    flex: 1 1 100%;
  }
}
</style>
