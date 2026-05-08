// -*- coding: utf-8 -*-

import { createAuditModule } from "../modules/audit/index.js";
import { createServerStatusModule } from "../modules/server-status/index.js";
import { createPlayerStateModule } from "../modules/player-state/index.js";
import { createSquadStateModule } from "../modules/squad-state/index.js";
import { createSquadCreationOrderModule } from "../modules/squad-creation-order/index.js";
import { createMatchStateModule } from "../modules/match-state/index.js";
import { createConsoleModule } from "../modules/console/index.js";
import { createCombatStateModule } from "../modules/combat-state/index.js";
import { createPlayerDatabaseModule } from "../modules/player-database/index.js";
import { createKillManageModule } from "../modules/kill-manage/index.js";
import { createTeamBalanceModule } from "../modules/team-balance/index.js";
import { createSquadManageModule } from "../modules/squad-manage/index.js";
import { createWarningModule } from "../modules/warning/index.js";
import { createPlaytimeModule } from "../modules/playtime/index.js";
import { createSeedModule } from "../modules/seed/index.js";
import { createPointsModule } from "../modules/points/index.js";
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
      createServerStatusModule,
      createPlayerStateModule,
      createSquadStateModule,
      createSquadCreationOrderModule,
      createMatchStateModule,
      createCombatStateModule,
      createPlayerDatabaseModule,
      createKillManageModule,
      createTeamBalanceModule,
      createSquadManageModule,
      createWarningModule,
      createPlaytimeModule,
      createSeedModule,
      createPointsModule,
    ];

    for (const factory of factories) {
      const instance = factory({
        core: this.core,
        modules: this.registry,
        config: this.config,
      });

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

      this.logger.module(`Loaded ${instance.manifest.id}`);
    }
  }

  async stopAll() {
    for (const instance of [...this.instances].reverse()) {
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
