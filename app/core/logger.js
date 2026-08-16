// -*- coding: utf-8 -*-

const ANSI = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  red: "\x1b[91m",
  green: "\x1b[92m",
  yellow: "\x1b[93m",
  cyan: "\x1b[96m",
  magenta: "\x1b[95m",
  blue: "\x1b[94m",
};

const LEVEL_WEIGHT = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_LABELS = {
  debug: "调试",
  info: "信息",
  warn: "警告",
  error: "错误",
};

const LEVEL_COLORS = {
  debug: ANSI.gray,
  info: ANSI.cyan,
  warn: ANSI.yellow,
  error: ANSI.red,
};

export class Logger {
  constructor(config = {}, root = null, bindings = {}) {
    this.root = root ?? this;
    this.bindings = { ...bindings };

    if (root) {
      return;
    }

    this.useColor = config.useColor ?? true;
    this.consoleLevel = normalizeLevel(config.consoleLevel ?? config.level ?? "info");
    this.captureLevel = normalizeLevel(config.captureLevel ?? "debug");
    this.subscribers = new Set();
    this.seq = 0;
  }

  child(bindings = {}) {
    return new Logger({}, this.root, {
      ...this.bindings,
      ...bindings,
    });
  }

  subscribe(listener, options = {}) {
    if (typeof listener !== "function") {
      return () => {};
    }

    const subscription = {
      listener,
      minLevel: normalizeLevel(options.minLevel ?? "debug"),
    };

    this.root.subscribers.add(subscription);
    return () => this.root.subscribers.delete(subscription);
  }

  isEnabled(level, options = {}) {
    const threshold = options.captureOnly
      ? this.root.captureLevel
      : options.consoleOnly
        ? this.root.consoleLevel
        : minLevel(this.root.captureLevel, this.root.consoleLevel);

    return getLevelWeight(level) >= getLevelWeight(threshold);
  }

  debug(message, context = {}) {
    return this.log("debug", message, context);
  }

  info(message, context = {}) {
    return this.log("info", message, context);
  }

  warn(message, context = {}) {
    return this.log("warn", message, context);
  }

  error(message, context = {}) {
    return this.log("error", message, context);
  }

  module(message, context = {}) {
    return this.log("info", message, {
      channel: "module",
      ...context,
      label: context.label ?? "MODULE",
    });
  }

  web(message, context = {}) {
    return this.log("info", message, {
      channel: "web",
      ...context,
      label: context.label ?? "WEB",
    });
  }

  event(message, context = {}) {
    return this.log("debug", message, {
      channel: "event",
      ...context,
      label: context.label ?? "EVENT",
    });
  }

  log(level, message, context = {}) {
    const normalizedLevel = normalizeLevel(level);
    if (!this.isEnabled(normalizedLevel)) {
      return null;
    }

    const mergedContext = mergeContext(this.bindings, context);
    const renderedMessage = materializeMessage(message, mergedContext);
    const entry = {
      seq: ++this.root.seq,
      time: new Date().toISOString(),
      level: normalizedLevel,
      label: String(mergedContext.label || DEFAULT_LABELS[normalizedLevel] || normalizedLevel).toUpperCase(),
      message: translateRuntimeMessage(renderedMessage),
      stream: String(mergedContext.stream ?? "app"),
      channel: String(mergedContext.channel ?? "app"),
      scope: deriveScope(mergedContext),
      source: String(mergedContext.source ?? mergedContext.moduleId ?? ""),
      moduleId: String(mergedContext.moduleId ?? ""),
      eventName: stringOrEmpty(mergedContext.eventName),
      operation: stringOrEmpty(mergedContext.operation),
      requestId: stringOrEmpty(mergedContext.requestId),
      tags: normalizeTags(mergedContext.tags),
      data: mergedContext.data && typeof mergedContext.data === "object" ? mergedContext.data : null,
    };

    if (this.root.shouldWriteConsole(normalizedLevel)) {
      writeConsole(this.root, entry);
    }

    if (this.root.shouldCapture(normalizedLevel)) {
      this.root.publish(entry);
    }

    return entry;
  }

  shouldWriteConsole(level) {
    return getLevelWeight(level) >= getLevelWeight(this.consoleLevel);
  }

  shouldCapture(level) {
    return getLevelWeight(level) >= getLevelWeight(this.captureLevel);
  }

