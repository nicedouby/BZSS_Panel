<template>
  <div class="app-root" :class="ui.uiClassList">
    <div v-if="!auth.checked" class="boot-screen">
      <div class="boot-card">{{ t("app.checkingAuth") }}</div>
    </div>
    <LoginPage v-else-if="!auth.authenticated" />
    <AppLayout v-else />
  </div>
</template>

<script setup lang="ts">
import { onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { useRouter } from "vue-router";
import AppLayout from "./components/layout/AppLayout.vue";
import LoginPage from "./pages/LoginPage.vue";
import { useAuthStore } from "./stores/auth.store";
import { useUiStore } from "./stores/ui.store";
import { setRuntimeSyncRefreshPolicy, startRuntimeSync, stopRuntimeSync } from "./app/runtimeSync";
import { canAccessPage, normalizePermissionList } from "./shared/web-page-permissions.js";
import { t } from "./i18n";

const auth = useAuthStore();
const ui = useUiStore();
const route = useRoute();
const router = useRouter();

onMounted(() => {
  void auth.restoreSession();
});

watch(
  () => [auth.checked, auth.authenticated, route.fullPath, route.meta.requiredPermission, route.meta.legacyRequiredPermissions, route.meta.superAdminOnly] as const,
  ([checked, authenticated]) => {
    if (!checked || !authenticated) return;
    if (route.meta.superAdminOnly && !auth.user?.isSuperAdmin) {
      const current = String(route.fullPath ?? route.path ?? "/").trim() || "/";
      void router.replace({ path: "/access-denied", query: { from: current } });
      return;
    }

    const requiredPermission = String(route.meta.requiredPermission ?? "").trim();
    if (!requiredPermission) return;
    if (route.path === "/access-denied") return;

    const user = auth.user as {
      permissions?: unknown;
      permission?: unknown;
      isSuperAdmin?: boolean;
    } | null | undefined;
    const legacyPermissions = normalizePermissionList(route.meta.legacyRequiredPermissions);
    if (canAccessPage(user, requiredPermission, legacyPermissions, {
      superAdminOnly: Boolean(route.meta.superAdminOnly),
    })) return;

    const current = String(route.fullPath ?? route.path ?? "/").trim() || "/";
    void router.replace({ path: "/access-denied", query: { from: current } });
  },
  { immediate: true },
);

watch(
  () => [auth.authenticated, route.meta.refreshPolicy] as const,
  ([authenticated, refreshPolicy]) => {
    setRuntimeSyncRefreshPolicy(refreshPolicy);
    if (authenticated) startRuntimeSync();
    else stopRuntimeSync();
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
</script>

<style>
:root {
  font-family: "Segoe UI Variable Text", "Inter", "PingFang SC", "Microsoft YaHei", sans-serif;
  background: var(--color-bg-page);
  color: var(--color-text-primary);
  --app-background: var(--color-bg-page);
}

* {
  box-sizing: border-box;
}

html,
body,
#app {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

body {
  margin: 0;
  min-width: 320px;
  overflow: hidden;
  background: var(--color-bg-page);
  color: var(--color-text-primary);
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

button,
input,
select,
textarea {
  font: inherit;
}

button,
input,
select,
textarea {
  border-radius: 12px;
}

button {
  border: 1px solid var(--color-border-default);
  background:
    var(--theme-panel-highlight),
    var(--color-bg-elevated);
  color: var(--color-text-primary);
  padding: clamp(6px, 0.7vw, 8px) clamp(10px, 1.1vw, 14px);
  cursor: pointer;
  box-shadow: var(--shadow-sm), 0 0 0 1px var(--theme-panel-rim);
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
}

button:hover:not(:disabled) {
  border-color: var(--color-border-highlight);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
}

input,
select,
textarea {
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  padding: clamp(7px, 0.8vw, 10px) clamp(9px, 1vw, 12px);
  transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
}

input::placeholder,
textarea::placeholder {
  color: var(--color-text-muted);
}

button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}

a {
  color: inherit;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

#app {
  height: 100%;
}

.app-root {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  color: var(--color-text-primary);
  background: var(--app-background, var(--color-bg-page));
  isolation: isolate;
  overflow: hidden;
}

.app-root::before,
.app-root::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.app-root::before {
  z-index: 0;
  background: var(--theme-root-overlay);
  opacity: 1;
}

.app-root::after {
  z-index: 0;
  background-image:
    linear-gradient(var(--theme-grid-color) 1px, transparent 1px),
    linear-gradient(90deg, var(--theme-grid-color) 1px, transparent 1px);
  background-size: 72px 72px;
  mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.65), transparent 82%);
  opacity: 0.18;
}

.app-root > * {
  position: relative;
  z-index: 1;
}

.boot-screen {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--app-background, var(--color-bg-page));
}

.boot-card {
  width: min(420px, 100%);
  border: 1px solid var(--color-border-default);
  background:
    var(--theme-panel-highlight),
    var(--color-bg-card);
  border-radius: 20px;
  padding: 20px 22px;
  color: var(--color-text-primary);
  box-shadow: var(--shadow-lg), var(--theme-panel-glow);
  backdrop-filter: blur(12px);
}

.page {
  display: grid;
  gap: 16px;
}

