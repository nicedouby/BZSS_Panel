// -*- coding: utf-8 -*-

const LEGACY_PATH = "/api/team-balance/switch";
const TB_PATH = "/api/tb/force-team-change";
const RECORDS_PATH = "/api/tb/records";
const SHUFFLE_PLAN_PATH = "/api/tb/shuffle-plan";

export async function handleTbRoutes({
  core,
  modules,
  url,
  req,
  user,
  readJsonBody,
  json,
}) {
  if (url.pathname !== TB_PATH && url.pathname !== LEGACY_PATH && url.pathname !== RECORDS_PATH && url.pathname !== SHUFFLE_PLAN_PATH) {
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

  if (url.pathname === RECORDS_PATH) {
    if (req.method !== "GET") {
      json(405, {
        error: "MethodNotAllowed",
        message: "Only GET is supported.",
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

    const limit = url.searchParams.get("limit") ?? url.searchParams.get("count") ?? "50";
    const records = typeof teamBalance.listForceTeamChangeRecords === "function"
      ? await teamBalance.listForceTeamChangeRecords({ limit })
      : [];

    json(200, {
      ok: true,
      records,
    });
    return true;
  }

  if (url.pathname === SHUFFLE_PLAN_PATH) {
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
    const result = typeof teamBalance.createPlaytimeShufflePlan === "function"
      ? await teamBalance.createPlaytimeShufflePlan({
          ...body,
          source: body.source ?? "web.matchStatus.shufflePlan",
          reason: body.reason ?? "match_status_playtime_shuffle_plan",
          operator: buildOperator(user),
          system: false,
        })
      : {
          ok: false,
          error: "ShufflePlanUnavailable",
          message: "Shuffle planning is not available.",
        };

    json(result.ok ? 200 : mapErrorStatus(result.error), result);
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
  const steamId = body.steamId ?? body.steamID ?? body.anyId ?? body.playerKey ?? body.playerId ?? "";
  const playerName = body.playerName ?? body.name ?? "";
  const auditContext = {
    action: "player.switch_team",
    category: "player_management",
    actor: user,
    request: req,
    sourcePage: body.sourcePage ?? "match_status",
    serverId: body.serverId ?? body.serverID ?? core?.webStatus?.serverId ?? "",
    target: {
      type: "player",
      id: steamId,
      name: playerName,
      steamId,
      teamId: body.teamId ?? body.fromTeamId ?? null,
      squadId: body.squadId ?? null,
    },
    parameters: {
      fromTeamId: body.fromTeamId ?? body.teamId ?? null,
      requestedTeamId: body.requestedTeamId ?? body.targetTeamId ?? null,
      reason: body.reason ?? "manual_team_balance",
    },
    resultResolver: (payload) => payload?.ok ? "success" : payload?.error === "Forbidden" ? "forbidden" : "failed",
  };
  const result = await executeAudited(core, auditContext, () => teamBalance.forceTeamChange({
      ...body,
      steamId,
      playerName,
      source: body.source ?? "web.teamBalance",
      reason: body.reason ?? "manual_team_balance",
      operator: buildOperator(user),
      system: false,
      operatorName: user?.username ?? "",
    }));

  json(result.ok ? 200 : mapErrorStatus(result.error), result);
  return true;
}

async function executeAudited(core, context, executor) {
  if (!core?.auditManager?.execute) return executor({ requestId: "" });
  return core.auditManager.execute(context, executor);
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
