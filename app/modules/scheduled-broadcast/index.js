// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_DATA_FILE = "./data/scheduled-broadcast/list.json";
const DEFAULT_TICK_MS = 1000;
const DEFAULT_INTERVAL_SECONDS = 300;
const DEFAULT_DELAY_SECONDS = 10;
const MAX_MESSAGE_LENGTH = 180;

export function createScheduledBroadcastModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.scheduledBroadcast",
    source: "module.scheduledBroadcast",
    channel: "module",
  }) ?? core.logger;

  const moduleConfig = config?.get?.("modules.scheduledBroadcast", {}) ?? {};
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const tickMs = clampNumber(moduleConfig.tickMs, DEFAULT_TICK_MS, 200, 60_000);
  const dataFile = path.resolve(process.cwd(), String(moduleConfig.dataFile ?? DEFAULT_DATA_FILE));

  const store = {
    items: [],
    running: false,
    timer: null,
    inTick: false,
    saveChain: Promise.resolve(),
    lastTickAt: 0,
    schedule: {
      nextItemId: null,
      nextRunAt: null,
      lastAdvancedAt: null,
    },
  };

  const api = {
    getState() {
      const currentId = resolveScheduledItem()?.id ?? null;
      return {
        config: {
          enabled,
          tickMs,
          dataFile,
        },
        status: {
          running: store.running,
          inTick: store.inTick,
          lastTickAt: store.lastTickAt,
          schedule: cloneJson(store.schedule),
          currentItemId: currentId,
        },
        items: listItems(currentId),
      };
    },

    async addItem(payload = {}) {
      const now = Date.now();
      const item = normalizeNewItem(payload, now, getOrderedItems().length);
      store.items.push(item);
      reindexOrder(store.items);

      if (item.enabled) {
        reconcileSchedule({
          now,
          resetTiming: !resolveScheduledItem(),
          preferredItemId: !resolveScheduledItem() ? item.id : null,
        });
      }

      await persist();
      return cloneJson(item);
    },

    async updateItem(id, patch = {}) {
      const item = findItem(id);
      if (!item) {
        const error = new Error("Scheduled broadcast item not found.");
        error.code = "ItemNotFound";
        throw error;
      }

      const now = Date.now();
      const wasCurrent = store.schedule.nextItemId === item.id;
      applyPatch(item, patch);
      item.updatedAt = now;

      const shouldReset = Boolean(patch.resetSchedule ?? true);
      const preferredItemId = item.enabled && wasCurrent ? item.id : null;
      reconcileSchedule({
        now,
        resetTiming: shouldReset || (wasCurrent && !item.enabled),
        preferredItemId,
      });

      await persist();
      return cloneJson(item);
    },

    async removeItem(id) {
      const itemId = String(id);
      const orderedBefore = getEnabledItemsOrdered();
      const removedIndex = store.items.findIndex((item) => item.id === itemId);
      if (removedIndex < 0) {
        const error = new Error("Scheduled broadcast item not found.");
        error.code = "ItemNotFound";
        throw error;
      }

      const removedWasCurrent = store.schedule.nextItemId === itemId;
      const preferredNextId = removedWasCurrent ? getNextEnabledItemIdFromList(orderedBefore, itemId) : null;
      const [removed] = store.items.splice(removedIndex, 1);
      reindexOrder(store.items);

      reconcileSchedule({
        now: Date.now(),
        resetTiming: removedWasCurrent,
        preferredItemId: preferredNextId,
      });

      await persist();
      return cloneJson(removed);
    },

    async reorder(ids = []) {
      const nextIds = Array.isArray(ids) ? ids.map((id) => String(id)) : [];
      if (!nextIds.length) {
        return { ok: true, items: listItems(resolveScheduledItem()?.id ?? null) };
      }

      const currentItemId = resolveScheduledItem()?.id ?? null;
      const byId = new Map(store.items.map((item) => [item.id, item]));
      const ordered = [];
      for (const id of nextIds) {
        const item = byId.get(id);
        if (!item) continue;
        ordered.push(item);
        byId.delete(id);
      }
      for (const item of byId.values()) ordered.push(item);

      store.items = ordered;
      reindexOrder(store.items);
      reconcileSchedule({
        now: Date.now(),
        resetTiming: !currentItemId || !findEnabledItem(currentItemId),
        preferredItemId: currentItemId,
      });

      return { ok: true, items: listItems(resolveScheduledItem()?.id ?? null) };
    },

    async runNow(id, reasonOrOptions = "manual_run") {
      const item = findItem(id);
      if (!item) {
        const error = new Error("Scheduled broadcast item not found.");
        error.code = "ItemNotFound";
        throw error;
      }

      const options = typeof reasonOrOptions === "object" && reasonOrOptions !== null
        ? reasonOrOptions
        : { reason: reasonOrOptions };

      return await runItem(item, {
        reason: String(options.reason ?? "manual_run"),
        manual: true,
        actor: options.actor ?? null,
        system: Boolean(options.system),
      });
    },

    async tick(now = Date.now()) {
      await tick(now);
    },
  };

  return {
    manifest: {
      id: "module.scheduledBroadcast",
      name: "Scheduled Broadcast",
      kind: "module",
      version: "1.1.0",
      description: "Manage scheduled broadcasts with strict ordered rotation and manual trigger support.",
    },
    apiName: "scheduledBroadcast",
    api,

    async init() {
      await load();
    },

    async start() {
      core.webRegistry?.registerPage?.({
        id: "web.scheduledBroadcast",
        title: "Scheduled Broadcast",
        group: "Management",
        route: "/scheduled-broadcasts",
        pageModule: "/pages/scheduled-broadcasts.js",
        source: "module.scheduledBroadcast",
        required: false,
        enabled: true,
        order: 116,
        icon: "B",
      });

      if (enabled) {
        startTicker();
      }

      moduleLogger?.info?.(`[ScheduledBroadcast] started. enabled=${enabled} tickMs=${tickMs}`);
    },

    async stop() {
      stopTicker();
      await store.saveChain;
      moduleLogger?.info?.("[ScheduledBroadcast] stopped.");
    },
  };

  function getOrderedItems() {
    return store.items
      .slice()
      .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
  }

  function getEnabledItemsOrdered() {
    return getOrderedItems().filter((item) => item.enabled);
  }

  function listItems(currentId = null) {
    return getOrderedItems().map((item) => ({
      ...cloneJson(item),
      nextRunAt: item.id === currentId ? toFinite(store.schedule.nextRunAt) : null,
      isCurrent: item.id === currentId,
    }));
  }

  function findItem(id) {
    const itemId = String(id ?? "").trim();
    if (!itemId) return null;
    return store.items.find((item) => item.id === itemId) ?? null;
  }

  function findEnabledItem(id) {
    const item = findItem(id);
    return item?.enabled ? item : null;
  }

  function resolveScheduledItem() {
    return findEnabledItem(store.schedule.nextItemId);
  }

  function getNextEnabledItemIdFromList(enabledItems, itemId) {
    if (!enabledItems.length) return null;
    const index = enabledItems.findIndex((item) => item.id === itemId);
    if (index < 0) {
      return enabledItems[0]?.id ?? null;
    }
    return enabledItems[(index + 1) % enabledItems.length]?.id ?? null;
  }

  function clearSchedule() {
    store.schedule.nextItemId = null;
    store.schedule.nextRunAt = null;
    store.schedule.lastAdvancedAt = null;
  }

  function reconcileSchedule({ now = Date.now(), resetTiming = false, preferredItemId = null } = {}) {
    const enabledItems = getEnabledItemsOrdered();
    if (!enabledItems.length) {
      clearSchedule();
      return;
    }

    let current = preferredItemId ? enabledItems.find((item) => item.id === preferredItemId) ?? null : null;
    if (!current) {
      current = resolveScheduledItem();
    }
    if (!current) {
      current = enabledItems[0];
      resetTiming = true;
    }

    store.schedule.nextItemId = current.id;
    if (resetTiming || !Number.isFinite(store.schedule.nextRunAt)) {
      store.schedule.nextRunAt = now + current.delaySeconds * 1000;
    }
    if (!Number.isFinite(store.schedule.lastAdvancedAt)) {
      store.schedule.lastAdvancedAt = null;
    }
  }

  function advanceScheduleAfterRun(item, now) {
    const enabledItems = getEnabledItemsOrdered();
    if (!enabledItems.length) {
      clearSchedule();
      return;
    }

    const nextItemId = getNextEnabledItemIdFromList(enabledItems, item.id) ?? enabledItems[0].id;
    const nextItem = enabledItems.find((entry) => entry.id === nextItemId) ?? enabledItems[0];
    store.schedule.nextItemId = nextItem.id;
    store.schedule.nextRunAt = now + nextItem.intervalSeconds * 1000;
    store.schedule.lastAdvancedAt = now;
  }

  function startTicker() {
    if (store.timer) return;
    store.running = true;
    store.timer = setInterval(() => {
      tick().catch((error) => {
        moduleLogger?.warn?.(`[ScheduledBroadcast] tick failed: ${error?.message ?? String(error)}`);
      });
    }, tickMs);

    tick().catch((error) => {
      moduleLogger?.warn?.(`[ScheduledBroadcast] first tick failed: ${error?.message ?? String(error)}`);
    });
  }

  function stopTicker() {
    if (!store.timer) return;
    clearInterval(store.timer);
    store.timer = null;
    store.running = false;
  }

  async function tick(now = Date.now()) {
    if (store.inTick) return;
    store.inTick = true;
    store.lastTickAt = now;

    try {
      reconcileSchedule({ now, resetTiming: false });
      const item = resolveScheduledItem();
      if (!item) return;
      if (Number(store.schedule.nextRunAt) > now) return;

      await runItem(item, {
        reason: "scheduled_tick",
        manual: false,
        now,
        system: true,
      });
    } finally {
      store.inTick = false;
    }
  }

  async function runItem(item, { reason = "scheduled_tick", manual = false, now = Date.now(), actor = null, system = false } = {}) {
    const message = sanitizeMessage(item.message);
    const shouldAdvance = !manual && item.enabled;

    let response;
    if (!message) {
      item.lastError = "Message is empty.";
      item.lastRunAt = now;
      item.lastResult = "failed";
      item.errorCount = Number(item.errorCount ?? 0) + 1;
      item.updatedAt = now;
      if (shouldAdvance) advanceScheduleAfterRun(item, now);
      await persist();
      return {
        success: false,
        errorMessage: item.lastError,
      };
    }

    try {
      const result = await dispatchBroadcast({
        message,
        sourceModule: "module.scheduledBroadcast",
        reason,
        actor,
        system,
      });

      if (!result?.success) {
        const errorMessage = String(result?.errorMessage ?? result?.message ?? "Broadcast command failed.");
        item.lastError = errorMessage;
        item.lastResult = "failed";
        item.errorCount = Number(item.errorCount ?? 0) + 1;
        item.lastRunAt = now;
        item.updatedAt = now;
        if (shouldAdvance) advanceScheduleAfterRun(item, now);
        await persist();
        return {
          success: false,
          errorMessage,
          result,
        };
      }

      item.lastError = "";
      item.lastResult = "success";
      item.lastRunAt = now;
      item.lastSuccessAt = now;
      item.runCount = Number(item.runCount ?? 0) + 1;
      item.updatedAt = now;
      if (shouldAdvance) advanceScheduleAfterRun(item, now);
      await persist();

      response = {
        success: true,
        result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      item.lastError = errorMessage;
      item.lastResult = "failed";
      item.errorCount = Number(item.errorCount ?? 0) + 1;
      item.lastRunAt = now;
      item.updatedAt = now;
      if (shouldAdvance) advanceScheduleAfterRun(item, now);
      await persist();
      response = {
        success: false,
        errorMessage,
      };
    }

    return response;
  }

  async function dispatchBroadcast({ message, sourceModule, reason, actor = null, system = false }) {
    const adminWarnApi = modules?.adminWarn;
    if (adminWarnApi?.broadcastMessage) {
      return await adminWarnApi.broadcastMessage({
        message,
        sourceModule,
        reason,
        actor,
        system,
      });
    }

    return await core.rconManager.dispatchCommand({
      command: `AdminBroadcast ${escapeCommandText(message)}`,
      requestedBy: sourceModule,
      reason,
      priority: "high",
      actor,
      system,
    });
  }

  async function load() {
    try {
      const raw = await fs.readFile(dataFile, "utf8");
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      const now = Date.now();

      store.items = items
        .map((item, index) => normalizeStoredItem(item, now, index))
        .filter(Boolean);

      reindexOrder(store.items);
      store.schedule = normalizeStoredSchedule(parsed?.schedule);
      reconcileSchedule({
        now,
        resetTiming: !Number.isFinite(store.schedule.nextRunAt),
        preferredItemId: store.schedule.nextItemId,
      });
    } catch (error) {
      if (error?.code !== "ENOENT") {
        moduleLogger?.warn?.(`[ScheduledBroadcast] load failed: ${error?.message ?? String(error)}`);
      }
      store.items = [];
      clearSchedule();
    }
  }

  async function persist() {
    const payload = {
      version: 2,
      updatedAt: Date.now(),
      schedule: cloneJson(store.schedule),
      items: getOrderedItems().map((item) => cloneJson(item)),
    };

    store.saveChain = store.saveChain
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(dataFile), { recursive: true });
        await fs.writeFile(dataFile, JSON.stringify(payload, null, 2), "utf8");
      });

    await store.saveChain;
  }
}

