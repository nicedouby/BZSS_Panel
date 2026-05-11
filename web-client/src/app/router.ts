import { createRouter, createWebHistory } from "vue-router";

import MatchStatusPage from "../pages/MatchStatusPage.vue";
import ConsolePage from "../pages/ConsolePage.vue";
import PlayerDatabasePage from "../pages/PlayerDatabasePage.vue";
import CombatCleanPage from "../pages/CombatCleanPage.vue";
import SquadManagePage from "../pages/SquadManagePage.vue";
import PluginSubscriptionsPage from "../pages/PluginSubscriptionsPage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/match-status" },
    { path: "/match-status", component: MatchStatusPage, meta: { title: "对局状态" } },
    { path: "/console", component: ConsolePage, meta: { title: "控制台" } },
    { path: "/player-database", component: PlayerDatabasePage, meta: { title: "玩家数据库" } },
    { path: "/combat-clean", component: CombatCleanPage, meta: { title: "战斗清洗" } },
    { path: "/squad-manage", component: SquadManagePage, meta: { title: "小队管理" } },
    { path: "/plugin-subscriptions", component: PluginSubscriptionsPage, meta: { title: "插件订阅" } },
  ],
});
