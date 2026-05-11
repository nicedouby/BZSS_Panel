// -*- coding: utf-8 -*-

import { createAuditModule } from "../modules/audit/index.js";
import { createServerStatusModule } from "../modules/server-status/index.js";
import { createPlayerStateModule } from "../modules/player-state/index.js";
import { createSquadStateModule } from "../modules/squad-state/index.js";
import { createMatchStateModule } from "../modules/match-state/index.js";
import { createConsoleModule } from "../modules/console/index.js";
import { createLogClockModule } from "../modules/log-clock/index.js";
import { createCombatStateModule } from "../modules/combat-state/index.js";
import { createPlayerDatabaseModule } from "../modules/player-database/index.js";
import { createKillManageModule } from "../modules/kill-manage/index.js";
import { createCombatCleanModule } from "../modules/combat-clean/index.js";
import { createTeamBalanceModule } from "../modules/team-balance/index.js";
import { createPlaytimeModule } from "../modules/playtime/index.js";
import { createPluginSubscriptionsModule } from "../modules/plugin-subscriptions/index.js";

/**
 * Core: ModuleManager
 *
 * 加载看不见的业务能力层。
 */
export class ModuleManager {
  constructor({ core, logger, config }) {
    this.core = core;
    this.logger = logger;
    this.config = config;

    this.registry = {};
    this.instances = [];
  }

  async loadBuiltInModules() {
    const factories = [
      createPluginSubscriptionsModule,
      createAuditModule,
      createConsoleModule,
      createLogClockModule,
      createServerStatusModule,
      createPlayerStateModule,
      createSquadStateModule,
      createMatchStateModule,
      createCombatStateModule,
      createPlayerDatabaseModule,
      createKillManageModule,
      createCombatCleanModule,
      createTeamBalanceModule,
      createPlaytimeModule,
    ];

    for (const factory of factories) {
      const factoryName = factory.name || "anonymousModuleFactory";
      this.logger.debug(`Creating module from ${factoryName}`, {
        operation: "loadBuiltInModules",
        data: {
          factoryName,
        },
      });

      const instance = factory({
        core: this.core,
        modules: this.registry,
        config: this.config,
        logger: this.core.createLogger?.({
          moduleId: inferModuleId(factoryName),
          source: inferModuleId(factoryName),
          channel: "module",
        }) ?? this.logger,
      });

      const moduleId = instance?.manifest?.id ?? inferModuleId(factoryName);
      const moduleLogger = this.core.createLogger?.({
        moduleId,
        source: moduleId,
        channel: "module",
      }) ?? this.logger;

      if (instance.init) await instance.init();
      if (instance.start) await instance.start();

      this.instances.push(instance);

      if (instance.apiName && instance.api) {
        this.registry[instance.apiName] = instance.api;
        if (instance.apiName === "pluginSubscriptions") {
          this.core.pluginSubscriptions = instance.api;
        }
      }

      this.registry.pluginSubscriptions?.registerRuntimeItem?.({
        ...(instance.manifest ?? {}),
        status: this.getRuntimeStatus(instance.manifest),
      });

      moduleLogger.info(`Loaded ${instance.manifest.id}`, {
        label: "MODULE",
        operation: "load",
        data: {
          apiName: instance.apiName ?? "",
          runtimeStatus: this.getRuntimeStatus(instance.manifest),
        },
      });
    }
  }

  async stopAll() {
    for (const instance of [...this.instances].reverse()) {
      const moduleId = instance?.manifest?.id ?? "module.unknown";
      const moduleLogger = this.core.createLogger?.({
        moduleId,
        source: moduleId,
        channel: "module",
      }) ?? this.logger;
      moduleLogger.debug(`Stopping ${moduleId}`, {
        operation: "stop",
      });
      if (instance.stop) await instance.stop();
    }
  }

  getRuntimeStatus(manifest = {}) {
    const id = String(manifest.id ?? "");
    if (!id.startsWith("module.")) return "running";

    const configKey = id.slice("module.".length);
    const moduleConfig = this.config.get(`modules.${configKey}`, {});
    return moduleConfig.enabled === false ? "stopped" : "running";
  }
}

function inferModuleId(factoryName) {
  const name = String(factoryName || "").replace(/^create/, "").replace(/Module$/, "");
  if (!name) return "module.unknown";
  const normalized = name.charAt(0).toLowerCase() + name.slice(1);
  return `module.${normalized}`;
}
