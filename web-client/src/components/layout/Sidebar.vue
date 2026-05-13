<template>
  <div v-if="ui.mobileSidebarOpen" class="sidebar-backdrop" @click="ui.closeMobileSidebar()" />
  <aside class="sidebar" :class="{ collapsed: ui.sidebarCollapsed, mobileOpen: ui.mobileSidebarOpen }">
    <div class="brand">
      <strong>BZSS</strong>
      <span>Vue {{ t("common.panel") }}</span>
    </div>
    <nav>
      <RouterLink v-for="item in nav" :key="item.path" :to="item.path" @click="ui.closeMobileSidebar()">
        <span class="nav-icon">{{ item.icon }}</span>
        <span class="nav-label">{{ item.label }}</span>
      </RouterLink>
    </nav>
  </aside>
</template>

<script setup lang="ts">
import { useUiStore } from "../../stores/ui.store";
import { t } from "../../i18n";

const ui = useUiStore();

const nav = [
  { path: "/match-status", icon: "MS", label: t("nav.matchStatus") },
  { path: "/console", icon: "CON", label: t("nav.console") },
  { path: "/player-database", icon: "DB", label: t("nav.playerDatabase") },
  { path: "/combat-clean", icon: "CC", label: t("nav.combatClean") },
  { path: "/kill-manage", icon: "KM", label: t("nav.killManage") },
];
</script>

<style scoped>
.sidebar-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-sidebar-backdrop);
  background: rgba(8, 12, 16, 0.68);
}

.sidebar {
  position: relative;
  border-right: 1px solid #273039;
  background: #13181e;
  padding: 16px 12px;
  min-width: 0;
  transition: width 0.16s ease, transform 0.16s ease;
}

.sidebar.collapsed {
  width: 76px;
}

.sidebar.collapsed .brand span,
.sidebar.collapsed .nav-label {
  display: none;
}

.brand {
  padding: 10px 10px 18px;
}

.brand strong {
  display: block;
  font-size: 20px;
}

.brand span {
  color: #98a5af;
  font-size: 12px;
}

nav {
  display: grid;
  gap: 4px;
}

a {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #dce4e8;
  text-decoration: none;
  padding: 10px;
  border-radius: 6px;
}

.nav-icon {
  width: 34px;
  height: 34px;
  display: inline-grid;
  place-items: center;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.035);
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 800;
  flex: 0 0 auto;
}

.nav-label {
  min-width: 0;
}

.sidebar.collapsed a {
  justify-content: center;
  padding-inline: 8px;
}

a.router-link-active {
  background: #20303a;
  color: #ffffff;
}

@media (max-width: 780px) {
  .sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    width: min(260px, calc(100vw - 48px));
    z-index: calc(var(--z-sidebar-backdrop) + 1);
    transform: translateX(-100%);
  }

  .sidebar.mobileOpen {
    transform: translateX(0);
  }

  .sidebar.collapsed {
    width: min(260px, calc(100vw - 48px));
  }

  .sidebar.collapsed .brand span,
  .sidebar.collapsed .nav-label {
    display: block;
  }

  .sidebar.collapsed a {
    justify-content: flex-start;
    padding-inline: 10px;
  }
}
</style>
