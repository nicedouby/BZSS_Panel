// -*- coding: utf-8 -*-

export async function handleDynamicPressureZoneRoutes({ core, module, url, req, user, readJsonBody, json }) {
  if (!url.pathname.startsWith("/api/dynamic-pressure-zone")) return false;
  if (!module) {
    json(404, { error: "ModuleNotFound", message: "dynamicPressureZone module is not loaded." });
    return true;
  }

  if (url.pathname === "/api/dynamic-pressure-zone/state" && req.method === "GET") {
    json(200, { ok: true, state: module.getState() });
    return true;
  }
  if (url.pathname === "/api/dynamic-pressure-zone/base-config" && req.method === "GET") {
    json(200, { ok: true, ...module.getBaseConfig() });
    return true;
  }
  if (url.pathname === "/api/dynamic-pressure-zone/base-config" && req.method === "PUT") {
    if (!canManage(core, user)) {
      json(403, { error: "Forbidden", message: "settings.manage permission is required." });
      return true;
    }
    const body = await readJsonBody(req);
    try {
      json(200, { ok: true, ...(await module.saveBaseConfig(body)) });
    } catch (error) {
      json(400, { error: "InvalidBaseConfig", message: error?.message ?? "Invalid base pressure zone config." });
    }
    return true;
  }
  if (url.pathname === "/api/dynamic-pressure-zone/profile" && req.method === "GET") {
    json(200, { ok: true, profile: await module.getLayerProfile() });
    return true;
  }
  if (url.pathname === "/api/dynamic-pressure-zone/profile" && req.method === "PUT") {
    if (!canManage(core, user)) {
      json(403, { error: "Forbidden", message: "settings.manage permission is required." });
      return true;
    }
    const body = await readJsonBody(req);
    try {
      json(200, { ok: true, ...(await module.saveLayerProfile(body)) });
    } catch (error) {
      json(400, { error: "InvalidLayerProfile", message: error?.message ?? "Invalid layer profile." });
    }
    return true;
  }
  if (url.pathname === "/api/dynamic-pressure-zone/simulate" && req.method === "POST") {
    if (!canManage(core, user)) {
      json(403, { error: "Forbidden", message: "settings.manage permission is required." });
      return true;
    }
    const body = await readJsonBody(req);
    try {
      json(200, { ok: true, state: module.simulate(body) });
    } catch (error) {
      json(400, { error: "InvalidSimulationInput", message: error?.message ?? "Invalid simulation input." });
    }
    return true;
  }

  json(405, { error: "MethodNotAllowed", message: "Unsupported dynamic pressure zone route or method." });
  return true;
}

function canManage(core, user) {
  return Boolean(core.authManager?.hasEverything?.(user) || core.authManager?.hasPermission?.(user, "settings.manage"));
}
