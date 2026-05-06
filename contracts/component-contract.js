// -*- coding: utf-8 -*-

/**
 * BZSS Component Contract
 *
 * 这是约定文档式代码，不要求运行。
 *
 * Component 分三类：
 * - core
 * - module
 * - plugin
 */

/**
 * @typedef {"core" | "module" | "plugin"} ComponentKind
 */

/**
 * @typedef {"created" | "loading" | "loaded" | "starting" | "running" | "stopping" | "stopped" | "error"} ComponentStatus
 */

/**
 * @typedef {Object} ComponentManifest
 * @property {string} id
 * @property {string} name
 * @property {ComponentKind} kind
 * @property {string} version
 * @property {boolean=} enabled
 * @property {number=} priority
 * @property {string[]=} dependsOn
 * @property {string[]=} provides
 * @property {string[]=} capabilities
 * @property {string=} configKey
 * @property {boolean=} visibleToPlugins
 */

/**
 * @typedef {Object} Lifecycle
 * @property {() => (void | Promise<void>)=} init
 * @property {() => (void | Promise<void>)=} start
 * @property {() => (void | Promise<void>)=} stop
 * @property {() => (void | Promise<void>)=} dispose
 */
export {};