.bz-page {
  width: min(100%, 1760px);
  margin: 0 auto;
  padding: clamp(10px, 1.4vw, 18px) clamp(12px, 1.8vw, 22px) clamp(14px, 2vw, 28px);
  display: grid;
  gap: clamp(10px, 1.2vw, 14px);
  min-width: 0;
}

.bz-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.bz-page-title {
  margin: 0;
  font-size: clamp(22px, 2.1vw, 30px);
  line-height: 1.15;
  letter-spacing: -0.03em;
}

.bz-page-subtitle {
  margin: 6px 0 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.55;
  max-width: 74ch;
}

.bz-page-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.bz-card {
  border: 1px solid var(--color-border-default);
  background:
    var(--theme-panel-highlight),
    var(--color-bg-card);
  border-radius: clamp(12px, 1.6vw, 18px);
  box-shadow: var(--shadow-md), var(--theme-panel-glow);
  overflow: hidden;
  backdrop-filter: blur(12px);
}

.bz-card-header {
  padding: 16px 18px 0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.bz-card-title {
  margin: 0;
  font-size: 16px;
  line-height: 1.3;
  color: var(--color-text-primary);
}

.bz-card-desc {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.bz-card-body {
  padding: 18px;
}

.bz-card-body.compact {
  padding: 14px 16px;
}

.bz-empty {
  min-height: 220px;
  border: 1px dashed var(--color-border-highlight);
  border-radius: 16px;
  background:
    radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--color-brand-primary) 16%, transparent), transparent 38%),
    color-mix(in srgb, var(--color-bg-elevated) 72%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 20px;
  text-align: center;
}

.bz-empty--compact {
  min-height: 156px;
  padding: 22px 18px;
}

.bz-empty-inner {
  max-width: 520px;
}

.bz-empty-icon {
  width: 42px;
  height: 42px;
  margin: 0 auto 12px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--color-brand-primary) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-brand-primary) 24%, transparent);
  color: color-mix(in srgb, var(--color-brand-primary) 72%, white 28%);
  font-size: 18px;
}

.bz-empty-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--color-text-primary);
  margin-bottom: 6px;
}

.bz-empty-desc {
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-secondary);
}

.bz-empty-actions {
  margin-top: 16px;
  display: flex;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
}

.bz-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid var(--color-border-default);
  background:
    var(--theme-panel-highlight),
    color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
  color: var(--color-text-primary);
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
}

.bz-btn:hover:not(:disabled) {
  border-color: var(--color-border-highlight);
  background: var(--color-bg-hover);
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.bz-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
}

.bz-btn-primary {
  border-color: color-mix(in srgb, var(--color-brand-primary) 55%, transparent);
  background: color-mix(in srgb, var(--color-brand-primary) 28%, transparent);
  box-shadow: 0 0 22px color-mix(in srgb, var(--theme-brand-glow) 80%, transparent);
}

.bz-btn-danger {
  border-color: rgba(255, 100, 100, 0.55);
  background: rgba(120, 36, 36, 0.34);
}

.bz-btn-ghost {
  background: transparent;
}

.bz-badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--color-border-default) 88%, transparent);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--theme-panel-rim) 85%, transparent), transparent),
    color-mix(in srgb, var(--color-border-default) 55%, transparent);
  color: var(--color-text-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.bz-badge-danger {
  border-color: rgba(248, 113, 113, 0.35);
  background: rgba(248, 113, 113, 0.1);
  color: #fecaca;
}

.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}

.page-title {
  margin: 0;
  font-size: clamp(20px, 1.9vw, 28px);
  line-height: 1.18;
  letter-spacing: -0.02em;
}

.page-subtitle {
  margin: 6px 0 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.55;
  max-width: 72ch;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}

.stat,
.panel {
  border: 1px solid var(--color-border-default);
  background:
    var(--theme-panel-highlight),
    var(--color-bg-card);
  border-radius: 16px;
  box-shadow: var(--shadow-md), var(--theme-panel-glow);
  backdrop-filter: blur(12px);
}

.stat {
  padding: 12px 14px;
}

.stat span {
  display: block;
  color: var(--color-text-muted);
  font-size: 12px;
}

.stat strong {
  display: block;
  margin-top: 4px;
  font-size: 20px;
  line-height: 1.2;
}

.panel {
  overflow: hidden;
}

.workspace-page {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.workspace-fill {
  min-width: 0;
  min-height: 0;
}

.scroll-region {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.scroll-region-y {
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.scroll-region-x {
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.muted {
  color: var(--color-text-secondary);
}

::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--color-border-default) 90%, transparent);
  border: 3px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}

::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--color-border-highlight) 80%, transparent);
  border: 3px solid transparent;
  background-clip: padding-box;
}

@media (max-width: 1100px) {
  .bz-card-body {
    padding: 14px;
  }
}

@media (max-width: 900px) {
  .stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 480px) {
  .stat-grid {
    grid-template-columns: 1fr;
  }

  .bz-page {
    padding: 8px 10px 12px;
    gap: 8px;
  }

  .bz-card {
    border-radius: 12px;
  }

  .bz-card-body {
    padding: 10px 12px;
  }

  button,
  input,
  select,
  textarea {
    border-radius: 8px;
  }
}
</style>
