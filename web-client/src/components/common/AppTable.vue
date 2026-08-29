<template>
  <div class="app-table-shell" :class="{ compact }">
    <div class="app-table-scroll">
      <table class="app-table">
        <slot />
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  compact?: boolean;
}>(), {
  compact: false,
});
</script>

<style scoped>
.app-table-shell {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: grid;
}

.app-table-scroll {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable both-edges;
}

.app-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
}

:deep(.app-table thead th) {
  position: sticky;
  top: 0;
  z-index: 1;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02)),
    var(--color-bg-card);
  border-bottom: 1px solid var(--color-border-default);
  text-align: left;
  padding: 12px 14px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

:deep(.app-table tbody td) {
  padding: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  vertical-align: top;
  overflow-wrap: anywhere;
}

:deep(.app-table tbody tr:hover td) {
  background: rgba(255, 255, 255, 0.03);
}

.compact :deep(.app-table thead th) {
  padding: 10px 12px;
}

.compact :deep(.app-table tbody td) {
  padding: 12px;
}

@media (max-width: 640px) {
  .app-table-scroll {
    scrollbar-gutter: auto;
  }

  :deep(.app-table thead th),
  :deep(.app-table tbody td),
  .compact :deep(.app-table thead th),
  .compact :deep(.app-table tbody td) {
    padding: 9px 10px;
  }
}
</style>
