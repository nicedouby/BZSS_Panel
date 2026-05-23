<template>
  <div v-if="ui.mobileSidebarOpen" class="sidebar-backdrop" @click="ui.closeMobileSidebar()" />
  <aside class="sidebar" :class="{ collapsed: ui.sidebarCollapsed, mobileOpen: ui.mobileSidebarOpen }">
    <div class="brand">
      <strong>BZSS</strong>
      <span>Vue {{ t("common.panel") }}</span>
    </div>
    <nav>
      <div v-for="group in groups" :key="group.title" class="nav-group">
        <h3 class="group-title">{{ group.title }}</h3>
        <RouterLink v-for="item in group.items" :key="item.path" :to="item.path" @click="ui.closeMobileSidebar()">
          <span class="nav-icon">{{ item.icon }}</span>
          <span class="nav-label">{{ item.label }}</span>
        </RouterLink>
      </div>
    </nav>
  </aside>
</template>

<script setup lang="ts">
import { useUiStore } from "../../stores/ui.store";
import { t } from "../../i18n";

const ui = useUiStore();

const groups = [
  {
    title: t("nav.coreCategory"),
    items: [
      { path: "/match-status", icon: "MS", label: t("nav.matchStatus") },
      { path: "/console", icon: "CON", label: t("nav.console") },
      { path: "/player-database", icon: "DB", label: t("nav.playerDatabase") },
    ],
  },
  {
    title: t("nav.toolsCategory"),
    items: [
      { path: "/squad-management", icon: "SM", label: t("nav.squadManagement") },
      { path: "/combat-clean", icon: "CC", label: t("nav.combatClean") },
      { path: "/kill-manage", icon: "KM", label: t("nav.killManage") },
      { path: "/admin-warns", icon: "AW", label: t("nav.adminWarns") },
    ],
  },
  {
    title: t("nav.pluginsCategory"),
    items: [
      { path: "/plugins/group-report", icon: "GR", label: "抱团报备" },
      { path: "/plugins/server-info-statistics", icon: "SS", label: "服务器信息统计" },
      { path: "/udp-event-forwarder", icon: "UDP", label: "UDP Forwarder" },
    ],
  },
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
.sidebar.collapsed .nav-label,
.sidebar.collapsed .group-title {
  display: none;
}

.nav-group {
  display: grid;
  gap: 2px;
  margin-bottom: 12px;
}

.group-title {
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 700;
  color: #5c6a77;
  text-transform: uppercase;
  letter-spacing: 0.05em;
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
    transform: translateX(-100%);
    z-index: var(--z-sidebar);
    box-shadow: 12px 0 24px rgba(0, 0, 0, 0.35);
  }

  .sidebar.mobileOpen {
    transform: translateX(0);
  }
}
</style>
