<template>
  <article class="plugin-card" :class="{ enabled: plugin.enabled }">
    <div class="plugin-card-header">
      <div class="plugin-icon">
        <img v-if="plugin.icon" :src="plugin.icon" :alt="plugin.name">
        <span v-else>{{ plugin.name.slice(0, 1).toUpperCase() }}</span>
      </div>

      <div class="plugin-title-block">
        <h3>{{ plugin.name }}</h3>
        <div class="plugin-meta">
          <span>{{ plugin.category || "General" }}</span>
          <span v-if="plugin.version">v{{ plugin.version }}</span>
        </div>
      </div>
    </div>

    <p class="plugin-description">{{ plugin.description || "暂无描述。" }}</p>

    <div class="plugin-status-row">
      <span class="plugin-status" :class="plugin.status || 'disabled'">
        {{ statusLabel }}
      </span>
      <span :class="plugin.subscribed ? 'subscribed' : 'not-subscribed'">
        {{ plugin.subscribed ? "已订阅" : "未订阅" }}
      </span>
    </div>

    <div class="plugin-card-actions">
      <button
        type="button"
        class="primary-button"
        :class="{ secondary: plugin.enabled }"
        :disabled="!plugin.subscribed"
        @click="$emit('toggle-enabled')"
      >
        {{ plugin.enabled ? "禁用" : "启用" }}
      </button>

      <button
        type="button"
        class="secondary-button"
        :disabled="!plugin.subscribed"
        @click="$emit('open-settings')"
      >
        设置参数
      </button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PluginManifest } from "./plugin.types";

const props = defineProps<{
  plugin: PluginManifest;
}>();

defineEmits<{
  (event: "toggle-enabled"): void;
  (event: "open-settings"): void;
}>();

const statusLabel = computed(() => {
  if (!props.plugin.subscribed) return "未订阅";
  if (!props.plugin.enabled) return "已禁用";

  switch (props.plugin.status) {
    case "ok":
      return "运行正常";
    case "warning":
      return "需要注意";
    case "error":
      return "异常";
    default:
      return "已启用";
  }
});
</script>
