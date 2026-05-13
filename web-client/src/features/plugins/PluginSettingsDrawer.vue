<template>
  <aside v-if="open && plugin" class="plugin-settings-drawer">
    <header class="plugin-settings-header">
      <div>
        <h3>{{ plugin.name }}</h3>
        <p>插件参数设置</p>
      </div>

      <button type="button" class="drawer-close-button" @click="onClose">
        ×
      </button>
    </header>

    <div v-if="error" class="plugin-error">
      {{ error }}
    </div>

    <div class="plugin-settings-body">
      <div v-if="!plugin.configSchema?.length" class="empty-config">
        这个插件没有可配置参数。
      </div>

      <ConfigFieldRenderer
        v-for="field in plugin.configSchema ?? []"
        :key="field.key"
        :field="field"
        :model-value="config[field.key]"
        @update:model-value="updateField(field.key, $event)"
      />
    </div>

    <footer class="plugin-settings-footer">
      <button type="button" class="secondary-button" @click="onClose">
        取消
      </button>

      <button type="button" class="primary-button" :disabled="saving" @click="handleSave">
        {{ saving ? "保存中..." : "保存" }}
      </button>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import type { PluginConfigField, PluginManifest } from "./plugin.types";
import ConfigFieldRenderer from "./ConfigFieldRenderer.vue";

const props = defineProps<{
  open: boolean;
  plugin: PluginManifest | null;
  onSave: (config: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}>();

const config = ref<Record<string, unknown>>({});
const saving = ref(false);
const error = ref("");

watch(
  () => [props.open, props.plugin],
  () => {
    if (!props.plugin) {
      config.value = {};
      error.value = "";
      return;
    }

    const nextConfig: Record<string, unknown> = {};
    for (const field of props.plugin.configSchema ?? []) {
      nextConfig[field.key] = resolveInitialValue(field, props.plugin);
    }

    config.value = nextConfig;
    error.value = "";
  },
  { immediate: true },
);

function updateField(key: string, value: unknown) {
  config.value = {
    ...config.value,
    [key]: value,
  };
}

async function handleSave() {
  if (!props.plugin) return;

  const validationError = validateConfig(props.plugin, config.value);
  if (validationError) {
    error.value = validationError;
    return;
  }

  saving.value = true;
  error.value = "";

  try {
    await props.onSave({ ...config.value });
    props.onClose();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "保存插件参数失败";
  } finally {
    saving.value = false;
  }
}

function resolveInitialValue(field: PluginConfigField, currentPlugin: PluginManifest) {
  if (currentPlugin.config && Object.prototype.hasOwnProperty.call(currentPlugin.config, field.key)) {
    return currentPlugin.config[field.key];
  }

  if (field.defaultValue !== undefined) {
    return field.defaultValue;
  }

  if (field.type === "boolean") {
    return false;
  }

  if (field.type === "number") {
    return 0;
  }

  if (field.type === "select") {
    return field.options?.[0]?.value ?? "";
  }

  return "";
}

function validateConfig(currentPlugin: PluginManifest, currentConfig: Record<string, unknown>) {
  for (const field of currentPlugin.configSchema ?? []) {
    if (!field.required) continue;

    const value = currentConfig[field.key];
    if (value === undefined || value === null || value === "") {
      return `参数「${field.label}」不能为空`;
    }
  }

  return "";
}
</script>
