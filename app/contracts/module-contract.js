// -*- coding: utf-8 -*-

/**
 * BZSS Module Contract
 *
 * Module 是看不见的业务能力层。
 *
 * Module 可以：
 * - 订阅 Core Event
 * - 发布 Module Event
 * - 维护状态
 * - 给 Plugin 暴露 API
 *
 * Module 不应该：
 * - 依赖 Plugin
 */

/**
 * @typedef {Object} ModuleInstance
 * @property {Object} manifest
 * @property {string} apiName
 * @property {Object} api
 * @property {Function=} init
 * @property {Function=} start
 * @property {Function=} stop
 */
export {};
