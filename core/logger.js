// -*- coding: utf-8 -*-

/**
 * Core: Logger
 *
 * 统一日志出口。
 */
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

export class Logger {
  constructor(config = {}) {
    this.useColor = config.useColor ?? true;
  }

  color(text, code) {
    return this.useColor ? `${code}${text}${ANSI.reset}` : text;
  }

  time() {
    return this.color(new Date().toISOString(), ANSI.gray);
  }

  info(message) {
    console.log(`${this.color("[INFO]", ANSI.cyan)} ${this.time()} ${message}`);
  }

  warn(message) {
    console.warn(`${this.color("[WARN]", ANSI.yellow)} ${this.time()} ${message}`);
  }

  error(message) {
    console.error(`${this.color("[ERROR]", ANSI.red)} ${this.time()} ${message}`);
  }

  module(message) {
    console.log(`${this.color("[MODULE]", ANSI.magenta)} ${this.time()} ${message}`);
  }

  web(message) {
    console.log(`${this.color("[WEB]", ANSI.blue)} ${this.time()} ${message}`);
  }

  event(message) {
    console.log(`${this.color("[EVENT]", ANSI.green)} ${this.time()} ${message}`);
  }
}
