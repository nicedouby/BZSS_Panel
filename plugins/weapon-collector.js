// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

/**
 * Plugin: Weapon Collector
 *
 * 收集击杀、击倒、伤害事件中的武器信息。
 * - 去除虚幻引擎类对象标识符 (_Cxxx)
 * - 只保留武器类别
 * - 持久化到单个 JSON 文件
 */
export function createPlugin({ core, modules }) {
  const weaponStats = new Map(); // Map<serverId, Map<category, weaponData>>
  const unsubscribers = [];
  const dataFile = path.resolve(process.cwd(), "data/weapon-stats.json");
  let persistTimer = null;

  /**
   * 防抖写入文件
   */
  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistState().catch((err) => {
        core.logger.warn(`[WeaponCollector] persist failed: ${err.message}`);
      });
    }, 2000);
  }

  /**
   * 将内存状态写入 JSON 文件（原子写入）
   */
  async function persistState() {
    const data = {};
    for (const [serverId, serverStats] of weaponStats.entries()) {
      data[serverId] = {};
      for (const [category, entry] of serverStats.entries()) {
        data[serverId][category] = {
          ...entry,
          firstSeen: entry.firstSeen instanceof Date ? entry.firstSeen.toISOString() : entry.firstSeen,
          lastSeen: entry.lastSeen instanceof Date ? entry.lastSeen.toISOString() : entry.lastSeen,
        };
      }
    }

    const payload = { updatedAt: new Date().toISOString(), servers: data };
    await fs.mkdir(path.dirname(dataFile), { recursive: true });
    const tmp = `${dataFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await fs.rename(tmp, dataFile);
  }

  /**
   * 从文件加载已有统计
   */
  async function loadState() {
    try {
      const text = await fs.readFile(dataFile, "utf8");
      const parsed = JSON.parse(text);
      const servers = parsed?.servers ?? {};
      for (const [serverId, serverData] of Object.entries(servers)) {
        const serverMap = new Map();
        for (const [category, entry] of Object.entries(serverData)) {
          serverMap.set(category, {
            ...entry,
            firstSeen: new Date(entry.firstSeen),
            lastSeen: new Date(entry.lastSeen),
          });
        }
        weaponStats.set(serverId, serverMap);
      }
    } catch (err) {
      if (err.code !== "ENOENT") {
        core.logger.warn(`[WeaponCollector] load state failed: ${err.message}`);
      }
    }
  }

  /**
   * 清理武器名称，去除 _Cxxx 内容
   * 例如：BP_Rifle_AR15_C_Cxxx -> BP_Rifle_AR15_C
   * @param {string} weaponName
   * @returns {string}
   */
  function cleanWeaponName(weaponName) {
    if (!weaponName) return null;
    // 移除实例后缀：_C_<数字> → _C，或旧格式 _C<hex> → 去掉
    return weaponName
      .replace(/_C_\d+$/, "_C")          // EF88_..._C_2147039011 → EF88_..._C
      .replace(/_C[0-9A-Fa-f]+$/, "");   // 兜底：BP_..._C1a2b3c → BP_..._
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
    if (!isSubscribed()) return;

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
    schedulePersist();
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
     * 获取所有服务器的武器统计数据
     * @returns {Object}
     */
    getAllWeaponStats() {
      const result = {};
      for (const [serverId, serverStats] of weaponStats.entries()) {
        result[serverId] = Array.from(serverStats.values()).sort((a, b) => {
          const totalA = a.damaged + a.wounded + a.died;
          const totalB = b.damaged + b.wounded + b.died;
          return totalB - totalA;
        });
      }
      return result;
    },

    /**
     * 清空特定服务器的统计数据并持久化
     * @param {string} [serverId]
     */
    async clearWeaponStats(serverId) {
      if (serverId) {
        weaponStats.delete(serverId);
      } else {
        weaponStats.clear();
      }
      await persistState();
    },
  };

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.("plugin.weaponCollector") !== false
      && core.pluginSubscriptions?.isSubscribed?.("plugin.weaponCollector") !== false;
  }

  return {
    manifest: {
      id: "plugin.weaponCollector",
      name: "Weapon Collector Plugin",
      kind: "plugin",
      version: "0.2.0",
      description: "武器收集插件。订阅 module.killManage 发出的 combatResolved 事件，从击伤、击倒、击杀记录中提取武器名称，自动去除虚幻引擎类对象后缀（_Cxxx），按武器类别归类统计各类型事件的触发次数，持久化到单个 JSON 文件，供后续武器使用分析和战斗报告使用。",
    },
    apiName: "weaponCollector",
    api,

    async start() {
      await loadState();

      // 注册 Web 页面
      core.webRegistry?.registerPage({
        id: "web.weaponCollector",
        title: "武器统计",
        group: "插件",
        route: "/weapon-collector",
        pageModule: "/pages/weapon-collector.js",
        source: "plugin.weaponCollector",
        description: "武器使用统计页面。展示各武器的伤害、击倒、击杀次数，数据来自 plugin.weaponCollector，持久化到本地文件。",
        required: false,
        enabled: true,
        order: 500,
        icon: "🔫",
      });

      // 订阅击杀管理模块的战斗事件
      unsubscribers.push(
        core.eventBus.onModuleEvent("module.killManage", "combatResolved", (event) => {
          handleCombatEvent(event);
        })
      );

      core.logger.info("[WeaponCollector] Plugin started and listening to combat events");
    },

    async stop() {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
        await persistState().catch(() => {});
      }
      for (const unsubscriber of unsubscribers) {
        unsubscriber();
      }
      weaponStats.clear();
      core.logger.info("[WeaponCollector] Plugin stopped");
    },
  };
}
