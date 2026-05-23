<template>
  <div v-if="ui.warnPrompt.visible" class="dialog-root" @click.self="cancel">
    <section class="dialog-panel">
      <header class="dialog-head">
        <div>
          <h3>{{ ui.warnPrompt.title }}</h3>
          <p>目标：<strong>{{ ui.warnPrompt.targetName }}</strong></p>
        </div>
      </header>

      <div class="dialog-body">
        <label class="input-label">警告消息</label>
        <textarea
          ref="inputRef"
          v-model="message"
          class="warn-textarea"
          placeholder="输入警告内容..."
          @keydown.enter.ctrl="submit"
        ></textarea>
        <div class="quick-hints">
          <span v-for="hint in hints" :key="hint" class="hint-chip" @click="message = hint">
            {{ hint }}
          </span>
        </div>
      </div>

      <footer class="dialog-actions">
        <button type="button" class="cancel-btn" @click="cancel">取消</button>
        <button type="button" class="submit-btn" :disabled="!message.trim()" @click="submit">
          {{ ui.warnPrompt.confirmText }}
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { useUiStore } from "../../stores/ui.store";

const ui = useUiStore();
const message = ref("");
const inputRef = ref<HTMLTextAreaElement | null>(null);

const hints = [
  "请遵守服务器规则",
  "请勿在非建队点建队",
  "请勿在公共频道大声喧哗",
  "请前往己方基地领取载具",
  "请勿在单人开载具",
];

watch(() => ui.warnPrompt.visible, (visible) => {
  if (visible) {
    message.value = ui.warnPrompt.defaultMessage;
    nextTick(() => {
      inputRef.value?.focus();
      inputRef.value?.select();
    });
  }
});

function submit() {
  if (!message.value.trim()) return;
  ui.resolveWarnPrompt(message.value.trim());
}

function cancel() {
  ui.resolveWarnPrompt(null);
}
</script>

<style scoped>
.dialog-root {
  position: fixed;
  inset: 0;
  z-index: var(--z-confirm-dialog);
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(8, 12, 16, 0.85);
  backdrop-filter: blur(4px);
}

.dialog-panel {
  width: min(520px, 100%);
  display: grid;
  gap: 20px;
  border: 1px solid rgba(251, 191, 36, 0.3);
  border-radius: 12px;
  background: #1c1f26;
  padding: 24px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5), 0 0 20px rgba(251, 191, 36, 0.05);
}

.dialog-head h3 {
  margin: 0;
  font-size: 20px;
  color: #fbbf24;
}

.dialog-head p {
  margin: 8px 0 0;
  color: #9aa7b2;
  font-size: 14px;
}

.dialog-head strong {
  color: #fff;
}

.dialog-body {
  display: grid;
  gap: 10px;
}

.input-label {
  font-size: 12px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.warn-textarea {
  width: 100%;
  height: 100px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 12px;
  color: #f1f5f9;
  font-size: 14px;
  resize: none;
  transition: border-color 0.2s;
}

.warn-textarea:focus {
  outline: none;
  border-color: #fbbf24;
}

.quick-hints {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}

.hint-chip {
  font-size: 12px;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-full);
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.2s;
}

.hint-chip:hover {
  background: rgba(251, 191, 36, 0.1);
  border-color: rgba(251, 191, 36, 0.3);
  color: #fbbf24;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 4px;
}

.cancel-btn {
  padding: 8px 16px;
  background: transparent;
  border: 1px solid #334155;
  color: #94a3b8;
  border-radius: 6px;
  cursor: pointer;
}

.submit-btn {
  padding: 8px 24px;
  background: #fbbf24;
  border: none;
  color: #000;
  font-weight: 700;
  border-radius: 6px;
  cursor: pointer;
}

.submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.submit-btn:hover:not(:disabled) {
  background: #fcd34d;
}
</style>
