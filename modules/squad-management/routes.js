// -*- coding: utf-8 -*-

export async function handleSquadManagementRoutes({
  core,
  modules,
  url,
  req,
  user,
  readJsonBody,
  json,
}) {
  if (!url.pathname.startsWith("/api/squad-management")) {
    return false;
  }

  const squadManagement = modules.squadManagement;
  if (!squadManagement) {
    json(404, {
      error: "SquadManagementUnavailable",
      message: "Squad management module is not loaded.",
    });
    return true;
  }

  if (url.pathname === "/api/squad-management/state" && req.method === "GET") {
    const serverId = url.searchParams.get("serverId") ?? core.webStatus?.serverId ?? "";
    const state = squadManagement.getState(serverId);
    json(200, {
      ok: true,
      state,
      viewer: buildViewer(core, user, state),
    });
    return true;
  }

  if (url.pathname === "/api/squad-management/records" && req.method === "GET") {
    const serverId = url.searchParams.get("serverId") ?? core.webStatus?.serverId ?? "";
    const state = squadManagement.getState(serverId);
    const recordsResponse = await squadManagement.getRecords({
      serverId,
      matchId: url.searchParams.get("matchId") ?? state.matchId ?? "",
      kind: url.searchParams.get("kind") ?? url.searchParams.get("type") ?? "all",
      limit: url.searchParams.get("limit") ?? "500",
      offset: url.searchParams.get("offset") ?? "0",
    });

    json(200, {
      ok: true,
      ...recordsResponse,
      viewer: buildViewer(core, user, state),
      policy: {
        enforcementEnabled: Boolean(state.enforcementEnabled),
        disbandPermission: state.disbandPermission || "squad.disband",
        kickPermission: state.kickPermission || "squad.kick",
        kickThreshold: Number(state.kickThreshold ?? 10),
      },
    });
    return true;
  }

  if (url.pathname === "/api/squad-management/actions" && req.method === "POST") {
    const body = await readJsonBody(req);
    const serverId = body.serverId ?? body.serverID ?? core.webStatus?.serverId ?? "";
    const state = squadManagement.getState?.(serverId) ?? {};
    const requiredPermission = resolveActionPermission(body, state);

    if (!requiredPermission) {
      json(400, {
        error: "InvalidActionType",
        message: "Unsupported action type.",
      });
      return true;
    }

    if (!core.authManager?.hasPermission?.(user, requiredPermission)) {
      json(403, {
        error: "Forbidden",
        message: `Permission '${requiredPermission}' is required.`,
      });
      return true;
    }

    const api = squadManagement;
    if (!api?.executeAction) {
      json(404, { error: "SquadManagementUnavailable" });
      return true;
    }

    const result = await executeAudited(core, buildActionAuditContext(core, req, user, body), ({ requestId }) => api.executeAction({
        ...body,
        actor: user,
        source: body.source ?? "web.squadManagement",
        system: false,
        operatorName: user?.username ?? "",
        requestId,
      }));

    json(result.ok ? 200 : 400, result);
    return true;
  }

  if (url.pathname === "/api/squad-management/disband" && req.method === "POST") {
    const body = await readJsonBody(req);
    const serverId = body.serverId ?? body.serverID ?? core.webStatus?.serverId ?? "";
    if (!squadManagement?.executeAction) {
      json(404, { error: "SquadManagementUnavailable" });
      return true;
    }
    const result = await executeAudited(core, buildRemoveAuditContext(core, req, user, body, serverId, "squad"), ({ requestId }) => squadManagement.executeAction({
      actor: user,
      type: "disband_squad",
      serverId,
      teamId: body.teamId ?? body.teamID ?? null,
      squadId: body.squadId ?? body.squadID ?? null,
      reason: body.reason ?? "",
      source: body.source ?? "manual",
      system: false,
      operatorName: user?.username ?? "",
      requestId,
    }));

    json(result.ok ? 200 : (result.error === "Forbidden" ? 403 : 400), {
      ok: result.ok,
      result,
      state: result.state ?? squadManagement.getState(serverId),
    });
    return true;
  }

  if (url.pathname === "/api/squad-management/kick" && req.method === "POST") {
    const body = await readJsonBody(req);
    const serverId = body.serverId ?? body.serverID ?? core.webStatus?.serverId ?? "";
    if (!squadManagement?.executeAction) {
      json(404, { error: "SquadManagementUnavailable" });
      return true;
    }
    const result = await executeAudited(core, buildRemoveAuditContext(core, req, user, body, serverId, "player"), ({ requestId }) => squadManagement.executeAction({
      actor: user,
      type: "kick_player",
      serverId,
      playerId: body.playerId ?? body.playerID ?? "",
      playerKey: body.playerKey ?? body.anyId ?? body.playerId ?? body.playerID ?? "",
      steamId: body.steamId ?? body.steamID ?? "",
      eosId: body.eosId ?? body.eosID ?? "",
      name: body.name ?? body.playerName ?? body.creatorName ?? "",
      reason: body.reason ?? "",
      source: body.source ?? "manual",
      system: false,
      operatorName: user?.username ?? "",
      requestId,
    }));

    json(result.ok ? 200 : (result.error === "Forbidden" ? 403 : 400), {
      ok: result.ok,
      result,
      state: result.state ?? squadManagement.getState(serverId),
    });
    return true;
  }

  if (url.pathname === "/api/squad-management/remove" && req.method === "POST") {
    const body = await readJsonBody(req);
    const serverId = body.serverId ?? body.serverID ?? core.webStatus?.serverId ?? "";
    if (!squadManagement?.executeAction) {
      json(404, { error: "SquadManagementUnavailable" });
      return true;
    }
    const result = await executeAudited(core, buildRemoveAuditContext(core, req, user, body, serverId, "player"), ({ requestId }) => squadManagement.executeAction({
      actor: user,
      type: "remove_from_squad",
      serverId,
      playerId: body.playerId ?? body.playerID ?? "",
      playerKey: body.playerKey ?? body.anyId ?? body.playerId ?? body.playerID ?? "",
      steamId: body.steamId ?? body.steamID ?? "",
      eosId: body.eosId ?? body.eosID ?? "",
      name: body.name ?? body.playerName ?? body.creatorName ?? "",
      reason: body.reason ?? "",
      source: body.source ?? "manual",
      system: false,
      operatorName: user?.username ?? "",
      requestId,
    }));

    json(result.ok ? 200 : (result.error === "Forbidden" ? 403 : 400), {
      ok: result.ok,
      result,
      state: result.state ?? squadManagement.getState(serverId),
    });
    return true;
  }

  return false;
}

