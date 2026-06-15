<template>
  <PageCard title="当前状态" description="确认插件是否真正运行，以及当前读取的名单目录和最近一次动作。">
    <DefinitionGrid :items="runtimeItems" />
  </PageCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import PageCard from "../../common/PageCard.vue";
import DefinitionGrid from "../../ui/DefinitionGrid.vue";
import type { DefinitionItemData } from "../../ui/DefinitionGrid.vue";
import { formatDuration, formatTime } from "../../../composables/useDateTimeFormat";
import type { LianbanState } from "./types";

const props = defineProps<{
  state: LianbanState | null;
}>();

const yesNo = (value?: boolean) => value ? "是" : "否";

const runtimeItems = computed<DefinitionItemData[]>(() => [
  { key: "enabled", label: "启用", value: yesNo(props.state?.enabled), tone: props.state?.enabled ? "success" : "warning" },
  { key: "subscribed", label: "订阅", value: yesNo(props.state?.subscribed), tone: props.state?.subscribed ? "success" : "warning" },
  { key: "directory", label: "名单目录", value: props.state?.directory || "-", mono: true, breakAll: true },
  { key: "cacheMs", label: "名单缓存", value: formatDuration(props.state?.cacheMs) },
  { key: "retryCooldownMs", label: "失败冷却", value: formatDuration(props.state?.retryCooldownMs) },
  { key: "lastLoadedAt", label: "最近加载", value: formatTime(props.state?.lastLoadedAt) },
  { key: "lastKickAt", label: "最近踢出", value: formatTime(props.state?.lastKickAt) },
  { key: "lastError", label: "最后错误", value: props.state?.lastError || "-", tone: props.state?.lastError ? "danger" : undefined, breakAll: true },
]);
</script>
