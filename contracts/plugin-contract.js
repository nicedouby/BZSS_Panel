// -*- coding: utf-8 -*-

/**
 * BZSS Plugin Contract
 *
 * Plugin 是具体玩法/规则扩展。
 *
 * Plugin 可以：
 * - 订阅 Module Event
 * - 调用 Module API
 * - 注册自己的 Web 页面
 *
 * Plugin 不应该：
 * - 直接调用 RCON
 * - 直接维护全局玩家状态
 * - 绕过 TeamBalance / Warning
 */

/**
 * 插件入口必须导出 createPlugin(context)
 *
 * @example
 * export function createPlugin({ core, modules }) {
 *   return {
 *     manifest: { id: "plugin.example", name: "Example Plugin", kind: "plugin", version: "0.1.0" },
 *     async start() {
 *       core.eventBus.onModuleEvent("module.killManage", "combatResolved", (event) => {});
 *     }
 *   };
 * }
 */
export {};
