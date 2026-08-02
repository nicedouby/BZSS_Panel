// -*- coding: utf-8 -*-

import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

/**
 * Core: PluginManager
 *
 * 管理插件的发现、加载和生命周期。
 * 默认扫描 plugins/ 目录下的所有 .js 文件。
 */
export class PluginManager {
  constructor({ core, modules, logger, config }) {
    this.core = core;
    this.modules = modules;
    this.logger = logger;
    this.config = config;
    this.instances = [];
    this.catalog = [];
  }

  /**
   * 扫描 plugins 目录，收集所有插件的 manifest。
   */
  async scanPlugins() {
    const scanRoots = [
      path.resolve(process.cwd(), "app/plugins"),
      path.resolve(process.cwd(), "plugins"),
    ];
    const results = [];

    for (const pluginsDir of scanRoots) {
      let stats;
      try {
        stats = await fs.stat(pluginsDir);
      } catch {
        this.logger.debug(`Skipping missing plugins directory: ${pluginsDir}`, {
          operation: "scanPlugins",
        });
        continue;
      }

      if (!stats.isDirectory()) {
        this.logger.debug(`Skipping non-directory plugins path: ${pluginsDir}`, {
          operation: "scanPlugins",
        });
        continue;
      }

      this.logger.debug(`Scanning plugins directory: ${pluginsDir}`, {
        operation: "scanPlugins",
      });

      try {
        const files = await fs.readdir(pluginsDir);
        const jsFiles = files.filter((f) => f.endsWith(".js") && !f.endsWith(".service.js") && !f.endsWith(".store.js"));

        const relativeRoot = path.relative(process.cwd(), pluginsDir).replaceAll("\\", "/");
        for (const file of jsFiles) {
          const filePath = path.posix.join(relativeRoot, file);
          const metadata = await this.getPluginMetadata(filePath);
          if (metadata) {
            results.push({
              ...metadata,
              path: filePath,
            });
          }
        }
      } catch (error) {
        this.logger.error(`Failed to scan plugins directory ${pluginsDir}: ${error.message}`, {
          operation: "scanPlugins",
        });
      }
    }

    this.catalog = results;
    return results;
  }

  /**
   * 尝试获取单个插件文件的元数据。
   */
  async getPluginMetadata(pluginPath) {
    const abs = path.resolve(process.cwd(), pluginPath);
    try {
      const mod = await import(pathToFileURL(abs).href);

      if (typeof mod.createPlugin !== "function") {
        return null;
      }

      // 临时初始化一个实例来获取 manifest
      // 注意：这可能会导致一些副作用，但目前插件的 createPlugin 通常只是定义 api/manifest
      const tempInstance = mod.createPlugin({
        core: { ...this.core, logger: this.logger.child({ moduleId: "temp" }) },
        modules: this.modules,
        config: this.config,
        logger: this.logger,
      });

      const manifest = tempInstance.manifest ?? {};
      const pluginId = manifest.id ?? inferPluginId(pluginPath);

      return {
        id: pluginId,
        name: manifest.name ?? pluginId,
        version: manifest.version ?? "0.0.0",
        description: manifest.description ?? "",
        category: manifest.category ?? "Plugin",
        configSchema: manifest.configSchema ?? [],
        manifest,
      };
    } catch (error) {
      this.logger.warn(`Failed to read metadata for ${pluginPath}: ${error.message}`);
      return null;
    }
  }

  async loadPlugins() {
    await this.scanPlugins();

    const pluginConfig = this.config.get("plugins", {});
    if (!pluginConfig.enabled) {
      this.logger.info("Plugin system disabled.", {
        operation: "loadPlugins",
      });
      return;
    }

    // 优先使用 config.json 中的 paths，如果没有则加载 catalog 中所有已启用的插件
    const explicitPaths = pluginConfig.paths ?? [];
    
    if (explicitPaths.length > 0) {
      for (const pluginPath of explicitPaths) {
        await this.loadPlugin(pluginPath);
      }
    } else {
      // 自动加载逻辑：如果 catalog 中的插件在 config 中没有被明确禁用，则加载
      for (const entry of this.catalog) {
        const state = this.config.get(`plugins.${entry.id}`, {});
        if (state.enabled !== false) {
          await this.loadPlugin(entry.path);
        }
      }
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

    try {
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
          rconManager: this.core.rconManager,
          webRegistry: this.core.webRegistry,
          pluginManager: this,
          webStatus: this.core.webStatus,
          taskManager: this.core.taskManager,
          bzssCoreCommandService: this.core.bzssCoreCommandService,
        },
        modules: this.modules,
        playerRepository: this.modules.playerDatabase ?? null,
        steamGameDurationService: this.modules.playtime ?? null,
        config: this.config,
        logger: pluginLogger,
      });

      if (instance.init) await instance.init();
      if (instance.start) await instance.start();

      this.instances.push(instance);
      this.modules.pluginSubscriptions?.registerRuntimeItem?.({
        ...(instance.manifest ?? {}),
        status: "running",
      });

      pluginLogger.info(`Plugin loaded: ${instance.manifest?.id ?? pluginId}`, {
        label: "MODULE",
        operation: "load",
        data: {
          pluginPath,
        },
      });
      
      return instance;
    } catch (error) {
      this.logger.error(`Failed to load plugin ${pluginPath}: ${error.stack}`);
    }
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
    this.instances = [];
  }
  
  getInstances() {
    return this.instances;
  }
}

function inferPluginId(pluginPath) {
  const name = path.basename(String(pluginPath || ""), path.extname(String(pluginPath || "")));
  if (!name) return "plugin.unknown";
  return name.startsWith("plugin.") ? name : `plugin.${name}`;
}
