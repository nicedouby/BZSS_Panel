import { pluginCatalog as staticCatalog } from "./plugin.store.js";

const pluginState = new Map();

function ensureState(pluginId, catalogItem) {
  const current = pluginState.get(pluginId) ?? {};
  const next = {
    enabled: current.enabled ?? Boolean(catalogItem?.enabled ?? true),
    status: current.status ?? (catalogItem?.enabled === false ? "disabled" : "ok"),
    config: current.config ?? cloneValue(catalogItem?.config ?? {}),
    subscribed: current.subscribed ?? Boolean(catalogItem?.subscribed ?? true),
  };

  pluginState.set(pluginId, next);
  return next;
}

export function getAllPlugins({ subscriptionsApi, pluginManager } = {}) {
  // 汇总所有可能的插件源
  const dynamicCatalog = pluginManager?.catalog ?? [];
  const allIds = new Set([
    ...staticCatalog.map(p => p.id),
    ...dynamicCatalog.map(p => p.id)
  ]);

  const list = Array.from(allIds).map(id => {
    const staticItem = staticCatalog.find(p => p.id === id);
    const dynamicItem = dynamicCatalog.find(p => p.id === id);
    
    // 合并元数据，动态扫描的优先
    const merged = {
      ...(staticItem ?? {}),
      ...(dynamicItem ?? {}),
    };

    const state = ensureState(id, merged);
    const subscribed = resolveSubscribed(id, subscriptionsApi, state.subscribed);
    
    return clonePlugin({
      ...merged,
      enabled: state.enabled,
      subscribed,
      status: normalizeStatus(state.status, state.enabled, subscribed),
      config: cloneValue(state.config ?? merged.config ?? {}),
    });
  });

  return list;
}

export function getPluginById(pluginId, options = {}) {
  return getAllPlugins(options).find((plugin) => plugin.id === pluginId);
}

export function setPluginEnabled(pluginId, enabled, { subscriptionsApi, pluginManager, config } = {}) {
  const catalog = getAllPlugins({ subscriptionsApi, pluginManager });
  const plugin = catalog.find((item) => item.id === pluginId);
  if (!plugin) {
    throw new Error(`Plugin not found: ${pluginId}`);
  }

  const state = ensureState(pluginId, plugin);
  const subscribed = resolveSubscribed(pluginId, subscriptionsApi, state.subscribed);
  if (!subscribed) {
    throw new Error(`Plugin is not subscribed: ${pluginId}`);
  }

  state.enabled = Boolean(enabled);
  state.status = state.enabled ? "ok" : "disabled";
  pluginState.set(pluginId, state);

  // 如果有 config 对象，尝试持久化到 config.json
  if (config) {
    const current = config.get(`plugins.${pluginId}`, {});
    config.set(`plugins.${pluginId}`, { ...current, enabled: state.enabled });
    config.save?.().catch(err => console.error(`Failed to save config: ${err.message}`));
  }

  return toManifest(plugin, state, subscribed);
}

export function updatePluginConfig(pluginId, nextConfig, { subscriptionsApi, pluginManager, config } = {}) {
  const catalog = getAllPlugins({ subscriptionsApi, pluginManager });
  const plugin = catalog.find((item) => item.id === pluginId);
  if (!plugin) {
    throw new Error(`Plugin not found: ${pluginId}`);
  }

  const state = ensureState(pluginId, plugin);
  const subscribed = resolveSubscribed(pluginId, subscriptionsApi, state.subscribed);
  if (!subscribed) {
    throw new Error(`Plugin is not subscribed: ${pluginId}`);
  }

  validatePluginConfig(plugin, nextConfig);

  state.config = {
    ...(state.config ?? {}),
    ...cloneValue(nextConfig),
  };
  pluginState.set(pluginId, state);

  // 如果有 config 对象，尝试持久化到 config.json
  if (config) {
    const current = config.get(`plugins.${pluginId}`, {});
    config.set(`plugins.${pluginId}`, { ...current, ...state.config });
    config.save?.().catch(err => console.error(`Failed to save config: ${err.message}`));
  }

  return toManifest(plugin, state, subscribed);
}

function resolveSubscribed(pluginId, subscriptionsApi, fallback) {
  if (subscriptionsApi?.isSubscribed) {
    return Boolean(subscriptionsApi.isSubscribed(pluginId));
  }
  return Boolean(fallback);
}

function validatePluginConfig(plugin, config) {
  for (const field of plugin.configSchema ?? []) {
    const value = config?.[field.key];

    if (field.required && (value === undefined || value === null || value === "")) {
      throw new Error(`Missing required config field: ${field.key}`);
    }

    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (field.type === "number" && typeof value !== "number") {
      throw new Error(`Config field ${field.key} must be number`);
    }

    if (field.type === "boolean" && typeof value !== "boolean") {
      throw new Error(`Config field ${field.key} must be boolean`);
    }

    if ((field.type === "string" || field.type === "textarea") && typeof value !== "string") {
      throw new Error(`Config field ${field.key} must be string`);
    }

    if (field.type === "select" && field.options?.length) {
      const exists = field.options.some((option) => option.value === value);
      if (!exists) {
        throw new Error(`Invalid option for config field: ${field.key}`);
      }
    }
  }
}

function toManifest(plugin, state, subscribed) {
  return clonePlugin({
    ...plugin,
    enabled: state.enabled,
    subscribed,
    status: normalizeStatus(state.status, state.enabled, subscribed),
    config: cloneValue(state.config ?? plugin.config ?? {}),
  });
}

function normalizeStatus(status, enabled, subscribed) {
  if (!subscribed) return "disabled";
  if (!enabled) return "disabled";
  return status === "warning" || status === "error" ? status : "ok";
}

function clonePlugin(plugin) {
  return {
    ...plugin,
    configSchema: plugin.configSchema ? cloneValue(plugin.configSchema) : undefined,
    config: plugin.config ? cloneValue(plugin.config) : undefined,
    icon: plugin.icon ?? "",
  };
}

function cloneValue(value) {
  if (value === undefined) return value;
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
