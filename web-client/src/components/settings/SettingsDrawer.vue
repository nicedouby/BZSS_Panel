<template>
  <teleport to="body">
    <transition name="settings-fade">
      <div v-if="settings.open" class="settings-overlay" @click.self="settings.closeDrawer()">
        <section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
          <header class="main-head">
            <div class="main-head-copy">
              <p class="head-kicker">Control</p>
              <h2 id="settings-dialog-title">{{ t("settings.title") }}</h2>
              <p>Server settings only. Theme switching has moved to the top-right user menu.</p>
            </div>
            <button type="button" class="ghost-button" @click="settings.closeDrawer()">{{ t("common.close") }}</button>
          </header>

          <section class="toolbar-card">
            <label class="search-field">
              <span>Search field or path</span>
              <input
                v-model.trim="searchQuery"
                type="text"
                placeholder="web.port / rcon / tick / squad"
              >
            </label>

            <label class="inline-toggle">
              <input v-model="showAdvancedFields" type="checkbox">
              <span>Show advanced fields</span>
            </label>
          </section>

          <div class="settings-scroll">
            <section v-if="settings.loading" class="state-card">
              {{ t("settings.loading") }}
            </section>

            <section v-else-if="settings.error" class="state-card error">
              <span>{{ settings.error }}</span>
              <button type="button" class="ghost-button" @click="settings.load(true)">{{ t("common.retry") }}</button>
            </section>

            <template v-else>
              <section class="summary-grid">
                <div class="summary-card">
                  <span class="summary-label">Visible fields</span>
                  <strong>{{ visibleFieldCount }}</strong>
                  <small>{{ changedFieldCount }} pending changes</small>
                </div>

                <div class="summary-card" :class="{ warn: !canSave || settings.noticeRestartRequired }">
                  <span class="summary-label">Status</span>
                  <strong>{{ statusTitle }}</strong>
                  <small>{{ statusDescription }}</small>
                </div>
              </section>

              <section class="note-grid">
                <div v-if="!settings.enabled" class="note-card">
                  {{ t("settings.disabled") }}
                </div>

                <div v-if="!canEdit" class="note-card warn">
                  {{ t("settings.readonly") }}
                </div>

                <div v-if="settings.noticeRestartRequired" class="note-card warn">
                  {{ t("settings.restartRequired") }}
                </div>
              </section>

              <section v-if="!visibleGroups.length" class="state-card">
                {{ searchQuery ? "No fields match the current filter." : t("settings.noExposedSettings") }}
              </section>

              <section v-for="group in visibleGroups" :key="group.id" class="group-card">
                <header class="group-head">
                  <div>
                    <h3>{{ group.title }}</h3>
                    <p>{{ group.description }}</p>
                  </div>
                  <span class="group-count">{{ group.fields.length }}</span>
                </header>

                <div class="field-list">
                  <div v-for="field in group.fields" :key="field.path" class="setting-field">
                    <label class="setting-label">
                      <span class="setting-label-row">
                        <span>{{ settingLabel(field) }}</span>
                        <strong v-if="isDangerousField(field)" class="setting-pill">{{ t("common.advanced") }}</strong>
                        <strong v-if="field.restartRequired" class="setting-pill restart">Restart</strong>
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
                </div>
              </section>
            </template>
          </div>

          <footer class="settings-footer">
            <div class="footer-copy">
              This dialog has its own scroll area. Server config still requires manual save.
            </div>
            <div class="footer-actions">
              <button
                type="button"
                class="ghost-button"
                :disabled="settings.loading || settings.saving || !settings.hasChanges"
                @click="settings.resetDraft()"
              >
                Reset draft
              </button>
              <button type="button" class="ghost-button" @click="settings.closeDrawer()">{{ t("common.cancel") }}</button>
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
        </section>
      </div>
    </transition>
  </teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useAuthStore } from "../../stores/auth.store";
import { useSettingsStore } from "../../stores/settings.store";
import { t } from "../../i18n";
import type { ExposedSetting } from "../../app/settingsApi";
import { hasPermission as hasSharedPermission } from "../../shared/rcon-permissions.js";

interface SettingsGroup {
  id: string;
  title: string;
  description: string;
  fields: ExposedSetting[];
}

const auth = useAuthStore();
const settings = useSettingsStore();

const canEdit = computed(() => Boolean(
  auth.user?.isSuperAdmin
  || hasSharedPermission(auth.user?.permissions, "settings.manage"),
));
const canSave = computed(() => canEdit.value && settings.enabled);
const searchQuery = ref("");
const showAdvancedFields = ref(false);

