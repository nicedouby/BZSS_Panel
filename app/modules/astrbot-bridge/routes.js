// -*- coding: utf-8 -*-

function getRequestIp(req) {
  const remoteAddress = String(req?.socket?.remoteAddress ?? "").trim();
  const forwardedFor = req?.headers?.["x-forwarded-for"];
  const forwardedIp = typeof forwardedFor === "string" ? forwardedFor.split(",")[0].trim() : "";
  return forwardedIp || remoteAddress;
}

function getBearerToken(req) {
  const authorization = String(req?.headers?.authorization ?? "").trim();
  if (!authorization.toLowerCase().startsWith("bearer ")) return "";
  return authorization.slice(7).trim();
}

function normalizeList(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value ?? "").trim()).filter(Boolean);
}

function readIdentity(req, url, body = {}) {
  const qqNumber = String(
    body.qqNumber
    ?? body.qq
    ?? body.qq_number
    ?? req?.headers?.["x-bzss-qq-number"]
    ?? req?.headers?.["x-qq-number"]
    ?? url.searchParams.get("qqNumber")
    ?? url.searchParams.get("qq")
    ?? "",
  ).trim();

  const qqName = String(
    body.qqName
    ?? body.qq_name
    ?? body.qqNick
    ?? req?.headers?.["x-bzss-qq-name"]
    ?? req?.headers?.["x-qq-name"]
    ?? url.searchParams.get("qqName")
    ?? url.searchParams.get("qq_name")
    ?? "",
  ).trim();

  const steam64 = String(
    body.steam64
    ?? body.steamID
    ?? body.steamId
    ?? body.steam64ID
    ?? req?.headers?.["x-bzss-steam64"]
    ?? req?.headers?.["x-steam64"]
    ?? url.searchParams.get("steam64")
    ?? url.searchParams.get("steamID")
    ?? "",
  ).trim();

  return { qqNumber, qqName, steam64 };
}

