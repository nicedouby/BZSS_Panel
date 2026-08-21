import {
  canAccessPage,
  normalizePermissionList,
  normalizeRoute,
} from "../shared/web-page-permissions.js";
import {
  getStaticNavItems,
  pageRegistry,
  resolvePagePermissions,
} from "./pageRegistry";

export type NavSectionKey =
  | "opsLive"
  | "players"
  | "combat"
  | "balance"
  | "broadcast"
  | "analytics"
  | "system"
  | "other";

export interface NavItem {
  path: string;
  icon: string;
  label: string;
  section: NavSectionKey;
  order: number;
}

export interface NavSection {
  key: NavSectionKey;
  label: string;
  description: string;
  icon: string;
  defaultPath: string;
  items: NavItem[];
}

export interface RegisteredWebPage {
  id?: unknown;
  title?: unknown;
  route?: unknown;
  source?: unknown;
  enabled?: unknown;
  hiddenFromSidebar?: unknown;
  icon?: unknown;
  order?: unknown;
  requiredPermission?: unknown;
  legacyRequiredPermissions?: unknown;
  superAdminOnly?: unknown;
}

export const sectionOrder: NavSectionKey[] = [
  "opsLive",
  "players",
  "combat",
  "balance",
  "broadcast",
  "analytics",
  "system",
  "other",
];

export const sectionMeta: Record<NavSectionKey, { label: string; description: string; icon: string }> = {
  opsLive:   { label: "对局态势", description: "实时态势与现场沟通",       icon: "🎯" },
  players:   { label: "玩家与小队", description: "玩家档案、小队动作与建队规则", icon: "👥" },
  combat:    { label: "战斗记录", description: "伤害、击倒、死亡与执法调试",     icon: "⚔️" },
  balance:   { label: "队伍平衡", description: "跳边入口与公平换边",       icon: "⚖️" },
  broadcast: { label: "通知广播", description: "公告、警告与阶段提示",     icon: "📢" },
  analytics: { label: "数据分析", description: "统计、快照与诊断数据",     icon: "📊" },
  system:    { label: "系统维护", description: "运行状态、权限与审计",     icon: "🔧" },
  other:     { label: "其他工具", description: "暂未归类的页面",           icon: "🧩" },
};

export const staticNavItems: NavItem[] = [
  ...getStaticNavItems(),
  {
    path: "/tactical-replay",
    icon: "◷",
    label: "回放工作台",
    section: "opsLive",
    order: 16,
  },
  {
    path: "/plugins/steam-playtime-publicity-reminder",
    icon: "⏱",
    label: "督促时长公开",
    section: "broadcast",
    order: 145,
  },
  {
    path: "/plugins/panel-ban",
    icon: "🚫",
    label: "面板封禁",
    section: "players",
    order: 90,
  },
  {
    path: "/plugins/network-block",
    icon: "🌐",
    label: "网络阻塞",
    section: "players",
    order: 91,
  },
  {
    path: "/system/logpost-consumption-performance",
    icon: "📈",
    label: "消费性能评估",
    section: "system",
    order: 17,
  },
];

export function buildNavSections(options: {
  apiPages?: RegisteredWebPage[];
  user?: any;
} = {}): NavSection[] {
  const groupMap = createSectionMap();
  const seenPaths = new Set<string>();
  const seenLabels = new Set<string>();
  const apiPages = Array.isArray(options.apiPages) ? options.apiPages : [];

  for (const item of staticNavItems) {
    if (!canShowRoute(item.path, options.user)) continue;
    addItem(groupMap, seenPaths, seenLabels, item);
  }

  for (const page of apiPages) {
    if (!page.enabled || page.hiddenFromSidebar || isRetiredCombatRoute(page.route)) continue;
    if (!canShowPage(page, options.user)) continue;

    const path = normalizeRoute(page.route);
    const label = String(page.title ?? "").trim();
    if (!path || !label) continue;

    const section = resolveSection(path, page);
    addItem(groupMap, seenPaths, seenLabels, {
      path,
      icon: normalizeIcon(page.icon),
      label,
      section,
      order: normalizeDynamicOrder(section, Number(page.order ?? 9999)),
    });
  }

  return sectionOrder
    .map((key) => groupMap.get(key))
    .filter((section): section is NavSection => Boolean(section && section.items.length > 0))
    .map((section) => {
      const items = section.items.slice().sort(compareNavItems);
      return {
        ...section,
        defaultPath: items[0]?.path ?? "/match-status",
        items,
      };
    });
}

export function findSectionForRoute(sections: NavSection[], route: unknown): NavSection | null {
  const normalized = normalizeRoute(route);
  return sections.find((section) => section.items.some((item) => isRouteActive(normalized, item.path))) ?? null;
}

export function isRouteActive(currentRoute: unknown, itemRoute: unknown): boolean {
  const current = normalizeRoute(currentRoute);
  const item = normalizeRoute(itemRoute);
  if (current === item) return true;
  if (item === "/match-status" && current === "/match-state") return true;
  const definition = pageRegistry.find((page) => page.path === item);
  if (definition?.aliases?.some((alias) => current === alias || current.startsWith(`${alias}/`))) return true;
  return item !== "/" && current.startsWith(`${item}/`);
}

