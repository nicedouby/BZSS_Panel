// -*- coding: utf-8 -*-

export async function handleTeamBalanceRoutes({
  core,
  modules,
  url,
  req,
  user,
  readJsonBody,
  json,
}) {
  if (!url.pathname.startsWith("/api/team-balance")) {
    return false;
  }

  const teamBalance = modules.teamBalance;
  if (!teamBalance) {
    json(404, {
      error: "TeamBalanceUnavailable",
      message: "Team balance module is not loaded.",
    });
    return true;
  }

  if (url.pathname === "/api/team-balance/switch" && req.method === "POST") {
    if (!user) {
      json(401, {
        error: "Unauthorized",
        message: "Authentication required.",
      });
      return true;
    }

    const body = await readJsonBody(req);
    const result = await teamBalance.requestSwitchTeam({
      ...body,
      actor: user,
      source: body.source ?? "对局状态手动操作",
      operatorName: body.operatorName ?? user?.username ?? "",
      system: false,
      serverId: body.serverId ?? body.serverID ?? core.webStatus?.serverId ?? "",
    });

    json(result.ok ? 200 : (result.error === "Forbidden" ? 403 : 400), result);
    return true;
  }

  return false;
}
