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
      this.logger.info("Plugin system disabled.", {
        operation: "loadPlugins",
      });
      return;
    }

    const paths = pluginConfig.paths ?? [];
    if (paths.length === 0) {
      this.logger.info("No plugins configured.", {
        operation: "loadPlugins",
      });
      return;
    }

    for (const pluginPath of paths) {
      await this.loadPlugin(pluginPath);
    }
  }

  async loadPlugin(pluginPath) {
    const abs = path.resolve(process.cwd(), pluginPath);
    this.logger.debug(`Loading plugin from ${pluginPath}`, {
      operation: "loadPlugin",
      data: {
        pluginPath,
        abs,
      },
    });
    const mod = await import(pathToFileURL(abs).href);

    if (typeof mod.createPlugin !== "function") {
      this.logger.warn(`Plugin missing createPlugin(): ${pluginPath}`, {
        operation: "loadPlugin",
      });
      return;
    }

    const pluginId = inferPluginId(pluginPath);
    const pluginLogger = this.core.createLogger?.({
      moduleId: pluginId,
      source: pluginId,
      channel: "module",
    }) ?? this.logger;

    const instance = mod.createPlugin({
      core: {
        logger: pluginLogger,
        eventBus: this.core.eventBus,
        config: this.config,
        pluginSubscriptions: this.core.pluginSubscriptions,
        webRegistry: this.core.webRegistry,
        pluginManager: this,
      },
      modules: this.modules,
    });

    if (instance.init) await instance.init();
    if (instance.start) await instance.start();

    this.instances.push(instance);
    this.modules.pluginSubscriptions?.registerRuntimeItem?.({
      ...(instance.manifest ?? {}),
      status: "running",
    });
    pluginLogger.info(`Plugin loaded: ${instance.manifest?.id ?? pluginPath}`, {
      label: "MODULE",
      operation: "load",
      data: {
        pluginPath,
      },
    });
  }

  async stopAll() {
    for (const instance of [...this.instances].reverse()) {
      const pluginId = instance?.manifest?.id ?? "plugin.unknown";
      const pluginLogger = this.core.createLogger?.({
        moduleId: pluginId,
        source: pluginId,
        channel: "module",
      }) ?? this.logger;
      pluginLogger.debug(`Stopping ${pluginId}`, {
        operation: "stop",
      });
      if (instance.stop) await instance.stop();
    }
  }
}

function inferPluginId(pluginPath) {
  const name = path.basename(String(pluginPath || ""), path.extname(String(pluginPath || "")));
  if (!name) return "plugin.unknown";
  return name.startsWith("plugin.") ? name : `plugin.${name}`;
}
