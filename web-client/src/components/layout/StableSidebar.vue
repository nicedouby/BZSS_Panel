<template>
  <div
    v-if="ui.mobileSidebarOpen"
    class="sidebar-backdrop"
    aria-hidden="true"
    @click="ui.closeMobileSidebar()"
  />

  <aside
    class="sidebar"
    :class="{
      collapsed: ui.sidebarCollapsed,
      mobileOpen: ui.mobileSidebarOpen,
      navigating: Boolean(navigationTarget),
    }"
  >
    <header class="brand">
      <strong>BZSS</strong>
      <button
        type="button"
        class="collapse-button"
        :title="sidebarButtonLabel"
        :aria-label="sidebarButtonLabel"
        @click="toggleSidebar"
      >
        {{ ui.sidebarCollapsed ? "›" : "‹" }}
      </button>
    </header>

    <nav class="primary-nav" aria-label="主导航">
      <section
        v-for="section in sections"
        :key="section.key"
        class="nav-section"
        :class="{ open: expandedSectionKey === section.key }"
        :data-section="section.key"
      >
        <button
          type="button"
          class="section-link"
          :class="{ active: expandedSectionKey === section.key }"
          :title="section.label"
          :aria-expanded="expandedSectionKey === section.key"
          @pointerenter="preloadSection(section.key)"
          @focus="preloadSection(section.key)"
          @click="handleSectionClick(section.key)"
        >
          <span class="section-icon" aria-hidden="true">{{ section.icon }}</span>
          <span class="section-copy">
            <strong>{{ section.label }}</strong>
            <small>{{ section.description }}</small>
          </span>
          <span class="section-chevron" aria-hidden="true">
            {{ expandedSectionKey === section.key ? "−" : "+" }}
          </span>
        </button>

        <div v-if="expandedSectionKey === section.key" class="section-children">
          <button
            v-for="item in section.items"
            :key="item.path"
            type="button"
            class="child-link"
            :class="{
              active: isRouteActive(route.path, item.path),
              pending: navigationTarget === item.path,
            }"
            :title="item.label"
            @pointerenter="preloadPath(item.path)"
            @pointerdown="preloadPath(item.path)"
            @touchstart.passive="preloadPath(item.path)"
            @focus="preloadPath(item.path)"
            @click="navigateTo(item.path)"
          >
            <span class="child-icon" aria-hidden="true">{{ item.icon }}</span>
            <span class="child-label">{{ item.label }}</span>
            <span v-if="navigationTarget === item.path" class="pending-mark" aria-hidden="true" />
          </button>
        </div>
      </section>
    </nav>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  buildNavSections,
  findSectionForRoute,
  isRouteActive,
  type NavSectionKey,
} from "../../app/sidebarNav";
import {
  preloadPageFrameworkByPath,
  preloadPageFrameworksByPaths,
} from "../../app/pageFrameworkPreloader";
import { t } from "../../i18n";
import { useAuthStore } from "../../stores/auth.store";
import { useUiStore } from "../../stores/ui.store";
import { useIsMobile } from "../../composables/useMediaQuery";
import { useRegisteredWebPagesQuery } from "./useRegisteredWebPagesQuery";

const ui = useUiStore();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const isNavDrawer = useIsMobile(1100);
const pagesQuery = useRegisteredWebPagesQuery();

const registeredPages = computed(() => (
  Array.isArray(pagesQuery.data.value) ? pagesQuery.data.value : []
));
const sections = computed(() => buildNavSections({
  apiPages: registeredPages.value,
  user: auth.user,
}));

const expandedSectionKey = ref<NavSectionKey | "">("");
const navigationTarget = ref("");
let navigationVersion = 0;

watch(
  () => [route.path, sections.value] as const,
  ([path]) => {
    const current = findSectionForRoute(sections.value, path);
    if (current) expandedSectionKey.value = current.key;
    navigationTarget.value = "";
  },
  { immediate: true },
);

function preloadPath(path: string) {
  void preloadPageFrameworkByPath(path, auth.user);
}

function preloadSection(key: NavSectionKey) {
  const section = sections.value.find((item) => item.key === key);
  if (!section) return;
  void preloadPageFrameworksByPaths(
    section.items.map((item) => item.path),
    auth.user,
  );
}

function handleSectionClick(key: NavSectionKey) {
  preloadSection(key);

  // The compact rail was the source of a previous navigation dead zone.
  // Expand it first so every child page has a full-size, unambiguous click target.
  if (ui.sidebarCollapsed && !isNavDrawer.value) {
    ui.setSidebarCollapsed(false);
    expandedSectionKey.value = key;
    return;
  }

  expandedSectionKey.value = expandedSectionKey.value === key ? "" : key;
}

async function navigateTo(path: string) {
  const target = String(path ?? "").trim();
  if (!target) return;

  if (route.path === target) {
    navigationTarget.value = "";
    ui.closeMobileSidebar();
    return;
  }

  preloadPath(target);
  const version = ++navigationVersion;
  navigationTarget.value = target;

  // On tablets the drawer must disappear immediately. Waiting for router.push()
  // made a cold route download look like the click was ignored.
  ui.closeMobileSidebar();

  try {
    await router.push(target);
  } catch (error) {
    console.error(`[sidebar] navigation failed: ${target}`, error);
  } finally {
    if (version === navigationVersion) navigationTarget.value = "";
  }
}

const sidebarButtonLabel = computed(() => (
  ui.sidebarCollapsed ? t("topbar.expand") : t("topbar.collapse")
));

function toggleSidebar() {
  if (isNavDrawer.value) {
    ui.toggleMobileSidebar();
    return;
  }
  ui.toggleSidebarCollapsed();
}
</script>

