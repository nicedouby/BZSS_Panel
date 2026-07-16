<template>
  <Teleport to="body">
    <div v-if="ui.warnPrompt.visible" class="dialog-root" v-backdrop-close="cancel">
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
            <StatusBadge v-for="hint in hints" :key="hint" tone="warning" interactive @click="message = hint">
              {{ hint }}
            </StatusBadge>
          </div>
        </div>

        <footer class="dialog-actions">
          <AppButton variant="ghost" @click="cancel">取消</AppButton>
          <AppButton variant="warning" :disabled="!message.trim()" @click="submit">
            {{ ui.warnPrompt.confirmText }}
          </AppButton>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import AppButton from "../ui/AppButton.vue";
import StatusBadge from "../ui/StatusBadge.vue";
import { useUiStore } from "../../stores/ui.store";

const ui = useUiStore();
const message = ref("");
const inputRef = ref<HTMLTextAreaElement | null>(null);

const hints = [
  "请遵守服务器规则",
  "请勿在非建队点建队",
  "请勿在公共频道大声喧哗",
  "请前往己方基地领取载具",
  "请勿单人开载具",
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
  background: var(--theme-overlay-scrim);
  backdrop-filter: blur(4px);
}

.dialog-panel {
  width: min(520px, 100%);
  display: grid;
  gap: 20px;
  border: 1px solid rgba(251, 191, 36, 0.24);
  border-radius: 18px;
  background:
    var(--theme-panel-highlight),
    var(--color-bg-card);
  padding: 22px;
  box-shadow: var(--shadow-lg), 0 0 24px var(--theme-warn-glow);
  backdrop-filter: blur(12px);
}

.dialog-head h3 {
  margin: 0;
  font-size: 18px;
  color: #fbbf24;
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

.warn-textarea {
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

.warn-textarea:focus {
  outline: none;
  border-color: rgba(251, 191, 36, 0.5);
  box-shadow: var(--theme-field-glow);
}

.quick-hints {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}


.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 4px;
}

</style>
