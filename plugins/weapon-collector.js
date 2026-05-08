// -*- coding: utf-8 -*-

/**
 * Plugin: Weapon Collector
 *
 * 收集击杀、击倒、伤害事件中的武器信息。
 * - 去除虚幻引擎类对象标识符 (_Cxxx)
 * - 只保留武器类别
 */
export function createPlugin({ core, modules }) {
  const weaponStats = new Map(); // Map<serverId, weaponData>
  const unsubscribers = [];

  /**
   * 清理武器名称，去除 _Cxxx 内容
   * 例如：BP_Rifle_AR15_C_Cxxx -> BP_Rifle_AR15_C
   * @param {string} weaponName
   * @returns {string}
   */
  function cleanWeaponName(weaponName) {
    if (!weaponName) return null;
    // 移除 _Cxxx 模式（x 是十六进制数字）
    return weaponName.replace(/_C[0-9A-Fa-f]+$/, "");
  }

  /**
   * 从武器完整路径中提取武器类别
   * 例如：/Game/Weapons/Rifle/BP_Rifle_AR15_C -> AR15
   * @param {string} cleanedWeapon
   * @returns {string}
   */
  function extractWeaponCategory(cleanedWeapon) {
    if (!cleanedWeapon) return "Unknown";
    
    // 尝试从路径中提取最后一个有意义的部分
    const parts = cleanedWeapon.split("/");
    const lastPart = parts[parts.length - 1];
    
    // 移除常见前缀 BP_, WP_ 等
    const category = lastPart
      .replace(/^(BP_|WP_|BPC_|PC_)/, "")
      .replace(/_C$/, "");
    
    return category || "Unknown";
  }

  /**
   * 处理战斗事件
   */
  function handleCombatEvent(event) {
    const record = event.record;
    if (!record) return;

    const serverId = record.serverId;
    const weapon = record.weapon;
    const type = record.type; // "damaged", "wounded", "died"

    if (!weapon) return;

    // 初始化服务器的统计数据
    if (!weaponStats.has(serverId)) {
      weaponStats.set(serverId, new Map());
    }

    const serverStats = weaponStats.get(serverId);
    const cleanedWeapon = cleanWeaponName(weapon);
    const category = extractWeaponCategory(cleanedWeapon);

    // 初始化武器类别统计
    if (!serverStats.has(category)) {
      serverStats.set(category, {
        category,
        cleanedName: cleanedWeapon,
        rawName: weapon,
        damaged: 0,
        wounded: 0,
        died: 0,
        firstSeen: new Date(record.time),
        lastSeen: new Date(record.time),
      });
    }

    const weaponData = serverStats.get(category);

    // 更新统计数据
    if (type === "damaged") weaponData.damaged++;
    else if (type === "wounded") weaponData.wounded++;
    else if (type === "died") weaponData.died++;

    weaponData.lastSeen = new Date(record.time);
  }

  const api = {
    /**
     * 获取服务器的武器统计数据
     * @param {string} serverId
     * @returns {Array<Object>}
     */
    getWeaponStats(serverId) {
      const serverStats = weaponStats.get(serverId);
      if (!serverStats) return [];
      return Array.from(serverStats.values()).sort((a, b) => {
        // 按总数量排序
        const totalA = a.damaged + a.wounded + a.died;
        const totalB = b.damaged + b.wounded + b.died;
        return totalB - totalA;
      });
    },

    /**
     * 获取特定类别的武器统计
     * @param {string} serverId
     * @param {string} category
     * @returns {Object|null}
     */
    getWeaponStatsByCategory(serverId, category) {
      const serverStats = weaponStats.get(serverId);
      return serverStats ? serverStats.get(category) || null : null;
    },

    /**
     * 清空特定服务器的统计数据
     * @param {string} serverId
     */
    clearWeaponStats(serverId) {
      if (serverId) {
        weaponStats.delete(serverId);
      } else {
        weaponStats.clear();
      }
    },

    /**
     * 获取所有服务器的武器统计摘要
     * @returns {Object}
     */
    getAllWeaponStatsSummary() {
      const summary = {};
      for (const [serverId, stats] of weaponStats.entries()) {
        summary[serverId] = {
          totalWeapons: stats.size,
          weapons: Array.from(stats.values()),
        };
      }
      return summary;
    },
  };

  return {
    manifest: {
      id: "plugin.weaponCollector",
      name: "Weapon Collector Plugin",
      kind: "plugin",
      version: "0.1.0",
    },
    apiName: "weaponCollector",
    api,

    async start() {
      // 订阅击杀管理模块的战斗事件
      unsubscribers.push(
        core.eventBus.onModuleEvent("module.killManage", "combatResolved", (event) => {
          handleCombatEvent(event);
        })
      );

      core.logger.info("[WeaponCollector] Plugin started and listening to combat events");
    },

    async stop() {
      for (const unsubscriber of unsubscribers) {
        unsubscriber();
      }
      weaponStats.clear();
      core.logger.info("[WeaponCollector] Plugin stopped");
    },
  };
}