function resolveActionPermission(body = {}, state = {}) {
  const type = String(body.type ?? body.action ?? body.kind ?? "").trim().toLowerCase();
  if (type === "disband_squad" || type === "disband") return state.disbandPermission || "squad.disband";
  if (type === "kick_player" || type === "kick") return state.kickPermission || "squad.kick";
  if (type === "remove_from_squad" || type === "remove") return state.removePermission || "squad.remove";
  return "";
}

async function executeAudited(core, context, executor) {
  if (!context || !core?.auditManager?.execute) return executor({ requestId: "" });
  return core.auditManager.execute(context, executor, {
    relatedRecordIdBuilder: (payload) => payload?.record?.id ?? payload?.recordId ?? payload?.result?.record?.id ?? "",
  });
}

function buildActionAuditContext(core, req, user, body = {}) {
  const type = String(body?.type ?? body?.kind ?? "").trim();
  if (type === "remove_from_squad" || type === "kick_player") {
    return buildRemoveAuditContext(core, req, user, body, body.serverId ?? body.serverID ?? core.webStatus?.serverId ?? "", "player");
  }
  if (type === "switch_team") {
    return {
      action: "player.switch_team",
      category: "player_management",
      actor: user,
      request: req,
      sourcePage: body.sourcePage ?? "squad_management",
      serverId: body.serverId ?? body.serverID ?? core.webStatus?.serverId ?? "",
      target: {
        type: "player",
        id: body.steamId ?? body.steamID ?? body.playerKey ?? body.playerId ?? "",
        name: body.name ?? body.playerName ?? "",
        steamId: body.steamId ?? body.steamID ?? "",
        eosId: body.eosId ?? body.eosID ?? "",
        teamId: body.teamId ?? body.teamID ?? null,
        squadId: body.squadId ?? body.squadID ?? null,
      },
      parameters: {
        fromTeamId: body.fromTeamId ?? body.teamId ?? body.teamID ?? null,
        requestedTeamId: body.requestedTeamId ?? body.targetTeamId ?? null,
        reason: body.reason ?? "",
      },
      resultResolver: squadResultResolver,
    };
  }
  return null;
}

function buildRemoveAuditContext(core, req, user, body = {}, serverId = "", targetKind = "player") {
  const type = String(body?.type ?? "").trim();
  return {
    action: type === "switch_team" ? "player.switch_team" : "player.remove_from_squad",
    category: "player_management",
    actor: user,
    request: req,
    sourcePage: body.sourcePage ?? "squad_management",
    serverId,
    target: {
      type: targetKind,
      id: body.steamId ?? body.steamID ?? body.playerKey ?? body.playerId ?? body.playerID ?? body.squadId ?? body.squadID ?? "",
      name: body.name ?? body.playerName ?? body.creatorName ?? body.squadName ?? "",
      steamId: body.steamId ?? body.steamID ?? "",
      eosId: body.eosId ?? body.eosID ?? "",
      teamId: body.teamId ?? body.teamID ?? null,
      squadId: body.squadId ?? body.squadID ?? null,
    },
    parameters: {
      reason: body.reason ?? "",
      source: body.source ?? "manual",
    },
    resultResolver: squadResultResolver,
  };
}

function squadResultResolver(payload) {
  if (payload?.ok) return "success";
  if (payload?.error === "Forbidden") return "forbidden";
  if (payload?.error === "InvalidRequest" || payload?.error === "MissingTarget") return "invalid";
  return "failed";
}

function buildViewer(core, user, state) {
  const isSuperAdmin = Boolean(core.authManager?.hasEverything?.(user));
  return {
    username: user.username,
    role: user.role,
    isSuperAdmin,
    canDisband: core.authManager?.hasPermission?.(user, state.disbandPermission || "squad.disband") ?? isSuperAdmin,
    canKick: core.authManager?.hasPermission?.(user, state.kickPermission || "squad.kick") ?? isSuperAdmin,
    canRemove: core.authManager?.hasPermission?.(user, state.removePermission || "squad.remove") ?? isSuperAdmin,
    canSwitch: core.authManager?.hasPermission?.(user, state.switchPermission ?? "squad.switch") ?? isSuperAdmin,
    permissions: user.permissions ?? [],
  };
}
