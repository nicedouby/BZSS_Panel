import type { Component } from "vue";
import type { RouteRecordRaw } from "vue-router";

import MatchStatusPage from "../pages/MatchStatusPage.vue";
import ConsolePage from "../pages/ConsolePage.vue";
import PlayerDatabasePage from "../pages/PlayerDatabasePage.vue";
import ReserveSlotsPage from "../pages/ReserveSlotsPage.vue";
import BlackEdgePrivilegePage from "../pages/BlackEdgePrivilegePage.vue";
import CombatManagerPage from "../pages/CombatManagerPage.vue";
import BattleLogPage from "../pages/BattleLogPage.vue";
import AdminWarnsPage from "../pages/AdminWarnsPage.vue";
import ScheduledBroadcastPage from "../pages/ScheduledBroadcastPage.vue";
import InfantryCombatEnhancerPage from "../pages/InfantryCombatEnhancerPage.vue";
import GroupReportPage from "../pages/GroupReportPage.vue";
import FairTeamBalancePage from "../pages/FairTeamBalancePage.vue";
import FairTeamBalanceLabPage from "../pages/FairTeamBalanceLabPage.vue";
import FairSquadGuardPage from "../pages/FairSquadGuardPage.vue";
import StepwiseSquadPlaytimeGuardPage from "../pages/StepwiseSquadPlaytimeGuardPage.vue";
import LianbanKickPage from "../pages/LianbanKickPage.vue";
import SquadManagementPage from "../pages/SquadManagementPage.vue";
import TeamBalancePage from "../pages/TeamBalancePage.vue";
import TeamShufflePage from "../pages/TeamShufflePage.vue";
import UdpEventForwarderPage from "../pages/UdpEventForwarderPage.vue";
import ServerInfoStatisticsPage from "../pages/ServerInfoStatisticsPage.vue";
import MatchSnapshotDebugPage from "../pages/MatchSnapshotDebugPage.vue";
import PjscAverageDurationPage from "../pages/PjscAverageDurationPage.vue";
import DrawVoteGuardDebugPage from "../pages/DrawVoteGuardDebugPage.vue";
import SquadNameClassifierDebugPage from "../pages/SquadNameClassifierDebugPage.vue";
import SquadNamePolicyPage from "../pages/SquadNamePolicyPage.vue";
import SquadNameRulesPage from "../pages/SquadNameRulesPage.vue";
import WelcomeJoinWarningDebugPage from "../pages/WelcomeJoinWarningDebugPage.vue";
import PlayerSessionRecordsPage from "../pages/PlayerSessionRecordsPage.vue";
import CombatLogPage from "../pages/CombatLogPage.vue";
import ChatMonitorPage from "../pages/ChatMonitorPage.vue";
import RuntimeStatusPage from "../pages/RuntimeStatusPage.vue";
import AdminUsersPage from "../pages/AdminUsersPage.vue";
import AuditRecordsPage from "../pages/AuditRecordsPage.vue";
import PluginSubscriptionsPage from "../pages/PluginSubscriptionsPage.vue";
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
  component: Component;
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
    component: MatchStatusPage,
    titleKey: "routeTitle.matchStatus",
    category: "core",
    refreshPolicy: "realtime",
    nav: { section: "opsLive", label: "对局状态", icon: "📹", order: 10 },
    ...workspacePage,
  },
  {
    name: "console",
    path: "/console",
    component: ConsolePage,
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
    component: ChatMonitorPage,
    title: "聊天监控",
    category: "core",
    refreshPolicy: "realtime",
    nav: { section: "opsLive", label: "聊天监控", icon: "💬", order: 20 },
    ...workspacePage,
  },
  {
    name: "player-session-records",
    path: "/player-session-records",
    component: PlayerSessionRecordsPage,
    title: "进出服记录",
    category: "core",
    refreshPolicy: "polling",
    nav: { section: "players", label: "进出服记录", icon: "🕛", order: 40 },
    ...workspacePage,
  },
  {
    name: "player-database",
    path: "/player-database",
    component: PlayerDatabasePage,
    titleKey: "routeTitle.playerDatabase",
    category: "core",
    refreshPolicy: "manual",
    nav: { section: "players", label: "玩家数据库", icon: "🗄️", order: 10 },
    ...workspacePage,
  },
  {
    name: "reserve-slots",
    path: "/reserve-slots",
    component: ReserveSlotsPage,
    titleKey: "routeTitle.reserveSlots",
    category: "core",
    refreshPolicy: "manual",
    nav: { section: "players", label: "预留位管理", icon: "🎫", order: 20 },
    ...workspacePage,
  },
  {
    name: "black-edge-privilege",
    path: "/black-edge-privilege",
    component: BlackEdgePrivilegePage,
    title: "黑奴跳边 CDK",
    category: "core",
    refreshPolicy: "manual",
    nav: { section: "players", label: "黑奴跳边 CDK", icon: "🔑", order: 30 },
    ...workspacePage,
  },
  {
    name: "combat-manager",
    path: "/combat-manager",
    component: CombatManagerPage,
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
    component: CombatLogPage,
    titleKey: "routeTitle.combatLog",
    category: "core",
    refreshPolicy: "polling",
    nav: { section: "combat", label: "战斗日志", icon: "📝", order: 30 },
    ...workspacePage,
  },
  {
    name: "battle-log",
    path: "/battle-log",
    component: BattleLogPage,
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
    component: AdminWarnsPage,
    titleKey: "routeTitle.adminWarns",
    category: "core",
    refreshPolicy: "polling",
    nav: { section: "broadcast", label: "广播模块", icon: "🚨", order: 10 },
    ...workspacePage,
  },
  {
    name: "scheduled-broadcasts",
    path: "/scheduled-broadcasts",
    component: ScheduledBroadcastPage,
    title: "定时广播",
    category: "core",
    refreshPolicy: "polling",
    nav: { section: "broadcast", label: "定时广播", icon: "⏰", order: 20 },
    ...workspacePage,
  },
  {
    name: "infantry-combat-enhancer",
    path: "/plugins/infantry-combat-enhancer",
    component: InfantryCombatEnhancerPage,
    titleKey: "routeTitle.infantryCombatEnhancer",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "combat", label: "步兵战斗增强", icon: "💂", order: 40 },
    ...workspacePage,
  },
  {
    name: "group-report",
    path: "/plugins/group-report",
    component: GroupReportPage,
    title: "组队举报",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "players", label: "组队举报", icon: "🚩", order: 60 },
    ...workspacePage,
  },
  {
    name: "fair-team-balance",
    path: "/plugins/fair-team-balance",
    component: FairTeamBalancePage,
    title: "公平跳边",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "balance", label: "公平跳边", icon: "🔀", order: 20 },
    ...workspacePage,
  },
  {
    name: "fair-squad-guard",
    path: "/plugins/fair-squad-guard",
    component: FairSquadGuardPage,
    titleKey: "routeTitle.fairSquadGuard",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "players", label: "公平建队", icon: "🛡️", order: 70 },
    ...workspacePage,
  },
  {
    name: "stepwise-squad-playtime-guard",
    path: "/plugins/stepwise-squad-playtime-guard",
    component: StepwiseSquadPlaytimeGuardPage,
    title: "阶梯式建队时长",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "players", label: "阶梯式建队时长", icon: "⏳", order: 80 },
    ...workspacePage,
  },
  {
    name: "lianban-kick",
    path: "/plugins/lianban-kick",
    component: LianbanKickPage,
    title: "联办踢出",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "players", label: "联办踢出", icon: "🚫", order: 90 },
    ...workspacePage,
  },
  {
    name: "squad-management",
    path: "/squad-management",
    component: SquadManagementPage,
    titleKey: "routeTitle.squadManagement",
    category: "core",
    refreshPolicy: "polling",
    nav: { section: "players", label: "小队管理", icon: "💻", order: 50 },
    ...workspacePage,
  },
  {
    name: "team-balance",
    path: "/tb",
    component: TeamBalancePage,
    titleKey: "routeTitle.teamBalance",
    category: "core",
    refreshPolicy: "manual",
    nav: { section: "balance", label: "跳边入口", icon: "🔁", order: 10 },
    ...workspacePage,
  },
  {
    name: "team-shuffle",
    path: "/team-shuffle",
    component: TeamShufflePage,
    title: "随机打乱",
    category: "core",
    refreshPolicy: "manual",
    nav: { section: "balance", label: "随机打乱", icon: "SHUF", order: 15 },
    ...workspacePage,
  },
  {
    name: "plugin-subscriptions",
    path: "/plugin-subscriptions",
    component: PluginSubscriptionsPage,
    titleKey: "routeTitle.pluginSubscriptions",
    category: "system",
    refreshPolicy: "polling",
    nav: { section: "system", label: "插件订阅", icon: "🔌", order: 50 },
    ...workspacePage,
  },
  {
    name: "udp-forwarder",
    path: "/debug/udp-forwarder",
    component: UdpEventForwarderPage,
    title: "UDP 转发日志",
    category: "debug",
    refreshPolicy: "manual",
    nav: { section: "system", label: "UDP 转发日志", icon: "📡", order: 60 },
    ...documentPage,
  },
  {
    name: "server-info-statistics",
    path: "/plugins/server-info-statistics",
    component: ServerInfoStatisticsPage,
    title: "服务器统计",
    category: "plugin",
    refreshPolicy: "polling",
    nav: { section: "analytics", label: "服务器统计", icon: "📈", order: 10 },
    ...workspacePage,
  },
  {
    name: "match-snapshots",
    path: "/debug/match-snapshots",
    component: MatchSnapshotDebugPage,
    title: "快照录制",
    category: "debug",
    refreshPolicy: "manual",
    nav: { section: "analytics", label: "快照录制", icon: "📸", order: 20 },
    ...documentPage,
  },
  {
    name: "pjsc-average-duration",
    path: "/debug/pjsc-average-duration",
    component: PjscAverageDurationPage,
    title: "PJSC 平均时长",
    category: "debug",
    refreshPolicy: "manual",
    nav: { section: "analytics", label: "PJSC 平均时长", icon: "⏱️", order: 30 },
    ...documentPage,
  },
  {
    name: "draw-vote-guard",
    path: "/debug/draw-vote-guard",
    component: DrawVoteGuardDebugPage,
    title: "平局投票提示",
    category: "debug",
    refreshPolicy: "manual",
    nav: { section: "broadcast", label: "平局投票提示", icon: "⚖️", order: 30 },
    ...documentPage,
  },
  {
    name: "fair-team-balance-lab",
    path: "/debug/fair-team-balance-lab",
    component: FairTeamBalanceLabPage,
    title: "公平跳边实验室",
    category: "debug",
    refreshPolicy: "manual",
    nav: { section: "balance", label: "公平跳边模拟", icon: "🧪", order: 30 },
    ...workspacePage,
  },
  {
    name: "welcome-join-warning",
    path: "/debug/welcome-join-warning",
    component: WelcomeJoinWarningDebugPage,
    title: "进服警告",
    category: "debug",
    refreshPolicy: "manual",
    nav: { section: "broadcast", label: "进服警告", icon: "WARN", order: 40 },
    ...documentPage,
  },
  {
    name: "squad-name-classifier",
    path: "/debug/squad-name-classifier",
    component: SquadNameClassifierDebugPage,
    title: "小队名称分类器",
    category: "debug",
    refreshPolicy: "manual",
    nav: { section: "players", label: "小队名称分类器", icon: "🏷️", order: 100 },
    ...documentPage,
  },
  {
    name: "squad-name-policy",
    path: "/debug/squad-name-policy",
    component: SquadNamePolicyPage,
    title: "队名规范",
    category: "debug",
    refreshPolicy: "manual",
    nav: { section: "players", label: "队名规范", icon: "NAME", order: 95 },
    ...workspacePage,
  },
  {
    name: "squad-name-rules",
    path: "/debug/squad-name-policy/rules",
    component: SquadNameRulesPage,
    title: "队名规范规则维护",
    category: "debug",
    refreshPolicy: "manual",
    ...workspacePage,
  },
  {
    name: "runtime-status",
    path: "/system/status",
    component: RuntimeStatusPage,
    titleKey: "routeTitle.runtimeStatus",
    category: "system",
    refreshPolicy: "polling",
    nav: { section: "system", label: "运行状态", icon: "📶", order: 10 },
    ...documentPage,
  },
  {
    name: "admin-users",
    path: "/system/admin-users",
    component: AdminUsersPage,
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
    component: AuditRecordsPage,
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