function createSectionMap() {
  const map = new Map<NavSectionKey, NavSection>();
  for (const key of sectionOrder) {
    map.set(key, {
      key,
      label: sectionMeta[key].label,
      description: sectionMeta[key].description,
      icon: sectionMeta[key].icon,
      defaultPath: "/match-status",
      items: [],
    });
  }
  return map;
}

function addItem(
  groupMap: Map<NavSectionKey, NavSection>,
  seenPaths: Set<string>,
  seenLabels: Set<string>,
  item: NavItem,
) {
  const path = normalizeRoute(item.path);
  const labelKey = normalizeLabel(item.label);
  if (seenPaths.has(path)) return;
  if (labelKey && seenLabels.has(labelKey)) return;

  groupMap.get(item.section)?.items.push({ ...item, path });
  seenPaths.add(path);
  if (labelKey) seenLabels.add(labelKey);
}

function canShowRoute(route: unknown, user: any) {
  const normalizedRoute = normalizeRoute(route);
  if (
    normalizedRoute === "/system/logpost-consumption-performance"
    || normalizedRoute === "/plugins/steam-playtime-publicity-reminder"
  ) {
    return Boolean(user?.isSuperAdmin);
  }

  const definition = pageRegistry.find((page) => page.path === normalizedRoute);
  const resolved = definition
    ? resolvePagePermissions(definition)
    : { requiredPermission: "", legacyRequiredPermissions: [], superAdminOnly: false };

  return canAccessPage(
    user,
    resolved.requiredPermission,
    normalizePermissionList(resolved.legacyRequiredPermissions),
    { superAdminOnly: resolved.superAdminOnly },
  );
}

function canShowPage(page: RegisteredWebPage, user: any) {
  return canAccessPage(
    user,
    String(page.requiredPermission ?? "").trim(),
    normalizePermissionList(page.legacyRequiredPermissions ?? []),
    { superAdminOnly: Boolean(page.superAdminOnly) },
  );
}

function isRetiredCombatRoute(route: unknown) {
  const value = normalizeRoute(route);
  return value.includes("combat") || value.includes("battle") || value.includes("kill") || value.includes("weapon");
}

function resolveSection(route: string, page: RegisteredWebPage): NavSectionKey {
  const id = normalizeLabel(page.id);
  const source = normalizeLabel(page.source);
  const title = normalizeLabel(page.title);

  if (route === "/match-status" || route === "/match-state" || route === "/chat-monitor" || route === "/bzss-core-snapshots") return "opsLive";
  if (route === "/combat-records" || route === "/kill-records" || route.includes("victim-damage-display")) return "combat";
  if (route === "/tb" || route.includes("fair-team-balance") || id.includes("team-balance")) return "balance";
  if (route === "/player-database" || route === "/reserve-slots" || route === "/black-edge-privilege" || route === "/player-session-records" || route === "/squad-management") return "players";
  if (route.includes("group-report") || route.includes("squad-rule-chain") || route.includes("fair-squad") || route.includes("stepwise-squad") || route.includes("lianban")) return "players";
  if (route.includes("tactical-report")) return "broadcast";
  if (route.includes("steam-playtime-publicity-reminder")) return "broadcast";
  if (route.includes("squad-name-classifier") || id.includes("player") || id.includes("squad")) return "players";
  if (route === "/admin-warns" || route === "/scheduled-broadcasts") return "broadcast";
  if (route.includes("draw-vote") || route.includes("welcome-join") || id.includes("warn") || id.includes("broadcast")) return "broadcast";
  if (route.includes("server-info-statistics") || route.includes("match-snapshots") || route.includes("pjsc")) return "analytics";
  if (id.includes("stats") || id.includes("snapshot") || title.includes("统计") || title.includes("快照")) return "analytics";
  if (route.startsWith("/system/") || route === "/console" || route === "/plugin-subscriptions" || route.includes("udp-forwarder")) return "system";
  if (id.includes("runtime") || id.includes("system") || source.includes("core")) return "system";
  return "other";
}

function normalizeDynamicOrder(section: NavSectionKey, order: number) {
  if (!Number.isFinite(order)) return 9999;
  const sectionFloor: Record<NavSectionKey, number> = {
    opsLive: 100,
    players: 100,
    combat: 100,
    balance: 100,
    broadcast: 100,
    analytics: 100,
    system: 100,
    other: 100,
  };
  return Math.max(sectionFloor[section], order);
}

function normalizeLabel(label: unknown): string {
  return String(label ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function normalizeIcon(icon: unknown): string {
  const text = String(icon ?? "").trim();
  if (!text) return "🔌";
  // 如果已经是 emoji（字符长度 ≤ 4 个代码点），直接返回
  if ([...text].length <= 4) return text;
  return text.length > 5 ? text.slice(0, 5).toUpperCase() : text.toUpperCase();
}

function compareNavItems(a: NavItem, b: NavItem) {
  return a.order - b.order || a.label.localeCompare(b.label, "zh-CN");
}
