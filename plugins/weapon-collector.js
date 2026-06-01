// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const DIRECT_WEAPON_TYPE_MAP = new Map([
  ["Soldiers_WPMC_Crewman_01", "Soldiers_WPMC_Crewman"],
  ["Soldiers_WPMC_HAT_02", "Soldiers_WPMC_HAT"],
  ["Soldiers_WPMC_Medic_01", "Soldiers_WPMC_Medic"],
  ["Soldiers_WPMC_Medic_02", "Soldiers_WPMC_Medic"],
  ["Soldiers_WPMC_Sapper_01", "Soldiers_WPMC_Sapper"],
  ["Soldiers_WPMC_SL_01", "Soldiers_WPMC_SL"],
  ["Soldiers_WPMC_SL_04", "Soldiers_WPMC_SL"],
  ["T90A_Desert", "T90A"],
  ["BTR82A_RUS_Desert", "BTR82A_RUS"],
]);

const TRAILING_ATTACHMENT_TOKENS = new Set([
  "1P78",
  "ACOG",
  "Bipod",
  "C79A2",
  "Drum",
  "ET552",
  "Foregrip",
  "Grippod",
  "Holo",
  "Ironsights",
  "M150",
  "M68",
  "OKP-7",
  "Optic",
  "Scope",
  "Sight",
  "Specter",
  "Suppressor",
  "SuppressorSD",
  "VerticalGrip",
]);

const TRAILING_ENVIRONMENT_TOKENS = new Set([
  "Arid",
  "Black",
  "Blue",
  "Brown",
  "Desert",
  "Forest",
  "Green",
  "Red",
  "Tan",
  "White",
  "Winter",
  "Woodland",
  "Yellow",
]);

const TRAILING_STATE_TOKENS = new Set([
  "Ammocook",
  "Burn",
  "Burned",
  "Burning",
  "Crash",
  "Destroy",
  "Destroyed",
  "Knockedout",
  "destroyed",
  "obliterate",
]);

const WEAPON_TRAILING_TOKENS = new Set([
  ...TRAILING_ATTACHMENT_TOKENS,
  ...TRAILING_ENVIRONMENT_TOKENS,
]);

const VEHICLE_OR_SOLDIER_TRAILING_TOKENS = new Set([
  ...TRAILING_ENVIRONMENT_TOKENS,
  ...TRAILING_STATE_TOKENS,
]);

/**
 * Plugin: Weapon Collector
 *
 * 收集击杀、击倒、伤害事件中的武器信息，并将原始对象名统一映射为可统计的武器类型。
 * - 自动移除 UE 实例后缀（_Cxxx / _C_<number>）
 * - 使用显式 Map + 规则归一化，把同类武器并到同一个类别
 * - 记录 rawCategory -> canonicalCategory 的映射，供后续伤害显示/统计复用
 * - 持久化到单个 JSON 文件
 */
