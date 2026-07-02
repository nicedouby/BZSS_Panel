// -*- coding: utf-8 -*-

import { createAuditModule } from "../modules/audit/index.js";
import { createServerStatusModule } from "../modules/server-status/index.js";
import { createPlayerStateModule } from "../modules/player-state/index.js";
import { createSquadLifecycleModule } from "../modules/squad-lifecycle/index.js";
import { createMatchStateModule } from "../modules/match-state/index.js";
import { createMatchCacheModule } from "../modules/match-cache/index.js";
import { createMatchPlayerPresenceModule } from "../modules/match-player-presence/index.js";
import { createSquadManagementModule } from "../modules/squad-management/index.js";
import { createTeamBalanceModule } from "../modules/team-balance/index.js";
import { createSquadDisbandModule } from "../modules/squad-disband/index.js";
import { createSquadKickModule } from "../modules/squad-kick/index.js";
import { createSquadRemoveModule } from "../modules/squad-remove/index.js";
import { createConsoleModule } from "../modules/console/index.js";
import { createLogClockModule } from "../modules/log-clock/index.js";
import { createCombatStateModule } from "../modules/combat-state/index.js";

import { createPlayerDatabaseModule } from "../modules/player-database/index.js";
import { createPlayerDbSyncModule } from "../modules/player-db-sync/index.js";
import { createPlayerTimeStatsModule } from "../modules/player-time-stats/index.js";
import { createIpLookupModule } from "../modules/ip-lookup/index.js";
import { createKillManageModule } from "../modules/kill-manage/index.js";
import { createCombatCleanModule } from "../modules/combat-clean/index.js";
import { createCombatManagerModule } from "../modules/combat-manager/index.js";
import { createBattleLogModule } from "../modules/battle-log/index.js";
import { createCombatLogModule } from "../modules/combat-log/index.js";
import { createAdminWarnModule } from "../modules/admin-warn/index.js";
import { createSquadRuleChainModule } from "../modules/squad-rule-chain/index.js";
import { createSquadNamePolicyGuardModule } from "../modules/squad-name-policy-guard/index.js";
import { createSquadNamePolicyPatrolModule } from "../modules/squad-name-policy-patrol/index.js";
import { createInfantryCombatEnhancerModule } from "../modules/infantry-combat-enhancer/index.js";
import { createPlaytimeModule } from "../modules/playtime/index.js";
import { createPluginSubscriptionsModule } from "../modules/plugin-subscriptions/index.js";
import { createServerStatsModule } from "../modules/server-stats/index.js";
import { createRemoteTelemetryModule } from "../modules/remote-telemetry/index.js";
import { createScheduledBroadcastModule } from "../modules/scheduled-broadcast/index.js";
import { createPlayerSessionRecordsModule } from "../modules/player-session-records/index.js";
import { createReserveSlotsModule } from "../modules/reserve-slots/index.js";
import { createBlackEdgePrivilegeModule } from "../modules/black-edge-privilege/index.js";
import { createAstrbotBridgeModule } from "../modules/astrbot-bridge/index.js";
import { createBzssCoreMonitorModule } from "../modules/bzss-core-monitor/index.js";
import { createSquadFollowStateModule } from "../modules/squad-follow-state/index.js";
import { createSquadFollowWarningModule } from "../modules/squad-follow-warning/index.js";
import { createTacticalStateModule } from "../modules/tactical-state/index.js";
import { createTacticalStateV2Module } from "../modules/tactical-state-v2/index.js";
import { createTacticalMapReplayModule } from "../modules/tactical-map-replay/index.js";

import { createChatManagerModule } from "../modules/chat-manager/index.js";
import { createNetworkStatsModule } from "../modules/network-stats/index.js";

/**
 * Core: ModuleManager
 *
 * 鍔犺浇鐪嬩笉瑙佺殑涓氬姟鑳藉姏灞傘€?
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
      createChatManagerModule,
      createPluginSubscriptionsModule,
      createAuditModule,
      createConsoleModule,
      createLogClockModule,
      createServerStatusModule,
      createPlayerStateModule,
      createSquadLifecycleModule,
      createMatchCacheModule,
      createMatchPlayerPresenceModule,
      createMatchStateModule,
      createSquadManagementModule,
      createTeamBalanceModule,
      createSquadDisbandModule,
      createSquadKickModule,
      createSquadRemoveModule,
      createCombatStateModule,
      createPlayerDatabaseModule,
      createPlayerDbSyncModule,
      createPlayerTimeStatsModule,
      createIpLookupModule,
      createCombatCleanModule,
      createCombatManagerModule,
      createBattleLogModule,
      createCombatLogModule,
      createAdminWarnModule,
      createSquadRuleChainModule,
      createSquadNamePolicyGuardModule,
      createSquadNamePolicyPatrolModule,
      createInfantryCombatEnhancerModule,
      createPlaytimeModule,
      createServerStatsModule,
      createRemoteTelemetryModule,
      createScheduledBroadcastModule,
      createPlayerSessionRecordsModule,
      createReserveSlotsModule,
      createBlackEdgePrivilegeModule,
      createAstrbotBridgeModule,
      createBzssCoreMonitorModule,
      createSquadFollowStateModule,
      createSquadFollowWarningModule,
      createTacticalStateModule,
      createTacticalStateV2Module,
      createTacticalMapReplayModule,
      createNetworkStatsModule,
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

      if (!instance.manifest?.hidden && !instance.manifest?.deprecated) {
        this.registry.pluginSubscriptions?.registerRuntimeItem?.({
          ...(instance.manifest ?? {}),
          status: this.getRuntimeStatus(instance.manifest),
        });
      }

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




