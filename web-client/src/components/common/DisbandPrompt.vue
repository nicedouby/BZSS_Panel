<template>
  <Teleport to="body">
    <div v-if="ui.disbandPrompt.visible" class="dialog-root" v-backdrop-close="cancel">
      <section class="dialog-panel">
        <header class="dialog-head">
          <div>
            <h3>{{ ui.disbandPrompt.title }}</h3>
            <p>目标小队：<strong>{{ ui.disbandPrompt.targetName }}</strong></p>
          </div>
        </header>

        <div class="dialog-body">
          <label class="input-label">解散审计原因</label>
          <textarea
            ref="inputRef"
            v-model="message"
            class="disband-textarea"
            placeholder="请选择下方快捷原因或在此输入自定义原因..."
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
            {{ ui.disbandPrompt.confirmText }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import { useUiStore } from "../../stores/ui.store";

const ui = useUiStore();
const message = ref("");
const inputRef = ref<HTMLTextAreaElement | null>(null);

const hints = [
  "无队长位 / 队长离开",
  "小队名称违规",
  "队长无麦或不建部署点",
  "恶意锁队 / 人数不足",
  "抢夺载具 / 非建队载具",
];

watch(() => ui.disbandPrompt.visible, (visible) => {
  if (visible) {
    message.value = ui.disbandPrompt.defaultMessage;
    nextTick(() => {
      inputRef.value?.focus();
      inputRef.value?.select();
    });
  }
});

function submit() {
  if (!message.value.trim()) return;
  ui.resolveDisbandPrompt(message.value.trim());
}

function cancel() {
  ui.resolveDisbandPrompt(null);
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
  background: var(--theme-overlay-scrim);
  backdrop-filter: blur(4px);
}

.dialog-panel {
  width: min(520px, 100%);
  display: grid;
  gap: 20px;
  border: 1px solid rgba(239, 68, 68, 0.28);
  border-radius: 18px;
  background:
    var(--theme-panel-highlight),
    var(--color-bg-card);
  padding: 22px;
  box-shadow: var(--shadow-lg), 0 0 24px rgba(239, 68, 68, 0.18);
  backdrop-filter: blur(12px);
}

.dialog-head h3 {
  margin: 0;
  font-size: 18px;
  color: var(--color-status-error, #ef4444);
}

.dialog-head p {
  margin: 8px 0 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.dialog-head strong {
  color: var(--color-text-primary);
}

.dialog-body {
  display: grid;
  gap: 10px;
}

.input-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.disband-textarea {
  width: 100%;
  height: 100px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  padding: 12px;
  color: var(--color-text-primary);
  font-size: 14px;
  resize: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.disband-textarea:focus {
  outline: none;
  border-color: rgba(239, 68, 68, 0.5);
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15);
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
  background: color-mix(in srgb, var(--color-bg-elevated) 86%, transparent);
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-full);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.hint-chip:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.28);
  color: var(--color-status-error, #ef4444);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 4px;
}

.cancel-btn {
  padding: 8px 16px;
  background: color-mix(in srgb, var(--color-bg-elevated) 86%, transparent);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-secondary);
  border-radius: 12px;
  cursor: pointer;
}

.submit-btn {
  padding: 8px 24px;
  background: linear-gradient(180deg, rgba(239, 68, 68, 0.96), rgba(239, 68, 68, 0.82));
  border: 1px solid rgba(239, 68, 68, 0.28);
  color: #fff;
  font-weight: 700;
  border-radius: 12px;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
}

.submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.submit-btn:hover:not(:disabled) {
  background: linear-gradient(180deg, rgba(248, 113, 113, 0.98), rgba(239, 68, 68, 0.88));
}
</style>
