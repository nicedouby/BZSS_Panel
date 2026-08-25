export async function handleWarmupReserveGrantRoutes({
  core,
  modules,
  url,
  req,
  user,
  readJsonBody,
  json,
}) {
  if (!url.pathname.startsWith("/api/warmup-reserve-grant")) {
    return false;
  }

  const api = modules.warmupReserveGrant;
  if (!api) {
    json(404, {
      error: "WarmupReserveGrantUnavailable",
      message: "Warmup reserve grant module is not loaded.",
    });
    return true;
  }

  if (!core.authManager?.hasPermission?.(user, "warmup_reserve_grant.manage")) {
    json(403, {
      error: "Forbidden",
      message: "warmup_reserve_grant.manage permission is required.",
    });
    return true;
  }

  if (url.pathname === "/api/warmup-reserve-grant/state" && req.method === "GET") {
    json(200, api.getState());
    return true;
  }

  if (url.pathname === "/api/warmup-reserve-grant/settings" && req.method === "PUT") {
    const body = await readJsonBody(req);
    json(200, await api.updateSettings(body ?? {}));
    return true;
  }

  if (url.pathname === "/api/warmup-reserve-grant/clear-records" && req.method === "POST") {
    json(200, await api.clearRecords());
    return true;
  }

  if (url.pathname === "/api/warmup-reserve-grant/clear-progress" && req.method === "POST") {
    json(200, await api.clearProgress());
    return true;
  }

  if (url.pathname === "/api/warmup-reserve-grant/grant-now" && req.method === "POST") {
    const body = await readJsonBody(req);
    json(200, await api.grantNow(body ?? {}, { actor: user }));
    return true;
  }

  json(405, {
    error: "MethodNotAllowed",
    message: "Unsupported warmup reserve grant route.",
  });
  return true;
}