export function createPlugin({ core, modules }) {
  const weaponStats = new Map(); // Map<serverId, Map<canonicalCategory, weaponData>>
  const weaponTypeMap = new Map(); // Map<rawCategory, canonicalCategory>
  const classificationCache = new Map(); // Map<rawCategory, classification>
  const unsubscribers = [];
  const dataFile = path.resolve(process.cwd(), "data/weapon-stats.json");
  let persistTimer = null;

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistState().catch((err) => {
        core.logger.warn(`[WeaponCollector] persist failed: ${err.message}`);
      });
    }, 2000);
  }

  async function persistState() {
    const data = {};
    for (const [serverId, serverStats] of weaponStats.entries()) {
      data[serverId] = {};
      for (const [category, entry] of serverStats.entries()) {
        data[serverId][category] = {
          ...entry,
          aliases: normalizeAliases(entry.aliases, entry.rawCategory, entry.rawName),
          firstSeen: serializeDate(entry.firstSeen),
          lastSeen: serializeDate(entry.lastSeen),
        };
      }
    }

    const payload = {
      updatedAt: new Date().toISOString(),
      servers: data,
      weaponTypeMap: Object.fromEntries([...weaponTypeMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    };

    await fs.mkdir(path.dirname(dataFile), { recursive: true });
    const tmp = `${dataFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await fs.rename(tmp, dataFile);
  }

  async function loadState() {
    try {
      const text = await fs.readFile(dataFile, "utf8");
      const parsed = JSON.parse(text);
      const servers = parsed?.servers ?? {};
      let migrated = false;

      for (const [rawCategory, canonicalCategory] of Object.entries(parsed?.weaponTypeMap ?? {})) {
        weaponTypeMap.set(rawCategory, canonicalCategory);
      }

      for (const [serverId, serverData] of Object.entries(servers)) {
        const serverMap = new Map();
        for (const [category, entry] of Object.entries(serverData)) {
          const rawName = entry.rawName || entry.cleanedName || entry.category || category;
          const cleanedName = cleanWeaponName(entry.cleanedName || rawName || category);
          const rawCategory = extractWeaponCategory(cleanedName);
          const classified = classifyWeapon(cleanedName);
          const normalizedCategory = classified.category || entry.category || category;
          const aliases = normalizeAliases(
            entry.aliases,
            entry.rawCategory,
            rawCategory,
            rawName,
            category,
            entry.category,
          );

          for (const alias of aliases) {
            weaponTypeMap.set(alias, normalizedCategory);
          }

          const normalizedEntry = {
            ...entry,
            ...classified,
            category: normalizedCategory,
            cleanedName,
            rawName,
            rawCategory,
            aliases,
            damaged: entry.damaged ?? 0,
            wounded: entry.wounded ?? 0,
            died: entry.died ?? 0,
            firstSeen: parseStoredDate(entry.firstSeen),
            lastSeen: parseStoredDate(entry.lastSeen),
          };

          if (
            normalizedCategory !== category
            || cleanedName !== entry.cleanedName
            || aliases.length !== (entry.aliases?.length ?? 0)
          ) {
            migrated = true;
          }

          if (serverMap.has(normalizedCategory)) {
            migrated = true;
            const existing = serverMap.get(normalizedCategory);
            mergeEntry(existing, normalizedEntry);
            continue;
          }

          serverMap.set(normalizedCategory, normalizedEntry);
        }
        weaponStats.set(serverId, serverMap);
      }
      return migrated;
    } catch (err) {
      if (err.code !== "ENOENT") {
        core.logger.warn(`[WeaponCollector] load state failed: ${err.message}`);
      }
      return false;
    }
  }

  function parseStoredDate(value) {
    return safeEventDate(value);
  }

  function minDate(left, right) {
    return left <= right ? left : right;
  }

  function maxDate(left, right) {
    return left >= right ? left : right;
  }

  function mergeEntry(target, source) {
    target.damaged += source.damaged ?? 0;
    target.wounded += source.wounded ?? 0;
    target.died += source.died ?? 0;
    target.aliases = normalizeAliases(target.aliases, source.aliases, source.rawCategory, source.rawName);
    target.firstSeen = minDate(target.firstSeen, source.firstSeen);
    target.lastSeen = maxDate(target.lastSeen, source.lastSeen);
  }

  function cleanWeaponName(weaponName) {
    if (!weaponName) return null;
    return String(weaponName)
      .replace(/_C_(?:\d+|[0-9A-Fa-f]+)$/, "_C");
  }

  function normalizeAliases(...values) {
    return [...new Set(
      values
        .flat()
        .map((value) => extractWeaponCategory(cleanWeaponName(value)))
        .filter((value) => value && value !== "Unknown"),
    )];
  }

  function extractWeaponCategory(cleanedWeapon) {
    if (!cleanedWeapon) return "Unknown";

    const parts = String(cleanedWeapon).split("/");
    const lastPart = parts[parts.length - 1];

    const category = lastPart
      .replace(/^(BP_|WP_|BPC_|PC_)/, "")
      .replace(/_C$/, "");

    return category || "Unknown";
  }

  function popTrailingTokens(parts, allowedTokens) {
    while (parts.length > 1) {
      const last = parts[parts.length - 1];
      if (/^\d+$/.test(last) || allowedTokens.has(last)) {
        parts.pop();
        continue;
      }
      break;
    }
    return parts;
  }

  function normalizeVehicleOrSoldierCategory(rawCategory) {
    const parts = String(rawCategory).split("_").filter(Boolean);
    return popTrailingTokens(parts, VEHICLE_OR_SOLDIER_TRAILING_TOKENS).join("_") || rawCategory;
  }

  function normalizeWeaponCategory(rawCategory) {
    const parts = String(rawCategory).split("_").filter(Boolean);
    return popTrailingTokens(parts, WEAPON_TRAILING_TOKENS).join("_") || rawCategory;
  }

  function toCanonicalWeaponCategory(rawCategory) {
    if (!rawCategory) return "Unknown";

    if (DIRECT_WEAPON_TYPE_MAP.has(rawCategory)) {
      return DIRECT_WEAPON_TYPE_MAP.get(rawCategory);
    }

    if (/^(Soldier|Soldiers)_/i.test(rawCategory)) {
      return normalizeVehicleOrSoldierCategory(rawCategory);
    }

    if (/^(Projectile|Proj\d*$|40MM$)/i.test(rawCategory) || /Frag$/i.test(rawCategory)) {
      return normalizeWeaponCategory(rawCategory);
    }

    if (/_Knockedout(_|$)/i.test(rawCategory)) {
      return rawCategory.replace(/_Knockedout(_.*)?$/i, "") || rawCategory;
    }

    if (/(Destroy|Destroyed|destroyed|Crash|Burn|Burned|Burning|Ammocook|obliterate)/.test(rawCategory)) {
      return normalizeVehicleOrSoldierCategory(rawCategory);
    }

    if (/_(Desert|Woodland|Arid|Forest|Green|Tan|Winter|Black|Blue|Red|White|Yellow|Brown)(_|$)/.test(rawCategory)) {
      return normalizeVehicleOrSoldierCategory(rawCategory);
    }

    return normalizeWeaponCategory(rawCategory);
  }

  function buildClassification(category, sourceType = "weapon", rawCategory = category) {
    const parts = category.split("_").filter(Boolean);
    const mainCategory = parts[0] || "Unknown";
    const subCategory = parts.slice(1).join("_") || "Default";

    return {
      category,
      rawCategory,
      mainCategory,
      subCategory,
      displayName: `${mainCategory} / ${subCategory}`,
      sourceType,
    };
  }

  function safeEventDate(value, fallback = new Date()) {
    const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }

    const fallbackDate = fallback instanceof Date ? new Date(fallback.getTime()) : new Date(fallback);
    return Number.isNaN(fallbackDate.getTime()) ? new Date() : fallbackDate;
  }

  function serializeDate(value, fallback = new Date()) {
    return safeEventDate(value, fallback).toISOString();
  }

  function inferSourceType(rawCategory) {
    if (!rawCategory) return "weapon";

    if (/^(Soldier|Soldiers)_/i.test(rawCategory)) {
      return "soldier";
    }

    if (/^(Projectile|Proj\d*$|40MM$)/i.test(rawCategory) || /Frag$/i.test(rawCategory)) {
      return "projectile";
    }

    if (/^(PMV_(RWS|Mag58x3)(_|$)|CH146_CAS($|_))/i.test(rawCategory)) {
      return "vehicle_weapon";
    }

    if (DIRECT_WEAPON_TYPE_MAP.has(rawCategory)) {
      return "vehicle";
    }

    if (/_Knockedout(_|$)/i.test(rawCategory)) {
      return "vehicle";
    }

    if (/(Destroy|Destroyed|destroyed|Crash|Burn|Burned|Burning|Ammocook|obliterate)/.test(rawCategory)) {
      return "vehicle";
    }

    if (/_(Desert|Woodland|Arid|Forest|Green|Tan|Winter|Black|Blue|Red|White|Yellow|Brown)(_|$)/.test(rawCategory)) {
      return "vehicle";
    }

    return "weapon";
  }

  function classifyWeapon(cleanedWeapon) {
    const rawCategory = extractWeaponCategory(cleanedWeapon);
    const cached = classificationCache.get(rawCategory);
    if (cached) {
      weaponTypeMap.set(rawCategory, cached.category);
      return cached;
    }

    const category = toCanonicalWeaponCategory(rawCategory);
    const sourceType = inferSourceType(rawCategory);
    weaponTypeMap.set(rawCategory, category);

    let classification;
    if (category.startsWith("Soldier_")) {
      const subCategory = category.replace(/^Soldier_/, "") || "Default";
      classification = {
        category,
        rawCategory,
        mainCategory: "Soldier",
        subCategory,
        displayName: `Soldier / ${subCategory}`,
        sourceType: "soldier",
      };
      classificationCache.set(rawCategory, classification);
      return classification;
    }

    if (category.startsWith("Soldiers_")) {
      const subCategory = category.replace(/^Soldiers_/, "") || "Default";
      classification = {
        category,
        rawCategory,
        mainCategory: "Soldiers",
        subCategory,
        displayName: `Soldiers / ${subCategory}`,
        sourceType: "soldier",
      };
      classificationCache.set(rawCategory, classification);
      return classification;
    }

    if (category === "InfantryRazorwire") {
      classification = {
        category,
        rawCategory,
        mainCategory: "Deployable",
        subCategory: "InfantryRazorwire",
        displayName: "Deployable / InfantryRazorwire",
        sourceType: "deployable",
      };
      classificationCache.set(rawCategory, classification);
      return classification;
    }

    classification = buildClassification(category, sourceType, rawCategory);
    classificationCache.set(rawCategory, classification);
    return classification;
  }

  function getEntryTotal(entry) {
    return (entry.damaged ?? 0) + (entry.wounded ?? 0) + (entry.died ?? 0);
  }

  function handleCombatEvent(event) {
    if (!isSubscribed()) return;

    const record = event.record;
    if (!record) return;

    const serverId = record.serverId;
    const weapon = record.weapon;
    const type = record.type;

    if (!weapon) return;

    if (!weaponStats.has(serverId)) {
      weaponStats.set(serverId, new Map());
    }

    const serverStats = weaponStats.get(serverId);
    const cleanedWeapon = cleanWeaponName(weapon);
    const classified = classifyWeapon(cleanedWeapon);
    const category = classified.category;
    const rawCategory = classified.rawCategory || extractWeaponCategory(cleanedWeapon);
    const eventDate = safeEventDate(record.time);

    if (!serverStats.has(category)) {
      serverStats.set(category, {
        ...classified,
        cleanedName: cleanedWeapon,
        rawName: weapon,
        rawCategory,
        aliases: normalizeAliases(rawCategory, weapon),
        damaged: 0,
        wounded: 0,
        died: 0,
        firstSeen: eventDate,
        lastSeen: eventDate,
      });
    }

    const weaponData = serverStats.get(category);
    weaponData.aliases = normalizeAliases(weaponData.aliases, rawCategory, weapon);

    if (type === "damaged") weaponData.damaged++;
    else if (type === "wounded") weaponData.wounded++;
    else if (type === "died") weaponData.died++;

    weaponData.lastSeen = eventDate;
    schedulePersist();
  }

  function groupWeaponStats(serverStats) {
    const groups = new Map();

    for (const entry of serverStats.values()) {
      const classified = classifyWeapon(entry.cleanedName || entry.rawName || entry.category);
      const mainCategory = entry.mainCategory || classified.mainCategory;
      const subCategory = entry.subCategory || classified.subCategory;
      const sourceType = entry.sourceType || classified.sourceType;
      const damaged = entry.damaged ?? 0;
      const wounded = entry.wounded ?? 0;
      const died = entry.died ?? 0;
      const total = damaged + wounded + died;

      if (!groups.has(mainCategory)) {
        groups.set(mainCategory, {
          mainCategory,
          sourceType,
          damaged: 0,
          wounded: 0,
          died: 0,
          total: 0,
          variants: [],
        });
      }

      const group = groups.get(mainCategory);
      group.damaged += damaged;
      group.wounded += wounded;
      group.died += died;
      group.total += total;
      group.variants.push({
        category: entry.category || classified.category,
        aliases: entry.aliases || [],
        subCategory,
        damaged,
        wounded,
        died,
        total,
      });
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        variants: group.variants.sort((a, b) => b.total - a.total),
      }))
      .sort((a, b) => b.total - a.total);
  }

  const api = {
    getWeaponStats(serverId) {
      const serverStats = weaponStats.get(serverId);
      if (!serverStats) return [];
      return Array.from(serverStats.values()).sort((a, b) => getEntryTotal(b) - getEntryTotal(a));
    },

    getWeaponStatsGrouped(serverId) {
      const serverStats = weaponStats.get(serverId);
      if (!serverStats) return [];
      return groupWeaponStats(serverStats);
    },

    getAllWeaponStats() {
      const result = {};
      for (const [serverId, serverStats] of weaponStats.entries()) {
        result[serverId] = Array.from(serverStats.values()).sort((a, b) => getEntryTotal(b) - getEntryTotal(a));
      }
      return result;
    },

    getWeaponTypeMap() {
      return Object.fromEntries([...weaponTypeMap.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    },

    async clearWeaponStats(serverId) {
      if (serverId) {
        weaponStats.delete(serverId);
      } else {
        weaponStats.clear();
        weaponTypeMap.clear();
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
      version: "0.3.0",
      description: "武器收集插件。订阅 module.killManage 发出的 combatResolved 事件，把原始武器对象统一映射为可标记的武器类型，归并伤害/击倒/击杀次数，并持久化到本地 JSON 文件。",
    },
    apiName: "weaponCollector",
    api,

    async start() {
      const migrated = await loadState();
      if (migrated) {
        await persistState();
        core.logger.info("[WeaponCollector] Persisted normalized weapon stats state");
      }

      core.webRegistry?.registerPage({
        id: "web.weaponCollector",
        title: "武器统计",
        group: "插件",
        route: "/weapon-collector",
        pageModule: "/pages/weapon-collector.js",
        source: "plugin.weaponCollector",
        description: "武器使用统计页面。展示统一归类后的武器伤害、击倒、击杀次数。",
        required: false,
        enabled: true,
        order: 500,
        icon: "🎯",
      });

      unsubscribers.push(
        core.eventBus.onModuleEvent("module.combatManager", "KILL_MANAGER_EVENT", (event) => {
          handleCombatEvent(event);
        }),
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
      weaponTypeMap.clear();
      core.logger.info("[WeaponCollector] Plugin stopped");
    },
  };
}
