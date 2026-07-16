import type { RouteRecordRaw } from "vue-router";

import {
  normalizePermissionList,
  resolveWebPagePermission,
} from "../shared/web-page-permissions.js";
import type { NavSectionKey } from "./sidebarNav";

export type PageCategory = "core" | "plugin" | "system" | "debug";
export type RefreshPolicy = "realtime" | "polling" | "manual";
export type LayoutMode = "workspace" | "document";
export type ContentPadding = "none" | "default";

export interface PageDefinition {
  name: string;
  path: string;
  component: Exclude<RouteRecordRaw["component"], null | undefined>;
  aliases?: string[];
  title?: string;
  titleKey?: string;
  category: PageCategory;
  refreshPolicy: RefreshPolicy;
  layoutMode: LayoutMode;
  contentPadding: ContentPadding;
  nav?: {
    section: NavSectionKey;
    label: string;
    icon: string;
    order: number;
    hidden?: boolean;
  };
  requiredPermission?: string;
  legacyRequiredPermissions?: string[];
  superAdminOnly?: boolean;
}

const workspacePage = {
  layoutMode: "workspace",
  contentPadding: "none",
} satisfies Pick<PageDefinition, "layoutMode" | "contentPadding">;

const documentPage = {
  layoutMode: "document",
  contentPadding: "default",
} satisfies Pick<PageDefinition, "layoutMode" | "contentPadding">;

