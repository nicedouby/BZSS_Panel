<template>
  <div v-if="settings.open" class="settings-overlay" @click.self="settings.closeDrawer()">
    <aside class="settings-panel">
      <header class="settings-head">
        <div>
          <h2>Settings</h2>
          <p>Only exposed configuration fields can be edited here.</p>
        </div>
        <button type="button" @click="settings.closeDrawer()">Close</button>
      </header>

      <section v-if="settings.loading" class="settings-state">
        Loading exposed settings...
      </section>

      <section v-else-if="settings.error" class="settings-state error">
        {{ settings.error }}
        <button type="button" @click="settings.load(true)">Retry</button>
      </section>

      <section v-else class="settings-body">
        <div v-if="!settings.enabled" class="settings-note">
          The settings editor is disabled in config.json.
        </div>

        <div v-if="!canEdit" class="settings-note warn">
          You can view settings, but only a super admin can save changes.
        </div>

        <div v-if="settings.noticeRestartRequired" class="settings-note warn">
          One or more changed settings require a restart before they take effect.
        </div>

        <div v-if="!settings.fields.length" class="settings-empty">
          No exposed settings are configured.
        </div>

        <div v-for="field in settings.fields" :key="field.path" class="setting-field">
          <label class="setting-label">
            <span class="setting-label-row">
              <span>{{ field.label }}</span>
              <strong v-if="isDangerousField(field)" class="setting-pill">Advanced</strong>
            </span>
            <small>{{ field.path }}</small>
          </label>

          <p v-if="field.description" class="setting-description">{{ field.description }}</p>
          <p v-if="isDangerousField(field)" class="setting-warning">
            Advanced setting. Changes here may affect access or require a restart.
          </p>

          <template v-if="field.type === 'boolean'">
            <label class="setting-control checkbox">
              <input
                type="checkbox"
                :checked="Boolean(settings.getDraftValue(field.path))"
                :disabled="!canSave || settings.loading || settings.saving"
                @change="updateBoolean(field.path, $event)"
              >
              <span>{{ Boolean(settings.getDraftValue(field.path)) ? "Enabled" : "Disabled" }}</span>
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
      </section>

      <footer class="settings-footer">
        <button type="button" @click="settings.closeDrawer()">Cancel</button>
        <button
          type="button"
          class="save-button"
          :disabled="!canSave || settings.loading || settings.saving || !settings.hasChanges"
          @click="save"
        >
          {{ settings.saving ? "Saving..." : "Save changes" }}
        </button>
      </footer>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useAuthStore } from "../../stores/auth.store";
import { useSettingsStore } from "../../stores/settings.store";

const auth = useAuthStore();
const settings = useSettingsStore();

const canEdit = computed(() => Boolean(auth.user?.isSuperAdmin));
const canSave = computed(() => canEdit.value && settings.enabled);

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

function isDangerousField(field: { path: string; advanced?: boolean }) {
  if (field.advanced) return true;
  return [
    "web.host",
    "web.port",
    "rcon.host",
    "rcon.port",
  ].includes(field.path);
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
  z-index: 100;
  background: rgba(8, 12, 16, 0.68);
}

.settings-panel {
  margin-left: auto;
  width: min(720px, 100vw);
  height: 100vh;
  overflow: auto;
  background: linear-gradient(180deg, #10161c 0%, #0f1419 100%);
  border-left: 1px solid #26303a;
  padding: 18px;
  display: grid;
  gap: 14px;
  position: relative;
  z-index: 101;
}

.settings-head,
.settings-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.settings-head h2 {
  margin: 0;
  font-size: 18px;
}

.settings-head p {
  margin: 6px 0 0;
  color: #9aa7b2;
  font-size: 13px;
}

.settings-body {
  display: grid;
  gap: 14px;
}

.settings-state {
  border: 1px solid #2b3540;
  background: #171d23;
  border-radius: 10px;
  padding: 14px;
  color: #dce4e8;
}

.settings-state.error {
  color: #ffb1b1;
  display: grid;
  gap: 10px;
}

.settings-note,
.settings-empty {
  border: 1px solid #2b3540;
  background: #171d23;
  border-radius: 10px;
  padding: 12px 14px;
  color: #d8e1e7;
}

.settings-note.warn {
  border-color: #786633;
  background: #242116;
  color: #f1d58b;
}

.setting-field {
  border: 1px solid #2b3540;
  background: #171d23;
  border-radius: 12px;
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
  color: #9aa7b2;
  font-size: 12px;
}

.setting-description {
  margin: 0;
  color: #9aa7b2;
  font-size: 12px;
  line-height: 1.45;
}

.setting-warning {
  margin: -2px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #786633;
  background: #242116;
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
  border: 1px solid #786633;
  background: #242116;
  color: #f1d58b;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.setting-input {
  width: 100%;
  border: 1px solid #38414c;
  background: #11171d;
  color: #edf2f4;
  border-radius: 8px;
  padding: 9px 10px;
}

.setting-control.checkbox {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #edf2f4;
}

.settings-footer {
  padding-top: 4px;
  border-top: 1px solid #26303a;
}

.save-button:disabled {
  opacity: 0.5;
}

@media (max-width: 760px) {
  .settings-panel {
    width: 100vw;
  }
}
</style>
