// -*- coding: utf-8 -*-

import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Core: PluginManager
 *
 * 当前 plugins.paths 为空，因此不会加载插件。
 */
export class PluginManager {
  constructor({ core, modules, logger, config }) {
    this.core = core;
    this.modules = modules;
    this.logger = logger;
    this.config = config;
    this.instances = [];
  }

  async loadPlugins() {
    const pluginConfig = this.config.get("plugins", {});
    if (!pluginConfig.enabled) {
      this.logger.info("Plugin system disabled.");
      return;
    }

    const paths = pluginConfig.paths ?? [];
    if (paths.length === 0) {
      this.logger.info("No plugins configured.");
      return;
    }

    for (const pluginPath of paths) {
      await this.loadPlugin(pluginPath);
    }
  }

  async loadPlugin(pluginPath) {
    const abs = path.resolve(process.cwd(), pluginPath);
    const mod = await import(pathToFileURL(abs).href);

    if (typeof mod.createPlugin !== "function") {
      this.logger.warn(`Plugin missing createPlugin(): ${pluginPath}`);
      return;
    }

    const instance = mod.createPlugin({
      core: {
        logger: this.core.logger,
        eventBus: this.core.eventBus,
        config: this.config,
      },
      modules: this.modules,
    });

    if (instance.init) await instance.init();
    if (instance.start) await instance.start();

    this.instances.push(instance);
    this.logger.info(`Plugin loaded: ${instance.manifest?.id ?? pluginPath}`);
  }

  async stopAll() {
    for (const instance of [...this.instances].reverse()) {
      if (instance.stop) await instance.stop();
    }
  }
}
