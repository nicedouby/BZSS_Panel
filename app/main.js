#!/usr/bin/env node
// -*- coding: utf-8 -*-

/**
 * BZSS Panel WebCore 启动入口。
 *
 * 本版本融合了：
 * - core 基础设施
 * - modules 看不见的业务能力层
 * - plugins 可扩展插件层
 * - web Web Shell / Web Registry / Web API
 *
 * 启动顺序：
 * 1. ConfigManager
 * 2. Logger
 * 3. EventBus
 * 4. WebRegistry
 * 5. WebStatus
 * 6. AuthManager
 * 7. ModuleManager (loadBuiltInModules)
 * 8. EventPipeline (setCombatIdentityResolver)
 * 9. RconManager
 * 10. UdpEventReceiver
 * 11. PluginManager
 * 12. WebServer
 * 13. PythonLogParserManager
 */

import { ConfigManager } from "./core/config-manager.js";
import { Logger } from "./core/logger.js";
import { EventBus } from "./core/event-bus.js";
import { ConsoleService } from "./core/console-service.js";
import { WebRegistry } from "./core/web-registry.js";
import { WebStatus } from "./core/web-status.js";
import { RconManager } from "./core/rcon-manager.js";
import { UdpEventReceiver } from "./core/udp-event-receiver.js";
import { LanOptimizedWebServer } from "./core/lan-optimized-web-server.js";
import { PythonLogParserManager } from "./core/python-log-parser-manager.js";
import { ModuleManager } from "./core/module-manager.js";
import { PluginManager } from "./core/plugin-manager.js";
import { AuthManager } from "./core/auth-manager.js";
import { EventPipeline } from "./core/event-pipeline.js";
import { RuntimeState } from "./core/runtime-state.js";
import { RawLogDerivedEvents } from "./core/raw-log-derived-events.js";
import { PerformanceMonitor } from "./core/performance-monitor.js";
import { AuditManager } from "./core/audit/audit-manager.js";
import { LogPostMonitor } from "./core/logpost-monitor.js";
import { LogPostFileBridge } from "./core/logpost-file-bridge.js";
import { FileIOManager } from "./core/file-io-manager.js";
import { TaskManager } from "./core/task/TaskManager.js";
import { BzssCoreCommandService } from "./core/bzss-core-command-service.js";
import { NewbieReserveExchangeService } from "./services/newbie-reserve-exchange-service.js";

async function main() {
  const configManager = new ConfigManager("./config.json");
  await configManager.load();

  const logger = new Logger(configManager.get("core.logger", { useColor: true }));
  logger.info("BZSS Panel WebCore starting...", {
    scope: "app",
    source: "app.main",
  });

  const eventBus = new EventBus({
    logger: logger.child({
      moduleId: "core.eventBus",
      source: "core.eventBus",
      channel: "event",
    }),
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
  eventBus.setPerformanceMonitor(performanceMonitor);

  const fileIOManager = new FileIOManager({
    config: configManager.get("fileIO", {}),
    logger: logger.child({ moduleId: "core.fileIO", source: "core.fileIO" }),
  });
  await fileIOManager.start();

  const taskManager = new TaskManager({
    config: configManager.get("task", {}),
    logger: logger.child({ moduleId: "core.taskManager", source: "core.taskManager" }),
  });
  await taskManager.start();

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

  const bzssCoreCommandService = new BzssCoreCommandService({
    config: configManager,
    logger: logger.child({ moduleId: "core.bzssCoreCommandService", source: "core.bzssCoreCommandService" }),
  });

  let rawLogDerivedEvents = null;

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
    fileIO: fileIOManager,
    performanceMonitor,
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
    fileIO: fileIOManager,
    taskManager,
    bzssCoreCommandService,
  };
  auditManager.core = coreContext;

  consoleService.attachCore(coreContext);

  const moduleManager = new ModuleManager({
    core: coreContext,
    logger: logger.child({ moduleId: "core.moduleManager", source: "core.moduleManager", channel: "module" }),
    config: configManager,
  });
  coreContext.moduleManager = moduleManager;

  rawLogDerivedEvents = new RawLogDerivedEvents({
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

  const webServer = new LanOptimizedWebServer({
    config: configManager.get("web", {}),
    logger: logger.child({ moduleId: "core.webServer", source: "core.webServer", channel: "web" }),
    core: coreContext,
    modules: moduleManager.registry,
  });
  const reserveExchangeService = new NewbieReserveExchangeService({
    core: coreContext,
    modules: moduleManager.registry,
    config: configManager,
    logger: logger.child({ moduleId: "core.reserveExchange", source: "core.reserveExchange", channel: "web" }),
  });

  const pythonLogParserManager = new PythonLogParserManager({
    config: configManager.get("pythonLogParser", {}),
    logger: logger.child({ moduleId: "core.pythonLogParserManager", source: "core.pythonLogParserManager" }),
    webStatus,
  });
  coreContext.pythonLogParserManager = pythonLogParserManager;

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
  await pluginManager.loadPlugins();
  // FileBridge may replay recent durable events during start. Start it only
  // after plugins have subscribed, otherwise recovery events such as squad
  // creation are emitted before their consumers exist and are silently lost.
  await logPostFileBridge.start();
  await reserveExchangeService.start();
  await webServer.start();

  // 放在最后启动 Python，确保 UDP 和 Web 都已经准备好。
  await pythonLogParserManager.start();

  logger.info("BZSS Panel WebCore started.", {
    scope: "app",
    source: "app.main",
  });
  logger.info(`Web: http://${webServer.host}:${webServer.port}`, {
    scope: "app",
    source: "app.main",
  });
  logger.info(`Reserve exchange: ${reserveExchangeService.baseUrl || `http://${reserveExchangeService.host}:${reserveExchangeService.port}`}`, {
    scope: "app",
    source: "app.main",
  });
  logger.info(`Web static mode: ${webServer.useVueClient ? "vue" : "legacy"}`, {
    scope: "app",
    source: "app.main",
  });
  logger.info(`Static directory: ${webServer.staticDirectory}`, {
    scope: "app",
    source: "app.main",
  });

  async function shutdown() {
    logger.warn("Shutdown requested.", {
      scope: "app",
      source: "app.main",
    });

    await pythonLogParserManager.stop();
    await reserveExchangeService.stop();
    await webServer.stop();
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
    await taskManager.stop();
    await fileIOManager.stop();

    logger.info("BZSS Panel WebCore stopped.", {
      scope: "app",
      source: "app.main",
    });
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[FATAL]", error);
  process.exit(1);
});
