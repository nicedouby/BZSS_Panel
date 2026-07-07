// -*- coding: utf-8 -*-

import {
  buildCoreControlBaseUrl,
  buildCoreControlHeaders,
  formatRevisionQuery,
  normalizeCoreControlConfig,
} from "./core-control-protocol.js";

export class CoreControlClient {
  constructor({ config, logger, fetchImpl = globalThis.fetch }) {
    this.config = normalizeCoreControlConfig(config, process.env);
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    this.baseUrl = buildCoreControlBaseUrl(this.config);
    this.headers = buildCoreControlHeaders(this.config);
    this.cache = new Map();
    this.inFlight = new Map();
    this.lastCoreLatencyMs = null;
    this.lastSnapshotFetchedAt = 0;
    this.lastSnapshotRevisions = {};
  }

  getHealth() {
    return this.requestJson("/internal/health", { cacheTtlMs: 0 });
  }

  async getSnapshotAll({ since = null, cacheTtlMs = this.config.snapshotCacheTtlMs } = {}) {
    const query = since ? `?since=${encodeURIComponent(formatRevisionQuery(since))}` : "";
    const startedAt = Date.now();
    const response = await this.request(`/internal/snapshot/all${query}`, { cacheTtlMs });
    this.lastCoreLatencyMs = Date.now() - startedAt;
    if (response.status === 204) {
      return { ok: true, notModified: true, revisions: since ?? this.lastSnapshotRevisions, patch: {} };
    }
    const data = await response.json();
    this.lastSnapshotFetchedAt = Date.now();
    this.lastSnapshotRevisions = data?.revisions ?? this.lastSnapshotRevisions;
    return data;
  }

  getSnapshotServer() {
    return this.requestJson("/internal/snapshot/server", { cacheTtlMs: this.config.snapshotCacheTtlMs });
  }

  getSnapshotPlayers() {
    return this.requestJson("/internal/snapshot/players", { cacheTtlMs: this.config.snapshotCacheTtlMs });
  }

  getSnapshotSquads() {
    return this.requestJson("/internal/snapshot/squads", { cacheTtlMs: this.config.snapshotCacheTtlMs });
  }

  getTacticalStateV2Snapshot() {
    return this.requestJson("/internal/tactical-state-v2/snapshot", { cacheTtlMs: this.config.tacticalSnapshotCacheTtlMs });
  }

