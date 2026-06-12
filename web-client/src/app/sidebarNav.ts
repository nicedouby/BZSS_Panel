import {
  canAccessPage,
  normalizePermissionList,
  normalizeRoute,
  resolveWebPagePermission,
} from "../shared/web-page-permissions.js";

export type NavSectionKey =
  | "opsLive"
  | "players"
  | "balance"
  | "combat"
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
  "balance",
  "combat",
  "broadcast",
  "analytics",
  "system",
  "other",
];

export const sectionMeta: Record<NavSectionKey, { label: string; description: string; icon: string }> = {
  opsLive: { label: "对局态势", description: "实时态势与现场沟通", icon: "OPS" },
  players: { label: "玩家与小队", description: "玩家档案、小队动作与建队规则", icon: "PLY" },
  balance: { label: "队伍平衡", description: "跳边入口与公平换边", icon: "BAL" },
  combat: { label: "战斗管理", description: "处置、战绩与战斗事件", icon: "CBT" },
  broadcast: { label: "通知广播", description: "公告、警告与阶段提示", icon: "BRD" },
  analytics: { label: "数据分析", description: "统计、快照与诊断数据", icon: "DAT" },
  system: { label: "系统维护", description: "运行状态、权限与审计", icon: "SYS" },
  other: { label: "其他工具", description: "暂未归类的页面", icon: "OTH" },
};

export const staticNavItems: NavItem[] = [
  { path: "/match-status", icon: "MS", label: "对局状态", section: "opsLive", order: 10 },
  { path: "/chat-monitor", icon: "CHAT", label: "聊天监控", section: "opsLive", order: 20 },

  { path: "/player-database", icon: "DB", label: "玩家数据库", section: "players", order: 10 },
  { path: "/player-session-records", icon: "REC", label: "进出服记录", section: "players", order: 20 },
  { path: "/squad-management", icon: "SQ", label: "小队管理", section: "players", order: 30 },
  { path: "/plugins/group-report", icon: "GR", label: "组队举报", section: "players", order: 40 },
  { path: "/plugins/fair-squad-guard", icon: "FSG", label: "公平建队", section: "players", order: 50 },
  { path: "/plugins/stepwise-squad-playtime-guard", icon: "SSP", label: "阶梯式建队时长", section: "players", order: 60 },
  { path: "/plugins/lianban-kick", icon: "LB", label: "联办踢出", section: "players", order: 70 },
  { path: "/debug/squad-name-classifier", icon: "SNC", label: "小队名称分类器", section: "players", order: 80 },

  { path: "/tb", icon: "TB", label: "跳边入口", section: "balance", order: 10 },
  { path: "/plugins/fair-team-balance", icon: "FTB", label: "公平跳边", section: "balance", order: 20 },

  { path: "/combat-manager", icon: "CM", label: "战斗管理", section: "combat", order: 10 },
  { path: "/battle-log", icon: "BTL", label: "战绩记录", section: "combat", order: 20 },
  { path: "/combat-log", icon: "LOG", label: "战斗日志", section: "combat", order: 30 },
  { path: "/plugins/infantry-combat-enhancer", icon: "ICE", label: "步兵战斗增强", section: "combat", order: 40 },

  { path: "/admin-warns", icon: "WARN", label: "广播模块", section: "broadcast", order: 10 },
  { path: "/scheduled-broadcasts", icon: "SCH", label: "定时广播", section: "broadcast", order: 20 },
  { path: "/debug/draw-vote-guard", icon: "DVG", label: "平局投票提示", section: "broadcast", order: 30 },
  { path: "/debug/welcome-join-warning", icon: "WJW", label: "入服欢迎警告", section: "broadcast", order: 40 },

  { path: "/plugins/server-info-statistics", icon: "STS", label: "服务器统计", section: "analytics", order: 10 },
  { path: "/debug/match-snapshots", icon: "SNP", label: "快照录制", section: "analytics", order: 20 },
  { path: "/debug/pjsc-average-duration", icon: "PJ", label: "PJSC 平均时长", section: "analytics", order: 30 },

  { path: "/system/status", icon: "RUN", label: "运行状态", section: "system", order: 10 },
  { path: "/console", icon: "CON", label: "控制台", section: "system", order: 20 },
  { path: "/system/admin-users", icon: "USR", label: "管理员账号", section: "system", order: 30 },
  { path: "/system/audit-records", icon: "AUD", label: "操作记录", section: "system", order: 40 },
  { path: "/plugin-subscriptions", icon: "SUB", label: "插件订阅", section: "system", order: 50 },
  { path: "/debug/udp-forwarder", icon: "UDP", label: "UDP 转发日志", section: "system", order: 60 },
];

export function buildNavSections(options: {
  apiPages?: RegisteredWebPage[];
  user?: any;
} = {}): NavSection[] {
  const groupMap = createSectionMap();
  const seenPaths = new Set<string>();
  const seenLabels = new Set<string>();

  for (const item of staticNavItems) {
    if (!canShowRoute(item.path, options.user)) continue;
    addItem(groupMap, seenPaths, seenLabels, item);
  }

  for (const page of options.apiPages ?? []) {
    if (!page.enabled || page.hiddenFromSidebar) continue;
    if (!canShowPage(page, options.user)) continue;

    const path = normalizeRoute(page.route);
    const label = String(page.title ?? "").trim();
    if (!path || !label) continue;

    addItem(groupMap, seenPaths, seenLabels, {
      path,
      icon: normalizeIcon(page.icon),
      label,
      section: resolveSection(path, page),
      order: normalizeDynamicOrder(resolveSection(path, page), Number(page.order ?? 9999)),
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
  if (item === "/combat-manager" && current === "/combat-clean") return true;
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
  const resolved = resolveWebPagePermission(route);
  return canAccessPage(
    user,
    resolved?.requiredPermission ?? "",
    normalizePermissionList(resolved?.legacyRequiredPermissions ?? []),
    { superAdminOnly: Boolean(resolved?.superAdminOnly) },
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

function resolveSection(route: string, page: RegisteredWebPage): NavSectionKey {
  const id = normalizeLabel(page.id);
  const source = normalizeLabel(page.source);
  const title = normalizeLabel(page.title);

  if (route === "/match-status" || route === "/match-state" || route === "/chat-monitor") return "opsLive";
  if (route === "/tb" || route.includes("fair-team-balance") || id.includes("team-balance")) return "balance";
  if (route === "/player-database" || route === "/player-session-records" || route === "/squad-management") return "players";
  if (route.includes("group-report") || route.includes("fair-squad") || route.includes("stepwise-squad") || route.includes("lianban")) return "players";
  if (route.includes("squad-name-classifier") || id.includes("player") || id.includes("squad")) return "players";
  if (route === "/combat-manager" || route === "/battle-log" || route === "/combat-log" || route === "/combat-clean") return "combat";
  if (route.includes("infantry-combat") || route.includes("weapon") || route.includes("kill") || id.includes("combat") || id.includes("battle")) return "combat";
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
    balance: 100,
    combat: 100,
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
  if (!text) return "P";
  return text.length > 5 ? text.slice(0, 5).toUpperCase() : text.toUpperCase();
}

function compareNavItems(a: NavItem, b: NavItem) {
  return a.order - b.order || a.label.localeCompare(b.label, "zh-CN");
}
