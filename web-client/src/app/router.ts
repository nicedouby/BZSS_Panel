import { createRouter, createWebHistory } from "vue-router";

import MatchStatusPage from "../pages/MatchStatusPage.vue";
import ConsolePage from "../pages/ConsolePage.vue";
import PlayerDatabasePage from "../pages/PlayerDatabasePage.vue";
import CombatManagerPage from "../pages/CombatManagerPage.vue";
import AdminWarnsPage from "../pages/AdminWarnsPage.vue";
import ScheduledBroadcastPage from "../pages/ScheduledBroadcastPage.vue";
import InfantryCombatEnhancerPage from "../pages/InfantryCombatEnhancerPage.vue";
import GroupReportPage from "../pages/GroupReportPage.vue";
import SquadManagementPage from "../pages/SquadManagementPage.vue";
import UdpEventForwarderPage from "../pages/UdpEventForwarderPage.vue";
import ServerInfoStatisticsPage from "../pages/ServerInfoStatisticsPage.vue";
import MatchSnapshotDebugPage from "../pages/MatchSnapshotDebugPage.vue";
import PjscAverageDurationPage from "../pages/PjscAverageDurationPage.vue";
import DrawVoteGuardDebugPage from "../pages/DrawVoteGuardDebugPage.vue";
import SquadNameClassifierDebugPage from "../pages/SquadNameClassifierDebugPage.vue";
import WelcomeJoinWarningDebugPage from "../pages/WelcomeJoinWarningDebugPage.vue";
import PlayerSessionRecordsPage from "../pages/PlayerSessionRecordsPage.vue";
import ComingSoonPage from "../pages/ComingSoonPage.vue";
import ChatMonitorPage from "../pages/ChatMonitorPage.vue";
import RuntimeStatusPage from "../pages/RuntimeStatusPage.vue";
import { useAuthStore } from "../stores/auth.store";

const coreRealtimeMeta = { category: "core", refreshPolicy: "realtime" } as const;
const coreManualMeta = { category: "core", refreshPolicy: "manual" } as const;
const corePollingMeta = { category: "core", refreshPolicy: "polling" } as const;
const pluginPollingMeta = { category: "plugin", refreshPolicy: "polling" } as const;
const systemPollingMeta = { category: "system", refreshPolicy: "polling" } as const;
const debugManualMeta = { category: "debug", refreshPolicy: "manual" } as const;

export const router = createRouter({
  history: createWebHistory(),
  routes: [
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
      path: "/console",
      component: ConsolePage,
      meta: {
        ...coreRealtimeMeta,
        titleKey: "routeTitle.console",
        fullBleed: true,
      },
    },
    {
      path: "/chat-monitor",
      component: ChatMonitorPage,
      meta: {
        ...coreRealtimeMeta,
        title: "聊天监控",
        fullBleed: true,
      },
    },
    {
      path: "/player-session-records",
      component: PlayerSessionRecordsPage,
      meta: {
        ...corePollingMeta,
        title: "进退服记录",
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
      },
    },
    {
      path: "/kill-manage",
      redirect: (to) => ({ path: "/combat-manager", query: to.query, hash: to.hash }),
    },
    {
      path: "/combat-clean",
      redirect: (to) => ({ path: "/combat-manager", query: to.query, hash: to.hash }),
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
        title: "定时广播",
      },
    },
    {
      path: "/plugins/infantry-combat-enhancer",
      component: InfantryCombatEnhancerPage,
      meta: {
        ...pluginPollingMeta,
        titleKey: "routeTitle.infantryCombatEnhancer",
      },
    },
    {
      path: "/plugins/group-report",
      component: GroupReportPage,
      meta: {
        ...pluginPollingMeta,
        title: "抱团报备",
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
        title: "UDP 转发日志",
      },
    },
    {
      path: "/plugins/server-info-statistics",
      component: ServerInfoStatisticsPage,
      meta: {
        ...pluginPollingMeta,
        title: "服务器信息统计",
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
        title: "PJSC 平均时长",
        fullBleed: true,
      },
    },
    {
      path: "/debug/draw-vote-guard",
      component: DrawVoteGuardDebugPage,
      meta: {
        ...debugManualMeta,
        title: "平局投票阶段提示",
        fullBleed: true,
      },
    },
    {
      path: "/debug/welcome-join-warning",
      component: WelcomeJoinWarningDebugPage,
      meta: {
        ...debugManualMeta,
        title: "入服欢迎警告",
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
      path: "/:pathMatch(.*)*",
      component: ComingSoonPage,
      props: {
        titleKey: "routeTitle.comingSoon",
        subtitle: "",
        message: "",
      },
      meta: { titleKey: "routeTitle.comingSoon" },
    },
  ],
});

router.beforeEach((to) => {
  const requiredPermission = String(to.meta?.requiredPermission ?? "").trim();
  if (!requiredPermission) return true;

  const auth = useAuthStore();
  const permissions = Array.isArray(auth.user?.permissions) ? auth.user.permissions : [];
  const legacyPermissions = Array.isArray(to.meta?.legacyRequiredPermissions) ? to.meta.legacyRequiredPermissions : [];
  const allowed = auth.user?.isSuperAdmin
    || permissions.includes("*")
    || permissions.includes(requiredPermission)
    || legacyPermissions.some((permission) => permissions.includes(permission));

  if (allowed) {
    if (!permissions.includes(requiredPermission) && legacyPermissions.some((permission) => permissions.includes(permission))) {
      console.warn(`[router] Deprecated permission fallback used for ${String(to.fullPath ?? to.path)}: ${legacyPermissions.join(", ")}`);
    }
    return true;
  }

  return { path: "/match-status" };
});
