// -*- coding: utf-8 -*-

import crypto from "node:crypto";

import { sanitizeAuditValue } from "./audit-sanitizer.js";

export function createAuditRequestId(prefix = "audit") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

export function buildAuditActor({ user = null, system = null, authManager = null } = {}) {
  if (system) {
    return {
      actorType: "system",
      actorUserId: null,
      actorUsername: String(system.username ?? system.name ?? system.id ?? "system"),
      actorRole: "",
      actorGroups: normalizeGroups(system.groups ?? []),
    };
  }

  return {
    actorType: "user",
    actorUserId: textOrNull(user?.id ?? user?.userId ?? user?.username),
    actorUsername: String(user?.username ?? user?.name ?? user?.displayName ?? "unknown"),
    actorRole: String(user?.role ?? ""),
    actorGroups: normalizeGroups(user?.groups ?? user?.permissions ?? user?.permission ?? []),
    isSuperAdmin: Boolean(authManager?.hasEverything?.(user) ?? user?.isSuperAdmin),
  };
}

export function buildAuditRequestInfo(req, { config = null, sourcePage = "", serverId = "", serverName = "" } = {}) {
  return {
    sourcePage: normalizeSourcePage(sourcePage),
    requestMethod: String(req?.method ?? ""),
    requestRoute: String(req?.url ?? "").split("?", 1)[0],
    clientIp: getClientIp(req, config),
    userAgent: String(req?.headers?.["user-agent"] ?? ""),
    serverId: textOrNull(serverId),
    serverName: textOrNull(serverName),
  };
}

export function normalizeAuditTarget(target = {}) {
  if (!target || typeof target !== "object") return {};
  return {
    targetType: textOrNull(target.targetType ?? target.type),
    targetId: textOrNull(target.targetId ?? target.id),
    targetName: textOrNull(target.targetName ?? target.name),
    targetSteamId: textOrNull(target.targetSteamId ?? target.steamId ?? target.steamID),
    targetEosId: textOrNull(target.targetEosId ?? target.eosId ?? target.eosID),
    targetTeamId: optionalNumber(target.targetTeamId ?? target.teamId ?? target.teamID),
    targetSquadId: optionalNumber(target.targetSquadId ?? target.squadId ?? target.squadID),
    ...sanitizeAuditValue(target.extra ?? {}),
  };
}

export function getClientIp(req, config) {
  const trustedProxy = Boolean(
    config?.get?.("web.trustedProxy", false)
    || config?.get?.("audit.trustedProxy", false),
  );
  if (trustedProxy) {
    const forwarded = String(req?.headers?.["x-forwarded-for"] ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)[0];
    if (forwarded) return forwarded;
  }
  return String(req?.socket?.remoteAddress ?? req?.connection?.remoteAddress ?? "");
}

function normalizeGroups(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => String(key).trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeSourcePage(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function textOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function optionalNumber(value) {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
