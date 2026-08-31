// -*- coding: utf-8 -*-

import { applyServerInfoSnapshotPlayerBoost } from "./server-info-player-boost.js";

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

function recordBotInteraction(bridge, req, action, identity = {}, result = {}, extra = {}) {
  const player = result?.data?.player ?? result?.player ?? extra?.player ?? null;
  const ok = result?.ok !== false && !result?.error && extra?.ok !== false;
  bridge.recordInteraction?.({
    kind: "command",
    direction: "incoming",
    action,
    qqNumber: identity.qqNumber,
    qqName: identity.qqName,
    steam64: identity.steam64,
    playerId: player?.id,
    playerName: player?.gameName ?? player?.currentName ?? player?.name,
    clientIp: getRequestIp(req),
    ok,
    summary: String(extra?.summary ?? ""),
    detail: {
      route: String(req?.url ?? ""),
      error: result?.error ?? null,
      message: result?.message ?? null,
      ...extra?.detail,
    },
  });
}

function normalizeDeliveryAck(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createValidationError("InvalidAck", "ACK body must be a JSON object.");
  }
  const eventId = limitedText(body.eventId, 512, "eventId", true);
  const eventType = limitedText(body.eventType, 128, "eventType");
  const error = body.error == null ? null : limitedText(body.error, 1000, "error");
  const rawTargets = body.targets == null ? [] : body.targets;
  if (!Array.isArray(rawTargets)) {
    throw createValidationError("InvalidAckTargets", "targets must be an array.");
  }
  if (rawTargets.length > 20) {
    throw createValidationError("TooManyAckTargets", "targets cannot contain more than 20 items.");
  }
  const targets = rawTargets.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw createValidationError("InvalidAckTarget", `targets[${index}] must be an object.`);
    }
    return {
      target: limitedText(item.target, 256, `targets[${index}].target`),
      ok: item.ok === true,
      error: item.error == null ? null : limitedText(item.error, 1000, `targets[${index}].error`),
    };
  });
  return {
    eventId,
    eventType,
    received: body.received === true,
    delivered: body.delivered === true,
    successCount: limitedCount(body.successCount),
    failureCount: limitedCount(body.failureCount),
    targets,
    error,
  };
}

function limitedText(value, maxLength, field, required = false) {
  const text = String(value ?? "").trim();
  if (required && !text) {
    throw createValidationError("AckEventIdRequired", `${field} is required.`);
  }
  if (text.length > maxLength) {
    throw createValidationError("AckFieldTooLong", `${field} cannot exceed ${maxLength} characters.`);
  }
  return text;
}

function limitedCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100_000, Math.floor(number)));
}

function createValidationError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  return error;
}

