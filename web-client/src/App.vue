<template>
  <div class="app-root" :class="ui.uiClassList">
    <RouterView v-if="isPublicSnapshotRoute" />
    <template v-else>
      <AppLayout v-if="auth.authenticated" />
      <div v-else-if="!auth.checked" class="boot-screen">
        <div class="boot-card">{{ t("app.checkingAuth") }}</div>
      </div>
      <LoginPage v-else />

      <div
        v-if="auth.authenticated && !auth.sessionVerified"
        class="session-restore-indicator"
        :class="{ 'has-error': Boolean(auth.error) && !auth.restoring }"
        role="status"
        aria-live="polite"
      >
        <span class="session-restore-dot"></span>
        <span>{{ auth.restoring ? "正在后台恢复登录状态" : "登录状态暂未确认，正在重试" }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, watch } from "vue";
import { RouterView, useRoute } from "vue-router";
import AppLayout from "./components/layout/AppLayout.vue";
import LoginPage from "./pages/LoginPage.vue";
import {
  startPageFrameworkPreload,
  stopPageFrameworkPreload,
} from "./app/pageFrameworkPreloader";
import { setRuntimeSyncRefreshPolicy, startRuntimeSync, stopRuntimeSync } from "./app/runtimeSync";
import { t } from "./i18n";
import { useAuthStore } from "./stores/auth.store";
import { useUiStore } from "./stores/ui.store";
import { attachGlobalKeyboardProtections } from "./utils/keyboard";

let removeKeyboardProtections: (() => void) | null = null;
onMounted(() => {
  removeKeyboardProtections = attachGlobalKeyboardProtections();
});

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
  if (!auth.authenticated || !auth.sessionVerified || typeof window === "undefined") return;

  const schedule = () => {
    runtimeStartFrame = null;
    runtimeStartTimer = window.setTimeout(() => {
      runtimeStartTimer = null;
      if (auth.authenticated && auth.sessionVerified) startRuntimeSync();
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
  () => route.path,
  (path) => {
    if (auth.authenticated && auth.sessionVerified) {
      startPageFrameworkPreload(auth.user, path);
    }
  },
  { flush: "post" },
);

watch(
  () => [auth.authenticated, auth.sessionVerified] as const,
  ([authenticated, sessionVerified]) => {
    if (authenticated && sessionVerified) {
      deferRuntimeStart();
      startPageFrameworkPreload(auth.user, route.path);
      return;
    }
    cancelDeferredRuntimeStart();
    stopRuntimeSync();
    stopPageFrameworkPreload();
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
  if (removeKeyboardProtections) removeKeyboardProtections();
  cancelDeferredRuntimeStart();
  stopPageFrameworkPreload();
});
</script>

<style scoped>
.session-restore-indicator {
  position: fixed;
  top: max(12px, env(safe-area-inset-top));
  right: max(12px, env(safe-area-inset-right));
  z-index: 10000;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: min(360px, calc(100vw - 24px));
  padding: 8px 12px;
  border: 1px solid rgba(56, 189, 248, 0.22);
  border-radius: 999px;
  background: rgba(5, 12, 24, 0.78);
  color: rgba(226, 232, 240, 0.9);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.24);
  backdrop-filter: blur(10px);
  pointer-events: none;
  font-size: 12px;
}

.session-restore-indicator.has-error {
  border-color: rgba(245, 158, 11, 0.32);
}

.session-restore-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #38bdf8;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.72);
  animation: session-restore-pulse 1.1s ease-in-out infinite alternate;
}

.session-restore-indicator.has-error .session-restore-dot {
  background: #f59e0b;
  box-shadow: 0 0 10px rgba(245, 158, 11, 0.68);
}

@keyframes session-restore-pulse {
  from { opacity: 0.45; transform: scale(0.84); }
  to { opacity: 1; transform: scale(1); }
}
</style>
