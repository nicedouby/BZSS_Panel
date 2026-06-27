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
 * @typedef {Object} PlayerRealtimeContract
 * @property {"玩家实况"} name
 * @property {"match-status"} sourcePage
 * @property {"点击小队列表中的玩家名字"} openTrigger
 * @property {boolean} supportsSteamIdCopy
 * @property {boolean} supportsEosIdCopy
 * @property {boolean} supportsNavigateToPlayerDatabase
 *
 * 约定：
 * - “对局状态”页中，点击小队列表里的玩家名字，打开的窗口统一命名为“玩家实况”。
 * - “玩家实况”至少展示 Steam ID、EOS ID、Player ID、Team、Squad、角色、状态与实时 K/击倒/死亡。
 * - “玩家实况”中的 Steam ID 与 EOS ID 可直接点击复制，并给出复制提示。
 * - “玩家实况”提供跳转到“玩家数据库”的入口，并尽量定位到该玩家的档案视图。
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
