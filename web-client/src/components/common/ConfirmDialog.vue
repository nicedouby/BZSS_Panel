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
          <AppButton variant="ghost" @click="ui.confirmCancel()">{{ ui.confirm.cancelText }}</AppButton>
          <AppButton :variant="confirmVariant" @click="ui.confirmAccept()">
            {{ ui.confirm.confirmText }}
          </AppButton>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from "vue";
import AppButton, { type ButtonVariant } from "../ui/AppButton.vue";
import { useUiStore } from "../../stores/ui.store";

const ui = useUiStore();
const confirmVariant = computed<ButtonVariant>(() => ui.confirm.tone === "error" ? "danger" : ui.confirm.tone === "warn" ? "warning" : "primary");
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

.dialog-actions :deep(.app-button) {
  min-width: 92px;
}

</style>
