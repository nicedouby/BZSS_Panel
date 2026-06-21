<template>
  <div class="app-shell" :class="{ collapsed: ui.sidebarCollapsed }">
    <Sidebar />
    <main class="main-shell">
      <Topbar
        @open-plugin-center="pluginCenterOpen = true"
        @open-rcon-modal="rconModalOpen = true"
      />
      <SectionSubnav />
      <section class="content-shell" :class="contentShellClass">
        <RouterView v-slot="{ Component }">
          <KeepAlive :max="8">
            <component :is="Component" />
          </KeepAlive>
        </RouterView>
      </section>
    </main>
    <AppConfirmDialog />
    <WarnPrompt />
    <DisbandPrompt />
    <ToastHost />
    <SettingsDrawer />
    <PluginCenterDrawer
      :open="pluginCenterOpen"
      @close="pluginCenterOpen = false"
    />
    <RconCommandModal
      v-if="auth.user?.isSuperAdmin"
      :open="rconModalOpen"
      @close="rconModalOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, KeepAlive, ref } from "vue";
import { RouterView } from "vue-router";
import { useRoute } from "vue-router";
import { useAuthStore } from "../../stores/auth.store";
import { useUiStore } from "../../stores/ui.store";
import Topbar from "./Topbar.vue";
import Sidebar from "./Sidebar.vue";
import SectionSubnav from "./SectionSubnav.vue";
import AppConfirmDialog from "../common/AppConfirmDialog.vue";
import WarnPrompt from "../common/WarnPrompt.vue";
import DisbandPrompt from "../common/DisbandPrompt.vue";
import ToastHost from "../common/ToastHost.vue";
import SettingsDrawer from "../settings/SettingsDrawer.vue";
import PluginCenterDrawer from "../../features/plugins/PluginCenterDrawer.vue";
import RconCommandModal from "../console/RconCommandModal.vue";

const ui = useUiStore();
const auth = useAuthStore();
const route = useRoute();
const pluginCenterOpen = ref(false);
const rconModalOpen = ref(false);

const contentShellClass = computed(() => {
  const legacyFullBleed = Boolean(route.meta.fullBleed);
  const layoutMode = route.meta.layoutMode === "workspace" || route.meta.layoutMode === "document"
    ? route.meta.layoutMode
    : legacyFullBleed ? "workspace" : "document";
  const contentPadding = route.meta.contentPadding === "none" || route.meta.contentPadding === "default"
    ? route.meta.contentPadding
    : legacyFullBleed ? "none" : "default";

  return {
    "content-shell--document": layoutMode === "document",
    "content-shell--workspace": layoutMode === "workspace",
    "content-shell--padded": contentPadding === "default",
    "content-shell--flush": contentPadding === "none",
    "full-bleed": legacyFullBleed,
  };
});
</script>

<style scoped>
.app-shell {
  position: relative;
  height: 100dvh;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  background: var(--app-background, var(--color-bg-page));
}

@supports not (height: 100dvh) {
  .app-shell {
    height: 100vh;
  }
}

.app-shell.collapsed {
  grid-template-columns: 84px minmax(0, 1fr);
}

.main-shell {
  min-width: 0;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.015), transparent 16%),
    var(--app-background, var(--color-bg-page));
}

.content-shell {
  min-width: 0;
  min-height: 0;
  scrollbar-gutter: stable both-edges;
}

.content-shell--document {
  display: block;
  min-height: 0;
  height: auto;
  overflow: auto;
}

.content-shell--workspace {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  height: 100%;
  overflow: hidden;
}

.content-shell--padded {
  padding: clamp(14px, 1.4vw, 22px);
}

.content-shell--flush {
  padding: 0;
}

.content-shell--workspace > * {
  width: 100%;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

@media (max-width: 1100px) {
  /* md 断点：强制侧边栏折叠为 84px 图标模式 */
  .app-shell {
    grid-template-columns: 84px minmax(0, 1fr);
  }

  .app-shell.collapsed {
    grid-template-columns: 84px minmax(0, 1fr);
  }

  .content-shell--padded {
    padding: 14px;
  }
}

@media (max-width: 780px) {
  .app-shell {
    grid-template-columns: 1fr;
  }

  .app-shell.collapsed {
    grid-template-columns: 1fr;
  }

  .content-shell--padded {
    padding: 12px;
  }

  .content-shell--flush {
    padding: 0;
  }
}

@media (max-width: 480px) {
  .content-shell--padded {
    padding: 8px;
  }
}
</style>
