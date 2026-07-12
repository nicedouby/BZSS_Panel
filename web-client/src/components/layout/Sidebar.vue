<template>
  <div v-if="ui.mobileSidebarOpen" class="sidebar-backdrop" @click="ui.closeMobileSidebar()" />
  <aside class="sidebar" :class="{ collapsed: ui.sidebarCollapsed, mobileOpen: ui.mobileSidebarOpen }">
    <div class="brand">
      <div class="brand-title">
        <strong>BZSS</strong>
        <span>Vue {{ t("common.panel") }}</span>
      </div>
      <button
        type="button"
        class="collapse-button"
        :title="sidebarButtonLabel"
        @click="toggleSidebar"
      >
        <svg
          v-if="ui.sidebarCollapsed"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          stroke="currentColor"
          stroke-width="2.5"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
        <svg
          v-else
          viewBox="0 0 24 24"
          width="14"
          height="14"
          stroke="currentColor"
          stroke-width="2.5"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </button>
    </div>

    <nav aria-label="主导航">
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
          :aria-label="section.label"
          :aria-expanded="expandedSectionKey === section.key"
          @click="handleSectionClick(section.key)"
        >
          <span class="section-icon" aria-hidden="true">{{ section.icon }}</span>
          <span class="section-copy">
            <span class="section-label">{{ section.label }}</span>
            <span class="section-description">{{ section.description }}</span>
          </span>
        </button>

        <div v-if="expandedSectionKey === section.key" class="section-children-wrap">
          <div class="section-children">
            <RouterLink
              v-for="item in section.items"
              :key="item.path"
              :to="item.path"
              class="child-link"
              :class="{ active: isRouteActive(route.path, item.path) }"
              :title="item.label"
              @click="ui.closeMobileSidebar()"
            >
              <span class="child-icon" aria-hidden="true">{{ item.icon }}</span>
              <span class="child-label">{{ item.label }}</span>
            </RouterLink>
          </div>
        </div>
      </section>
    </nav>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import {
  buildNavSections,
  findSectionForRoute,
  isRouteActive,
  type NavSectionKey,
} from "../../app/sidebarNav";
import { t } from "../../i18n";
import { useAuthStore } from "../../stores/auth.store";
import { useUiStore } from "../../stores/ui.store";
import { useIsMobile } from "../../composables/useMediaQuery";
import { useRegisteredWebPagesQuery } from "./useRegisteredWebPagesQuery";

const ui = useUiStore();
const auth = useAuthStore();
const route = useRoute();
// 导航抽屉断点统一到 1100px，避免 1025–1100px 的不可达死区。
const isNavDrawer = useIsMobile(1100);
const pagesQuery = useRegisteredWebPagesQuery();
const registeredPages = computed(() => Array.isArray(pagesQuery.data.value) ? pagesQuery.data.value : []);

const sections = computed(() => buildNavSections({
  apiPages: registeredPages.value,
  user: auth.user,
}));

const expandedSectionKey = ref<NavSectionKey | "">("");

watch(
  () => route.path,
  () => {
    const current = findSectionForRoute(sections.value, route.path);
    if (current) expandedSectionKey.value = current.key;
  },
  { immediate: true },
);

function handleSectionClick(key: NavSectionKey) {
  if (ui.sidebarCollapsed && !isNavDrawer.value) {
    ui.setSidebarCollapsed(false);
    expandedSectionKey.value = key;
    return;
  }
  expandedSectionKey.value = expandedSectionKey.value === key ? "" : key;
}

const sidebarButtonLabel = computed(() => ui.sidebarCollapsed ? t("topbar.expand") : t("topbar.collapse"));

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
  background: rgba(5, 8, 12, 0.64);
  backdrop-filter: blur(4px);
}

.sidebar {
  position: relative;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--color-border-default);
  background:
    radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--section-accent, var(--color-brand-primary)) 12%, transparent), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.02)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-panel);
  backdrop-filter: blur(12px);
  min-width: 0;
  transition: width 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease;
  overflow: hidden;
  box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.025), 12px 0 34px rgba(0, 0, 0, 0.12);
}

@supports not (height: 100dvh) {
  .sidebar {
    height: 100vh;
  }
}

.sidebar.collapsed {
  width: 84px;
}

.brand {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 22px 20px 18px;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--color-border-soft);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--color-brand-primary) 9%, transparent), transparent),
    rgba(255, 255, 255, 0.012);
}

.sidebar.collapsed .brand {
  padding: 18px 10px;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
}

