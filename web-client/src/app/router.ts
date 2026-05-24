import { createRouter, createWebHistory } from "vue-router";

import MatchStatusPage from "../pages/MatchStatusPage.vue";
import ConsolePage from "../pages/ConsolePage.vue";
import PlayerDatabasePage from "../pages/PlayerDatabasePage.vue";
import CombatCleanPage from "../pages/CombatCleanPage.vue";
import KillManagePage from "../pages/KillManagePage.vue";
import AdminWarnsPage from "../pages/AdminWarnsPage.vue";
import GroupReportPage from "../pages/GroupReportPage.vue";
import SquadManagementPage from "../pages/SquadManagementPage.vue";
import UdpEventForwarderPage from "../pages/UdpEventForwarderPage.vue";
import ServerInfoStatisticsPage from "../pages/ServerInfoStatisticsPage.vue";
import FairSquadBuildingPage from "../pages/FairSquadBuildingPage.vue";
import MatchSnapshotDebugPage from "../pages/MatchSnapshotDebugPage.vue";
import ComingSoonPage from "../pages/ComingSoonPage.vue";

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
    { path: "/console", component: ConsolePage, meta: { titleKey: "routeTitle.console" } },
    { path: "/player-database", component: PlayerDatabasePage, meta: { titleKey: "routeTitle.playerDatabase" } },
    { path: "/combat-clean", component: CombatCleanPage, meta: { titleKey: "routeTitle.combatClean" } },
    { path: "/kill-manage", component: KillManagePage, meta: { titleKey: "routeTitle.killManage" } },
    { path: "/admin-warns", component: AdminWarnsPage, meta: { titleKey: "routeTitle.adminWarns" } },
    { path: "/plugins/group-report", component: GroupReportPage, meta: { title: "抱团报备", fullBleed: true } },
    { path: "/plugins/fair-squad-building", component: FairSquadBuildingPage, meta: { title: "公平建队", fullBleed: true } },
    { path: "/squad-management", component: SquadManagementPage, meta: { titleKey: "routeTitle.squadManagement", fullBleed: true } },
    {
      path: "/udp-event-forwarder",
      component: UdpEventForwarderPage,
      meta: { title: "UDP Forwarder" },
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
