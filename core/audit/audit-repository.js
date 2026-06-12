// -*- coding: utf-8 -*-

import { createDatabase } from "../database.js";
import { jsonStringifySafe } from "./audit-sanitizer.js";

const MAX_LIMIT = 500;

export class AuditRepository {
  constructor({ config = null, db = null, logger = null } = {}) {
    this.config = config;
    this.db = db;
    this.logger = logger;
  }

  async init() {
    await this.ensureDb();
  }

  async close() {
    if (this.db?.close) {
      await this.db.close();
      this.db = null;
    }
  }

  async insert(record) {
    const db = await this.ensureDb();
    const row = normalizeRecord(record);
    await db.run(
      `
INSERT INTO web_action_audit_records (
  request_id, action, category,
  actor_type, actor_user_id, actor_username, actor_role, actor_groups_json,
  source_page, request_method, request_route, client_ip, user_agent,
  server_id, server_name, match_id,
  target_type, target_id, target_name, target_data_json,
  parameters_json, result_data_json,
  result, error_code, error_message,
  created_at, created_at_ms, completed_at, duration_ms, related_record_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      row.requestId,
      row.action,
      row.category,
      row.actorType,
      row.actorUserId,
      row.actorUsername,
      row.actorRole,
      jsonStringifySafe(row.actorGroups),
      row.sourcePage,
      row.requestMethod,
      row.requestRoute,
      row.clientIp,
      row.userAgent,
      row.serverId,
      row.serverName,
      row.matchId,
      row.targetType,
      row.targetId,
      row.targetName,
      jsonStringifySafe(row.targetData),
      jsonStringifySafe(row.parameters),
      jsonStringifySafe(row.resultData),
      row.result,
      row.errorCode,
      row.errorMessage,
      row.createdAt,
      row.createdAtMs,
      row.completedAt,
      row.durationMs,
      row.relatedRecordId,
    );
    return this.getByRequestId(row.requestId);
  }

  async updateByRequestId(requestId, patch = {}) {
    const id = String(requestId ?? "").trim();
    if (!id) return null;

    const db = await this.ensureDb();
    const updates = [];
    const values = [];
    const map = {
      result: "result",
      resultData: "result_data_json",
      errorCode: "error_code",
      errorMessage: "error_message",
      completedAt: "completed_at",
      durationMs: "duration_ms",
      relatedRecordId: "related_record_id",
    };

    for (const [key, column] of Object.entries(map)) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
      updates.push(`${column} = ?`);
      values.push(key === "resultData" ? jsonStringifySafe(patch[key]) : patch[key]);
    }

    if (!updates.length) return this.getByRequestId(id);
    values.push(id);
    await db.run(`UPDATE web_action_audit_records SET ${updates.join(", ")} WHERE request_id = ?`, ...values);
    return this.getByRequestId(id);
  }

  async getByRequestId(requestId) {
    const db = await this.ensureDb();
    const row = await db.get("SELECT * FROM web_action_audit_records WHERE request_id = ?", String(requestId ?? ""));
    return row ? mapRow(row) : null;
  }

  async getById(id) {
    const db = await this.ensureDb();
    const row = await db.get("SELECT * FROM web_action_audit_records WHERE id = ?", Number(id));
    return row ? mapRow(row) : null;
  }

  async list(filter = {}) {
    const db = await this.ensureDb();
    const clauses = [];
    const values = [];

    addLike(clauses, values, "actor_username", filter.actor);
    addEqual(clauses, values, "action", filter.action);
    addEqual(clauses, values, "server_id", filter.serverId);
    addEqual(clauses, values, "result", filter.result);
    addLike(clauses, values, "target_name", filter.playerName);
    addLike(clauses, values, "target_id", filter.targetId);
    addLike(clauses, values, "client_ip", filter.clientIp);
    addEqual(clauses, values, "request_id", filter.requestId);

    const steamId = String(filter.steamId ?? "").trim();
    if (steamId) {
      clauses.push("(target_id = ? OR target_data_json LIKE ?)");
      values.push(steamId, `%${escapeLike(steamId)}%`);
    }

    const fromMs = Number(filter.fromMs ?? 0);
    if (Number.isFinite(fromMs) && fromMs > 0) {
      clauses.push("created_at_ms >= ?");
      values.push(fromMs);
    }

    const toMs = Number(filter.toMs ?? 0);
    if (Number.isFinite(toMs) && toMs > 0) {
      clauses.push("created_at_ms <= ?");
      values.push(toMs);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = clampLimit(filter.limit, 100, MAX_LIMIT);
    const offset = Math.max(0, Number.parseInt(String(filter.offset ?? 0), 10) || 0);

    const rows = await db.all(
      `SELECT * FROM web_action_audit_records ${where} ORDER BY created_at_ms DESC, id DESC LIMIT ? OFFSET ?`,
      ...values,
      limit,
      offset,
    );
    const totalRow = await db.get(
      `SELECT COUNT(*) AS count FROM web_action_audit_records ${where}`,
      ...values,
    );
    return {
      items: rows.map(mapRow),
      total: Number(totalRow?.count ?? 0),
      limit,
      offset,
    };
  }

  async ensureDb() {
    if (this.db) return this.db;
    this.db = await createDatabase(this.config?.get?.("database", {}) ?? {});
    return this.db;
  }
}

function normalizeRecord(record = {}) {
  const createdAtMs = Number(record.createdAtMs ?? Date.now());
  return {
    requestId: String(record.requestId ?? "").trim(),
    action: String(record.action ?? "unknown"),
    category: String(record.category ?? "unknown"),
    actorType: String(record.actorType ?? "user"),
    actorUserId: nullableText(record.actorUserId),
    actorUsername: String(record.actorUsername ?? "unknown"),
    actorRole: nullableText(record.actorRole),
    actorGroups: Array.isArray(record.actorGroups) ? record.actorGroups : [],
    sourcePage: nullableText(record.sourcePage),
    requestMethod: nullableText(record.requestMethod),
    requestRoute: nullableText(record.requestRoute),
    clientIp: nullableText(record.clientIp),
    userAgent: nullableText(record.userAgent),
    serverId: nullableText(record.serverId),
    serverName: nullableText(record.serverName),
    matchId: nullableText(record.matchId),
    targetType: nullableText(record.targetType),
    targetId: nullableText(record.targetId),
    targetName: nullableText(record.targetName),
    targetData: record.targetData ?? null,
    parameters: record.parameters ?? null,
    resultData: record.resultData ?? null,
    result: String(record.result ?? "running"),
    errorCode: nullableText(record.errorCode),
    errorMessage: nullableText(record.errorMessage),
    createdAt: String(record.createdAt ?? new Date(createdAtMs).toISOString()),
    createdAtMs,
    completedAt: nullableText(record.completedAt),
    durationMs: optionalNumber(record.durationMs),
    relatedRecordId: nullableText(record.relatedRecordId),
  };
}

function mapRow(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    action: row.action,
    category: row.category,
    actorType: row.actor_type,
    actorUserId: row.actor_user_id,
    actorUsername: row.actor_username,
    actorRole: row.actor_role,
    actorGroups: parseJson(row.actor_groups_json, []),
    sourcePage: row.source_page,
    requestMethod: row.request_method,
    requestRoute: row.request_route,
    clientIp: row.client_ip,
    userAgent: row.user_agent,
    serverId: row.server_id,
    serverName: row.server_name,
    matchId: row.match_id,
    targetType: row.target_type,
    targetId: row.target_id,
    targetName: row.target_name,
    targetData: parseJson(row.target_data_json, null),
    parameters: parseJson(row.parameters_json, null),
    resultData: parseJson(row.result_data_json, null),
    result: row.result,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    createdAtMs: row.created_at_ms,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    relatedRecordId: row.related_record_id,
  };
}

function parseJson(value, fallback) {
  try {
    return value == null || value === "" ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function nullableText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function optionalNumber(value) {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function addEqual(clauses, values, column, value) {
  const text = String(value ?? "").trim();
  if (!text) return;
  clauses.push(`${column} = ?`);
  values.push(text);
}

function addLike(clauses, values, column, value) {
  const text = String(value ?? "").trim();
  if (!text) return;
  clauses.push(`${column} LIKE ? ESCAPE '\\'`);
  values.push(`%${escapeLike(text)}%`);
}

function escapeLike(value) {
  return String(value ?? "").replace(/[\\%_]/g, (match) => `\\${match}`);
}

function clampLimit(value, fallback, max) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(number, max);
}
