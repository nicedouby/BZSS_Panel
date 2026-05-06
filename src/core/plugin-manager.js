// -*- coding: utf-8 -*-

/**
 * 插件管理器。
 *
 * 当前插件协议：
 *
 * 每个插件文件导出一个 register 函数：
 *
 * export async function register(context) {
 *   const unsubscribe = context.eventBus.on("On_PlayerWounded", (event) => {
 *     // do something
 *   });
 *
 *   return {
 *     name: "my-plugin",
 *     shutdown() {
 *       unsubscribe();
 *     }
 *   };
 * }
 *
 * 插件可以选择返回：
 * - undefined
 * - { name, shutdown }
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

export class PluginManager {
  constructor({ config, eventBus, logger }) {
    this.config = config;
    this.eventBus = eventBus;
    this.logger = logger;

    /**
     * 已加载插件实例。
     * @type {Array<object>}
     */
    this.plugins = [];
  }

  async loadPlugins() {
    const enabled = this.config.plugins?.enabled ?? true;

    if (!enabled) {
      this.logger.warn("Plugin system disabled.");
      return;
    }

    const pluginPaths = this.config.plugins?.paths ?? [];

    for (const pluginPath of pluginPaths) {
      await this.loadPlugin(pluginPath);
    }

    this.logger.info(`Plugins loaded: ${this.plugins.length}`);
  }

  async loadPlugin(pluginPath) {
    const absolutePath = path.resolve(process.cwd(), pluginPath);
    const url = pathToFileURL(absolutePath).href;

    try {
      const module = await import(url);

      if (typeof module.register !== "function") {
        this.logger.warn(`Plugin missing register(): ${pluginPath}`);
        return;
      }

      const plugin = await module.register({
        config: this.config,
        eventBus: this.eventBus,
        logger: this.logger,
      });

      const pluginObject = plugin ?? { name: pluginPath };
      this.plugins.push(pluginObject);
      this.logger.info(`Plugin loaded: ${pluginObject.name ?? pluginPath}`);
    } catch (error) {
      this.logger.error(`Plugin load failed: ${pluginPath}\n${error.stack ?? error}`);
    }
  }

  async shutdown() {
    for (const plugin of this.plugins) {
      if (typeof plugin.shutdown !== "function") {
        continue;
      }

      try {
        await plugin.shutdown();
        this.logger.info(`Plugin shutdown: ${plugin.name ?? "UnnamedPlugin"}`);
      } catch (error) {
        this.logger.error(`Plugin shutdown failed: ${plugin.name ?? "UnnamedPlugin"}\n${error.stack ?? error}`);
      }
    }
  }
}
