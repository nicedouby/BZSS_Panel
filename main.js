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
 * 6. RconManager
 * 7. UdpEventReceiver
 * 8. ModuleManager
 * 9. PluginManager
 * 10. WebServer
 * 11. PythonLogParserManager
 */

import { ConfigManager } from "./core/config-manager.js";
import { Logger } from "./core/logger.js";
import { EventBus } from "./core/event-bus.js";
import { WebRegistry } from "./core/web-registry.js";
import { WebStatus } from "./core/web-status.js";
import { RconManager } from "./core/rcon-manager.js";
import { UdpEventReceiver } from "./core/udp-event-receiver.js";
import { WebServer } from "./core/web-server.js";
import { PythonLogParserManager } from "./core/python-log-parser-manager.js";
import { ModuleManager } from "./core/module-manager.js";
import { PluginManager } from "./core/plugin-manager.js";
import { AuthManager } from "./core/auth-manager.js";
import { EventPipeline } from "./core/event-pipeline.js";

async function main() {
  const configManager = new ConfigManager("./config.json");
  await configManager.load();

  const logger = new Logger(configManager.get("core.logger", { useColor: true }));
  logger.info("BZSS Panel WebCore starting...");

  const eventBus = new EventBus({ logger });
  const eventPipeline = new EventPipeline({
    config: configManager.get("eventPipeline", {}),
  });
  const webRegistry = new WebRegistry({ config: configManager, logger });
  const webStatus = new WebStatus({ config: configManager, logger });
  const authManager = new AuthManager({
    config: configManager.get("auth", {}),
    logger,
  });

  const rconManager = new RconManager({
    config: configManager.get("rcon", {}),
    logger,
    eventBus,
    webStatus,
    eventPipeline,
  });

  const udpReceiver = new UdpEventReceiver({
    config: configManager.get("udp", {}),
    logger,
    eventBus,
    webStatus,
    eventPipeline,
  });

  const coreContext = {
    config: configManager,
    logger,
    eventBus,
    eventPipeline,
    webRegistry,
    webStatus,
    rconManager,
    authManager,
  };

  const moduleManager = new ModuleManager({
    core: coreContext,
    logger,
    config: configManager,
  });

  const pluginManager = new PluginManager({
    core: coreContext,
    modules: moduleManager.registry,
    logger,
    config: configManager,
  });

  const webServer = new WebServer({
    config: configManager.get("web", {}),
    logger,
    core: coreContext,
    modules: moduleManager.registry,
  });

  const pythonLogParserManager = new PythonLogParserManager({
    config: configManager.get("pythonLogParser", {}),
    logger,
    webStatus,
  });

  await authManager.start();
  await rconManager.start();
  await udpReceiver.start();
  await moduleManager.loadBuiltInModules();
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
  await pluginManager.loadPlugins();
  coreContext.pluginManager = pluginManager;
  await webServer.start();

  // 放在最后启动 Python，确保 UDP 和 Web 都已经准备好。
  await pythonLogParserManager.start();

  logger.info("BZSS Panel WebCore started.");
  logger.info(`Web: http://${webServer.host}:${webServer.port}`);

  async function shutdown() {
    logger.warn("Shutdown requested.");

    await pythonLogParserManager.stop();
    await webServer.stop();
    await pluginManager.stopAll();
    await moduleManager.stopAll();
    await udpReceiver.stop();
    await rconManager.stop();
    await authManager.stop();

    logger.info("BZSS Panel WebCore stopped.");
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[FATAL]", error);
  process.exit(1);
});
