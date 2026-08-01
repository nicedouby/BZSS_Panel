// -*- coding: utf-8 -*-

export async function handleStepCounterRoutes({ module, url, req, json }) {
  if (!url.pathname.startsWith("/api/step-counter")) return false;
  if (!module) {
    json(404, { error: "ModuleNotFound", message: "stepCounter module is not loaded." });
    return true;
  }
  if (req.method !== "GET") {
    json(405, { error: "MethodNotAllowed", message: "Only GET is supported." });
    return true;
  }
  if (url.pathname === "/api/step-counter/stats") {
    json(200, { ok: true, ...module.getStats() });
    return true;
  }
  if (url.pathname === "/api/step-counter/player") {
    const steamID = String(url.searchParams.get("steamID") ?? "").trim();
    json(200, { ok: true, player: steamID ? module.getPlayer(steamID) : null });
    return true;
  }
  json(404, { error: "StepCounterRouteNotFound", message: "Unknown step counter route." });
  return true;
}
