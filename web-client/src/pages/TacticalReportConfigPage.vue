<template>
  <PluginPageShell
    title="战术报点配置"
    :status-label="statusLabel"
    :status-tone="statusTone"
    :loading="loading"
    :refreshing="refreshing"
    :error="error"
    :stale="stale"
    :enabled="state?.enabled"
    @refresh="refresh"
  >
    <template #actions>
      <button type="button" class="btn primary" :disabled="saving" @click="saveConfig">
        {{ saving ? "保存中..." : "保存配置" }}
      </button>
    </template>

    <template #summary>
      <StatGrid :items="summaryItems" :loading="loading && !state" />
    </template>

    <div class="config-layout">
      <PageCard title="基本配置" description="修改 zsbd /0-/9 的默认内容，以及个人快捷码规则。">
        <div class="field-grid">
          <label class="field">
            <span>触发词</span>
            <input v-model.trim="draft.triggerText" class="input" type="text" />
          </label>
          <label class="field">
            <span>个人冷却(秒)</span>
            <input v-model.number="draft.playerCooldownSeconds" class="input" type="number" min="0" />
          </label>
          <label class="field">
            <span>/help 冷却(秒)</span>
            <input v-model.number="draft.helpGlobalCooldownSeconds" class="input" type="number" min="0" />
          </label>
          <label class="field">
            <span>消息最大长度</span>
            <input v-model.number="draft.maxMessageLength" class="input" type="number" min="20" />
          </label>
        </div>
      </PageCard>

      <PageCard title="预设内容" description="zsbd /0-/9 的对应内容。">
        <div class="codes-grid">
          <label v-for="code in codeKeys" :key="code" class="code-field">
            <span>{{ code }}</span>
            <textarea v-model="draft.defaultCodes[code]" class="textarea" rows="2" />
          </label>
        </div>
      </PageCard>
    </div>

    <PageCard title="帮助预览" description="这里展示最终 /help 会广播的内容。">
      <pre class="preview">{{ helpPreview }}</pre>
    </PageCard>
  </PluginPageShell>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from "vue";

import { apiGet, apiPost } from "../app/apiClient";
import PluginPageShell from "../components/domain/plugin/PluginPageShell.vue";
import PageCard from "../components/common/PageCard.vue";
import StatGrid from "../components/ui/StatGrid.vue";
import type { StatItem } from "../components/ui/StatGrid.vue";
import type { StatusTone } from "../components/ui/StatusBadge.vue";
import { usePollingResource } from "../composables/usePollingResource";

type TacticalReportConfig = {
  enabled: boolean;
  triggerText: string;
  playerCooldownSeconds: number;
  helpGlobalCooldownSeconds: number;
  maxMessageLength: number;
  defaultCodes: Record<string, string>;
};

const { data: state, loading, refreshing, error, stale, refresh } = usePollingResource<TacticalReportConfig | null>({
  fetcher: async () => {
    const response = await apiGet<{ ok: boolean; data: TacticalReportConfig | null }>("/api/plugins/tactical-report/config");
    return response?.data ?? null;
  },
  intervalMs: 5000,
  immediate: true,
  pauseWhenHidden: true,
  refreshOnActivated: true,
  keepPreviousData: true,
});

const draft = reactive<TacticalReportConfig>({
  enabled: true,
  triggerText: "ZSBD",
  playerCooldownSeconds: 10,
  helpGlobalCooldownSeconds: 30,
  maxMessageLength: 120,
  defaultCodes: {},
});

const codeKeys = ["/0", "/1", "/2", "/3", "/4", "/5", "/6", "/7", "/8", "/9"];
const saving = computed(() => false);

const statusLabel = computed(() => (state.value?.enabled ? "运行中" : "已停用"));
const statusTone = computed<StatusTone>(() => (state.value?.enabled ? "success" : "warning"));

const summaryItems = computed<StatItem[]>(() => [
  { key: "trigger", label: "触发词", value: draft.triggerText, description: "支持小写 zsbd", tone: "info" },
  { key: "player", label: "个人冷却", value: `${draft.playerCooldownSeconds}s`, description: "发送者自己的报点冷却", tone: "neutral" },
  { key: "help", label: "/help 冷却", value: `${draft.helpGlobalCooldownSeconds}s`, description: "全服帮助广播冷却", tone: "neutral" },
  { key: "len", label: "消息长度", value: draft.maxMessageLength, description: "过长会自动分段", tone: "info" },
]);

watch(state, (next) => {
  if (!next) return;
  draft.enabled = next.enabled;
  draft.triggerText = next.triggerText ?? "ZSBD";
  draft.playerCooldownSeconds = next.playerCooldownSeconds ?? 10;
  draft.helpGlobalCooldownSeconds = next.helpGlobalCooldownSeconds ?? 30;
  draft.maxMessageLength = next.maxMessageLength ?? 120;
  draft.defaultCodes = { ...next.defaultCodes };
}, { immediate: true });

const helpPreview = computed(() => {
  const lines = [
    "战术报点使用指南：",
    `触发词：${draft.triggerText}`,
    "zsbd 内容 发送战术报点。",
    "zsbd /0-/9 使用预设快捷报点。",
    "zsbd /set /10 内容 设置个人快捷报点。",
    "预设快捷报点：",
  ];
  for (const code of codeKeys) {
    lines.push(`${code} ${draft.defaultCodes[code] ?? ""}`.trim());
  }
  return lines.join("\n");
});

async function saveConfig() {
  await apiPost("/api/plugins/tactical-report/config", {
    enabled: draft.enabled,
    triggerText: draft.triggerText,
    playerCooldownSeconds: draft.playerCooldownSeconds,
    helpGlobalCooldownSeconds: draft.helpGlobalCooldownSeconds,
    maxMessageLength: draft.maxMessageLength,
    defaultCodes: draft.defaultCodes,
  });
  await refresh();
}
</script>

<style scoped>
.config-layout {
  display: grid;
  grid-template-columns: 1fr 1.1fr;
  gap: 16px;
}

.codes-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.code-field {
  display: grid;
  gap: 6px;
}

.preview {
  white-space: pre-wrap;
}
</style>
