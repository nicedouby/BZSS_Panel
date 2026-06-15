<template>
  <PageWorkspace
    :title="title"
    :loading="loading"
    :refreshing="refreshing"
    :error="error"
    :stale="stale"
    body-mode="flow"
  >
    <template #status>
      <slot name="status">
        <StatusBadge v-if="statusLabel" :tone="statusTone" dot>{{ statusLabel }}</StatusBadge>
        <StatusBadge v-if="enabled != null" :tone="enabled ? 'success' : 'warning'">
          {{ enabled ? "已启用" : "已停用" }}
        </StatusBadge>
        <StatusBadge v-if="subscribed != null" :tone="subscribed ? 'success' : 'warning'">
          {{ subscribed ? "已订阅" : "未订阅" }}
        </StatusBadge>
      </slot>
    </template>

    <template #toolbar>
      <slot name="toolbar" />
    </template>

    <template #actions>
      <slot name="actions" />
      <AppButton size="sm" variant="ghost" :loading="refreshing || loading" @click="$emit('refresh')">
        {{ refreshing || loading ? "刷新中..." : "刷新" }}
      </AppButton>
    </template>

    <slot name="summary" />
    <slot />

    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </PageWorkspace>
</template>

<script setup lang="ts">
import PageWorkspace from "../../layout/PageWorkspace.vue";
import AppButton from "../../ui/AppButton.vue";
import StatusBadge from "../../ui/StatusBadge.vue";
import type { StatusTone } from "../../ui/StatusBadge.vue";

defineEmits<{
  refresh: [];
  toggle: [];
  "open-settings": [];
}>();

withDefaults(defineProps<{
  title: string;
  statusLabel?: string;
  statusTone?: StatusTone;
  loading?: boolean;
  refreshing?: boolean;
  error?: string;
  stale?: boolean;
  enabled?: boolean;
  subscribed?: boolean;
}>(), {
  statusLabel: "",
  statusTone: "neutral",
  loading: false,
  refreshing: false,
  error: "",
  stale: false,
  enabled: undefined,
  subscribed: undefined,
});
</script>
