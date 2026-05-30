<template>
  <div class="rcon-input-group">
    <div class="input-prefix">></div>
    <input
      ref="inputRef"
      v-model="command"
      type="text"
      class="rcon-input"
      :placeholder="t('console.rconCommandPlaceholder')"
      :disabled="executing"
      @keydown.enter="execute"
      @keydown.up.prevent="historyUp"
      @keydown.down.prevent="historyDown"
    />
    <button
      type="button"
      class="rcon-button"
      :disabled="executing || !command.trim()"
      @click="execute"
    >
      <span v-if="executing" class="spinner"></span>
      {{ executing ? t("console.rconExecuting") : t("console.rconExecute") }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { apiPost } from "../../app/apiClient";
import { useUiStore } from "../../stores/ui.store";
import { t } from "../../i18n";

const ui = useUiStore();
const command = ref("");
const executing = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);

const history = ref<string[]>(JSON.parse(localStorage.getItem("rcon_history") || "[]"));
const historyIndex = ref(-1);

onMounted(() => {
  inputRef.value?.focus();
});

async function execute() {
  const cmd = command.value.trim();
  if (!cmd || executing.value) return;

  executing.value = true;
  
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
      command.value = "";
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
    inputRef.value?.focus();
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
.rcon-input-group {
  display: flex;
  align-items: center;
  gap: 12px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.016)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: 16px;
  padding: 8px 10px;
  box-shadow: var(--shadow-md);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.rcon-input-group:focus-within {
  border-color: var(--color-border-highlight);
  box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.14), var(--shadow-md);
}

.input-prefix {
  color: var(--color-status-info);
  font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
  font-weight: bold;
  user-select: none;
}

.rcon-input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--color-text-primary);
  padding: 8px 0;
  font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
  font-size: 14px;
  outline: none;
}

.rcon-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.rcon-button {
  background: linear-gradient(180deg, rgba(52, 211, 153, 0.96), rgba(34, 197, 94, 0.82));
  border: 1px solid rgba(52, 211, 153, 0.24);
  color: #04110a;
  padding: 8px 16px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: var(--shadow-sm);
}

.rcon-button:hover:not(:disabled) {
  background: linear-gradient(180deg, rgba(74, 222, 128, 0.98), rgba(52, 211, 153, 0.88));
}

.rcon-button:disabled {
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-muted);
  border-color: var(--color-border-default);
  cursor: not-allowed;
}

.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #04110a;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
