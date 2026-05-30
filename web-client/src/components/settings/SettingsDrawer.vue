<template>
  <div v-if="settings.open" class="settings-overlay" @click.self="settings.closeDrawer()">
    <aside class="settings-panel">
      <header class="settings-head settings-hero">
        <div class="settings-head-copy">
          <p class="settings-kicker">控制中心</p>
          <h2>控制中心</h2>
          <p>界面、显示密度、系统设置</p>
        </div>
        <button type="button" @click="settings.closeDrawer()">{{ t("common.close") }}</button>
      </header>

      <section class="settings-section appearance-section">
        <div class="settings-section-head">
          <h3>界面外观</h3>
          <p>这些设置只保存在当前浏览器，不影响服务器配置。</p>
        </div>

        <div class="appearance-grid">
          <div class="appearance-field">
            <div class="appearance-label">
              <span>视觉模式</span>
              <small>立即生效</small>
            </div>
            <div class="segmented-options">
              <button
                v-for="option in visualModeOptions"
                :key="option.value"
                type="button"
                class="segment-option"
                :class="{ active: ui.visualMode === option.value }"
                @click="ui.setVisualMode(option.value)"
              >
                <strong>{{ option.label }}</strong>
                <small>{{ option.description }}</small>
              </button>
            </div>
          </div>

          <div class="appearance-field">
            <div class="appearance-label">
              <span>显示密度</span>
              <small>影响页面间距</small>
            </div>
            <div class="segmented-options two">
              <button
                v-for="option in densityOptions"
                :key="option.value"
                type="button"
                class="segment-option"
                :class="{ active: ui.globalDensity === option.value }"
                @click="ui.setGlobalDensity(option.value)"
              >
                <strong>{{ option.label }}</strong>
                <small>{{ option.description }}</small>
              </button>
            </div>
          </div>

          <div class="appearance-field">
            <div class="appearance-label">
              <span>阵营配色</span>
              <small>主界面与战队色彩</small>
            </div>
            <div class="segmented-options">
              <button
                v-for="option in accentOptions"
                :key="option.value"
                type="button"
                class="segment-option"
                :class="{ active: ui.accent === option.value }"
                @click="ui.setAccent(option.value)"
              >
                <strong>{{ option.label }}</strong>
                <small>{{ option.description }}</small>
              </button>
            </div>
          </div>

          <div class="appearance-field">
            <div class="appearance-label">
              <span>动效强度</span>
              <small>减少动画负担</small>
            </div>
            <div class="segmented-options two">
              <button
                v-for="option in motionOptions"
                :key="option.value"
                type="button"
                class="segment-option"
                :class="{ active: ui.motion === option.value }"
                @click="ui.setMotion(option.value)"
              >
                <strong>{{ option.label }}</strong>
                <small>{{ option.description }}</small>
              </button>
            </div>
          </div>

          <label class="toggle-row">
            <span>
              <strong>背景层次</strong>
              <small>更丰富的环境光与渐变</small>
            </span>
            <input
              type="checkbox"
              :checked="ui.richBackground"
              @change="updateRichBackground"
            >
          </label>

          <label class="toggle-row">
            <span>
              <strong>卡片光效</strong>
              <small>增强面板的层次感</small>
            </span>
            <input
              type="checkbox"
              :checked="ui.cardGlow"
              @change="updateCardGlow"
            >
          </label>

          <label class="toggle-row">
            <span>
              <strong>阵营视角提示</strong>
              <small>显示“当前视角 TEAM X”提示</small>
            </span>
            <input
              type="checkbox"
              :checked="ui.showTeamPerspectiveHint"
              @change="updateShowTeamPerspectiveHint"
            >
          </label>
        </div>
      </section>

      <section class="settings-section backend-section">
        <div class="settings-section-head">
          <h3>服务器设置</h3>
          <p>这些设置会写入服务端配置，部分改动可能需要重启。</p>
        </div>

        <template v-if="settings.loading">
          <section class="settings-state">
            {{ t("settings.loading") }}
          </section>
        </template>

        <template v-else-if="settings.error">
          <section class="settings-state error">
            {{ settings.error }}
            <button type="button" @click="settings.load(true)">{{ t("common.retry") }}</button>
          </section>
        </template>

        <template v-else>
          <div v-if="!settings.enabled" class="settings-note">
            {{ t("settings.disabled") }}
          </div>

          <div v-if="!canEdit" class="settings-note warn">
            {{ t("settings.readonly") }}
          </div>

          <div v-if="settings.noticeRestartRequired" class="settings-note warn">
            {{ t("settings.restartRequired") }}
          </div>

          <div v-if="!settings.fields.length" class="settings-empty">
            {{ t("settings.noExposedSettings") }}
          </div>

          <div v-for="field in settings.fields" :key="field.path" class="setting-field">
            <label class="setting-label">
              <span class="setting-label-row">
                <span>{{ settingLabel(field) }}</span>
                <strong v-if="isDangerousField(field)" class="setting-pill">{{ t("common.advanced") }}</strong>
              </span>
              <small>{{ field.path }}</small>
            </label>

            <p v-if="field.description" class="setting-description">{{ field.description }}</p>
            <p v-if="isDangerousField(field)" class="setting-warning">
              {{ t("settings.advancedWarning") }}
            </p>

            <template v-if="field.type === 'boolean'">
              <label class="setting-control checkbox">
                <input
                  type="checkbox"
                  :checked="Boolean(settings.getDraftValue(field.path))"
                  :disabled="!canSave || settings.loading || settings.saving"
                  @change="updateBoolean(field.path, $event)"
                >
                <span>{{ Boolean(settings.getDraftValue(field.path)) ? t("common.enabled") : t("common.disabled") }}</span>
              </label>
            </template>

            <template v-else-if="field.type === 'number'">
              <input
                class="setting-input"
                type="number"
                :min="field.min"
                :max="field.max"
                step="any"
                :value="numberInputValue(field.path)"
                :disabled="!canSave || settings.loading || settings.saving"
                @input="updateNumber(field.path, $event)"
              >
            </template>

            <template v-else-if="field.type === 'select'">
              <select
                class="setting-input"
                :value="selectInputValue(field.path)"
                :disabled="!canSave || settings.loading || settings.saving"
                @change="updateSelect(field.path, $event)"
              >
                <option v-for="option in field.options ?? []" :key="String(option.value)" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </template>

            <template v-else>
              <input
                class="setting-input"
                type="text"
                :value="stringInputValue(field.path)"
                :disabled="!canSave || settings.loading || settings.saving"
                @input="updateString(field.path, $event)"
              >
            </template>
          </div>
        </template>
      </section>

      <footer class="settings-footer">
        <div class="settings-footer-copy">
          本地外观即时生效，服务器设置需要保存。
        </div>
        <div class="settings-footer-actions">
          <button type="button" @click="settings.closeDrawer()">{{ t("common.cancel") }}</button>
          <button
            type="button"
            class="save-button"
            :disabled="!canSave || settings.loading || settings.saving || !settings.hasChanges"
            @click="save"
          >
            {{ settings.saving ? t("common.saving") : t("common.saveChanges") }}
          </button>
        </div>
      </footer>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useAuthStore } from "../../stores/auth.store";
