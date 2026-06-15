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
import { watch } from "vue";
import { useRoute } from "vue-router";
import AppLayout from "./components/layout/AppLayout.vue";
import LoginPage from "./pages/LoginPage.vue";
import { startRuntimeSync, stopRuntimeSync } from "./app/runtimeSync";
import { t } from "./i18n";
import { useAuthStore } from "./stores/auth.store";
import { useUiStore } from "./stores/ui.store";

const auth = useAuthStore();
const ui = useUiStore();
const route = useRoute();

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
