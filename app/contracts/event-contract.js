// -*- coding: utf-8 -*-

/**
 * BZSS Event Contract
 *
 * Python RawGameEvent:
 * - 保留 Param1_xxx 格式
 *
 * JS NormalizedEvent:
 * - params 转为有序数组
 */

/**
 * @typedef {Object} EventParam
 * @property {number} index
 * @property {string} name
 * @property {string} value
 */

/**
 * @typedef {"core" | "module" | "plugin" | "audit"} EventLayer
 */

/**
 * @typedef {Object} NormalizedEvent
 * @property {string} eventId
 * @property {string} eventName
 * @property {EventLayer} layer
 * @property {string} source
 * @property {string} serverId
 * @property {string=} sessionId
 * @property {string=} seq
 * @property {string} time
 * @property {string=} logTime
 * @property {EventParam[]} params
 * @property {Object=} rawEvent
 * @property {string=} rawLog
 */
export {};
