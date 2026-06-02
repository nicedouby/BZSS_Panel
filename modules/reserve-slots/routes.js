// -*- coding: utf-8 -*-

export async function handleReserveSlotsRoutes({
  core,
  modules,
  url,
  req,
  user,
  readJsonBody,
  json,
}) {
  if (!url.pathname.startsWith("/api/reserve-slots") && url.pathname !== "/api/settings/reserve-slots") {
    return false;
  }

  const reserveSlots = modules.reserveSlots;
  if (!reserveSlots) {
    json(404, {
      error: "ReserveSlotsUnavailable",
      message: "Reserve slots module is not loaded.",
    });
    return true;
  }

  if (url.pathname === "/api/reserve-slots" && req.method === "GET") {
    json(200, await reserveSlots.getState());
    return true;
  }

  if (url.pathname === "/api/reserve-slots/import-from-admin" && req.method === "POST") {
    if (!core.authManager?.hasEverything?.(user)) {
      json(403, {
        error: "Forbidden",
        message: "SuperAdmin permission is required.",
      });
      return true;
    }

    const result = await reserveSlots.importFromAdminFile();
    json(200, {
      ok: true,
      success: true,
      message: result.message ?? "已从管理员文件同步预留位数据",
      ...result,
    });
    return true;
  }

  if (url.pathname === "/api/settings/reserve-slots" && req.method === "PUT") {
    if (!core.authManager?.hasEverything?.(user)) {
      json(403, {
        error: "Forbidden",
        message: "SuperAdmin permission is required.",
      });
      return true;
    }

    const body = await readJsonBody(req);
    const result = await reserveSlots.updateConfig({
      enabled: body?.enabled,
      adminFilePath: body?.adminFilePath,
      localReserveFilePath: body?.localReserveFilePath,
    });

    json(200, {
      ok: true,
      success: true,
      message: "预留位系统设置已保存。",
      ...result,
    });
    return true;
  }

  return false;
}
