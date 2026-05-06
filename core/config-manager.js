// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

/**
 * Core: ConfigManager
 *
 * 负责读取配置和按点路径查询配置。
 */
export class ConfigManager {
  constructor(configPath) {
    this.configPath = path.resolve(process.cwd(), configPath);
    this.config = {};
  }

  async load() {
    const text = await fs.readFile(this.configPath, "utf8");
    this.config = JSON.parse(text);
  }

  get(pathText, defaultValue = undefined) {
    if (!pathText) return this.config;

    const parts = pathText.split(".");
    let current = this.config;

    for (const part of parts) {
      if (current == null || typeof current !== "object" || !(part in current)) {
        return defaultValue;
      }
      current = current[part];
    }

    return current;
  }
}