const groupedFields = computed<SettingsGroup[]>(() => {
  const groups = new Map<string, SettingsGroup>();

  for (const field of settings.fields) {
    if (!showAdvancedFields.value && isDangerousField(field)) continue;
    if (!matchesSearch(field, searchQuery.value)) continue;

    const definition = resolveGroup(field.path);
    const existing = groups.get(definition.id);
    if (existing) {
      existing.fields.push(field);
      continue;
    }

    groups.set(definition.id, {
      ...definition,
      fields: [field],
    });
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    fields: [...group.fields].sort(compareFields),
  }));
});

const visibleGroups = computed(() => groupedFields.value.filter((group) => group.fields.length > 0));
const visibleFieldCount = computed(() => visibleGroups.value.reduce((sum, group) => sum + group.fields.length, 0));
const changedFieldCount = computed(() => settings.fields.reduce((sum, field) => {
  return sameValue(settings.getDraftValue(field.path), field.value) ? sum : sum + 1;
}, 0));

const statusTitle = computed(() => {
  if (!canEdit.value) return "Read only";
  if (settings.noticeRestartRequired) return "Restart required";
  if (settings.hasChanges) return "Unsaved changes";
  return "Ready";
});

const statusDescription = computed(() => {
  if (!canEdit.value) return "You can inspect fields but cannot save.";
  if (settings.noticeRestartRequired) return "One or more edited fields take effect after restart.";
  if (settings.hasChanges) return "Save the draft to write changes into config.";
  return "No pending config change.";
});

watch(
  () => settings.open,
  (open) => {
    if (open) {
      void settings.load(true);
      window.addEventListener("keydown", onWindowKeyDown);
      return;
    }

    searchQuery.value = "";
    showAdvancedFields.value = false;
    window.removeEventListener("keydown", onWindowKeyDown);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onWindowKeyDown);
});

function onWindowKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    settings.closeDrawer();
  }
}

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

function settingLabel(field: { path: string; label: string }) {
  return t(`settingsField.${field.path}`, field.label);
}

function matchesSearch(field: ExposedSetting, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;

  return [
    field.path,
    field.label,
    field.description ?? "",
    settingLabel(field),
  ].some((value) => String(value).toLowerCase().includes(query));
}

function resolveGroup(path: string) {
  if (path.startsWith("web.")) {
    return {
      id: "web",
      title: "Web panel",
      description: "Panel binding, title, and client selection.",
    };
  }

  if (path.startsWith("rcon.")) {
    return {
      id: "rcon",
      title: "RCON",
      description: "Connection state and remote command endpoint.",
    };
  }

  if (path.startsWith("bzssCore.")) {
    return {
      id: "bzss-core",
      title: "BZSS-Core",
      description: "Save-game script and remote logger path.",
    };
  }

  if (path.startsWith("ipLookup.") || path.startsWith("playerIdentityDisplay.")) {
    return {
      id: "identity",
      title: "Identity and IP display",
      description: "Lookup provider and where IP data is exposed in UI.",
    };
  }

  if (path.startsWith("serverTickRate.")) {
    return {
      id: "tick-rate",
      title: "Tick rate",
      description: "Expected tick rate and alert thresholds.",
    };
  }

  if (path.startsWith("modules.matchState.polling.")) {
    return {
      id: "polling",
      title: "Runtime refresh",
      description: "Server, player, squad, and map polling cadence.",
    };
  }

  if (path.startsWith("plugins.fairSquadGuard.")) {
    return {
      id: "fair-squad-guard",
      title: "Fair Squad Guard",
      description: "Guard thresholds, windows, and broadcast behavior.",
    };
  }

  return {
    id: "other",
    title: "Other",
    description: "Exposed settings that do not fit the main groups.",
  };
}

function compareFields(left: ExposedSetting, right: ExposedSetting) {
  const leftDanger = isDangerousField(left) ? 1 : 0;
  const rightDanger = isDangerousField(right) ? 1 : 0;
  if (leftDanger !== rightDanger) return leftDanger - rightDanger;
  return settingLabel(left).localeCompare(settingLabel(right));
}

function sameValue(left: unknown, right: unknown) {
  return Object.is(left, right);
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
  display: grid;
  place-items: center;
  padding: 16px;
  background:
    radial-gradient(circle at top, color-mix(in srgb, var(--color-brand-primary) 18%, transparent), transparent 34%),
    color-mix(in srgb, var(--color-bg-page) 76%, transparent);
  backdrop-filter: blur(14px) saturate(1.05);
}

