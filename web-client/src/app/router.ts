import { createRouter, createWebHistory } from "vue-router";

import MatchStatusPage from "../pages/MatchStatusPage.vue";
import ConsolePage from "../pages/ConsolePage.vue";
import PlayerDatabasePage from "../pages/PlayerDatabasePage.vue";
import CombatCleanPage from "../pages/CombatCleanPage.vue";
import KillManagePage from "../pages/KillManagePage.vue";
import AdminWarnsPage from "../pages/AdminWarnsPage.vue";
import GroupReportPage from "../pages/GroupReportPage.vue";
import TeamBalancePage from "../pages/TeamBalancePage.vue";
import FairSquadPage from "../pages/FairSquadPage.vue";
import SquadManagementPage from "../pages/SquadManagementPage.vue";
import UdpEventForwarderPage from "../pages/UdpEventForwarderPage.vue";
import ServerInfoStatisticsPage from "../pages/ServerInfoStatisticsPage.vue";
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
    { path: "/plugins/group-report/team-balance", component: TeamBalancePage, meta: { title: "队伍分配", fullBleed: true } },
    { path: "/team-balance", redirect: "/plugins/group-report/team-balance" },
    { path: "/plugins/fair-squad", component: FairSquadPage, meta: { title: "公平建队", fullBleed: true } },
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