.brand-title {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.sidebar.collapsed .brand-title {
  align-items: center;
}

.brand strong {
  display: block;
  width: fit-content;
  font-size: 18px;
  letter-spacing: 0;
  line-height: 1;
  padding: 7px 9px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--color-brand-primary) 28%, transparent);
  background: color-mix(in srgb, var(--color-brand-primary) 9%, transparent);
  box-shadow: 0 0 22px color-mix(in srgb, var(--theme-brand-glow) 75%, transparent);
}

.sidebar.collapsed .brand strong {
  font-size: 13px;
  letter-spacing: 0.08em;
  margin: 0 auto;
  padding: 7px 8px;
}

.brand span {
  display: inline-flex;
  padding: 4px 8px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-muted);
  font-size: 12px;
}

.sidebar.collapsed .brand span,
.sidebar.collapsed .section-copy,
.sidebar.collapsed .section-children {
  display: none;
}

.collapse-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;
  flex: 0 0 auto;
}

.collapse-button:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary);
  border-color: rgba(255, 255, 255, 0.2);
}

.sidebar.collapsed .collapse-button {
  width: 22px;
  height: 22px;
}

nav {
  flex: 1 1 0%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 10px 18px;
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
  padding: 14px 8px 18px;
}

.nav-section {
  --section-accent: var(--color-brand-primary);
  position: relative;
  display: grid;
  gap: 4px;
  min-width: 0;
  border-radius: 14px;
  transform-origin: top center;
  transition:
    background-color 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    border-color 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    padding 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}

.nav-section.open {
  padding: 4px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--section-accent) 10%, transparent), rgba(255, 255, 255, 0.01)),
    color-mix(in srgb, var(--color-bg-elevated) 30%, transparent);
  border: 1px solid color-mix(in srgb, var(--section-accent) 18%, transparent);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.018), 0 12px 26px rgba(0, 0, 0, 0.1);
  transform: translateY(-1px);
}

.nav-section[data-section="opsLive"] { --section-accent: #38bdf8; }
.nav-section[data-section="players"] { --section-accent: #34d399; }
.nav-section[data-section="balance"] { --section-accent: #f59e0b; }
.nav-section[data-section="combat"] { --section-accent: #f87171; }
.nav-section[data-section="broadcast"] { --section-accent: #a78bfa; }
.nav-section[data-section="analytics"] { --section-accent: #22d3ee; }
.nav-section[data-section="system"] { --section-accent: #94a3b8; }
.nav-section[data-section="other"] { --section-accent: #c084fc; }

.sidebar.collapsed .nav-section.open {
  padding: 0;
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}

.section-link {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  min-height: 56px;
  gap: 12px;
  color: var(--color-text-secondary);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  text-decoration: none;
  padding: 10px 12px;
  border-radius: 11px;
  border: 1px solid transparent;
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease, box-shadow 0.12s ease, transform 0.12s ease;
}

.section-link::before {
  content: "";
  position: absolute;
  left: -1px;
  top: 10px;
  bottom: 10px;
  width: 4px;
  border-radius: 999px;
  background: transparent;
  opacity: 0;
  transition: opacity 0.12s ease, background-color 0.12s ease;
}

.section-icon {
  width: 36px;
  height: 36px;
  display: inline-grid;
  place-items: center;
  border-radius: 10px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--section-accent) 13%, transparent), rgba(255, 255, 255, 0.025)),
    rgba(255, 255, 255, 0.035);
  border: 1px solid color-mix(in srgb, var(--section-accent) 18%, var(--color-border-soft));
  color: var(--color-text-muted);
  font-size: 18px;
  line-height: 1;
  flex: 0 0 auto;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
}

.section-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 3px;
}

.section-label,
.section-description,
.child-label {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.section-label {
  color: var(--color-text-primary);
  font-size: 14px;
  font-weight: 800;
  line-height: 1.25;
}

.section-description {
  color: var(--color-text-muted);
  font-size: 11px;
  line-height: 1.25;
}

.sidebar.collapsed .section-link {
  justify-content: center;
  min-height: 48px;
  padding: 8px 0;
}

.section-link:hover {
  background: color-mix(in srgb, var(--section-accent) 8%, rgba(255, 255, 255, 0.03));
  border-color: color-mix(in srgb, var(--section-accent) 22%, var(--color-border-soft));
  transform: translateX(1px);
}

.section-link.active {
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--section-accent) 18%, transparent), rgba(255, 255, 255, 0.03));
  border-color: color-mix(in srgb, var(--section-accent) 28%, transparent);
  color: var(--color-text-primary);
  box-shadow: var(--shadow-sm);
}

.section-link.active::before {
  opacity: 1;
  background: var(--section-accent);
}

.section-link.active .section-icon {
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--section-accent) 25%, transparent), color-mix(in srgb, var(--section-accent) 10%, transparent)),
    rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  border-color: color-mix(in srgb, var(--section-accent) 38%, transparent);
  box-shadow: 0 0 18px color-mix(in srgb, var(--section-accent) 14%, transparent);
}

