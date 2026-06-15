<template>
  <section class="page-workspace" :class="`page-workspace--${bodyMode}`">
    <h1 class="sr-only">{{ title }}</h1>

    <WorkspaceToolbar v-if="$slots.status || $slots.toolbar || $slots.actions" class="page-workspace__toolbar">
      <slot name="status" />
      <slot name="toolbar" />
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </WorkspaceToolbar>

    <AlertBanner v-if="error" tone="danger" :message="error" />
    <AlertBanner v-else-if="stale" tone="warning" message="最新同步失败，当前显示的是缓存数据。" />

    <DataState
      :loading="loading"
      :empty="empty"
      :stale="false"
      mode="fill"
      class="page-workspace__state"
    >
      <template v-if="empty && $slots.empty">
        <slot name="empty" />
      </template>
      <div v-else class="page-workspace__body">
        <slot />
      </div>
    </DataState>

    <footer v-if="$slots.footer" class="page-workspace__footer">
      <slot name="footer" />
    </footer>
  </section>
</template>

<script setup lang="ts">
import AlertBanner from "../ui/AlertBanner.vue";
import DataState from "../common/DataState.vue";
import WorkspaceToolbar from "../common/WorkspaceToolbar.vue";

withDefaults(defineProps<{
  title: string;
  loading?: boolean;
  refreshing?: boolean;
  error?: string;
  empty?: boolean;
  stale?: boolean;
  bodyMode?: "flow" | "fill" | "scroll";
}>(), {
  loading: false,
  refreshing: false,
  error: "",
  empty: false,
  stale: false,
  bodyMode: "flow",
});
</script>

<style scoped>
.page-workspace {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: var(--layout-gap-md, 16px);
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: clamp(12px, 1.4vw, 18px);
  overflow: hidden;
}

.page-workspace__toolbar,
.page-workspace__footer,
.page-workspace__state,
.page-workspace__body {
  min-width: 0;
  min-height: 0;
}

.page-workspace__state {
  overflow: hidden;
}

.page-workspace__body {
  height: 100%;
}

.page-workspace--flow .page-workspace__body {
  display: grid;
  align-content: start;
  gap: var(--layout-gap-md, 16px);
  overflow: auto;
  scrollbar-gutter: stable;
}

.page-workspace--fill .page-workspace__body {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
}

.page-workspace--scroll .page-workspace__body {
  overflow: auto;
  scrollbar-gutter: stable;
}
</style>