async function boostServerInfoSnapshotForDisplay(bridge, result) {
  if (!result?.ok || !Buffer.isBuffer(result?.png) || result.png.length === 0) return result;

  try {
    const serverInfoResult = await bridge.query?.({
      kind: "serverInfo",
      includePlayers: false,
    });
    return await applyServerInfoSnapshotPlayerBoost({
      result,
      serverInfo: serverInfoResult?.data?.serverInfo ?? null,
    });
  } catch {
    return result;
  }
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

  if (url.pathname === "/api/astrbot/event-ack" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const ack = normalizeDeliveryAck(body ?? {});
      bridge.recordDeliveryAck?.(ack);
      bridgeLogger?.info?.(
        `[AstrBotBridge] event-ack eventId=${ack.eventId} delivered=${ack.delivered} success=${ack.successCount} failed=${ack.failureCount} ip=${getRequestIp(req)}`,
      );
      json(200, { ok: true });
    } catch (error) {
      json(Number(error?.statusCode ?? 400) || 400, {
        ok: false,
        error: error?.code ?? "InvalidAck",
        message: String(error?.message ?? "Invalid delivery ACK."),
      });
    }
    return true;
  }

  if (url.pathname === "/api/astrbot/bind" && req.method === "POST") {
    const body = await readJsonBody(req);
    const identity = readIdentity(req, url, body ?? {});
    bridgeLogger?.info?.(`[AstrBotBridge] bind-request qq=${identity.qqNumber || "-"} steam64=${identity.steam64 || "-"} ip=${getRequestIp(req)}`);
    const result = await bridge.resolveProfile?.(identity);
    bridgeLogger?.info?.(`[AstrBotBridge] bind-success qq=${identity.qqNumber || "-"} steam64=${identity.steam64 || "-"} playerId=${result?.data?.player?.id ?? result?.player?.id ?? "-"} bound=${Boolean(result?.data?.bound ?? result?.bound)}`);
    recordBotInteraction(bridge, req, "bind", identity, result, {
      summary: result?.ok === false ? "QQ 玩家账号绑定失败" : "QQ 玩家账号绑定完成",
      detail: { bound: Boolean(result?.data?.bound ?? result?.bound) },
    });
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
    recordBotInteraction(bridge, req, "status", identity, binding, {
      summary: "机器人查询绑定状态",
      detail: { bound: Boolean(binding?.bound ?? binding?.data?.bound) },
    });
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
    recordBotInteraction(bridge, req, "serverInfo", {}, result, {
      summary: "机器人查询服务器信息",
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
    let result = await bridge.queryServerInfoSnapshot?.({
      includePlayers: url.searchParams.get("includePlayers") === "1" || url.searchParams.get("players") === "1",
    });
    result = await boostServerInfoSnapshotForDisplay(bridge, result);
    if (!result?.ok || !Buffer.isBuffer(result?.png) || !result.png.length) {
      const statusCode = Number(result?.statusCode ?? 500);
      bridgeLogger?.error?.(
        `[AstrBotBridge] server-info-snapshot-failed status=${statusCode} error=${result?.error ?? "DOWNLOAD_FAILED"} message=${String(result?.message ?? "failed to render server info snapshot").slice(0, 300)}\n${String(result?.stack ?? "").trim() || "(no stack)"}`
      );
      recordBotInteraction(bridge, req, "serverInfoSnapshot", {}, result, {
        ok: false,
        summary: "服务器信息快照生成失败",
      });
      json(statusCode >= 400 ? statusCode : 500, {
        ok: false,
        error: result?.error ?? "DOWNLOAD_FAILED",
        message: result?.message ?? "Failed to render server info snapshot.",
      });
      return true;
    }

    bridgeLogger?.info?.(`[AstrBotBridge] server-info-snapshot-success bytes=${result.png.length} filePath=${String(result?.file_path ?? result?.filePath ?? "").trim() || "-"}`);
    recordBotInteraction(bridge, req, "serverInfoSnapshot", {}, result, {
      summary: "机器人获取服务器信息快照",
      detail: { bytes: result.png.length },
    });
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
    let result = await bridge.queryServerInfoSnapshot?.({
      includePlayers: true,
    });
    result = await boostServerInfoSnapshotForDisplay(bridge, result);
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
    recordBotInteraction(bridge, req, "query", identity, binding, {
      summary: "机器人执行玩家信息查询",
      detail: { kind: String(body?.kind ?? body?.query ?? "snapshot") },
    });
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
    recordBotInteraction(bridge, req, "queryMyInfo", identity, result, {
      summary: result?.ok === false ? "玩家信息查询失败" : "机器人查询玩家信息",
    });
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
    recordBotInteraction(bridge, req, "queryMySnapshot", identity, result, {
      player: result?.player,
      ok: Boolean(result?.png?.length),
      summary: result?.png?.length ? "机器人获取玩家信息快照" : "玩家信息快照生成失败",
      detail: { bytes: result?.png?.length ?? 0 },
    });
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
    recordBotInteraction(bridge, req, "unbind", identity, result, {
      summary: result?.ok === false ? "QQ 玩家账号解绑失败" : "QQ 玩家账号已解绑",
      detail: { unbound: Boolean(result?.data?.unbound ?? result?.unbound) },
    });
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
    recordBotInteraction(bridge, req, `action:${actionName || "unknown"}`, identity, result, {
      player: binding?.player ?? binding?.data?.player,
      summary: result?.ok === false ? "机器人动作执行失败" : "机器人动作执行完成",
    });
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
