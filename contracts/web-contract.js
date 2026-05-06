// -*- coding: utf-8 -*-

/**
 * BZSS Web Contract
 *
 * Web 被明确分成三块：
 *
 * 1. Web Shell
 *    顶栏、左栏、内容容器、弹窗、抽屉
 *
 * 2. Web Registry
 *    后端注册页面入口，前端通过 /api/web/pages 获取
 *
 * 3. Web Page
 *    单个页面模块，例如 match-status.js
 */

/**
 * @typedef {Object} WebPageDefinition
 * @property {string} id
 * @property {string} title
 * @property {string} group
 * @property {string} route
 * @property {string} pageModule
 * @property {string} source
 * @property {boolean} required
 * @property {boolean} enabled
 * @property {number} order
 * @property {string=} icon
 */

/**
 * @typedef {Object} WebStatusSnapshot
 * @property {string} serverId
 * @property {string} serverName
 * @property {string} pythonLogParser
 * @property {string} udpReceiver
 * @property {string} rcon
 * @property {string} currentLayer
 * @property {string} matchState
 * @property {number} playerCount
 * @property {number} team1Count
 * @property {number} team2Count
 * @property {number} squadCount
 * @property {number} recentErrors
 */
export {};
