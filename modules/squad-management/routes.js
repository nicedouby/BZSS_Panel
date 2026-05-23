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
        disbandPermission: state.disbandPermission ?? "squad.disband",
        kickPermission: state.kickPermission ?? "squad.kick",
        kickThreshold: Number(state.kickThreshold ?? 10),
      },
    });
    return true;
  }

  if (url.pathname === "/api/squad-management/disband" && req.method === "POST") {
    const body = await readJsonBody(req);
    const serverId = body.serverId ?? body.serverID ?? core.webStatus?.serverId ?? "";
    const requestDisband = squadManagement.requestDisband ?? squadManagement.disband;
    const result = await requestDisband({
      actor: user,
      serverId,
      teamId: body.teamId ?? body.teamID ?? null,
      squadId: body.squadId ?? body.squadID ?? null,
      reason: body.reason ?? "",
      source: body.source ?? "manual",
      system: Boolean(body.system ?? false),
      operatorName: body.operatorName ?? user?.username ?? "",
    });

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
    const requestKick = squadManagement.requestKick ?? squadManagement.kick;
    const result = await requestKick({
      actor: user,
      serverId,
      playerId: body.playerId ?? body.playerID ?? "",
      steamId: body.steamId ?? body.steamID ?? "",
      eosId: body.eosId ?? body.eosID ?? "",
      name: body.name ?? body.playerName ?? body.creatorName ?? "",
      reason: body.reason ?? "",
      source: body.source ?? "manual",
      system: Boolean(body.system ?? false),
      operatorName: body.operatorName ?? user?.username ?? "",
      creatorKey: body.creatorKey ?? "",
    });

    json(result.ok ? 200 : (result.error === "Forbidden" ? 403 : 400), {
      ok: result.ok,
      result,
      state: result.state ?? squadManagement.getState(serverId),
    });
    return true;
  }

  return false;
}

function buildViewer(core, user, state) {
  const isSuperAdmin = Boolean(core.authManager?.hasEverything?.(user));
  return {
    username: user.username,
    role: user.role,
    isSuperAdmin,
    canDisband: core.authManager?.hasPermission?.(user, state.disbandPermission ?? "squad.disband") ?? isSuperAdmin,
    canKick: core.authManager?.hasPermission?.(user, state.kickPermission ?? "squad.kick") ?? isSuperAdmin,
    canRemove: core.authManager?.hasPermission?.(user, state.removePermission ?? "squad.remove") ?? isSuperAdmin,
    permissions: user.permissions ?? [],
  };
}
