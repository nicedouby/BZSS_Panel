// -*- coding: utf-8 -*-

import { createAuditModule } from "../modules/audit/index.js";
import { createServerStatusModule } from "../modules/server-status/index.js";
import { createPlayerStateModule } from "../modules/player-state/index.js";
import { createSquadLifecycleModule } from "../modules/squad-lifecycle/index.js";
import { createSquadRestrictionMonitorModule } from "../modules/squad-restriction-monitor/index.js";
import { createSquadRestrictionEnforcementModule } from "../modules/squad-restriction-enforcement/index.js";
import { createMatchStateModule } from "../modules/match-state/index.js";
import { createMatchLifecycleModule } from "../modules/match-lifecycle/index.js";
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
import { createLogpostDiagnosticsModule } from "../modules/logpost-diagnostics/enhanced.js";

import { createPlayerDatabaseModule } from "../modules/player-database/index.js";
import { createPlayerDbSyncModule } from "../modules/player-db-sync/index.js";
import { createPlayerTimeStatsModule } from "../modules/player-time-stats/index.js";
import { createIpLookupModule } from "../modules/ip-lookup/index.js";
import { createKillManageModule } from "../modules/kill-manage/index.js";
import { createCombatCollectorModule } from "../modules/combat-collector/index.js";
import { createBattleLogModule } from "../modules/battle-log/index.js";
import { createCombatLogModule } from "../modules/combat-log/index.js";
import { createAdminWarnModule } from "../modules/admin-warn/index.js";
import { createSquadRuleChainModule } from "../modules/squad-rule-chain/index.js";
import { createSquadNamePolicyGuardModule } from "../modules/squad-name-policy-guard/index.js";
import { createSquadNamePolicyPatrolModule } from "../modules/squad-name-policy-patrol/index.js";
import { createPlaytimeModule } from "../modules/playtime-avatar-refresh/index.js";
import { createPluginSubscriptionsModule } from "../modules/plugin-subscriptions/index.js";
import { createServerStatsModule } from "../modules/server-stats/index.js";
import { createRemoteTelemetryModule } from "../modules/remote-telemetry/index.js";
import { createScheduledBroadcastModule } from "../modules/scheduled-broadcast/index.js";
import { createPlayerSessionRecordsModule } from "../modules/player-session-records/index.js";
import { createReserveSlotsModule } from "../modules/reserve-slots/index.js";
import { createWarmupReserveGrantModule } from "../modules/warmup-reserve-grant/index.js";
import { createBlackEdgePrivilegeModule } from "../modules/black-edge-privilege/index.js";
import { createAstrbotBridgeModule } from "../modules/astrbot-bridge/index.js";
import { createBzssCoreMonitorModule } from "../modules/bzss-core-monitor/index.js";
import { createTacticalStateModule } from "../modules/tactical-state/index.js";
import { createDynamicPressureZoneModule } from "../modules/dynamic-pressure-zone/index.js";
import { createPressureZoneRulesModule } from "../modules/pressure-zone-rules/index.js";
import { createTacticalReplayPlayerModule } from "../modules/tactical-replay-player-native/index.js";
import { createTacticalStateV2Module } from "../modules/tactical-state-v2/index.js";
import { createStepCounterModule } from "../modules/step-counter/index.js";
// The native JSONL writer rewrites the complete tactical snapshot every 333 ms
// and can grow to several gigabytes per round. Use the binary delta writer for
// new recordings; the native player remains loaded for old native archives.
import { createTacticalFeedWriterModule } from "../modules/tactical-feed-writer/index.js";

import { createChatManagerModule } from "../modules/chat-manager/index.js";
import { createNetworkStatsModule } from "../modules/network-stats/index.js";
import { createSquadBrowserPlayerLookupModule } from "../modules/squadbrowser-player-lookup/index.js";

/**
 * Core module registry and lifecycle manager.
 */
export class ModuleManager {
  constructor({ core, logger, config }) {
    this.core = core;
    this.logger = logger;
    this.config = config;

    this.registry = {};
    this.instances = [];
    this.startedInstances = new Set();
  }

  async loadBuiltInModules() {
    const factories = [
      createChatManagerModule,
      createPluginSubscriptionsModule,
      createAuditModule,
      createConsoleModule,
      createLogClockModule,
      createLogpostDiagnosticsModule,
      createServerStatusModule,
      createPlayerStateModule,
      createSquadLifecycleModule,
      createSquadRestrictionMonitorModule,
      createMatchCacheModule,
      createMatchPlayerPresenceModule,
      createMatchStateModule,
      createMatchLifecycleModule,
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
      createCombatCollectorModule,
      createBattleLogModule,
      createCombatLogModule,
      createAdminWarnModule,
      createSquadRestrictionEnforcementModule,
      createSquadRuleChainModule,
      createSquadNamePolicyGuardModule,
      createSquadNamePolicyPatrolModule,
      createPlaytimeModule,
      createServerStatsModule,
      createRemoteTelemetryModule,
      createScheduledBroadcastModule,
      createPlayerSessionRecordsModule,
      createReserveSlotsModule,
      createWarmupReserveGrantModule,
      createBlackEdgePrivilegeModule,
      createAstrbotBridgeModule,
      createBzssCoreMonitorModule,
      createTacticalStateModule,
      createDynamicPressureZoneModule,
      createPressureZoneRulesModule,
      createTacticalReplayPlayerModule,
      createTacticalStateV2Module,
      createStepCounterModule,
      createTacticalFeedWriterModule,
      createNetworkStatsModule,
      createSquadBrowserPlayerLookupModule,
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

      await this.activateInstance(instance);

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

  async activateInstance(instance) {
    if (!instance || this.instances.includes(instance)) return this.isModuleEnabled(instance);
    this.instances.push(instance);
    const enabled = this.isModuleEnabled(instance);

    if (enabled) {
      if (instance.init) await instance.init();
      if (instance.start && !this.startedInstances.has(instance)) {
        await instance.start();
        this.startedInstances.add(instance);
      }
      if (instance.apiName && instance.api) {
        this.registry[instance.apiName] = instance.api;
        if (instance.apiName === "pluginSubscriptions") this.core.pluginSubscriptions = instance.api;
      }
    }

    if (!instance.manifest?.hidden) {
      this.registry.pluginSubscriptions?.registerRuntimeItem?.({
        ...(instance.manifest ?? {}),
        status: enabled ? "running" : "stopped",
      });
    }
    return enabled;
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
      if (!this.startedInstances.has(instance)) continue;
      if (instance.stop) await instance.stop();
      this.startedInstances.delete(instance);
    }
  }

  isModuleEnabled(instance) {
    const moduleId = String(instance?.manifest?.id ?? "");
    const configKey = moduleId.startsWith("module.")
      ? moduleId.slice("module.".length)
      : moduleId;
    const moduleConfig = this.config.get(`modules.${configKey}`, {});
    const defaultEnabled = instance?.manifest?.defaultEnabled !== false;
    return moduleConfig.enabled === undefined
      ? defaultEnabled
      : moduleConfig.enabled !== false;
  }

  getRuntimeStatus(manifest = {}) {
    return this.isModuleEnabled({ manifest }) ? "running" : "stopped";
  }
}

function inferModuleId(factoryName) {
  const name = String(factoryName || "").replace(/^create/, "").replace(/Module$/, "");
  if (!name) return "module.unknown";
  const normalized = name.charAt(0).toLowerCase() + name.slice(1);
  return `module.${normalized}`;
}
