<template>
  <Teleport to="body">
    <div v-if="ui.confirm.visible" class="dialog-root" v-backdrop-close="ui.confirmCancel">
      <section class="dialog-panel">
        <header class="dialog-head">
          <div>
            <h3>{{ ui.confirm.title }}</h3>
            <p>{{ ui.confirm.message }}</p>
          </div>
        </header>

        <footer class="dialog-actions">
          <button type="button" @click="ui.confirmCancel()">{{ ui.confirm.cancelText }}</button>
          <button type="button" class="danger-button" :data-tone="ui.confirm.tone" @click="ui.confirmAccept()">
            {{ ui.confirm.confirmText }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useUiStore } from "../../stores/ui.store";

const ui = useUiStore();
</script>

<style scoped>
.dialog-root {
  position: fixed;
  inset: 0;
  z-index: var(--z-confirm-dialog);
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--theme-overlay-scrim);
  backdrop-filter: blur(4px);
}

.dialog-panel {
  width: min(460px, 100%);
  display: grid;
  gap: 18px;
  border: 1px solid var(--color-border-default);
  border-radius: 18px;
  background:
    var(--theme-panel-highlight),
    var(--color-bg-card);
  padding: 20px;
  box-shadow: var(--shadow-lg), var(--theme-panel-glow);
  backdrop-filter: blur(12px);
}

.dialog-head h3 {
  margin: 0;
  font-size: 18px;
  line-height: 1.2;
}

.dialog-head p {
  margin: 8px 0 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.dialog-actions button {
  min-width: 92px;
}

.danger-button[data-tone="error"],
.danger-button[data-tone="warn"] {
  border-color: rgba(248, 113, 113, 0.3);
  background: linear-gradient(180deg, rgba(248, 113, 113, 0.14), rgba(248, 113, 113, 0.08));
  color: color-mix(in srgb, var(--color-status-error) 38%, white 62%);
}

.danger-button[data-tone="idle"] {
  border-color: rgba(122, 162, 184, 0.24);
}
</style>