  getConsoleRecent(query = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === "") continue;
      params.set(key, String(value));
    }
    const suffix = params.size ? `?${params}` : "";
    return this.requestJson(`/internal/console/recent${suffix}`, { cacheTtlMs: this.config.consoleRecentCacheTtlMs });
  }

  getRconStatus() {
    return this.requestJson("/internal/rcon/status", { cacheTtlMs: 0 });
  }

  dispatchRconCommand(command, actor = null) {
    return this.requestJson("/internal/rcon/dispatch", {
      method: "POST",
      body: { command, actor },
      cacheTtlMs: 0,
    });
  }

  getWarmupState() {
    return this.requestJson("/internal/server/warmup", { cacheTtlMs: 0 });
  }

  setWarmupState(isWarmup, actor = null) {
    return this.requestJson("/internal/server/warmup", {
      method: "POST",
      body: { isWarmup, actor },
      cacheTtlMs: 0,
    });
  }

  getSnapshotCacheAgeMs() {
    return this.lastSnapshotFetchedAt > 0 ? Math.max(0, Date.now() - this.lastSnapshotFetchedAt) : null;
  }

  setLogClockSeconds(body = {}) {
    return this.requestJson("/internal/log-clock/set", {
      method: "POST",
      body,
      cacheTtlMs: 0,
    });
  }

  resetLogClock(body = {}) {
    return this.requestJson("/internal/log-clock/reset", {
      method: "POST",
      body,
      cacheTtlMs: 0,
    });
  }

  getPlugins() {
    return this.requestJson("/internal/plugins", { cacheTtlMs: 0 });
  }

  proxyApi({ path, search = "", method = "GET", body = undefined } = {}) {
    return this.requestJson(`${String(path ?? "")}${String(search ?? "")}`, {
      method,
      body,
      cacheTtlMs: 0,
    });
  }

  getPluginSubscriptionsState() {
    return this.requestJson("/internal/plugin-subscriptions/state", { cacheTtlMs: 0 });
  }

  setPluginSubscription(id, subscribed) {
    return this.requestJson("/internal/plugin-subscriptions/set", {
      method: "POST",
      body: { id, subscribed },
      cacheTtlMs: 0,
    });
  }

  togglePluginSubscription(id) {
    return this.requestJson("/internal/plugin-subscriptions/toggle", {
      method: "POST",
      body: { id },
      cacheTtlMs: 0,
    });
  }

  getUdpEventForwarderState(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/plugins/udp-event-forwarder/state", query), { cacheTtlMs: 0 });
  }

  getGroupReportSnapshot() {
    return this.requestJson("/internal/plugins/group-report/snapshot", { cacheTtlMs: 0 });
  }

  getGroupReportGroups() {
    return this.requestJson("/internal/plugins/group-report/groups", { cacheTtlMs: 0 });
  }

  createGroupReportGroup(body = {}) {
    return this.requestJson("/internal/plugins/group-report/groups", {
      method: "POST",
      body,
      cacheTtlMs: 0,
    });
  }

  deleteAllGroupReportGroups() {
    return this.requestJson("/internal/plugins/group-report/groups", {
      method: "DELETE",
      cacheTtlMs: 0,
    });
  }

  updateGroupReportGroup(id, body = {}) {
    return this.requestJson(`/internal/plugins/group-report/groups/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
      cacheTtlMs: 0,
    });
  }

  deleteGroupReportGroup(id) {
    return this.requestJson(`/internal/plugins/group-report/groups/${encodeURIComponent(id)}`, {
      method: "DELETE",
      cacheTtlMs: 0,
    });
  }

  addGroupReportMember(id, body = {}) {
    return this.requestJson(`/internal/plugins/group-report/groups/${encodeURIComponent(id)}/members`, {
      method: "POST",
      body,
      cacheTtlMs: 0,
    });
  }

  updateGroupReportMember(id, memberId, body = {}) {
    return this.requestJson(`/internal/plugins/group-report/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`, {
      method: "PATCH",
      body,
      cacheTtlMs: 0,
    });
  }

  clearGroupReportMembers(id) {
    return this.requestJson(`/internal/plugins/group-report/groups/${encodeURIComponent(id)}/members`, {
      method: "DELETE",
      cacheTtlMs: 0,
    });
  }

  deleteGroupReportMember(id, memberId) {
    return this.requestJson(`/internal/plugins/group-report/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`, {
      method: "DELETE",
      cacheTtlMs: 0,
    });
  }

  getFairSquadGuardStatus() {
    return this.requestJson("/internal/plugins/fair-squad-guard/status", { cacheTtlMs: 0 });
  }

  getFairSquadGuardRecords(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/plugins/fair-squad-guard/records", query), { cacheTtlMs: 0 });
  }

  unlockFairSquadGuardCurrentRound(body = {}) {
    return this.requestJson("/internal/plugins/fair-squad-guard/unlock-current-round", {
      method: "POST",
      body,
      cacheTtlMs: 0,
    });
  }

  resetFairSquadGuardSession(body = {}) {
    return this.requestJson("/internal/plugins/fair-squad-guard/reset-session", {
      method: "POST",
      body,
      cacheTtlMs: 0,
    });
  }

  patchFairSquadGuardEnabled(body = {}) {
    return this.requestJson("/internal/plugins/fair-squad-guard/enabled", {
      method: "PATCH",
      body,
      cacheTtlMs: 0,
    });
  }

  patchFairSquadGuardConfig(body = {}) {
    return this.requestJson("/internal/plugins/fair-squad-guard/config", {
      method: "PATCH",
      body,
      cacheTtlMs: 0,
    });
  }

  getFairTeamBalanceState() {
    return this.requestJson("/internal/plugins/fair-team-balance/state", { cacheTtlMs: 0 });
  }

  getFairTeamBalanceRequests() {
    return this.requestJson("/internal/plugins/fair-team-balance/requests", { cacheTtlMs: 0 });
  }

  getFairTeamBalanceHistory(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/plugins/fair-team-balance/history", query), { cacheTtlMs: 0 });
  }

  approveFairTeamBalance(body = {}) {
    return this.requestJson("/internal/plugins/fair-team-balance/approve", {
      method: "POST",
      body,
      cacheTtlMs: 0,
    });
  }

  rejectFairTeamBalance(body = {}) {
    return this.requestJson("/internal/plugins/fair-team-balance/reject", {
      method: "POST",
      body,
      cacheTtlMs: 0,
    });
  }

  resetFairTeamBalancePeriodQuotas() {
    return this.requestJson("/internal/plugins/fair-team-balance/reset-period-quotas", {
      method: "POST",
      cacheTtlMs: 0,
    });
  }

  resetFairTeamBalanceRound() {
    return this.requestJson("/internal/plugins/fair-team-balance/reset-round", {
      method: "POST",
      cacheTtlMs: 0,
    });
  }

  resetFairTeamBalancePlayerQuota(body = {}) {
    return this.requestJson("/internal/plugins/fair-team-balance/reset-player-quota", {
      method: "POST",
      body,
      cacheTtlMs: 0,
    });
  }

  clearFairTeamBalanceHistory() {
    return this.requestJson("/internal/plugins/fair-team-balance/clear-history", {
      method: "POST",
      cacheTtlMs: 0,
    });
  }

  clearWeaponCollector(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/weapon-collector/clear", query), {
      method: "POST",
      cacheTtlMs: 0,
    });
  }

  getTacticalMapReplaySegments() {
    return this.requestJson("/internal/tactical-map-replay/segments", { cacheTtlMs: 0 });
  }

  getTacticalMapReplaySegment(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/tactical-map-replay/segment", query), { cacheTtlMs: 0 });
  }

  createTacticalMapReplayExport(body = {}) {
    return this.requestJson("/internal/tactical-map-replay/export", {
      method: "POST",
      body,
      cacheTtlMs: 0,
    });
  }

  getTacticalMapReplayExportTasks(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/tactical-map-replay/export-tasks", query), { cacheTtlMs: 0 });
  }

  getRemoteTelemetryState() {
    return this.requestJson("/internal/remote-telemetry/state", { cacheTtlMs: 0 });
  }

  writeRemoteTelemetryTickets(body = {}) {
    return this.requestJson("/internal/remote-telemetry/write-tickets", {
      method: "POST",
      body,
      cacheTtlMs: 0,
    });
  }

  adjustRemoteTelemetryTickets(body = {}) {
    return this.requestJson("/internal/remote-telemetry/adjust-tickets", {
      method: "POST",
      body,
      cacheTtlMs: 0,
    });
  }

  getChatHistory() {
    return this.requestJson("/internal/chat/history", { cacheTtlMs: 0 });
  }

  getChatStats() {
    return this.requestJson("/internal/chat/stats", { cacheTtlMs: 0 });
  }

  getCombatManagerOverview(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/combat-manager/overview", query), { cacheTtlMs: 0 });
  }

  getCombatManagerEvents(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/combat-manager/events", query), { cacheTtlMs: 0 });
  }

  getCombatManagerRates(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/combat-manager/rates", query), { cacheTtlMs: 0 });
  }

  getCombatManagerPlayerEvents(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/combat-manager/player-events", query), { cacheTtlMs: 0 });
  }

  getCombatManagerCache(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/combat-manager/cache", query), { cacheTtlMs: 0 });
  }

  clearCombatManager(body = {}, query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/combat-manager/clear", query), {
      method: "POST",
      body,
      cacheTtlMs: 0,
    });
  }

  getCombatLogsStatus() {
    return this.requestJson("/internal/combat-logs/status", { cacheTtlMs: 0 });
  }

  getCombatLogsMonths() {
    return this.requestJson("/internal/combat-logs/months", { cacheTtlMs: 0 });
  }

  getCombatLogsFiles(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/combat-logs/files", query), { cacheTtlMs: 0 });
  }

  getCombatLogsRead(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/combat-logs/read", query), { cacheTtlMs: 0 });
  }

  getBattleLogStatus(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/battle-log/status", query), { cacheTtlMs: 0 });
  }

  getBattleLogOverview(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/battle-log/overview", query), { cacheTtlMs: 0 });
  }

  getBattleLogEvents(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/battle-log/events", query), { cacheTtlMs: 0 });
  }

  getBattleLogPlayer(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/battle-log/player", query), { cacheTtlMs: 0 });
  }

  getBattleLogRates(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/battle-log/rates", query), { cacheTtlMs: 0 });
  }

  clearBattleLog(body = {}, query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/battle-log/clear", query), {
      method: "POST",
      body,
      cacheTtlMs: 0,
    });
  }

  getLogPostState() {
    return this.requestJson("/internal/logpost/state", { cacheTtlMs: 0 });
  }

  getLogPostRaw(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/logpost/raw", query), { cacheTtlMs: 0 });
  }

  getLogPostEvents(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/logpost/events", query), { cacheTtlMs: 0 });
  }

  getLogPostGaps() {
    return this.requestJson("/internal/logpost/gaps", { cacheTtlMs: 0 });
  }

  getLogPostOutbox(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/logpost/v2/outbox", query), { cacheTtlMs: 0 });
  }

  getLogPostSafety(query = {}) {
    return this.requestJson(this.buildPathWithQuery("/internal/logpost/v2/safety", query), { cacheTtlMs: 0 });
  }

  requestLogPostReplay(body = {}) {
    return this.requestJson("/internal/logpost/v2/replay", {
      method: "POST",
      body,
      cacheTtlMs: 0,
    });
  }

  requestLogPostCheckpointRepair(body = {}) {
    return this.requestJson("/internal/logpost/v2/checkpoint/repair", {
      method: "POST",
      body,
      cacheTtlMs: 0,
    });
  }

  buildPathWithQuery(path, query = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value == null || value === "") continue;
      params.set(key, String(value));
    }
    return params.size ? `${path}?${params.toString()}` : path;
  }

  async requestJson(path, options = {}) {
    const response = await this.request(path, options);
    return response.json();
  }

  async request(path, options = {}) {
    const method = String(options.method ?? "GET").toUpperCase();
    const cacheTtlMs = Number(options.cacheTtlMs ?? 0);
    const cacheKey = `${method} ${path}`;
    const now = Date.now();
    if (cacheTtlMs > 0 && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (cached.expiresAt > now) return cached.response.clone();
    }
    if (this.inFlight.has(cacheKey)) {
      const shared = await this.inFlight.get(cacheKey);
      return shared.clone();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    const task = this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...this.headers,
        ...(options.body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    }).then((response) => {
      if (!response.ok && response.status !== 204) {
        return response.text().then((text) => {
          const error = new Error(`Core control request failed: ${response.status}`);
          error.statusCode = response.status;
          error.responseText = text;
          throw error;
        });
      }
      if (cacheTtlMs > 0) {
        this.cache.set(cacheKey, {
          expiresAt: Date.now() + cacheTtlMs,
          response: response.clone(),
        });
      }
      return response;
    }).finally(() => {
      clearTimeout(timeout);
      this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, task);
    return (await task).clone();
  }
}
