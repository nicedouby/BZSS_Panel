<template>
  <div class="rcon-input-group">
    <input
      v-model="command"
      type="text"
      class="rcon-input"
      :placeholder="t('console.rconCommandPlaceholder')"
      :disabled="executing"
      @keydown.enter="execute"
    />
    <button
      type="button"
      class="rcon-button"
      :disabled="executing || !command.trim()"
      @click="execute"
    >
      {{ executing ? t("console.rconExecuting") : t("console.rconExecute") }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { apiPost } from "../../app/apiClient";
import { useUiStore } from "../../stores/ui.store";
import { t } from "../../i18n";

const ui = useUiStore();
const command = ref("");
const executing = ref(false);

async function execute() {
  const cmd = command.value.trim();
  if (!cmd || executing.value) return;

  executing.value = true;
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
  }
}
</script>

<style scoped>
.rcon-input-group {
  display: flex;
  gap: 8px;
  background: #151a20;
  border: 1px solid #2c343d;
  border-radius: 8px;
  padding: 8px;
  margin-bottom: 16px;
}

.rcon-input {
  flex: 1;
  background: transparent;
  border: 1px solid #38414c;
  color: #edf2f4;
  padding: 8px 12px;
  border-radius: 6px;
  font-family: inherit;
  outline: none;
}

.rcon-input:focus {
  border-color: #7aa2b8;
}

.rcon-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.rcon-button {
  background: #1d252d;
  border: 1px solid #38414c;
  color: #f4f7f8;
  padding: 8px 20px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.rcon-button:hover:not(:disabled) {
  border-color: #7aa2b8;
  background: #252f38;
}

.rcon-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
