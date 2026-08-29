<template>
  <div
    class="workspace-toolbar"
    :class="{
      'workspace-toolbar--compact': compact,
      'workspace-toolbar--bordered': bordered,
      'workspace-toolbar--sticky': sticky,
      'workspace-toolbar--wrap': wrap,
    }"
  >
    <div class="workspace-toolbar__main">
      <slot />
    </div>

    <div v-if="$slots.actions" class="workspace-toolbar__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  compact?: boolean;
  bordered?: boolean;
  sticky?: boolean;
  wrap?: boolean;
}>(), {
  compact: true,
  bordered: true,
  sticky: false,
  wrap: true,
});
</script>

<style scoped>
.workspace-toolbar {
  min-height: 44px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  border-radius: 10px;
  background:
    var(--theme-panel-highlight),
    color-mix(in srgb, var(--color-bg-card) 90%, transparent);
}

.workspace-toolbar--compact {
  min-height: 40px;
  padding-block: 5px;
}

.workspace-toolbar--bordered {
  border: 1px solid var(--color-border-soft);
}

.workspace-toolbar--sticky {
  position: sticky;
  top: 0;
  z-index: 2;
}

.workspace-toolbar__main,
.workspace-toolbar__actions {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
}

.workspace-toolbar--wrap .workspace-toolbar__main,
.workspace-toolbar--wrap .workspace-toolbar__actions {
  flex-wrap: wrap;
}

.workspace-toolbar__actions {
  justify-content: flex-end;
  margin-left: auto;
}

.workspace-toolbar__main > *,
.workspace-toolbar__actions > * {
  min-width: 0;
}

@media (max-width: 640px) {
  .workspace-toolbar {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
    padding: 8px 10px;
  }

  .workspace-toolbar__main,
  .workspace-toolbar__actions {
    width: 100%;
    justify-content: flex-start;
    margin-left: 0;
  }
}
</style>
