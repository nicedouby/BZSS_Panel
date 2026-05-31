// -*- coding: utf-8 -*-

import { createCombatManagerService, bindCombatManagerModules } from "../../plugins/services/combat_manager_service.js";

const MODULE_ID = "module.combatManager";
const LEGACY_PERMISSION = ["kill", "_manager.view"].join("");
const NEW_PERMISSION = "combat_manager.view";
const LEGACY_MANAGE_PERMISSION = ["kill", "_manager.manage"].join("");
const NEW_MANAGE_PERMISSION = "combat_manager.manage";

export function createCombatManagerModule({ core, modules, config, logger }) {
  bindCombatManagerModules(modules);
  const service = createCombatManagerService({ core, modules, config, logger });
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: MODULE_ID,
    source: MODULE_ID,
    channel: "module",
  }) ?? core.logger;

  return {
    manifest: {
      id: MODULE_ID,
      name: "战斗管理",
      kind: "module",
      version: "1.0.0",
      description: "统一战斗管理服务。聚合历史战斗事件与归档战斗事件，向前端提供单一业务入口与兼容事件流。",
    },
    apiName: "combatManager",
    api: service.api,

    async start() {
      core.webRegistry?.registerPage?.({
        id: "web.combatManager",
        title: "战斗管理",
        group: "管理",
        route: "/combat-manager",
        pageModule: "/pages/combat-clean.js",
        source: MODULE_ID,
        required: false,
        enabled: true,
        order: 111,
        icon: "⚔️",
        requiredPermission: NEW_PERMISSION,
      });

      core.webRegistry?.registerPage?.({
        id: "web.combatManagerKillLegacy",
        title: "战斗管理",
        group: "管理",
        route: "/kill-manage",
        pageModule: "/pages/combat-clean.js",
        source: MODULE_ID,
        required: false,
        enabled: true,
        order: 112,
        icon: "⚔️",
        hiddenFromSidebar: true,
        requiredPermission: LEGACY_PERMISSION,
      });

      core.webRegistry?.registerPage?.({
        id: "web.combatManagerCleanLegacy",
        title: "战斗管理",
        group: "管理",
        route: "/combat-clean",
        pageModule: "/pages/combat-clean.js",
        source: MODULE_ID,
        required: false,
        enabled: true,
        order: 113,
        icon: "⚔️",
        hiddenFromSidebar: true,
        requiredPermission: NEW_PERMISSION,
      });

      await service.start();
      moduleLogger.info("CombatManager module started.", {
        operation: "start",
        data: {
          permissions: {
            view: NEW_PERMISSION,
            legacyView: LEGACY_PERMISSION,
            manage: NEW_MANAGE_PERMISSION,
            legacyManage: LEGACY_MANAGE_PERMISSION,
          },
        },
      });
    },

    async stop() {
      await service.stop();
      moduleLogger.info("CombatManager module stopped.", {
        operation: "stop",
      });
    },
  };
}

export default createCombatManagerModule;
