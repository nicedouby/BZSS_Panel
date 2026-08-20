// -*- coding: utf-8 -*-

export async function handlePressureZoneRulesRoutes({ module, url, req, readJsonBody, json }) {
  if (!url.pathname.startsWith("/api/pressure-zone-rules")) return false;
  if (!module) {
    json(404, { error: "ModuleNotFound", message: "pressureZoneRules module is not loaded." });
    return true;
  }
  if (url.pathname === "/api/pressure-zone-rules/state" && req.method === "GET") {
    json(200, { ok: true, ...module.getState() });
    return true;
  }
  if (url.pathname === "/api/pressure-zone-rules/toggle" && req.method === "POST") {
    const body = await readJsonBody(req);
    json(200, { ok: true, ...module.setEnabled(body?.enabled === true) });
    return true;
  }
  if (url.pathname === "/api/pressure-zone-rules/broadcast" && req.method === "POST") {
    json(200, { ok: true, result: await module.broadcast() });
    return true;
  }
  json(405, { error: "MethodNotAllowed", message: "Unsupported pressure-zone-rules route or method." });
  return true;
}
