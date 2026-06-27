<template>
  <PageCard title="最近命中" description="显示最近一次匹配到联办名单的玩家信息。">
    <EmptyState v-if="!match" title="还没有命中记录。" compact />
    <DefinitionGrid v-else :items="matchItems" />
  </PageCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import PageCard from "../../components/common/PageCard.vue";
import DefinitionGrid from "../../components/ui/DefinitionGrid.vue";
import EmptyState from "../../components/ui/EmptyState.vue";
import type { DefinitionItemData } from "../../components/ui/DefinitionGrid.vue";
import { formatTime } from "../../composables/useDateTimeFormat";
import type { LianbanLastMatch } from "./types";

const props = defineProps<{
  match?: LianbanLastMatch | null;
}>();

const matchItems = computed<DefinitionItemData[]>(() => [
  { key: "playerName", label: "玩家", value: props.match?.playerName || "-", breakAll: true },
  { key: "steamID", label: "SteamID", value: props.match?.steamID || "-", mono: true, breakAll: true },
  { key: "eosID", label: "EOSID", value: props.match?.eosID || "-", mono: true, breakAll: true },
  { key: "matchType", label: "匹配方式", value: props.match?.matchType || "-" },
  { key: "matchValue", label: "匹配值", value: props.match?.matchValue || "-", breakAll: true },
  { key: "at", label: "时间", value: formatTime(props.match?.at) },
]);
</script>