import { useSettingsStore } from "../../stores/settings.store";
import { useUiStore } from "../../stores/ui.store";
import { t } from "../../i18n";

const auth = useAuthStore();
const settings = useSettingsStore();
const ui = useUiStore();

const canEdit = computed(() => Boolean(auth.user?.isSuperAdmin));
const canSave = computed(() => canEdit.value && settings.enabled);

const visualModeOptions = [
  {
    value: "classic",
    label: "经典",
    description: "更克制、更接近原始面板",
  },
  {
    value: "tactical",
    label: "战术",
    description: "默认推荐，层次分明",
  },
  {
    value: "glass",
    label: "玻璃",
    description: "更通透的控制中心",
  },
] as const;

const densityOptions = [
  {
    value: "comfortable",
    label: "舒适",
    description: "保留更大的留白",
  },
  {
    value: "compact",
    label: "紧凑",
    description: "提高信息密度",
  },
] as const;

const accentOptions = [
  {
    value: "blueOrange",
    label: "蓝 / 橙",
    description: "经典战术对比",
  },
  {
    value: "greenAmber",
    label: "绿 / 琥珀",
    description: "偏战场态势感",
  },
  {
    value: "steelRed",
    label: "钢蓝 / 红",
    description: "更冷静、警示感更强",
  },
] as const;

