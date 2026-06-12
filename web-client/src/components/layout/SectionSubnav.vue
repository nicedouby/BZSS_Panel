<template>
  <div v-if="activeSection && activeSection.items.length > 1" class="section-subnav" :data-section="activeSection.key">
    <div class="subnav-head">
      <span class="subnav-icon" aria-hidden="true">{{ activeSection.icon }}</span>
      <span class="subnav-title">{{ activeSection.label }}</span>
    </div>
    <nav class="subnav-list" :aria-label="`${activeSection.label}子导航`">
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
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { apiGet } from "../../app/apiClient";
import {
  buildNavSections,
  findSectionForRoute,
  isRouteActive,
  type RegisteredWebPage,
} from "../../app/sidebarNav";
import { useAuthStore } from "../../stores/auth.store";

const auth = useAuthStore();
const route = useRoute();
const apiPages = ref<RegisteredWebPage[]>([]);

const sections = computed(() => buildNavSections({
  apiPages: apiPages.value,
  user: auth.user,
}));

const activeSection = computed(() => findSectionForRoute(sections.value, route.path));

async function fetchPages() {
  try {
    const res = await apiGet<{ pages?: RegisteredWebPage[] }>("/api/web/pages");
    apiPages.value = res.pages || [];
  } catch (error) {
    console.error("Failed to fetch section subnav pages:", error);
  }
}

onMounted(fetchPages);
</script>

<style scoped>
.section-subnav {
  --section-accent: var(--color-brand-primary);
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 14px;
  padding: 9px clamp(14px, 1.4vw, 22px);
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
  gap: 8px;
  min-width: 0;
  min-height: 36px;
  padding: 3px 12px 3px 4px;
  border-right: 1px solid color-mix(in srgb, var(--section-accent) 22%, var(--color-border-soft));
}

.subnav-icon {
  width: 30px;
  height: 30px;
  display: inline-grid;
  place-items: center;
  border-radius: 9px;
  border: 1px solid color-mix(in srgb, var(--section-accent) 24%, var(--color-border-soft));
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--section-accent) 18%, transparent), rgba(255, 255, 255, 0.025)),
    rgba(255, 255, 255, 0.04);
  color: var(--color-text-muted);
  font-size: 9px;
  font-weight: 800;
  flex: 0 0 auto;
}

.subnav-title {
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 800;
  white-space: nowrap;
  line-height: 1;
}

.subnav-list {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
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
  height: 34px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 220px;
  padding: 0 11px 0 8px;
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
  width: 23px;
  height: 23px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid color-mix(in srgb, var(--section-accent) 18%, var(--color-border-soft));
  color: var(--color-text-muted);
  font-size: 8px;
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
  font-size: 13px;
  font-weight: 650;
}

@media (max-width: 900px) {
  .section-subnav {
    grid-template-columns: 1fr;
    gap: 8px;
    padding: 9px 12px;
  }

  .subnav-head {
    border-right: 0;
    padding-right: 0;
  }
}
</style>
