// -*- coding: utf-8 -*-

/**
 * 轻量日志器。
 *
 * 这里只负责控制台输出。
 * 后续如果你想写入文件、接入 pino、接入 Web 控制台，可以替换这个模块。
 */

const ANSI = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  red: "\x1b[91m",
  green: "\x1b[92m",
  yellow: "\x1b[93m",
  blue: "\x1b[94m",
  magenta: "\x1b[95m",
  cyan: "\x1b[96m",
};

/**
 * 创建日志器。
 *
 * @param {object} options
 * @param {boolean} options.useColor 是否启用 ANSI 颜色
 */
export function createLogger(options = {}) {
  const useColor = options.useColor ?? true;

  function color(text, c) {
    if (!useColor) return text;
    return `${c}${text}${ANSI.reset}`;
  }

  function time() {
    return new Date().toISOString();
  }

  return {
    info(message) {
      console.log(`${color("[INFO]", ANSI.cyan)} ${color(time(), ANSI.gray)} ${message}`);
    },

    warn(message) {
      console.warn(`${color("[WARN]", ANSI.yellow)} ${color(time(), ANSI.gray)} ${message}`);
    },

    error(message) {
      console.error(`${color("[ERROR]", ANSI.red)} ${color(time(), ANSI.gray)} ${message}`);
    },

    event(message, eventName = "") {
      let eventColor = ANSI.blue;
      if (eventName === "On_PlayerDamaged") eventColor = ANSI.yellow;
      if (eventName === "On_PlayerWounded") eventColor = ANSI.red;
      if (eventName === "On_PlayerDied") eventColor = ANSI.magenta;
      if (eventName === "On_PlayerSpawnRequested") eventColor = ANSI.cyan;
      if (eventName === "On_SquadCreated") eventColor = ANSI.green;
      console.log(`${color("[EVENT]", eventColor)} ${message}`);
    },
  };
}