const motionOptions = [
  {
    value: "normal",
    label: "正常",
    description: "保留当前过渡效果",
  },
  {
    value: "reduced",
    label: "减少",
    description: "降低动画干扰",
  },
] as const;

watch(
  () => settings.open,
  (open) => {
    if (open) {
      void settings.load(true);
    }
  },
  { immediate: true },
);

function numberInputValue(path: string) {
  const value = settings.getDraftValue(path);
  return value == null ? "" : String(value);
}

function stringInputValue(path: string) {
  const value = settings.getDraftValue(path);
  return value == null ? "" : String(value);
}

function selectInputValue(path: string) {
  const value = settings.getDraftValue(path);
  return value == null ? "" : value;
}

function updateBoolean(path: string, event: Event) {
  const input = event.target as HTMLInputElement;
  settings.setDraftValue(path, input.checked);
}

function updateNumber(path: string, event: Event) {
  const input = event.target as HTMLInputElement;
  const raw = input.value;
  if (raw === "") {
    settings.setDraftValue(path, "");
    return;
  }
  const parsed = Number(raw);
  settings.setDraftValue(path, Number.isFinite(parsed) ? parsed : raw);
}

function updateString(path: string, event: Event) {
  const input = event.target as HTMLInputElement;
  settings.setDraftValue(path, input.value);
}

function updateSelect(path: string, event: Event) {
  const input = event.target as HTMLSelectElement;
  settings.setDraftValue(path, input.value);
}

function updateRichBackground(event: Event) {
  const input = event.target as HTMLInputElement;
  ui.setRichBackground(input.checked);
}

function updateCardGlow(event: Event) {
  const input = event.target as HTMLInputElement;
  ui.setCardGlow(input.checked);
}

function updateShowTeamPerspectiveHint(event: Event) {
  const input = event.target as HTMLInputElement;
  ui.setShowTeamPerspectiveHint(input.checked);
}

function isDangerousField(field: { path: string; advanced?: boolean }) {
  if (field.advanced) return true;
  return [
    "web.host",
    "web.port",
    "rcon.host",
    "rcon.port",
  ].includes(field.path);
}

function settingLabel(field: { path: string; label: string }) {
  return t(`settingsField.${field.path}`, field.label);
}

async function save() {
  try {
    await settings.save();
  } catch {}
}
</script>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-settings-drawer);
  background: rgba(5, 8, 12, 0.4);
  backdrop-filter: blur(4px);
}

.settings-panel {
  margin-left: auto;
  width: min(620px, 100vw);
  height: 100vh;
  overflow: auto;
  background:
    radial-gradient(circle at 0% 0%, rgba(96, 165, 250, 0.1), transparent 32%),
    radial-gradient(circle at 100% 0%, rgba(251, 146, 60, 0.08), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.02)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-card);
  border-left: 1px solid var(--color-border-default);
  box-shadow: -24px 0 60px rgba(0, 0, 0, 0.38);
  padding: 18px;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 14px;
  position: relative;
  z-index: calc(var(--z-settings-drawer) + 1);
  backdrop-filter: blur(12px);
}

.settings-head,
.settings-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.settings-hero {
  padding: 16px;
  border: 1px solid var(--color-border-soft);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.03);
}

.settings-head-copy {
  display: grid;
  gap: 4px;
}

.settings-kicker {
  margin: 0;
  color: var(--color-status-info);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.settings-head h2 {
  margin: 0;
  font-size: 18px;
}

.settings-head p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.settings-section {
  border: 1px solid var(--color-border-soft);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.022);
  padding: 14px;
  display: grid;
  gap: 12px;
}

