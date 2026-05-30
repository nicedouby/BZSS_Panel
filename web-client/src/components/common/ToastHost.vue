<template>
  <div class="toast-host">
    <TransitionGroup name="toast">
      <article v-for="toast in ui.toasts" :key="toast.id" class="toast-item" :data-tone="toast.tone">
        <div class="toast-copy">
          <strong v-if="toast.title">{{ toast.title }}</strong>
          <span>{{ toast.message }}</span>
        </div>
        <button type="button" class="close-button" @click="ui.dismissToast(toast.id)">x</button>
      </article>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { useUiStore } from "../../stores/ui.store";

const ui = useUiStore();
</script>

<style scoped>
.toast-host {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: var(--z-toast);
  display: grid;
  gap: 10px;
  width: min(360px, calc(100vw - 24px));
}

.toast-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.02)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-card);
  border-radius: 16px;
  padding: 13px 14px;
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(12px);
}

.toast-item[data-tone="ok"] {
  border-color: rgba(52, 211, 153, 0.28);
}

.toast-item[data-tone="warn"] {
  border-color: rgba(245, 158, 11, 0.28);
}

.toast-item[data-tone="error"] {
  border-color: rgba(248, 113, 113, 0.28);
}

.toast-copy {
  display: grid;
  gap: 4px;
}

.toast-copy strong {
  font-size: 13px;
  line-height: 1.25;
}

.toast-copy span {
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.4;
}

.close-button {
  padding: 0;
  min-width: 28px;
  min-height: 28px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-muted);
  box-shadow: none;
}

.close-button:hover {
  border-color: var(--color-border-default);
  background: rgba(255, 255, 255, 0.04);
  transform: none;
}

.toast-enter-active,
.toast-leave-active {
  transition: transform 0.18s ease, opacity 0.18s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
