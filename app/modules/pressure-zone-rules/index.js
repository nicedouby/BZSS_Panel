// -*- coding: utf-8 -*-

import { MAP_PRESSURE_RULES, TEMPORARY_SHRINK_RULES, getMapAssetName, getMapDisplayName, resolvePressureMapKey, resolvePressureRule } from "./rules.js";

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
  let periodicBroadcastTimer = null;
  const PERIODIC_BROADCAST_MS = 300 * 1000;
  let lastMapIdentity = "";
  const BROADCAST_COOLDOWN_MS = 10 * 60 * 1000;
  let lastBroadcastIdentity = "";
  let lastBroadcastAtMs = 0;

  function clone(value) {
    if (value == null) return value;
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  }

  function getState() {
    return clone({ ...state, mapRules: MAP_PRESSURE_RULES, temporaryShrinkRules: TEMPORARY_SHRINK_RULES });
  }

  function buildAnnouncement(rule, mapName, mapKey = "") {
    const displayMapName = getMapDisplayName(mapKey, mapName || "未知地图") || "未知地图";
    if (!rule) return `[压家圈服规] 当前地图：${displayMapName}，当前地图暂未配置明确压家圈规则，请以管理员公告为准。`;
    const extension = [
      rule.fullCount ? `${rule.fullCount}个完整FOB圈` : "",
      rule.innerCount ? `${rule.innerCount}个FOB内圈` : "",
    ].filter(Boolean).join("＋");
    return `[压家圈服规] 当前地图：${displayMapName}；以主基地FOB圈为基准向外衍生${extension}；交战位于压家圈内时按点位位置逐级缩圈。`;
  }

  function setEnabled(value) {
    state.enabled = Boolean(value);
    if (!state.enabled) state.lastError = "插件已关闭";
    else state.lastError = "";
    return getState();
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
    const candidates = [
      source?.server?.map,
      source?.server?.layer,
      source?.match?.map,
      source?.match?.layer,
    ].map((value) => String(value ?? "").trim()).filter(Boolean);
    const rawMapName = candidates[0] ?? "";
    const assetMapKey = candidates.map(resolvePressureMapKey).find(Boolean) ?? "";
    const assetMapName = getMapAssetName(assetMapKey);
    const mapName = assetMapName || rawMapName;
    const rule = resolvePressureRule(assetMapKey || rawMapName);
    const identity = assetMapKey || `raw:${rawMapName.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
    if (!identity || (identity === lastMapIdentity && state.map)) return getState();
    lastMapIdentity = identity;
    state.map = mapName;
    state.mapKey = assetMapKey || rule?.id || "";
    state.rule = rule ? clone(rule) : null;
    state.announcement = buildAnnouncement(rule, assetMapName || rawMapName, assetMapKey);
    state.updatedAt = new Date().toISOString();
    const now = Date.now();
    const canAutoBroadcast = broadcastOnChange && rule && (
      identity !== lastBroadcastIdentity || now - lastBroadcastAtMs >= BROADCAST_COOLDOWN_MS
    );
    if (canAutoBroadcast) {
      lastBroadcastIdentity = identity;
      lastBroadcastAtMs = now;
      await broadcast();
    }
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
    api: { getState, refresh, broadcast, setEnabled },
    async init() {},
    async start() {
      unsubscribe = modules?.tacticalState?.subscribe?.((snapshot) => {
        void refresh(snapshot).catch((error) => moduleLogger.warn?.(`[PressureZoneRules] 刷新失败：${error?.message ?? error}`));
      }) ?? null;
      await refresh(null, { broadcastOnChange: false });
      periodicBroadcastTimer = setInterval(() => {
        if (!state.enabled || !state.rule || !state.announcement) return;
        void broadcast().catch((error) => moduleLogger.warn?.(`[PressureZoneRules] 定时广播失败：${error?.message ?? error}`));
      }, PERIODIC_BROADCAST_MS);
    },
    async stop() {
      if (periodicBroadcastTimer) clearInterval(periodicBroadcastTimer);
      periodicBroadcastTimer = null;
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
