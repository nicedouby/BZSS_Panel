// -*- coding: utf-8 -*-

import { MAP_PRESSURE_RULES, TEMPORARY_SHRINK_RULES, resolvePressureRule } from "./rules.js";

const MODULE_ID = "module.pressureZoneRules";

export function createPressureZoneRulesModule({ core, modules, config, logger } = {}) {
  const moduleLogger = logger ?? core?.createLogger?.({ moduleId: MODULE_ID, source: MODULE_ID, channel: "module" }) ?? core?.logger ?? console;
  const moduleConfig = config?.get?.("modules.pressureZoneRules", {}) ?? {};
  const state = {
    enabled: moduleConfig.enabled !== false,
    map: "",
    mapKey: "",
    rule: null,
    announcement: "",
    updatedAt: "",
    lastBroadcastAt: "",
    lastBroadcastSuccess: null,
    lastError: "",
  };
  let unsubscribe = null;
  let lastMapIdentity = "";

  function clone(value) {
    if (value == null) return value;
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  }

  function getState() {
    return clone({ ...state, mapRules: MAP_PRESSURE_RULES, temporaryShrinkRules: TEMPORARY_SHRINK_RULES });
  }

  function buildAnnouncement(rule, mapName) {
    if (!rule) return `[压家圈服规] 当前地图：${mapName || "未知地图"}。暂未配置明确压家圈规则，请以管理员公告为准。`;
    return [
      "[压家圈服规]",
      `当前地图：${mapName}`,
      `明确压家圈：以一方主基地为中心，向外衍生 ${rule.fullCount ? `${rule.fullCount} 个完整 FOB 圈` : ""}${rule.innerCount ? `+${rule.innerCount} 个 FOB 内圈` : ""}。`,
      "交战位于一方压家圈内时，按点位位置逐级减少压家圈层级。",
      "详细规则可在面板“压家圈服规”页面查看。",
    ].filter(Boolean).join("\\n");
  }

  async function broadcast(message = state.announcement) {
    if (!state.enabled || !message) return { success: false, skipped: true, reason: "disabled-or-empty" };
    const broadcastApi = modules?.adminWarn?.broadcastMessage ?? modules?.adminWarn?.sendAdminBroadcast;
    if (typeof broadcastApi !== "function") return { success: false, skipped: true, reason: "broadcast-api-unavailable" };
    try {
      const result = await broadcastApi({
        message,
        sourceModule: MODULE_ID,
        reason: "pressure-zone-rule-map-change",
        system: true,
        record: false,
      });
      state.lastBroadcastAt = new Date().toISOString();
      state.lastBroadcastSuccess = Boolean(result?.success);
      state.lastError = result?.success ? "" : String(result?.errorMessage ?? result?.skipReason ?? "广播失败");
      return result;
    } catch (error) {
      state.lastBroadcastSuccess = false;
      state.lastError = error?.message ?? String(error);
      moduleLogger.warn?.(`[PressureZoneRules] 广播失败：${state.lastError}`);
      return { success: false, error: state.lastError };
    }
  }

  async function refresh(snapshot = null, { broadcastOnChange = true } = {}) {
    const source = snapshot ?? await modules?.tacticalState?.getSnapshot?.() ?? {};
    const mapName = String(source?.server?.map ?? source?.server?.layer ?? source?.match?.map ?? source?.match?.layer ?? "").trim();
    const rule = resolvePressureRule(mapName);
    const identity = `${mapName}|${rule?.id ?? "unknown"}`;
    if (identity === lastMapIdentity && state.rule) return getState();
    lastMapIdentity = identity;
    state.map = mapName;
    state.mapKey = rule?.id ?? "";
    state.rule = rule ? clone(rule) : null;
    state.announcement = buildAnnouncement(rule, mapName);
    state.updatedAt = new Date().toISOString();
    if (broadcastOnChange && mapName) await broadcast();
    return getState();
  }

  return {
    manifest: {
      id: MODULE_ID,
      name: "Pressure Zone Rules",
      kind: "module",
      version: "1.0.0",
      description: "按当前地图识别并广播明确压家圈服规。",
    },
    apiName: "pressureZoneRules",
    api: { getState, refresh, broadcast },
    async init() {},
    async start() {
      unsubscribe = modules?.tacticalState?.subscribe?.((snapshot) => {
        void refresh(snapshot).catch((error) => moduleLogger.warn?.(`[PressureZoneRules] 刷新失败：${error?.message ?? error}`));
      }) ?? null;
      await refresh(null, { broadcastOnChange: false });
    },
    async stop() {
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
