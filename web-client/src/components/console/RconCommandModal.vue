<template>
  <div v-if="open" class="modal-root" @click.self="emit('close')">
    <section class="modal-panel">
      <header class="modal-head">
        <h3>{{ t("console.rconExecute") }}</h3>
        <button type="button" class="close-button" @click="emit('close')">✕</button>
      </header>

      <div class="modal-body">
        <div class="rcon-input-group">
          <input
            v-model="command"
            type="text"
            class="rcon-input"
            :placeholder="t('console.rconCommandPlaceholder')"
            :disabled="executing"
            @keydown.enter="execute"
            @keydown.up.prevent="historyUp"
            @keydown.down.prevent="historyDown"
          />
        </div>
        <div v-if="lastResponse" class="rcon-response">
          <pre>{{ lastResponse }}</pre>
        </div>
      </div>

      <footer class="modal-actions">
        <button type="button" :disabled="executing" @click="emit('close')">
          {{ t("common.close") }}
        </button>
        <button
          type="button"
          class="primary-button"
          :disabled="executing || !command.trim()"
          @click="execute"
        >
          {{ executing ? t("console.rconExecuting") : t("console.rconExecute") }}
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { apiPost } from "../../app/apiClient";
import { useUiStore } from "../../stores/ui.store";
import { t } from "../../i18n";

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (event: "close"): void;
}>();

const ui = useUiStore();
const command = ref("");
const executing = ref(false);
const lastResponse = ref("");

const history = ref<string[]>(JSON.parse(localStorage.getItem("rcon_history") || "[]"));
const historyIndex = ref(-1);

async function execute() {
  const cmd = command.value.trim();
  if (!cmd || executing.value) return;

  executing.value = true;
  lastResponse.value = "";

  // Add to history
  if (history.value[0] !== cmd) {
    history.value.unshift(cmd);
    if (history.value.length > 50) history.value.pop();
    localStorage.setItem("rcon_history", JSON.stringify(history.value));
  }
  historyIndex.value = -1;

  try {
    const result = await apiPost<{ ok: true; response: string }>("/api/console/rcon", {
      command: cmd,
    });
    
    if (result.ok) {
      ui.pushToast({ message: t("console.rconExecuted"), tone: "ok" });
      lastResponse.value = result.response || "Command executed (no output).";
      // We don't clear the command immediately in case the user wants to tweak it
    } else {
      ui.pushToast({ message: t("console.rconFailed"), tone: "warn" });
    }
  } catch (error) {
    ui.pushToast({
      message: error instanceof Error ? error.message : t("console.rconFailed"),
      tone: "error"
    });
  } finally {
    executing.value = false;
  }
}

function historyUp() {
  if (historyIndex.value < history.value.length - 1) {
    historyIndex.value++;
    command.value = history.value[historyIndex.value];
  }
}

function historyDown() {
  if (historyIndex.value > 0) {
    historyIndex.value--;
    command.value = history.value[historyIndex.value];
  } else if (historyIndex.value === 0) {
    historyIndex.value = -1;
    command.value = "";
  }
}
</script>

<style scoped>
.modal-root {
  position: fixed;
  inset: 0;
  z-index: var(--z-confirm-dialog); /* Reuse or define a specific z-index */
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(8, 12, 16, 0.72);
}

.modal-panel {
  width: min(600px, 100%);
  display: grid;
  gap: 18px;
  border: 1px solid #2b3540;
  border-radius: 12px;
  background: #171d23;
  padding: 24px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
}

.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-head h3 {
  margin: 0;
  font-size: 18px;
  color: #edf2f4;
}

.close-button {
  background: transparent;
  border: none;
  color: #9aa7b2;
  font-size: 18px;
  cursor: pointer;
}

.modal-body {
  display: grid;
  gap: 16px;
}

.rcon-input-group {
  display: flex;
  background: #151a20;
  border: 1px solid #2c343d;
  border-radius: 8px;
  padding: 4px;
}

.rcon-input {
  flex: 1;
  background: transparent;
  border: none;
  color: #edf2f4;
  padding: 12px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 14px;
  outline: none;
}

.rcon-response {
  background: #0d1117;
  border: 1px solid #21262d;
  border-radius: 8px;
  padding: 12px;
  max-height: 200px;
  overflow-y: auto;
}

.rcon-response pre {
  margin: 0;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 13px;
  color: #d1d5da;
  white-space: pre-wrap;
  word-break: break-all;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.primary-button {
  background: #238636;
  color: #ffffff;
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}

.primary-button:hover:not(:disabled) {
  background: #2ea043;
}

.primary-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button:not(.primary-button):not(.close-button) {
  background: #21262d;
  color: #c9d1d9;
  border: 1px solid #30363d;
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
}

button:not(.primary-button):not(.close-button):hover:not(:disabled) {
  background: #30363d;
  border-color: #8b949e;
}
</style>
