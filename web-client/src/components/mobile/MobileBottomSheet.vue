<template>
  <Teleport to="body">
    <div v-if="open" class="mobile-bottom-sheet">
      <AppButton class="mobile-bottom-sheet__backdrop" variant="ghost" aria-label="Close" @click="$emit('close')" />
      <section class="mobile-bottom-sheet__panel" :aria-label="title || 'Bottom sheet'">
        <header class="mobile-bottom-sheet__header">
          <div>
            <h3 v-if="title">{{ title }}</h3>
            <p v-if="description">{{ description }}</p>
          </div>
          <AppButton variant="ghost" class="mobile-bottom-sheet__close" @click="$emit('close')">Close</AppButton>
        </header>
        <div class="mobile-bottom-sheet__content">
          <slot />
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import AppButton from "../ui/AppButton.vue";
defineProps<{
  open: boolean;
  title?: string;
  description?: string;
}>();

defineEmits<{
  (event: "close"): void;
}>();
</script>

<style scoped>
.mobile-bottom-sheet {
  position: fixed;
  inset: 0;
  z-index: var(--z-bottom-sheet);
}

.mobile-bottom-sheet__backdrop {
  position: absolute;
  inset: 0;
  border: 0;
  background: rgba(5, 8, 12, 0.7);
  backdrop-filter: blur(4px);
}

.mobile-bottom-sheet__panel {
  position: absolute;
  left: var(--safe-left);
  right: var(--safe-right);
  bottom: 0;
  max-height: min(calc(var(--app-viewport-height) - var(--safe-top) - 8px), 720px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border-radius: 22px 22px 0 0;
  border: 1px solid var(--color-border-default);
  border-bottom: 0;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.02)), rgba(255, 255, 255, 0.004)),
    var(--color-bg-card);
  box-shadow: 0 -22px 48px rgba(0, 0, 0, 0.38);
  padding-bottom: var(--safe-bottom);
}

.mobile-bottom-sheet__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--color-border-soft);
}

.mobile-bottom-sheet__header h3 {
  margin: 0;
  font-size: 16px;
}

.mobile-bottom-sheet__header p {
  margin: 4px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.mobile-bottom-sheet__close {
  min-width: var(--touch-target-min);
  min-height: var(--touch-target-min);
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.mobile-bottom-sheet__content {
  min-height: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
  padding: 14px 16px 16px;
}

@media (orientation: landscape) and (max-height: 520px) {
  .mobile-bottom-sheet__panel {
    left: max(var(--safe-left), 12px);
    right: max(var(--safe-right), 12px);
    bottom: max(var(--safe-bottom), 8px);
    max-height: calc(var(--app-viewport-height) - var(--safe-top) - var(--safe-bottom) - 16px);
    border-radius: 16px;
    border-bottom: 1px solid var(--color-border-default);
    padding-bottom: 0;
  }

  .mobile-bottom-sheet__header {
    padding: 10px 12px 8px;
  }

  .mobile-bottom-sheet__header h3 {
    font-size: 14px;
  }

  .mobile-bottom-sheet__header p {
    font-size: 11px;
  }

  .mobile-bottom-sheet__close {
    border-radius: 9px;
  }

  .mobile-bottom-sheet__content {
    padding: 10px 12px 12px;
  }
}
</style>
