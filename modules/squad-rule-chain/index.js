// -*- coding: utf-8 -*-

import {
  SQUAD_RULE_CHAIN_MODULE_ID,
  SQUAD_RULE_SOURCES,
  SQUAD_RULE_VIOLATION_EVENT,
  normalizeSquadRuleViolationEvent,
} from "./events.js";

const API_NAME = "squadRuleChain";
const DEFAULT_RECENT_LIMIT = 200;

export function createSquadRuleChainModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: SQUAD_RULE_CHAIN_MODULE_ID,
    source: SQUAD_RULE_CHAIN_MODULE_ID,
    channel: "module",
  }) ?? core.logger;

  const unsubscribers = [];
  const recent = [];
  const stats = {
    handled: 0,
    warned: 0,
    disbanded: 0,
    removed: 0,
    broadcasts: 0,
    errors: 0,
  };

  const api = {
    getState() {
      return {
        recent: recent.slice().reverse(),
        stats: { ...stats },
      };
    },
  };

  return {
    manifest: {
      id: SQUAD_RULE_CHAIN_MODULE_ID,
      name: "Squad Rule Chain",
      kind: "module",
      version: "1.0.0",
      description: "Chains squad-rule pass events and centralizes squad-rule violation handling.",
      hidden: true,
    },
    apiName: API_NAME,
    api,

    async start() {
      if (typeof core?.eventBus?.onModuleEvent === "function") {
        unsubscribers.push(
          core.eventBus.onModuleEvent(
            SQUAD_RULE_CHAIN_MODULE_ID,
            SQUAD_RULE_VIOLATION_EVENT,
            (event) => void handleViolation(event),
          ),
        );
      }
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try { unsubscribe(); } catch {}
      }
    },
  };

  async function handleViolation(input = {}) {
    const event = normalizeSquadRuleViolationEvent(input);
    const record = {
      id: `${SQUAD_RULE_CHAIN_MODULE_ID}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      event,
      actions: [],
      status: "handling",
    };
    remember(recent, record, recentLimit());

    try {
      if (event.removeLeaderBeforeDisband) {
        const removeResult = await removeLeader(event);
        record.actions.push({
          type: removeResult?.ok === false ? "remove_failed" : "removed",
          result: summarizeActionResult(removeResult),
        });
        if (removeResult?.ok !== false) stats.removed += 1;
      }

      if (event.broadcastMessage) {
        const broadcastResult = await broadcastViolation(event);
        record.actions.push({
          type: broadcastResult?.success === false ? "broadcast_failed" : "broadcasted",
          result: summarizeActionResult(broadcastResult),
        });
        if (broadcastResult?.success !== false) stats.broadcasts += 1;
      }

      const disbandResult = await disbandSquad(event);
      record.actions.push({
        type: disbandResult?.ok === false ? "disband_failed" : "disbanded",
        result: summarizeActionResult(disbandResult),
      });
      if (disbandResult?.ok !== false) stats.disbanded += 1;

      const warningMessages = buildWarningMessages(event);
      for (const message of warningMessages) {
        const warnResult = await warnLeader(event, message);
        record.actions.push({
          type: warnResult?.success === false ? "warn_failed" : "warned",
          result: summarizeActionResult(warnResult),
        });
        if (warnResult?.success !== false) stats.warned += 1;
      }

      stats.handled += 1;
      record.status = "handled";
      record.updatedAt = nowIso();
    } catch (error) {
      stats.errors += 1;
      record.status = "error";
      record.error = error instanceof Error ? error.message : String(error);
      record.updatedAt = nowIso();
      moduleLogger?.warn?.(`[SquadRuleChain] failed to handle violation: ${record.error}`);
    }
  }

  async function removeLeader(event) {
    const apiRef = modules?.squadManagement;
    if (!event.leaderName && !event.leaderSteamId && !event.leaderEosId) {
      return { ok: false, skipped: true, skipReason: "target_missing" };
    }
    const request = {
      serverId: event.serverId,
      matchId: event.matchId,
      name: event.leaderName,
      steamId: event.leaderSteamId,
      eosId: event.leaderEosId,
      teamId: event.teamId,
      squadId: event.squadId,
      squadName: event.squadName,
      reason: buildRemoveReason(event),
      source: SQUAD_RULE_CHAIN_MODULE_ID,
      operatorName: SQUAD_RULE_CHAIN_MODULE_ID,
      system: true,
    };
    if (typeof apiRef?.requestRemoveFromSquad === "function") return await apiRef.requestRemoveFromSquad(request);
    if (typeof apiRef?.removeFromSquad === "function") return await apiRef.removeFromSquad(request);
    if (typeof apiRef?.executeAction === "function") return await apiRef.executeAction({ ...request, type: "remove_from_squad" });
    return { ok: false, error: "squad_management_unavailable" };
  }

  async function disbandSquad(event) {
    const apiRef = modules?.squadManagement;
    const request = {
      serverId: event.serverId,
      matchId: event.matchId,
      teamId: event.teamId,
      squadId: event.squadId,
      squadName: event.squadName,
      creatorName: event.leaderName,
      creatorSteamId: event.leaderSteamId,
      creatorEosId: event.leaderEosId,
      reason: event.disbandReason || buildDisbandReason(event),
      source: SQUAD_RULE_CHAIN_MODULE_ID,
      operatorName: SQUAD_RULE_CHAIN_MODULE_ID,
      system: true,
      allowUnverifiedTarget: true,
      allowRefresh: false,
      priority: "high",
      bypassRateLimit: true,
      rconChannel: "disband",
    };
    if (typeof apiRef?.requestDisband === "function") return await apiRef.requestDisband(request);
    if (typeof apiRef?.disband === "function") return await apiRef.disband(request);
    if (typeof apiRef?.executeAction === "function") return await apiRef.executeAction({ ...request, type: "disband_squad" });
    return { ok: false, error: "squad_management_unavailable" };
  }

  async function warnLeader(event, message) {
    const sender = modules?.adminWarn?.sendAdminWarn ?? modules?.adminWarn?.warnPlayer;
    if (typeof sender !== "function") return { success: false, skipped: true, skipReason: "admin_warn_unavailable" };
    if (!event.leaderName) return { success: false, skipped: true, skipReason: "target_missing" };
    return await sender.call(modules.adminWarn, {
      targetName: event.leaderName,
      targetSteamId: event.leaderSteamId || undefined,
      targetEosId: event.leaderEosId || undefined,
      message,
      reason: buildWarnReason(event),
      sourceModule: SQUAD_RULE_CHAIN_MODULE_ID,
      relatedEventId: event.sourceEventId,
      system: true,
    }).catch((error) => ({ success: false, error: error?.message ?? String(error) }));
  }

  async function broadcastViolation(event) {
    const sender = modules?.adminWarn?.broadcastMessage ?? modules?.adminWarn?.sendAdminBroadcast;
    if (typeof sender !== "function") return { success: false, skipped: true, skipReason: "admin_warn_unavailable" };
    return await sender.call(modules.adminWarn, {
      message: event.broadcastMessage,
      reason: `${event.source}_broadcast`,
      sourceModule: SQUAD_RULE_CHAIN_MODULE_ID,
      relatedEventId: event.sourceEventId,
      system: true,
    }).catch((error) => ({ success: false, error: error?.message ?? String(error) }));
  }
}

function buildWarningMessages(event) {
  if (Array.isArray(event.warningMessages) && event.warningMessages.length > 0) {
    return event.warningMessages.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (event.reason) return [event.reason];
  return ["违规建队，已按规则处理。"];
}

function buildWarnReason(event) {
  if (event.source === SQUAD_RULE_SOURCES.squadNameRule) return "squad_name_policy_violation";
  if (event.source === SQUAD_RULE_SOURCES.tieredSquadTime) return "stepwise_squad_playtime_violation";
  if (event.source === SQUAD_RULE_SOURCES.fairSquadCreation) return "fair_squad_guard_violation";
  return "squad_rule_violation";
}

function buildRemoveReason(event) {
  if (event.source === SQUAD_RULE_SOURCES.squadNameRule) return `squad_name_policy_pre_disband_remove: ${event.reason}`.trim();
  if (event.source === SQUAD_RULE_SOURCES.fairSquadCreation) return `公平建队守护：解散前移出队长 ${event.reason}`.trim();
  return `squad_rule_pre_disband_remove: ${event.reason}`.trim();
}

function buildDisbandReason(event) {
  if (event.source === SQUAD_RULE_SOURCES.squadNameRule) return `squad_name_policy_violation: ${event.reason}`.trim();
  if (event.source === SQUAD_RULE_SOURCES.tieredSquadTime) return `阶梯时长守护：${event.reason}`.trim();
  if (event.source === SQUAD_RULE_SOURCES.fairSquadCreation) return `公平建队守护：${event.reason}`.trim();
  return `squad_rule_violation: ${event.reason}`.trim();
}

function summarizeActionResult(result) {
  if (!result || typeof result !== "object") return result ?? null;
  return {
    ok: result.ok ?? result.success ?? null,
    success: result.success ?? result.ok ?? null,
    skipped: result.skipped ?? false,
    error: result.error ?? result.errorMessage ?? result.skipReason ?? "",
    message: result.message ?? "",
    command: result.command ?? result.commandText ?? "",
  };
}

function remember(bucket, record, limit) {
  bucket.push(JSON.parse(JSON.stringify(record)));
  if (bucket.length > limit) {
    bucket.splice(0, bucket.length - limit);
  }
}

function recentLimit() {
  return DEFAULT_RECENT_LIMIT;
}

function nowIso() {
  return new Date().toISOString();
}
