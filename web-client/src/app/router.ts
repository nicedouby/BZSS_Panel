import { createRouter, createWebHistory } from "vue-router";

import MatchStatusPage from "../pages/MatchStatusPage.vue";
import ConsolePage from "../pages/ConsolePage.vue";
import PlayerDatabasePage from "../pages/PlayerDatabasePage.vue";
import CombatCleanPage from "../pages/CombatCleanPage.vue";
import KillManagePage from "../pages/KillManagePage.vue";
import SquadOrderPage from "../pages/SquadOrderPage.vue";
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
    { path: "/squad-order", component: SquadOrderPage, meta: { titleKey: "routeTitle.squadOrder" } },
    {
      path: "/plugin-subscriptions",
      component: ComingSoonPage,
      props: {
        titleKey: "routeTitle.pluginSubscriptions",
        subtitle: "",
        message: "",
      },
      meta: { titleKey: "routeTitle.pluginSubscriptions" },
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