function normalizeNewItem(payload, now, index) {
  const intervalSeconds = clampNumber(payload.intervalSeconds, DEFAULT_INTERVAL_SECONDS, 5, 86400);
  const delaySeconds = clampNumber(payload.delaySeconds, DEFAULT_DELAY_SECONDS, 0, 86400);
  const enabled = Boolean(payload.enabled ?? false);
  return {
    id: makeItemId(now),
    title: "",
    message: sanitizeMessage(payload.message),
    intervalSeconds,
    delaySeconds,
    enabled,
    order: Number(index ?? 0),
    createdAt: now,
    updatedAt: now,
    nextRunAt: null,
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: "",
    lastResult: "idle",
    runCount: 0,
    errorCount: 0,
  };
}

function normalizeStoredItem(item, now, index) {
  if (!item || typeof item !== "object") return null;

  const enabled = Boolean(item.enabled ?? true);
  const intervalSeconds = clampNumber(item.intervalSeconds, DEFAULT_INTERVAL_SECONDS, 5, 86400);
  const delaySeconds = clampNumber(item.delaySeconds, DEFAULT_DELAY_SECONDS, 0, 86400);

  return {
    id: String(item.id ?? makeItemId(now)).trim() || makeItemId(now),
    title: sanitizeTitle(item.title),
    message: sanitizeMessage(item.message),
    intervalSeconds,
    delaySeconds,
    enabled,
    order: clampNumber(item.order, Number(index ?? 0), 0, 100000),
    createdAt: toFinite(item.createdAt) ?? now,
    updatedAt: toFinite(item.updatedAt) ?? now,
    nextRunAt: null,
    lastRunAt: toFinite(item.lastRunAt),
    lastSuccessAt: toFinite(item.lastSuccessAt),
    lastError: String(item.lastError ?? "").trim(),
    lastResult: normalizeResult(item.lastResult),
    runCount: clampNumber(item.runCount, 0, 0, Number.MAX_SAFE_INTEGER),
    errorCount: clampNumber(item.errorCount, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

function normalizeStoredSchedule(value) {
  return {
    nextItemId: optionalText(value?.nextItemId),
    nextRunAt: toFinite(value?.nextRunAt),
    lastAdvancedAt: toFinite(value?.lastAdvancedAt),
  };
}

function applyPatch(item, patch = {}) {
  if ("title" in patch) {
    item.title = sanitizeTitle(patch.title);
  }
  if ("message" in patch) {
    item.message = sanitizeMessage(patch.message);
  }
  if ("intervalSeconds" in patch) {
    item.intervalSeconds = clampNumber(patch.intervalSeconds, item.intervalSeconds, 5, 86400);
  }
  if ("delaySeconds" in patch) {
    item.delaySeconds = clampNumber(patch.delaySeconds, item.delaySeconds, 0, 86400);
  }
  if ("enabled" in patch) {
    item.enabled = Boolean(patch.enabled);
  }
}

function makeItemId(now = Date.now()) {
  return `sb_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeTitle(value) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 60);
}

function sanitizeMessage(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/"/g, "'")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

function normalizeResult(value) {
  const text = String(value ?? "idle").trim().toLowerCase();
  if (text === "success" || text === "failed" || text === "idle") return text;
  return "idle";
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function toFinite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function reindexOrder(items) {
  for (let index = 0; index < items.length; index += 1) {
    items[index].order = index;
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeCommandText(text) {
  return String(text ?? "")
    .replace(/"/g, "'")
    .replace(/\r\n?/g, "\n")
    .trim();
}