export const pageRegistry: PageDefinition[] = [
  {
    name: "match-status",
    path: "/match-status",
    aliases: ["/match-state"],
    component: () => import("../pages/MatchStatusPage.vue"),
    titleKey: "routeTitle.matchStatus",
    category: "core",
    refreshPolicy: "realtime",
    nav: { section: "opsLive", label: "对局状态", icon: "📹", order: 10 },
    ...workspacePage,
  },
  {
    name: "tactical-map",
    path: "/tactical-map",
    component: () => import("../pages/TacticalMapPage.vue"),
    title: "战术地图",
    category: "core",
    refreshPolicy: "realtime",
    nav: { section: "opsLive", label: "战术地图", icon: "🛰️", order: 15 },
    ...workspacePage,
  },
  {
    name: "astrbot-server-info-card",
    path: "/astrbot/server-info-card",
    component: () => import("../pages/ServerInfoSnapshotPage.vue"),
    title: "AstrBot Server Info Card",
    category: "plugin",
    refreshPolicy: "manual",
    ...documentPage,
  },
  {
    name: "console",
    path: "/console",
    component: () => import("../pages/ConsolePage.vue"),
    titleKey: "routeTitle.console",
    category: "core",
    refreshPolicy: "realtime",
    nav: { section: "system", label: "控制台", icon: "🖥️", order: 20 },
    superAdminOnly: true,
    ...workspacePage,
  },
  {
    name: "chat-monitor",
    path: "/chat-monitor",
    component: () => import("../pages/ChatMonitorPage.vue"),
    title: "聊天监控",
    category: "core",
    refreshPolicy: "realtime",
    nav: { section: "opsLive", label: "聊天监控", icon: "💬", order: 20 },
    ...workspacePage,
  },
  {
    name: "squad-creation-order",
    path: "/match/squad-creation-order",
    component: () => import("../pages/SquadCreationOrderPage.vue"),
    title: "建队顺序",
    category: "core",
    refreshPolicy: "polling",
    nav: { section: "opsLive", label: "建队顺序", icon: "🔢", order: 25 },
    requiredPermission: "squad_management.view",
    ...workspacePage,
  },
  {
    name: "player-session-records",
    path: "/player-session-records",
    component: () => import("../pages/PlayerSessionRecordsPage.vue"),
    title: "进出服记录",
    category: "core",
    refreshPolicy: "polling",
    nav: { section: "players", label: "进出服记录", icon: "🕛", order: 40 },
    ...workspacePage,
  },
  {
    name: "player-database",
    path: "/player-database",
    component: () => import("../pages/PlayerDatabasePage.vue"),
    titleKey: "routeTitle.playerDatabase",
    category: "core",
    refreshPolicy: "manual",
    nav: { section: "players", label: "玩家数据库", icon: "🗄️", order: 10 },
    ...workspacePage,
  },
  {
    name: "reserve-slots",
    path: "/reserve-slots",
    component: () => import("../pages/ReserveSlotsPage.vue"),
    titleKey: "routeTitle.reserveSlots",
    category: "core",
    refreshPolicy: "manual",
    nav: { section: "players", label: "预留位管理", icon: "🎫", order: 20 },
    ...workspacePage,
  },
  {
    name: "warmup-reserve-grant",
    path: "/warmup-reserve-grant",
    component: () => import("../pages/WarmupReserveGrantPage.vue"),
    title: "暖服赠送预留位",
    category: "core",
    refreshPolicy: "polling",
    nav: { section: "players", label: "暖服赠送预留位", icon: "🔥", order: 25 },
    superAdminOnly: true,
    ...workspacePage,
  },
  {
    name: "black-edge-privilege",
    path: "/black-edge-privilege",
    component: () => import("../pages/BlackEdgePrivilegePage.vue"),
    title: "黑奴跳边 CDK",
    category: "core",
    refreshPolicy: "manual",
    nav: { section: "players", label: "黑奴跳边 CDK", icon: "🔑", order: 30 },
    ...workspacePage,
  },
  {
    name: "combat-manager",
    path: "/combat-manager",
    component: () => import("../pages/CombatManagerPage.vue"),
    titleKey: "routeTitle.combatManager",
    category: "core",
    refreshPolicy: "polling",
    nav: { section: "combat", label: "战斗管理", icon: "🛡️", order: 10 },
    requiredPermission: "combat_manager.view",
    legacyRequiredPermissions: ["kill_manager.view"],
    ...workspacePage,
  },
  {
    name: "combat-log",
    path: "/combat-log",
    component: () => import("../pages/CombatLogPage.vue"),
    titleKey: "routeTitle.combatLog",
    category: "core",
    refreshPolicy: "polling",
    nav: { section: "combat", label: "战斗日志", icon: "📝", order: 30 },
    ...workspacePage,
  },
  {
    name: "combat-log-query",
    path: "/combat-log/query",
    component: () => import("../pages/CombatLogQueryPage.vue"),
    title: "战斗日志查询",
    category: "core",
    refreshPolicy: "manual",
    requiredPermission: "combat_manager.view",
    legacyRequiredPermissions: ["kill_manager.view"],
    ...workspacePage,
  },
  {
    name: "battle-log",
    path: "/battle-log",
    component: () => import("../pages/BattleLogPage.vue"),
    titleKey: "routeTitle.battleLog",
    category: "core",
    refreshPolicy: "polling",
    nav: { section: "combat", label: "战绩记录", icon: "🏆", order: 20 },
    requiredPermission: "combat_manager.view",
    legacyRequiredPermissions: ["kill_manager.view"],
    ...workspacePage,
  },
  {
    name: "admin-warns",
    path: "/admin-warns",
    component: () => import("../pages/AdminWarnsPage.vue"),
    titleKey: "routeTitle.adminWarns",
    category: "core",
    refreshPolicy: "polling",
    nav: { section: "broadcast", label: "广播模块", icon: "🚨", order: 10 },
    ...workspacePage,
  },
  {
    name: "scheduled-broadcasts",
    path: "/scheduled-broadcasts",
    component: () => import("../pages/ScheduledBroadcastPage.vue"),
    title: "定时广播",
    category: "core",
    refreshPolicy: "polling",
    nav: { section: "broadcast", label: "定时广播", icon: "⏰", order: 20 },
    ...workspacePage,
  },
  {
    name: "group-report",
    path: "/plugins/group-report",
    component: () => import("../pages/GroupReportPage.vue"),
    title: "组队举报",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "players", label: "组队举报", icon: "🚩", order: 60 },
    ...workspacePage,
  },
  {
    name: "tactical-report",
    path: "/plugins/tactical-report",
    component: () => import("../pages/TacticalReportPage.vue"),
    title: "战术报点",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "broadcast", label: "战术报点", icon: "📻", order: 45 },
    requiredPermission: "plugin:tactical-report:view",
    ...workspacePage,
  },
  {
    name: "tactical-report-config",
    path: "/plugins/tactical-report/config",
    component: () => import("../pages/TacticalReportConfigPage.vue"),
    title: "战术报点配置",
    category: "plugin",
    refreshPolicy: "polling",
    requiredPermission: "plugin:tactical-report:update",
    nav: { section: "broadcast", label: "战术报点配置", icon: "📻", order: 46, hidden: true },
    ...workspacePage,
  },
  {
    name: "fair-team-balance",
    path: "/plugins/fair-team-balance",
    component: () => import("../pages/FairTeamBalancePage.vue"),
    title: "公平跳边",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "balance", label: "公平跳边", icon: "🔀", order: 20 },
    ...workspacePage,
  },
  {
    name: "squad-rule-chain",
    path: "/squad-rule-chain",
    aliases: [
      "/debug/squad-name-tracking",
      "/debug/squad-name-policy",
      "/plugins/stepwise-squad-playtime-guard",
      "/plugins/fair-squad-guard",
    ],
    component: () => import("../pages/SquadNameTrackingPage.vue"),
    title: "建队规则链",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "players", label: "建队规则链", icon: "🔗", order: 70 },
    ...workspacePage,
  },
  {
    name: "squad-rule-chain-squad-name",
    path: "/squad-rule-chain/squad-name",
    component: () => import("../pages/SquadNameTrackingPage.vue"),
    title: "队名规范流程",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "players", label: "队名规范流程", icon: "🔗", order: 71, hidden: true },
    ...workspacePage,
  },
  {
    name: "squad-rule-chain-stepwise",
    path: "/squad-rule-chain/stepwise",
    component: () => import("../pages/SquadNameTrackingPage.vue"),
    title: "阶梯式建队流程",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "players", label: "阶梯式建队流程", icon: "🔗", order: 72, hidden: true },
    ...workspacePage,
  },
  {
    name: "squad-rule-chain-fair",
    path: "/squad-rule-chain/fair",
    component: () => import("../pages/SquadNameTrackingPage.vue"),
    title: "公平建队流程",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "players", label: "公平建队流程", icon: "🔗", order: 73, hidden: true },
    ...workspacePage,
  },
  {
    name: "panel-ban",
    path: "/plugins/panel-ban",
    component: () => import("../pages/PanelBanPage.vue"),
    title: "面板封禁",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "players", label: "面板封禁", icon: "🚫", order: 90 },
    ...workspacePage,
  },
  {
    name: "squad-management",
    path: "/squad-management",
    component: () => import("../pages/SquadManagementPage.vue"),
    titleKey: "routeTitle.squadManagement",
    category: "core",
    refreshPolicy: "polling",
    nav: { section: "players", label: "小队管理", icon: "💻", order: 50 },
    ...workspacePage,
  },
  {
    name: "team-balance",
    path: "/tb",
    component: () => import("../pages/TeamBalancePage.vue"),
    titleKey: "routeTitle.teamBalance",
    category: "core",
    refreshPolicy: "manual",
    nav: { section: "balance", label: "跳边入口", icon: "🔁", order: 10 },
    ...workspacePage,
  },
  {
    name: "team-shuffle",
    path: "/team-shuffle",
    component: () => import("../pages/TeamShufflePage.vue"),
    title: "随机打乱",
    category: "core",
    refreshPolicy: "manual",
    nav: { section: "balance", label: "随机打乱", icon: "🎲", order: 15 },
    ...workspacePage,
  },
  {
    name: "plugin-subscriptions",
    path: "/plugin-subscriptions",
    component: () => import("../pages/PluginSubscriptionsPage.vue"),
    titleKey: "routeTitle.pluginSubscriptions",
    category: "system",
    refreshPolicy: "polling",
    nav: { section: "system", label: "插件订阅", icon: "🔌", order: 50 },
    ...workspacePage,
  },
  {
    name: "udp-forwarder",
    path: "/debug/udp-forwarder",
    component: () => import("../pages/UdpEventForwarderPage.vue"),
    title: "UDP 转发日志",
    category: "debug",
    refreshPolicy: "manual",
    nav: { section: "system", label: "UDP 转发日志", icon: "📡", order: 60 },
    ...documentPage,
  },
  {
    name: "bzss-core-snapshots",
    path: "/bzss-core-snapshots",
    component: () => import("../pages/BzssCoreSnapshotsPage.vue"),
    title: "BZSS-Core 玩家快照",
    category: "core",
    refreshPolicy: "polling",
    nav: { section: "opsLive", label: "BZSS-Core 快照", icon: "💾", order: 26 },
    requiredPermission: "bzss_core.use",
    ...workspacePage,
  },
  {
    name: "bzss-core-debug",
    path: "/debug/bzss-core",
    component: () => import("../pages/BzssCoreDebugPage.vue"),
    title: "BZSS-Core 解析调试",
    category: "debug",
    refreshPolicy: "manual",
    nav: { section: "opsLive", label: "BZSS-Core 调试", icon: "🧪", order: 27 },
    requiredPermission: "bzss_core.use",
    ...workspacePage,
  },
  {
    name: "server-info-statistics",
    path: "/plugins/server-info-statistics",
    component: () => import("../pages/ServerInfoStatisticsPage.vue"),
    title: "服务器统计",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "analytics", label: "服务器统计", icon: "📈", order: 10 },
    ...workspacePage,
  },
  {
    name: "match-snapshots",
    path: "/debug/match-snapshots",
    component: () => import("../pages/MatchSnapshotDebugPage.vue"),
    title: "快照录制",
    category: "debug",
    refreshPolicy: "manual",
    nav: { section: "analytics", label: "快照录制", icon: "📸", order: 20 },
    ...documentPage,
  },
  {
    name: "pjsc-average-duration",
    path: "/debug/pjsc-average-duration",
    component: () => import("../pages/PjscAverageDurationPage.vue"),
    title: "PJSC 平均时长",
    category: "debug",
    refreshPolicy: "manual",
    nav: { section: "analytics", label: "PJSC 平均时长", icon: "⏱️", order: 30 },
    ...documentPage,
  },
  {
    name: "draw-vote-guard",
    path: "/debug/draw-vote-guard",
    component: () => import("../pages/DrawVoteGuardDebugPage.vue"),
    title: "平局投票提示",
    category: "debug",
    refreshPolicy: "manual",
    nav: { section: "broadcast", label: "平局投票提示", icon: "⚖️", order: 30 },
    ...documentPage,
  },
  {
    name: "fair-team-balance-lab",
    path: "/debug/fair-team-balance-lab",
    component: () => import("../pages/FairTeamBalanceLabPage.vue"),
    title: "公平跳边实验室",
    category: "debug",
    refreshPolicy: "manual",
    nav: { section: "balance", label: "公平跳边模拟", icon: "🧪", order: 30 },
    ...workspacePage,
  },
  {
    name: "welcome-join-warning",
    path: "/debug/welcome-join-warning",
    component: () => import("../pages/WelcomeJoinWarningDebugPage.vue"),
    title: "进服警告",
    category: "debug",
    refreshPolicy: "manual",
    nav: { section: "broadcast", label: "进服警告", icon: "⚠️", order: 40 },
    ...documentPage,
  },

  {
    name: "squad-name-rules",
    path: "/debug/squad-name-policy/rules",
    component: () => import("../pages/SquadNameRulesPage.vue"),
    title: "队名规范规则维护",
    category: "debug",
    refreshPolicy: "manual",
    ...workspacePage,
  },
  {
    name: "runtime-status",
    path: "/system/status",
    component: () => import("../pages/RuntimeStatusPage.vue"),
    titleKey: "routeTitle.runtimeStatus",
    category: "system",
    refreshPolicy: "polling",
    nav: { section: "system", label: "运行状态", icon: "📶", order: 10 },
    ...documentPage,
  },
  {
    name: "logpost-inspect",
    path: "/system/logpost",
    component: () => import("../pages/LogPostInspectPage.vue"),
    title: "LogPost v2 审计面",
    category: "system",
    refreshPolicy: "manual",
    nav: { section: "system", label: "LogPost v2 审计", icon: "🔎", order: 15 },
    superAdminOnly: true,
    ...documentPage,
  },
  {
    name: "admin-users",
    path: "/system/admin-users",
    component: () => import("../pages/AdminUsersPage.vue"),
    title: "管理员账号",
    category: "system",
    refreshPolicy: "polling",
    nav: { section: "system", label: "管理员账号", icon: "👤", order: 30 },
    superAdminOnly: true,
    ...documentPage,
  },
  {
    name: "audit-records",
    path: "/system/audit-records",
    component: () => import("../pages/AuditRecordsPage.vue"),
    title: "操作记录",
    category: "system",
    refreshPolicy: "polling",
    nav: { section: "system", label: "操作记录", icon: "📋", order: 40 },
    requiredPermission: "audit.view",
    ...workspacePage,
  },
];

