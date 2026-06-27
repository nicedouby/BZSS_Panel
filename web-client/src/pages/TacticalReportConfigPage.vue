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

    <div class="config-grid">
      <PageCard title="基础设置" description="插件启用、触发词、冷却与长度控制。">
        <div class="field-grid">
          <label class="field">
            <span>启用</span>
            <input v-model="draft.enabled" type="checkbox" />
          </label>
          <label class="field">
            <span>触发词</span>
            <input v-model.trim="draft.triggerText" class="input" type="text" />
          </label>
          <label class="field">
            <span>普通报点冷却(秒)</span>
            <input v-model.number="draft.playerCooldownSeconds" class="input" type="number" min="0" />
          </label>
          <label class="field">
            <span>/help 全局冷却(秒)</span>
            <input v-model.number="draft.helpGlobalCooldownSeconds" class="input" type="number" min="0" />
          </label>
          <label class="field">
            <span>最大消息长度</span>
            <input v-model.number="draft.maxMessageLength" class="input" type="number" min="20" />
          </label>
          <label class="field">
            <span>RCON 并发数量</span>
            <input v-model.number="draft.rconPoolSize" class="input" type="number" min="1" />
          </label>
        </div>
      </PageCard>

      <PageCard title="默认快捷报点" description="/1 到 /9 的默认内容，可直接编辑。">
        <div class="codes-grid">
          <label v-for="code in codeKeys" :key="code" class="code-field">
            <span>{{ code }}</span>
            <textarea v-model="draft.defaultCodes[code]" class="textarea" rows="2" />
          </label>
        </div>
      </PageCard>
    </div>

    <PageCard title="帮助预览" description="当前 /help 会广播的完整内容。">
      <pre class="preview">{{ helpPreview }}</pre>
    </PageCard>
  </PluginPageShell>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

import { apiGet, apiPost } from "../app/apiClient";
import PluginPageShell from "../features/plugins/PluginPageShell.vue";
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
  rconPoolSize: number;
  defaultCodes: Record<string, string>;
};

const codeKeys = ["/1", "/2", "/3", "/4", "/5", "/6", "/7", "/8", "/9"];
const saving = ref(false);

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
  rconPoolSize: 6,
  defaultCodes: Object.fromEntries(codeKeys.map((code) => [code, ""])),
});

const statusLabel = computed(() => (state.value?.enabled ? "运行中" : "已停用"));
const statusTone = computed<StatusTone>(() => (state.value?.enabled ? "success" : "warning"));

const summaryItems = computed<StatItem[]>(() => [
  { key: "enabled", label: "启用状态", value: draft.enabled ? "启用" : "停用", description: "保存后立即生效", tone: draft.enabled ? "success" : "warning" },
  { key: "trigger", label: "触发词", value: draft.triggerText, description: "默认 ZSBD", tone: "info" },
  { key: "cooldown", label: "玩家冷却", value: `${draft.playerCooldownSeconds}s`, description: "/help 冷却独立计算", tone: "neutral" },
  { key: "len", label: "消息长度", value: draft.maxMessageLength, description: "超长内容会自动截断", tone: "info" },
]);

watch(state, (next) => {
  if (!next) return;
  draft.enabled = next.enabled;
  draft.triggerText = next.triggerText ?? "ZSBD";
  draft.playerCooldownSeconds = next.playerCooldownSeconds ?? 10;
  draft.helpGlobalCooldownSeconds = next.helpGlobalCooldownSeconds ?? 30;
  draft.maxMessageLength = next.maxMessageLength ?? 120;
  draft.rconPoolSize = next.rconPoolSize ?? 6;
  draft.defaultCodes = {
    ...Object.fromEntries(codeKeys.map((code) => [code, ""])),
    ...(next.defaultCodes ?? {}),
  };
}, { immediate: true });

const helpPreview = computed(() => {
  const lines = [
    "战术报点使用指南：",
    `触发词：${draft.triggerText}`,
    "zsbd 内容 发送战术报点。",
    "zsbd /0-/9 使用默认快捷报点。",
    "zsbd /set /10 内容 设置个人快捷报点。",
    "默认快捷报点：",
  ];
  for (const code of codeKeys) {
    lines.push(`${code} ${draft.defaultCodes[code] ?? ""}`.trim());
  }
  return lines.join("\n");
});

async function saveConfig() {
  saving.value = true;
  try {
    await apiPost("/api/plugins/tactical-report/config", {
      enabled: draft.enabled,
      triggerText: draft.triggerText,
      playerCooldownSeconds: draft.playerCooldownSeconds,
      helpGlobalCooldownSeconds: draft.helpGlobalCooldownSeconds,
      maxMessageLength: draft.maxMessageLength,
      rconPoolSize: draft.rconPoolSize,
      defaultCodes: draft.defaultCodes,
    });
    await refresh();
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.config-grid {
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

@media (max-width: 1100px) {
  .config-grid,
  .codes-grid {
    grid-template-columns: 1fr;
  }
}
</style>
