import { AUDIT_ACTIONS, AUDIT_CATEGORIES, AUDIT_SOURCE_PAGES } from "../../core/audit/audit-actions.js";

export async function handleReserveSlotsRoutes({
  core,
  modules,
  url,
  req,
  user,
  readTextBody,
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
    if (!core.authManager?.hasEverything?.(user)) {
      json(403, {
        error: "Forbidden",
        message: "SuperAdmin permission is required.",
      });
      return true;
    }
    json(200, await reserveSlots.getState());
    return true;
  }

  if (url.pathname === "/api/reserve-slots/cdk/state" && req.method === "GET") {
    if (!core.authManager?.hasEverything?.(user)) {
      json(403, {
        error: "Forbidden",
        message: "SuperAdmin permission is required.",
      });
      return true;
    }

    json(200, await reserveSlots.getCdkState());
    return true;
  }

  const batchActivationsMatch = url.pathname.match(/^\/api\/reserve-slots\/cdk\/batches\/([^/]+)\/activations$/);
  if (batchActivationsMatch && req.method === "GET") {
    if (!core.authManager?.hasEverything?.(user)) {
      json(403, {
        error: "Forbidden",
        message: "SuperAdmin permission is required.",
      });
      return true;
    }

    const batchId = decodeURIComponent(batchActivationsMatch[1]);
    const result = await reserveSlots.listBatchActivations(batchId, {
      steamId: url.searchParams.get("steamId") ?? "",
      result: url.searchParams.get("result") ?? "",
    });
    json(200, result);
    return true;
  }

  if (url.pathname === "/api/reserve-slots/cdk/batches" && req.method === "POST") {
    if (!core.authManager?.hasEverything?.(user)) {
      json(403, {
        error: "Forbidden",
        message: "SuperAdmin permission is required.",
      });
      return true;
    }

    const body = await readJsonBody(req);
    const auditContext = {
      action: AUDIT_ACTIONS.RESERVE_SLOT_MANAGEMENT,
      category: AUDIT_CATEGORIES.RESERVE_SLOT_MANAGEMENT,
      actor: user,
      request: req,
      sourcePage: body?.sourcePage ?? AUDIT_SOURCE_PAGES.RESERVE_SLOT_MANAGEMENT,
      target: {
        type: "reserve_slot_cdk_batch",
        id: body?.codeType ?? "",
        name: body?.codeType ?? "",
      },
      parameters: {
        operation: "create_cdk_batch",
        codeType: body?.codeType ?? "",
        quantity: body?.quantity ?? 0,
        durationDays: body?.durationDays ?? 0,
        allowMultiActivation: Boolean(body?.allowMultiActivation),
        activateAt: body?.activateAt ?? null,
        autoDeactivateAt: body?.autoDeactivateAt ?? null,
        minCurrentSessionSeconds: body?.minCurrentSessionSeconds ?? 0,
        minServerSeconds: body?.minServerSeconds ?? 0,
      },
    };

    const result = await executeAudited(core, auditContext, () => reserveSlots.createCdkBatch(body, { actor: user }));
    json(200, {
      ok: true,
      success: true,
      ...result,
    });
    return true;
  }

  const deactivateBatchMatch = url.pathname.match(/^\/api\/reserve-slots\/cdk\/batches\/([^/]+)\/deactivate$/);
  if (deactivateBatchMatch && req.method === "POST") {
    if (!core.authManager?.hasEverything?.(user)) {
      json(403, {
        error: "Forbidden",
        message: "SuperAdmin permission is required.",
      });
      return true;
    }

    const batchId = decodeURIComponent(deactivateBatchMatch[1]);
    const auditContext = {
      action: AUDIT_ACTIONS.RESERVE_SLOT_MANAGEMENT,
      category: AUDIT_CATEGORIES.RESERVE_SLOT_MANAGEMENT,
      actor: user,
      request: req,
      sourcePage: AUDIT_SOURCE_PAGES.RESERVE_SLOT_MANAGEMENT,
      target: {
        type: "reserve_slot_cdk_batch",
        id: batchId,
        name: batchId,
      },
      parameters: {
        operation: "deactivate_cdk_batch",
        batchId,
      },
    };

    const result = await executeAudited(core, auditContext, () => reserveSlots.deactivateCdkBatch(batchId, { actor: user }));
    json(200, {
      ok: true,
      success: true,
      ...result,
    });
    return true;
  }

  const reserveMemberDeleteMatch = url.pathname.match(/^\/api\/reserve-slots\/members\/([^/]+)$/);
  if (reserveMemberDeleteMatch && req.method === "DELETE") {
    if (!core.authManager?.hasEverything?.(user)) {
      json(403, {
        error: "Forbidden",
        message: "SuperAdmin permission is required.",
      });
      return true;
    }

    const steamId = decodeURIComponent(reserveMemberDeleteMatch[1]);
    const auditContext = {
      action: AUDIT_ACTIONS.RESERVE_SLOT_MANAGEMENT,
      category: AUDIT_CATEGORIES.RESERVE_SLOT_MANAGEMENT,
      actor: user,
      request: req,
      sourcePage: AUDIT_SOURCE_PAGES.RESERVE_SLOT_MANAGEMENT,
      target: {
        type: "player",
        id: steamId,
        steamId,
      },
      parameters: {
        steamId,
        operation: "delete_member",
      },
    };

    const result = await executeAudited(core, auditContext, () => reserveSlots.deleteMember({ steamId }));
    json(200, {
      ok: true,
      success: true,
      message: result.message ?? "预留位已删除。",
      ...result,
    });
    return true;
  }

  if (url.pathname === "/api/reserve-slots/members" && req.method === "POST") {
    if (!core.authManager?.hasEverything?.(user)) {
      json(403, {
        error: "Forbidden",
        message: "SuperAdmin permission is required.",
      });
      return true;
    }

    const body = await readJsonBody(req);
    const auditContext = {
      action: AUDIT_ACTIONS.RESERVE_SLOT_MANAGEMENT,
      category: AUDIT_CATEGORIES.RESERVE_SLOT_MANAGEMENT,
      actor: user,
      request: req,
      sourcePage: body?.sourcePage ?? AUDIT_SOURCE_PAGES.RESERVE_SLOT_MANAGEMENT,
      target: {
        type: "player",
        id: body?.steamId ?? body?.steamID ?? body?.steam64 ?? "",
        name: body?.name ?? "",
        steamId: body?.steamId ?? body?.steamID ?? body?.steam64 ?? "",
      },
      parameters: {
        steamId: body?.steamId ?? body?.steamID ?? body?.steam64 ?? "",
        group: body?.group ?? "",
        expireAt: body?.expireAt ?? "",
        durationDays: body?.durationDays ?? 0,
        reason: body?.reason ?? "",
      },
    };

    const result = await executeAudited(core, auditContext, () => reserveSlots.upsertMember(body));
    json(200, {
      ok: true,
      success: true,
      message: result.message ?? "预留位时间已更新。",
      ...result,
    });
    return true;
  }

  if (url.pathname === "/api/reserve-slots/delete-expired" && req.method === "POST") {
    if (!core.authManager?.hasEverything?.(user)) {
      json(403, {
        error: "Forbidden",
        message: "SuperAdmin permission is required.",
      });
      return true;
    }

    const auditContext = {
      action: AUDIT_ACTIONS.RESERVE_SLOT_MANAGEMENT,
      category: AUDIT_CATEGORIES.RESERVE_SLOT_MANAGEMENT,
      actor: user,
      request: req,
      sourcePage: AUDIT_SOURCE_PAGES.RESERVE_SLOT_MANAGEMENT,
      target: {
        type: "reserve_slot",
        id: "expired",
        name: "expired",
      },
      parameters: {
        operation: "delete_expired",
      },
    };

    const result = await executeAudited(core, auditContext, () => reserveSlots.deleteExpiredMembers());
    json(200, {
      ok: true,
      success: true,
      message: result.message ?? "过期预留位已删除。",
      ...result,
    });
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
      message: result.message ?? "已从管理员文件同步预留位数据。",
      ...result,
    });
    return true;
  }

  if (url.pathname === "/api/reserve-slots/export-csv" && req.method === "GET") {
    if (!core.authManager?.hasEverything?.(user)) {
      json(403, {
        error: "Forbidden",
        message: "SuperAdmin permission is required.",
      });
      return true;
    }
    const csv = await reserveSlots.exportCsv();
    json(200, {
      ok: true,
      csv,
    }, {
      "Content-Type": "application/json; charset=utf-8",
    });
    return true;
  }

  if (url.pathname === "/api/reserve-slots/import-csv" && req.method === "POST") {
    if (!core.authManager?.hasEverything?.(user)) {
      json(403, {
        error: "Forbidden",
        message: "SuperAdmin permission is required.",
      });
      return true;
    }

    const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
    let csvText = "";
    if (contentType.includes("application/json")) {
      const body = await readJsonBody(req);
      csvText = String(body?.csv ?? body?.csvText ?? body?.text ?? "");
    } else {
      csvText = String(await readTextBody(req) ?? "");
    }

    const result = await reserveSlots.importFromCsv(csvText);
    json(200, {
      ok: true,
      success: true,
      message: result.message ?? "CSV 导入完成。",
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

async function executeAudited(core, context, executor) {
  if (!core?.auditManager?.execute) return executor({ requestId: "" });
  return core.auditManager.execute(context, executor);
}
