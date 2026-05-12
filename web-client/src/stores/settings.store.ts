import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { ApiError } from "../app/apiClient";
import {
  fetchExposedSettings,
  updateExposedSettings,
  type ExposedSetting,
  type SettingValue,
} from "../app/settingsApi";

export const useSettingsStore = defineStore("settings", () => {
  const open = ref(false);
  const loading = ref(false);
  const saving = ref(false);
  const enabled = ref(false);
  const error = ref<string | null>(null);
  const restartRequired = ref(false);
  const fields = ref<ExposedSetting[]>([]);
  const baselineValues = ref<Record<string, SettingValue>>({});
  const draftValues = ref<Record<string, SettingValue>>({});

  const hasChanges = computed(() => fields.value.some((field) => !sameValue(getDraftValue(field.path), baselineValues.value[field.path])));
  const dirtyRestartRequired = computed(() => fields.value.some((field) => field.restartRequired && !sameValue(getDraftValue(field.path), baselineValues.value[field.path])));
  const noticeRestartRequired = computed(() => dirtyRestartRequired.value || restartRequired.value);

  function openDrawer() {
    open.value = true;
  }

  function closeDrawer() {
    open.value = false;
    error.value = null;
  }

  function setDraftValue(path: string, value: SettingValue) {
    draftValues.value = {
      ...draftValues.value,
      [path]: value,
    };
  }

  function getDraftValue(path: string) {
    return draftValues.value[path];
  }

  function resetDraft() {
    draftValues.value = { ...baselineValues.value };
  }

  function rebuildDraftFromFields(nextFields: ExposedSetting[]) {
    const nextValues: Record<string, SettingValue> = {};
    for (const field of nextFields) {
      nextValues[field.path] = field.value;
    }
    baselineValues.value = nextValues;
    draftValues.value = { ...nextValues };
  }

  async function load(force = false) {
    if (loading.value) return;
    if (!force && fields.value.length) return;

    loading.value = true;
    error.value = null;
    try {
      const data = await fetchExposedSettings();
      enabled.value = Boolean(data.enabled);
      fields.value = Array.isArray(data.settings) ? data.settings : [];
      rebuildDraftFromFields(fields.value);
      restartRequired.value = false;
    } catch (err) {
      error.value = renderSettingsError(err);
    } finally {
      loading.value = false;
    }
  }

  function getChanges() {
    const changes: Record<string, SettingValue> = {};
    for (const field of fields.value) {
      const nextValue = getDraftValue(field.path);
      const baselineValue = baselineValues.value[field.path];
      if (!sameValue(nextValue, baselineValue)) {
        changes[field.path] = nextValue;
      }
    }
    return changes;
  }

  async function save() {
    if (!enabled.value) {
      return {
        ok: true,
        enabled: false,
        settings: fields.value,
        restartRequired: false,
      };
    }

    const changes = getChanges();
    if (!Object.keys(changes).length) {
      restartRequired.value = false;
      return {
        ok: true,
        enabled: enabled.value,
        settings: fields.value,
        restartRequired: false,
      };
    }

    saving.value = true;
    error.value = null;
    try {
      const data = await updateExposedSettings(changes);
      enabled.value = Boolean(data.enabled);
      fields.value = Array.isArray(data.settings) ? data.settings : fields.value;
      rebuildDraftFromFields(fields.value);
      restartRequired.value = Boolean(data.restartRequired);
      return data;
    } catch (err) {
      error.value = renderSettingsError(err);
      throw err;
    } finally {
      saving.value = false;
    }
  }

  return {
    open,
    loading,
    saving,
    enabled,
    error,
    restartRequired,
    fields,
    hasChanges,
    dirtyRestartRequired,
    noticeRestartRequired,
    openDrawer,
    closeDrawer,
    load,
    save,
    resetDraft,
    setDraftValue,
    getDraftValue,
  };
});

function sameValue(left: unknown, right: unknown) {
  return Object.is(left, right);
}

function renderSettingsError(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Failed to load settings.";
}
