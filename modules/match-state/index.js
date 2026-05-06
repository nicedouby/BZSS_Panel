// -*- coding: utf-8 -*-

/**
 * Module: MatchState
 *
 * 对局状态聚合模块。
 * 给“对局状态”Web 页面提供数据。
 */
export function createMatchStateModule({ core, modules }) {
  const api = {
    getOverview() {
      const status = core.webStatus.getSnapshot();
      const players = modules.playerState?.getOnlinePlayers(status.serverId) ?? [];
      const squads = modules.squadState?.getSquads(status.serverId) ?? [];

      return {
        status,
        players,
        squads,
      };
    },
  };

  return {
    manifest: { id: "module.matchState", name: "Match State Module", kind: "module", version: "0.1.0" },
    apiName: "matchState",
    api,

    async start() {
      core.webRegistry.registerPage({
        id: "web.squadManage",
        title: "建队管理",
        group: "管理",
        route: "/squad-manage",
        pageModule: "/pages/squad-manage.js",
        source: "module.squadManage",
        required: false,
        enabled: true,
        order: 100,
        icon: "🧩",
      });

      core.webRegistry.registerPage({
        id: "web.killManage",
        title: "击杀管理",
        group: "管理",
        route: "/kill-manage",
        pageModule: "/pages/kill-manage.js",
        source: "module.killManage",
        required: false,
        enabled: true,
        order: 110,
        icon: "🎯",
      });
    },
  };
}
