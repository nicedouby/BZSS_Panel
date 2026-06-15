<template>
  <div class="bz-data-state" :class="`bz-data-state--${mode}`" v-bind="$attrs">
    <div v-if="loading" class="state-block">
      <strong>{{ loadingTitle }}</strong>
      <p>{{ loadingText }}</p>
    </div>
    <div v-else-if="error" class="state-block error">
      <strong>{{ errorTitle }}</strong>
      <p>{{ error }}</p>
    </div>
    <EmptyState
      v-else-if="empty"
      :title="emptyTitle"
      :description="emptyText"
      :compact="mode === 'flow'"
    />
    <div v-else class="state-shell">
      <div v-if="stale" class="state-banner-row">
        <div class="stale-banner">
          <span>{{ staleText }}</span>
        </div>
      </div>
      <div class="state-content">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watchEffect } from "vue";
import { useRoute } from "vue-router";
import { t } from "../../i18n";
import EmptyState from "../ui/EmptyState.vue";

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(defineProps<{
  loading?: boolean;
  error?: string;
  empty?: boolean;
  stale?: boolean;
  mode?: "flow" | "fill";
  loadingTitle?: string;
  loadingText?: string;
  errorTitle?: string;
  emptyTitle?: string;
  emptyText?: string;
  staleText?: string;
}>(), {
  loading: false,
  error: "",
  empty: false,
  stale: false,
  mode: "flow",
  loadingTitle: t("common.loading", "Loading"),
  loadingText: t("dataState.loadingText", "Fetching the latest data."),
  errorTitle: t("dataState.errorTitle", "Request failed"),
  emptyTitle: t("common.noData", "No data"),
  emptyText: t("dataState.emptyText", "Nothing to show here yet."),
  staleText: t("dataState.staleText", "Showing cached data because the latest sync failed."),
});

const route = useRoute();
const layoutMode = computed(() => String(route.meta?.layoutMode ?? ""));

watchEffect(() => {
  if (import.meta.env.DEV && layoutMode.value === "workspace" && props.mode === "flow") {
    console.warn("[layout] DataState in workspace page is using flow mode");
  }
});
</script>

<style scoped>
.bz-data-state {
  min-height: 0;
}

.bz-data-state--flow {
  display: block;
}

.bz-data-state--fill {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.state-shell {
  min-height: 0;
}

.bz-data-state--flow .state-shell {
  display: grid;
  gap: 10px;
}

.bz-data-state--fill .state-shell {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  overflow: hidden;
}

.state-banner-row {
  padding: 0 0 10px;
}

.state-content {
  min-height: 0;
}

.bz-data-state--flow .state-content {
  display: block;
}

.bz-data-state--fill .state-content {
  display: grid;
  height: 100%;
  overflow: hidden;
}

.state-block {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
}

.bz-data-state--fill .state-block {
  flex: 1;
}

.state-block,
.stale-banner {
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.016)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-card);
  border-radius: 16px;
  padding: 16px 18px;
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(12px);
}

.state-block.error {
  border-color: rgba(248, 113, 113, 0.3);
  background:
    linear-gradient(180deg, rgba(248, 113, 113, 0.09), rgba(255, 255, 255, 0.02)),
    var(--color-bg-card);
}

.state-block strong,
.state-block p {
  display: block;
}

.state-block strong {
  font-size: 15px;
}

.state-block p {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.state-block.error p {
  color: #ffc4c4;
}

.stale-banner {
  border-color: rgba(245, 158, 11, 0.28);
  background:
    linear-gradient(180deg, rgba(245, 158, 11, 0.12), rgba(255, 255, 255, 0.02)),
    var(--color-bg-card);
  color: #f5d37a;
  font-size: 12px;
  padding: 10px 12px;
}
</style>
