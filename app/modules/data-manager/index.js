// -*- coding: utf-8 -*-

import { DataManagerService } from "./service.js";

export function createDataManagerModule({ core, logger }) {
  const moduleLogger = logger ?? core.logger;
  const service = new DataManagerService({ logger: moduleLogger });

  return {
    manifest: {
      id: "module.dataManager",
      name: "Panel Data Manager",
      kind: "module",
      version: "1.0.0",
      description: "Scans panel-owned data directories, reports disk usage, and safely removes selected historical files.",
    },
    apiName: "dataManager",
    api: service,

    async start() {
      core.webRegistry.registerPage({
        id: "web.dataManager",
        title: "数据管理",
        group: "系统",
        route: "/system/data-manager",
        pageModule: "/pages/data-manager.js",
        source: "module.dataManager",
        required: true,
        enabled: true,
        order: 20,
        icon: "🧹",
        superAdminOnly: true,
      });
      moduleLogger.info?.("[DataManager] module started");
    },
  };
}

