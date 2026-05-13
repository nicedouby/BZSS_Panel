<template>
  <div v-if="ui.confirm.visible" class="dialog-root" @click.self="ui.confirmCancel()">
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
  background: rgba(8, 12, 16, 0.72);
}

.dialog-panel {
  width: min(460px, 100%);
  display: grid;
  gap: 18px;
  border: 1px solid #2b3540;
  border-radius: 8px;
  background: #171d23;
  padding: 18px;
}

.dialog-head h3 {
  margin: 0;
  font-size: 18px;
}

.dialog-head p {
  margin: 8px 0 0;
  color: #9aa7b2;
  font-size: 13px;
  line-height: 1.5;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.danger-button[data-tone="error"],
.danger-button[data-tone="warn"] {
  border-color: #7a3a3a;
  background: #312024;
}
</style>
