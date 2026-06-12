import { createRouter, createWebHistory } from "vue-router";

import MatchStatusPage from "../pages/MatchStatusPage.vue";
import ConsolePage from "../pages/ConsolePage.vue";
import PlayerDatabasePage from "../pages/PlayerDatabasePage.vue";
import CombatManagerPage from "../pages/CombatManagerPage.vue";
import BattleLogPage from "../pages/BattleLogPage.vue";
import AdminWarnsPage from "../pages/AdminWarnsPage.vue";
import ScheduledBroadcastPage from "../pages/ScheduledBroadcastPage.vue";
import InfantryCombatEnhancerPage from "../pages/InfantryCombatEnhancerPage.vue";
import GroupReportPage from "../pages/GroupReportPage.vue";
import FairTeamBalancePage from "../pages/FairTeamBalancePage.vue";
import FairSquadGuardPage from "../pages/FairSquadGuardPage.vue";
import StepwiseSquadPlaytimeGuardPage from "../pages/StepwiseSquadPlaytimeGuardPage.vue";
import LianbanKickPage from "../pages/LianbanKickPage.vue";
import SquadManagementPage from "../pages/SquadManagementPage.vue";
import TeamBalancePage from "../pages/TeamBalancePage.vue";
import UdpEventForwarderPage from "../pages/UdpEventForwarderPage.vue";
import ServerInfoStatisticsPage from "../pages/ServerInfoStatisticsPage.vue";
import MatchSnapshotDebugPage from "../pages/MatchSnapshotDebugPage.vue";
import PjscAverageDurationPage from "../pages/PjscAverageDurationPage.vue";
import DrawVoteGuardDebugPage from "../pages/DrawVoteGuardDebugPage.vue";
import SquadNameClassifierDebugPage from "../pages/SquadNameClassifierDebugPage.vue";
import WelcomeJoinWarningDebugPage from "../pages/WelcomeJoinWarningDebugPage.vue";
import PlayerSessionRecordsPage from "../pages/PlayerSessionRecordsPage.vue";
import CombatLogPage from "../pages/CombatLogPage.vue";
import ComingSoonPage from "../pages/ComingSoonPage.vue";
import ChatMonitorPage from "../pages/ChatMonitorPage.vue";
import RuntimeStatusPage from "../pages/RuntimeStatusPage.vue";
import AdminUsersPage from "../pages/AdminUsersPage.vue";
import { useAuthStore } from "../stores/auth.store";
import {
  canAccessPage,
  normalizePermissionList,
  resolveWebPagePermission,
} from "../shared/web-page-permissions.js";

const coreRealtimeMeta = { category: "core", refreshPolicy: "realtime" } as const;
const coreManualMeta = { category: "core", refreshPolicy: "manual" } as const;
const corePollingMeta = { category: "core", refreshPolicy: "polling" } as const;
const pluginPollingMeta = { category: "plugin", refreshPolicy: "polling" } as const;
const systemPollingMeta = { category: "system", refreshPolicy: "polling" } as const;
const debugManualMeta = { category: "debug", refreshPolicy: "manual" } as const;

function applyPagePermissions(routes: any[]) {
  return routes.map((route) => {
    if (!route || typeof route !== "object") return route;
    const resolved = resolveWebPagePermission(route.path);
    if (!resolved) return route;

    const meta = route.meta ?? {};
    const requiredPermission = String(meta.requiredPermission ?? resolved.requiredPermission ?? "").trim();
    const legacyRequiredPermissions = mergePermissionLists(
      meta.legacyRequiredPermissions,
      resolved.legacyRequiredPermissions,
    );
    const superAdminOnly = Boolean(meta.superAdminOnly ?? resolved.superAdminOnly);

    return {
      ...route,
      meta: {
        ...meta,
        requiredPermission,
        legacyRequiredPermissions,
        superAdminOnly,
      },
    };
  });
}

function mergePermissionLists(...values: any[]) {
  const merged: string[] = [];
  for (const value of values) {
    for (const permission of normalizePermissionList(value)) {
      if (merged.includes(permission)) continue;
      merged.push(permission);
    }
  }
  return merged;
}