<style scoped>
.sidebar-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-sidebar-backdrop);
  background: rgba(5, 8, 12, 0.68);
}

.sidebar {
  position: relative;
  z-index: var(--z-sidebar);
  width: 248px;
  height: 100dvh;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--color-border-default);
  background: var(--color-bg-panel);
  box-shadow: 10px 0 28px rgba(0, 0, 0, 0.16);
  transition: width 0.14s ease, transform 0.14s ease;
  isolation: isolate;
}

@supports not (height: 100dvh) {
  .sidebar { height: 100vh; }
}

.sidebar.collapsed { width: 84px; }

.brand {
  flex: 0 0 auto;
  min-height: 66px;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid var(--color-border-soft);
}

.brand strong {
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, var(--color-brand-primary) 30%, transparent);
  border-radius: 9px;
  color: var(--color-text-primary);
  background: color-mix(in srgb, var(--color-brand-primary) 9%, transparent);
  font-size: 16px;
  line-height: 1;
}

.collapse-button {
  width: 28px;
  height: 28px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--color-border-soft);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.035);
  color: var(--color-text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 18px;
}

.collapse-button:hover {
  border-color: var(--color-border-highlight);
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.sidebar.collapsed .brand {
  padding: 12px 8px;
  flex-direction: column;
}

.sidebar.collapsed .brand strong { font-size: 12px; }

.primary-nav {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 12px 10px 18px;
  scrollbar-width: thin;
}

.nav-section {
  --section-accent: var(--color-brand-primary);
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 12px;
}

.nav-section.open {
  border-color: color-mix(in srgb, var(--section-accent) 20%, transparent);
  background: color-mix(in srgb, var(--section-accent) 6%, transparent);
}

.nav-section[data-section="opsLive"] { --section-accent: #38bdf8; }
.nav-section[data-section="players"] { --section-accent: #34d399; }
.nav-section[data-section="balance"] { --section-accent: #f59e0b; }
.nav-section[data-section="combat"] { --section-accent: #f87171; }
.nav-section[data-section="broadcast"] { --section-accent: #a78bfa; }
.nav-section[data-section="analytics"] { --section-accent: #22d3ee; }
.nav-section[data-section="system"] { --section-accent: #94a3b8; }
.nav-section[data-section="other"] { --section-accent: #c084fc; }

.section-link,
.child-link {
  width: 100%;
  border: 1px solid transparent;
  color: var(--color-text-secondary);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.section-link {
  min-height: 54px;
  padding: 8px 10px;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  border-radius: 10px;
}

.section-link:hover,
.section-link.active {
  color: var(--color-text-primary);
  border-color: color-mix(in srgb, var(--section-accent) 22%, var(--color-border-soft));
  background: color-mix(in srgb, var(--section-accent) 9%, rgba(255, 255, 255, 0.02));
}

.section-icon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--section-accent) 20%, var(--color-border-soft));
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.035);
  font-size: 17px;
}

.section-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.section-copy strong,
.section-copy small,
.child-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-copy strong { color: var(--color-text-primary); font-size: 13px; }
.section-copy small { color: var(--color-text-muted); font-size: 10px; }
.section-chevron { color: var(--color-text-muted); }

.section-children {
  display: grid;
  gap: 3px;
  margin: 0 5px 6px 16px;
  padding: 2px 0 2px 9px;
  border-left: 1px solid color-mix(in srgb, var(--section-accent) 22%, var(--color-border-soft));
}

.child-link {
  position: relative;
  min-height: 34px;
  padding: 5px 9px;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  border-radius: 8px;
}

.child-link:hover,
.child-link.active,
.child-link.pending {
  color: var(--color-text-primary);
  border-color: color-mix(in srgb, var(--section-accent) 24%, var(--color-border-soft));
  background: color-mix(in srgb, var(--section-accent) 11%, transparent);
}

.child-icon {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--section-accent) 16%, var(--color-border-soft));
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.035);
  font-size: 12px;
}

.child-label { font-size: 12px; font-weight: 650; }

.pending-mark {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--section-accent);
  box-shadow: 0 0 8px var(--section-accent);
}

.sidebar.collapsed .section-copy,
.sidebar.collapsed .section-chevron,
.sidebar.collapsed .section-children {
  display: none;
}

.sidebar.collapsed .section-link {
  grid-template-columns: 1fr;
  justify-items: center;
  padding: 7px 0;
}

@media (max-width: 1100px) {
  .sidebar,
  .sidebar.collapsed {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: var(--z-sidebar-drawer);
    width: min(86vw, 340px);
    transform: translateX(-100%);
    border-radius: 0 16px 16px 0;
    padding-top: var(--safe-top);
    padding-bottom: var(--safe-bottom);
  }

  .sidebar.mobileOpen { transform: translateX(0); }

  .sidebar.collapsed .section-copy,
  .sidebar.collapsed .section-chevron,
  .sidebar.collapsed .section-children {
    display: grid;
  }

  .sidebar.collapsed .section-link {
    grid-template-columns: 36px minmax(0, 1fr) auto;
    justify-items: stretch;
    padding: 8px 10px;
  }

  .collapse-button { display: none; }
}

@media (orientation: landscape) and (max-height: 520px) {
  .sidebar,
  .sidebar.collapsed { width: min(78vw, 300px); }
  .brand { min-height: 48px; padding: 8px 12px; }
  .primary-nav { padding: 8px; gap: 4px; }
  .section-link { min-height: 38px; padding: 5px 7px; }
  .section-icon { width: 26px; height: 26px; font-size: 13px; }
  .child-link { min-height: 30px; }
}
</style>
