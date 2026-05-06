// -*- coding: utf-8 -*-

/**
 * 配置读取模块。
 *
 * 这个模块只做一件事：
 * 从 JSON 文件读取配置，并解析成 JS 对象。
 *
 * 后续如果你要支持环境变量覆盖、多配置合并、开发/生产环境配置，
 * 都可以从这里扩展。
 */

import fs from "node:fs/promises";
import path from "node:path";

/**
 * 读取 JSON 配置文件。
 *
 * @param {string} configPath 配置文件路径
 * @returns {Promise<object>} 配置对象
 */
export async function loadConfig(configPath) {
  const absolutePath = path.resolve(process.cwd(), configPath);
  const text = await fs.readFile(absolutePath, "utf8");

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`配置文件 JSON 解析失败: ${absolutePath}\n${error.message}`);
  }
}
