// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_STATE_FILE = "./data/plugin-subscriptions.json";

export function createPluginSubscriptionsModule({ core, modules, config }) {
  const moduleConfig = config.get("modules.pluginSubscriptions", {});
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const stateFile = path.resolve(process.cwd(), moduleConfig.stateFile ?? DEFAULT_STATE_FILE);
  const subscriptions = new Map();
  const runtimeItems = new Map();
  let lastUpdatedAt = "";

  function normalizeId(id) {
    const text = String(id ?? "").trim();
    if (text === "weapon-collector") return "plugin.weaponCollector";
    return text;
  }

  function isSubscribed(id) {
    const normalizedId = normalizeId(id);
    if (!enabled || !normalizedId) return true;
    if (!subscriptions.has(normalizedId)) return true;
    return subscriptions.get(normalizedId) !== false;
  }

  function registerRuntimeItem(item = {}) {
    const id = normalizeId(item.id ?? item.manifest?.id);
    if (!id) return null;

    const now = new Date().toISOString();
    const previous = runtimeItems.get(id) ?? {};
    const manifest = item.manifest ?? item;

    const next = {
      id,
      name: String(item.name ?? manifest.name ?? previous.name ?? id),
      kind: normalizeKind(item.kind ?? manifest.kind ?? previous.kind),
      status: item.status ?? previous.status ?? "running",
      description: String(item.description ?? manifest.description ?? previous.description ?? ""),
      lastUpdatedAt: item.lastUpdatedAt ?? previous.lastUpdatedAt ?? now,
      source: item.source ?? previous.source ?? id,
    };

    runtimeItems.set(id, next);
    return { ...next };
  }

  function getState() {
    const now = new Date().toISOString();
    const items = new Map();

    for (const item of runtimeItems.values()) {
      items.set(item.id, { ...item });
    }

    for (const page of getRegisteredPages()) {
      items.set(page.id, page);
    }

    for (const [id] of subscriptions.entries()) {
      if (!items.has(id)) {
        items.set(id, {
          id,
          name: id,
          kind: "unknown",
          status: "unloaded",
          description: "",
          lastUpdatedAt: lastUpdatedAt || now,
          source: id,
        });
      }
    }

    const list = [...items.values()]
      .map((item) => ({
        id: item.id,
        name: item.name,
        kind: normalizeKind(item.kind),
        subscribed: isSubscribed(item.id),
        status: normalizeStatus(item.status),
        description: item.description ?? "",
        lastUpdatedAt: item.lastUpdatedAt ?? "",
      }))
      .sort((a, b) => {
        const kindOrder = kindRank(a.kind) - kindRank(b.kind);
        if (kindOrder !== 0) return kindOrder;
        return a.id.localeCompare(b.id);
      });

    return {
      enabled,
      subscriptions: list,
      lastUpdatedAt,
    };
  }

  async function setSubscribed(id, subscribed) {
    const normalizedId = normalizeId(id);
    if (!normalizedId) {
      const error = new Error("Subscription id is required.");
      error.statusCode = 400;
      error.code = "InvalidSubscriptionId";
      throw error;
    }

    subscriptions.set(normalizedId, Boolean(subscribed));
    lastUpdatedAt = new Date().toISOString();
    await persistState();

    return {
      success: true,
      id: normalizedId,
      subscribed: isSubscribed(normalizedId),
    };
  }

  async function toggleSubscribed(id) {
    const normalizedId = normalizeId(id);
    return setSubscribed(normalizedId, !isSubscribed(normalizedId));
  }

  async function reset() {
    subscriptions.clear();
    lastUpdatedAt = new Date().toISOString();
    await persistState();
    return { success: true };
  }

  async function loadState() {
    if (!enabled) return;

    try {
      const text = await fs.readFile(stateFile, "utf8");
      const parsed = JSON.parse(text);
      const rawMap = parsed?.subscriptions && typeof parsed.subscriptions === "object"
        ? parsed.subscriptions
        : parsed;

      if (rawMap && typeof rawMap === "object" && !Array.isArray(rawMap)) {
        for (const [id, value] of Object.entries(rawMap)) {
          subscriptions.set(normalizeId(id), value !== false);
        }
      }

      lastUpdatedAt = String(parsed?.lastUpdatedAt ?? "");
    } catch (error) {
      if (error.code !== "ENOENT") {
        core.logger.warn(`pluginSubscriptions state read failed: ${error.message}`);
      }
      subscriptions.clear();
      lastUpdatedAt = "";
    }
  }

  async function persistState() {
    if (!enabled) return;

    const dir = path.dirname(stateFile);
    await fs.mkdir(dir, { recursive: true });

    const data = {
      subscriptions: Object.fromEntries([...subscriptions.entries()].sort(([a], [b]) => a.localeCompare(b))),
      lastUpdatedAt,
    };

    const tempFile = `${stateFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(tempFile, stateFile);
  }

  function getRegisteredPages() {
    const pages = typeof core.webRegistry?.getAllPages === "function"
      ? core.webRegistry.getAllPages()
      : core.webRegistry?.getPages?.() ?? [];

    return pages.map((page) => ({
      id: page.id,
      name: page.title ?? page.id,
      kind: "web page",
      status: page.enabled ? "running" : "stopped",
      description: page.route ? `${page.route} (${page.source ?? "web"})` : (page.source ?? ""),
      lastUpdatedAt: "",
      source: page.source ?? page.id,
    }));
  }

  const api = {
    getState,
    setSubscribed,
    toggleSubscribed,
    reset,
    isSubscribed,
    registerRuntimeItem,
  };

  return {
    manifest: {
      id: "module.pluginSubscriptions",
      name: "Plugin Subscriptions",
      kind: "module",
      version: "0.1.0",
      description: "Controls whether modules and plugins handle realtime events.",
      requiredPermission: "plugins.manage",
    },
    apiName: "pluginSubscriptions",
    api,

    async init() {
      await loadState();
      registerRuntimeItem(this.manifest);
      registerRuntimeItem({
        id: "plugin.weaponCollector",
        name: "Weapon Collector Plugin",
        kind: "plugin",
        status: "unloaded",
        description: "Collects weapon statistics from resolved combat events when the plugin is loaded.",
      });
    },

    async start() {
      core.webRegistry.registerPage({
        id: "web.pluginSubscriptions",
        title: "插件订阅",
        group: "系统",
        route: "/plugin-subscriptions",
        pageModule: "/pages/plugin-subscriptions.js",
        source: "module.pluginSubscriptions",
        required: false,
        enabled: true,
        order: 900,
        icon: "🔌",
        hiddenFromSidebar: true,
        requiredPermission: "plugins.manage",
      });

      core.logger.module("module.pluginSubscriptions started.");
    },
  };
}

function normalizeKind(kind) {
  const text = String(kind ?? "").trim().toLowerCase();
  if (text === "module") return "module";
  if (text === "plugin") return "plugin";
  if (text === "web" || text === "webpage" || text === "web page") return "web page";
  if (text === "parser") return "parser";
  return "unknown";
}

function normalizeStatus(status) {
  const text = String(status ?? "").trim().toLowerCase();
  if (text === "running" || text === "stopped" || text === "unloaded" || text === "error") return text;
  if (text === "未加载") return "unloaded";
  if (text === "已停止") return "stopped";
  if (text === "错误") return "error";
  return "running";
}

function kindRank(kind) {
  return {
    module: 0,
    plugin: 1,
    parser: 2,
    "web page": 3,
    unknown: 4,
  }[kind] ?? 5;
}
