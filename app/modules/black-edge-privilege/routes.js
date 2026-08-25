export async function handleBlackEdgePrivilegeRoutes({
  core,
  modules,
  url,
  req,
  user,
  readJsonBody,
  json,
}) {
  if (!url.pathname.startsWith("/api/black-edge-privilege")) {
    return false;
  }

  const blackEdgePrivilege = modules.blackEdgePrivilege;
  if (!blackEdgePrivilege) {
    json(404, {
      error: "BlackEdgePrivilegeUnavailable",
      message: "Black edge privilege module is not loaded.",
    });
    return true;
  }

  if (url.pathname === "/api/black-edge-privilege/cdk/state" && req.method === "GET") {
    if (!core.authManager?.hasPermission?.(user, "black_edge_privilege.manage")) {
      json(403, {
        error: "Forbidden",
        message: "black_edge_privilege.manage permission is required.",
      });
      return true;
    }

    json(200, await blackEdgePrivilege.getCdkState());
    return true;
  }

  const batchActivationsMatch = url.pathname.match(/^\/api\/black-edge-privilege\/cdk\/batches\/([^/]+)\/activations$/);
  if (batchActivationsMatch && req.method === "GET") {
    if (!core.authManager?.hasPermission?.(user, "black_edge_privilege.manage")) {
      json(403, {
        error: "Forbidden",
        message: "black_edge_privilege.manage permission is required.",
      });
      return true;
    }

    const batchId = decodeURIComponent(batchActivationsMatch[1]);
    json(200, await blackEdgePrivilege.listBatchActivations(batchId, {
      steamId: url.searchParams.get("steamId") ?? "",
      result: url.searchParams.get("result") ?? "",
    }));
    return true;
  }

  if (url.pathname === "/api/black-edge-privilege/cdk/batches" && req.method === "POST") {
    if (!core.authManager?.hasPermission?.(user, "black_edge_privilege.manage")) {
      json(403, {
        error: "Forbidden",
        message: "black_edge_privilege.manage permission is required.",
      });
      return true;
    }

    const body = await readJsonBody(req);
    const result = await blackEdgePrivilege.createCdkBatch(body, { actor: user });
    json(200, {
      ok: true,
      success: true,
      ...result,
    });
    return true;
  }

  const deactivateBatchMatch = url.pathname.match(/^\/api\/black-edge-privilege\/cdk\/batches\/([^/]+)\/deactivate$/);
  if (deactivateBatchMatch && req.method === "POST") {
    if (!core.authManager?.hasPermission?.(user, "black_edge_privilege.manage")) {
      json(403, {
        error: "Forbidden",
        message: "black_edge_privilege.manage permission is required.",
      });
      return true;
    }

    const batchId = decodeURIComponent(deactivateBatchMatch[1]);
    const result = await blackEdgePrivilege.deactivateCdkBatch(batchId, { actor: user });
    json(200, {
      ok: true,
      success: true,
      ...result,
    });
    return true;
  }

  return false;
}