  publish(entry) {
    for (const subscription of this.subscribers) {
      if (getLevelWeight(entry.level) < getLevelWeight(subscription.minLevel)) {
        continue;
      }

      try {
        subscription.listener(entry);
      } catch (error) {
        const message = error?.stack ?? error?.message ?? String(error);
        console.error(`[LOGGER] subscriber failed: ${message}`);
      }
    }
  }

  color(text, code) {
    return this.useColor ? `${code}${text}${ANSI.reset}` : text;
  }
}

function translateRuntimeMessage(message) {
  const source = String(message ?? "");
  const replacements = [
    [/\\bstarting\\.\\.?/gi, "正在启动。"],
    [/\\bstarted\\.\\.?/gi, "已启动。"],
    [/\\bstopping\\.\\.?/gi, "正在停止。"],
    [/\\bstopped\\.\\.?/gi, "已停止。"],
    [/\\bshutdown requested\\.?/gi, "收到停止请求。"],
    [/\\bfailed\\b/gi, "失败"],
    [/\\berror\\b/gi, "错误"],
    [/\\bwarning\\b/gi, "警告"],
    [/\\bconnected\\b/gi, "已连接"],
    [/\\bdisconnected\\b/gi, "已断开连接"],
    [/\\blistening\\b/gi, "正在监听"],
    [/\\bloaded\\b/gi, "已加载"],
    [/\\bloading\\b/gi, "正在加载"],
    [/\\benabled\\b/gi, "已启用"],
    [/\\bdisabled\\b/gi, "已禁用"],
    [/\\bskipped\\b/gi, "已跳过"],
    [/\\bnot found\\b/gi, "未找到"],
    [/\\btimeout\\b/gi, "超时"],
    [/\\bretrying\\b/gi, "正在重试"],
    [/\\bcompleted\\b/gi, "已完成"],
    [/\\brequest\\b/gi, "请求"],
    [/\\bresponse\\b/gi, "响应"],
  ];
  return replacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), source);
}

function writeConsole(logger, entry) {
  const levelColor = LEVEL_COLORS[entry.level] ?? ANSI.gray;
  const label = logger.color(`[${entry.label}]`, levelColor);
  const time = logger.color(entry.time, ANSI.gray);
  const scope = entry.scope ? logger.color(`[${entry.scope}]`, scopeColor(entry.scope)) : "";
  const suffix = formatConsoleSuffix(entry);
  const line = [label, time, scope, entry.message, suffix].filter(Boolean).join(" ");

  if (entry.level === "warn") {
    console.warn(line);
    return;
  }

  if (entry.level === "error") {
    console.error(line);
    return;
  }

  console.log(line);
}

function formatConsoleSuffix(entry) {
  const parts = [];
  if (entry.eventName) parts.push(`event=${entry.eventName}`);
  if (entry.operation) parts.push(`op=${entry.operation}`);
  if (entry.tags.length > 0) parts.push(`tags=${entry.tags.join(",")}`);
  return parts.length > 0 ? `(${parts.join(" ")})` : "";
}

function deriveScope(context) {
  if (context.scope) return String(context.scope);
  if (context.moduleId) return String(context.moduleId);
  if (context.source) return String(context.source);
  if (context.channel && context.channel !== "app") return String(context.channel);
  return "";
}

function mergeContext(bindings, context) {
  const next = {
    ...bindings,
    ...context,
  };

  if (bindings.tags || context.tags) {
    next.tags = [
      ...normalizeTags(bindings.tags),
      ...normalizeTags(context.tags),
    ];
  }

  return next;
}

function materializeMessage(message, context) {
  if (typeof message === "function") {
    return message(context);
  }

  return message;
}

function normalizeLevel(level) {
  const text = String(level ?? "info").trim().toLowerCase();
  if (text in LEVEL_WEIGHT) return text;
  return "info";
}

function getLevelWeight(level) {
  return LEVEL_WEIGHT[normalizeLevel(level)];
}

function minLevel(a, b) {
  return getLevelWeight(a) <= getLevelWeight(b) ? normalizeLevel(a) : normalizeLevel(b);
}

function scopeColor(scope) {
  if (scope.startsWith("module.")) return ANSI.magenta;
  if (scope.startsWith("plugin.")) return ANSI.green;
  if (scope.startsWith("core.web")) return ANSI.blue;
  if (scope.startsWith("core.event")) return ANSI.green;
  return ANSI.cyan;
}

function stringOrEmpty(value) {
  return value == null ? "" : String(value);
}

function normalizeTags(value) {
  if (!Array.isArray(value)) {
    if (value == null || value === "") return [];
    return [String(value)];
  }

  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}
