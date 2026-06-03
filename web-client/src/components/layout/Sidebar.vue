<template>
  <div v-if="ui.mobileSidebarOpen" class="sidebar-backdrop" @click="ui.closeMobileSidebar()" />
  <aside class="sidebar" :class="{ collapsed: ui.sidebarCollapsed, mobileOpen: ui.mobileSidebarOpen }">
    <div class="brand">
      <strong>BZSS</strong>
      <span>Vue {{ t("common.panel") }}</span>
    </div>
    <nav>
      <div v-for="group in groups" :key="group.key" class="nav-group">
        <h3 class="group-title">{{ group.title }}</h3>
        <template v-for="item in group.items" :key="`${group.key}-${item.path}`">
          <RouterLink :to="item.path" @click="ui.closeMobileSidebar()">
            <span class="nav-icon">{{ item.icon }}</span>
            <span class="nav-label">{{ item.label }}</span>
          </RouterLink>
        </template>
      </div>
    </nav>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useUiStore } from "../../stores/ui.store";
import { useAuthStore } from "../../stores/auth.store";
import { apiGet } from "../../app/apiClient";
import { t } from "../../i18n";
import {
  canAccessPage,
  normalizePermissionList,
  resolveWebPagePermission,
} from "../../shared/web-page-permissions.js";

type SidebarSectionKey =
  | "opsLive"
  | "players"
  | "combat"
  | "broadcast"
  | "plugins"
  | "system"
  | "debug"
  | "other";

interface SidebarItem {
  path: string;
  icon: string;
  label: string;
  section: SidebarSectionKey;
  order: number;
}

interface SidebarGroup {
  key: SidebarSectionKey;
  title: string;
  items: SidebarItem[];
}

const ui = useUiStore();
const auth = useAuthStore();
const apiPages = ref<any[]>([]);

const sectionOrder: SidebarSectionKey[] = [
  "opsLive",
  "players",
  "combat",
  "broadcast",
  "plugins",
  "system",
  "debug",
  "other",
];

const sectionTitleKeys: Record<SidebarSectionKey, string> = {
  opsLive: "nav.opsLiveCategory",
  players: "nav.playersCategory",
  combat: "nav.combatCategory",
  broadcast: "nav.broadcastCategory",
  plugins: "nav.pluginsCategory",
  system: "nav.systemCategory",
  debug: "nav.debugCategory",
  other: "nav.otherCategory",
};

const staticItems: SidebarItem[] = [
  { path: "/match-status", icon: "MS", label: t("nav.matchStatus"), section: "opsLive", order: 10 },
  { path: "/console", icon: "CON", label: t("nav.console"), section: "opsLive", order: 20 },
  { path: "/chat-monitor", icon: "CHAT", label: t("nav.chatMonitor"), section: "opsLive", order: 30 },
  { path: "/player-database", icon: "DB", label: t("nav.playerDatabase"), section: "players", order: 40 },
  { path: "/player-session-records", icon: "REC", label: t("nav.playerSessionRecords"), section: "players", order: 50 },
  { path: "/squad-management", icon: "SQ", label: t("nav.squadManagement"), section: "players", order: 60 },
  { path: "/tb", icon: "TB", label: t("nav.teamBalance"), section: "players", order: 65 },
  { path: "/combat-manager", icon: "CB", label: t("nav.combatManager"), section: "combat", order: 70 },
  { path: "/combat-log", icon: "LOG", label: t("nav.combatLog"), section: "combat", order: 80 },
  { path: "/admin-warns", icon: "BR", label: t("nav.adminWarns"), section: "broadcast", order: 90 },
  { path: "/scheduled-broadcasts", icon: "SCH", label: t("nav.scheduledBroadcasts"), section: "broadcast", order: 100 },
  { path: "/plugins/infantry-combat-enhancer", icon: "ICE", label: t("nav.infantryCombatEnhancer"), section: "plugins", order: 110 },
  { path: "/plugins/group-report", icon: "GR", label: t("nav.groupReport"), section: "plugins", order: 120 },
  { path: "/plugins/server-info-statistics", icon: "STS", label: t("nav.serverInfoStatistics"), section: "plugins", order: 130 },
  { path: "/plugins/fair-squad-guard", icon: "FSG", label: t("nav.fairSquadGuard"), section: "plugins", order: 132 },
  { path: "/system/status", icon: "SYS", label: t("nav.runtimeStatus"), section: "system", order: 140 },
  { path: "/debug/udp-forwarder", icon: "UDP", label: t("nav.udpForwarder"), section: "debug", order: 150 },
  { path: "/debug/match-snapshots", icon: "SNP", label: t("nav.matchSnapshots"), section: "debug", order: 160 },
  { path: "/debug/pjsc-average-duration", icon: "PJ", label: t("nav.pjscAverageDuration"), section: "debug", order: 170 },
  { path: "/debug/draw-vote-guard", icon: "DVG", label: t("nav.drawVoteGuard"), section: "debug", order: 180 },
  { path: "/debug/welcome-join-warning", icon: "WJW", label: t("nav.welcomeJoinWarning"), section: "debug", order: 190 },
  { path: "/debug/squad-name-classifier", icon: "SNC", label: t("nav.squadNameClassifier"), section: "debug", order: 200 },
];

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

