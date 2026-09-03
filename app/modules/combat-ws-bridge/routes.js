export function handleCombatWsBridgeRoutes({ url, req, res, modules, json }) {
  if (url.pathname !== "/api/combat-ws/state" || req.method !== "GET") return false;
  const api = modules?.combatWsBridge?.api ?? modules?.combatWsBridge;
  if (!api?.getState) {
    json(res, 503, { error: "CombatWsBridgeUnavailable" });
    return true;
  }
  json(res, 200, api.getState({ packetId: url.searchParams.get("pid"), limit: url.searchParams.get("limit") }));
  return true;
}
