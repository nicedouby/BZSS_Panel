<template>
  <div
    class="workspace-toolbar"
    :class="{
      'workspace-toolbar--compact': compact,
      'workspace-toolbar--bordered': bordered,
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
}>(), {
  compact: true,
  bordered: true,
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

.workspace-toolbar__main,
.workspace-toolbar__actions {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.workspace-toolbar__actions {
  justify-content: flex-end;
  margin-left: auto;
}
</style>
