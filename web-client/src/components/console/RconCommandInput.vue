<template>
  <div class="rcon-card">
    <div class="rcon-header">
      <div>
        <div class="rcon-title">RCON</div>
        <div class="rcon-subtitle">{{ t("console.rconCommandPlaceholder") }}</div>
      </div>
    </div>
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
    const result = await apiPost<{ success?: boolean; ok?: boolean; response: string }>("/api/console/rcon", {
      command: cmd,
    });

    const success = Boolean(result?.success ?? result?.ok);
    if (success) {
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
.rcon-card {
  display: grid;
  gap: 10px;
}

.rcon-header {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 12px;
}

.rcon-title {
  color: #e6edf3;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.rcon-subtitle {
  color: #7d8894;
  font-size: 11px;
  margin-top: 2px;
}

.rcon-input-group {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(13, 17, 23, 0.96);
  border: 1px solid rgba(95, 111, 128, 0.28);
  border-radius: 14px;
  padding: 8px 10px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.rcon-input-group:focus-within {
  border-color: #58a6ff;
  box-shadow: 0 0 0 3px rgba(31, 111, 235, 0.3);
}

.input-prefix {
  color: #58a6ff;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-weight: bold;
  user-select: none;
}

.rcon-input {
  flex: 1;
  background: transparent;
  border: none;
  color: #e6edf3;
  padding: 8px 0;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 14px;
  outline: none;
}

.rcon-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.rcon-button {
  background: #238636;
  border: 1px solid rgba(240, 246, 252, 0.1);
  color: #ffffff;
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}

.rcon-button:hover:not(:disabled) {
  background: #2ea043;
}

.rcon-button:disabled {
  background: #21262d;
  color: #8b949e;
  border-color: #30363d;
  cursor: not-allowed;
}

.spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
