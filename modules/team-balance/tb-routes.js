// -*- coding: utf-8 -*-

const LEGACY_PATH = "/api/team-balance/switch";
const TB_PATH = "/api/tb/force-team-change";

export async function handleTbRoutes({
  modules,
  url,
  req,
  user,
  readJsonBody,
  json,
}) {
  if (url.pathname !== TB_PATH && url.pathname !== LEGACY_PATH) {
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

  if (req.method !== "POST") {
    json(405, {
      error: "MethodNotAllowed",
      message: "Only POST is supported.",
    });
    return true;
  }

  if (!user) {
    json(401, {
      error: "Unauthorized",
      message: "Authentication required.",
    });
    return true;
  }

  const body = (await readJsonBody(req)) ?? {};
  const result = await teamBalance.forceTeamChange({
    ...body,
    steamId: body.steamId ?? body.steamID ?? body.anyId ?? body.playerKey ?? body.playerId ?? "",
    playerName: body.playerName ?? body.name ?? "",
    source: body.source ?? "web.teamBalance",
    reason: body.reason ?? "manual_team_balance",
    operator: buildOperator(user),
    system: false,
  });

  json(result.ok ? 200 : mapErrorStatus(result.error), result);
  return true;
}

function buildOperator(user) {
  return {
    id: user?.id ?? user?.username ?? "",
    name: user?.name ?? user?.username ?? "",
    username: user?.username ?? user?.name ?? "",
    role: user?.role ?? "",
    isSuperAdmin: Boolean(user?.isSuperAdmin),
    permissions: Array.isArray(user?.permissions)
      ? user.permissions
      : typeof user?.permissions === "string"
        ? user.permissions.split(",").map((item) => String(item).trim()).filter(Boolean)
        : [],
  };
}

function mapErrorStatus(error) {
  if (error === "Forbidden") return 403;
  return 400;
}
