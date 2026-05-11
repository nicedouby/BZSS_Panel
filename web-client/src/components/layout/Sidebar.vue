<template>
  <div v-if="ui.mobileSidebarOpen" class="sidebar-backdrop" @click="ui.closeMobileSidebar()" />
  <aside class="sidebar" :class="{ collapsed: ui.sidebarCollapsed, mobileOpen: ui.mobileSidebarOpen }">
    <div class="brand">
      <strong>BZSS</strong>
      <span>Vue Panel</span>
    </div>
    <nav>
      <RouterLink v-for="item in nav" :key="item.path" :to="item.path" @click="ui.closeMobileSidebar()">
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>
  </aside>
</template>

<script setup lang="ts">
import { useUiStore } from "../../stores/ui.store";

const ui = useUiStore();

const nav = [
  { path: "/match-status", label: "Match Status" },
  { path: "/console", label: "Console" },
  { path: "/player-database", label: "Player Database" },
  { path: "/combat-clean", label: "Combat Clean" },
  { path: "/kill-manage", label: "Kill Manage" },
  { path: "/plugin-subscriptions", label: "Plugin Subscriptions" },
];
</script>

<style scoped>
.sidebar-backdrop {
  position: fixed;
  inset: 0;
  z-index: 39;
  background: rgba(8, 12, 16, 0.68);
}

.sidebar {
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
.sidebar.collapsed nav span {
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
  color: #dce4e8;
  text-decoration: none;
  padding: 10px;
  border-radius: 6px;
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
    z-index: 40;
    transform: translateX(-100%);
  }

  .sidebar.mobileOpen {
    transform: translateX(0);
  }

  .sidebar.collapsed {
    width: min(260px, calc(100vw - 48px));
  }

  .sidebar.collapsed .brand span,
  .sidebar.collapsed nav span {
    display: block;
  }
}
</style>
