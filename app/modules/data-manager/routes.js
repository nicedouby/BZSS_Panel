// -*- coding: utf-8 -*-

export async function handleDataManagerRoutes({ core, modules, url, req, user, readJsonBody, json, executeAudited }) {
  if (!url.pathname.startsWith("/api/data-manager")) return false;

  if (!core.authManager?.hasEverything?.(user) && !user?.isSuperAdmin) {
    json(403, { error: "Forbidden", message: "SuperAdmin role is required." });
    return true;
  }

  const api = modules.dataManager;
  if (!api) {
    json(503, { error: "DataManagerUnavailable", message: "Data manager module is not loaded." });
    return true;
  }

  if (url.pathname === "/api/data-manager/overview" && req.method === "GET") {
    json(200, await api.getOverview());
    return true;
  }

  if (url.pathname === "/api/data-manager/cleanup" && req.method === "POST") {
    const body = await readJsonBody(req);
    if (body?.confirmation !== "CLEAN_DATA") {
      json(400, { error: "CleanupConfirmationRequired", message: "Cleanup confirmation is missing or invalid." });
      return true;
    }
    const context = {
      action: "data.cleanup",
      category: "system_management",
      actor: user,
      request: req,
      sourcePage: "data_manager",
      target: { type: "data_categories", id: (body?.ids ?? []).join(",") },
      parameters: { ids: body?.ids ?? [], olderThanDays: body?.olderThanDays ?? null },
    };
    const result = await executeAudited(context, () => api.cleanup({
      ids: body?.ids,
      olderThanDays: body?.olderThanDays,
    }));
    json(result.ok ? 200 : 207, result);
    return true;
  }

  json(404, { error: "DataManagerRouteNotFound", message: "Unknown data manager route." });
  return true;
}