export const router = createRouter({
  history: createWebHistory(),
  routes: applyPagePermissions([
    { path: "/", redirect: "/match-status" },
    {
      path: "/match-status",
      component: MatchStatusPage,
      meta: {
        ...coreRealtimeMeta,
        titleKey: "routeTitle.matchStatus",
        fullBleed: true,
      },
    },
    {
      path: "/match-state",
      component: MatchStatusPage,
      meta: {
        ...coreRealtimeMeta,
        titleKey: "routeTitle.matchStatus",
        fullBleed: true,
      },
    },
    {
      path: "/console",
      component: ConsolePage,
      meta: {
        ...coreRealtimeMeta,
        titleKey: "routeTitle.console",
        fullBleed: true,
        superAdminOnly: true,
      },
    },
    {
      path: "/chat-monitor",
      component: ChatMonitorPage,
      meta: {
        ...coreRealtimeMeta,
        title: "鑱婂ぉ鐩戞帶",
        fullBleed: true,
      },
    },
    {
      path: "/player-session-records",
      component: PlayerSessionRecordsPage,
      meta: {
        ...corePollingMeta,
        title: "进出服记录",
        fullBleed: true,
      },
    },
    {
      path: "/player-database",
      component: PlayerDatabasePage,
      meta: {
        ...coreManualMeta,
        titleKey: "routeTitle.playerDatabase",
      },
    },
    {
      path: "/combat-manager",
      component: CombatManagerPage,
      meta: {
        ...corePollingMeta,
        titleKey: "routeTitle.combatManager",
        requiredPermission: "combat_manager.view",
        legacyRequiredPermissions: ["kill_manager.view"],
        fullBleed: true,
      },
    },
    {
      path: "/combat-clean",
      redirect: (to: any) => ({ path: "/combat-manager", query: to.query, hash: to.hash }),
    },
    {
      path: "/combat-log",
      component: CombatLogPage,
      meta: {
        ...corePollingMeta,
        titleKey: "routeTitle.combatLog",
        fullBleed: true,
      },
    },
    {
      path: "/battle-log",
      component: BattleLogPage,
      meta: {
        ...corePollingMeta,
        titleKey: "routeTitle.battleLog",
        requiredPermission: "combat_manager.view",
        legacyRequiredPermissions: ["kill_manager.view"],
        fullBleed: true,
      },
    },
    {
      path: "/admin-warns",
      component: AdminWarnsPage,
      meta: {
        ...corePollingMeta,
        titleKey: "routeTitle.adminWarns",
      },
    },
    {
      path: "/scheduled-broadcasts",
      component: ScheduledBroadcastPage,
      meta: {
        ...corePollingMeta,
        title: "瀹氭椂骞挎挱",
      },
    },
    {
      path: "/plugins/infantry-combat-enhancer",
      component: InfantryCombatEnhancerPage,
      meta: {
        ...pluginPollingMeta,
        titleKey: "routeTitle.infantryCombatEnhancer",
        fullBleed: true,
      },
    },
    {
      path: "/plugins/group-report",
      component: GroupReportPage,
      meta: {
        ...pluginPollingMeta,
        title: "鎶卞洟鎶ュ",
        fullBleed: true,
      },
    },
    {
      path: "/plugins/fair-team-balance",
      component: FairTeamBalancePage,
      meta: {
        ...pluginPollingMeta,
        title: "公平跳边",
        fullBleed: true,
      },
    },
    {
      path: "/plugins/fair-squad-guard",
      component: FairSquadGuardPage,
      meta: {
        ...pluginPollingMeta,
        titleKey: "routeTitle.fairSquadGuard",
        fullBleed: true,
      },
    },
    {
      path: "/plugins/stepwise-squad-playtime-guard",
      component: StepwiseSquadPlaytimeGuardPage,
      meta: {
        ...pluginPollingMeta,
        title: "阶梯式建队时长",
        fullBleed: true,
      },
    },
    {
      path: "/plugins/lianban-kick",
      component: LianbanKickPage,
      meta: {
        ...pluginPollingMeta,
        title: "联办踢出",
        fullBleed: true,
      },
    },
    {
      path: "/squad-management",
      component: SquadManagementPage,
      meta: {
        ...corePollingMeta,
        titleKey: "routeTitle.squadManagement",
        fullBleed: true,
      },
    },
    {
      path: "/tb",
      component: TeamBalancePage,
      meta: {
        ...coreManualMeta,
        titleKey: "routeTitle.teamBalance",
        fullBleed: true,
      },
    },
    {
      path: "/plugin-subscriptions",
      component: () => import("../pages/PluginSubscriptionsPage.vue"),
      meta: {
        ...systemPollingMeta,
        titleKey: "routeTitle.pluginSubscriptions",
        fullBleed: true,
      },
    },
    {
      path: "/debug/udp-forwarder",
      component: UdpEventForwarderPage,
      meta: {
        ...debugManualMeta,
        title: "UDP 杞彂鏃ュ織",
      },
    },
    {
      path: "/plugins/server-info-statistics",
      component: ServerInfoStatisticsPage,
      meta: {
        ...pluginPollingMeta,
        title: "服务器统计",
        fullBleed: true,
      },
    },
    {
      path: "/debug/match-snapshots",
      component: MatchSnapshotDebugPage,
      meta: {
        ...debugManualMeta,
        title: "快照录制",
        fullBleed: true,
      },
    },
    {
      path: "/debug/pjsc-average-duration",
      component: PjscAverageDurationPage,
      meta: {
        ...debugManualMeta,
        title: "PJSC 骞冲潎鏃堕暱",
        fullBleed: true,
      },
    },
    {
      path: "/debug/draw-vote-guard",
      component: DrawVoteGuardDebugPage,
      meta: {
        ...debugManualMeta,
        title: "骞冲眬鎶曠エ闃舵鎻愮ず",
        fullBleed: true,
      },
    },
    {
      path: "/debug/welcome-join-warning",
      component: WelcomeJoinWarningDebugPage,
      meta: {
        ...debugManualMeta,
        title: "鍏ユ湇娆㈣繋璀﹀憡",
        fullBleed: true,
      },
    },
    {
      path: "/debug/squad-name-classifier",
      component: SquadNameClassifierDebugPage,
      meta: {
        ...debugManualMeta,
        title: "小队名称分类器",
        fullBleed: true,
      },
    },
    {
      path: "/system/status",
      component: RuntimeStatusPage,
      meta: {
        ...systemPollingMeta,
        titleKey: "routeTitle.runtimeStatus",
        fullBleed: true,
      },
    },
    {
      path: "/system/admin-users",
      component: AdminUsersPage,
      meta: {
        ...systemPollingMeta,
        title: "管理员账号",
        superAdminOnly: true,
        fullBleed: true,
      },
    },
    {
      path: "/access-denied",
      component: ComingSoonPage,
      props: {
        title: "Access denied",
        subtitle: "鏉冮檺涓嶈冻",
        message: "当前登录账号没有访问该页面所需的模块权限，请联系管理员分配对应权限后再试。",
      },
      meta: { title: "Access denied" },
    },
    {
      path: "/:pathMatch(.*)*",
      component: ComingSoonPage,
      props: {
        titleKey: "routeTitle.comingSoon",
        subtitle: "",
        message: "",
      },
      meta: { titleKey: "routeTitle.comingSoon" },
    },
  ]),
});

router.beforeEach((to: any) => {
  const auth = useAuthStore();
  if (!auth.checked) return true;

  if (to.meta?.superAdminOnly) {
    if (!auth.authenticated) return true;
    return auth.user?.isSuperAdmin ? true : { path: "/access-denied" };
  }

  const requiredPermission = String(to.meta?.requiredPermission ?? "").trim();
  if (!requiredPermission) return true;

  const authUser = auth.user as { permissions?: unknown; permission?: unknown; isSuperAdmin?: boolean } | null | undefined;
  const permissions = normalizePermissionList(authUser?.permissions ?? authUser?.permission);
  const legacyPermissions = normalizePermissionList(to.meta?.legacyRequiredPermissions);
  const allowed = canAccessPage(authUser, requiredPermission, legacyPermissions, {
    superAdminOnly: Boolean(to.meta?.superAdminOnly),
  });

  if (allowed) {
    if (!permissions.includes(requiredPermission) && legacyPermissions.some((permission) => permissions.includes(permission))) {
      console.warn(`[router] Deprecated permission fallback used for ${String(to.fullPath ?? to.path)}: ${legacyPermissions.join(", ")}`);
    }
    return true;
  }

  return { path: "/access-denied" };
});