export function getPageDefinitionByPath(path: string) {
  return pageRegistry.find((page) => page.path === path || page.aliases?.includes(path));
}

export function buildPageRoutes(): RouteRecordRaw[] {
  return pageRegistry.map((page) => {
    const permissions = resolvePagePermissions(page);
    const route: RouteRecordRaw = {
      name: page.name,
      path: page.path,
      component: page.component,
      meta: {
        title: page.title,
        titleKey: page.titleKey,
        category: page.category,
        refreshPolicy: page.refreshPolicy,
        layoutMode: page.layoutMode,
        contentPadding: page.contentPadding,
        requiredPermission: permissions.requiredPermission,
        legacyRequiredPermissions: permissions.legacyRequiredPermissions,
        superAdminOnly: permissions.superAdminOnly,
      },
    };

    if (page.aliases?.length) {
      route.alias = page.aliases;
    }

    return {
      ...route,
    };
  });
}

export function getStaticNavItems() {
  return pageRegistry
    .filter((page) => page.nav && !page.nav.hidden)
    .map((page) => ({
      path: page.path,
      icon: page.nav!.icon,
      label: page.nav!.label,
      section: page.nav!.section,
      order: page.nav!.order,
    }));
}

export function resolvePagePermissions(page: Pick<
  PageDefinition,
  "path" | "requiredPermission" | "legacyRequiredPermissions" | "superAdminOnly"
>) {
  const resolved = resolveWebPagePermission(page.path);
  const requiredPermission = String(page.requiredPermission ?? resolved?.requiredPermission ?? "").trim();
  const legacyRequiredPermissions = mergePermissionLists(
    page.legacyRequiredPermissions,
    resolved?.legacyRequiredPermissions,
  );
  const superAdminOnly = Boolean(page.superAdminOnly ?? resolved?.superAdminOnly);

  return {
    requiredPermission,
    legacyRequiredPermissions,
    superAdminOnly,
  };
}

function mergePermissionLists(...values: unknown[]) {
  const merged: string[] = [];
  for (const value of values) {
    for (const permission of normalizePermissionList(value)) {
      if (!merged.includes(permission)) merged.push(permission);
    }
  }
  return merged;
}
