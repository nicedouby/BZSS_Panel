import { createRouter, createWebHistory } from "vue-router";

import MatchStatusPage from "../pages/MatchStatusPage.vue";
import ConsolePage from "../pages/ConsolePage.vue";
import PlayerDatabasePage from "../pages/PlayerDatabasePage.vue";
import CombatCleanPage from "../pages/CombatCleanPage.vue";
import KillManagePage from "../pages/KillManagePage.vue";
import ComingSoonPage from "../pages/ComingSoonPage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/match-status" },
    { path: "/match-status", component: MatchStatusPage, meta: { title: "Match Status" } },
    { path: "/console", component: ConsolePage, meta: { title: "Console" } },
    { path: "/player-database", component: PlayerDatabasePage, meta: { title: "Player Database" } },
    { path: "/combat-clean", component: CombatCleanPage, meta: { title: "Combat Clean" } },
    { path: "/kill-manage", component: KillManagePage, meta: { title: "Kill Manage" } },
    {
      path: "/plugin-subscriptions",
      component: ComingSoonPage,
      props: {
        title: "Plugin Subscriptions",
        subtitle: "Reserved while the Vue migration reaches this page.",
        message: "Legacy web/pages implementations are no longer mounted from Vue routes.",
      },
      meta: { title: "Plugin Subscriptions" },
    },
    {
      path: "/:pathMatch(.*)*",
      component: ComingSoonPage,
      props: {
        title: "Coming Soon",
        subtitle: "This route has not been migrated in the Vue client yet.",
        message: "The route exists, but the feature still needs its dedicated Vue page.",
      },
      meta: { title: "Coming Soon" },
    },
  ],
});
