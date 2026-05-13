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
  font-family: Inter, "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #101317;
  color: #edf2f4;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  background: #070b10;
}

#app {
  min-height: 100vh;
}

.app-root {
  min-height: 100vh;
  color: #edf2f4;
  background: #070b10;
}

.boot-screen {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #101317;
}

.boot-card {
  border: 1px solid #2c343d;
  background: #171d23;
  border-radius: 8px;
  padding: 18px 22px;
  color: #dce4e8;
}

button,
input {
  font: inherit;
}

button {
  border: 1px solid #38414c;
  background: #1d252d;
  color: #f4f7f8;
  border-radius: 6px;
  padding: 8px 12px;
  cursor: pointer;
}

button:hover:not(:disabled) {
  border-color: #7aa2b8;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
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
  font-size: 22px;
  line-height: 1.2;
}

.page-subtitle {
  margin: 6px 0 0;
  color: #9aa7b2;
  font-size: 13px;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.stat {
  border: 1px solid #2c343d;
  background: #171d23;
  border-radius: 8px;
  padding: 12px;
}

.stat span {
  display: block;
  color: #98a5af;
  font-size: 12px;
}

.stat strong {
  display: block;
  margin-top: 4px;
  font-size: 20px;
}

.panel {
  border: 1px solid #2c343d;
  background: #151a20;
  border-radius: 8px;
}

.muted {
  color: #9aa7b2;
}

.app-root.ui-mode-classic {
  --panel-surface-alpha: 0.018;
  --card-extra-glow: 0;
}

.app-root.ui-mode-tactical {
  --panel-surface-alpha: 0.03;
  --card-extra-glow: 1;
}

.app-root.ui-mode-glass {
  --panel-surface-alpha: 0.05;
  --card-extra-glow: 1;
}

.app-root.ui-accent-blueOrange {
  --color-team1-primary: #37c8ff;
  --color-team1-soft: rgba(55, 200, 255, 0.1);
  --color-team1-border: rgba(55, 200, 255, 0.3);
  --color-team1-bg: rgba(55, 200, 255, 0.045);
  --color-team2-primary: #ff9b45;
  --color-team2-soft: rgba(255, 155, 69, 0.1);
  --color-team2-border: rgba(255, 155, 69, 0.3);
  --color-team2-bg: rgba(255, 155, 69, 0.045);
}

.app-root.ui-accent-greenAmber {
  --color-team1-primary: #34d399;
  --color-team1-soft: rgba(52, 211, 153, 0.1);
  --color-team1-border: rgba(52, 211, 153, 0.3);
  --color-team1-bg: rgba(52, 211, 153, 0.045);
  --color-team2-primary: #fbbf24;
  --color-team2-soft: rgba(251, 191, 36, 0.1);
  --color-team2-border: rgba(251, 191, 36, 0.3);
  --color-team2-bg: rgba(251, 191, 36, 0.045);
}

.app-root.ui-accent-steelRed {
  --color-team1-primary: #93c5fd;
  --color-team1-soft: rgba(147, 197, 253, 0.1);
  --color-team1-border: rgba(147, 197, 253, 0.3);
  --color-team1-bg: rgba(147, 197, 253, 0.045);
  --color-team2-primary: #f87171;
  --color-team2-soft: rgba(248, 113, 113, 0.1);
  --color-team2-border: rgba(248, 113, 113, 0.3);
  --color-team2-bg: rgba(248, 113, 113, 0.045);
}

.app-root.ui-rich-background .app-shell {
  background:
    radial-gradient(circle at 12% 0%, rgba(56, 189, 248, 0.08), transparent 28%),
    radial-gradient(circle at 88% 0%, rgba(251, 146, 60, 0.07), transparent 30%),
    #070b10;
}

.app-root.ui-flat-background .app-shell {
  background: #070b10;
}

.app-root.ui-card-glow .panel,
.app-root.ui-card-glow .stat,
.app-root.ui-card-glow .boot-card {
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.24);
}

.app-root.ui-card-flat .panel,
.app-root.ui-card-flat .stat,
.app-root.ui-card-flat .boot-card {
  box-shadow: none;
}

.app-root.ui-motion-reduced *,
.app-root.ui-motion-reduced *::before,
.app-root.ui-motion-reduced *::after {
  transition-duration: 0.01ms !important;
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
}

@media (max-width: 900px) {
  .stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