function canShowRoute(route: unknown, legacyRequiredPermissions: unknown[] = []) {
  const resolved = resolveWebPagePermission(route);
  const requiredPermission = resolved?.requiredPermission ?? "";
  const legacyPermissions = normalizePermissionList(legacyRequiredPermissions);
  return canAccessPage(auth.user, requiredPermission, legacyPermissions);
}

function canShowPage(page: any) {
  return canAccessPage(
    auth.user,
    String(page?.requiredPermission ?? "").trim(),
    normalizePermissionList(page?.legacyRequiredPermissions ?? []),
  );
}

function resolveSection(route: string, page: any): SidebarSectionKey {
  const id = normalizeLabel(page?.id);
  const source = normalizeLabel(page?.source);

  if (route.startsWith("/debug/") || id.includes("debug")) return "debug";
  if (route.startsWith("/system/") || id.includes("runtime") || id.includes("system")) return "system";
  if (route === "/match-status" || route === "/match-state" || route === "/console" || route === "/chat-monitor") return "opsLive";
  if (route === "/player-database" || route === "/player-session-records" || route === "/squad-management") return "players";
  if (route === "/combat-manager" || route === "/combat-log" || route === "/kill-manage" || route === "/combat-clean") return "combat";
  if (route === "/admin-warns" || route === "/scheduled-broadcasts") return "broadcast";
  if (route.startsWith("/plugins/") || source.includes("plugin")) return "plugins";
  if (id.includes("player") || id.includes("squad")) return "players";
  if (id.includes("combat")) return "combat";
  if (id.includes("warn") || id.includes("broadcast")) return "broadcast";
  return "other";
}

function createGroupMap() {
  const map = new Map<SidebarSectionKey, SidebarGroup>();
  for (const key of sectionOrder) {
    map.set(key, {
      key,
      title: t(sectionTitleKeys[key], key),
      items: [],
    });
  }
  return map;
}

const groups = computed(() => {
  const map = createGroupMap();
  const seenPaths = new Set<string>();
  const seenLabels = new Set<string>();

  for (const item of staticItems) {
    if (!canShowRoute(item.path)) continue;
    const normalizedPath = normalizePath(item.path);
    const normalizedLabel = normalizeLabel(item.label);
    if (seenPaths.has(normalizedPath)) continue;

    map.get(item.section)?.items.push({ ...item, path: normalizedPath });
    seenPaths.add(normalizedPath);
    if (normalizedLabel) seenLabels.add(normalizedLabel);
  }

  for (const page of apiPages.value) {
    if (!page.enabled || page.hiddenFromSidebar) continue;
    if (!canShowPage(page)) continue;

    const route = normalizePath(page.route);
    const label = String(page.title ?? "").trim();
    const normalizedLabel = normalizeLabel(label);
    if (seenPaths.has(route)) continue;
    if (normalizedLabel && seenLabels.has(normalizedLabel)) continue;

    const section = resolveSection(route, page);
    map.get(section)?.items.push({
      path: route,
      icon: String(page.icon ?? "P"),
      label,
      section,
      order: Number(page.order ?? 9999),
    });

    seenPaths.add(route);
    if (normalizedLabel) seenLabels.add(normalizedLabel);
  }

  return sectionOrder
    .map((key) => map.get(key))
    .filter((group): group is SidebarGroup => Boolean(group && group.items.length > 0))
    .map((group) => ({
      ...group,
      items: group.items.slice().sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)),
    }));
});

async function fetchPages() {
  try {
    const res = await apiGet<any>("/api/web/pages");
    apiPages.value = res.pages || [];
  } catch (error) {
    console.error("Failed to fetch sidebar pages:", error);
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
