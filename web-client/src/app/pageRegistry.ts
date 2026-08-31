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
    name: "ticket-curve",
    path: "/ticket-curve",
    component: () => import("../pages/TicketCurvePage.vue"),
    title: "双方票数曲线",
    category: "core",
    refreshPolicy: "polling",
    nav: { section: "opsLive", label: "票数曲线", icon: "📉", order: 12 },
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
    name: "pressure-zone-simulator",
    path: "/debug/pressure-zone",
    component: () => import("../pages/PressureZoneSimulatorPage.vue"),
    title: "压家区域模拟器",
    category: "debug",
    refreshPolicy: "manual",
    nav: { section: "opsLive", label: "压家区域模拟器", icon: "🛡️", order: 16 },
    requiredPermission: "settings.manage",
    ...workspacePage,
  },
  {
    name: "pressure-zone-rules",
    path: "/pressure-zone-rules",
    component: () => import("../pages/PressureZoneRulesPage.vue"),
    title: "压家圈服规",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "opsLive", label: "压家圈服规", icon: "🛡️", order: 17 },
    ...workspacePage,
  },
  {
    name: "pressure-zone-settings",
    path: "/settings/pressure-zone",
    component: () => import("../pages/PressureZoneSettingsPage.vue"),
    title: "压家圈基础参数",
    category: "system",
    refreshPolicy: "manual",
    requiredPermission: "settings.manage",
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
    name: "astrbot-bridge",
    path: "/system/astrbot",
    component: () => import("../pages/AstrbotBridgePage.vue"),
    title: "AstrBot 网关",
    category: "system",
    refreshPolicy: "polling",
    nav: { section: "system", label: "AstrBot 网关", icon: "🤖", order: 25 },
    requiredPermission: "astrbot.manage",
    ...workspacePage,
  },
  {
    name: "astrbot-player-snapshot-test",
    path: "/system/astrbot/player-snapshot-test",
    component: () => import("../pages/AstrbotPlayerSnapshotTestPage.vue"),
    title: "玩家信息图片测试",
    category: "system",
    refreshPolicy: "manual",
    nav: { section: "system", label: "玩家图片测试", icon: "🪪", order: 27 },
    requiredPermission: "astrbot.manage",
    ...workspacePage,
  },
  {
    name: "astrbot-interaction-records",
    path: "/system/astrbot/interactions",
    component: () => import("../pages/AstrbotInteractionRecordsPage.vue"),
    title: "机器人互动记录",
    category: "system",
    refreshPolicy: "polling",
    nav: { section: "system", label: "机器人互动记录", icon: "💬", order: 26 },
    requiredPermission: "astrbot.manage",
    ...workspacePage,
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
    name: "combat-records",
    path: "/combat-records",
    aliases: ["/kill-records"],
    component: () => import("../pages/CombatRecordsPage.vue"),
    title: "战斗记录",
    category: "core",
    refreshPolicy: "polling",
    nav: { section: "combat", label: "战斗记录", icon: "⚔️", order: 10 },
    requiredPermission: "combat_manager.view",
    legacyRequiredPermissions: ["kill_manager.view"],
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
    name: "squadbrowser-player-lookup",
    path: "/squadbrowser-player-lookup",
    component: () => import("../pages/SquadBrowserPlayerLookupPage.vue"),
    title: "查成分",
    category: "core",
    refreshPolicy: "manual",
    nav: { section: "players", label: "查成分", icon: "🔍", order: 15 },
    ...documentPage,
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
    name: "nzcd",
    path: "/plugins/nzcd",
    component: () => import("../pages/NzcdPage.vue"),
    title: "NZCD 娱乐插件",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "entertainment", label: "NZCD 娱乐插件", icon: "📏", order: 10 },
    requiredPermission: "nzcd.manage",
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
    requiredPermission: "warmup_reserve_grant.manage",
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
    title: "抱团报备",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "players", label: "抱团报备", icon: "🚩", order: 60 },
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
    name: "network-block",
    path: "/plugins/network-block",
    component: () => import("../pages/NetworkBlockPage.vue"),
    title: "网络阻塞",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "players", label: "网络阻塞", icon: "🌐", order: 91 },
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
    name: "squad-restriction-enforcement-debug",
    path: "/debug/squad-restriction-enforcement",
    component: () => import("../pages/SquadRestrictionEnforcementDebugPage.vue"),
    title: "小队锁队处罚调试",
    category: "debug",
    refreshPolicy: "polling",
    nav: { section: "players", label: "锁队处罚调试", icon: "🧭", order: 55 },
    requiredPermission: "debug.tools",
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
    name: "bzss-core-vehicles",
    path: "/bzss-core-vehicles",
    component: () => import("../pages/BzssCoreVehiclesPage.vue"),
    title: "BZSS-Core 载具信息",
    category: "core",
    refreshPolicy: "polling",
    nav: { section: "opsLive", label: "BZSS-Core 载具", icon: "🚙", order: 27 },
    requiredPermission: "bzss_core.use",
    ...workspacePage,
  },
  {
    name: "step-counter",
    path: "/debug/step-counter",
    component: () => import("../pages/StepCounterPage.vue"),
    title: "步数统计",
    category: "debug",
    refreshPolicy: "polling",
    nav: { section: "analytics", label: "步数统计", icon: "👣", order: 25 },
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
    name: "match-end-snapshots",
    path: "/match-end-snapshots",
    component: () => import("../pages/MatchEndSnapshotsPage.vue"),
    title: "对局结束快照",
    category: "core",
    refreshPolicy: "manual",
    nav: { section: "analytics", label: "对局结束快照", icon: "📚", order: 21 },
    requiredPermission: "match_end_snapshots.manage",
    ...workspacePage,
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
    name: "victim-damage-display-debug",
    path: "/debug/victim-damage-display",
    component: () => import("../pages/VictimDamageDisplayDebugPage.vue"),
    title: "被命中伤害调试",
    category: "debug",
    refreshPolicy: "polling",
    nav: { section: "combat", label: "伤害显示调试", icon: "🩸", order: 80 },
    requiredPermission: "debug.tools",
    ...documentPage,
  },
  {
    name: "squad-leader-impeachment",
    path: "/plugins/squad-leader-impeachment",
    aliases: ["/squad-leader-impeachment", "/pages/squad-leader-impeachment"],
    component: () => import("../pages/SquadLeaderImpeachmentPage.vue"),
    title: "弹劾队长",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "players", label: "弹劾队长", icon: "⚖️", order: 84 },
    requiredPermission: "squad_leader_impeachment.manage",
    ...documentPage,
  },
  {
    name: "death-quote-warning",
    path: "/plugins/death-quote-warning",
    component: () => import("../pages/DeathQuoteWarningPage.vue"),
    title: "死亡名言警告",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "broadcast", label: "死亡名言警告", icon: "💬", order: 41 },
    requiredPermission: "death_quote_warning.manage",
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
    requiredPermission: "debug.tools",
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
