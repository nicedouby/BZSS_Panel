// -*- coding: utf-8 -*-

import { AuditRepository } from "./audit-repository.js";
import {
  buildAuditActor,
  buildAuditRequestInfo,
  createAuditRequestId,
  normalizeAuditTarget,
} from "./audit-context.js";
import { AUDIT_RESULTS } from "./audit-actions.js";
import { sanitizeAuditValue } from "./audit-sanitizer.js";

export class AuditManager {
  constructor({ core = null, config = null, logger = null, repository = null } = {}) {
    this.core = core;
    this.config = config ?? core?.config ?? null;
    this.logger = logger ?? core?.logger ?? null;
    this.repository = repository ?? new AuditRepository({ config: this.config, logger: this.logger });
  }

  async init() {
    await this.repository.init();
  }

  async close() {
    await this.repository.close?.();
  }

  createContext(context = {}) {
    const requestId = String(context.requestId ?? "").trim() || createAuditRequestId();
    const startedAtMs = Number(context.createdAtMs ?? Date.now());
    const actor = buildAuditActor({
      user: context.actor ?? context.user ?? null,
      system: context.systemActor ?? null,
      authManager: this.core?.authManager,
    });
    const requestInfo = buildAuditRequestInfo(context.request, {
      config: this.config,
      sourcePage: context.sourcePage,
      serverId: context.serverId,
      serverName: context.serverName,
    });
    const target = normalizeAuditTarget(context.target ?? {});

    return {
      requestId,
      action: String(context.action ?? "unknown"),
      category: String(context.category ?? "unknown"),
      ...actor,
      ...requestInfo,
      matchId: nullableText(context.matchId),
      targetType: target.targetType,
      targetId: target.targetId,
      targetName: target.targetName,
      targetData: target,
      parameters: sanitizeAuditValue(context.parameters ?? null),
      resultData: sanitizeAuditValue(context.resultData ?? null),
      result: String(context.initialResult ?? AUDIT_RESULTS.RUNNING),
      createdAt: new Date(startedAtMs).toISOString(),
      createdAtMs: startedAtMs,
      relatedRecordId: nullableText(context.relatedRecordId),
    };
  }

  async execute(context, executor, options = {}) {
    const record = this.createContext(context);
    const allowWithoutAudit = Boolean(options.allowWithoutAudit ?? context?.allowWithoutAudit);
    const startedAtMs = record.createdAtMs;
    let inserted = false;

    try {
      await this.repository.insert(record);
      inserted = true;
    } catch (error) {
      this.logger?.error?.(`[AuditManager] pre-action audit insert failed for ${record.action}: ${error.message}`);
      if (!allowWithoutAudit) {
        const auditError = new Error("Audit database is not writable; operation refused.");
        auditError.code = "AuditWriteFailed";
        auditError.statusCode = 503;
        auditError.cause = error;
        throw auditError;
      }
    }

    try {
      const result = await executor({ requestId: record.requestId });
      const finishedAtMs = Date.now();
      if (inserted) {
        await this.repository.updateByRequestId(record.requestId, {
          result: resolveResult(result, context),
          resultData: sanitizeAuditValue(context?.resultDataBuilder ? context.resultDataBuilder(result) : result),
          completedAt: new Date(finishedAtMs).toISOString(),
          durationMs: finishedAtMs - startedAtMs,
          relatedRecordId: context?.relatedRecordIdBuilder
            ? context.relatedRecordIdBuilder(result)
            : options?.relatedRecordIdBuilder
              ? options.relatedRecordIdBuilder(result)
              : context?.relatedRecordId,
        });
      }
      return result;
    } catch (error) {
      const finishedAtMs = Date.now();
      if (inserted) {
        try {
          await this.repository.updateByRequestId(record.requestId, {
            result: error?.code === "Forbidden" || error?.statusCode === 403
              ? AUDIT_RESULTS.FORBIDDEN
              : AUDIT_RESULTS.FAILED,
            errorCode: error?.code ?? error?.name ?? "OperationFailed",
            errorMessage: error?.message ?? String(error),
            completedAt: new Date(finishedAtMs).toISOString(),
            durationMs: finishedAtMs - startedAtMs,
          });
        } catch (auditError) {
          this.logger?.error?.(`[AuditManager] post-error audit update failed for ${record.action}: ${auditError.message}`);
        }
      }
      throw error;
    }
  }

  async write(context = {}) {
    return this.repository.insert(this.createContext(context));
  }

  async update(requestId, patch = {}) {
    return this.repository.updateByRequestId(requestId, {
      ...patch,
      resultData: sanitizeAuditValue(patch.resultData ?? null),
    });
  }

  async list(filter = {}) {
    return this.repository.list(filter);
  }

  async get(idOrRequestId) {
    const text = String(idOrRequestId ?? "").trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) return this.repository.getById(Number(text));
    return this.repository.getByRequestId(text);
  }
}

function resolveResult(result, context = {}) {
  if (context?.result) return String(context.result);
  if (typeof context?.resultResolver === "function") return String(context.resultResolver(result));
  if (result?.auditResult) return String(result.auditResult);
  if (result?.result && typeof result.result === "string") return normalizeResult(result.result);
  if (result?.status && typeof result.status === "string") return normalizeStatusResult(result.status);
  if (result?.ok === false || result?.success === false) return AUDIT_RESULTS.FAILED;
  return AUDIT_RESULTS.SUCCESS;
}

function normalizeStatusResult(status) {
  const text = String(status ?? "").trim().toLowerCase();
  if (text === "queued") return AUDIT_RESULTS.ACCEPTED;
  if (text === "completed") return AUDIT_RESULTS.SUCCESS;
  if (text === "failed") return AUDIT_RESULTS.FAILED;
  if (text === "running") return AUDIT_RESULTS.RUNNING;
  if (text === "cancelled" || text === "canceled") return AUDIT_RESULTS.CANCELLED;
  return normalizeResult(text);
}

function normalizeResult(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (Object.values(AUDIT_RESULTS).includes(text)) return text;
  return text || AUDIT_RESULTS.SUCCESS;
}

function nullableText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}
