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
        <template v-for="item in group.items" :key="`${group.title}-${item.path}`">
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

function normalizePath(path: unknown): string {
  const raw = String(path ?? "").trim();
  if (!raw) return "/";

  const noLeadingHash = raw.replace(/^#+/, "");
  let pathnameOnly = noLeadingHash;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(noLeadingHash)) {
    try {
      pathnameOnly = new URL(noLeadingHash).pathname || "/";
    } catch {
      pathnameOnly = noLeadingHash;
    }
  }

  const withoutQueryOrHash = pathnameOnly.split(/[?#]/, 1)[0];
  if (!withoutQueryOrHash) return "/";

  const withLeadingSlash = withoutQueryOrHash.startsWith("/") ? withoutQueryOrHash : `/${withoutQueryOrHash}`;
  const compacted = withLeadingSlash.replace(/\/{2,}/g, "/");
  if (compacted.length > 1 && compacted.endsWith("/")) {
    return compacted.slice(0, -1);
  }

  return compacted;
}

function normalizeLabel(label: unknown): string {
  return String(label ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

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
        { path: "/combat-manager", icon: "CM", label: t("nav.combatManager") },
        { path: "/admin-warns", icon: "BR", label: t("nav.adminWarns") },
        { path: "/plugins/infantry-combat-enhancer", icon: "IE", label: t("nav.infantryCombatEnhancer") },
      ],
    },
  ];

  const seenPaths = new Set<string>();
  const seenLabels = new Set<string>();
  for (const group of result) {
    for (const item of group.items) {
      if (item?.path) {
        item.path = normalizePath(item.path);
        seenPaths.add(item.path);
      }
      if (item?.label) {
        const labelKey = normalizeLabel(item.label);
        if (labelKey) seenLabels.add(labelKey);
      }
    }
  }

  // Add Dynamic Pages from Registry
  const dynamicGroup: any = {
    title: t("nav.pluginsCategory"),
    items: [],
  };

  const debugGroup: any = {
    title: t("nav.debugCategory", "Debug"),
    items: [],
  };

  for (const page of apiPages.value) {
    if (!page.enabled || page.hiddenFromSidebar) continue;
    const normalizedRoute = normalizePath(page.route);
    const normalizedLabel = normalizeLabel(page.title);
    if (seenPaths.has(normalizedRoute)) continue;
    if (normalizedLabel && seenLabels.has(normalizedLabel)) continue;
    
    const item = {
      path: normalizedRoute,
      icon: page.icon || "P",
      label: page.title,
    };

    seenPaths.add(normalizedRoute);
    if (normalizedLabel) seenLabels.add(normalizedLabel);

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
  background: rgba(5, 8, 12, 0.64);
  backdrop-filter: blur(4px);
}

.sidebar {
  position: relative;
  height: 100vh;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.018)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-panel);
  backdrop-filter: blur(12px);
  min-width: 0;
  transition: width 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease;
  overflow: hidden;
  box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.02);
}

.sidebar.collapsed {
  width: 84px;
}

.brand {
  padding: 22px 20px 18px;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--color-border-soft);
}

.sidebar.collapsed .brand {
  padding: 22px 10px 18px;
  text-align: center;
}

.brand strong {
  display: block;
  font-size: 18px;
  letter-spacing: -0.02em;
}

.sidebar.collapsed .brand strong {
  font-size: 13px;
  letter-spacing: 0.08em;
}

.brand span {
  display: inline-flex;
  margin-top: 8px;
  padding: 4px 8px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-muted);
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
  padding: 14px 12px 18px;
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
  padding: 12px 8px 18px;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 18px;
}

.group-title {
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.8;
}

a {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--color-text-secondary);
  text-decoration: none;
  padding: 11px 12px;
  border-radius: 12px;
  transition: background-color 0.12s ease, color 0.12s ease, box-shadow 0.12s ease, transform 0.12s ease;
}

a::before {
  content: "";
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 999px;
  background: transparent;
  opacity: 0;
  transition: opacity 0.12s ease, background-color 0.12s ease;
}

.nav-icon {
  width: 32px;
  height: 32px;
  display: inline-grid;
  place-items: center;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-soft);
  color: var(--color-text-muted);
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
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  transform: translateX(1px);
}

a.router-link-exact-active {
  background: linear-gradient(90deg, rgba(96, 165, 250, 0.12), rgba(255, 255, 255, 0.03));
  color: var(--color-text-primary);
  box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.14), var(--shadow-sm);
}

a.router-link-exact-active::before {
  opacity: 1;
  background: var(--color-status-info);
}

a.router-link-exact-active .nav-icon {
  background: rgba(96, 165, 250, 0.14);
  color: var(--color-text-primary);
  border-color: rgba(96, 165, 250, 0.2);
}

@media (max-width: 780px) {
  .sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    width: min(288px, calc(100vw - 52px));
    transform: translateX(-100%);
    z-index: var(--z-sidebar);
    box-shadow: 12px 0 24px rgba(0, 0, 0, 0.35);
    border-right: 1px solid var(--color-border-default);
    border-radius: 0 20px 20px 0;
  }

  .sidebar.mobileOpen {
    transform: translateX(0);
  }

  .sidebar.collapsed {
    width: min(288px, calc(100vw - 52px));
  }
}
</style>