.section-children-wrap {
  overflow: hidden;
  will-change: height, opacity, transform;
}

.section-children {
  display: grid;
  gap: 3px;
  margin: 0 2px 2px 16px;
  padding: 2px 0 2px 10px;
  border-left: 1px solid color-mix(in srgb, var(--section-accent) 22%, var(--color-border-soft));
}

.section-children-enter-active,
.section-children-leave-active {
  transition:
    height 0.34s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.26s ease,
    transform 0.34s cubic-bezier(0.22, 1, 0.36, 1);
}

.section-children-enter-from,
.section-children-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.child-link {
  min-width: 0;
  height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 9px;
  color: var(--color-text-secondary);
  text-decoration: none;
  border: 1px solid transparent;
  opacity: 1;
  transform: translateY(0) scale(1);
  animation: sidebar-child-in 0.34s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--child-index, 0) * 24ms + 28ms);
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease,
    transform 0.18s ease;
}

.child-link:hover {
  color: var(--color-text-primary);
  border-color: color-mix(in srgb, var(--section-accent) 20%, var(--color-border-soft));
  background: color-mix(in srgb, var(--section-accent) 7%, rgba(255, 255, 255, 0.025));
  transform: translateX(1px);
}

.child-link.active {
  color: var(--color-text-primary);
  border-color: color-mix(in srgb, var(--section-accent) 26%, transparent);
  background: color-mix(in srgb, var(--section-accent) 13%, transparent);
}

.child-icon {
  width: 22px;
  height: 22px;
  display: inline-grid;
  place-items: center;
  border-radius: 7px;
  border: 1px solid color-mix(in srgb, var(--section-accent) 14%, var(--color-border-soft));
  background: rgba(255, 255, 255, 0.035);
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1;
  flex: 0 0 auto;
}

.child-link.active .child-icon {
  color: var(--color-text-primary);
  border-color: color-mix(in srgb, var(--section-accent) 32%, transparent);
  background: color-mix(in srgb, var(--section-accent) 14%, transparent);
}

.child-label {
  font-size: 12px;
  font-weight: 650;
}

@keyframes sidebar-child-in {
  from {
    opacity: 0;
    transform: translateY(-8px) scale(0.985);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* sm/平板 ≤1024px：抽屉浮层，带标签的完整导航 */
@media (max-width: 1100px) {
  .sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    width: min(86vw, 340px);
    transform: translateX(-100%);
    z-index: var(--z-sidebar-drawer);
    box-shadow: 12px 0 24px rgba(0, 0, 0, 0.35);
    border-right: 1px solid var(--color-border-default);
    border-radius: 0 20px 20px 0;
    padding-top: var(--safe-top);
    padding-bottom: var(--safe-bottom);
  }

  .sidebar.mobileOpen {
    transform: translateX(0);
  }

  .sidebar.collapsed {
    width: min(86vw, 340px);
  }

  .sidebar.collapsed .section-copy,
  .sidebar.collapsed .section-children,
  .sidebar.collapsed .brand span {
    display: grid;
  }

  .sidebar.collapsed .brand {
    padding: 22px 20px 18px;
    text-align: left;
  }

  .sidebar.collapsed .brand strong {
    font-size: 18px;
    letter-spacing: 0;
    margin: 0;
    padding: 7px 9px;
  }

  .collapse-button {
    display: none !important;
  }
}

/* ─── md 断点（1025–1100px）：侧边栏被 AppLayout 压缩为 84px，强制应用折叠视觉 ─ */
@media (orientation: landscape) and (max-height: 520px) {
  .sidebar {
    width: min(78vw, 300px);
    border-radius: 0 14px 14px 0;
  }

  .sidebar.collapsed {
    width: min(78vw, 300px);
  }

  .brand,
  .sidebar.collapsed .brand {
    padding: 10px 14px;
    gap: 8px;
  }

  .brand strong,
  .sidebar.collapsed .brand strong {
    font-size: 14px;
    padding: 5px 7px;
  }

  .brand span {
    font-size: 10px;
    padding: 3px 6px;
  }

  nav {
    gap: 5px;
    padding: 8px 8px calc(10px + var(--safe-bottom));
  }

  .nav-section.open {
    padding: 3px;
    border-radius: 10px;
  }

  .section-link {
    min-height: 36px;
    padding: 6px 8px;
  }

  .section-icon {
    width: 24px;
    height: 24px;
  }

  .section-label {
    font-size: 12px;
  }

  .section-description,
  .child-label {
    font-size: 10px;
  }

  .child-link {
    min-height: 30px;
    padding: 5px 7px;
  }
}


</style>
