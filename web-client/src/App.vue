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
import AppLayout from "./components/layout/AppLayout.vue";
import LoginPage from "./pages/LoginPage.vue";
import { useAuthStore } from "./stores/auth.store";
import { useUiStore } from "./stores/ui.store";
import { startRuntimeSync, stopRuntimeSync } from "./app/runtimeSync";
import { t } from "./i18n";

const auth = useAuthStore();
const ui = useUiStore();
const route = useRoute();

onMounted(() => {
  void auth.restoreSession();
});

watch(
  () => auth.authenticated,
  (authenticated) => {
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
  color-scheme: dark;
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
  min-height: 100%;
}

body {
  margin: 0;
  min-width: 320px;
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
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.02)), rgba(255, 255, 255, 0.005)),
    var(--color-bg-elevated);
  color: var(--color-text-primary);
  padding: 8px 14px;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
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
  padding: 10px 12px;
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
  outline: 2px solid rgba(96, 165, 250, 0.5);
  outline-offset: 2px;
}

a {
  color: inherit;
}

#app {
  min-height: 100vh;
}

.app-root {
  position: relative;
  min-height: 100vh;
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
  background:
    radial-gradient(circle at 14% 0%, rgba(56, 189, 248, 0.12), transparent 30%),
    radial-gradient(circle at 86% 0%, rgba(251, 146, 60, 0.08), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.025), transparent 18%);
  opacity: 0.95;
}

.app-root::after {
  z-index: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
  background-size: 72px 72px;
  mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.65), transparent 82%);
  opacity: 0.18;
}

.app-root > * {
  position: relative;
  z-index: 1;
}

.boot-screen {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--app-background, var(--color-bg-page));
}

.boot-card {
  width: min(420px, 100%);
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.02)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-card);
  border-radius: 20px;
  padding: 20px 22px;
  color: var(--color-text-primary);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(12px);
}

.page {
  display: grid;
  gap: 16px;
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
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.016)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-card);
  border-radius: 16px;
  box-shadow: var(--shadow-md);
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
  background: rgba(148, 163, 184, 0.18);
  border: 3px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.3);
  border: 3px solid transparent;
  background-clip: padding-box;
}

@media (max-width: 900px) {
  .stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
