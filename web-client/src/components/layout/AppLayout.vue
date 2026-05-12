<template>
  <div class="app-shell" :class="{ collapsed: ui.sidebarCollapsed }">
    <Sidebar />
    <main class="main-shell">
      <Topbar />
      <section class="content-shell">
        <RouterView />
      </section>
    </main>
    <ConfirmDialog />
    <ToastHost />
    <SettingsDrawer />
  </div>
</template>

<script setup lang="ts">
import { RouterView } from "vue-router";
import { useUiStore } from "../../stores/ui.store";
import Topbar from "./Topbar.vue";
import Sidebar from "./Sidebar.vue";
import ConfirmDialog from "../common/ConfirmDialog.vue";
import ToastHost from "../common/ToastHost.vue";
import SettingsDrawer from "../settings/SettingsDrawer.vue";

const ui = useUiStore();
</script>

<style scoped>
.app-shell {
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  background: #101317;
}

.app-shell.collapsed {
  grid-template-columns: 76px minmax(0, 1fr);
}

.main-shell {
  min-width: 0;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.content-shell {
  padding: 18px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

@media (max-width: 780px) {
  .app-shell {
    grid-template-columns: 1fr;
  }

  .app-shell.collapsed {
    grid-template-columns: 1fr;
  }
}
</style>
