// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_STATE_FILE = "./data/plugin-subscriptions.json";

/**
 * 类型归类覆盖表
 *
 * 有些条目在代码组织上放在 modules 目录中，但在产品语义上更像“插件能力”。
 * 这张表只影响订阅页中的展示分类，不改动原有 manifest.id，也不改动实际运行方式。
 */
const KIND_OVERRIDES = {
};

const HIDDEN_RUNTIME_ITEM_IDS = new Set([
  "module.squadDisband",
  "module.squadKick",
  "module.squadRemove",
]);

/**
 * 插件订阅模块
 *
 * 这层的职责不是安装/卸载模块，而是维护“是否继续接收实时事件”的开关。
 * 约定如下：
 * 1. 未显式配置的条目默认视为已订阅，避免破坏现有功能。
 * 2. 订阅关闭后，模块/插件仍然存在，只是应该在自己的实时入口提前 return。
 * 3. Web 页面也会登记进来，方便管理员看到全貌，但页面条目本身不一定参与实时处理。
 */
export function createPluginSubscriptionsModule({ core, modules, config }) {
  const moduleConfig = config.get("modules.pluginSubscriptions", {});
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const stateFile = path.resolve(process.cwd(), moduleConfig.stateFile ?? DEFAULT_STATE_FILE);

  // subscriptions: 只保存被管理员显式改动过的订阅值。
  // runtimeItems: 保存运行时发现的模块、插件、页面信息，供订阅页展示。
  const subscriptions = new Map();
  const runtimeItems = new Map();
  let lastUpdatedAt = "";

  /**
   * 对历史 ID 做兼容归一化，避免旧命名导致状态丢失。
   */
  function normalizeId(id) {
    const text = String(id ?? "").trim();
    if (text === "weapon-collector") return "plugin.weaponCollector";
    return text;
  }

  /**
   * 统一的订阅判断入口。
   *
   * 默认策略必须是“没有配置过就视为开启”，这样新模块接入后不会因为缺失配置被静默停用。
   */
  function isSubscribed(id) {
    const normalizedId = normalizeId(id);
    if (!enabled || !normalizedId) return true;
    if (!subscriptions.has(normalizedId)) return true;
    return subscriptions.get(normalizedId) !== false;
  }

  /**
   * 记录运行时条目。
   *
   * ModuleManager / PluginManager 在加载实例后会调用这里，把 manifest 信息同步进订阅中心，
   * WebRegistry 里的页面条目则在 getState() 阶段动态合并。
   */
  function registerRuntimeItem(item = {}) {
    const id = normalizeId(item.id ?? item.manifest?.id);
    if (!id) return null;
    if (HIDDEN_RUNTIME_ITEM_IDS.has(id)) return null;

    const now = new Date().toISOString();
    const previous = runtimeItems.get(id) ?? {};
    const manifest = item.manifest ?? item;

    const next = {
      id,
      name: String(item.name ?? manifest.name ?? previous.name ?? id),
      kind: resolveKind(id, item.kind ?? manifest.kind ?? previous.kind),
      status: item.status ?? previous.status ?? "running",
      description: String(item.description ?? manifest.description ?? previous.description ?? ""),
      lastUpdatedAt: item.lastUpdatedAt ?? previous.lastUpdatedAt ?? now,
      source: item.source ?? previous.source ?? id,
    };

    runtimeItems.set(id, next);
    return { ...next };
  }

  /**
   * 生成前端使用的完整视图状态。
   *
   * 数据来源有三部分：
   * 1. 已加载的运行时条目
   * 2. WebRegistry 中登记的页面
   * 3. 已持久化但当前未加载的旧条目
   */
  function getState() {
    const now = new Date().toISOString();
    const items = new Map();

    for (const item of runtimeItems.values()) {
      if (HIDDEN_RUNTIME_ITEM_IDS.has(item.id)) continue;
      items.set(item.id, { ...item });
    }

    for (const page of getRegisteredPages()) {
      if (HIDDEN_RUNTIME_ITEM_IDS.has(page.id)) continue;
      items.set(page.id, page);
    }

    for (const [id] of subscriptions.entries()) {
      if (HIDDEN_RUNTIME_ITEM_IDS.has(id)) continue;
      if (!items.has(id)) {
        items.set(id, {
          id,
          name: id,
          kind: resolveKind(id, "unknown"),
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
        kind: resolveKind(item.id, item.kind),
        subscribed: isSubscribed(item.id),
        status: normalizeStatus(item.status),
        description: item.description ?? "",
        lastUpdatedAt: item.lastUpdatedAt ?? "",
      }))
      .sort((a, b) => {
        const kindDiff = kindRank(a.kind) - kindRank(b.kind);
        if (kindDiff !== 0) return kindDiff;
        return a.id.localeCompare(b.id);
      });

    return {
      enabled,
      subscriptions: list,
      lastUpdatedAt,
    };
  }

  /**
   * 显式设置订阅状态，并立即持久化。
   */
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

  /**
   * 供前端快速切换开关使用。
   */
  async function toggleSubscribed(id) {
    const normalizedId = normalizeId(id);
    return setSubscribed(normalizedId, !isSubscribed(normalizedId));
  }

  /**
   * 重置为“全部按默认策略处理”。
   * 当前前端未暴露这个操作，但 API 先保留。
   */
  async function reset() {
    subscriptions.clear();
    lastUpdatedAt = new Date().toISOString();
    await persistState();
    return { success: true };
  }

  /**
   * 启动时读取持久化状态。
   *
   * 读取失败不能让主程序崩溃，因此这里采用“告警 + 回退空状态”策略。
   */
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
          if (HIDDEN_RUNTIME_ITEM_IDS.has(normalizeId(id))) continue;
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

  /**
   * 使用“临时文件写入 -> rename 替换”的方式落盘，避免中途写坏 JSON。
   */
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

  /**
   * 将 WebRegistry 页面转成统一展示格式。
   * 这些页面条目主要是为了让管理员看到“页面入口也是系统的一部分”。
   */
  function getRegisteredPages() {
    const pages = typeof core.webRegistry?.getAllPages === "function"
      ? core.webRegistry.getAllPages()
      : core.webRegistry?.getPages?.() ?? [];

    return pages.map((page) => ({
      id: page.id,
      name: page.title ?? page.id,
      kind: resolveKind(page.id, "web page"),
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
      description: "插件订阅管理模块。集中维护面板内所有模块、插件、网页条目的'是否继续接收实时事件'开关状态，并持久化至本地 JSON 文件。管理员可通过订阅页面按条目单独关闭不需要的能力，关闭后该条目不再消费事件流，但模块本身仍保持加载，可随时重新开启。",
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
        description: "武器收集插件。订阅 module.killManage 发出的 combatResolved 事件，从击伤、击倒、击杀记录中提取武器名称，自动去除虚幻引擎类对象后缀（_Cxxx），按武器类别归类统计各类型事件的触发次数，供后续武器使用分析和战斗报告使用。",
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

/**
 * 统一分类命名，并允许针对个别条目做展示覆盖。
 */
function resolveKind(id, kind) {
  const normalizedId = normalizeIdStatic(id);
  if (normalizedId && KIND_OVERRIDES[normalizedId]) {
    return KIND_OVERRIDES[normalizedId];
  }
  return normalizeKind(kind);
}

function normalizeIdStatic(id) {
  const text = String(id ?? "").trim();
  if (text === "weapon-collector") return "plugin.weaponCollector";
  return text;
}

/**
 * 统一类型命名，避免前后端出现 module / Module / webpage 等混写。
 */
function normalizeKind(kind) {
  const text = String(kind ?? "").trim().toLowerCase();
  if (text === "module") return "module";
  if (text === "plugin") return "plugin";
  if (text === "web" || text === "webpage" || text === "web page") return "web page";
  if (text === "parser") return "parser";
  return "unknown";
}

/**
 * 统一状态命名，兼容历史中文值和英文值。
 */
function normalizeStatus(status) {
  const text = String(status ?? "").trim().toLowerCase();
  if (text === "running" || text === "stopped" || text === "unloaded" || text === "error") return text;
  if (text === "未加载") return "unloaded";
  if (text === "已停止") return "stopped";
  if (text === "错误") return "error";
  return "running";
}

/**
 * 控制展示排序，让“真正处理实时数据的模块/插件”排在更前面。
 */
function kindRank(kind) {
  return {
    module: 0,
    plugin: 1,
    parser: 2,
    "web page": 3,
    unknown: 4,
  }[kind] ?? 5;
}
