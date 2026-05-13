import { pluginCatalog } from "./plugin.store.js";

const pluginState = new Map();

function ensureState(pluginId) {
  const catalogItem = pluginCatalog.find((plugin) => plugin.id === pluginId);
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

export function getAllPlugins({ subscriptionsApi } = {}) {
  return pluginCatalog.map((plugin) => {
    const state = ensureState(plugin.id);
    const subscribed = resolveSubscribed(plugin.id, subscriptionsApi, state.subscribed);
    return clonePlugin({
      ...plugin,
      enabled: state.enabled,
      subscribed,
      status: normalizeStatus(state.status, state.enabled, subscribed),
      config: cloneValue(state.config ?? plugin.config ?? {}),
    });
  });
}

export function getPluginById(pluginId, options = {}) {
  return getAllPlugins(options).find((plugin) => plugin.id === pluginId);
}

export function setPluginEnabled(pluginId, enabled, { subscriptionsApi } = {}) {
  const plugin = ensurePluginExists(pluginId);
  const state = ensureState(pluginId);
  const subscribed = resolveSubscribed(pluginId, subscriptionsApi, state.subscribed);
  if (!subscribed) {
    throw new Error(`Plugin is not subscribed: ${pluginId}`);
  }

  state.enabled = Boolean(enabled);
  state.status = state.enabled ? "ok" : "disabled";
  pluginState.set(pluginId, state);

  return toManifest(plugin, state, subscribed);
}

export function updatePluginConfig(pluginId, nextConfig, { subscriptionsApi } = {}) {
  const plugin = ensurePluginExists(pluginId);
  const state = ensureState(pluginId);
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

  return toManifest(plugin, state, subscribed);
}

function ensurePluginExists(pluginId) {
  const plugin = pluginCatalog.find((item) => item.id === pluginId);
  if (!plugin) {
    throw new Error(`Plugin not found: ${pluginId}`);
  }
  return plugin;
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
