<template>
  <Teleport to="body">
    <div v-if="open" class="plugin-center-layer">
      <div class="plugin-center-backdrop" @click="handleClose" />

      <section class="plugin-center-drawer">
        <header class="plugin-center-header">
          <div>
            <h2>插件中心</h2>
            <p>管理插件订阅、启用状态与参数配置。</p>
          </div>

          <button type="button" class="drawer-close-button" @click="handleClose">
            ×
          </button>
        </header>

        <div v-if="error" class="plugin-error">
          {{ error }}
        </div>

        <div class="plugin-center-toolbar">
          <div class="plugin-center-summary">
            共 {{ plugins.length }} 个插件
          </div>
        </div>

        <div class="plugin-center-body">
          <div v-if="loading" class="plugin-loading">正在加载插件...</div>
          <div v-else-if="!plugins.length" class="empty-config">暂无插件。</div>

          <div v-else class="plugin-grid">
            <PluginCard
              v-for="plugin in plugins"
              :key="plugin.id"
              :plugin="plugin"
              @toggle-enabled="handleToggleEnabled(plugin)"
              @open-settings="handleOpenSettings(plugin)"
            />
          </div>
        </div>
      </section>

      <PluginSettingsDrawer
        :open="settingsOpen"
        :plugin="selectedPlugin"
        :on-save="handleSaveConfig"
        :on-close="closeSettings"
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { PluginManifest } from "./plugin.types";
import { fetchPlugins, setPluginEnabled, updatePluginConfig } from "./plugin.api";
import PluginCard from "./PluginCard.vue";
import PluginSettingsDrawer from "./PluginSettingsDrawer.vue";
import "./plugin-center.css";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (event: "close"): void;
}>();

const plugins = ref<PluginManifest[]>([]);
const loading = ref(false);
const error = ref("");
const selectedPluginId = ref<string | null>(null);
const settingsOpen = ref(false);

const selectedPlugin = computed(() => {
  return plugins.value.find((plugin) => plugin.id === selectedPluginId.value) ?? null;
});

watch(
  () => props.open,
  (open) => {
    if (open) {
      void loadPlugins();
      window.addEventListener("keydown", onWindowKeyDown);
      return;
    }

    closeSettings();
    selectedPluginId.value = null;
    window.removeEventListener("keydown", onWindowKeyDown);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onWindowKeyDown);
});

async function loadPlugins() {
  loading.value = true;
  error.value = "";

  try {
    plugins.value = await fetchPlugins();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "加载插件失败";
  } finally {
    loading.value = false;
  }
}

function handleClose() {
  closeSettings();
  selectedPluginId.value = null;
  emit("close");
}

function closeSettings() {
  settingsOpen.value = false;
}

function handleOpenSettings(plugin: PluginManifest) {
  selectedPluginId.value = plugin.id;
  settingsOpen.value = true;
}

async function handleToggleEnabled(plugin: PluginManifest) {
  const nextEnabled = !plugin.enabled;
  const previousEnabled = plugin.enabled;

  plugins.value = plugins.value.map((item) => (
    item.id === plugin.id ? { ...item, enabled: nextEnabled } : item
  ));

  try {
    const updated = await setPluginEnabled(plugin.id, nextEnabled);
    replacePlugin(updated);
  } catch (err) {
    plugins.value = plugins.value.map((item) => (
      item.id === plugin.id ? { ...item, enabled: previousEnabled } : item
    ));
    error.value = err instanceof Error ? err.message : "更新插件状态失败";
  }
}

async function handleSaveConfig(config: Record<string, unknown>) {
  if (!selectedPlugin.value) return;

  const updated = await updatePluginConfig(selectedPlugin.value.id, config);
  replacePlugin(updated);
}

function replacePlugin(updated: PluginManifest) {
  plugins.value = plugins.value.map((item) => (
    item.id === updated.id ? updated : item
  ));
}

function onWindowKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape" && props.open) {
    handleClose();
  }
}
</script>