.settings-dialog {
  width: min(1080px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow: hidden;
  border-radius: 28px;
  border: 1px solid var(--color-border-default);
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--color-brand-primary) 18%, transparent), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.02)), rgba(255, 255, 255, 0.008)),
    var(--color-bg-card);
  box-shadow: 0 36px 120px rgba(0, 0, 0, 0.52);
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
}

.main-head,
.toolbar-card,
.settings-footer {
  padding-left: 24px;
  padding-right: 24px;
}

.main-head {
  padding-top: 24px;
  padding-bottom: 16px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--color-border-soft);
}

.main-head-copy {
  display: grid;
  gap: 6px;
}

.head-kicker {
  margin: 0;
  color: var(--color-status-info);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.main-head h2,
.group-head h3 {
  margin: 0;
}

.main-head p,
.group-head p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.toolbar-card {
  padding-top: 14px;
  padding-bottom: 14px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: end;
  border-bottom: 1px solid var(--color-border-soft);
}

.search-field {
  display: grid;
  gap: 6px;
}

.search-field span,
.summary-label {
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.search-field input,
.setting-input {
  width: 100%;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  border-radius: 12px;
  padding: 10px 12px;
}

.inline-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-primary);
  font-size: 13px;
}

.settings-scroll {
  min-height: 0;
  overflow: auto;
  padding: 18px 24px;
  display: grid;
  align-content: start;
  gap: 14px;
  scrollbar-gutter: stable;
}

.summary-grid,
.note-grid {
  display: grid;
  gap: 10px;
}

.summary-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.summary-card,
.note-card,
.group-card,
.state-card,
.settings-footer {
  border: 1px solid var(--color-border-soft);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.016)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-card);
  border-radius: 18px;
}

.summary-card,
.note-card,
.state-card {
  padding: 14px 16px;
}

.summary-card {
  display: grid;
  gap: 4px;
}

.summary-card strong {
  font-size: 20px;
  color: var(--color-text-primary);
}

.summary-card small {
  color: var(--color-text-secondary);
  font-size: 12px;
}

.summary-card.warn,
.note-card.warn,
.state-card.error {
  border-color: rgba(245, 158, 11, 0.28);
  background:
    linear-gradient(180deg, rgba(245, 158, 11, 0.12), rgba(255, 255, 255, 0.02)),
    var(--color-bg-card);
}

.state-card {
  color: var(--color-text-primary);
}

.state-card.error {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.group-card {
  padding: 16px;
  display: grid;
  gap: 14px;
}

.group-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.group-count {
  min-width: 28px;
  min-height: 28px;
  padding: 0 9px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  border: 1px solid var(--color-border-default);
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.field-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
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

.setting-label small,
.setting-description {
  color: var(--color-text-muted);
  font-size: 12px;
}

.setting-description,
.setting-warning {
  margin: 0;
  line-height: 1.45;
}

.setting-warning {
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(245, 158, 11, 0.28);
  background:
    linear-gradient(180deg, rgba(245, 158, 11, 0.12), rgba(255, 255, 255, 0.02)),
    var(--color-bg-card);
  color: #f1d58b;
  font-size: 12px;
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

.setting-pill.restart {
  border-color: rgba(248, 113, 113, 0.28);
  background:
    linear-gradient(180deg, rgba(248, 113, 113, 0.12), rgba(255, 255, 255, 0.02)),
    var(--color-bg-card);
}

.setting-control.checkbox {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--color-text-primary);
}

.settings-footer {
  margin: 0 24px 24px;
  padding: 14px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.footer-copy {
  color: var(--color-text-muted);
  font-size: 12px;
}

.footer-actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.ghost-button,
.save-button {
  border-radius: 12px;
  min-height: 40px;
  padding: 0 14px;
}

.save-button:disabled {
  opacity: 0.5;
}

.settings-fade-enter-active,
.settings-fade-leave-active {
  transition: opacity 0.16s ease;
}

.settings-fade-enter-from,
.settings-fade-leave-to {
  opacity: 0;
}

@media (max-width: 820px) {
  .settings-overlay {
    padding: 0;
  }

  .settings-dialog {
    width: 100vw;
    max-height: 100vh;
    border-radius: 0;
  }

  .toolbar-card,
  .summary-grid,
  .field-list {
    grid-template-columns: 1fr;
  }

  .main-head,
  .settings-footer,
  .footer-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .settings-footer {
    margin: 0 12px 12px;
  }

  .footer-actions > * {
    width: 100%;
  }
}
</style>
