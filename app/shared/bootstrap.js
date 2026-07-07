// -*- coding: utf-8 -*-

import { ConfigManager } from "../core/config-manager.js";
import { Logger } from "../core/logger.js";
import { EventBus } from "../core/event-bus.js";
import { ConsoleService } from "../core/console-service.js";
import { WebRegistry } from "../core/web-registry.js";
import { WebStatus } from "../core/web-status.js";
import { RconManager } from "../core/rcon-manager.js";
import { UdpEventReceiver } from "../core/udp-event-receiver.js";
import { WebServer } from "../core/web-server.js";
import { PythonLogParserManager } from "../core/python-log-parser-manager.js";
import { ModuleManager } from "../core/module-manager.js";
import { PluginManager } from "../core/plugin-manager.js";
import { AuthManager } from "../core/auth-manager.js";
import { EventPipeline } from "../core/event-pipeline.js";
import { RuntimeState } from "../core/runtime-state.js";
import { RawLogDerivedEvents } from "../core/raw-log-derived-events.js";
import { PerformanceMonitor } from "../core/performance-monitor.js";
import { AuditManager } from "../core/audit/audit-manager.js";
import { LogPostMonitor } from "../core/logpost-monitor.js";
import { LogPostFileBridge } from "../core/logpost-file-bridge.js";
import { NewbieReserveExchangeService } from "../services/newbie-reserve-exchange-service.js";
import { CoreControlServer } from "./core-control-server.js";
import { CoreControlClient } from "./core-control-client.js";

