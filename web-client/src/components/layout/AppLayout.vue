<template>
  <div class="app-shell" :class="{ collapsed: ui.sidebarCollapsed }">
    <Sidebar />
    <main class="main-shell">
      <Topbar
        @open-plugin-center="pluginCenterOpen = true"
        @open-rcon-modal="rconModalOpen = true"
      />
      <section class="content-shell" :class="contentShellClass">
        <RouterView />
      </section>
    </main>
    <AppConfirmDialog />
    <WarnPrompt />
    <ToastHost />
    <SettingsDrawer />
    <PluginCenterDrawer
      :open="pluginCenterOpen"
      @close="pluginCenterOpen = false"
    />
    <RconCommandModal
      :open="rconModalOpen"
      @close="rconModalOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterView } from "vue-router";
import { useRoute } from "vue-router";
import { useUiStore } from "../../stores/ui.store";
import Topbar from "./Topbar.vue";
import Sidebar from "./Sidebar.vue";
import AppConfirmDialog from "../common/AppConfirmDialog.vue";
import WarnPrompt from "../common/WarnPrompt.vue";
import ToastHost from "../common/ToastHost.vue";
import SettingsDrawer from "../settings/SettingsDrawer.vue";
import PluginCenterDrawer from "../../features/plugins/PluginCenterDrawer.vue";
import RconCommandModal from "../console/RconCommandModal.vue";

const ui = useUiStore();
const route = useRoute();
const pluginCenterOpen = ref(false);
const rconModalOpen = ref(false);

const contentShellClass = computed(() => ({
  "full-bleed": Boolean(route.meta.fullBleed),
}));
</script>

<style scoped>
.app-shell {
  position: relative;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  background: var(--app-background, var(--color-bg-page));
}

.app-shell.collapsed {
  grid-template-columns: 84px minmax(0, 1fr);
}

.main-shell {
  min-width: 0;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.015), transparent 16%),
    var(--app-background, var(--color-bg-page));
}

.content-shell {
  padding: clamp(14px, 1.4vw, 22px);
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: auto;
  scrollbar-gutter: stable both-edges;
}

.content-shell.full-bleed {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 0;
  overflow: hidden;
}

.content-shell.full-bleed > * {
  min-width: 0;
  min-height: 0;
  height: 100%;
}

@media (max-width: 780px) {
  .app-shell {
    grid-template-columns: 1fr;
  }

  .app-shell.collapsed {
    grid-template-columns: 1fr;
  }

  .content-shell {
    padding: 12px;
  }
}
</style>
