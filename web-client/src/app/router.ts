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

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/match-status" },
    {
      path: "/match-status",
      component: MatchStatusPage,
      meta: {
        titleKey: "routeTitle.matchStatus",
        fullBleed: true,
      },
    },
    { path: "/console", component: ConsolePage, meta: { titleKey: "routeTitle.console", fullBleed: true } },
    { path: "/chat-monitor", component: ChatMonitorPage, meta: { title: "聊天监控", fullBleed: true } },
    { path: "/player-database", component: PlayerDatabasePage, meta: { titleKey: "routeTitle.playerDatabase" } },
    { path: "/combat-clean", component: CombatCleanPage, meta: { titleKey: "routeTitle.combatClean" } },
    { path: "/kill-manage", component: KillManagePage, meta: { titleKey: "routeTitle.killManage" } },
    { path: "/admin-warns", component: AdminWarnsPage, meta: { titleKey: "routeTitle.adminWarns" } },
    { path: "/plugins/infantry-combat-enhancer", component: InfantryCombatEnhancerPage, meta: { titleKey: "routeTitle.infantryCombatEnhancer" } },
    { path: "/plugins/group-report", component: GroupReportPage, meta: { title: "抱团报备", fullBleed: true } },
    { path: "/squad-management", component: SquadManagementPage, meta: { titleKey: "routeTitle.squadManagement", fullBleed: true } },
    { path: "/plugin-subscriptions", component: () => import("../pages/PluginSubscriptionsPage.vue"), meta: { titleKey: "routeTitle.pluginSubscriptions", fullBleed: true } },
    {
      path: "/debug/udp-forwarder",
      component: UdpEventForwarderPage,
      meta: { title: "UDP 转发日志" },
    },
    {
      path: "/plugins/server-info-statistics",
      component: ServerInfoStatisticsPage,
      meta: { title: "服务器信息统计", fullBleed: true },
    },
    {
      path: "/debug/match-snapshots",
      component: MatchSnapshotDebugPage,
      meta: { title: "快照录制", fullBleed: true },
    },
    {
      path: "/debug/squad-name-classifier",
      component: SquadNameClassifierDebugPage,
      meta: { title: "小队名称分类器", fullBleed: true },
    },
    {
      path: "/system/status",
      component: RuntimeStatusPage,
      meta: { titleKey: "routeTitle.runtimeStatus", fullBleed: true },
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
