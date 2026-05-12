<template>
  <div v-if="!auth.checked" class="boot-screen">
    <div class="boot-card">{{ t("app.checkingAuth") }}</div>
  </div>
  <LoginPage v-else-if="!auth.authenticated" />
  <AppLayout v-else />
</template>

<script setup lang="ts">
import { onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import AppLayout from "./components/layout/AppLayout.vue";
import LoginPage from "./pages/LoginPage.vue";
import { useAuthStore } from "./stores/auth.store";
import { startRuntimeSync, stopRuntimeSync } from "./app/runtimeSync";
import { t } from "./i18n";

const auth = useAuthStore();
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

@media (max-width: 900px) {
  .stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
