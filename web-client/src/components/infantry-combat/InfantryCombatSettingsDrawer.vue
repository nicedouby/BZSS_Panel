<template>
  <transition name="slide">
    <div v-if="open" class="drawer-overlay" v-backdrop-close="() => emit('update:open', false)">
      <aside class="drawer">
        <header class="drawer-head">
          <div>
            <p class="kicker">设置</p>
            <h2>步兵战斗增强</h2>
            <p>这里只放当前真正影响提醒决策的开关，避免把受害者提醒的内部字段误暴露给前端。</p>
          </div>
          <button type="button" class="close-button" @click="emit('update:open', false)">关闭</button>
        </header>

        <section class="drawer-section">
          <h3>基础</h3>
          <label class="toggle-row">
            <span>
              <strong>启用模块</strong>
              <small>关闭后不再处理新的 processed 事件</small>
            </span>
            <input v-model="draft.enabled" type="checkbox">
          </label>

          <label class="toggle-row">
            <span>
              <strong>显示攻击者伤害</strong>
              <small>攻击者提醒是否允许发送伤害提示</small>
            </span>
            <input v-model="draft.showAttackerDamage" type="checkbox">
          </label>

          <label class="field">
            <span>最低攻击者伤害阈值</span>
            <input v-model.number="draft.minAttackerDamage" type="number" min="0" step="1">
          </label>

          <label class="field">
            <span>战斗提醒缓存(ms)</span>
            <input v-model.number="draft.damageDebounceMs" type="number" min="0" step="1">
          </label>
        </section>

        <section class="drawer-section">
          <h3>提醒内容</h3>

          <div class="note">
            受害者提醒在当前产品规则中始终可见，因此这里不提供 showVictimDamage / showVictimWound / showVictimKill 的前端入口。
          </div>
        </section>

        <section class="drawer-section">
          <h3>缓存</h3>
          <label class="field">
            <span>最近事件缓存数量</span>
            <input v-model.number="draft.storeRecentEventLimit" type="number" min="1" step="1">
          </label>
        </section>

        <footer class="drawer-actions">
          <button type="button" class="secondary" @click="resetDraft">恢复当前配置</button>
          <button type="button" class="primary" :disabled="saving" @click="save">保存设置</button>
        </footer>
      </aside>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { reactive, watch } from "vue";
import type { InfantryCombatConfig } from "../../types/infantry-combat-enhancer";

const props = defineProps<{
  open: boolean;
  config: InfantryCombatConfig | null;
  saving?: boolean;
}>();

const emit = defineEmits<{
  (event: "update:open", value: boolean): void;
  (event: "save", value: InfantryCombatConfig): void;
}>();

const draft = reactive<InfantryCombatConfig>(cloneConfig(props.config));

watch(
  () => props.config,
  (config) => {
    Object.assign(draft, cloneConfig(config));
  },
  { immediate: true, deep: true },
);

watch(
  () => props.open,
  (open) => {
    if (open) {
      Object.assign(draft, cloneConfig(props.config));
    }
  },
);

function cloneConfig(config: InfantryCombatConfig | null | undefined): InfantryCombatConfig {
  return {
    enabled: config?.enabled ?? true,
    minAttackerDamage: config?.minAttackerDamage ?? 15,
    damageDebounceMs: config?.damageDebounceMs ?? 0,
    showVictimDamage: config?.showVictimDamage ?? true,
    showVictimWound: config?.showVictimWound ?? true,
    showVictimKill: config?.showVictimKill ?? true,
    showAttackerDamage: config?.showAttackerDamage ?? true,
    storeRecentEventLimit: config?.storeRecentEventLimit ?? 300,
  };
}

function resetDraft() {
  Object.assign(draft, cloneConfig(props.config));
}

function save() {
  emit("save", cloneConfig(draft));
}
</script>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(5, 8, 12, 0.26);
  backdrop-filter: blur(3px);
}

.drawer {
  margin-left: auto;
  width: min(560px, 100vw);
  height: var(--app-viewport-height);
  overflow: auto;
  padding: 18px;
  display: grid;
  grid-template-rows: auto auto auto auto;
  gap: 14px;
  background:
    radial-gradient(circle at 0% 0%, rgba(96, 165, 250, 0.12), transparent 30%),
    linear-gradient(180deg, #101821 0%, #0b1117 100%);
  border-left: 1px solid rgba(130, 154, 180, 0.18);
  box-shadow: -20px 0 60px rgba(0, 0, 0, 0.35);
}

.drawer-head,
.drawer-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.drawer-head h2,
.drawer-section h3 {
  margin: 0;
  color: #edf2f4;
}

.drawer-head p {
  margin: 6px 0 0;
  color: #9aa7b2;
  font-size: 13px;
  line-height: 1.45;
}

.kicker {
  margin: 0;
  color: #88b8ff;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.drawer-section {
  display: grid;
  gap: 10px;
  border: 1px solid rgba(130, 154, 180, 0.14);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
  padding: 14px;
}

.toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  border: 1px solid rgba(130, 154, 180, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.015);
  padding: 10px 12px;
}

.toggle-row strong {
  display: block;
  color: #edf2f4;
  font-size: 13px;
}

.toggle-row small {
  display: block;
  margin-top: 3px;
  color: #7f919f;
  font-size: 11px;
}

.field {
  display: grid;
  gap: 6px;
}

.field span {
  color: #8fa2b3;
  font-size: 12px;
}

.field input,
.field select {
  width: 100%;
  border: 1px solid #31404d;
  background: #0f151b;
  color: #edf2f4;
  border-radius: 10px;
  padding: 10px 12px;
}

.note {
  border: 1px solid rgba(120, 102, 51, 0.65);
  background: rgba(36, 33, 22, 0.92);
  color: #f1d58b;
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.5;
}

.primary,
.secondary,
.close-button {
  border-radius: 10px;
  border: 1px solid #31404d;
  background: #0f151b;
  color: #edf2f4;
  padding: 10px 12px;
}

.primary {
  border-color: rgba(96, 165, 250, 0.45);
  background: rgba(96, 165, 250, 0.12);
}

.primary:disabled {
  opacity: 0.5;
}

.slide-enter-active,
.slide-leave-active {
  transition: opacity 160ms ease;
}

.slide-enter-from,
.slide-leave-to {
  opacity: 0;
}

@media (max-width: 720px) {
  .drawer {
    width: 100vw;
  }

  .drawer-head,
  .drawer-actions,
  .toggle-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
