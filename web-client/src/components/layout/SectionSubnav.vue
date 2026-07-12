<template>
  <div v-if="activeSection && activeSection.items.length > 1" class="section-subnav" :data-section="activeSection.key">
    <div class="subnav-head">
      <span class="subnav-icon" aria-hidden="true">{{ activeSection.icon }}</span>
      <span class="subnav-title">{{ activeSection.label }}</span>
    </div>
    <nav class="subnav-list" :aria-label="`${activeSection.label} 子导航`">
      <RouterLink
        v-for="item in activeSection.items"
        :key="item.path"
        :to="item.path"
        class="subnav-link"
        :class="{ active: isRouteActive(route.path, item.path) }"
        :title="item.label"
      >
        <span class="item-icon" aria-hidden="true">{{ item.icon }}</span>
        <span class="item-label">{{ item.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import {
  buildNavSections,
  findSectionForRoute,
  isRouteActive,
} from "../../app/sidebarNav";
import { useAuthStore } from "../../stores/auth.store";
import { useRegisteredWebPagesQuery } from "./useRegisteredWebPagesQuery";

const auth = useAuthStore();
const route = useRoute();
const pagesQuery = useRegisteredWebPagesQuery();
const registeredPages = computed(() => (
  Array.isArray(pagesQuery.data.value) ? pagesQuery.data.value : []
));

const sections = computed(() => buildNavSections({
  apiPages: registeredPages.value,
  user: auth.user,
}));

const activeSection = computed(() => findSectionForRoute(sections.value, route.path));


</script>

<style scoped>
.section-subnav {
  --section-accent: var(--color-brand-primary);
  position: sticky;
  top: 0;
  z-index: var(--z-subnav);
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 6px clamp(12px, 1.2vw, 18px);
  border-bottom: 1px solid var(--color-border-soft);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--section-accent) 7%, rgba(255, 255, 255, 0.018)), rgba(255, 255, 255, 0.006)),
    color-mix(in srgb, var(--color-bg-panel) 86%, transparent);
  backdrop-filter: blur(10px);
}

.section-subnav[data-section="opsLive"] { --section-accent: #38bdf8; }
.section-subnav[data-section="players"] { --section-accent: #34d399; }
.section-subnav[data-section="balance"] { --section-accent: #f59e0b; }
.section-subnav[data-section="combat"] { --section-accent: #f87171; }
.section-subnav[data-section="broadcast"] { --section-accent: #a78bfa; }
.section-subnav[data-section="analytics"] { --section-accent: #22d3ee; }
.section-subnav[data-section="system"] { --section-accent: #94a3b8; }
.section-subnav[data-section="other"] { --section-accent: #c084fc; }

.subnav-head {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 28px;
  padding: 1px 10px 1px 2px;
  border-right: 1px solid color-mix(in srgb, var(--section-accent) 22%, var(--color-border-soft));
}

.subnav-icon {
  width: 22px;
  height: 22px;
  display: inline-grid;
  place-items: center;
  border-radius: 7px;
  border: 1px solid color-mix(in srgb, var(--section-accent) 24%, var(--color-border-soft));
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--section-accent) 18%, transparent), rgba(255, 255, 255, 0.025)),
    rgba(255, 255, 255, 0.04);
  color: var(--color-text-muted);
  font-size: 8px;
  font-weight: 800;
  flex: 0 0 auto;
}

.subnav-title {
  color: var(--color-text-primary);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
  line-height: 1;
}

.subnav-list {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
}

.subnav-list::-webkit-scrollbar {
  height: 4px;
}

.subnav-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}

.subnav-link {
  min-width: 0;
  height: 28px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  padding: 0 9px 0 6px;
  border-radius: 999px;
  border: 1px solid transparent;
  color: var(--color-text-secondary);
  text-decoration: none;
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease, box-shadow 0.12s ease;
}

.subnav-link:hover {
  background: color-mix(in srgb, var(--section-accent) 8%, rgba(255, 255, 255, 0.03));
  border-color: color-mix(in srgb, var(--section-accent) 20%, var(--color-border-soft));
  color: var(--color-text-primary);
}

.subnav-link.active {
  background: color-mix(in srgb, var(--section-accent) 16%, transparent);
  border-color: color-mix(in srgb, var(--section-accent) 30%, transparent);
  color: var(--color-text-primary);
  box-shadow: var(--shadow-sm);
}

.item-icon {
  width: 18px;
  height: 18px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid color-mix(in srgb, var(--section-accent) 18%, var(--color-border-soft));
  color: var(--color-text-muted);
  font-size: 7px;
  font-weight: 800;
  flex: 0 0 auto;
}

.subnav-link.active .item-icon {
  color: var(--color-text-primary);
  border-color: color-mix(in srgb, var(--section-accent) 34%, transparent);
  background: color-mix(in srgb, var(--section-accent) 16%, transparent);
}

.item-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 650;
}

@media (max-width: 900px) {
  .section-subnav {
    grid-template-columns: 1fr;
    gap: 6px;
    padding: 6px 10px;
  }

  .subnav-head {
    border-right: 0;
    padding-right: 0;
  }

  .subnav-list {
    padding-bottom: 2px;
  }
}

@media (max-width: 780px) {
  .section-subnav {
    top: calc(var(--safe-top) + 72px);
  }
}

@media (orientation: landscape) and (max-height: 520px) {
  .section-subnav {
    grid-template-columns: auto minmax(0, 1fr);
    gap: 6px;
    padding: 4px 8px;
    top: 0;
  }

  .subnav-head {
    min-height: 24px;
    padding-right: 6px;
  }

  .subnav-icon {
    width: 18px;
    height: 18px;
  }

  .subnav-title,
  .item-label {
    font-size: 11px;
  }

  .subnav-link {
    height: 24px;
    gap: 4px;
    padding: 0 7px 0 5px;
  }

  .item-icon {
    width: 16px;
    height: 16px;
  }
}
</style>
