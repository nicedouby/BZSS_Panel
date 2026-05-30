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
        <template v-for="item in group.items" :key="item.path">
          <RouterLink
            :to="item.path"
            @click="ui.closeMobileSidebar()"
          >
            <span class="nav-icon">{{ item.icon }}</span>
            <span class="nav-label">{{ item.label }}</span>
          </RouterLink>
        </template>
      </div>
    </nav>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useUiStore } from "../../stores/ui.store";
import { apiGet } from "../../app/apiClient";
import { t } from "../../i18n";

const ui = useUiStore();
const apiPages = ref<any[]>([]);

const groups = computed(() => {
  const result: any[] = [
    {
      title: t("nav.coreCategory"),
      items: [
        { path: "/match-status", icon: "MS", label: t("nav.matchStatus") },
        { path: "/console", icon: "CON", label: t("nav.console") },
        { path: "/system/status", icon: "ST", label: t("nav.runtimeStatus") },
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
        { path: "/plugins/infantry-combat-enhancer", icon: "IE", label: t("nav.infantryCombatEnhancer") },
      ],
    },
  ];

  // Add Dynamic Pages from Registry
  const dynamicGroup: any = {
    title: t("nav.pluginsCategory"),
    items: [],
  };

  const debugGroup: any = {
    title: "调试 / DEBUG",
    items: [],
  };

  for (const page of apiPages.value) {
    if (!page.enabled || page.hiddenFromSidebar) continue;
    
    const item = {
      path: page.route,
      icon: page.icon || "P",
      label: page.title,
    };

    if (page.group === "调试" || page.group === "DEBUG") {
      debugGroup.items.push(item);
    } else if (page.group === "核心") {
      // Core pages already handled statically for now to keep icons
    } else {
      dynamicGroup.items.push(item);
    }
  }

  if (dynamicGroup.items.length > 0) result.push(dynamicGroup);
  if (debugGroup.items.length > 0) result.push(debugGroup);

  return result;
});

async function fetchPages() {
  try {
    const res = await apiGet<any>("/api/web/pages");
    apiPages.value = res.pages || [];
  } catch (e) {
    console.error("Failed to fetch sidebar pages:", e);
  }
}

onMounted(fetchPages);
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
  height: 100vh;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #273039;
  background: #13181e;
  min-width: 0;
  transition: width 0.16s ease, transform 0.16s ease;
  overflow: hidden;
}

.sidebar.collapsed {
  width: 76px;
}

.brand {
  padding: 24px 22px 20px;
  flex: 0 0 auto;
}

.sidebar.collapsed .brand {
  padding: 24px 0 20px;
  text-align: center;
}

.brand strong {
  display: block;
  font-size: 20px;
  letter-spacing: -0.01em;
}

.sidebar.collapsed .brand strong {
  font-size: 14px;
  letter-spacing: 0.05em;
}

.brand span {
  color: #98a5af;
  font-size: 12px;
}

.sidebar.collapsed .brand span,
.sidebar.collapsed .nav-label,
.sidebar.collapsed .group-title {
  display: none;
}

nav {
  flex: 1 1 0%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  padding: 0 12px 24px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
}

nav::-webkit-scrollbar {
  width: 4px;
}

nav::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}

.sidebar.collapsed nav {
  padding: 0 8px 24px;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 20px;
}

.group-title {
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 700;
  color: #5c6a77;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.8;
}

a {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #dce4e8;
  text-decoration: none;
  padding: 10px 12px;
  border-radius: 8px;
  transition: all 0.12s ease;
}

.nav-icon {
  width: 32px;
  height: 32px;
  display: inline-grid;
  place-items: center;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: #9aa7b2;
  font-size: 10px;
  font-weight: 800;
  flex: 0 0 auto;
}

.nav-label {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
  font-weight: 500;
}

.sidebar.collapsed a {
  justify-content: center;
  padding: 10px 0;
}

a:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #ffffff;
}

a.router-link-active {
  background: #20303a;
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

a.router-link-active .nav-icon {
  background: rgba(255, 255, 255, 0.1);
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