.settings-section-head h3 {
  margin: 0;
  font-size: 14px;
  color: var(--color-text-primary, #edf2f4);
}

.settings-section-head p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--color-text-muted, #9aa7b2);
}

.appearance-grid {
  display: grid;
  gap: 12px;
}

.appearance-field {
  display: grid;
  gap: 8px;
}

.appearance-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 600;
}

.appearance-label small {
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 500;
}

.segmented-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.segmented-options.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.segment-option {
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.025);
  color: var(--color-text-secondary);
  border-radius: 14px;
  padding: 10px;
  text-align: left;
  display: grid;
  gap: 4px;
  transition: border-color 0.15s ease, background-color 0.15s ease, transform 0.15s ease;
}

.segment-option strong {
  color: var(--color-text-primary);
  font-size: 13px;
}

.segment-option small {
  color: var(--color-text-muted);
  font-size: 11px;
}

.segment-option.active {
  border-color: rgba(96, 165, 250, 0.36);
  background: rgba(96, 165, 250, 0.12);
  box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.14);
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.018);
  border-radius: 14px;
  padding: 10px 12px;
}

.toggle-row strong {
  display: block;
  color: var(--color-text-primary);
  font-size: 13px;
}

.toggle-row small {
  display: block;
  margin-top: 3px;
  color: var(--color-text-muted);
  font-size: 11px;
}

.settings-body {
  display: grid;
  gap: 14px;
}

.settings-state {
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.016)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-card);
  border-radius: 14px;
  padding: 14px;
  color: var(--color-text-primary);
}

.settings-state.error {
  color: #ffc4c4;
  display: grid;
  gap: 10px;
}

.settings-note,
.settings-empty {
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.016)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-card);
  border-radius: 14px;
  padding: 12px 14px;
  color: var(--color-text-secondary);
}

.settings-note.warn {
  border-color: rgba(245, 158, 11, 0.28);
  background:
    linear-gradient(180deg, rgba(245, 158, 11, 0.12), rgba(255, 255, 255, 0.02)),
    var(--color-bg-card);
  color: #f1d58b;
}

.setting-field {
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.016)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-card);
  border-radius: 16px;
  padding: 12px;
  display: grid;
  gap: 10px;
}

.setting-label {
  display: grid;
  gap: 2px;
}

.setting-label-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.setting-label span {
  font-weight: 600;
}

.setting-label small {
  color: var(--color-text-muted);
  font-size: 12px;
}

.setting-description {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.45;
}

.setting-warning {
  margin: -2px 0 0;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(245, 158, 11, 0.28);
  background:
    linear-gradient(180deg, rgba(245, 158, 11, 0.12), rgba(255, 255, 255, 0.02)),
    var(--color-bg-card);
  color: #f1d58b;
  font-size: 12px;
  line-height: 1.45;
}

.setting-pill {
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid rgba(245, 158, 11, 0.28);
  background:
    linear-gradient(180deg, rgba(245, 158, 11, 0.12), rgba(255, 255, 255, 0.02)),
    var(--color-bg-card);
  color: #f1d58b;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.setting-input {
  width: 100%;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  border-radius: 12px;
  padding: 9px 10px;
}

.setting-control.checkbox {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--color-text-primary);
}

.settings-footer {
  padding-top: 4px;
  border-top: 1px solid var(--color-border-soft);
}

.settings-footer-copy {
  color: var(--color-text-muted);
  font-size: 12px;
}

.settings-footer-actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.save-button:disabled {
  opacity: 0.5;
}

@media (max-width: 760px) {
  .settings-panel {
    width: 100vw;
  }

  .segmented-options,
  .segmented-options.two {
    grid-template-columns: 1fr;
  }

  .settings-footer {
    flex-direction: column;
    align-items: stretch;
  }

  .settings-footer-actions {
    justify-content: stretch;
  }

  .settings-footer-actions button {
    flex: 1 1 auto;
  }
}
</style>