export async function startCoreRuntime(options = {}) {
  const configManager = new ConfigManager("./config.json");
  await configManager.load();

  const logger = new Logger(configManager.get("core.logger", { useColor: true }));
  const role = options.role ?? "core";
  logger.info(`BZSS ${role} starting...`, {
    scope: "app",
    source: `app.${role}`,
  });

  const eventBus = new EventBus({
    logger: logger.child({ moduleId: "core.eventBus", source: "core.eventBus", channel: "event" }),
  });
  const eventPipeline = new EventPipeline({
    config: configManager.get("eventPipeline", {}),
  });
  const webRegistry = new WebRegistry({
    config: configManager,
    logger: logger.child({ moduleId: "core.webRegistry", source: "core.webRegistry", channel: "web" }),
  });
  const webStatus = new WebStatus({
    config: configManager,
    logger: logger.child({ moduleId: "core.webStatus", source: "core.webStatus" }),
  });
  const authManager = new AuthManager({
    config: configManager.get("auth", {}),
    logger: logger.child({ moduleId: "core.authManager", source: "core.authManager" }),
  });
  const runtimeState = new RuntimeState({
    eventBus,
    webStatus,
    logger: logger.child({ moduleId: "core.runtimeState", source: "core.runtimeState" }),
    config: configManager,
  });
  const performanceMonitor = new PerformanceMonitor({
    config: configManager,
    logger: logger.child({ moduleId: "core.performanceMonitor", source: "core.performanceMonitor" }),
  });
  const consoleService = new ConsoleService({
    maxEntries: configManager.get("console.maxEntries", 5000),
  });
  const logPostMonitor = new LogPostMonitor({
    logger: logger.child({ moduleId: "core.logPostMonitor", source: "core.logPostMonitor" }),
  });
  const auditManager = new AuditManager({
    config: configManager,
    logger: logger.child({ moduleId: "core.auditManager", source: "core.auditManager" }),
  });
  await auditManager.init();

  const rconConfig = configManager.get("rcon", {}) ?? {};
  const matchStateConfig = configManager.get("modules.matchState", {}) ?? {};
  const rconPollingConfig = rconConfig.polling ?? {};
  const matchStatePollingConfig = matchStateConfig.polling ?? {};

  const rconManager = new RconManager({
    config: {
      ...rconConfig,
      matchStatePolling: matchStatePollingConfig,
      polling: {
        ...rconPollingConfig,
        enabled: rconPollingConfig.enabled ?? matchStateConfig.enabled !== false,
        dynamic: matchStatePollingConfig.dynamic ?? rconPollingConfig.dynamic ?? {},
      },
    },
    logger: logger.child({ moduleId: "core.rconManager", source: "core.rconManager" }),
    eventBus,
    webStatus,
    eventPipeline,
    logPostMonitor,
  });
  rconManager.onNativeLog((entry) => {
    runtimeState.recordEvent("console", entry);
    runtimeState.recordEvent("rcon", entry);
  });

  const udpReceiver = new UdpEventReceiver({
    config: configManager.get("udp", {}),
    logger: logger.child({ moduleId: "core.udpEventReceiver", source: "core.udpEventReceiver" }),
    eventBus,
    webStatus,
    eventPipeline,
    logPostMonitor,
  });
  const logPostFileBridge = new LogPostFileBridge({
    config: configManager.get("logPostFileBridge", {}),
    logger: logger.child({ moduleId: "core.logPostFileBridge", source: "core.logPostFileBridge" }),
    eventBus,
    eventPipeline,
    webStatus,
    logPostMonitor,
  });

  const coreContext = {
    config: configManager,
    logger,
    createLogger(bindings = {}) {
      return logger.child(bindings);
    },
    eventBus,
    eventPipeline,
    webRegistry,
    webStatus,
    runtimeState,
    console: consoleService,
    rconManager,
    authManager,
    performanceMonitor,
    auditManager,
    logPostMonitor,
    logPostFileBridge,
  };
  auditManager.core = coreContext;
  consoleService.attachCore(coreContext);

  const moduleManager = new ModuleManager({
    core: coreContext,
    logger: logger.child({ moduleId: "core.moduleManager", source: "core.moduleManager", channel: "module" }),
    config: configManager,
  });
  coreContext.moduleManager = moduleManager;

  const rawLogDerivedEvents = new RawLogDerivedEvents({
    eventBus,
    logger: logger.child({ moduleId: "core.rawLogDerivedEvents", source: "core.rawLogDerivedEvents" }),
    playerIdentityResolver({ serverId, keyType, keyValue }) {
      const playerState = moduleManager?.registry?.playerState;
      if (!playerState || !keyValue) return null;
      if (keyType === "steam64ID") {
        const player = playerState.getPlayerBySteamID(serverId, keyValue);
        return player?.name ? { name: player.name, source: "playerStateBySteam64" } : null;
      }
      if (keyType === "eosID") {
        const player = playerState.getPlayerByEOSID(serverId, keyValue);
        return player?.name ? { name: player.name, source: "playerStateByEOSID" } : null;
      }
      if (keyType === "controllerID") {
        const player = playerState.getPlayerByControllerID(serverId, keyValue);
        return player?.name ? { name: player.name, source: "playerStateByControllerID" } : null;
      }
      return null;
    },
  });
  coreContext.rawLogDerivedEvents = rawLogDerivedEvents;

  const pluginManager = new PluginManager({
    core: coreContext,
    modules: moduleManager.registry,
    logger: logger.child({ moduleId: "core.pluginManager", source: "core.pluginManager" }),
    config: configManager,
  });
  coreContext.pluginManager = pluginManager;

  const pythonLogParserManager = new PythonLogParserManager({
    config: configManager.get("pythonLogParser", {}),
    logger: logger.child({ moduleId: "core.pythonLogParserManager", source: "core.pythonLogParserManager" }),
    webStatus,
  });
  coreContext.pythonLogParserManager = pythonLogParserManager;

  const reserveExchangeService = options.enableReserveExchange === false
    ? null
    : new NewbieReserveExchangeService({
        core: coreContext,
        modules: moduleManager.registry,
        config: configManager,
        logger: logger.child({ moduleId: "core.reserveExchange", source: "core.reserveExchange", channel: "web" }),
      });

  const coreControlServer = options.enableCoreControl === false
    ? null
    : new CoreControlServer({
        config: configManager.get("coreControl", {}),
        logger: logger.child({ moduleId: "core.coreControlServer", source: "core.coreControlServer" }),
        core: coreContext,
        modules: moduleManager.registry,
      });

  performanceMonitor.start();
  await authManager.start();
  await moduleManager.loadBuiltInModules();
  rawLogDerivedEvents.start();
  eventPipeline.setCombatIdentityResolver(({ serverId, keyType, keyValue }) => {
    const playerState = moduleManager.registry.playerState;
    if (!playerState || !keyValue) return null;
    if (keyType === "steam64ID") {
      const player = playerState.getPlayerBySteamID(serverId, keyValue);
      return player?.name ? { name: player.name, source: "playerStateBySteam64" } : null;
    }
    if (keyType === "eosID") {
      const player = playerState.getPlayerByEOSID(serverId, keyValue);
      return player?.name ? { name: player.name, source: "playerStateByEOSID" } : null;
    }
    if (keyType === "controllerID") {
      const player = playerState.getPlayerByControllerID(serverId, keyValue);
      return player?.name ? { name: player.name, source: "playerStateByControllerID" } : null;
    }
    return null;
  });
  await rconManager.start();
  await udpReceiver.start();
  await logPostFileBridge.start();
  await pluginManager.loadPlugins();
  if (reserveExchangeService) {
    await reserveExchangeService.start();
  }
  if (coreControlServer) {
    await coreControlServer.start();
  }
  await pythonLogParserManager.start();

  async function shutdown() {
    logger.warn(`Shutdown requested for ${role}.`, {
      scope: "app",
      source: `app.${role}`,
    });
    await pythonLogParserManager.stop();
    if (coreControlServer) await coreControlServer.stop();
    if (reserveExchangeService) await reserveExchangeService.stop();
    await pluginManager.stopAll();
    await moduleManager.stopAll();
    rawLogDerivedEvents?.stop?.();
    await logPostFileBridge.stop();
    await udpReceiver.stop();
    await rconManager.stop();
    runtimeState.stop();
    performanceMonitor.stop();
    await auditManager.close();
    await authManager.stop();
  }

  return {
    configManager,
    logger,
    coreContext,
    modules: moduleManager.registry,
    moduleManager,
    pluginManager,
    authManager,
    runtimeState,
    webStatus,
    reserveExchangeService,
    coreControlServer,
    shutdown,
  };
}

