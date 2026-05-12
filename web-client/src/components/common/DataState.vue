<template>
  <div v-if="loading" class="state-block">
    <strong>{{ loadingTitle }}</strong>
    <p>{{ loadingText }}</p>
  </div>
  <div v-else-if="error" class="state-block error">
    <strong>{{ errorTitle }}</strong>
    <p>{{ error }}</p>
  </div>
  <div v-else-if="empty" class="state-block">
    <strong>{{ emptyTitle }}</strong>
    <p>{{ emptyText }}</p>
  </div>
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
</template>

<script setup lang="ts">
import { t } from "../../i18n";

withDefaults(defineProps<{
  loading?: boolean;
  error?: string;
  empty?: boolean;
  stale?: boolean;
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
  loadingTitle: t("common.loading", "Loading"),
  loadingText: t("dataState.loadingText", "Fetching the latest data."),
  errorTitle: t("dataState.errorTitle", "Request failed"),
  emptyTitle: t("common.noData", "No data"),
  emptyText: t("dataState.emptyText", "Nothing to show here yet."),
  staleText: t("dataState.staleText", "Showing cached data because the latest sync failed."),
});
</script>

<style scoped>
.state-shell {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.state-banner-row {
  padding: 12px 12px 0;
}

.state-content {
  display: grid;
  min-height: 0;
  overflow: hidden;
}

.state-block,
.stale-banner {
  border: 1px solid #2c343d;
  background: #171d23;
  border-radius: 8px;
  padding: 16px;
}

.state-block.error {
  border-color: #5d3131;
  background: #211719;
}

.state-block strong,
.state-block p {
  display: block;
}

.state-block strong {
  font-size: 14px;
}

.state-block p {
  margin: 6px 0 0;
  font-size: 13px;
  color: #9aa7b2;
}

.state-block.error p {
  color: #ffb5b5;
}

.stale-banner {
  border-color: #786633;
  background: #221d12;
  color: #f1d58b;
  font-size: 12px;
}
</style>
