#!/usr/bin/env node
// -*- coding: utf-8 -*-

/**
 * BZSS Panel JS Starter
 *
 * 这是 JS 后端的最小启动程序。
 *
 * 当前职责：
 * 1. 读取 config.json
 * 2. 启动 UDP Receiver，接收 Python 发来的事件 JSON
 * 3. 将事件投递到 EventBus
 * 4. 加载插件，并让插件订阅事件
 * 5. 支持 Ctrl+C 优雅退出
 *
 * 注意：
 * 这个程序现在不负责数据库、不负责 WebSocket、不负责前端 API。
 * 它只是 BZSS Panel 后端事件系统的第一步。
 */

import { loadConfig } from "./core/config-loader.js";
import { createLogger } from "./core/logger.js";
import { EventBus } from "./core/event-bus.js";
import { UdpReceiver } from "./core/udp-receiver.js";
import { PluginManager } from "./core/plugin-manager.js";

async function main() {
  // 1. 读取配置文件。默认读取项目根目录下的 config.json。
  const config = await loadConfig("./config.json");

  // 2. 创建日志器。logger 只是轻量封装，方便统一输出格式和颜色。
  const logger = createLogger({
    useColor: config.console?.useColor ?? true,
  });

  logger.info("BZSS JS Receiver starting...");
  logger.info(`ServerName=${config.server?.name ?? "Unnamed"}`);

  // 3. 创建 EventBus。插件只监听 EventBus，不直接监听 UDP socket。
  const eventBus = new EventBus({ logger });

  // 4. 创建并加载插件管理器。
  const pluginManager = new PluginManager({
    config,
    eventBus,
    logger,
  });

  await pluginManager.loadPlugins();

  // 5. 创建 UDP Receiver。它监听 Python 脚本发送过来的 UDP JSON 事件。
  const udpReceiver = new UdpReceiver({
    host: config.udp?.host ?? "127.0.0.1",
    port: config.udp?.port ?? 7788,
    maxMessageBytes: config.udp?.maxMessageBytes ?? 65535,
    logger,
  });

  // 6. 当 UDP 收到一个合法事件后，将它投递到 EventBus。
  udpReceiver.onEvent((event, remoteInfo) => {
    // 给事件补一个 JS 接收时间，不覆盖 Python 原本的 Time / LogTime。
    event.JsReceiveTime = new Date().toISOString();

    // 记录 UDP 来源，方便排查是否来自本机。
    event.UdpRemoteAddress = remoteInfo.address;
    event.UdpRemotePort = String(remoteInfo.port);

    // 投递到具体事件，例如 On_PlayerDied。
    eventBus.emit(event.Event, event);

    // 同时投递到通配符事件，便于调试插件监听所有事件。
    eventBus.emit("*", event);
  });

  await udpReceiver.start();

  logger.info("BZSS JS Receiver started.");
  logger.info(`Listening UDP ${udpReceiver.host}:${udpReceiver.port}`);

  // 7. 优雅退出。Ctrl+C 时关闭 UDP Socket，给插件执行 shutdown 的机会。
  const shutdown = async () => {
    logger.warn("Shutdown requested.");
    await udpReceiver.stop();
    await pluginManager.shutdown();
    logger.info("BZSS JS Receiver stopped.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[FATAL] JS receiver failed to start:", error);
  process.exit(1);
});
