<template>
  <div class="sticky-action-bar">
    <div v-if="$slots.summary" class="sticky-action-bar__summary">
      <slot name="summary" />
    </div>
    <div class="sticky-action-bar__actions">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.sticky-action-bar {
  position: sticky;
  bottom: 0;
  z-index: var(--z-sticky-action);
  display: grid;
  gap: 10px;
  padding: 10px 12px calc(10px + var(--safe-bottom));
  border-top: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(9, 14, 21, 0.1), rgba(9, 14, 21, 0.88) 25%),
    color-mix(in srgb, var(--color-bg-card) 96%, transparent);
  backdrop-filter: blur(12px);
}

.sticky-action-bar__summary {
  min-width: 0;
}

.sticky-action-bar__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

:deep(.sticky-action-bar__actions > *) {
  min-height: var(--touch-target-min);
}

@media (orientation: landscape) and (max-height: 520px) {
  .sticky-action-bar {
    gap: 6px;
    padding: 6px 10px calc(6px + var(--safe-bottom));
  }

  .sticky-action-bar__actions {
    gap: 6px;
  }
}
</style>