export async function handleAstrbotBridgeRoutes({
  core,
  modules,
  url,
  req,
  res,
  readJsonBody,
  json,
  logger,
}) {
  if (!url.pathname.startsWith("/api/astrbot")) {
    return false;
  }

  const bridgeLogger = logger ?? core?.logger ?? console;
  const bridge = modules.astrbotBridge;
  if (!bridge) {
    bridgeLogger?.warn?.(`[AstrBotBridge] route unavailable path=${url.pathname} method=${req.method}`);
    json(404, {
      error: "AstrbotBridgeUnavailable",
      message: "AstrBot bridge module is not loaded.",
    });
    return true;
  }

  const state = bridge.getState?.() ?? {
    enabled: false,
    tokenConfigured: false,
    trustedIps: [],
    allowedActions: [],
  };

  if (url.pathname === "/api/astrbot/health" && req.method === "GET") {
    bridgeLogger?.info?.(`[AstrBotBridge] health path=${url.pathname} method=${req.method} ip=${getRequestIp(req)}`);
    json(200, {
      ok: true,
      enabled: Boolean(state.enabled),
      tokenConfigured: Boolean(state.tokenConfigured),
      trustedIps: normalizeList(state.trustedIps),
      allowedActions: normalizeList(state.allowedActions),
      service: "BZSS Panel AstrBot Bridge",
      time: new Date().toISOString(),
    });
    return true;
  }

  if (!state.enabled) {
    bridgeLogger?.warn?.(`[AstrBotBridge] disabled path=${url.pathname} method=${req.method} ip=${getRequestIp(req)}`);
    json(503, {
      error: "AstrbotBridgeDisabled",
      message: "AstrBot bridge module is disabled.",
    });
    return true;
  }

  const config = core?.config;
  const expectedToken = String(config?.get?.("modules.astrbotBridge.apiToken", "") ?? "").trim();
  if (!expectedToken) {
    bridgeLogger?.error?.(`[AstrBotBridge] token-missing path=${url.pathname} method=${req.method} ip=${getRequestIp(req)}`);
    json(503, {
      error: "AstrbotBridgeTokenMissing",
      message: "AstrBot bridge API token is not configured.",
    });
    return true;
  }

  const requestToken = getBearerToken(req);
  if (requestToken !== expectedToken) {
    bridgeLogger?.warn?.(`[AstrBotBridge] unauthorized path=${url.pathname} method=${req.method} ip=${getRequestIp(req)}`);
    json(401, {
      error: "Unauthorized",
      message: "Invalid AstrBot API token.",
    });
    return true;
  }

  if (url.pathname === "/api/astrbot/bind" && req.method === "POST") {
    const body = await readJsonBody(req);
    const identity = readIdentity(req, url, body ?? {});
    bridgeLogger?.info?.(`[AstrBotBridge] bind-request qq=${identity.qqNumber || "-"} steam64=${identity.steam64 || "-"} ip=${getRequestIp(req)}`);
    const result = await bridge.resolveProfile?.(identity);
    bridgeLogger?.info?.(`[AstrBotBridge] bind-success qq=${identity.qqNumber || "-"} steam64=${identity.steam64 || "-"} playerId=${result?.data?.player?.id ?? result?.player?.id ?? "-"} bound=${Boolean(result?.data?.bound ?? result?.bound)}`);
    json(200, {
      ok: true,
      data: result,
    });
    return true;
  }

  if (url.pathname === "/api/astrbot/status" && req.method === "GET") {
    const identity = readIdentity(req, url, {});
    bridgeLogger?.info?.(`[AstrBotBridge] status-request qq=${identity.qqNumber || "-"} ip=${getRequestIp(req)}`);
    const binding = await bridge.resolveProfile?.(identity);
    bridgeLogger?.info?.(`[AstrBotBridge] status-success qq=${identity.qqNumber || "-"} playerId=${binding?.player?.id ?? binding?.data?.player?.id ?? "-"} bound=${Boolean(binding?.bound ?? binding?.data?.bound)}`);
    json(200, {
      ok: true,
      binding,
      data: await bridge.query?.({ kind: "snapshot", ...identity }),
    });
    return true;
  }

  if (url.pathname === "/api/astrbot/server-info" && req.method === "GET") {
    bridgeLogger?.info?.(`[AstrBotBridge] server-info-request ip=${getRequestIp(req)}`);
    const result = await bridge.query?.({
      kind: "serverInfo",
      includePlayers: url.searchParams.get("includePlayers") === "1" || url.searchParams.get("players") === "1",
    });
    json(200, {
      ok: true,
      data: result?.data?.serverInfo ?? null,
      bridge: {
        enabled: Boolean(result?.enabled ?? state.enabled),
        tokenConfigured: Boolean(result?.tokenConfigured ?? state.tokenConfigured),
      },
    });
    return true;
  }

  if (url.pathname === "/api/astrbot/server-info/snapshot" && req.method === "GET") {
    bridgeLogger?.info?.(`[AstrBotBridge] server-info-snapshot-request ip=${getRequestIp(req)}`);
    const result = await bridge.queryServerInfoSnapshot?.({
      includePlayers: url.searchParams.get("includePlayers") === "1" || url.searchParams.get("players") === "1",
    });
    if (!result?.ok || !Buffer.isBuffer(result?.png) || !result.png.length) {
      const statusCode = Number(result?.statusCode ?? 500);
      bridgeLogger?.error?.(
        `[AstrBotBridge] server-info-snapshot-failed status=${statusCode} error=${result?.error ?? "DOWNLOAD_FAILED"} message=${String(result?.message ?? "failed to render server info snapshot").slice(0, 300)}\n${String(result?.stack ?? "").trim() || "(no stack)"}`
      );
      json(statusCode >= 400 ? statusCode : 500, {
        ok: false,
        error: result?.error ?? "DOWNLOAD_FAILED",
        message: result?.message ?? "Failed to render server info snapshot.",
      });
      return true;
    }

    bridgeLogger?.info?.(`[AstrBotBridge] server-info-snapshot-success bytes=${result.png.length} filePath=${String(result?.file_path ?? result?.filePath ?? "").trim() || "-"}`);
    res.writeHead(200, {
      "Content-Type": String(result?.contentType ?? "image/png"),
      "Content-Length": String(result.png.length),
      "Content-Disposition": `inline; filename="${String(result?.fileName ?? "server-info.png").replaceAll("\"", "")}"`,
      "Cache-Control": "no-store",
    });
    res.end(result.png);
    return true;
  }

  if (url.pathname === "/api/astrbot/server-info/snapshot/latest" && req.method === "GET") {
    bridgeLogger?.info?.(`[AstrBotBridge] server-info-snapshot-latest-request ip=${getRequestIp(req)}`);
    const latest = await bridge.readLatestServerInfoSnapshot?.();
    if (!latest?.png || !latest.png.length) {
      bridgeLogger?.warn?.(`[AstrBotBridge] server-info-snapshot-latest-miss ip=${getRequestIp(req)}`);
      json(404, {
        ok: false,
        error: "SnapshotNotFound",
        message: "No cached server info snapshot was found.",
      });
      return true;
    }

    bridgeLogger?.info?.(`[AstrBotBridge] server-info-snapshot-latest-success bytes=${latest.png.length} filePath=${String(latest.filePath ?? "").trim() || "-"}`);
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": String(latest.png.length),
      "Content-Disposition": `inline; filename="${String(latest.fileName ?? "server-info.png").replaceAll("\"", "")}"`,
      "Cache-Control": "no-store",
    });
    res.end(latest.png);
    return true;
  }

  if (url.pathname === "/api/astrbot/server-image" && req.method === "GET") {
    const result = await bridge.queryServerInfoSnapshot?.({
      includePlayers: true,
    });
    return writeAstrbotImageResponse(res, json, result, "server-info.png");
  }

  if (url.pathname === "/api/astrbot/end-snapshot/latest" && req.method === "GET") {
    const result = await bridge.readLatestEndSnapshotImage?.({
      combined: url.searchParams.get("combined") === "1",
      page: url.searchParams.get("page") ?? undefined,
    });
    return writeAstrbotImageResponse(res, json, result, "end-snapshot.png");
  }

  const snapshotImageMatch = url.pathname.match(/^\/api\/astrbot\/snapshot\/([^/]+)\/image$/);
  if (snapshotImageMatch && req.method === "GET") {
    const snapshotId = decodeURIComponent(snapshotImageMatch[1]);
    const result = await bridge.readEndSnapshotImage?.(snapshotId, {
      combined: url.searchParams.get("combined") === "1",
      page: url.searchParams.get("page") ?? undefined,
    });
    return writeAstrbotImageResponse(res, json, result, "end-snapshot.png");
  }

  if (url.pathname === "/api/astrbot/query" && req.method === "POST") {
    const body = await readJsonBody(req);
    const identity = readIdentity(req, url, body ?? {});
    bridgeLogger?.info?.(`[AstrBotBridge] query-request qq=${identity.qqNumber || "-"} kind=${String(body?.kind ?? body?.query ?? "snapshot")} ip=${getRequestIp(req)}`);
    const binding = await bridge.resolveProfile?.(identity);
    bridgeLogger?.info?.(`[AstrBotBridge] query-success qq=${identity.qqNumber || "-"} playerId=${binding?.player?.id ?? binding?.data?.player?.id ?? "-"} bound=${Boolean(binding?.bound ?? binding?.data?.bound)}`);
    json(200, {
      ok: true,
      binding,
      data: await bridge.query?.({ ...(body ?? {}), ...identity }),
    });
    return true;
  }

  if (url.pathname === "/api/astrbot/me" && req.method === "POST") {
    const body = await readJsonBody(req);
    const identity = readIdentity(req, url, body ?? {});
    bridgeLogger?.info?.(`[AstrBotBridge] me-request qq=${identity.qqNumber || "-"} ip=${getRequestIp(req)}`);
    const result = await bridge.queryMe?.(identity);
    bridgeLogger?.info?.(`[AstrBotBridge] me-success qq=${identity.qqNumber || "-"} playerId=${result?.data?.player?.id ?? result?.player?.id ?? "-"} bound=${Boolean(result?.data?.player?.qqNumber ?? result?.player?.qqNumber)}`);
    json(200, {
      ok: true,
      binding: {
        player: result?.data?.player ?? result?.player ?? null,
        bound: Boolean(result?.data?.player?.qqNumber ?? result?.player?.qqNumber),
      },
      data: result,
    });
    return true;
  }

  if (url.pathname === "/api/astrbot/me/snapshot" && req.method === "POST") {
    const body = await readJsonBody(req);
    const identity = readIdentity(req, url, body ?? {});
    bridgeLogger?.info?.(`[AstrBotBridge] me-snapshot-request qq=${identity.qqNumber || "-"} ip=${getRequestIp(req)}`);
    const result = await bridge.queryMeSnapshot?.(identity);
    bridgeLogger?.info?.(`[AstrBotBridge] me-snapshot-success qq=${identity.qqNumber || "-"} playerId=${result?.player?.id ?? "-"} bytes=${result?.png?.length ?? 0}`);
    res.writeHead(200, {
      "Content-Type": String(result?.contentType ?? "image/png"),
      "Content-Length": String(result?.png?.length ?? 0),
      "Content-Disposition": `inline; filename="${String(result?.fileName ?? "player-snapshot.png").replaceAll("\"", "")}"`,
      "Cache-Control": "no-store",
    });
    res.end(result?.png ?? Buffer.alloc(0));
    return true;
  }

  if (url.pathname === "/api/astrbot/unbind" && req.method === "POST") {
    const body = await readJsonBody(req);
    const identity = readIdentity(req, url, body ?? {});
    bridgeLogger?.info?.(`[AstrBotBridge] unbind-request qq=${identity.qqNumber || "-"} ip=${getRequestIp(req)}`);
    const result = await bridge.unbindMe?.(identity);
    bridgeLogger?.info?.(`[AstrBotBridge] unbind-success qq=${identity.qqNumber || "-"} playerId=${result?.data?.player?.id ?? result?.player?.id ?? "-"} unbound=${Boolean(result?.data?.unbound ?? result?.unbound)}`);
    json(200, {
      ok: true,
      binding: {
        player: result?.data?.player ?? result?.player ?? null,
        bound: false,
      },
      data: result,
    });
    return true;
  }

  if (url.pathname === "/api/astrbot/action" && req.method === "POST") {
    const body = await readJsonBody(req);
    const identity = readIdentity(req, url, body ?? {});
    const actionName = String(body?.name ?? body?.action ?? "").trim();
    bridgeLogger?.info?.(`[AstrBotBridge] action-request qq=${identity.qqNumber || "-"} action=${actionName || "-"} ip=${getRequestIp(req)}`);
    const binding = await bridge.resolveProfile?.(identity);
    const result = await bridge.action?.(body ?? {});
    bridgeLogger?.info?.(`[AstrBotBridge] action-success qq=${identity.qqNumber || "-"} action=${actionName || "-"} playerId=${binding?.player?.id ?? binding?.data?.player?.id ?? "-"}`);
    json(200, {
      ok: true,
      binding,
      data: result?.data ?? result,
    });
    return true;
  }

  json(404, {
    error: "ApiNotFound",
    message: "AstrBot bridge API route not found.",
  });
  return true;
}

function writeAstrbotImageResponse(res, json, result, fallbackFileName) {
  if (!result?.ok || !Buffer.isBuffer(result?.png) || result.png.length === 0) {
    const statusCode = Number(result?.statusCode ?? 500);
    json(statusCode >= 400 ? statusCode : 500, {
      ok: false,
      error: result?.error ?? "IMAGE_UNAVAILABLE",
      message: result?.message ?? "Image is unavailable.",
    });
    return true;
  }

  const fileName = String(result?.fileName ?? fallbackFileName).replaceAll('"', '');
  res.writeHead(200, {
    "Content-Type": String(result?.contentType ?? "image/png"),
    "Content-Length": String(result.png.length),
    "Content-Disposition": `inline; filename="${fileName}"`,
    "Cache-Control": "no-store",
  });
  res.end(result.png);
  return true;
}
