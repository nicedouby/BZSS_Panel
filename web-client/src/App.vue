<template>
  <div class="app-root" :class="ui.uiClassList">
    <div v-if="!auth.checked" class="boot-screen">
      <div class="boot-card">{{ t("app.checkingAuth") }}</div>
    </div>
    <RouterView v-else-if="isPublicSnapshotRoute" />
    <LoginPage v-else-if="!auth.authenticated" />
    <AppLayout v-else />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from "vue";
import { RouterView, useRoute } from "vue-router";
import AppLayout from "./components/layout/AppLayout.vue";
import LoginPage from "./pages/LoginPage.vue";
import { setRuntimeSyncRefreshPolicy, startRuntimeSync, stopRuntimeSync } from "./app/runtimeSync";
import { t } from "./i18n";
import { useAuthStore } from "./stores/auth.store";
import { useUiStore } from "./stores/ui.store";

const RUNTIME_START_DELAY_MS = 180;

const auth = useAuthStore();
const ui = useUiStore();
const route = useRoute();
const isPublicSnapshotRoute = computed(() => route.path === "/astrbot/server-info-card");

let runtimeStartFrame: number | null = null;
let runtimeStartTimer: number | null = null;

function cancelDeferredRuntimeStart() {
  if (runtimeStartFrame != null && typeof window !== "undefined") {
    window.cancelAnimationFrame(runtimeStartFrame);
    runtimeStartFrame = null;
  }
  if (runtimeStartTimer != null && typeof window !== "undefined") {
    window.clearTimeout(runtimeStartTimer);
    runtimeStartTimer = null;
  }
}

function deferRuntimeStart() {
  cancelDeferredRuntimeStart();
  if (!auth.authenticated || typeof window === "undefined") return;

  const schedule = () => {
    runtimeStartFrame = null;
    runtimeStartTimer = window.setTimeout(() => {
      runtimeStartTimer = null;
      if (auth.authenticated) startRuntimeSync();
    }, RUNTIME_START_DELAY_MS);
  };

  if (typeof window.requestAnimationFrame === "function") {
    runtimeStartFrame = window.requestAnimationFrame(schedule);
  } else {
    schedule();
  }
}

watch(
  () => route.meta.refreshPolicy,
  (refreshPolicy) => setRuntimeSyncRefreshPolicy(refreshPolicy),
  { immediate: true },
);

watch(
  () => auth.authenticated,
  (authenticated) => {
    if (authenticated) {
      deferRuntimeStart();
      return;
    }
    cancelDeferredRuntimeStart();
    stopRuntimeSync();
  },
  { immediate: true },
);

watch(
  () => [route.meta.titleKey, route.meta.title],
  ([titleKey, title]) => {
    const localized = titleKey ? t(String(titleKey), String(title ?? "")) : String(title ?? "");
    document.title = localized ? `BZSS Panel | ${localized}` : "BZSS Panel";
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  cancelDeferredRuntimeStart();
});
</script>
