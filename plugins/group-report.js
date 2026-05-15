// -*- coding: utf-8 -*-

import path from "node:path";
import { GroupReportService } from "./group-report.service.js";

export function createPlugin({ core } = {}) {
  const service = new GroupReportService({
    dataDir: path.resolve(process.cwd(), "data"),
    eventBus: core?.eventBus,
    singleGroupPerPlayer: false,
  });

  const api = {
    getSnapshot: () => service.getSnapshot(),
    getGroups: () => service.getGroups(),
    getGroup: (groupId) => service.getGroup(groupId),
    createGroup: (input) => service.createGroup(input),
    updateGroup: (groupId, input) => service.updateGroup(groupId, input),
    deleteGroup: (groupId) => service.deleteGroup(groupId),
    addMember: (groupId, input) => service.addMember(groupId, input),
    updateMember: (groupId, playerKey, input) => service.updateMember(groupId, playerKey, input),
    removeMember: (groupId, playerKey) => service.removeMember(groupId, playerKey),
  };

  return {
    manifest: {
      id: "group-report",
      name: "抱团报备",
      kind: "plugin",
      version: "1.0.0",
      description: "人工维护玩家抱团关系的数据源插件。只负责持久化、查询和事件分发，不负责打乱、换队或 RCON。",
    },
    apiName: "groupReport",
    api,

    async init() {
      await service.init();
    },

    async start() {
      core.groupReport = api;
      core.webRegistry?.registerPage?.({
        id: "web.groupReport",
        title: "抱团报备",
        group: "插件",
        route: "/plugins/group-report",
        pageModule: "/pages/group-report.js",
        source: "group-report",
        description: "玩家抱团关系维护页面，仅用于人工维护和快照读取。",
        required: false,
        enabled: true,
        order: 520,
        icon: "GR",
        hiddenFromSidebar: true,
      });
      core.logger?.info?.("[GroupReport] Plugin started.");
    },

    async stop() {
      if (core.groupReport === api) {
        delete core.groupReport;
      }
      core.logger?.info?.("[GroupReport] Plugin stopped.");
    },
  };
}
