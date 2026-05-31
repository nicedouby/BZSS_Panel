import { createRouter, createWebHistory } from "vue-router";

import MatchStatusPage from "../pages/MatchStatusPage.vue";
import ConsolePage from "../pages/ConsolePage.vue";
import PlayerDatabasePage from "../pages/PlayerDatabasePage.vue";
import CombatCleanPage from "../pages/CombatCleanPage.vue";
import KillManagePage from "../pages/KillManagePage.vue";
import AdminWarnsPage from "../pages/AdminWarnsPage.vue";
import InfantryCombatEnhancerPage from "../pages/InfantryCombatEnhancerPage.vue";
import GroupReportPage from "../pages/GroupReportPage.vue";
import SquadManagementPage from "../pages/SquadManagementPage.vue";
import UdpEventForwarderPage from "../pages/UdpEventForwarderPage.vue";
import ServerInfoStatisticsPage from "../pages/ServerInfoStatisticsPage.vue";
import MatchSnapshotDebugPage from "../pages/MatchSnapshotDebugPage.vue";
import SquadNameClassifierDebugPage from "../pages/SquadNameClassifierDebugPage.vue";
import ComingSoonPage from "../pages/ComingSoonPage.vue";
import ChatMonitorPage from "../pages/ChatMonitorPage.vue";
import RuntimeStatusPage from "../pages/RuntimeStatusPage.vue";

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
      path: "/player-database",
      component: PlayerDatabasePage,
      meta: {
        ...coreManualMeta,
        titleKey: "routeTitle.playerDatabase",
      },
    },
    {
      path: "/combat-clean",
      component: CombatCleanPage,
      meta: {
        ...corePollingMeta,
        titleKey: "routeTitle.combatClean",
      },
    },
    {
      path: "/kill-manage",
      component: KillManagePage,
      meta: {
        ...corePollingMeta,
        titleKey: "routeTitle.killManage",
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
