# Simple Plugin Page（简单插件页面）

适用于：配置项较少、包含启用/关闭、运行状态、少量指标、简单列表或日志的插件管理页。

## 设计目标

- 与 BZSS Panel 现有主题一致，不在页面内部硬编码一套颜色。
- 页面业务代码只负责数据和操作，视觉由共享组件负责。
- 默认支持深色主题、窄屏和移动端。
- 简单插件页不要重复编写 `.page / .panel / .metric / .button` 等整套 CSS。
- 危险操作使用 `AppButton variant="danger"`；普通保存使用 `primary`；状态使用 `StatusBadge`。

## 推荐组件

- `components/plugins/SimplePluginPageShell.vue`：页面外壳、标题、刷新、状态、错误/成功提示。
- `components/plugins/SimplePluginPowerCard.vue`：插件启用/关闭主卡片。
- `components/common/PageCard.vue`：配置、日志、预览、列表区块。
- `components/ui/StatGrid.vue`：指标组。
- `components/ui/AppButton.vue`：所有操作按钮。
- `components/ui/AlertBanner.vue`：提示信息。
- `components/ui/StatusBadge.vue`：状态标签。

## 路由

简单插件页建议使用：

```ts
meta: {
  title: "插件名称",
  refreshPolicy: "polling",
  layoutMode: "workspace",
  contentPadding: "none",
  pagePreset: "simple-plugin",
  superAdminOnly: true,
}
```

`pagePreset: "simple-plugin"` 会为旧式页面提供兼容样式，也用于保证页面滚动、最大宽度和响应式行为一致。

## 推荐页面骨架

```vue
<template>
  <SimplePluginPageShell
    eyebrow="PLUGIN"
    title="插件名称"
    subtitle="一句话说明这个插件解决什么问题。"
    :status-label="enabled ? '运行中' : '已关闭'"
    :status-tone="enabled ? 'success' : 'neutral'"
    :updated-at="updatedAt ? `更新于 ${updatedAt}` : ''"
    :loading="loading"
    :error="error"
    :notice="notice"
    @refresh="refreshAll"
  >
    <template #hero>
      <SimplePluginPowerCard
        :enabled="enabled"
        title="自动功能"
        :description="enabled ? '当前会自动执行。' : '当前不会执行任何自动动作。'"
        :loading="saving"
        @toggle="toggleEnabled"
      />
    </template>

    <template #metrics>
      <StatGrid :items="metrics" :loading="loading" />
    </template>

    <PageCard
      title="运行参数"
      description="修改后保存即可生效。"
    >
      <template #actions>
        <AppButton variant="primary" :loading="saving" @click="saveConfig">
          保存配置
        </AppButton>
      </template>

      <div class="plugin-form-grid">
        <label>
          <span>参数 A</span>
          <input v-model.number="form.valueA" type="number">
        </label>
        <label>
          <span>参数 B</span>
          <input v-model="form.valueB" type="text">
        </label>
      </div>
    </PageCard>

    <PageCard title="当前记录" padding="none" overflow="clip">
      <!-- 表格 / 列表 -->
    </PageCard>
  </SimplePluginPageShell>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import PageCard from "../components/common/PageCard.vue";
import AppButton from "../components/ui/AppButton.vue";
import StatGrid, { type StatItem } from "../components/ui/StatGrid.vue";
import SimplePluginPageShell from "../components/plugins/SimplePluginPageShell.vue";
import SimplePluginPowerCard from "../components/plugins/SimplePluginPowerCard.vue";

const enabled = ref(true);
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const notice = ref("");
const updatedAt = ref("");
const form = reactive({ valueA: 10, valueB: "" });

const metrics = computed<StatItem[]>(() => [
  { key: "status", label: "状态", value: enabled.value ? "运行" : "关闭", tone: enabled.value ? "success" : "neutral" },
  { key: "count", label: "当前数量", value: 0, description: "实时统计" },
]);

async function refreshAll() {}
async function toggleEnabled() {}
async function saveConfig() {}
</script>

<style scoped>
.plugin-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 14px;
}

.plugin-form-grid label {
  display: grid;
  gap: 6px;
  color: var(--color-text-secondary);
  font-size: 12px;
}

@media (max-width: 720px) {
  .plugin-form-grid { grid-template-columns: 1fr; }
}
</style>
```

## 页面结构建议

简单插件页优先保持以下顺序：

1. Header：标题、说明、刷新、运行状态。
2. Power Card：唯一的启用/关闭主开关。
3. Metrics：3~5 个最重要的实时数字。
4. Config：可编辑参数和“保存配置”。
5. Secondary：消息预览、诊断说明或手动动作。
6. Data：当前玩家、最近记录、日志或表格。

不要把所有配置、按钮和诊断信息塞进第一屏；主页面首先回答三个问题：插件是否运行、它现在处理了什么、如何关闭它。

## 现有示例

- `/plugins/round-playtime-roster-warning`（开局时长提醒）
- `/plugins/steam-playtime-publicity-reminder`（督促时长公开）

这两个页面通过 `pagePreset: "simple-plugin"` 使用同一套兼容视觉。新页面应优先使用 `SimplePluginPageShell` 与现有共享 UI 组件，而不是继续复制旧页面 CSS。
