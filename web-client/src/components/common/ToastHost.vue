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
  z-index: 90;
  display: grid;
  gap: 10px;
  width: min(360px, calc(100vw - 24px));
}

.toast-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid #2b3540;
  background: rgba(23, 29, 35, 0.96);
  border-radius: 8px;
  padding: 12px 14px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.24);
}

.toast-item[data-tone="ok"] {
  border-color: #3f7158;
}

.toast-item[data-tone="warn"] {
  border-color: #786633;
}

.toast-item[data-tone="error"] {
  border-color: #7a3a3a;
}

.toast-copy {
  display: grid;
  gap: 4px;
}

.toast-copy strong {
  font-size: 13px;
}

.toast-copy span {
  color: #c9d2d8;
  font-size: 12px;
  line-height: 1.4;
}

.close-button {
  padding: 0;
  min-width: 20px;
  min-height: 20px;
  border: 0;
  background: transparent;
  color: #9aa7b2;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.18s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