export async function startWebRuntime(options = {}) {
  const configManager = new ConfigManager("./config.json");
  await configManager.load();
  const logger = new Logger(configManager.get("core.logger", { useColor: true }));
  const authManager = new AuthManager({
    config: configManager.get("auth", {}),
    logger: logger.child({ moduleId: "core.authManager", source: "core.authManager" }),
  });
  const webRegistry = new WebRegistry({
    config: configManager,
    logger: logger.child({ moduleId: "core.webRegistry", source: "core.webRegistry", channel: "web" }),
  });
  const coreClient = options.coreClient ?? new CoreControlClient({
    config: configManager.get("coreControl", {}),
    logger: logger.child({ moduleId: "core.coreControlClient", source: "core.coreControlClient" }),
    fetchImpl: options.fetchImpl,
  });
  const webServer = new WebServer({
    config: {
      ...(configManager.get("web", {}) ?? {}),
      ...(options.webConfig ?? {}),
    },
    logger: logger.child({ moduleId: "core.webServer", source: "core.webServer", channel: "web" }),
    core: {
      config: configManager,
      logger,
      authManager,
      webRegistry,
      coreClient,
      performanceMonitor: {
        getSnapshot() {
          return {};
        },
      },
    },
    modules: options.modules ?? {},
    coreClient,
  });

  await authManager.start();
  await webServer.start();

  async function shutdown() {
    logger.warn("Shutdown requested for web.", {
      scope: "app",
      source: "app.web",
    });
    await webServer.stop();
    await authManager.stop();
  }

  return {
    configManager,
    logger,
    authManager,
    webServer,
    coreClient,
    shutdown,
  };
}
