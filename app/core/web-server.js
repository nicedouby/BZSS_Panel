// -*- coding: utf-8 -*-

import http from "node:http";
import { createReadStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { BzssCoreCommandService } from "./bzss-core-command-service.js";
import { BZSS_CORE_BOOL_KEYS } from "./bzss-core-variable-state-service.js";
import { DeveloperToolsService } from "./developer-tools-service.js";

const requestStorage = new AsyncLocalStorage();
import { handleSquadManagementRoutes } from "../modules/squad-management/routes.js";
import { handleTeamBalanceRoutes } from "../modules/team-balance/routes.js";
import { handleReserveSlotsRoutes } from "../modules/reserve-slots/routes.js";
import { handleWarmupReserveGrantRoutes } from "../modules/warmup-reserve-grant/routes.js";
import { handleBlackEdgePrivilegeRoutes } from "../modules/black-edge-privilege/routes.js";
import { handleAstrbotBridgeRoutes } from "../modules/astrbot-bridge/routes.js";
import { handleTacticalStateRoutes } from "../modules/tactical-state/routes.js";
import { handleStepCounterRoutes } from "../modules/step-counter/routes.js";
import { handleDynamicPressureZoneRoutes } from "../modules/dynamic-pressure-zone/routes.js";
import { handlePressureZoneRulesRoutes } from "../modules/pressure-zone-rules/routes.js";
import { handleTacticalStateV2Routes } from "../modules/tactical-state-v2/routes.js";
import { handleTacticalFeedWriterRoutes } from "../modules/tactical-feed-writer/routes.js";
import {
  readSquadNamePolicyState,
  resolveSquadNamePolicyPath,
  saveSquadNamePolicyState,
  testSquadNamePolicy,
  validatePolicyDocument,
} from "../domain/squad-name-policy/index.js";
import {
  getAllPlugins,
  setPluginEnabled as updatePluginEnabled,
  updatePluginConfig as updatePluginManifestConfig,
} from "./plugins/plugin.service.js";
import { AUDIT_ACTIONS, AUDIT_CATEGORIES, AUDIT_RESULTS, AUDIT_SOURCE_PAGES } from "./audit/audit-actions.js";
import { sanitizeRconCommand } from "./audit/audit-sanitizer.js";
import { verifyPassword, hashPassword } from "./auth-crypto.js";

const MAX_JSON_BODY_BYTES = 1024 * 1024;
const MAX_WS_FRAME_BYTES = 1024 * 1024; // WebSocket max frame size 1MB
const MAX_WS_BUFFERED_BYTES = 1024 * 1024;
const MAX_LOCAL_JOB_HISTORY = 200;
const LOCAL_JOB_TTL_MS = 60 * 60 * 1000;
const TACTICAL_MAP_VIEWER_TTL_MS = 45 * 1000;

/**
 * Base security headers
 * Cache-Control is not included
 */
const BASE_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-XSS-Protection": "0", // Modern browsers have built-in XSS protection
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' wss: ws:",
};

function normalizeAdminSteam64ForRequest(value) {
  if (value === null || value === undefined) return null;
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d{17}$/.test(text)) {
    const error = new Error("Steam64 must be a 17-digit number.");
    error.statusCode = 400;
    error.code = "InvalidSteam64";
    throw error;
  }
  return text;
}

export class WebServer {
  constructor({ config, logger, core, modules }) {
    this.enabled = config.enabled ?? true;
    this.host = config.host ?? "127.0.0.1";
    this.port = Number(config.port ?? 8899);
    this.useVueClient = Boolean(config.useVueClient);
    this.staticDirectory = path.resolve(
      process.cwd(),
      this.useVueClient ? "./web-client/dist" : (config.staticDirectory ?? "./app/web"),
    );

    this.logger = logger;
    this.core = core;
    this.modules = modules;
    this.bzssCoreVariableStateService = core.bzssCoreVariableStateService;
    this.bzssCoreCommandService = core.bzssCoreCommandService ?? new BzssCoreCommandService({
      config: core.config,
      logger,
    });
    this.developerToolsService = new DeveloperToolsService({ logger });
    this.server = null;
    this.jobs = new Map();
    this.jobCounter = 0;
    this.consoleConnections = new Set();
    this.chatConnections = new Set();
    this.tacticalMapViewers = new Map();
    this.consoleSubscription = null;
    this.chatSubscription = null;

    // Trusted proxy IPs list. Only requests from these IPs will trust X-Forwarded-For.
    // Empty list means do not trust any forwarded headers (direct access scenario).
    const trustedProxies = config.trustedProxies ?? [];
    this.trustedProxies = new Set(Array.isArray(trustedProxies) ? trustedProxies : [trustedProxies]);

    this.memoryHistory = [];
    this.maxMemoryHistoryPoints = 120;
    this.memoryInterval = null;
    this.initialMatchHydration = null;
  }

  async start() {
    if (!this.enabled) {
      this.logger.info("WebServer disabled.");
      return;
    }

    await this.warnIfStaticIndexMissing();

    this.server = http.createServer((req, res) => {
      requestStorage.run({ req }, () => {
        this.handleRequest(req, res).catch((error) => {
          const statusCode = error.statusCode ?? 500;
          if (statusCode >= 500) {
            this.logger.error(`Web request failed: ${error.stack ?? error}`);
          } else {
            this.logger.warn(`Web request rejected: ${statusCode} ${error.code ?? error.message}`);
          }
          this.json(res, statusCode, {
            error: error.code ?? "InternalServerError",
            message: error.message,
          });
        });
      });
    });

    this.server.on("upgrade", (req, socket, head) => {
      this.handleUpgrade(req, socket, head).catch((error) => {
        this.logger.warn(`WebSocket upgrade rejected: ${error?.message ?? error}`);
        try {
          socket.destroy();
        } catch {}
      });
    });

    if (this.core.console?.subscribe) {
      this.consoleSubscription = this.core.console.subscribe((entry) => {
        this.broadcastConsoleEntry(entry);
      });
    }

    if (typeof this.modules.chatManager?.on === "function") {
      this.chatSubscription = this.modules.chatManager.on("message", (entry) => {
        this.broadcastChatEntry(entry);
      });
    }

    await new Promise((resolve) => {
      this.server.listen(this.port, this.host, resolve);
    });

    // Start tracking memory history
    this.memoryHistory = [];
    const recordMemory = () => {
      try {
        const mem = process.memoryUsage();
        const runtimeState = this.core.runtimeState?.state;
        const rcon = this.core.rconManager?.squadRcon;
        let tacticalDiagnostics = {};
        try {
          tacticalDiagnostics = this.modules.tacticalState?.getDiagnostics?.() ?? {};
        } catch (error) {
          this.logger.warn?.(`Failed to collect Tactical State diagnostics: ${error.message}`);
        }

        this.memoryHistory.push({
          timestamp: Date.now(),
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          external: mem.external,
          arrayBuffers: mem.arrayBuffers,
          diagnostics: {
            consoleConnections: this.consoleConnections.size,
            chatConnections: this.chatConnections.size,
            localJobs: this.jobs.size,
            runtimeRawEvents: runtimeState?.events?.raw?.length ?? 0,
            runtimeRconEvents: runtimeState?.events?.rcon?.length ?? 0,
            runtimeRoundEvents: runtimeState?.events?.round?.length ?? 0,
            runtimeCombatEvents: runtimeState?.events?.combat?.length ?? 0,
            runtimeConsoleEvents: runtimeState?.events?.console?.length ?? 0,
            runtimeJobs: Object.keys(runtimeState?.jobs?.byId ?? {}).length,
            rconResponseQueue: rcon?._responseQueue?.length ?? 0,
            rconCallbackIds: rcon?._callbackIds?.length ?? 0,
            rconIncomingBytes: rcon?._incomingData?.byteLength ?? 0,
            fileIOQueuedBytes: this.core.fileIO?.getPublicDiagnostics?.()?.queuedBytes ?? 0,
            fileIOActiveChannels: this.core.fileIO?.getPublicDiagnostics?.()?.activeChannels ?? 0,
            tacticalSubscribers: tacticalDiagnostics.subscriberCount ?? 0,
            tacticalProfileCache: tacticalDiagnostics.profileCacheSize ?? 0,
          },
        });
        if (this.memoryHistory.length > this.maxMemoryHistoryPoints) {
          this.memoryHistory.shift();
        }
      } catch (err) {
        this.logger.error(`Failed to collect process memory: ${err.message}`);
      }
    };
    recordMemory(); // Record first data point immediately
    this.memoryInterval = setInterval(recordMemory, 10000);

    this.logger.info(`WebServer listening on http://${this.host}:${this.port}`);
  }

  async stop() {
    if (this.memoryInterval) {
      clearInterval(this.memoryInterval);
      this.memoryInterval = null;
    }

    if (!this.server) return;

    if (typeof this.consoleSubscription === "function") {
      try {
        this.consoleSubscription();
      } catch {}
      this.consoleSubscription = null;
    }

    for (const client of this.consoleConnections) {
      try {
        client.socket.end();
      } catch {}
    }
    this.consoleConnections.clear();

    if (typeof this.chatSubscription === "function") {
      try {
        this.chatSubscription();
      } catch {}
      this.chatSubscription = null;
    }

    for (const client of this.chatConnections) {
      try {
        client.socket.end();
      } catch {}
    }
    this.chatConnections.clear();

    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
  }

  async handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      const startMs = Date.now();
      try {
        return await this.handleApi(url, req, res);
      } finally {
        const durationMs = Date.now() - startMs;
        this.recordApiDuration(url.pathname, durationMs);
      }
    }

    return this.serveStatic(url, req, res);
  }

  recordApiDuration(endpoint, durationMs) {
    if (!this.slowApiRequests) this.slowApiRequests = [];
    const now = Date.now();
    this.slowApiRequests = this.slowApiRequests.filter(r => now - r.timestamp < 60000);
    if (durationMs > 50) {
      this.slowApiRequests.push({ endpoint, durationMs, timestamp: now });
      this.slowApiRequests.sort((a, b) => b.durationMs - a.durationMs);
      if (this.slowApiRequests.length > 10) {
        this.slowApiRequests.pop();
      }
    }
  }

  getTacticalMapViewerId(user) {
    const value = user?.id ?? user?.userId ?? user?.username ?? user?.name;
    const viewerId = String(value ?? "").trim();
    return viewerId || null;
  }

  normalizeTacticalMapViewerSessionId(value) {
    const sessionId = String(value ?? "").trim();
    return /^[A-Za-z0-9_-]{1,128}$/.test(sessionId) ? sessionId : null;
  }

  pruneTacticalMapViewers(now = Date.now()) {
    for (const [viewerId, sessions] of this.tacticalMapViewers) {
      for (const [sessionId, lastSeenAt] of sessions) {
        if (now - lastSeenAt > TACTICAL_MAP_VIEWER_TTL_MS) {
          sessions.delete(sessionId);
        }
      }
      if (!sessions.size) this.tacticalMapViewers.delete(viewerId);
    }
  }

  touchTacticalMapViewer(user, sessionId) {
    const now = Date.now();
    const viewerId = this.getTacticalMapViewerId(user);
    const normalizedSessionId = this.normalizeTacticalMapViewerSessionId(sessionId);
    if (viewerId && normalizedSessionId) {
      const sessions = this.tacticalMapViewers.get(viewerId) ?? new Map();
      sessions.set(normalizedSessionId, now);
      this.tacticalMapViewers.set(viewerId, sessions);
    }
    this.pruneTacticalMapViewers(now);
    return this.tacticalMapViewers.size;
  }

  removeTacticalMapViewer(user, sessionId) {
    const viewerId = this.getTacticalMapViewerId(user);
    const normalizedSessionId = this.normalizeTacticalMapViewerSessionId(sessionId);
    const sessions = viewerId ? this.tacticalMapViewers.get(viewerId) : null;
    if (sessions && normalizedSessionId) {
      sessions.delete(normalizedSessionId);
      if (!sessions.size) this.tacticalMapViewers.delete(viewerId);
    }
    this.pruneTacticalMapViewers();
    return this.tacticalMapViewers.size;
  }

  async runTimedPlayerDatabaseQuery(endpoint, playerId, handler) {
    const startedAt = Date.now();
    try {
      return await handler();
    } finally {
      const durationMs = Date.now() - startedAt;
      if (durationMs > 300) {
        const message = `[slow-query] endpoint=${endpoint} playerId=${playerId ?? "null"} durationMs=${durationMs}`;
        if (durationMs > 1000 && typeof this.logger.error === "function") {
          this.logger.error(message);
        } else if (typeof this.logger.warn === "function") {
          this.logger.warn(message);
        } else {
          this.logger.info(message);
        }
      }
    }
  }

  async handleApi(url, req, res) {
    if (url.pathname === "/api/health" && req.method === "GET") {
      return this.json(res, 200, {
        ok: true,
        service: "BZSS Panel WebServer",
        time: new Date().toISOString(),
        uptimeMs: Math.floor(process.uptime() * 1000),
        web: {
          host: this.host,
          port: this.port,
          useVueClient: this.useVueClient,
          staticDirectory: this.staticDirectory,
          mode: this.useVueClient ? "vue" : "legacy",
        },
        auth: {
          enabled: Boolean(this.core.authManager?.enabled),
        },
        rcon: this.core.rconManager?.getStatus?.() ?? null,
        runtimeState: Boolean(this.core.runtimeState),
        fileIO: this.core.fileIO?.getPublicDiagnostics?.() ?? null,
      });
    }

    if (url.pathname === "/api/auth/session") {
      const user = this.core.authManager?.getUserFromRequest(req) ?? null;
      return this.json(res, 200, {
        authenticated: Boolean(user),
        user: user ? this.serializeAuthSessionUser(user) : null,
      });
    }

    if (url.pathname === "/api/developer-tools/status" && req.method === "GET") {
      const user = this.core.authManager?.getUserFromRequest(req);
      if (!this.requireSuperAdmin(user, res)) return;
      try {
        return this.json(res, 200, await this.developerToolsService.getStatus());
      } catch (error) {
        return this.json(res, 500, { ok: false, error: error?.code ?? "DeveloperStatusFailed", message: error?.message ?? "Unable to read repository status." });
      }
    }

    if (url.pathname === "/api/developer-tools/run" && req.method === "POST") {
      const user = this.core.authManager?.getUserFromRequest(req);
      const body = await this.readJsonBody(req);
      if (!this.requireSuperAdmin(user, res)) return;
      const operation = String(body?.operation ?? "").trim();
      try {
        const result = await this.developerToolsService.run(operation);
        return this.json(res, result.ok ? 200 : 409, result);
      } catch (error) {
        return this.json(res, 400, { ok: false, operation, error: error?.code ?? "DeveloperCommandFailed", message: error?.message ?? "Developer command failed." });
      }
    }

    if (url.pathname === "/api/developer-tools/restart" && req.method === "POST") {
      const user = this.core.authManager?.getUserFromRequest(req);
      if (!this.requireSuperAdmin(user, res)) return;
      const result = await this.developerToolsService.scheduleRestart();
      return this.json(res, result.ok ? 202 : 409, result);
    }

    if (url.pathname === "/api/auth/me/profile" && req.method === "GET") {
      const user = this.core.authManager?.getUserFromRequest(req) ?? null;
      return this.json(res, 200, {
        authenticated: Boolean(user),
        user: user ? await this.enrichAuthUserWithSteamAvatar(user) : null,
      });
    }
    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const result = await this.core.authManager.login({
        username: body.username,
        password: body.password,
        ip: this.getRequestIp(req),
      });

      if (!result.ok) {
        const statusCode = result.error === "AuthDisabled" ? 503 : 401;
        return this.json(res, statusCode, {
          ok: false,
          error: result.error ?? "InvalidCredentials",
          message: result.error === "AuthDisabled"
            ? "Authentication is disabled."
            : "Invalid username or password.",
        });
      }

      return this.json(res, 200, {
        ok: true,
        authenticated: true,
        user: await this.enrichAuthUserWithSteamAvatar(result.user),
      }, {
        "Set-Cookie": result.cookie,
      });
    }

    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      const expiredCookie = this.core.authManager.logout(req);
      return this.json(res, 200, {
        ok: true,
        authenticated: false,
      }, {
        "Set-Cookie": expiredCookie,
      });
    }

    if (url.pathname === "/api/astrbot/panel-status" && req.method === "GET") {
      const panelUser = this.core.authManager?.getUserFromRequest(req);
      if (!panelUser) return this.json(res, 401, { error: "AuthenticationRequired" });
      if (!this.requireSuperAdmin(panelUser, res)) return;
      const bridge = this.modules.astrbotBridge;
      if (!bridge?.getState) return this.json(res, 404, { error: "AstrBotBridgeUnavailable" });
      return this.json(res, 200, {
        ok: true,
        data: bridge.getState(),
      });
    }

    if (url.pathname === "/api/astrbot/panel-test/match-finished" && req.method === "POST") {
      const panelUser = this.core.authManager?.getUserFromRequest(req);
      if (!panelUser) return this.json(res, 401, { error: "AuthenticationRequired" });
      const body = await this.readJsonBody(req);
      const serverId = String(
        body?.serverId
        ?? this.core.webStatus?.getSnapshot?.()?.serverId
        ?? "",
      ).trim();
      const auditContext = {
        action: AUDIT_ACTIONS.ASTRBOT_MATCH_FINISHED_TEST,
        category: AUDIT_CATEGORIES.INTEGRATION,
        actor: panelUser,
        request: req,
        sourcePage: AUDIT_SOURCE_PAGES.ASTRBOT_BRIDGE,
        serverId,
        target: {
          type: "integration",
          id: "astrbot-bridge",
          name: "AstrBot Bridge",
        },
        parameters: {
          useCurrentServer: body?.useCurrentServer !== false,
          useLatestSnapshot: body?.useLatestSnapshot !== false,
          winner: String(body?.winner ?? "测试阵营").slice(0, 128),
        },
        resultResolver: (result) => result?.ok ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.FAILED,
        resultDataBuilder: (result) => ({
          eventId: result?.event?.eventId ?? "",
          websocketClients: Number(result?.websocketClients ?? 0),
          simulated: result?.event?.data?.simulated === true,
          snapshotId: result?.event?.data?.snapshotId ?? null,
        }),
      };
      if (!this.core.authManager?.hasEverything?.(panelUser)) {
        await this.auditForbidden(auditContext, "SuperAdmin role is required.");
        return this.json(res, 403, { error: "Forbidden", message: "SuperAdmin role is required." });
      }

      const bridge = this.modules.astrbotBridge;
      if (!bridge?.dispatchMatchFinished) {
        return this.json(res, 404, { error: "AstrBotBridgeUnavailable" });
      }
      const result = await this.executeAudited(auditContext, () => bridge.dispatchMatchFinished({
        serverId,
        winner: String(body?.winner ?? "测试阵营").slice(0, 128),
        useLatestSnapshot: body?.useLatestSnapshot !== false,
        simulated: true,
        source: "panel.manual-test",
      }));
      const websocketClients = Number(result?.websocketClients ?? bridge.getWebSocketClientCount?.() ?? 0);
      return this.json(res, 200, {
        ok: true,
        published: Boolean(result?.published),
        event: result?.event ?? null,
        websocketClients,
        warning: websocketClients > 0 ? null : "No AstrBot WebSocket client is connected.",
      });
    }

    const astrbotBridgeHandled = await handleAstrbotBridgeRoutes({
      core: this.core,
      modules: this.modules,
      url,
      req,
      res,
      readJsonBody: (request) => this.readJsonBody(request),
      json: (status, obj, extraHeaders = {}) => this.json(res, status, obj, extraHeaders),
      logger: this.logger,
    });
    if (astrbotBridgeHandled) {
      return;
    }


    const user = this.core.authManager?.getUserFromRequest(req);

    if (user && url.pathname === "/api/auth/change-password" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const oldPassword = String(body?.oldPassword ?? "");
      const newPassword = String(body?.newPassword ?? "");

      if (newPassword.length < 8) {
        return this.json(res, 400, { error: "InvalidPassword", message: "Password must be at least 8 characters." });
      }

      // Verify the old password is correct first!
      const verifyOk = await verifyPassword(oldPassword, user.passwordHash);
      if (!verifyOk) {
        return this.json(res, 400, { error: "InvalidOldPassword", message: "Incorrect old password." });
      }

      const store = this.core.authManager.userStore;
      const newPasswordHash = await hashPassword(newPassword);
      const updated = await store.updatePassword(user.id, newPasswordHash);

      return this.json(res, 200, {
        ok: true,
        user: this.serializeAdminUser(updated, await this.getAdminSteamAvatarMap([updated]), store.listPermissionGroups()),
      });
    }
    if (!user) {
      return this.json(res, 401, {
        error: "Unauthorized",
        message: "Authentication required.",
      });
    }

    if (url.pathname.startsWith("/api/plugins/bzss-super-weather")) {
      if (!this.canUseBzssCoreTool(user)) {
        return this.json(res, 403, {
          error: "Forbidden",
          message: "bzss_core.use permission is required.",
        });
      }
      const pluginApi = this.getPluginApi("bzss-super-weather");
      if (!pluginApi) {
        return this.json(res, 404, {
          error: "SuperWeatherUnavailable",
          message: "BZSS Super Weather plugin is not loaded.",
        });
      }
      if (url.pathname === "/api/plugins/bzss-super-weather/state" && req.method === "GET") {
        return this.json(res, 200, pluginApi.getState());
      }
      if (url.pathname === "/api/plugins/bzss-super-weather/presets" && req.method === "GET") {
        return this.json(res, 200, { presets: pluginApi.listPresets() });
      }
      if (url.pathname === "/api/plugins/bzss-super-weather/presets" && req.method === "POST") {
        return this.json(res, 201, await pluginApi.createPreset(await this.readJsonBody(req)));
      }
      const presetMatch = url.pathname.match(/^\/api\/plugins\/bzss-super-weather\/presets\/([^/]+)$/);
      if (presetMatch && req.method === "PATCH") {
        return this.json(res, 200, await pluginApi.updatePreset(decodeURIComponent(presetMatch[1]), await this.readJsonBody(req)));
      }
      if (presetMatch && req.method === "DELETE") {
        return this.json(res, 200, { ok: true, preset: await pluginApi.deletePreset(decodeURIComponent(presetMatch[1])) });
      }
      const duplicateMatch = url.pathname.match(/^\/api\/plugins\/bzss-super-weather\/presets\/([^/]+)\/duplicate$/);
      if (duplicateMatch && req.method === "POST") {
        const body = await this.readJsonBody(req);
        return this.json(res, 201, await pluginApi.duplicatePreset(decodeURIComponent(duplicateMatch[1]), body?.name));
      }
      if (url.pathname === "/api/plugins/bzss-super-weather/activate" && req.method === "POST") {
        const body = await this.readJsonBody(req);
        return this.json(res, 200, await pluginApi.activate(body?.presetId));
      }
      if (url.pathname === "/api/plugins/bzss-super-weather/stop" && req.method === "POST") {
        return this.json(res, 200, await pluginApi.stop());
      }
      if (url.pathname === "/api/plugins/bzss-super-weather/reconcile" && req.method === "POST") {
        return this.json(res, 200, await pluginApi.reconcile());
      }
      if (url.pathname === "/api/plugins/bzss-super-weather/test-weather" && req.method === "POST") {
        const body = await this.readJsonBody(req);
        const result = await pluginApi.testWeather(body?.weatherType, body?.transitionSeconds);
        return this.json(res, result.ok ? 200 : 400, result);
      }
      return this.json(res, 405, { error: "MethodNotAllowed", message: "Super Weather endpoint or method is not supported." });
    }

    const stepCounterHandled = await handleStepCounterRoutes({
      module: this.modules.stepCounter,
      url,
      req,
      json: (status, obj) => this.json(res, status, obj),
    });
    if (stepCounterHandled) return;

    const pressureZoneRulesHandled = await handlePressureZoneRulesRoutes({
      module: this.modules.pressureZoneRules,
      url,
      req,
      readJsonBody: (request) => this.readJsonBody(request),
      json: (status, obj) => this.json(res, status, obj),
    });
    if (pressureZoneRulesHandled) return;

    const dynamicPressureZoneHandled = await handleDynamicPressureZoneRoutes({
      core: this.core,
      module: this.modules.dynamicPressureZone,
      url,
      req,
      user,
      readJsonBody: (request) => this.readJsonBody(request),
      json: (status, obj) => this.json(res, status, obj),
    });
    if (dynamicPressureZoneHandled) return;

    if (url.pathname === "/api/tasks/create" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      try {
        const task = await this.core.taskManager.enqueue({
          type: body?.type,
          priority: body?.priority,
          maxRetry: body?.maxRetry,
          payload: body?.payload ?? {},
        });
        return this.json(res, 202, task);
      } catch (error) {
        const status = error?.code === "TaskQueueFull" ? 429 : 400;
        return this.json(res, status, {
          error: error?.code ?? "TaskCreateFailed",
          message: error?.message ?? "Unable to create task.",
        });
      }
    }

    if (url.pathname === "/api/tasks" && req.method === "GET") {
      return this.json(res, 200, {
        tasks: this.core.taskManager?.list({ limit: url.searchParams.get("limit") }) ?? [],
        diagnostics: this.core.taskManager?.getDiagnostics?.() ?? null,
      });
    }

    const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch && req.method === "GET") {
      const task = this.core.taskManager?.get(taskMatch[1]);
      if (!task) return this.json(res, 404, { error: "TaskNotFound", message: "Task was not found." });
      return this.json(res, 200, task);
    }

    if (url.pathname === "/api/tactical-map/viewers") {
      if (req.method === "POST") {
        const body = await this.readJsonBody(req);
        return this.json(res, 200, { viewerCount: this.touchTacticalMapViewer(user, body?.sessionId) });
      }
      if (req.method === "DELETE") {
        return this.json(res, 200, { viewerCount: this.removeTacticalMapViewer(user, url.searchParams.get("sessionId")) });
      }
      return this.json(res, 405, { error: "MethodNotAllowed", message: "Method not allowed." });
    }

    if (
      url.pathname === "/api/admin/users"
      || url.pathname.startsWith("/api/admin/users/")
      || url.pathname === "/api/admin/permission-groups"
      || url.pathname.startsWith("/api/admin/permission-groups/")
    ) {
      await this.handleAdminUsersApi(url, req, res, user);
      return;
    }

    if (url.pathname === "/api/squad-name-policy/state") {
      if (req.method === "GET") {
        return this.json(res, 200, await readSquadNamePolicyState(this.core.config));
      }

      if (req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        try {
          const saved = await saveSquadNamePolicyState(this.core.config, {
            ...body,
            auditActor: user?.username ?? user?.name ?? "admin",
          });
          this.modules.squadRestrictionMonitor?.reload?.();
          return this.json(res, 200, saved);
        } catch (error) {
          if (error?.code === "PolicyValidationFailed") {
            return this.json(res, 422, {
              error: error.code,
              message: error.message,
              validation: error.validation,
            });
          }
          if (error?.code === "PolicyRevisionConflict") {
            return this.json(res, 409, {
              error: error.code,
              message: error.message,
              expectedRevision: error.expectedRevision,
              receivedRevision: error.receivedRevision,
            });
          }
          throw error;
        }
      }

      return this.json(res, 405, {
        error: "MethodNotAllowed",
        message: "Only GET and POST are supported.",
      });
    }

    if (url.pathname === "/api/squad-name-policy/whitelist") {
      if (req.method !== "POST") {
        return this.json(res, 405, {
          error: "MethodNotAllowed",
          message: "Only POST is supported.",
        });
      }
      if (!this.requireSuperAdmin(user, res)) return;

      const body = await this.readJsonBody(req);
      const name = String(body?.name ?? body?.squadName ?? "").trim();
      const requestedNature = String(body?.nature ?? "infantry").trim().toLowerCase();
      if (!name) {
        return this.json(res, 400, {
          error: "MissingName",
          message: "Squad name is required.",
        });
      }
      if (!["infantry", "vehicle", "support", "logistics"].includes(requestedNature)) {
        return this.json(res, 400, {
          error: "InvalidNature",
          message: "nature must be infantry, vehicle, support, or logistics.",
        });
      }

      const current = await readSquadNamePolicyState(this.core.config);
      const selectedType = current.types.find((type) => (
        type.id === String(body?.typeId ?? "").trim()
        && type.nature === requestedNature
        && type.enabled !== false
      )) ?? current.types.find((type) => type.nature === requestedNature && type.enabled !== false);
      if (!selectedType) {
        return this.json(res, 422, {
          error: "SquadTypeUnavailable",
          message: `No enabled squad type is configured for nature '${requestedNature}'.`,
        });
      }

      const normalizeName = (value) => String(value ?? "").trim().replace(/\\s+/g, " ").toLowerCase();
      const nameKey = normalizeName(name);
      const entries = current.entries.map((entry) => ({ ...entry }));
      const existingIndex = entries.findIndex((entry) => normalizeName(entry.name) === nameKey);
      const previous = existingIndex >= 0 ? entries[existingIndex] : null;
      const whitelistEntry = {
        ...(previous ?? {}),
        id: previous?.id || `rule:whitelist_${crypto.createHash("sha1").update(nameKey).digest("hex").slice(0, 16)}`,
        name,
        aliases: Array.isArray(previous?.aliases) ? previous.aliases : [],
        keywords: Array.isArray(previous?.keywords) ? previous.keywords : [],
        typeId: selectedType.id,
        faction: String(previous?.faction ?? ""),
        asset: String(previous?.asset ?? ""),
        maxPlayersOverride: previous?.maxPlayersOverride ?? null,
        allowSquadSuffix: body?.allowSquadSuffix !== false,
        enabled: true,
        priority: Math.max(1000, Number(previous?.priority ?? 0) || 0),
        source: "squad_name_tracking_whitelist",
        notes: "Added from squad-name tracking whitelist.",
        legacyVehicleType: String(previous?.legacyVehicleType ?? ""),
        searchTokens: Array.isArray(previous?.searchTokens) ? previous.searchTokens : [],
      };
      if (existingIndex >= 0) entries.splice(existingIndex, 1, whitelistEntry);
      else entries.push(whitelistEntry);

      const saved = await saveSquadNamePolicyState(this.core.config, {
        revision: current.revision,
        source: current.source,
        suggestionLimit: current.suggestionLimit,
        defaultNamePatterns: current.defaultNamePatterns,
        types: current.types.map(({ ruleCount, ...type }) => type),
        entries,
        auditActor: user?.username ?? user?.name ?? "admin",
      });
      this.modules.squadRestrictionMonitor?.reload?.();
      const evaluation = testSquadNamePolicy(name, this.core.config);
      return this.json(res, 200, {
        ok: evaluation.valid === true,
        entry: whitelistEntry,
        classification: evaluation.classification ?? null,
        evaluation,
        policyRevision: saved.revision,
      });
    }

    if (url.pathname === "/api/squad-name-policy/validate") {
      if (req.method !== "POST") {
        return this.json(res, 405, {
          error: "MethodNotAllowed",
          message: "Only POST is supported.",
        });
      }
      if (!this.requireSuperAdmin(user, res)) return;
      const body = await this.readJsonBody(req);
      const result = validatePolicyDocument(body, { policyPath: resolveSquadNamePolicyPath(this.core.config) });
      return this.json(res, result.valid ? 200 : 422, result);
    }

    if (url.pathname === "/api/squad-name-policy/test") {
      if (req.method !== "POST") {
        return this.json(res, 405, {
          error: "MethodNotAllowed",
          message: "Only POST is supported.",
        });
      }
      const body = await this.readJsonBody(req);
      const name = body?.name ?? body?.squadName ?? "";
      if (!String(name ?? "").trim()) {
        return this.json(res, 400, {
          error: "MissingName",
          message: "Squad name is required.",
        });
      }
      return this.json(res, 200, testSquadNamePolicy(name, body?.policy ?? this.core.config));
    }

    if (url.pathname === "/api/modules/squad-restriction-monitor/state") {
      if (req.method !== "GET") {
        return this.json(res, 405, {
          error: "MethodNotAllowed",
          message: "Only GET is supported.",
        });
      }
      const api = this.modules.squadRestrictionMonitor;
      if (!api?.getState) {
        return this.json(res, 404, {
          error: "ModuleNotFound",
          message: "squadRestrictionMonitor module is not available.",
        });
      }
      return this.json(res, 200, {
        ok: true,
        data: api.getState(),
      });
    }

    if (url.pathname === "/api/modules/squad-restriction-monitor/test") {
      if (req.method !== "POST") {
        return this.json(res, 405, {
          error: "MethodNotAllowed",
          message: "Only POST is supported.",
        });
      }
      const api = this.modules.squadRestrictionMonitor;
      if (!api?.evaluateSquad) {
        return this.json(res, 404, {
          error: "ModuleNotFound",
          message: "squadRestrictionMonitor module is not available.",
        });
      }
      const body = await this.readJsonBody(req);
      return this.json(res, 200, {
        ok: true,
        data: api.evaluateSquad(body ?? {}),
      });
    }

    if (url.pathname === "/api/modules/squad-restriction-enforcement/state") {
      if (req.method !== "GET") {
        return this.json(res, 405, {
          error: "MethodNotAllowed",
          message: "Only GET is supported.",
        });
      }
      const api = this.modules.squadRestrictionEnforcement;
      if (!api?.getState) {
        return this.json(res, 404, {
          error: "ModuleNotFound",
          message: "squadRestrictionEnforcement module is not available.",
        });
      }
      return this.json(res, 200, {
        ok: true,
        data: api.getState(),
      });
    }

    if (url.pathname === "/api/modules/squad-restriction-enforcement/control") {
      if (req.method !== "POST") {
        return this.json(res, 405, {
          error: "MethodNotAllowed",
          message: "Only POST is supported.",
        });
      }
      if (!this.requireSuperAdmin(user, res)) return;
      const api = this.modules.squadRestrictionEnforcement;
      if (!api?.setRuntimeControl) {
        return this.json(res, 404, {
          error: "ModuleNotFound",
          message: "squadRestrictionEnforcement runtime control is not available.",
        });
      }
      const body = await this.readJsonBody(req);
      const actor = {
        id: user?.id ?? user?.userId ?? "",
        username: user?.username ?? user?.name ?? "",
        role: user?.role ?? "",
      };
      const result = await api.setRuntimeControl({ ...body, actor });
      return this.json(res, result?.ok ? 200 : 400, result ?? {
        ok: false,
        error: "operation_unavailable",
      });
    }

    const enforcementCaseActionMatch = url.pathname.match(
      /^\/api\/modules\/squad-restriction-enforcement\/cases\/([^/]+)\/(cancel|exemption)$/,
    );
    if (enforcementCaseActionMatch) {
      if (req.method !== "POST" && !(req.method === "DELETE" && enforcementCaseActionMatch[2] === "exemption")) {
        return this.json(res, 405, {
          error: "MethodNotAllowed",
          message: "Only POST is supported; exemptions also support DELETE.",
        });
      }
      if (!this.requireSuperAdmin(user, res)) return;
      const api = this.modules.squadRestrictionEnforcement;
      if (!api?.getState) {
        return this.json(res, 404, {
          error: "ModuleNotFound",
          message: "squadRestrictionEnforcement module is not available.",
        });
      }
      const caseKey = decodeURIComponent(enforcementCaseActionMatch[1]);
      if (req.method === "DELETE") {
        const result = await api.clearExemption?.(caseKey);
        return this.json(res, result?.ok ? 200 : 404, result ?? { ok: false, error: "operation_unavailable" });
      }
      const body = await this.readJsonBody(req);
      const actor = {
        id: user?.id ?? user?.userId ?? "",
        username: user?.username ?? user?.name ?? "",
        role: user?.role ?? "",
      };
      const result = enforcementCaseActionMatch[2] === "cancel"
        ? await api.cancelCase?.(caseKey, { ...body, actor })
        : await api.setExemption?.(caseKey, { ...body, actor });
      return this.json(res, result?.ok ? 200 : 404, result ?? { ok: false, error: "operation_unavailable" });
    }

    if (url.pathname === "/api/modules/squad-name-policy-guard/state") {
      if (req.method !== "GET") {
        return this.json(res, 405, {
          error: "MethodNotAllowed",
          message: "Only GET is supported.",
        });
      }

      const api = this.modules.squadNamePolicyGuard;
      if (!api?.getState) {
        return this.json(res, 404, {
          error: "ModuleNotFound",
          message: "squadNamePolicyGuard module is not available.",
        });
      }

      return this.json(res, 200, {
        ok: true,
        data: api.getState(),
      });
    }

    if (url.pathname === "/api/modules/squad-name-policy-guard/simulate") {
      if (req.method !== "POST") {
        return this.json(res, 405, {
          error: "MethodNotAllowed",
          message: "Only POST is supported.",
        });
      }

      const api = this.modules.squadNamePolicyGuard;
      if (!api?.simulate) {
        return this.json(res, 404, {
          error: "ModuleNotFound",
          message: "squadNamePolicyGuard module is not available.",
        });
      }

      const body = await this.readJsonBody(req);
      return this.json(res, 200, {
        ok: true,
        data: await api.simulate(body ?? {}),
      });
    }

    if (url.pathname === "/api/modules/squad-name-policy-guard/clear") {
      if (req.method !== "POST") {
        return this.json(res, 405, {
          error: "MethodNotAllowed",
          message: "Only POST is supported.",
        });
      }
      if (!this.requireSuperAdmin(user, res)) return;

      const api = this.modules.squadNamePolicyGuard;
      if (!api?.clearRecent) {
        return this.json(res, 404, {
          error: "ModuleNotFound",
          message: "squadNamePolicyGuard module is not available.",
        });
      }

      return this.json(res, 200, {
        ok: true,
        data: await api.clearRecent(),
      });
    }

    if (url.pathname === "/api/modules/squad-name-policy-patrol/state") {
      if (req.method !== "GET") {
        return this.json(res, 405, {
          error: "MethodNotAllowed",
          message: "Only GET is supported.",
        });
      }

      const api = this.modules.squadNamePolicyPatrol;
      if (!api?.getState) {
        return this.json(res, 404, {
          error: "ModuleNotFound",
          message: "squadNamePolicyPatrol module is not available.",
        });
      }

      return this.json(res, 200, {
        ok: true,
        data: api.getState(),
      });
    }

    if (url.pathname === "/api/modules/squad-name-policy-patrol/simulate") {
      if (req.method !== "POST") {
        return this.json(res, 405, {
          error: "MethodNotAllowed",
          message: "Only POST is supported.",
        });
      }

      const api = this.modules.squadNamePolicyPatrol;
      if (!api?.simulate) {
        return this.json(res, 404, {
          error: "ModuleNotFound",
          message: "squadNamePolicyPatrol module is not available.",
        });
      }

      const body = await this.readJsonBody(req);
      return this.json(res, 200, {
        ok: true,
        data: await api.simulate(body ?? {}),
      });
    }

    if (url.pathname === "/api/modules/squad-name-policy-patrol/clear") {
      if (req.method !== "POST") {
        return this.json(res, 405, {
          error: "MethodNotAllowed",
          message: "Only POST is supported.",
        });
      }
      if (!this.requireSuperAdmin(user, res)) return;

      const api = this.modules.squadNamePolicyPatrol;
      if (!api?.clearRecent) {
        return this.json(res, 404, {
          error: "ModuleNotFound",
          message: "squadNamePolicyPatrol module is not available.",
        });
      }

      return this.json(res, 200, {
        ok: true,
        data: await api.clearRecent(),
      });
    }

    const squadManagementHandled = await handleSquadManagementRoutes({
      core: this.core,
      modules: this.modules,
      url,
      req,
      user,
      readJsonBody: (request) => this.readJsonBody(request),
      json: (status, obj, extraHeaders = {}) => this.json(res, status, obj, extraHeaders),
    });
    if (squadManagementHandled) {
      return;
    }

    const teamBalanceHandled = await handleTeamBalanceRoutes({
      core: this.core,
      modules: this.modules,
      url,
      req,
      user,
      readJsonBody: (request) => this.readJsonBody(request),
      json: (status, obj, extraHeaders = {}) => this.json(res, status, obj, extraHeaders),
    });
    if (teamBalanceHandled) {
      return;
    }

    const reserveSlotsHandled = await handleReserveSlotsRoutes({
      core: this.core,
      modules: this.modules,
      url,
      req,
      user,
      readTextBody: (request) => this.readTextBody(request),
      readJsonBody: (request) => this.readJsonBody(request),
      json: (status, obj, extraHeaders = {}) => this.json(res, status, obj, extraHeaders),
    });
    if (reserveSlotsHandled) {
      return;
    }

    const warmupReserveGrantHandled = await handleWarmupReserveGrantRoutes({
      core: this.core,
      modules: this.modules,
      url,
      req,
      user,
      readJsonBody: (request) => this.readJsonBody(request),
      json: (status, obj, extraHeaders = {}) => this.json(res, status, obj, extraHeaders),
    });
    if (warmupReserveGrantHandled) {
      return;
    }

    const blackEdgePrivilegeHandled = await handleBlackEdgePrivilegeRoutes({
      core: this.core,
      modules: this.modules,
      url,
      req,
      user,
      readJsonBody: (request) => this.readJsonBody(request),
      json: (status, obj, extraHeaders = {}) => this.json(res, status, obj, extraHeaders),
    });
    if (blackEdgePrivilegeHandled) {
      return;
    }

    const tacticalStateHandled = await handleTacticalStateRoutes({
      core: this.core,
      modules: this.modules,
      url,
      req,
      res,
      user,
      json: (status, obj, extraHeaders = {}) => this.json(res, status, obj, extraHeaders),
    });
    if (tacticalStateHandled) {
      return;
    }

    const tacticalFeedWriterHandled = await handleTacticalFeedWriterRoutes({
      core: this.core,
      modules: this.modules,
      url,
      req,
      user,
      readJsonBody: (request) => this.readJsonBody(request),
      json: (status, obj, extraHeaders = {}) => this.json(res, status, obj, extraHeaders),
    });
    if (tacticalFeedWriterHandled) {
      return;
    }

    const tacticalStateV2Handled = await handleTacticalStateV2Routes({
      core: this.core,
      modules: this.modules,
      url,
      req,
      res,
      user,
      json: (status, obj, extraHeaders = {}) => this.json(res, status, obj, extraHeaders),
    });
    if (tacticalStateV2Handled) {
      return;
    }

    if (url.pathname === "/api/settings/exposed") {
      const configManager = this.core.config;
      if (!configManager?.getExposedSettings) {
        return this.json(res, 503, {
          error: "SettingsUnavailable",
          message: "Settings manager is unavailable.",
        });
      }

      if (req.method === "GET") {
        if (!this.canManageSettingsTools(user)) {
          return this.json(res, 403, {
            error: "Forbidden",
            message: "settings.manage permission is required.",
          });
        }
        return this.json(res, 200, configManager.getExposedSettings());
      }

      if (req.method === "PATCH") {
        if (!this.canManageSettingsTools(user)) {
          return this.json(res, 403, {
            error: "Forbidden",
            message: "settings.manage permission is required.",
          });
        }
        const body = await this.readJsonBody(req);
        if (!body || typeof body !== "object" || Array.isArray(body) || !body.changes || typeof body.changes !== "object" || Array.isArray(body.changes)) {
          return this.json(res, 400, {
            error: "InvalidRequestBody",
            message: "Request body must include a changes object.",
          });
        }

        const result = await configManager.updateExposedSettings(body.changes);
        return this.json(res, 200, {
          ok: true,
          ...result,
        });
      }
    }

    if (url.pathname === "/api/system/status" && req.method === "GET") {
      if (!this.canManageSettingsTools(user)) {
        return this.json(res, 403, {
          error: "Forbidden",
          message: "settings.manage permission is required.",
        });
      }
      const modules = this.core.moduleManager?.instances
        ?.filter((inst) => !inst.manifest?.hidden && !inst.manifest?.deprecated)
        .map((inst) => ({
          id: inst.manifest?.id,
          name: inst.manifest?.name ?? inst.manifest?.id,
          version: inst.manifest?.version ?? "1.0.0",
          description: inst.manifest?.description ?? "",
          status: "running",
        })) ?? [];

      const plugins = this.core.pluginManager?.instances?.map((inst) => ({
        id: inst.manifest?.id,
        name: inst.manifest?.name ?? inst.manifest?.id,
        version: inst.manifest?.version ?? "1.0.0",
        description: inst.manifest?.description ?? "",
        status: "running",
      })) ?? [];

      return this.json(res, 200, {
        ok: true,
        modules,
        plugins,
        system: {
          uptime: Math.floor(process.uptime()),
          memory: process.memoryUsage(),
          memoryHistory: this.memoryHistory,
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          performance: this.core.performanceMonitor?.getSnapshot() ?? null,
          diagnostics: {
            snapshotSizeBytes: this.lastSnapshotSizeBytes ?? 0,
            slowApiRequests: this.slowApiRequests ?? [],
            eventsRawCount: this.core.runtimeState?.state?.events?.raw?.length ?? 0,
            battleLogCount: this.modules.battleLog?.api?.getOverview?.()?.count ?? 0,
            consoleBufferCount: this.core.console?.getHistory?.()?.length ?? 0,
            chatHistoryCount: this.modules.chatManager?.api?.getHistory?.()?.length ?? 0,
          },
        },
      });
    }

    if (url.pathname === "/api/web/pages") {
      return this.json(res, 200, { pages: this.core.webRegistry.getPages(user) });
    }

    if (url.pathname === "/api/web/status") {
      return this.json(res, 200, this.core.webStatus.getSnapshot());
    }

    if (url.pathname === "/api/audit/records" && req.method === "GET") {
      if (!this.canViewAudit(user)) {
        return this.json(res, 403, {
          error: "Forbidden",
          message: "audit.view permission is required.",
        });
      }
      const records = await this.core.auditManager.list({
        limit: url.searchParams.get("limit") ?? "100",
        offset: url.searchParams.get("offset") ?? "0",
        actor: url.searchParams.get("actor") ?? "",
        action: url.searchParams.get("action") ?? "",
        serverId: url.searchParams.get("serverId") ?? "",
        result: url.searchParams.get("result") ?? "",
        playerName: url.searchParams.get("playerName") ?? "",
        steamId: url.searchParams.get("steamId") ?? "",
        clientIp: url.searchParams.get("clientIp") ?? "",
        requestId: url.searchParams.get("requestId") ?? "",
        fromMs: url.searchParams.get("fromMs") ?? "",
        toMs: url.searchParams.get("toMs") ?? "",
      });
      return this.json(res, 200, { ok: true, ...records });
    }

    const auditDetailMatch = url.pathname.match(/^\/api\/audit\/records\/([^/]+)$/);
    if (auditDetailMatch && req.method === "GET") {
      if (!this.canViewAudit(user)) {
        return this.json(res, 403, {
          error: "Forbidden",
          message: "audit.view permission is required.",
        });
      }
      const record = await this.core.auditManager.get(decodeURIComponent(auditDetailMatch[1]));
      if (!record) {
        return this.json(res, 404, {
          error: "AuditRecordNotFound",
          message: "Audit record was not found.",
        });
      }
      return this.json(res, 200, { ok: true, record });
    }

    if (url.pathname === "/api/server/warmup") {
      const webStatus = this.core.webStatus;
      if (!webStatus?.getWarmupState) {
        return this.json(res, 503, {
          error: "WarmupStateUnavailable",
          message: "Warmup state manager is unavailable.",
        });
      }

      if (req.method === "GET") {
        return this.json(res, 200, webStatus.getWarmupState());
      }

      if (req.method === "POST") {
        const body = await this.readJsonBody(req);
        if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.isWarmup !== "boolean") {
          return this.json(res, 400, {
            error: "InvalidRequestBody",
            message: "Request body must include isWarmup as a boolean.",
          });
        }

        try {
          return this.json(res, 200, await webStatus.setWarmup(body.isWarmup, {
            updatedBy: null,
          }));
        } catch (error) {
          return this.json(res, error.statusCode ?? 500, {
            error: error.code ?? "WarmupStateUpdateFailed",
            message: error.message,
          });
        }
      }
    }

    if (url.pathname === "/api/snapshot/all" && req.method === "GET") {
      await this.ensureInitialMatchPlayers();
      return this.json(res, 200, cleanSnapshotAllForClient(this.core.runtimeState.getAll()));
    }

    if (url.pathname === "/api/snapshot/server" && req.method === "GET") {
      return this.json(res, 200, this.core.runtimeState.getServer());
    }

    if (url.pathname === "/api/snapshot/players" && req.method === "GET") {
      return this.json(res, 200, cleanPlayersForClient(this.core.runtimeState.getPlayers()));
    }

    if (url.pathname === "/api/snapshot/squads" && req.method === "GET") {
      return this.json(res, 200, cleanSquadsForClient(this.core.runtimeState.getSquads()));
    }

    if (url.pathname === "/api/snapshot/match" && req.method === "GET") {
      const match = this.core.runtimeState.getMatch();
      return this.json(res, 200, match ? {
        ...match,
        players: cleanPlayersForClient(match.players),
        squads: cleanSquadsForClient(match.squads),
      } : null);
    }

    if (url.pathname === "/api/log-clock/set" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const body = await this.readJsonBody(req);
      const seconds = Number(body.seconds ?? body.value ?? 0);
      const next = this.core.webStatus.setLogClockSeconds(seconds, { reason: "manual" });
      return this.json(res, 200, {
        ok: true,
        logClockSeconds: next,
      });
    }

    if (url.pathname === "/api/log-clock/reset" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const next = this.core.webStatus.resetLogClock({ reason: "manualReset" });
      return this.json(res, 200, {
        ok: true,
        logClockSeconds: next,
      });
    }

    if (url.pathname.startsWith("/api/plugin-subscriptions")) {
      if (!this.canManageSettingsTools(user)) {
        return this.json(res, 403, {
          error: "Forbidden",
          message: "settings.manage permission is required.",
        });
      }
      const pluginSubscriptions = this.modules.pluginSubscriptions;
      if (!pluginSubscriptions) {
        return this.json(res, 404, {
          error: "PluginSubscriptionsUnavailable",
          message: "Plugin subscriptions module is not loaded.",
        });
      }

      if (url.pathname === "/api/plugin-subscriptions/state" && req.method === "GET") {
        return this.json(res, 200, pluginSubscriptions.getState());
      }

      if (url.pathname === "/api/plugin-subscriptions/set" && req.method === "POST") {
        const body = await this.readJsonBody(req);
        return this.json(res, 200, await pluginSubscriptions.setSubscribed(body.id, body.subscribed));
      }

      if (url.pathname === "/api/plugin-subscriptions/toggle" && req.method === "POST") {
        const body = await this.readJsonBody(req);
        return this.json(res, 200, await pluginSubscriptions.toggleSubscribed(body.id));
      }
    }

    if (url.pathname === "/api/plugins" && req.method === "GET") {
      return this.json(res, 200, getAllPlugins({
        subscriptionsApi: this.core.pluginSubscriptions ?? this.modules.pluginSubscriptions ?? null,
        pluginManager: this.core.pluginManager,
      }));
    }

    if (url.pathname === "/api/plugins/udp-event-forwarder/state" && req.method === "GET") {
      const pluginApi = this.getPluginApi("udp_event_forwarder");
      if (!pluginApi?.getStatus || !pluginApi?.getLogs) {
        return this.json(res, 404, {
          error: "PluginApiUnavailable",
          message: "UDP event forwarder plugin is not loaded.",
        });
      }

      const filter = {
        type: url.searchParams.get("type") ?? "all",
        search: url.searchParams.get("q") ?? "",
        limit: url.searchParams.get("limit") ?? "200",
        offset: url.searchParams.get("offset") ?? "0",
      };

      return this.json(res, 200, {
        ...pluginApi.getLogs(filter),
        status: pluginApi.getStatus(),
      });
    }

    if (url.pathname.startsWith("/api/plugins/group-report")) {
      const pluginApi = this.getPluginApi("group-report");
      if (!pluginApi) {
        return this.json(res, 404, {
          error: "GroupReportUnavailable",
          message: "Group report plugin is not loaded.",
        });
      }

      if (url.pathname === "/api/plugins/group-report/snapshot" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.getSnapshot(),
        });
      }

      if (url.pathname === "/api/plugins/group-report/groups" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: {
            groups: pluginApi.getGroups(),
          },
        });
      }

      if (url.pathname === "/api/plugins/group-report/groups" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.createGroup({
            name: body.name,
            note: body.note,
            color: body.color,
            anchorPlayerKey: body.anchorPlayerKey,
            createdBy: user?.username ?? user?.name ?? "",
          }),
        });
      }

      if (url.pathname === "/api/plugins/group-report/groups" && req.method === "DELETE") {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.deleteAllGroups(),
        });
      }

      const groupMatch = url.pathname.match(/^\/api\/plugins\/group-report\/groups\/([^/]+)$/);
      if (groupMatch && req.method === "GET") {
        const group = pluginApi.getGroup(decodeURIComponent(groupMatch[1]));
        if (!group) {
          return this.json(res, 404, {
            ok: false,
            error: "Group not found.",
          });
        }
        return this.json(res, 200, {
          ok: true,
          data: group,
        });
      }

      if (groupMatch && req.method === "PATCH") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.updateGroup(decodeURIComponent(groupMatch[1]), {
            name: body.name,
            note: body.note,
            color: body.color,
            anchorPlayerKey: body.anchorPlayerKey,
          }),
        });
      }

      if (groupMatch && req.method === "DELETE") {
        if (!this.requireSuperAdmin(user, res)) return;
        await pluginApi.deleteGroup(decodeURIComponent(groupMatch[1]));
        return this.json(res, 200, {
          ok: true,
          data: { deleted: true },
        });
      }

      const memberMatch = url.pathname.match(/^\/api\/plugins\/group-report\/groups\/([^/]+)\/members(?:\/([^/]+))?$/);
      if (memberMatch && req.method === "DELETE" && !memberMatch[2]) {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.clearGroupMembers(decodeURIComponent(memberMatch[1])),
        });
      }

      if (memberMatch && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.addMember(decodeURIComponent(memberMatch[1]), {
            eosId: body.eosId,
            steamId: body.steamId,
            teamId: body.teamId,
            squadId: body.squadId,
            playtimeHours: body.playtimeHours,
            name: body.name,
            note: body.note,
            addedBy: user?.username ?? user?.name ?? "",
          }),
        });
      }

      if (memberMatch && req.method === "PATCH" && memberMatch[2]) {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.updateMember(decodeURIComponent(memberMatch[1]), decodeURIComponent(memberMatch[2]), {
            eosId: body.eosId,
            steamId: body.steamId,
            teamId: body.teamId,
            squadId: body.squadId,
            playtimeHours: body.playtimeHours,
            name: body.name,
            note: body.note,
          }),
        });
      }

      if (memberMatch && req.method === "DELETE" && memberMatch[2]) {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.removeMember(decodeURIComponent(memberMatch[1]), decodeURIComponent(memberMatch[2])),
        });
      }
    }

    if (url.pathname.startsWith("/api/plugins/fair-squad-guard")) {
      if (url.pathname === "/api/plugins/fair-squad-guard/enabled" && req.method === "PATCH") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        if (typeof body?.enabled !== "boolean") {
          return this.json(res, 400, { error: "InvalidBody", message: "enabled must be boolean" });
        }
        const current = this.core.config?.get?.("plugins.fairSquadGuard", {}) ?? {};
        this.core.config?.set?.("plugins.fairSquadGuard", { ...current, enabled: body.enabled });
        await this.core.config?.save?.().catch(() => {});
        return this.json(res, 200, { ok: true, enabled: body.enabled });
      }

      if (url.pathname === "/api/plugins/fair-squad-guard/config" && req.method === "PATCH") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return this.json(res, 400, { error: "InvalidBody", message: "body must be object" });
        }
        const current = this.core.config?.get?.("plugins.fairSquadGuard", {}) ?? {};
        this.core.config?.set?.("plugins.fairSquadGuard", { ...current, ...body });
        await this.core.config?.save?.().catch(() => {});
        const pluginApiForStatus = this.getPluginApi("plugin.fairSquadGuard");
        return this.json(res, 200, { ok: true, data: pluginApiForStatus?.getStatus?.() ?? null });
      }

      const pluginApi = this.getPluginApi("plugin.fairSquadGuard");
      if (!pluginApi) {
        return this.json(res, 404, {
          error: "FairSquadGuardUnavailable",
          message: "Fair squad guard plugin is not loaded.",
        });
      }

      if (url.pathname === "/api/plugins/fair-squad-guard/status" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.getStatus?.() ?? pluginApi.getState?.() ?? null,
        });
      }

      if (url.pathname === "/api/plugins/fair-squad-guard/records" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.listRecords?.({
            limit: url.searchParams.get("limit") ?? "300",
            offset: url.searchParams.get("offset") ?? "0",
          }) ?? { total: 0, records: [] },
        });
      }

      if (url.pathname === "/api/plugins/fair-squad-guard/unlock-current-round" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.unlockCurrentRound?.({
            ...body,
            actor: user,
            by: user?.username ?? user?.name ?? "admin",
          }) ?? null,
        });
      }

      if (url.pathname === "/api/plugins/fair-squad-guard/reset-session" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.resetSession?.(body?.reason ?? "manual_reset") ?? null,
        });
      }

    }

    if (url.pathname.startsWith("/api/plugins/team-kill-apology")) {
      const pluginApi = this.getPluginApi("plugin.team-kill-duration-warning");
      if (!pluginApi) {
        return this.json(res, 404, {
          error: "TeamKillApologyUnavailable",
          message: "TK apology plugin is not loaded.",
        });
      }

      if (url.pathname === "/api/plugins/team-kill-apology/state" && req.method === "GET") {
        return this.json(res, 200, { ok: true, data: pluginApi.getState?.() ?? null });
      }

      if (url.pathname === "/api/plugins/team-kill-apology/enabled" && req.method === "PATCH") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        if (typeof body?.enabled !== "boolean") {
          return this.json(res, 400, { error: "InvalidBody", message: "enabled must be boolean" });
        }
        return this.json(res, 200, { ok: true, data: pluginApi.setEnabled?.(body.enabled) ?? pluginApi.getState?.() ?? null });
      }

      if (url.pathname === "/api/plugins/team-kill-apology/config" && req.method === "PATCH") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return this.json(res, 400, { error: "InvalidBody", message: "body must be object" });
        }
        return this.json(res, 200, { ok: true, data: pluginApi.updateConfig?.(body) ?? pluginApi.getState?.() ?? null });
      }

      if (url.pathname === "/api/plugins/team-kill-apology/reset" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, { ok: true, data: pluginApi.resetMatch?.("manual_web_reset") ?? pluginApi.getState?.() ?? null });
      }

      return this.json(res, 405, { error: "MethodNotAllowed", message: "Unsupported TK apology API route." });
    }

    const pluginMatch = url.pathname.match(/^\/api\/plugins\/([^/]+)\/(enabled|config)$/);
    if (pluginMatch && req.method === "PATCH") {
      if (!this.requireSuperAdmin(user, res)) return;

      const pluginId = decodeURIComponent(pluginMatch[1]);
      const action = pluginMatch[2];
      const body = await this.readJsonBody(req);
      const subscriptionsApi = this.core.pluginSubscriptions ?? this.modules.pluginSubscriptions ?? null;
      const pluginManager = this.core.pluginManager;
      const config = this.core.config;

      try {
        if (action === "enabled") {
          if (typeof body.enabled !== "boolean") {
            return this.json(res, 400, {
              error: "InvalidRequestBody",
              message: "enabled must be boolean",
            });
          }
          return this.json(res, 200, updatePluginEnabled(pluginId, body.enabled, {
            subscriptionsApi,
            pluginManager,
            config
          }));
        }

        if (!body.config || typeof body.config !== "object" || Array.isArray(body.config)) {
          return this.json(res, 400, {
            error: "InvalidRequestBody",
            message: "config must be object",
          });
        }

        return this.json(res, 200, updatePluginManifestConfig(pluginId, body.config, {
          subscriptionsApi,
          pluginManager,
          config
        }));
      } catch (error) {
        return this.json(res, 400, {
          error: "PluginUpdateFailed",
          message: error instanceof Error ? error.message : "Failed to update plugin",
        });
      }
    }


    if (url.pathname === "/api/match/overview") {
      return this.json(res, 200, this.getMatchOverview());
    }

    if (url.pathname === "/api/round/state") {
      return this.json(res, 200, this.modules.matchState?.getRoundState?.() ?? this.getRoundStateFromRuntime());
    }

    if (url.pathname === "/api/round/overview") {
      return this.json(res, 200, this.modules.matchState?.getRoundOverview?.() ?? this.getRoundOverviewFromRuntime());
    }

    if (url.pathname === "/api/match/snapshot" && req.method === "GET") {
      return this.json(res, 200, this.getMatchStateSnapshotResponse());
    }

    if (url.pathname === "/api/match/refresh" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const body = await this.readJsonBody(req);
      const type = this.normalizeMatchRefreshType(body.type ?? url.searchParams.get("type") ?? "all");
      return this.json(res, 200, await this.refreshMatchState(type));
    }

    if (url.pathname === "/api/match/refresh/players" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, await this.refreshMatchState("players"));
    }

    if (url.pathname === "/api/match/refresh/squads" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, await this.refreshMatchState("squads"));
    }

    if (url.pathname === "/api/match/refresh/all" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, await this.refreshMatchState("all"));
    }

    if (url.pathname === "/api/jobs/playtime-refresh-online" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const body = await this.readJsonBody(req);
      const job = await this.modules.playtime.refreshOnline({
        serverId: body.serverId ?? url.searchParams.get("serverId") ?? this.getCurrentServerId(""),
        force: Boolean(body.force ?? url.searchParams.get("force") === "true"),
      });
      this.core.runtimeState.updateJob(job);
      return this.json(res, 202, job);
    }

    if (url.pathname === "/api/jobs/rcon-refresh" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const body = await this.readJsonBody(req);
      const type = body.type ?? url.searchParams.get("type") ?? "all";
      const job = this.createLocalJob("rcon-refresh", { type });
      this.runLocalJob(job, async () => {
        return await this.refreshMatchState(this.normalizeMatchRefreshType(type));
      });
      return this.json(res, 202, job);
    }

    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobMatch && req.method === "GET") {
      const job = await this.getJob(decodeURIComponent(jobMatch[1]), {
        waitMs: Number(url.searchParams.get("waitMs") ?? 0),
      });
      if (!job) return this.json(res, 404, { error: "JobNotFound" });
      this.core.runtimeState.updateJob(job);
      return this.json(res, 200, job);
    }

    if (url.pathname === "/api/query/playtime-cache" && req.method === "GET") {
      const steamIDs = String(url.searchParams.get("steamIDs") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      const items = {};
      let playerTimeRows = [];
      try {
        playerTimeRows = await this.modules.playerDatabase?.listPlayersBySteamIDs?.(steamIDs) ?? [];
      } catch {}

      const playerTimeBySteamID = new Map(
        playerTimeRows.map((row) => [String(row?.steam_id ?? row?.steamID ?? "").trim(), row]),
      );

      await Promise.all(steamIDs.map(async (steamID) => {
        try {
          const [row, playerTimeRow] = await Promise.all([
            this.modules.playtime.getBySteamID(steamID),
            Promise.resolve(playerTimeBySteamID.get(steamID) ?? null),
          ]);
          if (row || playerTimeRow) {
            items[steamID] = normalizePlaytimeRow(row ?? playerTimeRow, playerTimeRow);
          }
        } catch {}
      }));
      return this.json(res, 200, { items });
    }

    if (url.pathname === "/api/ip/lookup" && req.method === "GET") {
      const ip = String(url.searchParams.get("ip") ?? "").trim();
      if (!ip) {
        return this.json(res, 200, {
          item: {
            ip: "",
            source: "invalid",
            provider: "none",
            country: "",
            region: "",
            city: "",
            isp: "",
            org: "",
            asn: "",
            timezone: "",
            latitude: null,
            longitude: null,
            isPrivate: false,
            isProxy: null,
            isHosting: null,
            updatedAt: 0,
            error: "Empty IP value.",
            stale: false,
          },
        });
      }

      return this.json(res, 200, {
        item: await this.modules.ipLookup.lookupIp(ip),
      });
    }

    if (url.pathname === "/api/ip/lookup-many" && req.method === "GET") {
      const ips = String(url.searchParams.get("ips") ?? "")
        .split(",")
        .map((ip) => ip.trim())
        .filter(Boolean)
        .slice(0, 50);

      if (!ips.length) {
        return this.json(res, 200, { items: {} });
      }

      return this.json(res, 200, {
        items: await this.modules.ipLookup.lookupMany(ips),
      });
    }

    if (url.pathname === "/api/query/player-database" && req.method === "GET") {
      return this.runTimedPlayerDatabaseQuery("/api/query/player-database", null, async () => {
        const result = await this.modules.playerDatabase.listPlayers({
          query: url.searchParams.get("q") ?? "",
          q: url.searchParams.get("q") ?? "",
          limit: url.searchParams.get("limit") ?? "100",
          offset: url.searchParams.get("offset") ?? "0",
          sort: url.searchParams.get("sort") ?? "updated_desc",
        });
        return this.json(res, 200, result);
      });
    }


    if (url.pathname === "/api/playtime/status") {
      return this.json(res, 200, this.modules.playtime.getStatus());
    }

    if (url.pathname === "/api/playtime/logs") {
      return this.json(res, 200, {
        logs: await this.modules.playtime.listRecentLogs({
          limit: url.searchParams.get("limit") ?? "100",
        }),
      });
    }

    if (url.pathname === "/api/playtime/online/refresh" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const serverId = body.serverId ?? url.searchParams.get("serverId") ?? this.core.webStatus?.serverId ?? "";
      const force = Boolean(body.force ?? url.searchParams.get("force") === "true");
      const createdAtMs = Date.now();
      const auditContext = {
        requestId: `audit_${createdAtMs}_${crypto.randomBytes(8).toString("hex")}`,
        createdAtMs,
        action: force ? AUDIT_ACTIONS.PLAYTIME_REFRESH_FORCE : AUDIT_ACTIONS.PLAYTIME_REFRESH_SMART,
        category: AUDIT_CATEGORIES.PLAYTIME,
        actor: user,
        request: req,
        sourcePage: body.sourcePage ?? AUDIT_SOURCE_PAGES.MATCH_STATUS,
        serverId,
        target: { type: "server", id: serverId, name: this.getServerName(serverId) },
        parameters: {
          force,
          onlinePlayerCount: this.getOnlinePlayerCount(serverId),
        },
        allowWithoutAudit: true,
        resultResolver: () => AUDIT_RESULTS.ACCEPTED,
        resultDataBuilder: (job) => this.summarizePlaytimeJobForAudit(job),
      };
      if (!this.requireSuperAdmin(user, res)) {
        return;
      }

      const job = await this.executeAudited(auditContext, () => this.modules.playtime.refreshOnline({
        serverId,
        force,
      }));
      this.watchPlaytimeAuditJob(job?.id, auditContext);
      const waitMs = Number(body.waitMs ?? 0);
      const payload = waitMs > 0
        ? await this.modules.playtime.waitForJob(job.id, waitMs)
        : this.modules.playtime.getJob(job.id);
      return this.json(res, 202, payload);
    }

    if (url.pathname === "/api/playtime/players/refresh" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const steamId = body.steamID ?? body.steamId ?? "";
      const createdAtMs = Date.now();
      const auditContext = {
        requestId: `audit_${createdAtMs}_${crypto.randomBytes(8).toString("hex")}`,
        createdAtMs,
        action: AUDIT_ACTIONS.PLAYTIME_REFRESH_SMART,
        category: AUDIT_CATEGORIES.PLAYTIME,
        actor: user,
        request: req,
        sourcePage: body.sourcePage ?? AUDIT_SOURCE_PAGES.MATCH_STATUS,
        serverId: body.serverId ?? this.core.webStatus?.serverId ?? "",
        target: {
          type: "player",
          id: steamId,
          name: body.name ?? body.currentName ?? body.label ?? "",
          steamId,
          eosId: body.eosID ?? body.eosId ?? "",
        },
        parameters: {
          steamId,
          label: body.label ?? body.name ?? "",
        },
        allowWithoutAudit: true,
        resultResolver: () => AUDIT_RESULTS.ACCEPTED,
        resultDataBuilder: (job) => this.summarizePlaytimeJobForAudit(job),
      };
      if (!this.canManageSettingsTools(user)) {
        await this.auditForbidden(auditContext, "settings.manage permission is required.");
        return this.json(res, 403, { error: "Forbidden", message: "settings.manage permission is required." });
      }

      const job = await this.executeAudited(auditContext, () => this.modules.playtime.refreshPlayer(body));
      this.watchPlaytimeAuditJob(job?.id, auditContext);
      const waitMs = Number(body.waitMs ?? 0);
      const payload = waitMs > 0
        ? await this.modules.playtime.waitForJob(job.id, waitMs)
        : this.modules.playtime.getJob(job.id);
      return this.json(res, 202, payload);
    }

    const playtimeJobMatch = url.pathname.match(/^\/api\/playtime\/jobs\/([^/]+)$/);
    if (playtimeJobMatch && req.method === "GET") {
      const jobId = decodeURIComponent(playtimeJobMatch[1]);
      const waitMs = Number(url.searchParams.get("waitMs") ?? 0);
      const payload = waitMs > 0
        ? await this.modules.playtime.waitForJob(jobId, waitMs)
        : this.modules.playtime.getJob(jobId);
      if (!payload) return this.json(res, 404, { error: "PlaytimeJobNotFound" });
      return this.json(res, 200, payload);
    }

    if (url.pathname === "/api/console/channels") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, this.getConsoleChannels({
        stream: url.searchParams.get("stream") ?? "modules",
      }));
    }

    if (url.pathname === "/api/console/lines") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, {
        lines: this.getConsoleLines({
          stream: url.searchParams.get("stream") ?? "modules",
          scope: url.searchParams.get("scope") ?? "all",
          level: url.searchParams.get("level") ?? "all",
          afterSeq: url.searchParams.get("afterSeq") ?? "0",
          limit: url.searchParams.get("limit") ?? "300",
          q: url.searchParams.get("q") ?? "",
        }),
      });
    }

    if (url.pathname === "/api/console/recent") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, {
        items: this.core.console?.getRecent?.({
          limit: url.searchParams.get("limit") ?? "500",
          channel: url.searchParams.get("channel") ?? "",
          level: url.searchParams.get("level") ?? "",
          source: url.searchParams.get("source") ?? "",
          keyword: url.searchParams.get("keyword") ?? "",
        }) ?? [],
      });
    }

    if (url.pathname === "/api/rcon/execute" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const auditContext = this.buildRconAuditContext(req, user, body, url.pathname);
      if (!this.core.authManager?.hasEverything?.(user)) {
        await this.auditForbidden(auditContext, "SuperAdmin role is required.");
        return this.json(res, 403, { error: "Forbidden", message: "SuperAdmin role is required." });
      }
      const result = await this.executeAudited(auditContext, () => this.executeConsoleRconCommand(body.command, {
        requestedBy: "web.console",
        actor: user,
        system: false,
      }));
      return this.json(res, result?.code === "Forbidden" ? 403 : result?.success ? 200 : 400, result);
    }

    if (url.pathname === "/api/console/rcon" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const auditContext = this.buildRconAuditContext(req, user, body, url.pathname);
      if (!this.core.authManager?.hasEverything?.(user)) {
        await this.auditForbidden(auditContext, "SuperAdmin role is required.");
        return this.json(res, 403, { error: "Forbidden", message: "SuperAdmin role is required." });
      }
      const result = await this.executeAudited(auditContext, () => this.executeConsoleRconCommand(body.command, {
        requestedBy: "web.console",
        actor: user,
        system: false,
      }));
      return this.json(res, result?.code === "Forbidden" ? 403 : result?.success ? 200 : 400, result);
    }

    // Compatibility endpoint used by some Vue client builds.
    if (url.pathname === "/api/rcon-command" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const auditContext = this.buildRconAuditContext(req, user, body, url.pathname);
      if (!this.core.authManager?.hasEverything?.(user)) {
        await this.auditForbidden(auditContext, "SuperAdmin role is required.");
        return this.json(res, 403, { error: "Forbidden", message: "SuperAdmin role is required." });
      }
      const result = await this.executeAudited(auditContext, () => this.executeConsoleRconCommand(body.command, {
        requestedBy: "web.console",
        actor: user,
        system: false,
      }));
      return this.json(res, result?.code === "Forbidden" ? 403 : result?.success ? 200 : 400, result);
    }

    if (url.pathname === "/api/tank-battle/execute" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const commands = Array.isArray(body?.commands)
        ? body.commands.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 20)
        : [];
      const auditContext = {
        action: AUDIT_ACTIONS.TANK_BATTLE_EXECUTE,
        category: AUDIT_CATEGORIES.RCON,
        actor: user,
        request: req,
        sourcePage: body.sourcePage ?? AUDIT_SOURCE_PAGES.TANK_BATTLE_DIALOG,
        serverId: body.serverId ?? this.core.webStatus?.serverId ?? "",
        target: { type: "server", id: body.serverId ?? this.core.webStatus?.serverId ?? "", name: this.getServerName(body.serverId ?? this.core.webStatus?.serverId ?? "") },
        parameters: {
          preset: body.preset ?? body.label ?? "custom",
          commandCount: commands.length,
          commands: commands.map((command) => sanitizeRconCommand(command)),
        },
        resultResolver: (result) => result?.auditResult ?? AUDIT_RESULTS.SUCCESS,
        resultDataBuilder: (result) => ({
          commandCount: commands.length,
          commands: Array.isArray(result?.commands) ? result.commands : [],
        }),
      };
      if (!this.core.authManager?.hasEverything?.(user)) {
        await this.auditForbidden(auditContext, "SuperAdmin role is required.");
        return this.json(res, 403, { error: "Forbidden", message: "SuperAdmin role is required." });
      }
      if (!commands.length) {
        await this.auditInvalid(auditContext, "InvalidTankBattleCommands", "At least one command is required.");
        return this.json(res, 400, { error: "InvalidTankBattleCommands", message: "At least one command is required." });
      }

      const result = await this.executeAudited(auditContext, () => this.executeTankBattleCommands(commands, {
        requestedBy: "web.tankBattle",
        actor: user,
      }));
      return this.json(res, result.ok ? 200 : 400, result);
    }

    // Compatibility endpoint for tank-battle status panel.
    if (url.pathname === "/api/auto-tank-battle/status" && req.method === "GET") {
      if (!this.canManageSettingsTools(user)) {
        return this.json(res, 403, {
          error: "Forbidden",
          message: "settings.manage permission is required.",
        });
      }
      return this.json(res, 200, {
        enabled: false,
        settings: {
          mapSwitchCommands: [],
        },
        source: "compat",
      });
    }

    if (url.pathname === "/api/bzss-core/variables" && req.method === "GET") {
      if (!this.canUseBzssCoreTool(user)) {
        return this.json(res, 403, { error: "Forbidden", message: "bzss_core.use permission is required." });
      }
      if (!this.bzssCoreVariableStateService) {
        return this.json(res, 503, { error: "BzssCoreVariableStateUnavailable" });
      }
      return this.json(res, 200, await this.bzssCoreVariableStateService.reconcile());
    }

    if (url.pathname === "/api/bzss-core/variables" && req.method === "PATCH") {
      if (!this.canUseBzssCoreTool(user)) {
        return this.json(res, 403, { error: "Forbidden", message: "bzss_core.use permission is required." });
      }
      if (!this.bzssCoreVariableStateService) {
        return this.json(res, 503, { error: "BzssCoreVariableStateUnavailable" });
      }
      const body = await this.readJsonBody(req);
      const key = String(body?.key ?? "").trim();
      const value = body?.value;
      if (!BZSS_CORE_BOOL_KEYS.includes(key) || typeof value !== "boolean") {
        return this.json(res, 400, {
          error: "InvalidBzssCoreVariable",
          message: "key must be one of the supported Bool variables and value must be boolean.",
        });
      }
      try {
        return this.json(res, 200, await this.bzssCoreVariableStateService.write(key, value));
      } catch (error) {
        return this.json(res, 400, { error: "BzssCoreVariableWriteFailed", message: error?.message ?? String(error) });
      }
    }

    if (url.pathname === "/api/bzss-core/execute" && req.method === "POST") {
      if (!this.canUseBzssCoreTool(user)) {
        return this.json(res, 403, {
          error: "Forbidden",
          message: "bzss_core.use permission is required.",
        });
      }

      const body = await this.readJsonBody(req);
      const result = await this.executeBzssCoreCommand(body ?? {}, {
        actor: user,
      });
      return this.json(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === "/api/bzss-core/player-info" && req.method === "GET") {
      if (!this.canUseBzssCoreTool(user)) {
        return this.json(res, 403, {
          error: "Forbidden",
          message: "bzss_core.use permission is required.",
        });
      }
      return this.json(res, 200, this.getBzssCorePlayerInfo({
        name: url.searchParams.get("name") ?? "",
        all: url.searchParams.get("all") ?? "",
      }));
    }

    if (url.pathname === "/api/bzss-core/player-info/raw" && req.method === "GET") {
      if (!this.canUseBzssCoreTool(user)) {
        return this.json(res, 403, {
          error: "Forbidden",
          message: "bzss_core.use permission is required.",
        });
      }
      return this.json(res, 200, this.getBzssCorePlayerInfoRaw());
    }

    if (url.pathname === "/api/bzss-core/vehicles" && req.method === "GET") {
      if (!this.canUseBzssCoreTool(user)) {
        return this.json(res, 403, { error: "Forbidden", message: "bzss_core.use permission is required." });
      }
      return this.json(res, 200, this.getBzssCoreVehicles());
    }

    if (url.pathname === "/api/server-info/snapshot-state" && req.method === "GET") {
      return this.json(res, 200, {
        ok: true,
        snapshot: this.getServerInfoSnapshotState({
          includeAll: true,
        }),
      });
    }

    if (url.pathname === "/api/bzss-core/player-info/stream" && req.method === "GET") {
      if (!this.canUseBzssCoreTool(user)) {
        return this.json(res, 403, {
          error: "Forbidden",
          message: "bzss_core.use permission is required.",
        });
      }

      req.socket.setTimeout(0);
      req.socket.setKeepAlive(true);

      res.writeHead(200, {
        ...BASE_SECURITY_HEADERS,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      });

      const sendUpdate = () => {
        const payload = this.getBzssCorePlayerInfo({ all: 1 });
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      sendUpdate();

      const monitor = this.modules.bzssCoreMonitor;
      let unsubscribe = null;
      if (monitor && typeof monitor.subscribe === "function") {
        unsubscribe = monitor.subscribe(() => {
          sendUpdate();
        });
      }

      req.on("close", () => {
        if (unsubscribe) {
          unsubscribe();
        }
      });
      return;
    }

    if (url.pathname === "/api/logpost/raw-output" && req.method === "GET") {
      return this.json(res, 200, await this.getLogPostRawOutputConfig());
    }

    if (url.pathname === "/api/logpost/raw-output" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const body = await this.readJsonBody(req);
      const result = await this.setLogPostRawOutputConfig(Boolean(body.enabled));
      return this.json(res, 200, result);
    }

    if (url.pathname === "/api/rcon/status") {
      return this.json(res, 200, this.core.rconManager.getStatus());
    }

    if (url.pathname === "/api/admin-warns/recent" && req.method === "GET") {
      const adminWarn = this.modules.adminWarn;
      if (!adminWarn) {
        return this.json(res, 404, {
          error: "AdminWarnUnavailable",
          message: "Broadcast module is not loaded.",
        });
      }
      const records = adminWarn.getRecent({
        limit: url.searchParams.get("limit") ?? "200",
        kind: url.searchParams.get("kind") ?? "",
        targetName: url.searchParams.get("targetName") ?? "",
        targetEosId: url.searchParams.get("targetEosId") ?? "",
        sourceModule: url.searchParams.get("sourceModule") ?? "",
        reason: url.searchParams.get("reason") ?? "",
        success: parseOptionalBoolean(url.searchParams.get("success")),
        skipped: parseOptionalBoolean(url.searchParams.get("skipped")),
        search: url.searchParams.get("search") ?? "",
        actorUsername: url.searchParams.get("actorUsername") ?? "",
      });
      return this.json(res, 200, {
        records,
        total: records.length,
        config: adminWarn.getConfig?.() ?? null,
      });
    }

    if (url.pathname.startsWith("/api/scheduled-broadcasts")) {
      const scheduledBroadcast = this.modules.scheduledBroadcast;
      if (!scheduledBroadcast) {
        return this.json(res, 404, {
          error: "ScheduledBroadcastUnavailable",
          message: "Scheduled broadcast module is not loaded.",
        });
      }

      if (url.pathname === "/api/scheduled-broadcasts/state" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          ...scheduledBroadcast.getState(),
        });
      }

      if (url.pathname === "/api/scheduled-broadcasts/items" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          item: await scheduledBroadcast.addItem(body ?? {}),
        });
      }

      if (url.pathname === "/api/scheduled-broadcasts/reorder" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        const ids = Array.isArray(body?.ids) ? body.ids : [];
        return this.json(res, 200, await scheduledBroadcast.reorder(ids));
      }

      const itemPathMatch = url.pathname.match(/^\/api\/scheduled-broadcasts\/items\/([^/]+)$/);
      if (itemPathMatch && req.method === "PATCH") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          item: await scheduledBroadcast.updateItem(decodeURIComponent(itemPathMatch[1]), body ?? {}),
        });
      }

      if (itemPathMatch && req.method === "DELETE") {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, {
          ok: true,
          item: await scheduledBroadcast.removeItem(decodeURIComponent(itemPathMatch[1])),
        });
      }

      const runNowMatch = url.pathname.match(/^\/api\/scheduled-broadcasts\/items\/([^/]+)\/run$/);
      if (runNowMatch && req.method === "POST") {
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          result: await scheduledBroadcast.runNow(decodeURIComponent(runNowMatch[1]), {
            reason: String(body?.reason ?? "manual_run"),
            actor: user,
            system: false,
          }),
        });
      }
    }

    if (url.pathname === "/api/rcon/refresh" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const type = this.normalizeMatchRefreshType(url.searchParams.get("type") ?? "all");
      return this.json(res, 200, await this.refreshMatchState(type));
    }

    if (url.pathname === "/api/combat/overview") {
      return this.json(res, 200, this.modules.combatState.getOverview());
    }

    if (url.pathname === "/api/combat-records" && req.method === "GET") {
      const combatCollector = this.modules.combatCollector;
      if (!combatCollector) {
        return this.json(res, 404, { ok: false, error: "CombatCollectorUnavailable" });
      }
      const result = combatCollector.getRecords({
        serverId: url.searchParams.get("serverId") ?? "",
        sourceMode: url.searchParams.get("sourceMode") ?? url.searchParams.get("source") ?? "all",
        type: url.searchParams.get("type") ?? "all",
        search: url.searchParams.get("search") ?? url.searchParams.get("q") ?? "",
        offset: url.searchParams.get("offset") ?? "0",
        limit: url.searchParams.get("limit") ?? "200",
      });
      return this.json(res, 200, {
        ok: true,
        records: result.records,
        total: result.total,
        overview: combatCollector.getOverview(),
      });
    }

    if (url.pathname === "/api/combat-records/status" && req.method === "GET") {
      const combatCollector = this.modules.combatCollector;
      if (!combatCollector) return this.json(res, 404, { ok: false, error: "CombatCollectorUnavailable" });
      return this.json(res, 200, combatCollector.getStatus());
    }

    if (url.pathname === "/api/combat-records/replay" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const combatCollector = this.modules.combatCollector;
      if (!combatCollector) return this.json(res, 404, { ok: false, error: "CombatCollectorUnavailable" });
      const body = await this.readJsonBody(req);
      const result = await combatCollector.restartReplay({ clear: Boolean(body?.clear) });
      return this.json(res, result.ok ? 200 : result.code === "ReplayAlreadyRunning" ? 409 : 400, result);
    }

    if (url.pathname === "/api/kill-records" && req.method === "GET") {
      const killRecords = this.modules.combatCollector ?? this.modules.killRecords;
      if (!killRecords) {
        return this.json(res, 404, { ok: false, error: "KillRecordsUnavailable" });
      }
      const result = killRecords.getRecords({
        serverId: url.searchParams.get("serverId") ?? "",
        source: url.searchParams.get("source") ?? "all",
        sourceMode: url.searchParams.get("source") ?? "all",
        type: url.searchParams.get("type") ?? "all",
        search: url.searchParams.get("search") ?? url.searchParams.get("q") ?? "",
        offset: url.searchParams.get("offset") ?? "0",
        limit: url.searchParams.get("limit") ?? "200",
      });
      return this.json(res, 200, {
        ok: true,
        records: result.records,
        total: result.total,
        overview: killRecords.getOverview(),
      });
    }

    if (url.pathname === "/api/kill-records/status" && req.method === "GET") {
      const killRecords = this.modules.combatCollector ?? this.modules.killRecords;
      if (!killRecords) return this.json(res, 404, { ok: false, error: "KillRecordsUnavailable" });
      return this.json(res, 200, killRecords.getStatus());
    }

    if (url.pathname === "/api/kill-records/replay" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const killRecords = this.modules.combatCollector ?? this.modules.killRecords;
      if (!killRecords) return this.json(res, 404, { ok: false, error: "KillRecordsUnavailable" });
      const body = await this.readJsonBody(req);
      const result = await killRecords.restartReplay({ clear: Boolean(body?.clear) });
      return this.json(res, result.ok ? 200 : result.code === "ReplayAlreadyRunning" ? 409 : 400, result);
    }

    if (url.pathname === "/api/kill-records/replay/clear" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const killRecords = this.modules.combatCollector ?? this.modules.killRecords;
      if (!killRecords) return this.json(res, 404, { ok: false, error: "KillRecordsUnavailable" });
      const result = killRecords.clearCache
        ? await killRecords.clearCache()
        : await killRecords.clearReplay();
      return this.json(res, result.ok ? 200 : 409, result);
    }







    if (url.pathname === "/api/combat/events") {
      return this.json(res, 200, {
        events: this.modules.combatState.getEvents({
          type: url.searchParams.get("type") ?? "all",
          search: url.searchParams.get("search") ?? "",
          limit: url.searchParams.get("limit") ?? "300",
          offset: url.searchParams.get("offset") ?? "0",
        }),
        overview: this.modules.combatState.getOverview(),
      });
    }

    if (url.pathname === "/api/combat/clear" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, this.modules.combatState.clear());
    }

    if (url.pathname.startsWith("/api/combat-logs")) {
      const combatLog = this.modules.combatLog;
      if (!combatLog) {
        return this.json(res, 404, {
          error: "CombatLogUnavailable",
          message: "Combat log module is not loaded.",
        });
      }

      if (url.pathname === "/api/combat-logs/status" && req.method === "GET") {
        return this.json(res, 200, combatLog.getStatus?.() ?? { ok: true });
      }

      if (url.pathname === "/api/combat-logs/months" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          months: await combatLog.listMonths?.() ?? [],
        });
      }

      if (url.pathname === "/api/combat-logs/files" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          month: url.searchParams.get("month") ?? "",
          files: await combatLog.listFiles?.(url.searchParams.get("month") ?? "") ?? [],
        });
      }

      if (url.pathname === "/api/combat-logs/read" && req.method === "GET") {
        return this.json(res, 200, await combatLog.readLog?.({
          month: url.searchParams.get("month") ?? "",
          date: url.searchParams.get("date") ?? "",
          q: url.searchParams.get("q") ?? url.searchParams.get("search") ?? "",
          limit: url.searchParams.get("limit") ?? "300",
          offset: url.searchParams.get("offset") ?? "0",
        }));
      }

      if (url.pathname === "/api/combat-logs/search" && req.method === "GET") {
        return this.json(res, 200, await combatLog.searchLog?.({
          from: url.searchParams.get("from") ?? "",
          to: url.searchParams.get("to") ?? "",
          attacker: url.searchParams.get("attacker") ?? "",
          eventType: url.searchParams.get("eventType") ?? "",
          victim: url.searchParams.get("victim") ?? "",
          weapon: url.searchParams.get("weapon") ?? "",
          damage: url.searchParams.get("damage") ?? "",
          limit: url.searchParams.get("limit") ?? "100",
          offset: url.searchParams.get("offset") ?? "0",
        }));
      }
    }



    if (url.pathname.startsWith("/api/battle-log")) {
      const battleLog = this.modules.battleLog;
      if (!battleLog) {
        return this.json(res, 404, {
          error: "BattleLogUnavailable",
          message: "Battle log module is not loaded.",
        });
      }

      const battleServerId = url.searchParams.get("serverId") ?? "";

      if (url.pathname === "/api/battle-log/status" && req.method === "GET") {
        return this.json(res, 200, battleLog.getStatus?.() ?? { ok: true });
      }

      if (url.pathname === "/api/battle-log/overview" && req.method === "GET") {
        return this.json(res, 200, cleanBattleLogOverviewForClient(battleLog.getOverview?.(battleServerId)));
      }

      if (url.pathname === "/api/battle-log/events" && req.method === "GET") {
        return this.json(res, 200, cleanBattleLogEventsResponseForClient({
          events: battleLog.getEvents?.({
            serverId: battleServerId,
            type: url.searchParams.get("type") ?? "all",
            search: url.searchParams.get("search") ?? url.searchParams.get("q") ?? "",
            limit: url.searchParams.get("limit") ?? "300",
            offset: url.searchParams.get("offset") ?? "0",
            playerKey: url.searchParams.get("playerKey") ?? url.searchParams.get("player") ?? "",
          }) ?? [],
          overview: battleLog.getOverview?.(battleServerId) ?? null,
        }));
      }

      if (url.pathname === "/api/battle-log/player" && req.method === "GET") {
        return this.json(res, 200, cleanBattleLogPlayerResponseForClient(battleLog.getPlayerStats?.(battleServerId, {
          q: url.searchParams.get("q") ?? url.searchParams.get("search") ?? "",
          playerKey: url.searchParams.get("playerKey") ?? "",
          steam64ID: url.searchParams.get("steam64ID") ?? url.searchParams.get("steamID") ?? "",
          eosID: url.searchParams.get("eosID") ?? "",
          controllerID: url.searchParams.get("controllerID") ?? "",
          name: url.searchParams.get("name") ?? "",
        })));
      }

      if (url.pathname === "/api/battle-log/rates" && req.method === "GET") {
        const windowMinutes = Number(url.searchParams.get("window") ?? 30);
        return this.json(res, 200, {
          rates: battleLog.getRateHistory?.(battleServerId, windowMinutes) ?? [],
        });
      }

      if (url.pathname === "/api/battle-log/clear" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, battleLog.clear?.(body?.serverId ?? battleServerId));
      }
    }

    if (url.pathname.startsWith("/api/plugins/fair-team-balance")) {
      const pluginApi = this.getPluginApi("plugin.fairTeamBalance");
      if (!pluginApi) {
        return this.json(res, 404, {
          error: "FairTeamBalanceUnavailable",
          message: "Fair team balance plugin is not loaded.",
        });
      }

      if (url.pathname === "/api/plugins/fair-team-balance/state" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.getState?.() ?? null,
        });
      }

      if (url.pathname === "/api/plugins/fair-team-balance/requests" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: {
            requests: pluginApi.listRequests?.() ?? [],
          },
        });
      }

      if (url.pathname === "/api/plugins/fair-team-balance/history" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: {
            history: await pluginApi.listHistory?.({
              limit: Number(url.searchParams.get("limit") ?? "100") || 100,
            }) ?? [],
          },
        });
      }

      if (url.pathname === "/api/plugins/fair-team-balance/approve" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.approveRequest?.({
            requestId: body?.requestId,
            direct: body?.direct === true,
            actor: user,
          }),
        });
      }

      if (url.pathname === "/api/plugins/fair-team-balance/reject" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.rejectRequest?.({
            requestId: body?.requestId,
            reason: body?.reason,
            actor: user,
          }),
        });
      }

      if (url.pathname === "/api/plugins/fair-team-balance/reset-period-quotas" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.resetPeriodQuotas?.("manual_period_reset", {
            by: user?.username || user?.name || "admin",
            serverId: this.core?.webStatus?.serverId ?? "",
          }),
        });
      }

      if (url.pathname === "/api/plugins/fair-team-balance/reset-round" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.resetRound?.("manual_round_reset", {
            by: user?.username || user?.name || "admin",
            serverId: this.core?.webStatus?.serverId ?? "",
          }),
        });
      }

      if (url.pathname === "/api/plugins/fair-team-balance/reset-player-quota" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.resetPlayerQuota?.({
            playerKey: body?.playerKey,
            reason: "manual_player_reset",
            meta: {
              by: user?.username || user?.name || "admin",
              serverId: this.core?.webStatus?.serverId ?? "",
            },
          }),
        });
      }

      if (url.pathname === "/api/plugins/fair-team-balance/clear-history" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.clearHistory?.(),
        });
      }
    }

    if (url.pathname.startsWith("/api/plugins/pjsc-average-duration")) {
      const pluginApi = this.getPluginApi("plugin.pjscAverageDuration");
      if (!pluginApi) {
        return this.json(res, 404, {
          error: "PjscAverageDurationUnavailable",
          message: "PJSC average duration plugin is not loaded.",
        });
      }

      if (url.pathname === "/api/plugins/pjsc-average-duration/state" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.getState?.() ?? null,
        });
      }

      if (url.pathname === "/api/plugins/pjsc-average-duration/history" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: {
            history: pluginApi.getHistory?.(Number(url.searchParams.get("limit") ?? "50") || 50) ?? [],
          },
        });
      }

      if (url.pathname === "/api/plugins/pjsc-average-duration/simulate" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.simulateChatMessage?.(body ?? {}),
        });
      }

      if (url.pathname === "/api/plugins/pjsc-average-duration/broadcast" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.broadcastNow?.(body?.reason ?? "manual_trigger"),
        });
      }

      if (url.pathname === "/api/plugins/pjsc-average-duration/clear" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.clearHistory?.() ?? null,
        });
      }
    }

    if (url.pathname.startsWith("/api/plugins/admin-camera-duration")) {
      const pluginApi = this.getPluginApi("plugin.adminCameraDuration");
      if (!pluginApi) {
        return this.json(res, 404, {
          error: "AdminCameraDurationUnavailable",
          message: "Admin camera duration plugin is not loaded.",
        });
      }

      if (url.pathname === "/api/plugins/admin-camera-duration/state" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.getState?.() ?? null,
        });
      }
    }

    if (url.pathname.startsWith("/api/plugins/draw-vote-guard")) {
      const pluginApi = this.getPluginApi("plugin.drawVoteGuard");
      if (!pluginApi) {
        return this.json(res, 404, {
          error: "DrawVoteGuardUnavailable",
          message: "Draw vote guard plugin is not loaded.",
        });
      }

      if (url.pathname === "/api/plugins/draw-vote-guard/state" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.getState?.() ?? null,
        });
      }

      if (url.pathname === "/api/plugins/draw-vote-guard/simulate" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.simulateTrigger?.(body ?? {}),
        });
      }

      if (url.pathname === "/api/plugins/draw-vote-guard/clear" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.clearHistory?.() ?? null,
        });
      }
    }

    if (url.pathname.startsWith("/api/plugins/victim-damage-display")) {
      const pluginApi = this.getPluginApi("plugin.victimDamageDisplay");
      if (!pluginApi) {
        return this.json(res, 404, {
          error: "VictimDamageDisplayUnavailable",
          message: "Victim damage display plugin is not loaded.",
        });
      }

      if (url.pathname === "/api/plugins/victim-damage-display/debug" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.getDebugSnapshot?.() ?? null,
        });
      }

      if (url.pathname === "/api/plugins/victim-damage-display/debug/clear" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.clearDebugRecords?.() ?? null,
        });
      }
    }

    if (url.pathname.startsWith("/api/plugins/squad-leader-impeachment")) {
      const pluginApi = this.getPluginApi("plugin.squadLeaderImpeachment");
      if (!pluginApi) {
        return this.json(res, 404, {
          error: "SquadLeaderImpeachmentUnavailable",
          message: "Squad leader impeachment plugin is not loaded.",
        });
      }

      if (url.pathname === "/api/plugins/squad-leader-impeachment/debug" && req.method === "GET") {
        return this.json(res, 200, { ok: true, data: pluginApi.getDebugSnapshot?.() ?? null });
      }

      if (url.pathname === "/api/plugins/squad-leader-impeachment/cancel" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, { ok: true, data: await pluginApi.cancelVote?.(body?.voteId) });
      }

      if (url.pathname === "/api/plugins/squad-leader-impeachment/cooldowns/clear" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, { ok: true, data: pluginApi.clearCooldowns?.() ?? null });
      }
    }

    if (url.pathname.startsWith("/api/plugins/welcome-join-warning")) {
      const pluginApi = this.getPluginApi("welcome-join-warning");
      if (!pluginApi) {
        return this.json(res, 404, {
          error: "WelcomeJoinWarningUnavailable",
          message: "Welcome join warning plugin is not loaded.",
        });
      }

      if (url.pathname === "/api/plugins/welcome-join-warning/state" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.getState?.() ?? null,
        });
      }

      if (url.pathname === "/api/plugins/welcome-join-warning/recent-events" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.getRecentEvents?.(Number(url.searchParams.get("limit") ?? "50") || 50) ?? [],
        });
      }

      if (url.pathname === "/api/plugins/welcome-join-warning/simulate" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.simulateJoin?.(body ?? {}),
        });
      }

      if (url.pathname === "/api/plugins/welcome-join-warning/clear" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.clearHistory?.() ?? null,
        });
      }

      if (url.pathname === "/api/plugins/welcome-join-warning/clear-events" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.clearRecentEvents?.() ?? null,
        });
      }

      if (url.pathname === "/api/plugins/welcome-join-warning/config" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.updateConfig?.(body ?? {}),
        });
      }
    }

    if (url.pathname.startsWith("/api/plugins/tactical-report")) {
      const pluginApi = this.getPluginApi("plugin.tacticalReport");
      if (!pluginApi) {
        return this.json(res, 404, {
          error: "TacticalReportUnavailable",
          message: "Tactical report plugin is not loaded.",
        });
      }

      if (url.pathname === "/api/plugins/tactical-report/state" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.getState?.() ?? null,
        });
      }

      if (url.pathname === "/api/plugins/tactical-report/config" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.getConfig?.() ?? null,
        });
      }

      if (url.pathname === "/api/plugins/tactical-report/config" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.updateConfig?.(body ?? {}),
        });
      }

      if (url.pathname === "/api/plugins/tactical-report/clear" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.clearHistory?.() ?? null,
        });
      }

      if (url.pathname === "/api/plugins/tactical-report/recent" && req.method === "GET") {
        const limit = Number(url.searchParams.get("limit") ?? "100") || 100;
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.getState?.()?.recentRecords?.slice(0, limit) ?? [],
        });
      }

      if (url.pathname === "/api/plugins/tactical-report/logs" && req.method === "GET") {
        const limit = Number(url.searchParams.get("limit") ?? "100") || 100;
        const logs = pluginApi.getLogs?.() ?? pluginApi.getState?.()?.history ?? [];
        return this.json(res, 200, {
          ok: true,
          data: logs.slice(0, limit),
        });
      }

      if (url.pathname === "/api/plugins/tactical-report/user-codes" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.getUserCodes?.() ?? pluginApi.getState?.()?.userCodes ?? {},
        });
      }

      const deleteUserCodeMatch = url.pathname.match(/^\/api\/plugins\/tactical-report\/user-codes\/([^/]+)\/([^/]+)$/);
      if (deleteUserCodeMatch && req.method === "DELETE") {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.deleteUserCode?.(
            decodeURIComponent(deleteUserCodeMatch[1]),
            decodeURIComponent(deleteUserCodeMatch[2]),
          ) ?? { ok: false, error: "Unavailable" },
        });
      }
    }

    if (url.pathname.startsWith("/api/plugins/stepwise-squad-playtime-guard")) {
      if (url.pathname === "/api/plugins/stepwise-squad-playtime-guard/enabled" && req.method === "PATCH") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        if (typeof body?.enabled !== "boolean") {
          return this.json(res, 400, { error: "InvalidBody", message: "enabled must be boolean" });
        }
        const current = this.core.config?.get?.("plugins.stepwiseSquadPlaytimeGuard", {}) ?? {};
        this.core.config?.set?.("plugins.stepwiseSquadPlaytimeGuard", { ...current, enabled: body.enabled });
        await this.core.config?.save?.().catch(() => {});
        return this.json(res, 200, { ok: true, enabled: body.enabled });
      }

      if (url.pathname === "/api/plugins/stepwise-squad-playtime-guard/config" && req.method === "PATCH") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return this.json(res, 400, { error: "InvalidBody", message: "body must be object" });
        }
        const current = this.core.config?.get?.("plugins.stepwiseSquadPlaytimeGuard", {}) ?? {};
        this.core.config?.set?.("plugins.stepwiseSquadPlaytimeGuard", { ...current, ...body });
        await this.core.config?.save?.().catch(() => {});
        const pluginApiForState = this.getPluginApi("plugin.stepwiseSquadPlaytimeGuard");
        return this.json(res, 200, { ok: true, data: pluginApiForState?.getState?.() ?? null });
      }

      const pluginApi = this.getPluginApi("plugin.stepwiseSquadPlaytimeGuard");
      if (!pluginApi) {
        return this.json(res, 404, {
          error: "StepwiseSquadPlaytimeGuardUnavailable",
          message: "Stepwise squad playtime guard plugin is not loaded.",
        });
      }

      if (url.pathname === "/api/plugins/stepwise-squad-playtime-guard/state" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.getState?.() ?? null,
        });
      }

      if (url.pathname === "/api/plugins/stepwise-squad-playtime-guard/simulate" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.simulateCreation?.(body ?? {}),
        });
      }

    }

    if (url.pathname.startsWith("/api/plugins/panel-ban")) {
      const pluginApi = this.getPluginApi("plugin.panelBan");
      if (!pluginApi) {
        return this.json(res, 404, {
          error: "PanelBanUnavailable",
          message: "Panel ban plugin is not loaded.",
        });
      }

      if (url.pathname === "/api/plugins/panel-ban/state" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.getState?.() ?? null,
        });
      }

      if (url.pathname === "/api/plugins/panel-ban/entries" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.listEntries?.({
            status: url.searchParams.get("status") ?? "all",
            search: url.searchParams.get("search") ?? "",
            includeExpired: url.searchParams.get("includeExpired") !== "false",
          }) ?? [],
        });
      }

      if (url.pathname === "/api/plugins/panel-ban/load" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.load?.(),
        });
      }

      if (url.pathname === "/api/plugins/panel-ban/reload" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.reload?.(),
        });
      }

      if (url.pathname === "/api/plugins/panel-ban/rescan" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.rescan?.(body?.serverId ?? core.webStatus?.serverId ?? ""),
        });
      }

      if (url.pathname === "/api/plugins/panel-ban/entries" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          data: await pluginApi.createEntry?.({
            ...body,
            actor: user,
            createdBy: user?.username ?? "",
          }),
        });
      }

      if (url.pathname.startsWith("/api/plugins/panel-ban/entries/")) {
        const entryId = decodeURIComponent(url.pathname.slice("/api/plugins/panel-ban/entries/".length));
        if (!entryId) {
          return this.json(res, 400, {
            error: "InvalidBanEntryId",
            message: "Ban entry id is required.",
          });
        }

        if (req.method === "PATCH") {
          if (!this.requireSuperAdmin(user, res)) return;
          const body = await this.readJsonBody(req);
          return this.json(res, 200, {
            ok: true,
            data: await pluginApi.updateEntry?.(entryId, {
              ...body,
              actor: user,
              updatedBy: user?.username ?? "",
            }),
          });
        }

        if (req.method === "DELETE") {
          if (!this.requireSuperAdmin(user, res)) return;
          return this.json(res, 200, {
            ok: true,
            data: await pluginApi.deleteEntry?.(entryId, {
              actor: user,
            }),
          });
        }
      }
    }

    if (url.pathname.startsWith("/api/modules/player-session-records")) {
      const moduleApi = this.modules.playerSessionRecords;
      if (!moduleApi) {
        return this.json(res, 404, {
          error: "PlayerSessionRecordsUnavailable",
          message: "Player session records module is not loaded.",
        });
      }

      if (url.pathname === "/api/modules/player-session-records/state" && req.method === "GET") {
        const limit = Number(url.searchParams.get("limit") ?? "200") || 200;
        return this.json(res, 200, {
          ok: true,
          data: moduleApi.getState?.(limit) ?? null,
        });
      }

      if (url.pathname === "/api/modules/player-session-records/records" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: moduleApi.getRecords?.({
            limit: Number(url.searchParams.get("limit") ?? "200") || 200,
            kind: url.searchParams.get("kind") ?? "all",
            serverId: url.searchParams.get("serverId") ?? "",
            playerName: url.searchParams.get("playerName") ?? "",
          }) ?? [],
        });
      }

      if (url.pathname === "/api/modules/player-session-records/clear" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, {
          ok: true,
          data: moduleApi.clearRecords?.() ?? null,
        });
      }
    }

    if (url.pathname.startsWith("/api/plugins/infantry-combat-enhancer")) {
      const infantryCombatEnhancer = this.modules.infantryCombatEnhancer;
      if (!infantryCombatEnhancer) {
        return this.json(res, 404, {
          error: "InfantryCombatEnhancerUnavailable",
          message: "Infantry combat enhancer module is not loaded.",
        });
      }

      if (url.pathname === "/api/plugins/infantry-combat-enhancer/config" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          config: infantryCombatEnhancer.getConfig?.() ?? null,
        });
      }

      if (url.pathname === "/api/plugins/infantry-combat-enhancer/config" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, {
          ok: true,
          config: await infantryCombatEnhancer.updateConfig?.(body ?? {}),
        });
      }

      if (url.pathname === "/api/plugins/infantry-combat-enhancer/events" && req.method === "GET") {
        const filter = {
          serverId: url.searchParams.get("serverId") ?? "",
          type: url.searchParams.get("type") ?? "all",
          warning: url.searchParams.get("warning") ?? "all",
          relation: url.searchParams.get("relation") ?? "all",
          weapon: url.searchParams.get("weapon") ?? "all",
          search: url.searchParams.get("search") ?? "",
          limit: url.searchParams.get("limit") ?? "100",
          offset: url.searchParams.get("offset") ?? "0",
        };
        return this.json(res, 200, {
          events: infantryCombatEnhancer.getEvents?.(filter) ?? [],
          overview: infantryCombatEnhancer.getOverview?.(filter) ?? null,
        });
      }

      if (url.pathname === "/api/plugins/infantry-combat-enhancer/clear" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, infantryCombatEnhancer.clear?.() ?? { ok: true, cleared: 0 });
      }
    }

    if (url.pathname === "/api/player-database/list") {
      const result = await this.modules.playerDatabase.listPlayers({
        query: url.searchParams.get("q") ?? "",
        q: url.searchParams.get("q") ?? "",
        limit: url.searchParams.get("limit") ?? "100",
        offset: url.searchParams.get("offset") ?? "0",
        sort: url.searchParams.get("sort") ?? "updated_desc",
      });
      return this.json(res, 200, result);
    }

    if (url.pathname === "/api/squadbrowser/player" && req.method === "GET") {
      const lookup = this.modules.squadBrowserPlayerLookup;
      if (!lookup?.lookup) {
        return this.json(res, 503, { error: "SquadBrowserLookupUnavailable" });
      }
      try {
        return this.json(res, 200, await lookup.lookup(url.searchParams.get("steam64") ?? ""));
      } catch (error) {
        return this.json(res, Number(error?.statusCode ?? 502), {
          error: error?.code ?? "SquadBrowserLookupFailed",
          message: error?.message ?? "SquadBrowser 查询失败。",
        });
      }
    }

    if (url.pathname === "/api/player-database/detail") {
      const playerId = url.searchParams.get("id");
      return this.runTimedPlayerDatabaseQuery("/api/player-database/detail", playerId, async () => {
        const detail = await this.modules.playerDatabase.getPlayerDetail(playerId);
        if (!detail) return this.json(res, 404, { error: "PlayerNotFound" });
        return this.json(res, 200, detail);
      });
    }

    if (url.pathname === "/api/player-database/sync-online" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(
        res,
        200,
        await this.modules.playerDatabase.syncOnline(url.searchParams.get("serverId") ?? this.getCurrentServerId("")),
      );
    }

    if (url.pathname === "/api/db/stats") {
      return this.runTimedPlayerDatabaseQuery("/api/db/stats", null, async () => this.json(res, 200, await this.modules.playerDatabase.getStats({
        top: url.searchParams.get("top") ?? "10",
        days: url.searchParams.get("days") ?? "14",
      })));
    }

    if (url.pathname === "/api/player-database/detail/aliases") {
      const playerId = url.searchParams.get("id");
      return this.runTimedPlayerDatabaseQuery("/api/player-database/detail/aliases", playerId, async () => {
        return this.json(res, 200, {
          items: await this.modules.playerDatabase.listPlayerAliases(playerId, {
            limit: url.searchParams.get("limit") ?? "12",
            offset: url.searchParams.get("offset") ?? "0",
          }),
        });
      });
    }

    if (url.pathname === "/api/player-database/detail/ips") {
      const playerId = url.searchParams.get("id");
      return this.runTimedPlayerDatabaseQuery("/api/player-database/detail/ips", playerId, async () => {
        return this.json(res, 200, {
          items: await this.modules.playerDatabase.listPlayerIps(playerId, {
            limit: url.searchParams.get("limit") ?? "12",
            offset: url.searchParams.get("offset") ?? "0",
          }),
        });
      });
    }

    if (url.pathname === "/api/player-database/detail/steam-friends") {
      const playerId = url.searchParams.get("id");
      return this.runTimedPlayerDatabaseQuery("/api/player-database/detail/steam-friends", playerId, async () => {
        const detail = await this.modules.playerDatabase.getPlayerDetail(playerId);
        if (!detail?.player?.steam_id) {
          return this.json(res, 200, { items: [] });
        }
        const steamID = detail.player.steam_id;

        let friends = await this.modules.playerDatabase.listSteamFriends(playerId);
        const staleThreshold = 24 * 60 * 60 * 1000;
        const force = url.searchParams.get("force") === "true";
        const isStale = friends.length === 0 || force || (friends[0]?.updated_at && (Date.now() - friends[0].updated_at > staleThreshold));

        const playtimeApi = this.modules.playtime?.api ?? this.modules.playtime;
        if (isStale && playtimeApi?.fetchSteamFriends) {
          try {
            const fetchedFriends = await playtimeApi.fetchSteamFriends(steamID);
            await this.modules.playerDatabase.upsertSteamFriends(playerId, fetchedFriends);
            friends = await this.modules.playerDatabase.listSteamFriends(playerId);
          } catch (err) {
            this.logger.warn(`Failed to on-demand fetch Steam friends for player ${playerId} (${steamID}): ${err.message}`);
          }
        }

        return this.json(res, 200, { items: friends });
      });
    }

    if (url.pathname.startsWith("/api/player-database/detail/container/")) {
      const playerId = url.searchParams.get("id");
      const container = decodeURIComponent(url.pathname.slice("/api/player-database/detail/container/".length));
      return this.runTimedPlayerDatabaseQuery(`/api/player-database/detail/container/${container}`, playerId, async () => {
        const detail = await this.modules.playerDatabase.getPlayerDetail(playerId);
        if (!detail) return this.json(res, 404, { error: "PlayerNotFound" });
        if (container === "steam-friends" && url.searchParams.get("refresh") === "true" && detail.player?.steam_id) {
          const playtimeApi = this.modules.playtime?.api ?? this.modules.playtime;
          if (playtimeApi?.fetchSteamFriends) {
            const friends = await playtimeApi.fetchSteamFriends(detail.player.steam_id);
            await this.modules.playerDatabase.upsertSteamFriends(Number(playerId), friends);
          }
        }
        return this.json(res, 200, await this.modules.playerDatabase.listPlayerContainer(playerId, container, {
          limit: url.searchParams.get("limit") ?? "30",
          offset: url.searchParams.get("offset") ?? "0",
        }));
      });
    }

    if (url.pathname === "/api/db/players") {
      const searchQuery = url.searchParams.get("q") ?? url.searchParams.get("query") ?? "";
      const result = await this.modules.playerDatabase.listPlayers({
        query: searchQuery,
        q: searchQuery,
        limit: url.searchParams.get("limit") ?? "200",
        offset: url.searchParams.get("offset") ?? "0",
        sort: url.searchParams.get("sort") ?? "updated_desc",
        top: url.searchParams.get("top") ?? "10",
        days: url.searchParams.get("days") ?? "14",
      });
      return this.json(res, 200, {
        items: result.items ?? [],
        total: result.total ?? 0,
      });
    }

    const dbPlayerMatch = url.pathname.match(/^\/api\/db\/players\/(\d+)$/);
    if (dbPlayerMatch && req.method === "GET") {
      const detail = await this.modules.playerDatabase.getPlayerDetail(dbPlayerMatch[1]);
      if (!detail) return this.json(res, 404, { error: "PlayerNotFound" });
      return this.json(res, 200, detail);
    }

    const dbPermissionMatch = url.pathname.match(/^\/api\/db\/players\/(\d+)\/permission-group$/);
    if (dbPermissionMatch && req.method === "PATCH") {
      if (!this.requireSuperAdmin(user, res)) return;
      const body = await this.readJsonBody(req);
      return this.json(res, 200, await this.modules.playerDatabase.setPermissionGroup(dbPermissionMatch[1], body.permissionGroup));
    }

    const dbPlayerPlaytimeMatch = url.pathname.match(/^\/api\/db\/players\/(\d+)\/playtime$/);
    if (dbPlayerPlaytimeMatch && req.method === "PATCH") {
      if (!this.requireSuperAdmin(user, res)) return;
      const body = await this.readJsonBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return this.json(res, 400, {
          error: "InvalidRequestBody",
          message: "Request body must be an object.",
        });
      }

      const hasGameHours = Object.prototype.hasOwnProperty.call(body, "gameHours");
      const hasGameSeconds = Object.prototype.hasOwnProperty.call(body, "gameSeconds");
      const rawValue = hasGameHours ? body.gameHours : (hasGameSeconds ? body.gameSeconds : undefined);
      let overrideSeconds = null;

      if (rawValue != null && String(rawValue).trim() !== "") {
        const numeric = Number(rawValue);
        if (!Number.isFinite(numeric) || numeric < 0) {
          return this.json(res, 400, {
            error: "InvalidGameHours",
            message: "gameHours must be a non-negative number or null.",
          });
        }
        overrideSeconds = hasGameHours ? Math.round(numeric * 3600) : Math.floor(numeric);
      } else if (rawValue === 0) {
        overrideSeconds = 0;
      } else {
        overrideSeconds = null;
      }

      const updatedDetail = await this.modules.playerDatabase.setGameDurationOverride(dbPlayerPlaytimeMatch[1], overrideSeconds);
      if (!updatedDetail) {
        return this.json(res, 404, {
          error: "PlayerNotFound",
          message: "Player not found.",
        });
      }

      return this.json(res, 200, {
        ok: true,
        data: updatedDetail,
      });
    }

    const dbPlayerTagsMatch = url.pathname.match(/^\/api\/db\/players\/(\d+)\/tags$/);
    if (dbPlayerTagsMatch && req.method === "GET") {
      return this.json(res, 200, {
        ok: true,
        items: await this.modules.playerDatabase.listPlayerTags(
          dbPlayerTagsMatch[1],
          url.searchParams.get("tagType") ?? null,
        ),
      });
    }

    if (dbPlayerTagsMatch && (req.method === "PUT" || req.method === "POST")) {
      if (!this.requireSuperAdmin(user, res)) return;
      const body = await this.readJsonBody(req);
      const tagType = String(body?.tagType ?? "").trim();
      const values = Array.isArray(body?.tagValues) ? body.tagValues.map((value) => String(value).trim()).filter(Boolean) : [];
      const allowedHobbyTags = new Set([
        "爱好铁皮", "爱好压家", "爱好单载", "爱好甩锅", "爱好带队", "爱好带节奏",
        "爱好狗官", "爱好TK", "爱好载具打狙", "爱好擦边压家", "爱好ZCC", "爱好IFV",
        "爱好ZSJ", "爱好APC", "爱好龟壳", "爱好拉点", "爱好劫二点", "爱好劫拉点",
      ]);
      if (tagType !== "hobby" || values.some((value) => !allowedHobbyTags.has(value))) {
        return this.json(res, 400, { error: "InvalidPlayerTags", message: "Unsupported player tag." });
      }
      const detail = await this.modules.playerDatabase.replacePlayerTags(dbPlayerTagsMatch[1], tagType, values);
      if (!detail) return this.json(res, 404, { error: "PlayerNotFound", message: "Player not found." });
      return this.json(res, 200, { ok: true, data: detail });
    }

    if (dbPlayerMatch && req.method === "DELETE") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, await this.modules.playerDatabase.deletePlayer(dbPlayerMatch[1]));
    }

    if (url.pathname === "/api/squads/list") {
      const serverId = url.searchParams.get("serverId") ?? this.getCurrentServerId("");
      const squadManagement = this.modules.squadManagement;
      return this.json(res, 200, {
        squads: squadManagement?.getSquads?.(serverId) ?? [],
      });
    }

    if (url.pathname === "/api/squad-lifecycle/current" && req.method === "GET") {
      const serverId = url.searchParams.get("serverId") ?? this.getCurrentServerId("");
      const lifecycle = this.modules.squadLifecycle?.getCurrent?.(serverId);
      const replay = this.modules.squadLifecycle?.getReplayStatus?.() ?? null;
      return this.json(res, 200, {
        current: lifecycle ? { ...lifecycle, replay } : {
          serverId,
          matchId: null,
          updatedAt: new Date().toISOString(),
          list: [],
          byKey: {},
          replay,
        },
      });
    }

    if (url.pathname === "/api/squad-creation-order/clear" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const serverId = url.searchParams.get("serverId") ?? this.getCurrentServerId("");
      this.modules.squadLifecycle?.clearCurrent?.(serverId);
      const ruleChain = this.modules.squadRuleChain?.clearCurrent?.() ?? null;
      return this.json(res, 200, {
        ok: true,
        data: {
          serverId,
          ruleChain,
        },
      });
    }

    if (url.pathname === "/api/squad-name-tracking/state" && req.method === "GET") {
      const serverId = url.searchParams.get("serverId") ?? this.getCurrentServerId?.("") ?? this.core.webStatus?.serverId ?? "";
      const lifecycle = this.modules.squadLifecycle?.getCurrent?.(serverId) ?? { list: [] };
      const guard = this.modules.squadNamePolicyGuard?.getState?.() ?? { enabled: false, recent: [] };
      const patrol = this.modules.squadNamePolicyPatrol?.getState?.() ?? { enabled: false, recent: [] };
      const ruleChain = this.modules.squadRuleChain?.getState?.() ?? { recent: [], stats: {} };

      const stepwiseApi = this.getPluginApi("plugin.stepwiseSquadPlaytimeGuard");
      const fairApi = this.getPluginApi("plugin.fairSquadGuard");

      const stepwise = stepwiseApi?.getStatus?.() ?? stepwiseApi?.getState?.() ?? { recentRecords: [] };
      const fair = fairApi?.getStatus?.() ?? fairApi?.getState?.() ?? { recentRecords: [] };

      const records = buildSquadNameTrackingRecords({
        guard,
        stepwise,
        fair,
        ruleChain,
        lifecycle,
      });

      return this.json(res, 200, {
        ok: true,
        data: {
          lifecycle: {
            ...lifecycle,
            replay: this.modules.squadLifecycle?.getReplayStatus?.() ?? null,
          },
          guard,
          patrol,
          ruleChain,
          stepwise,
          fair,
          records,
        },
      });
    }

    if (url.pathname === "/api/weapon-collector/stats" && req.method === "GET") {
      const pluginApi = this.getPluginApi("plugin.weaponCollector");
      if (!pluginApi) {
        return this.json(res, 404, { error: "WeaponCollectorNotLoaded" });
      }
      const serverId = url.searchParams.get("serverId") ?? this.getCurrentServerId("");
      const weapons = pluginApi.getWeaponStats(serverId);
      const totals = weapons.reduce(
        (acc, w) => {
          acc.damaged += w.damaged;
          acc.wounded += w.wounded;
          acc.died += w.died;
          return acc;
        },
        { damaged: 0, wounded: 0, died: 0 },
      );
      return this.json(res, 200, {
        serverId,
        weapons,
        totals,
        weaponTypeMap: pluginApi.getWeaponTypeMap?.() ?? {},
      });
    }

    if (url.pathname === "/api/weapon-collector/type-map" && req.method === "GET") {
      const pluginApi = this.getPluginApi("plugin.weaponCollector");
      if (!pluginApi) {
        return this.json(res, 404, { error: "WeaponCollectorNotLoaded" });
      }
      return this.json(res, 200, {
        weaponTypeMap: pluginApi.getWeaponTypeMap?.() ?? {},
      });
    }

    if (url.pathname === "/api/squad-management/actions" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const body = await this.readJsonBody(req);
      const api = this.modules.squadManagement;
      if (!api?.executeAction) {
        return this.json(res, 404, { error: "SquadManagementUnavailable" });
      }

      const result = await api.executeAction({
        ...body,
        actor: user,
        source: body.source ?? "web.squadManagement",
        system: false,
      });

      return this.json(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === "/api/squad-disband/execute" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const api = this.modules.squadManagement;
      if (!api?.executeAction) return this.json(res, 404, { error: "SquadManagementUnavailable" });
      try {
        const result = await api.executeAction({
          ...body,
          actor: user,
          type: "disband_squad",
          source: body.source ?? "web.squadDisband",
          system: Boolean(body.system ?? false),
        });
        return this.json(res, result.ok ? 200 : 400, result);
      } catch (err) {
        return this.json(res, 500, { error: "InternalError", message: err.message });
      }
    }

    if (url.pathname === "/api/squad-kick/execute" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const api = this.modules.squadManagement;
      if (!api?.executeAction) return this.json(res, 404, { error: "SquadManagementUnavailable" });
      try {
        const result = await api.executeAction({
          ...body,
          actor: user,
          type: "kick_player",
          source: body.source ?? "web.squadKick",
          system: Boolean(body.system ?? false),
        });
        return this.json(res, result.ok ? 200 : 400, result);
      } catch (err) {
        return this.json(res, 500, { error: "InternalError", message: err.message });
      }
    }

    if (url.pathname === "/api/squad-remove/execute" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const api = this.modules.squadManagement;
      if (!api?.executeAction) return this.json(res, 404, { error: "SquadManagementUnavailable" });
      try {
        const auditContext = this.buildRemoveFromSquadAuditContext(req, user, body);
        const result = await this.executeAudited(auditContext, ({ requestId }) => api.executeAction({
            ...body,
            actor: user,
            type: "remove_from_squad",
            source: body.source ?? "web.squadRemove",
            system: false,
            operatorName: user?.username ?? "",
            requestId,
          }), {
            relatedRecordIdBuilder: (payload) => payload?.record?.id ?? payload?.recordId ?? "",
          });
        return this.json(res, result.ok ? 200 : 400, result);
      } catch (err) {
        return this.json(res, 500, { error: "InternalError", message: err.message });
      }
    }

    if (url.pathname === "/api/admin-warns/warn" && req.method === "POST") {
      const api = this.modules.adminWarn;
      if (!api) return this.json(res, 404, { error: "ModuleNotFound" });
      const body = await this.readJsonBody(req);
      try {
        const auditContext = {
          action: AUDIT_ACTIONS.PLAYER_WARN,
          category: AUDIT_CATEGORIES.PLAYER_MANAGEMENT,
          actor: user,
          request: req,
          sourcePage: body.sourcePage ?? AUDIT_SOURCE_PAGES.SQUAD_MANAGEMENT,
          serverId: body.serverId ?? this.getCurrentServerId(""),
          target: {
            type: "player",
            id: body.targetSteamId ?? body.steamId ?? body.steamID ?? body.targetEosId ?? body.eosId ?? body.eosID ?? body.targetName,
            name: body.targetName ?? body.name ?? "",
            steamId: body.targetSteamId ?? body.steamId ?? body.steamID ?? "",
            eosId: body.targetEosId ?? body.eosId ?? body.eosID ?? "",
          },
          parameters: { message: body.message ?? "" },
          resultResolver: (payload) => payload?.success === false ? AUDIT_RESULTS.FAILED : AUDIT_RESULTS.SUCCESS,
        };
        const result = await this.executeAudited(auditContext, ({ requestId }) => api.warnPlayer({
          ...body,
          origin: "web",
          actor: user,
          sourcePage: body.sourcePage ?? AUDIT_SOURCE_PAGES.SQUAD_MANAGEMENT,
          requestId,
          system: false,
        }));
        return this.json(res, result?.code === "Forbidden" ? 403 : result.success ? 200 : 400, result);
      } catch (err) {
        return this.json(res, 500, { error: "InternalError", message: err.message });
      }
    }

    if (url.pathname === "/api/admin-warns/warn-target" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const api = this.modules.adminWarn;
      if (!api) return this.json(res, 404, { error: "ModuleNotFound" });
      const body = await this.readJsonBody(req);
      const targetScope = String(body?.targetScope ?? "").trim().toLowerCase();
      if (!["all", "team1", "team2"].includes(targetScope)) {
        return this.json(res, 400, { error: "InvalidWarningTarget" });
      }
      try {
        const targetName = targetScope === "all" ? "ALL" : targetScope.toUpperCase();
        const auditContext = {
          action: AUDIT_ACTIONS.PLAYER_WARN,
          category: AUDIT_CATEGORIES.PLAYER_MANAGEMENT,
          actor: user,
          request: req,
          sourcePage: body.sourcePage ?? AUDIT_SOURCE_PAGES.SQUAD_MANAGEMENT,
          serverId: body.serverId ?? this.getCurrentServerId(""),
          target: { type: targetScope === "all" ? "server" : "team", id: targetScope, name: targetName },
          parameters: { message: body.message ?? "", targetScope },
          resultResolver: (payload) => payload?.success === false ? AUDIT_RESULTS.FAILED : AUDIT_RESULTS.SUCCESS,
        };
        const result = await this.executeAudited(auditContext, ({ requestId }) => api.warnPlayer({
          ...body,
          targetScope,
          targetName,
          origin: "web",
          actor: user,
          sourcePage: body.sourcePage ?? AUDIT_SOURCE_PAGES.SQUAD_MANAGEMENT,
          requestId,
          system: false,
        }));
        return this.json(res, result?.code === "Forbidden" ? 403 : result.success ? 200 : 400, result);
      } catch (err) {
        return this.json(res, 500, { error: "InternalError", message: err.message });
      }
    }

    if (url.pathname === "/api/admin-warns/broadcast" && req.method === "POST") {
      const api = this.modules.adminWarn;
      if (!api) return this.json(res, 404, { error: "ModuleNotFound" });
      const body = await this.readJsonBody(req);
      try {
        const auditContext = {
          action: AUDIT_ACTIONS.SERVER_BROADCAST,
          category: AUDIT_CATEGORIES.SERVER_MANAGEMENT,
          actor: user,
          request: req,
          sourcePage: body.sourcePage ?? AUDIT_SOURCE_PAGES.RCON_CONSOLE,
          serverId: body.serverId ?? this.getCurrentServerId(""),
          target: { type: "server", id: body.serverId ?? this.getCurrentServerId(""), name: this.getServerName(body.serverId ?? this.getCurrentServerId("")) },
          parameters: {
            message: body.message ?? "",
            messageLength: String(body.message ?? "").length,
          },
          resultResolver: (payload) => payload?.success === false ? AUDIT_RESULTS.FAILED : AUDIT_RESULTS.SUCCESS,
        };
        const result = await this.executeAudited(auditContext, ({ requestId }) => api.broadcastMessage({
          ...body,
          origin: "web",
          actor: user,
          sourcePage: body.sourcePage ?? AUDIT_SOURCE_PAGES.RCON_CONSOLE,
          requestId,
          system: false,
        }));
        return this.json(res, result?.code === "Forbidden" ? 403 : result.success ? 200 : 400, result);
      } catch (err) {
        return this.json(res, 500, { error: "InternalError", message: err.message });
      }
    }

    if (url.pathname === "/api/kill-manage/kill" && req.method === "POST") {
      const api = this.modules.killManage;
      if (!api?.killPlayer) return this.json(res, 404, { error: "ModuleNotFound" });
      const body = await this.readJsonBody(req);
      try {
        const result = await api.killPlayer({ ...body, actor: user, system: Boolean(body?.system ?? false) });
        return this.json(res, result?.success ? 200 : result?.skipped ? 400 : 500, result);
      } catch (err) {
        return this.json(res, 500, { error: "InternalError", message: err.message });
      }
    }

    if (url.pathname === "/api/kill-manage/recent" && req.method === "GET") {
      const api = this.modules.killManage;
      if (!api?.getRecentKills) return this.json(res, 404, { error: "ModuleNotFound" });
      const limit = url.searchParams.get("limit") ?? 20;
      return this.json(res, 200, { records: api.getRecentKills("", limit) });
    }

    if (url.pathname === "/api/match-snapshot/list" && req.method === "GET") {
      if (!this.requireSuperAdmin(user, res)) return;
      const pluginApi = this.getPluginApi("match-snapshot");
      if (!pluginApi?.listSnapshots) return this.json(res, 404, { error: "PluginNotLoaded" });
      return this.json(res, 200, await pluginApi.listSnapshots());
    }

    if (url.pathname === "/api/match-snapshot/capture" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const body = await this.readJsonBody(req);
      const pluginApi = this.getPluginApi("match-snapshot");
      if (!pluginApi?.takeManualSnapshot) return this.json(res, 404, { error: "PluginNotLoaded" });
      const snapshot = await pluginApi.takeManualSnapshot({
        includeSteamID: body?.includeSteamID ?? body?.options?.includeSteamID,
        includeEOSID: body?.includeEOSID ?? body?.options?.includeEOSID,
        overview: body?.overview ?? body?.matchState ?? body?.snapshot ?? null,
      });
      return this.json(res, 200, { ok: true, snapshot });
    }

    if (url.pathname === "/api/match-snapshot/delete" && req.method === "DELETE") {
      if (!this.requireSuperAdmin(user, res)) return;
      const id = url.searchParams.get("id");
      if (!id) return this.json(res, 400, { error: "MissingId" });
      const pluginApi = this.getPluginApi("match-snapshot");
      if (!pluginApi?.deleteSnapshot) return this.json(res, 404, { error: "PluginNotLoaded" });
      const result = await pluginApi.deleteSnapshot(id);
      if (!result?.removed) return this.json(res, 404, { error: "SnapshotNotFound" });
      return this.json(res, 200, { ok: true, snapshot: result });
    }

    if (url.pathname === "/api/match-snapshot/view" && req.method === "GET") {
      if (!this.requireSuperAdmin(user, res)) return;
      const id = url.searchParams.get("id");
      if (!id) return this.json(res, 400, { error: "MissingId" });

      try {
        const pluginApi = this.getPluginApi("match-snapshot");
        if (pluginApi?.readSnapshotArtifact) {
          const artifact = await pluginApi.readSnapshotArtifact(
            id,
            url.searchParams.get("format") ?? url.searchParams.get("type") ?? "json",
          );
          const headers = {
            "Content-Type": artifact.contentType,
            "Cache-Control": "no-store",
          };
          if (url.searchParams.get("download") === "1") {
            headers["Content-Disposition"] = `attachment; filename="${safeHeaderFileName(artifact.fileName)}"`;
          }
          res.writeHead(200, headers);
          return res.end(artifact.content);
        }

        const safeId = path.basename(id);
        const filePath = path.join(process.cwd(), "data", "match-snapshots", safeId);
        const content = await fs.readFile(filePath);
        res.writeHead(200, {
          "Content-Type": contentType(filePath),
          "Cache-Control": "no-store",
        });
        return res.end(content);
      } catch (err) {
        if (err?.statusCode === 400) {
          return this.json(res, 400, { error: err.code ?? "InvalidSnapshotArtifact", message: err.message });
        }
        return this.json(res, 404, { error: "FileNotFound" });
      }
    }

    if (url.pathname === "/api/match-end-snapshot/list" && req.method === "GET") {
      if (!this.requireSuperAdmin(user, res)) return;
      const pluginApi = this.getPluginApi("match-end-snapshot");
      if (!pluginApi?.listSnapshots) return this.json(res, 404, { error: "PluginNotLoaded" });
      return this.json(res, 200, await pluginApi.listSnapshots({
        scope: url.searchParams.get("scope") ?? "official",
        search: url.searchParams.get("search") ?? "",
        map: url.searchParams.get("map") ?? "",
        mode: url.searchParams.get("mode") ?? "",
        winner: url.searchParams.get("winner") ?? "",
        from: url.searchParams.get("from") ?? "",
        to: url.searchParams.get("to") ?? "",
        minPlayers: url.searchParams.get("minPlayers"),
        maxPlayers: url.searchParams.get("maxPlayers"),
        sort: url.searchParams.get("sort") ?? "newest",
      }));
    }

    if (url.pathname === "/api/match-end-snapshot/statistics" && req.method === "GET") {
      if (!this.requireSuperAdmin(user, res)) return;
      const pluginApi = this.getPluginApi("match-end-snapshot");
      if (!pluginApi?.getStatistics) return this.json(res, 404, { error: "PluginNotLoaded" });
      return this.json(res, 200, await pluginApi.getStatistics({
        scope: url.searchParams.get("scope") ?? "all",
      }));
    }

    if (url.pathname === "/api/match-end-snapshot/capture" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const body = await this.readJsonBody(req);
      const pluginApi = this.getPluginApi("match-end-snapshot");
      if (!pluginApi?.takeManualSnapshot) return this.json(res, 404, { error: "PluginNotLoaded" });
      const snapshot = await pluginApi.takeManualSnapshot({
        overview: body?.overview ?? body?.matchState ?? body?.snapshot ?? null,
      });
      return this.json(res, 200, { ok: true, snapshot });
    }

    if (url.pathname === "/api/match-end-snapshot/debug/capture" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const pluginApi = this.getPluginApi("match-end-snapshot");
      if (!pluginApi?.takeDebugSnapshot) return this.json(res, 404, { error: "PluginNotLoaded" });
      try {
        const snapshot = await pluginApi.takeDebugSnapshot();
        return this.json(res, 200, { ok: true, snapshot });
      } catch (error) {
        return this.json(res, error?.statusCode === 409 ? 409 : 500, {
          error: error?.code ?? "DebugSnapshotFailed",
          message: error?.message ?? String(error),
          snapshotId: error?.debugSnapshotId ?? null,
        });
      }
    }

    if (url.pathname === "/api/match-end-snapshot/debug/list" && req.method === "GET") {
      if (!this.requireSuperAdmin(user, res)) return;
      const pluginApi = this.getPluginApi("match-end-snapshot");
      if (!pluginApi?.listDebugSnapshots) return this.json(res, 404, { error: "PluginNotLoaded" });
      return this.json(res, 200, await pluginApi.listDebugSnapshots());
    }

    if (url.pathname === "/api/match-end-snapshot/regenerate" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const body = await this.readJsonBody(req);
      const id = String(body?.id ?? "").trim();
      if (!id) return this.json(res, 400, { error: "MissingId" });
      const pluginApi = this.getPluginApi("match-end-snapshot");
      if (!pluginApi?.regenerateSnapshot) return this.json(res, 404, { error: "PluginNotLoaded" });

      try {
        const scope = body?.scope ?? body?.source ?? "official";
        const manifest = await pluginApi.regenerateSnapshot(id, { scope });
        return this.json(res, 200, {
          ok: true,
          id,
          fileName: manifest?.primaryImage ?? id + ".png",
          manifest,
          generatedAt: manifest?.generatedAt ?? new Date().toISOString(),
        });
      } catch (error) {
        if (error?.statusCode === 400) {
          return this.json(res, 400, {
            error: error.code ?? "InvalidSnapshotId",
            message: error.message,
          });
        }
        if (error?.code === "ENOENT") {
          return this.json(res, 404, {
            error: "SnapshotNotFound",
            message: "The historical snapshot JSON file was not found.",
          });
        }
        this.core?.logger?.error?.("[MatchEndSnapshot] regenerate request failed: " + (error?.stack || error));
        return this.json(res, 500, {
          error: error?.code ?? "SnapshotImageGenerationFailed",
          message: "Historical snapshot rendering failed: " + (error?.message ?? "Unknown error"),
        });
      }
    }

    if (url.pathname === "/api/match-end-snapshot/delete" && req.method === "DELETE") {
      if (!this.requireSuperAdmin(user, res)) return;
      const id = url.searchParams.get("id");
      if (!id) return this.json(res, 400, { error: "MissingId" });
      const pluginApi = this.getPluginApi("match-end-snapshot");
      if (!pluginApi?.deleteSnapshot) return this.json(res, 404, { error: "PluginNotLoaded" });
      const result = await pluginApi.deleteSnapshot(id, {
        scope: url.searchParams.get("scope") ?? "official",
      });
      if (!result?.removed) return this.json(res, 404, { error: "SnapshotNotFound" });
      return this.json(res, 200, { ok: true, snapshot: result });
    }

    if (url.pathname === "/api/match-end-snapshot/delete-batch" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const body = await this.readJsonBody(req);
      const records = Array.isArray(body?.records)
        ? body.records
        : Array.isArray(body?.ids)
          ? body.ids.map((id) => ({ id, scope: body?.scope ?? "official" }))
          : [];
      if (!records.length) return this.json(res, 400, { error: "MissingSnapshotIds" });
      const pluginApi = this.getPluginApi("match-end-snapshot");
      if (!pluginApi?.deleteSnapshots) return this.json(res, 404, { error: "PluginNotLoaded" });
      const result = await pluginApi.deleteSnapshots(records);
      return this.json(res, 200, { ok: true, ...result });
    }

    if (url.pathname === "/api/match-end-snapshot/image" && req.method === "GET") {
      if (!this.requireSuperAdmin(user, res)) return;
      const id = url.searchParams.get("id");
      if (!id) return this.json(res, 400, { error: "MissingId" });
      const pluginApi = this.getPluginApi("match-end-snapshot");
      if (!pluginApi?.readSnapshotImage) return this.json(res, 404, { error: "PluginNotLoaded" });

      try {
        const artifact = await pluginApi.readSnapshotImage(id, {
          force: url.searchParams.get("refresh") === "1",
          scope: url.searchParams.get("scope") ?? "official",
        });
        const headers = {
          "Content-Type": artifact.contentType,
          "Cache-Control": "no-store, max-age=0, must-revalidate",
        };
        if (url.searchParams.get("download") === "1") {
          headers["Content-Disposition"] = `attachment; filename="${safeHeaderFileName(artifact.fileName)}"`;
        }
        res.writeHead(200, headers);
        return res.end(artifact.content);
      } catch (error) {
        if (error?.statusCode === 400) {
          return this.json(res, 400, {
            error: error.code ?? "InvalidSnapshotId",
            message: error.message,
          });
        }
        if (error?.code === "ENOENT") {
          return this.json(res, 404, { error: "SnapshotImageNotFound" });
        }
        this.core?.logger?.error?.("[MatchEndSnapshot] image request failed: " + (error?.stack || error));
        return this.json(res, 500, {
          error: "SnapshotImageGenerationFailed",
          message: "The snapshot image could not be generated. Check the server log for details.",
        });
      }
    }

    if (url.pathname === "/api/match-end-snapshot/thumbnail" && req.method === "GET") {
      if (!this.requireSuperAdmin(user, res)) return;
      const id = url.searchParams.get("id");
      if (!id) return this.json(res, 400, { error: "MissingId" });
      const pluginApi = this.getPluginApi("match-end-snapshot");
      if (!pluginApi?.readSnapshotThumbnail) return this.json(res, 404, { error: "PluginNotLoaded" });
      try {
        const artifact = await pluginApi.readSnapshotThumbnail(id, {
          scope: url.searchParams.get("scope") ?? "official",
        });
        res.writeHead(200, {
          "Content-Type": artifact.contentType,
          "Cache-Control": "private, max-age=300",
        });
        return res.end(artifact.content);
      } catch (error) {
        if (error?.statusCode === 400) {
          return this.json(res, 400, {
            error: error.code ?? "InvalidSnapshotId",
            message: error.message,
          });
        }
        return this.json(res, 404, { error: "SnapshotThumbnailNotFound" });
      }
    }

    if (url.pathname === "/api/match-end-snapshot/view" && req.method === "GET") {
      if (!this.requireSuperAdmin(user, res)) return;
      const id = url.searchParams.get("id");
      if (!id) return this.json(res, 400, { error: "MissingId" });
      const pluginApi = this.getPluginApi("match-end-snapshot");
      if (!pluginApi?.readSnapshot) return this.json(res, 404, { error: "PluginNotLoaded" });

      try {
        const snapshot = await pluginApi.readSnapshot(id, {
          scope: url.searchParams.get("scope") ?? "official",
        });
        if (url.searchParams.get("download") === "1") {
          const fileName = safeHeaderFileName(path.basename(String(id)).replace(/\.json$/i, "") + ".json");
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="${fileName}"`,
            "Cache-Control": "no-store",
          });
          return res.end(JSON.stringify(snapshot, null, 2) + "\n");
        }
        return this.json(res, 200, snapshot);
      } catch (error) {
        if (error?.statusCode === 400) {
          return this.json(res, 400, {
            error: error.code ?? "InvalidSnapshotId",
            message: error.message,
          });
        }
        return this.json(res, 404, { error: "SnapshotNotFound" });
      }
    }

    if (url.pathname === "/api/server-stats/history" && req.method === "GET") {
      const api = this.modules.serverStats;
      if (!api?.getHistory) {
        return this.json(res, 404, {
          error: "ServerStatsUnavailable",
          message: "Server stats module is not loaded.",
        });
      }

      const controller = new AbortController();
      const abortRequest = () => controller.abort();
      req.once("aborted", abortRequest);
      res.once("close", abortRequest);
      try {
        const history = await api.getHistory({
          serverId: url.searchParams.get("server_id") ?? url.searchParams.get("serverId") ?? this.getCurrentServerId(""),
          fromMs: url.searchParams.get("from_ms") ?? url.searchParams.get("fromMs"),
          toMs: url.searchParams.get("to_ms") ?? url.searchParams.get("toMs"),
          maxPoints: url.searchParams.get("max_points") ?? url.searchParams.get("maxPoints") ?? 1500,
          includeCurrent: (url.searchParams.get("include_current") ?? url.searchParams.get("includeCurrent")) === "1",
          signal: controller.signal,
        });
        if (!controller.signal.aborted && !res.writableEnded) {
          return this.json(res, 200, history);
        }
        return undefined;
      } catch (error) {
        if (error?.name === "AbortError" || controller.signal.aborted) return undefined;
        if (error?.statusCode === 400) {
          return this.json(res, 400, { error: "InvalidServerStatsRange", message: error.message });
        }
        throw error;
      } finally {
        req.removeListener("aborted", abortRequest);
        res.removeListener("close", abortRequest);
      }
    }

    if (url.pathname === "/api/server-stats/current" && req.method === "GET") {
      const api = this.modules.serverStats;
      if (!api?.getCurrent) {
        return this.json(res, 404, {
          error: "ServerStatsUnavailable",
          message: "Server stats module is not loaded.",
        });
      }

      return this.json(res, 200, await api.getCurrent({
        serverId: url.searchParams.get("server_id") ?? url.searchParams.get("serverId") ?? this.getCurrentServerId(""),
      }));
    }

    if (url.pathname === "/api/server-stats/dates" && req.method === "GET") {
      const api = this.modules.serverStats;
      if (!api?.listAvailableDates) {
        return this.json(res, 404, {
          error: "ServerStatsUnavailable",
          message: "Server stats module is not loaded.",
        });
      }

      return this.json(res, 200, {
        dates: await api.listAvailableDates({
          serverId: url.searchParams.get("server_id") ?? url.searchParams.get("serverId") ?? this.getCurrentServerId(""),
        }),
      });
    }

    if (url.pathname === "/api/logpost/state" && req.method === "GET") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, await this.getLogPostState());
    }

    if (url.pathname === "/api/logpost/v2/state" && req.method === "GET") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, await this.getLogPostState());
    }

    if (url.pathname === "/api/logpost/raw" && req.method === "GET") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, await this.queryLogPostRawArchive({
        date: url.searchParams.get("date") ?? "",
        start: url.searchParams.get("start") ?? "",
        end: url.searchParams.get("end") ?? "",
        q: url.searchParams.get("q") ?? "",
        limit: url.searchParams.get("limit") ?? "200",
        offset: url.searchParams.get("offset") ?? "0",
      }));
    }

    if (url.pathname === "/api/logpost/v2/raw" && req.method === "GET") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, await this.queryLogPostRawArchive({
        date: url.searchParams.get("date") ?? "",
        start: url.searchParams.get("start") ?? "",
        end: url.searchParams.get("end") ?? "",
        q: url.searchParams.get("q") ?? "",
        limit: url.searchParams.get("limit") ?? "200",
        offset: url.searchParams.get("offset") ?? "0",
      }));
    }

    if (url.pathname === "/api/logpost/events" && req.method === "GET") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, await this.queryLogPostStructuredEvents({
        date: url.searchParams.get("date") ?? "",
        event: url.searchParams.get("event") ?? "",
        start: url.searchParams.get("start") ?? "",
        end: url.searchParams.get("end") ?? "",
        q: url.searchParams.get("q") ?? "",
        limit: url.searchParams.get("limit") ?? "200",
        offset: url.searchParams.get("offset") ?? "0",
      }));
    }

    if (url.pathname === "/api/logpost/v2/events" && req.method === "GET") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, await this.queryLogPostStructuredEvents({
        date: url.searchParams.get("date") ?? "",
        event: url.searchParams.get("event") ?? "",
        start: url.searchParams.get("start") ?? "",
        end: url.searchParams.get("end") ?? "",
        q: url.searchParams.get("q") ?? "",
        limit: url.searchParams.get("limit") ?? "200",
        offset: url.searchParams.get("offset") ?? "0",
      }));
    }

    if (url.pathname === "/api/logpost/gaps" && req.method === "GET") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, this.getLogPostGapState());
    }

    if (url.pathname === "/api/logpost/v2/gaps" && req.method === "GET") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, this.getLogPostGapState());
    }

    if (url.pathname === "/api/logpost/v2/outbox" && req.method === "GET") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, await this.queryLogPostOutbox({
        date: url.searchParams.get("date") ?? "",
        kind: url.searchParams.get("kind") ?? "",
        q: url.searchParams.get("q") ?? "",
        limit: url.searchParams.get("limit") ?? "200",
        offset: url.searchParams.get("offset") ?? "0",
      }));
    }

    if (url.pathname === "/api/logpost/v2/safety" && req.method === "GET") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, await this.queryLogPostSafety({
        date: url.searchParams.get("date") ?? "",
        kind: url.searchParams.get("kind") ?? "",
        q: url.searchParams.get("q") ?? "",
        limit: url.searchParams.get("limit") ?? "200",
        offset: url.searchParams.get("offset") ?? "0",
      }));
    }

    if (url.pathname === "/api/logpost/v2/replay" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const body = await this.readJsonBody(req);
      await this.writeLogPostAuditRecord("replay-requested", {
        requestedAt: new Date().toISOString(),
        body: body ?? {},
      });
      return this.json(res, 200, {
        ok: true,
        auditOnly: true,
        message: "Replay requests are audit-only in LogPost v2.",
      });
    }

    if (url.pathname === "/api/logpost/v2/checkpoint/repair" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const body = await this.readJsonBody(req);
      await this.writeLogPostAuditRecord("checkpoint-repair-requested", {
        requestedAt: new Date().toISOString(),
        body: body ?? {},
      });
      return this.json(res, 200, {
        ok: true,
        auditOnly: true,
        message: "Checkpoint repair requests are audit-only in LogPost v2.",
      });
    }

    if (url.pathname === "/api/remote-telemetry/state" && req.method === "GET") {
      const api = this.modules.remoteTelemetry;
      if (!api?.getState) {
        return this.json(res, 404, {
          error: "RemoteTelemetryUnavailable",
          message: "Remote telemetry module is not loaded.",
        });
      }

      return this.json(res, 200, {
        ok: true,
        source: "module.remoteTelemetry",
        remoteTelemetry: api.getState(),
      });
    }

    if (url.pathname === "/api/remote-telemetry/ticket-history" && req.method === "GET") {
      const api = this.modules.remoteTelemetry;
      if (!api?.getTicketHistory) {
        return this.json(res, 404, {
          error: "RemoteTelemetryUnavailable",
          message: "Remote telemetry ticket history is not available.",
        });
      }

      const sinceMs = Number(url.searchParams.get("since") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 0);
      return this.json(res, 200, {
        ok: true,
        ...api.getTicketHistory({ sinceMs, limit }),
      });
    }

    if (url.pathname === "/api/remote-telemetry/write-tickets" && req.method === "POST") {
      const hasPerm = this.core.authManager?.hasPermission
        ? this.core.authManager.hasPermission(user, "rcon.settickets")
        : this.core.authManager?.hasEverything?.(user);
      if (!hasPerm) {
        return this.json(res, 403, { error: "Forbidden", message: "rcon.settickets permission is required." });
      }
      const api = this.modules.remoteTelemetry;
      if (!api?.writeTickets) {
        return this.json(res, 404, {
          error: "RemoteTelemetryUnavailable",
          message: "Remote telemetry module is not loaded.",
        });
      }

      try {
        const body = await this.readJsonBody(req);
        const result = await api.writeTickets(body);
        return this.json(res, result?.ok ? 200 : 502, {
          ok: Boolean(result?.ok),
          source: "module.remoteTelemetry",
          type: "ticket_write",
          ...result,
        });
      } catch (error) {
        return this.json(res, 400, {
          ok: false,
          source: "module.remoteTelemetry",
          error: error?.message || "Ticket write failed.",
        });
      }
    }

    if (url.pathname === "/api/remote-telemetry/adjust-tickets" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const ticketAuditContext = {
        action: AUDIT_ACTIONS.TICKET_ADJUST,
        category: AUDIT_CATEGORIES.SERVER_MANAGEMENT,
        actor: user,
        request: req,
        sourcePage: body.sourcePage ?? AUDIT_SOURCE_PAGES.RCON_CONSOLE,
        serverId: body.serverId ?? this.getCurrentServerId(""),
        target: { type: "server", id: body.serverId ?? this.getCurrentServerId(""), name: this.getServerName(body.serverId ?? this.getCurrentServerId("")) },
        parameters: { ...body },
      };
      const hasPerm = this.core.authManager?.hasPermission
        ? this.core.authManager.hasPermission(user, "rcon.settickets")
        : this.core.authManager?.hasEverything?.(user);
      if (!hasPerm) {
        await this.auditForbidden(ticketAuditContext, "rcon.settickets permission is required.");
        return this.json(res, 403, { error: "Forbidden", message: "rcon.settickets permission is required." });
      }
      const api = this.modules.remoteTelemetry;
      if (!api?.adjustTickets) {
        return this.json(res, 404, {
          error: "RemoteTelemetryUnavailable",
          message: "Remote telemetry module is not loaded.",
        });
      }

      try {
        const auditContext = {
          action: AUDIT_ACTIONS.TICKET_ADJUST,
          category: AUDIT_CATEGORIES.SERVER_MANAGEMENT,
          actor: user,
          request: req,
          sourcePage: body.sourcePage ?? AUDIT_SOURCE_PAGES.RCON_CONSOLE,
          serverId: body.serverId ?? this.getCurrentServerId(""),
          target: { type: "server", id: body.serverId ?? this.getCurrentServerId(""), name: this.getServerName(body.serverId ?? this.getCurrentServerId("")) },
          parameters: { ...body },
          resultResolver: (payload) => payload?.ok === false ? AUDIT_RESULTS.FAILED : AUDIT_RESULTS.SUCCESS,
        };
        const result = await this.executeAudited(auditContext, () => api.adjustTickets({ ...body, actor: user, system: false }));
        return this.json(res, result?.ok ? 200 : 502, {
          ok: Boolean(result?.ok),
          source: "module.remoteTelemetry",
          type: "ticket_adjust",
          ...result,
        });
      } catch (error) {
        return this.json(res, 400, {
          ok: false,
          source: "module.remoteTelemetry",
          error: error?.message || "Ticket adjust failed.",
        });
      }
    }

    if (url.pathname === "/api/chat/history" && req.method === "GET") {
      const history = this.modules.chatManager.getHistory();
      return this.json(res, 200, { history });
    }

    if (url.pathname === "/api/chat/stats" && req.method === "GET") {
      return this.json(res, 200, {
        timeline: this.modules.chatManager.getStats(),
        spammers: this.modules.chatManager.getSpammers(),
        playerFrequencies: this.modules.chatManager.getPlayerFrequencies(),
      });
    }

    if (url.pathname === "/api/weapon-collector/clear" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const pluginApi = this.getPluginApi("plugin.weaponCollector");
      if (!pluginApi) {
        return this.json(res, 404, { error: "WeaponCollectorNotLoaded" });
      }
      const serverId = url.searchParams.get("serverId") ?? null;
      await pluginApi.clearWeaponStats(serverId);
      return this.json(res, 200, { ok: true });
    }

    return this.json(res, 404, { error: "ApiNotFound" });
  }

  async readJsonBody(req) {
    const text = (await this.readTextBody(req)).trim();
    if (!text) return {};

    try {
      return JSON.parse(text);
    } catch {
      throw createHttpError(400, "InvalidJson", "Request body must be valid JSON.");
    }
  }

  async readTextBody(req) {
    const chunks = [];
    let totalLength = 0;

    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalLength += buffer.length;
      if (totalLength > MAX_JSON_BODY_BYTES) {
        throw createHttpError(413, "RequestBodyTooLarge", "Request body too large.");
      }
      chunks.push(buffer);
    }

    return Buffer.concat(chunks, totalLength).toString("utf8");
  }

  async ensureInitialMatchPlayers() {
    const runtimeState = this.core.runtimeState;
    const currentPlayers = runtimeState?.getPlayers?.() ?? null;
    const rconStatus = this.core.rconManager?.getStatus?.() ?? {};

    // Only hydrate an uninitialized snapshot. Once a valid RCON result exists,
    // ordinary snapshot reads must remain cheap and must not issue commands.
    if (!rconStatus.connected || Number(currentPlayers?.updatedAt ?? 0) > 0) return;
    const refresh = this.modules.matchState?.refresh;
    if (typeof refresh !== "function") return;

    if (!this.initialMatchHydration) {
      this.initialMatchHydration = Promise.resolve()
        .then(() => refresh("players"))
        .catch((error) => {
          this.logger.warn?.(`Initial match player hydration failed: ${error?.message ?? error}`);
          return null;
        })
        .finally(() => {
          this.initialMatchHydration = null;
        });
    }

    await this.initialMatchHydration;
  }

  getMatchOverviewFromRuntime() {
    if (!this.core.runtimeState) {
      return this.modules.matchState?.getOverview?.() ?? {};
    }

    const match = this.core.runtimeState.getMatch();
    const webStatus = this.core.webStatus?.getSnapshot?.() ?? {};
    const rconStatus = this.core.rconManager?.getStatus?.() ?? {};
    return {
      status: webStatus,
      matchState: match,
      serverStatus: {
        ...webStatus,
        ...(match.server ?? {}),
      },
      match,
      players: match.players?.active ?? [],
      recentlyDisconnected: match.players?.recentlyDisconnected ?? [],
      squads: match.squads?.list ?? [],
      teams: match.teams ?? [],
      rconStatus,
      logAccess: {
        granted: webStatus.pythonLogParser === "running" || webStatus.udpReceiver === "listening",
        pythonLogParser: webStatus.pythonLogParser ?? "unknown",
        udpReceiver: webStatus.udpReceiver ?? "unknown",
      },
    };
  }

  getRoundStateFromRuntime() {
    const snapshot = this.core.runtimeState?.getAll?.() ?? null;
    const roundEvents = snapshot?.events?.round ?? [];
    return {
      serverId: this.core.webStatus?.serverId ?? "",
      updatedAt: snapshot?.events?.updatedAt ?? "",
      current: roundEvents.length ? roundEvents[roundEvents.length - 1] : null,
      history: roundEvents,
      lastAcceptedAt: roundEvents.length ? String(roundEvents[roundEvents.length - 1]?.receivedAt ?? roundEvents[roundEvents.length - 1]?.time ?? "") : "",
      lastDedupedAt: "",
    };
  }

  getRoundOverviewFromRuntime() {
    const roundState = this.getRoundStateFromRuntime();
    const status = this.core.webStatus?.getSnapshot?.() ?? {};
    return {
      status,
      roundState,
      latest: roundState.history.slice(-20).reverse(),
    };
  }

  getMatchOverview() {
    return this.modules.matchState?.getOverview?.() ?? this.getMatchOverviewFromRuntime();
  }

  getMatchStateSnapshotResponse() {
    const matchStateModule = this.modules.matchState;
    const matchState = matchStateModule?.getState?.() ?? null;
    const overview = matchStateModule?.getOverview?.(matchState) ?? this.getMatchOverview();
    const resolvedMatchState = matchState ?? overview?.matchState ?? null;
    return {
      ok: true,
      source: "module.matchState",
      type: "snapshot",
      matchState: resolvedMatchState,
      overview,
    };
  }

  async refreshMatchState(type = "all") {
    const matchStateModule = this.modules.matchState;
    if (!matchStateModule?.refresh) {
      return {
        ok: false,
        source: "module.matchState",
        type,
        error: "MatchStateUnavailable",
        message: "Match state module is not loaded.",
      };
    }

    const matchState = await matchStateModule.refresh(type);
    const snapshot = matchStateModule.getState?.() ?? matchState ?? null;
    const overview = matchStateModule.getOverview?.() ?? null;
    return {
      ok: true,
      source: "module.matchState",
      type,
      matchState: snapshot,
      overview,
    };
  }

  normalizeMatchRefreshType(type) {
    const normalized = String(type ?? "all").trim();
    if (["players", "squads", "serverInfo", "currentMap", "nextMap", "all"].includes(normalized)) {
      return normalized;
    }
    return "all";
  }

  createLocalJob(type, input = {}) {
    const now = Date.now();
    const job = {
      id: `local-${now}-${++this.jobCounter}`,
      type,
      status: "queued",
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      input,
      result: null,
      error: null,
    };
    this.pruneLocalJobs();
    this.jobs.set(job.id, job);
    this.core.runtimeState?.updateJob?.(job);
    return { ...job };
  }

  runLocalJob(publicJob, runner) {
    const job = this.jobs.get(publicJob.id);
    if (!job) return;
    job.status = "running";
    job.startedAt = Date.now();
    this.core.runtimeState?.updateJob?.(job);

    Promise.resolve()
      .then(runner)
      .then((result) => {
        job.status = "completed";
        job.result = result;
      })
      .catch((error) => {
        job.status = "failed";
        job.error = {
          message: error?.message || "Job failed.",
        };
      })
      .finally(() => {
        job.finishedAt = Date.now();
        this.core.runtimeState?.updateJob?.(job);
        this.pruneLocalJobs();
      });
  }
    // API route handling has been refactored to appropriate modules.



  async readJsonBody(req) {
    const text = (await this.readTextBody(req)).trim();
    if (!text) return {};

    try {
      return JSON.parse(text);
    } catch {
      throw createHttpError(400, "InvalidJson", "Request body must be valid JSON.");
    }
  }

  async readTextBody(req) {
    const chunks = [];
    let totalLength = 0;

    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalLength += buffer.length;
      if (totalLength > MAX_JSON_BODY_BYTES) {
        throw createHttpError(413, "RequestBodyTooLarge", "Request body too large.");
      }
      chunks.push(buffer);
    }

    return Buffer.concat(chunks, totalLength).toString("utf8");
  }

  getMatchOverviewFromRuntime() {
    if (!this.core.runtimeState) {
      return this.modules.matchState?.getOverview?.() ?? {};
    }

    const match = this.core.runtimeState.getMatch();
    const webStatus = this.core.webStatus?.getSnapshot?.() ?? {};
    const rconStatus = this.core.rconManager?.getStatus?.() ?? {};
    return {
      status: webStatus,
      matchState: match,
      serverStatus: {
        ...webStatus,
        ...(match.server ?? {}),
      },
      match,
      players: match.players?.active ?? [],
      recentlyDisconnected: match.players?.recentlyDisconnected ?? [],
      squads: match.squads?.list ?? [],
      teams: match.teams ?? [],
      rconStatus,
      logAccess: {
        granted: webStatus.pythonLogParser === "running" || webStatus.udpReceiver === "listening",
        pythonLogParser: webStatus.pythonLogParser ?? "unknown",
        udpReceiver: webStatus.udpReceiver ?? "unknown",
      },
    };
  }

  getRoundStateFromRuntime() {
    const snapshot = this.core.runtimeState?.getAll?.() ?? null;
    const roundEvents = snapshot?.events?.round ?? [];
    return {
      serverId: this.core.webStatus?.serverId ?? "",
      updatedAt: snapshot?.events?.updatedAt ?? "",
      current: roundEvents.length ? roundEvents[roundEvents.length - 1] : null,
      history: roundEvents,
      lastAcceptedAt: roundEvents.length ? String(roundEvents[roundEvents.length - 1]?.receivedAt ?? roundEvents[roundEvents.length - 1]?.time ?? "") : "",
      lastDedupedAt: "",
    };
  }

  getRoundOverviewFromRuntime() {
    const roundState = this.getRoundStateFromRuntime();
    const status = this.core.webStatus?.getSnapshot?.() ?? {};
    return {
      status,
      roundState,
      latest: roundState.history.slice(-20).reverse(),
    };
  }

  getMatchOverview() {
    return this.modules.matchState?.getOverview?.() ?? this.getMatchOverviewFromRuntime();
  }

  getMatchStateSnapshotResponse() {
    const matchStateModule = this.modules.matchState;
    const remoteTelemetry = this.modules.remoteTelemetry?.getState?.() ?? null;
    const matchState = matchStateModule?.getState?.() ?? null;
    const overview = matchStateModule?.getOverview?.(matchState) ?? this.getMatchOverview();
    const resolvedMatchState = matchState ?? overview?.matchState ?? null;
    return {
      ok: true,
      source: "module.matchState",
      type: "snapshot",
      matchState: resolvedMatchState,
      overview,
      remoteTelemetry,
    };
  }

  async refreshMatchState(type = "all") {
    const matchStateModule = this.modules.matchState;
    if (!matchStateModule?.refresh) {
      return {
        ok: false,
        source: "module.matchState",
        type,
        error: "MatchStateUnavailable",
        message: "Match state module is not loaded.",
      };
    }

    const matchState = await matchStateModule.refresh(type);
    const snapshot = matchStateModule.getState?.() ?? matchState ?? null;
    const overview = matchStateModule.getOverview?.() ?? null;
    return {
      ok: true,
      source: "module.matchState",
      type,
      matchState: snapshot,
      overview,
    };
  }

  normalizeMatchRefreshType(type) {
    const normalized = String(type ?? "all").trim();
    if (["players", "squads", "serverInfo", "currentMap", "nextMap", "all"].includes(normalized)) {
      return normalized;
    }
    return "all";
  }

  createLocalJob(type, input = {}) {
    const now = Date.now();
    const job = {
      id: `local-${now}-${++this.jobCounter}`,
      type,
      status: "queued",
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      input,
      result: null,
      error: null,
    };
    this.pruneLocalJobs();
    this.jobs.set(job.id, job);
    this.core.runtimeState?.updateJob?.(job);
    return { ...job };
  }

  runLocalJob(publicJob, runner) {
    const job = this.jobs.get(publicJob.id);
    if (!job) return;
    job.status = "running";
    job.startedAt = Date.now();
    this.core.runtimeState?.updateJob?.(job);

    Promise.resolve()
      .then(runner)
      .then((result) => {
        job.status = "completed";
        job.result = result;
      })
      .catch((error) => {
        job.status = "failed";
        job.error = {
          message: error?.message || "Job failed.",
        };
      })
      .finally(() => {
        job.finishedAt = Date.now();
        this.core.runtimeState?.updateJob?.(job);
        this.pruneLocalJobs();
      });
  }

  pruneLocalJobs(now = Date.now()) {
    const removable = [...this.jobs.values()]
      .filter((job) => job?.status !== "queued" && job?.status !== "running")
      .sort((a, b) => Number(a?.finishedAt ?? a?.createdAt ?? 0) - Number(b?.finishedAt ?? b?.createdAt ?? 0));

    for (const job of removable) {
      const completedAt = Number(job?.finishedAt ?? job?.createdAt ?? 0);
      if (completedAt > 0 && now - completedAt > LOCAL_JOB_TTL_MS) {
        this.jobs.delete(job.id);
      }
    }

    if (this.jobs.size <= MAX_LOCAL_JOB_HISTORY) return;
    for (const job of removable) {
      if (this.jobs.size <= MAX_LOCAL_JOB_HISTORY) break;
      this.jobs.delete(job.id);
    }
  }

  async getJob(jobId, { waitMs = 0 } = {}) {
    const localJob = this.jobs.get(String(jobId ?? ""));
    if (localJob) return { ...localJob };

    if (this.modules.playtime?.waitForJob && Number(waitMs) > 0) {
      return this.modules.playtime.waitForJob(jobId, waitMs);
    }
    return this.modules.playtime?.getJob?.(jobId) ?? null;
  }

  async serveStatic(url, req, res) {
    let filePath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
    const abs = path.join(this.staticDirectory, filePath);

    let stat;
    try {
      stat = await fs.stat(abs);
    } catch (error) {
      if (error?.code === "ENOENT" && !path.extname(filePath)) return this.serveIndex(res);
      res.writeHead(404, { ...BASE_SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    if (!stat.isFile()) {
      if (!path.extname(filePath)) return this.serveIndex(res);
      res.writeHead(404, { ...BASE_SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    const isHtml = abs.endsWith(".html");
    let mime = contentType(abs);
    if (isHtml && (!mime || !mime.includes("charset"))) {
      mime = mime ? `${mime}; charset=utf-8` : "text/html; charset=utf-8";
    }
    const etag = `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
    const lastModified = stat.mtime.toUTCString();
    if (req.headers["if-none-match"] === etag
      || (!req.headers["if-none-match"] && req.headers["if-modified-since"]
        && Date.parse(req.headers["if-modified-since"]) >= Math.trunc(stat.mtimeMs / 1000) * 1000)) {
      res.writeHead(304, {
        ...BASE_SECURITY_HEADERS,
        ETag: etag,
        "Last-Modified": lastModified,
        "Cache-Control": isHtml ? "no-store" : "public, max-age=31536000, immutable",
      });
      res.end();
      return;
    }

    res.writeHead(200, {
      ...BASE_SECURITY_HEADERS,
      "Content-Type": mime,
      "Content-Length": stat.size,
      "Last-Modified": lastModified,
      ETag: etag,
      "Cache-Control": isHtml ? "no-store" : "public, max-age=31536000, immutable",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const stream = createReadStream(abs);
    stream.on("error", (error) => {
      this.logger?.error?.("Static file stream failed.", {
        operation: "serveStatic",
        data: { path: abs, message: error?.message ?? String(error) },
      });
      if (!res.headersSent) {
        res.writeHead(500, { ...BASE_SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
        res.end("Internal Server Error");
      } else {
        res.destroy(error);
      }
    });
    stream.pipe(res);
  }

  async serveIndex(res) {
    const indexPath = path.join(this.staticDirectory, "index.html");
    let data;
    try {
      data = await fs.readFile(indexPath);
    } catch (error) {
      throw createHttpError(
        503,
        "VueClientNotBuilt",
        `Vue client index.html not found at ${indexPath}. Run npm run client:build before using production static hosting.`,
      );
    }
    res.writeHead(200, {
      ...BASE_SECURITY_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(data);
  }

  async warnIfStaticIndexMissing() {
    const indexPath = path.join(this.staticDirectory, "index.html");
    try {
      await fs.access(indexPath);
    } catch {
      this.logger.warn(
        `Web static index missing: ${indexPath}. Run npm run client:build before opening Vue production routes.`,
      );
    }
  }

  json(res, status, obj, extraHeaders = {}) {
    const start = performance.now();
    const store = requestStorage.getStore();
    const req = store?.req;
    let pretty = false;
    if (req) {
      try {
        const host = req.headers.host || "localhost";
        const url = new URL(req.url, `http://${host}`);
        pretty = url.searchParams.has("pretty");
      } catch {}
    }
    const data = pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
    const durationMs = performance.now() - start;
    const sizeBytes = Buffer.byteLength(data);

    let urlObj = null;
    try {
      urlObj = new URL(req?.url ?? "/", `http://${req?.headers?.host ?? "localhost"}`);
    } catch {}

    if (urlObj?.pathname === "/api/snapshot/all") {
      this.lastSnapshotSizeBytes = sizeBytes;
    }

    const performanceConfig = this.core?.config?.get?.("performance") ?? {};
    const largeJsonBytes = performanceConfig.largeJsonBytes ?? 262144;
    const slowJsonMs = performanceConfig.slowJsonMs ?? 50;

    if (sizeBytes > largeJsonBytes || durationMs > slowJsonMs) {
      const urlStr = req?.url ?? "unknown";
      this.logger?.warn(`[large-slow-json] url=${urlStr} sizeBytes=${sizeBytes} durationMs=${durationMs.toFixed(2)}ms`);
    }

    res.writeHead(status, {
      ...BASE_SECURITY_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    });
    res.end(data);
  }

  getRequestIp(req) {
    const remoteAddress = req.socket?.remoteAddress ?? "";
    // Only trust X-Forwarded-For when the connection source is a trusted proxy to prevent client IP spoofing
    if (this.trustedProxies.size > 0 && this.trustedProxies.has(remoteAddress)) {
      const forwarded = req.headers["x-forwarded-for"];
      if (typeof forwarded === "string" && forwarded.trim()) {
        return forwarded.split(",")[0].trim();
      }
    }
    return remoteAddress;
  }

  async handleUpgrade(req, socket, head) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const connectionKind = url.pathname === "/ws/console"
      ? "console"
      : url.pathname === "/ws/chat"
        ? "chat"
        : url.pathname === "/ws/astrbot"
          ? "astrbot"
          : null;

    if (!connectionKind) {
      return this.rejectUpgrade(socket, 404, "Not Found");
    }

    // AstrBot is an external machine-to-machine client. It must be
    // authenticated by the bridge Bearer token, not by the Panel session
    // cookie used by the browser WebSocket channels.
    if (connectionKind === "astrbot") {
      const bridge = this.modules.astrbotBridge;
      if (!bridge?.acceptWebSocket) {
        return this.rejectUpgrade(socket, 503, "AstrBot bridge unavailable.");
      }
      return bridge.acceptWebSocket(req, socket, head);
    }

    const user = this.core.authManager?.getUserFromRequest(req);
    if (!user) {
      return this.rejectUpgrade(socket, 401, "Authentication required.");
    }
    if (connectionKind === "console" && !this.core.authManager?.hasEverything?.(user)) {
      return this.rejectUpgrade(socket, 403, "SuperAdmin role is required.");
    }

    const key = String(req.headers["sec-websocket-key"] ?? "").trim();
    if (!key) {
      return this.rejectUpgrade(socket, 400, "Missing WebSocket key.");
    }

    const acceptKey = crypto
      .createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptKey}`,
        "",
        "",
      ].join("\r\n"),
    );

    const client = {
      socket,
      buffer: Buffer.alloc(0),
      user,
      kind: connectionKind,
    };

    if (connectionKind === "console") {
      this.consoleConnections.add(client);
    } else {
      this.chatConnections.add(client);
    }

    socket.on("data", (chunk) => {
      this.handleWebSocketData(client, chunk);
    });

    socket.on("close", () => {
      this.closeWebSocketClient(client);
    });

    socket.on("error", () => {
      this.closeWebSocketClient(client);
    });

    if (connectionKind === "chat") {
      this.sendChatRecentSnapshot(client);
    }

    if (head && head.length) {
      this.handleWebSocketData(client, head);
    }
  }

  rejectUpgrade(socket, statusCode, message) {
    const body = Buffer.from(String(message ?? ""), "utf8");
    socket.end(
      Buffer.concat([
        Buffer.from(
          [
            `HTTP/1.1 ${statusCode} ${statusText(statusCode)}`,
            "Connection: close",
            "Content-Type: text/plain; charset=utf-8",
            `Content-Length: ${body.length}`,
            "",
            "",
          ].join("\r\n"),
          "utf8",
        ),
        body,
      ]),
    );
  }

  handleWebSocketData(client, chunk) {
    client.buffer = Buffer.concat([client.buffer, chunk]);

    while (client.buffer.length >= 2) {
      const first = client.buffer[0];
      const second = client.buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let payloadLength = second & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        if (client.buffer.length < offset + 2) return;
        payloadLength = client.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        if (client.buffer.length < offset + 8) return;
        const lengthBig = client.buffer.readBigUInt64BE(offset);
        if (lengthBig > BigInt(Number.MAX_SAFE_INTEGER)) {
          this.closeWebSocketClient(client);
          return;
        }
        payloadLength = Number(lengthBig);
        offset += 8;
      }

      // Prevent client from sending oversized frames to exhaust server memory (DoS protection)
      if (payloadLength > MAX_WS_FRAME_BYTES) {
        this.logger?.warn?.(`WebSocket: oversized frame (${payloadLength} bytes) from ${client.user?.username ?? "unknown"}, closing connection.`);
        this.closeWebSocketClient(client);
        return;
      }

      let mask;
      if (masked) {
        if (client.buffer.length < offset + 4) return;
        mask = client.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (client.buffer.length < offset + payloadLength) {
        return;
      }

      const payload = client.buffer.subarray(offset, offset + payloadLength);
      client.buffer = client.buffer.subarray(offset + payloadLength);

      if (masked && mask) {
        for (let i = 0; i < payload.length; i += 1) {
          payload[i] ^= mask[i % 4];
        }
      }

      if (opcode === 0x8) {
        this.closeWebSocketClient(client);
        return;
      }

      if (opcode === 0x9) {
        this.sendWebSocketFrame(client.socket, Buffer.alloc(0), 0xA);
      }
    }
  }

  closeWebSocketClient(client) {
    this.consoleConnections.delete(client);
    this.chatConnections.delete(client);
    try {
      this.sendWebSocketFrame(client.socket, Buffer.alloc(0), 0x8);
    } catch {}
    try {
      client.socket.end();
    } catch {}
  }

  broadcastConsoleEntry(entry) {
    if (!this.consoleConnections.size) return;
    const payload = Buffer.from(JSON.stringify(entry), "utf8");

    for (const client of [...this.consoleConnections]) {
      if (!client?.user?.isSuperAdmin) continue;
      try {
        this.sendWebSocketFrame(client.socket, payload, 0x1);
      } catch {
        this.consoleConnections.delete(client);
      }
    }
  }

  sendChatRecentSnapshot(client) {
    const history = this.modules.chatManager?.getHistory?.() ?? [];
    const payload = Buffer.from(JSON.stringify({
      event: "server:chat:recent",
      items: history,
    }), "utf8");

    try {
      this.sendWebSocketFrame(client.socket, payload, 0x1);
    } catch {
      this.closeWebSocketClient(client);
    }
  }

  broadcastChatEntry(entry) {
    if (!this.chatConnections.size) return;
    const payload = Buffer.from(JSON.stringify({
      event: "server:chat:message",
      item: entry,
    }), "utf8");

    for (const client of [...this.chatConnections]) {
      try {
        this.sendWebSocketFrame(client.socket, payload, 0x1);
      } catch {
        this.chatConnections.delete(client);
      }
    }
  }

  sendWebSocketFrame(socket, payload, opcode = 0x1) {
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const length = body.length;

    let header;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[1] = length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    header[0] = 0x80 | (opcode & 0x0f);
    if (!socket?.writable || socket.destroyed || Number(socket.writableLength ?? 0) > MAX_WS_BUFFERED_BYTES) {
      try {
        socket?.destroy?.();
      } catch {}
      throw new Error("WebSocket client is not keeping up with broadcasts.");
    }

    const accepted = socket.write(Buffer.concat([header, body]));
    if (!accepted && Number(socket.writableLength ?? 0) > MAX_WS_BUFFERED_BYTES) {
      try {
        socket.destroy();
      } catch {}
      throw new Error("WebSocket send buffer limit exceeded.");
    }
  }

  getCurrentServerId(fallback = "") {
    return this.core.webStatus?.serverId ?? fallback;
  }

  getConsoleChannels(options = {}) {
    if (this.core.console?.getLegacyChannels) {
      return this.core.console.getLegacyChannels(options);
    }

    if (this.modules.console?.getChannels) {
      return this.modules.console.getChannels(options);
    }

    return {
      streams: [],
      scopes: [],
      levels: [],
    };
  }

  getConsoleLines(options = {}) {
    if (this.core.console?.getLegacyLines) {
      return this.core.console.getLegacyLines(options);
    }

    if (this.modules.console?.getLines) {
      return this.modules.console.getLines(options);
    }

    return [];
  }

  executeConsoleRconCommand(command, meta = {}) {
    if (this.core.console?.executeRconCommand) {
      return this.core.console.executeRconCommand(command, meta);
    }

    if (this.modules.console?.executeRconCommand) {
      return this.modules.console.executeRconCommand(command, meta);
    }

    return {
      success: false,
      ok: false,
      message: "Console service unavailable.",
      response: "",
      status: "failed",
      durationMs: 0,
    };
  }

  async executeAudited(context, executor, options = {}) {
    if (!this.core.auditManager?.execute) {
      return executor({ requestId: "" });
    }
    return this.core.auditManager.execute(context, executor, options);
  }

  async auditForbidden(context, message = "Permission denied.") {
    await this.auditSyntheticFailure(context, {
      statusCode: 403,
      code: "Forbidden",
      message,
    });
  }

  async auditInvalid(context, code = "InvalidRequest", message = "Invalid request.") {
    await this.auditSyntheticFailure(context, {
      statusCode: 400,
      code,
      message,
    });
  }

  async auditSyntheticFailure(context, errorInfo) {
    if (!this.core.auditManager?.execute) return;
    try {
      await this.core.auditManager.execute(context, async () => {
        const error = new Error(errorInfo.message);
        error.statusCode = errorInfo.statusCode;
        error.code = errorInfo.code;
        throw error;
      });
    } catch {}
  }

  buildRconAuditContext(req, user, body = {}, route = "") {
    const serverId = body.serverId ?? this.core.webStatus?.serverId ?? "";
    return {
      action: AUDIT_ACTIONS.RCON_COMMAND_EXECUTE,
      category: AUDIT_CATEGORIES.RCON,
      actor: user,
      request: req,
      sourcePage: body.sourcePage ?? AUDIT_SOURCE_PAGES.RCON_CONSOLE,
      serverId,
      target: { type: "server", id: serverId, name: this.getServerName(serverId) },
      parameters: {
        command: sanitizeRconCommand(body.command),
        route,
      },
      resultResolver: (payload) => payload?.code === "Forbidden"
        ? AUDIT_RESULTS.FORBIDDEN
        : payload?.success === false
          ? AUDIT_RESULTS.FAILED
          : AUDIT_RESULTS.SUCCESS,
      resultDataBuilder: (payload) => ({
        success: Boolean(payload?.success),
        message: payload?.message ?? "",
        status: payload?.status ?? "",
        durationMs: payload?.durationMs ?? null,
      }),
    };
  }

  buildRemoveFromSquadAuditContext(req, user, body = {}) {
    const serverId = body.serverId ?? body.serverID ?? this.getCurrentServerId("");
    return {
      action: AUDIT_ACTIONS.PLAYER_REMOVE_FROM_SQUAD,
      category: AUDIT_CATEGORIES.PLAYER_MANAGEMENT,
      actor: user,
      request: req,
      sourcePage: body.sourcePage ?? AUDIT_SOURCE_PAGES.SQUAD_MANAGEMENT,
      serverId,
      target: {
        type: "player",
        id: body.steamId ?? body.steamID ?? body.anyId ?? body.playerKey ?? body.playerId ?? "",
        name: body.name ?? body.playerName ?? body.creatorName ?? "",
        steamId: body.steamId ?? body.steamID ?? "",
        eosId: body.eosId ?? body.eosID ?? "",
        teamId: body.teamId ?? body.teamID ?? null,
        squadId: body.squadId ?? body.squadID ?? null,
      },
      parameters: {
        reason: body.reason ?? "",
        source: body.source ?? "web.squadRemove",
      },
      resultResolver: (payload) => payload?.ok
        ? AUDIT_RESULTS.SUCCESS
        : payload?.error === "Forbidden"
          ? AUDIT_RESULTS.FORBIDDEN
          : AUDIT_RESULTS.FAILED,
    };
  }

  async executeTankBattleCommands(commands, meta = {}) {
    const results = [];
    for (const command of commands) {
      const result = await this.executeConsoleRconCommand(command, {
        requestedBy: meta.requestedBy ?? "web.tankBattle",
        actor: meta.actor ?? null,
        system: false,
      });
      results.push({
        command: sanitizeRconCommand(command),
        result: result?.success ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.FAILED,
        message: result?.message ?? "",
      });
    }

    const succeeded = results.filter((item) => item.result === AUDIT_RESULTS.SUCCESS).length;
    const failed = results.length - succeeded;
    const auditResult = failed === 0
      ? AUDIT_RESULTS.SUCCESS
      : succeeded > 0
        ? AUDIT_RESULTS.PARTIAL
        : AUDIT_RESULTS.FAILED;

    return {
      ok: failed === 0,
      success: failed === 0,
      auditResult,
      totalCommands: results.length,
      succeededCommands: succeeded,
      failedCommands: failed,
      commands: results,
    };
  }

  async executeBzssCoreCommand(body = {}) {
    return this.bzssCoreCommandService.execute({ ...body, source: body?.source ?? "web-api" });
  }

  normalizeBzssCoreCommand(body = {}) {
    return this.bzssCoreCommandService.normalize(body);
  }

  normalizeBzssCoreDirective(directive, parameter) {
    return this.bzssCoreCommandService.normalizeDirective(directive, parameter);
  }

  getBzssCorePlayerInfo(query = {}) {
    const monitor = this.modules.bzssCoreMonitor;
    const state = monitor?.getState?.() ?? {
      status: "unavailable",
      revision: 0,
      updatedAt: "",
      markerSeen: false,
      runtimePlayerCount: 0,
      scoreboardPlayerCount: 0,
      mainZoneCount: 0,
      rawLineHash: "",
      rawFields: [],
      lastError: "",
    };
    const includeAll = query?.all === true || query?.all === "1" || query?.all === 1;
    const snapshot = monitor?.getRawSnapshot?.() ?? null;
    const players = includeAll ? (monitor?.getPlayers?.() ?? []) : undefined;
    return {
      ok: true,
      state,
      status: state.status,
      runtimePlayers: includeAll ? (snapshot?.runtimePlayers ?? []) : undefined,
      scoreboardPlayers: includeAll ? (snapshot?.scoreboardPlayers ?? []) : undefined,
      players,
      captureZones: includeAll ? (snapshot?.captureZones ?? []) : undefined,
      fobs: includeAll ? (snapshot?.fobs ?? []) : undefined,
      mainZones: includeAll ? (snapshot?.mainZones ?? []) : undefined,
      vehicles: includeAll ? (snapshot?.vehicles ?? []) : undefined,
      explosions: includeAll ? (snapshot?.explosions ?? []) : undefined,
    };
  }

  getBzssCorePlayerInfoRaw() {
    const monitor = this.modules.bzssCoreMonitor;
    const snapshot = monitor?.getRawSnapshot?.();
    if (snapshot) {
      return {
        ok: true,
        ...snapshot,
        players: monitor?.getPlayers?.() ?? [],
      };
    }

    return {
      ok: true,
      status: "unavailable",
      revision: 0,
      updatedAt: "",
      markerSeen: false,
      runtimePlayerCount: 0,
      scoreboardPlayerCount: 0,
      mainZoneCount: 0,
      rawLineHash: "",
      rawFields: [],
      lastError: "",
    };
  }

  getBzssCoreVehicles() {
    const monitor = this.modules.bzssCoreMonitor;
    const state = monitor?.getState?.() ?? {};
    return {
      ok: true,
      status: state.status ?? "unavailable",
      updatedAt: state.vehicleFrameUpdatedAt ?? "",
      count: state.vehicleCount ?? 0,
      vehicles: monitor?.getVehicles?.() ?? monitor?.getRawSnapshot?.()?.vehicles ?? [],
      diagnostics: monitor?.getVehicleDiagnostics?.() ?? state.vehicleDebug ?? null,
    };
  }

  getServerInfoSnapshotState(options = {}) {
    const text = (...values) => {
      for (const value of values) {
        const str = value == null ? "" : String(value).trim();
        if (str) return str;
      }
      return "";
    };
    const number = (...values) => {
      for (const value of values) {
        const num = Number(value);
        if (Number.isFinite(num)) return num;
      }
      return null;
    };

    const runtime = this.core.runtimeState?.getAll?.() ?? null;
    const runtimeServer = runtime?.server ?? {};
    const runtimeMatch = runtime?.match ?? {};
    const runtimePlayers = Array.isArray(runtime?.players?.active) ? runtime.players.active : [];
    const runtimeSquads = Array.isArray(runtime?.squads?.list) ? runtime.squads.list : [];
    const overview = this.getMatchOverview();
    const bzssCore = this.getBzssCorePlayerInfo({ all: Boolean(options.includeAll ?? true) ? 1 : 0 });
    const bzssState = bzssCore?.state ?? null;
    const bzssRuntimePlayers = Array.isArray(bzssCore?.runtimePlayers) ? bzssCore.runtimePlayers : [];
    const bzssScoreboardPlayers = Array.isArray(bzssCore?.scoreboardPlayers) ? bzssCore.scoreboardPlayers : [];
    const captureZones = Array.isArray(bzssCore?.captureZones) ? bzssCore.captureZones : [];
    const fobs = Array.isArray(bzssCore?.fobs) ? bzssCore.fobs : [];
    const mergedPlayers = new Map();
    for (const player of bzssRuntimePlayers) {
      const key = player?.playerIndex ?? player?.playerId;
      if (key == null) continue;
      mergedPlayers.set(key, { ...player });
    }
    for (const player of bzssScoreboardPlayers) {
      const key = player?.playerIndex ?? player?.playerId;
      if (key == null) continue;
      const existing = mergedPlayers.get(key);
      mergedPlayers.set(key, existing ? { ...existing, ...player } : { ...player });
    }

    return {
      generatedAt: new Date().toISOString(),
      source: runtime ? "runtimeState" : "matchState",
      server: {
        serverId: text(runtimeServer?.serverId, runtimeMatch?.serverId, overview?.serverId, this.core.webStatus?.serverId, ""),
        serverName: text(runtimeServer?.serverName, runtimeServer?.name, overview?.serverName, this.core.webStatus?.serverName, ""),
        playerCount: number(runtimeServer?.playerCount, runtimeMatch?.players?.active?.length, overview?.status?.playerCount, this.core.webStatus?.playerCount, runtimePlayers.length) ?? 0,
        queueCount: number(runtimeServer?.queueCount, overview?.status?.queueCount, this.core.webStatus?.queueCount) ?? 0,
        tps: number(runtimeServer?.tps, overview?.status?.tps, this.core.webStatus?.tps),
        isWarmup: runtimeServer?.isWarmup ?? overview?.status?.isWarmup ?? this.core.webStatus?.isWarmup ?? false,
      },
      match: {
        map: text(runtimeMatch?.server?.map, runtimeServer?.map, overview?.status?.map, this.core.webStatus?.map, ""),
        layer: text(runtimeMatch?.server?.layer, runtimeServer?.layer, overview?.status?.layer, this.core.webStatus?.layer, ""),
        mode: text(runtimeMatch?.server?.mode, runtimeServer?.mode, overview?.status?.gameMode, this.core.webStatus?.gameMode, ""),
        nextLayer: text(runtimeMatch?.server?.nextLayer, runtimeServer?.nextLayer, overview?.status?.nextLayer, this.core.webStatus?.nextLayer, ""),
      },
      overview,
      runtime: {
        players: runtimePlayers,
        squads: runtimeSquads,
      },
      bzssCore: {
        state: bzssState,
        runtimePlayers: bzssRuntimePlayers,
        scoreboardPlayers: bzssScoreboardPlayers,
        players: [...mergedPlayers.values()],
        captureZones,
        fobs,
        explosions: Array.isArray(bzssCore?.explosions) ? bzssCore.explosions : [],
      },
    };
  }

  validateCreateVehicleParameter(parameter) {
    return this.bzssCoreCommandService.validateCreateVehicleParameter(parameter);
  }

  summarizePlaytimeJobForAudit(job) {
    const progress = job?.progress ?? {};
    const result = job?.result ?? {};
    return {
      jobId: job?.id ?? "",
      status: job?.status ?? "",
      selected: Number(result.selected ?? progress.selected ?? 0),
      updated: Number(result.updated ?? progress.updated ?? 0),
      skipped: Number(result.skipped ?? progress.skipped ?? 0),
      failed: Number(result.failed ?? progress.failed ?? 0),
      total: Number(result.total ?? progress.total ?? progress.selected ?? 0),
    };
  }

  watchPlaytimeAuditJob(jobId, context = {}) {
    const id = String(jobId ?? "").trim();
    if (!id || !this.core.auditManager?.update || !this.modules.playtime?.getJob) return;
    const requestId = String(context?.requestId ?? "").trim();
    if (!requestId && !context) return;

    const auditRequestId = context.requestId;
    const startedAt = Date.now();
    const timeoutMs = Math.max(10_000, Number(this.core.config?.get?.("audit.playtimeJobWatchTimeoutMs", 30 * 60_000)) || 30 * 60_000);
    const tick = async () => {
      const job = this.modules.playtime.getJob(id);
      if (!job) return;
      const done = job.status === "completed" || job.status === "failed";
      if (done) {
        await this.core.auditManager.update(auditRequestId, {
          result: job.status === "completed" ? AUDIT_RESULTS.SUCCESS : AUDIT_RESULTS.FAILED,
          resultData: this.summarizePlaytimeJobForAudit(job),
          errorCode: job.status === "failed" ? "PlaytimeJobFailed" : null,
          errorMessage: job.status === "failed" ? job?.error?.message ?? "Playtime job failed." : null,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - Number(context?.createdAtMs ?? startedAt),
        });
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) return;
      setTimeout(() => {
        tick().catch((error) => this.logger?.warn?.(`[AuditManager] playtime audit watcher failed: ${error.message}`));
      }, 2000).unref?.();
    };

    setTimeout(() => {
      tick().catch((error) => this.logger?.warn?.(`[AuditManager] playtime audit watcher failed: ${error.message}`));
    }, 500).unref?.();
  }

  getOnlinePlayerCount(serverId = this.getCurrentServerId("")) {
    try {
      return this.modules.playerState?.getOnlinePlayers?.(serverId)?.length ?? null;
    } catch {
      return null;
    }
  }

  getServerName(serverId = "") {
    const status = this.core.webStatus?.getSnapshot?.() ?? {};
    return status.serverName ?? status.server?.name ?? String(serverId ?? "");
  }

  canViewAudit(user) {
    return Boolean(
      this.core.authManager?.hasEverything?.(user)
      || this.core.authManager?.hasPermission?.(user, "audit.view"),
    );
  }

  canManagePlugins(user) {
    if (this.core.authManager?.hasEverything?.(user)) return true;
    const permissions = user?.permissions ?? user?.permission ?? [];
    if (Array.isArray(permissions)) return permissions.includes("plugins.manage");
    if (permissions && typeof permissions === "object") return Boolean(permissions["plugins.manage"]);
    return false;
  }

  canManageSettingsTools(user) {
    return Boolean(
      this.core.authManager?.hasEverything?.(user)
      || this.core.authManager?.hasPermission?.(user, "settings.manage"),
    );
  }

  canUseBzssCoreTool(user) {
    return Boolean(
      this.core.authManager?.hasEverything?.(user)
      || this.core.authManager?.hasPermission?.(user, "bzss_core.use"),
    );
  }

  async handleAdminUsersApi(url, req, res, user) {
    if (
      url.pathname !== "/api/admin/users"
      && !url.pathname.startsWith("/api/admin/users/")
      && url.pathname !== "/api/admin/permission-groups"
      && !url.pathname.startsWith("/api/admin/permission-groups/")
    ) {
      return false;
    }

    if (!this.requireSuperAdmin(user, res)) return true;

    const store = this.core.authManager?.userStore;
    if (!store) {
      this.json(res, 503, {
        error: "AuthUserStoreUnavailable",
        message: "Auth user store is unavailable.",
      });
      return true;
    }

    try {
      if (url.pathname === "/api/admin/permission-groups" && req.method === "GET") {
        const items = this.serializePermissionGroups(store.listPermissionGroups(), store.listUsers());
        return this.json(res, 200, {
          ok: true,
          items,
        });
      }

      if (url.pathname === "/api/admin/permission-groups" && req.method === "POST") {
        const body = await this.readJsonBody(req);
        const created = await store.createPermissionGroup({
          name: body?.name,
          enabled: body?.enabled ?? true,
          permissions: body?.permissions ?? [],
        });
        return this.json(res, 201, {
          ok: true,
          group: this.serializePermissionGroup(created, store.listUsers()),
        });
      }

      const permissionGroupMatch = url.pathname.match(/^\/api\/admin\/permission-groups\/([^/]+)$/);
      if (permissionGroupMatch) {
        const groupId = decodeURIComponent(permissionGroupMatch[1]);

        if (req.method === "PATCH") {
          const body = await this.readJsonBody(req);
          const updated = await store.updatePermissionGroup(groupId, {
            name: body?.name,
            enabled: body?.enabled,
            permissions: body?.permissions,
          });
          return this.json(res, 200, {
            ok: true,
            group: this.serializePermissionGroup(updated, store.listUsers()),
          });
        }

        if (req.method === "DELETE") {
          const deleted = await store.deletePermissionGroup(groupId);
          return this.json(res, 200, {
            ok: true,
            group: this.serializePermissionGroup(deleted, store.listUsers()),
          });
        }
      }

      if (url.pathname === "/api/admin/users" && req.method === "GET") {
        const avatarMap = await this.getAdminSteamAvatarMap(store.listUsers());
        const groups = store.listPermissionGroups();
        const items = store.listUsers().map((item) => this.serializeAdminUser(item, avatarMap, groups));
        return this.json(res, 200, {
          ok: true,
          items,
          stats: this.buildAdminUserStats(items),
          permissionGroups: this.serializePermissionGroups(groups, store.listUsers()),
        });
      }

      if (url.pathname === "/api/admin/users" && req.method === "POST") {
        const body = await this.readJsonBody(req);
        const username = String(body?.username ?? "").trim();
        const password = String(body?.password ?? "");
        if (!username) {
          return this.json(res, 400, { error: "InvalidUsername", message: "Username is required." });
        }
        if (password.length < 8) {
          return this.json(res, 400, { error: "InvalidPassword", message: "Password must be at least 8 characters." });
        }

        const steam64 = normalizeAdminSteam64ForRequest(body?.steam64);
        if (steam64) store.assertSteam64Available(steam64);

        const passwordHash = await this.core.authManager.hashPassword(password);
        const created = await store.createUser({
          username,
          passwordHash,
          role: body?.role ?? "Admin",
          displayName: body?.displayName ?? "",
          steam64,
          viewerTeamAutoSwapEnabled: body?.viewerTeamAutoSwapEnabled,
          enabled: body?.enabled ?? true,
          note: body?.note ?? "",
          permissionGroupId: this.normalizePermissionGroupIdForRequest(store, body?.permissionGroupId),
        });
        return this.json(res, 201, {
          ok: true,
          user: this.serializeAdminUser(created, await this.getAdminSteamAvatarMap([created]), store.listPermissionGroups()),
        });
      }

      const resetMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
      if (resetMatch && req.method === "POST") {
        const userId = decodeURIComponent(resetMatch[1]);
        const body = await this.readJsonBody(req);
        const password = String(body?.password ?? "");
        if (password.length < 8) {
          return this.json(res, 400, { error: "InvalidPassword", message: "Password must be at least 8 characters." });
        }

        const passwordHash = await this.core.authManager.hashPassword(password);
        const updated = await store.updatePassword(userId, passwordHash);
        return this.json(res, 200, {
          ok: true,
          user: this.serializeAdminUser(updated, await this.getAdminSteamAvatarMap([updated]), store.listPermissionGroups()),
        });
      }

      const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (!userMatch) {
        return this.json(res, 404, {
          error: "ApiNotFound",
          message: "Admin user API route not found.",
        });
      }

      const userId = decodeURIComponent(userMatch[1]);

      if (req.method === "PATCH") {
        const target = store.requireExistingUser(userId);
        const body = await this.readJsonBody(req);
        const nextEnabled = body?.enabled === undefined ? target.enabled : Boolean(body.enabled);
        const nextRole = body?.role === undefined ? target.role : body.role;
        if (target.id === user.id && target.enabled && !nextEnabled) {
          return this.json(res, 400, {
            error: "CannotDisableSelf",
            message: "Cannot disable the current account.",
          });
        }

        const steam64 = body?.steam64 === undefined ? undefined : normalizeAdminSteam64ForRequest(body.steam64);
        const updated = await store.updateUser(userId, {
          displayName: body?.displayName,
          role: nextRole,
          steam64,
          viewerTeamAutoSwapEnabled: body?.viewerTeamAutoSwapEnabled,
          enabled: nextEnabled,
          note: body?.note,
          permissionGroupId: body?.permissionGroupId === undefined
            ? undefined
            : this.normalizePermissionGroupIdForRequest(store, body?.permissionGroupId),
        });
        return this.json(res, 200, {
          ok: true,
          user: this.serializeAdminUser(updated, await this.getAdminSteamAvatarMap([updated]), store.listPermissionGroups()),
        });
      }

      if (req.method === "DELETE") {
        const target = store.requireExistingUser(userId);
        if (target.id === user.id) {
          return this.json(res, 400, {
            error: "CannotDeleteSelf",
            message: "Cannot delete the current account.",
          });
        }

        const deleted = await store.deleteUser(userId);
        return this.json(res, 200, {
          ok: true,
          user: this.serializeAdminUser(deleted, new Map(), store.listPermissionGroups()),
        });
      }

      return this.json(res, 405, {
        error: "MethodNotAllowed",
        message: "Unsupported admin user API method.",
      });
    } catch (error) {
      return this.json(res, Number(error?.statusCode ?? 500), {
        error: String(error?.code ?? "AdminUserApiError"),
        message: String(error?.message ?? "Admin user API request failed."),
      });
    }
  }

  async getAdminSteamAvatarMap(users = []) {
    const steamIDs = [...new Set(
      (Array.isArray(users) ? users : [])
        .map((item) => String(item?.steam64 ?? "").trim())
        .filter((item) => /^\d{17}$/.test(item)),
    )];
    if (!steamIDs.length) return new Map();

    const listPlayersBySteamIDs = this.modules.playerDatabase?.listPlayersBySteamIDs;
    if (typeof listPlayersBySteamIDs !== "function") return new Map();

    try {
      const rows = await listPlayersBySteamIDs.call(this.modules.playerDatabase, steamIDs);
      const map = new Map();
      for (const row of Array.isArray(rows) ? rows : []) {
        const steamID = String(row?.steam_id ?? row?.steamID ?? row?.steam64 ?? "").trim();
        const avatar = String(row?.steam_avatar ?? row?.steamAvatar ?? "").trim();
        if (steamID && avatar) map.set(steamID, avatar);
      }
      return map;
    } catch (error) {
      this.logger?.warn?.(`Failed to resolve admin Steam avatars: ${error.message}`);
      return new Map();
    }
  }

  serializeAuthSessionUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      isSuperAdmin: user.role === "SuperAdmin",
      steam64: user.steam64 ?? null,
      viewerTeamAutoSwapEnabled: user.viewerTeamAutoSwapEnabled !== false,
      permissions: Array.isArray(user.permissions) ? [...user.permissions] : [],
    };
  }
  async enrichAuthUserWithSteamAvatar(user) {
    if (!user) return null;
    const steam64 = String(user?.steam64 ?? "").trim();
    if (!/^\d{17}$/.test(steam64)) {
      return {
        ...user,
        steamAvatar: null,
      };
    }

    const steamAvatar = await this.getSteamAvatarBySteam64(steam64);
    return {
      ...user,
      steamAvatar,
    };
  }

  async getSteamAvatarBySteam64(steam64) {
    const listPlayersBySteamIDs = this.modules.playerDatabase?.listPlayersBySteamIDs;
    if (typeof listPlayersBySteamIDs !== "function") return null;

    try {
      const rows = await listPlayersBySteamIDs.call(this.modules.playerDatabase, [steam64]);
      const first = Array.isArray(rows) ? rows[0] : null;
      const avatar = String(first?.steam_avatar ?? first?.steamAvatar ?? "").trim();
      return avatar || null;
    } catch (error) {
      this.logger?.warn?.(`Failed to resolve Steam avatar for auth user: ${error.message}`);
      return null;
    }
  }

  serializeAdminUser(user, steamAvatarMap = new Map()) {
    const groups = arguments[2] ?? [];
    const groupMap = new Map((Array.isArray(groups) ? groups : []).map((group) => [group.id, group]));
    const permissionGroup = user.permissionGroupId ? groupMap.get(user.permissionGroupId) : null;
    const permissions = user.role === "SuperAdmin"
      ? ["*"]
      : (permissionGroup?.enabled !== false ? [...(permissionGroup?.permissions ?? [])] : []);
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? "",
      role: user.role,
      steam64: user.steam64 ?? null,
      steamAvatar: user.steam64 ? (steamAvatarMap.get(user.steam64) ?? null) : null,
      viewerTeamAutoSwapEnabled: user.viewerTeamAutoSwapEnabled !== false,
      enabled: user.enabled !== false,
      note: user.note ?? "",
      permissionGroupId: user.permissionGroupId ?? null,
      permissionGroupName: permissionGroup?.name ?? "",
      permissions,
      createdAt: Number(user.createdAt ?? 0),
      updatedAt: Number(user.updatedAt ?? 0),
      passwordChangedAt: Number(user.passwordChangedAt ?? 0),
    };
  }

  serializePermissionGroup(group, users = []) {
    const count = (Array.isArray(users) ? users : []).filter((user) => user.permissionGroupId === group.id).length;
    return {
      id: group.id,
      name: group.name,
      enabled: group.enabled !== false,
      permissions: Array.isArray(group.permissions) ? [...group.permissions] : [],
      assignedUsers: count,
      createdAt: Number(group.createdAt ?? 0),
      updatedAt: Number(group.updatedAt ?? 0),
    };
  }

  serializePermissionGroups(groups = [], users = []) {
    return (Array.isArray(groups) ? groups : []).map((group) => this.serializePermissionGroup(group, users));
  }

  buildAdminUserStats(items) {
    return {
      total: items.length,
      enabled: items.filter((item) => item.enabled).length,
      superAdmins: items.filter((item) => item.role === "SuperAdmin").length,
      steamBound: items.filter((item) => Boolean(item.steam64)).length,
    };
  }

  normalizePermissionGroupIdForRequest(store, value) {
    if (value === undefined) return undefined;
    if (value === null || String(value ?? "").trim() === "") return null;
    const groupId = String(value ?? "").trim();
    const group = store.getPermissionGroupById(groupId);
    if (!group) {
      const error = new Error("Permission group not found.");
      error.statusCode = 400;
      error.code = "PermissionGroupNotFound";
      throw error;
    }
    return groupId;
  }

  requireSuperAdmin(user, res) {
    if (!this.core.authManager?.hasEverything?.(user)) {
      this.json(res, 403, {
        error: "Forbidden",
        message: "SuperAdmin role is required.",
      });
      return false;
    }
    return true;
  }

  getLogPostConfigPath() {
    const parserConfig = this.core.config?.get?.("pythonLogParser", {}) ?? {};
    const workingDirectory = path.resolve(process.cwd(), String(parserConfig.workingDirectory ?? "./LogPost").trim());
    return path.resolve(workingDirectory, String(parserConfig.configPath ?? "./config.json").trim());
  }

  async readLogPostConfig() {
    const configPath = this.getLogPostConfigPath();
    const text = await fs.readFile(configPath, "utf8");
    return {
      configPath,
      config: JSON.parse(text),
    };
  }

  async getLogPostRawOutputConfig() {
    const { configPath, config } = await this.readLogPostConfig();
    return {
      enabled: Boolean(config.raw_log_output?.enabled),
      source: String(config.raw_log_output?.source ?? "Squad.log"),
      configPath,
    };
  }

  async setLogPostRawOutputConfig(enabled) {
    const { configPath, config } = await this.readLogPostConfig();
    config.raw_log_output = {
      ...(config.raw_log_output ?? {}),
      enabled: Boolean(enabled),
      source: String(config.raw_log_output?.source ?? "Squad.log"),
    };

    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    if (this.core.pythonLogParserManager?.restart) {
      await this.core.pythonLogParserManager.restart();
    }

    return {
      ok: true,
      enabled: Boolean(config.raw_log_output.enabled),
      source: String(config.raw_log_output.source),
      configPath,
      restarted: Boolean(this.core.pythonLogParserManager?.restart),
    };
  }

  getPluginApi(pluginId) {
    return this.core.pluginManager?.instances
      ?.find((instance) => instance.manifest?.id === pluginId)?.api ?? null;
  }

  getLogPostWorkingDirectory() {
    const parserConfig = this.core.config?.get?.("pythonLogParser", {}) ?? {};
    return path.resolve(process.cwd(), String(parserConfig.workingDirectory ?? "./LogPost").trim());
  }

  async getLogPostState() {
    const workingDirectory = this.getLogPostWorkingDirectory();
    const outputDir = resolveLogPostOutputDir(workingDirectory);
    const legacyStatePath = path.resolve(outputDir, ".state", "tailer-state.json");
    const v2StatePath = path.resolve(outputDir, "state", "source-state.json");
    const legacyState = await this.readJsonFileSafe(legacyStatePath, {});
    const sourceState = await this.readJsonFileSafe(v2StatePath, legacyState);
    const tailerState = sourceState;
    const gapState = this.getLogPostGapState();

    return {
      workingDirectory,
      outputDir,
      tailerState,
      sourceState,
      gapState,
    };
  }

  getLogPostGapState() {
    return this.core.logPostMonitor?.getState?.() ?? {
      lastSourceSeq: 0,
      lastEventId: "",
      recentGaps: [],
    };
  }

  async queryLogPostRawArchive({ date, start, end, q, limit, offset }) {
    const normalizedDate = normalizeLogPostDate(date);
    const workingDir = resolveLogPostOutputDir(this.getLogPostWorkingDirectory());
    const v2FilePath = path.resolve(workingDir, "raw", normalizedDate, "segment-000001.jsonl");
    const legacyFilePath = path.resolve(workingDir, "Raw", normalizedDate, "all.jsonl");
    const filePath = await this.resolveFirstExistingPath([v2FilePath, legacyFilePath]);
    const items = await this.readJsonlFile(filePath);
    const filtered = filterLogPostRows(items, {
      start,
      end,
      q,
      eventField: "",
      timeField: "readAt",
      messageFields: ["rawLine", "rawLineHash", "sourcePath"],
    });
    return paginateLogPostRows(filtered, limit, offset, {
      date: normalizedDate,
      filePath,
    });
  }

  async queryLogPostStructuredEvents({ date, event, start, end, q, limit, offset }) {
    const normalizedDate = normalizeLogPostDate(date);
    const workingDir = resolveLogPostOutputDir(this.getLogPostWorkingDirectory());
    const v2FilePath = path.resolve(workingDir, "events", normalizedDate, "all.jsonl");
    const legacyFilePath = path.resolve(workingDir, normalizedDate, "All.jsonl");
    const filePath = await this.resolveFirstExistingPath([v2FilePath, legacyFilePath]);
    const items = await this.readJsonlFile(filePath);
    const filtered = filterLogPostRows(items, {
      start,
      end,
      q,
      eventField: "Event",
      eventValue: event,
      timeField: "Time",
      messageFields: ["Raw", "Event", "EventId", "RawLineHash", "SourceSeq", "SourceOffset", "SourceMode"],
    });
    return paginateLogPostRows(filtered, limit, offset, {
      date: normalizedDate,
      filePath,
    });
  }

  async queryLogPostOutbox({ date, kind, q, limit, offset }) {
    const normalizedDate = normalizeLogPostDate(date);
    const dir = path.resolve(resolveLogPostOutputDir(this.getLogPostWorkingDirectory()), "outbox", normalizedDate);
    const items = await this.readJsonlDirectory(dir);
    const filtered = filterLogPostRows(items, {
      q,
      eventField: "status",
      eventValue: kind,
      timeField: "time",
      messageFields: ["eventName", "eventId", "sourceSeq", "sourceMode", "error"],
    });
    return paginateLogPostRows(filtered, limit, offset, {
      date: normalizedDate,
      filePath: dir,
    });
  }

  async queryLogPostSafety({ date, kind, q, limit, offset }) {
    const normalizedDate = normalizeLogPostDate(date);
    const dir = path.resolve(resolveLogPostOutputDir(this.getLogPostWorkingDirectory()), "audit", normalizedDate);
    const items = await this.readJsonlDirectory(dir);
    const filtered = filterLogPostRows(items, {
      q,
      eventField: "kind",
      eventValue: kind,
      timeField: "time",
      messageFields: ["kind", "reason", "sourceMode", "message", "eventName", "eventId"],
    });
    return paginateLogPostRows(filtered, limit, offset, {
      date: normalizedDate,
      filePath: dir,
    });
  }

  async writeLogPostAuditRecord(kind, payload = {}) {
    const outputDir = resolveLogPostOutputDir(this.getLogPostWorkingDirectory());
    const dir = path.resolve(outputDir, "audit", new Date().toISOString().slice(0, 10));
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.resolve(dir, `${kind}.jsonl`);
    const record = {
      schema: "logpost.audit.v2",
      kind: String(kind ?? "unknown"),
      time: new Date().toISOString(),
      ...payload,
    };
    await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
  }

  async readJsonlFile(filePath) {
    try {
      const text = await fs.readFile(filePath, "utf8");
      return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  async readJsonlDirectory(dirPath) {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl"))
        .map((entry) => path.join(dirPath, entry.name))
        .sort((left, right) => left.localeCompare(right));
      const rows = [];
      for (const filePath of files) {
        rows.push(...await this.readJsonlFile(filePath));
      }
      return rows;
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  async resolveFirstExistingPath(paths) {
    for (const filePath of paths) {
      try {
        await fs.access(filePath);
        return filePath;
      } catch {}
    }
    return paths[0] ?? "";
  }

  async readJsonFileSafe(filePath, fallback) {
    try {
      const text = await fs.readFile(filePath, "utf8");
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  }
}

function resolveLogPostOutputDir(workingDirectory) {
  const baseDirectory = path.resolve(workingDirectory);
  const candidates = [
    baseDirectory,
    path.resolve(baseDirectory, "LogPost"),
  ];

  for (const candidate of candidates) {
    if (
      existsSync(path.resolve(candidate, "events"))
      || existsSync(path.resolve(candidate, "raw"))
      || existsSync(path.resolve(candidate, "audit"))
      || existsSync(path.resolve(candidate, "state"))
      || existsSync(path.resolve(candidate, ".state"))
    ) {
      return candidate;
    }
  }

  return candidates[0];
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (filePath.endsWith(".md")) return "text/markdown; charset=utf-8";
  return "application/octet-stream";
}

function safeHeaderFileName(fileName) {
  return path.basename(String(fileName ?? "download"))
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_");
}

function createHttpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function statusText(code) {
  switch (code) {
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    default:
      return "Error";
  }
}

function parseOptionalBoolean(value) {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim().toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  return null;
}

function normalizeLogPostDate(value) {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return new Date().toISOString().slice(0, 10);
}

function filterLogPostRows(items, options = {}) {
  const startMs = parseOptionalDateMs(options.start);
  const endMs = parseOptionalDateMs(options.end);
  const keyword = String(options.q ?? "").trim().toLowerCase();
  const eventField = String(options.eventField ?? "").trim();
  const eventValue = String(options.eventValue ?? "").trim();
  const timeField = String(options.timeField ?? "Time").trim();
  const messageFields = Array.isArray(options.messageFields) ? options.messageFields : [];

  return (Array.isArray(items) ? items : []).filter((item) => {
    if (!item || typeof item !== "object") return false;

    if (eventField && eventValue) {
      if (String(item[eventField] ?? "").trim() !== eventValue) return false;
    }

    const currentMs = parseOptionalDateMs(item[timeField]);
    if (startMs != null && (currentMs == null || currentMs < startMs)) return false;
    if (endMs != null && (currentMs == null || currentMs > endMs)) return false;

    if (!keyword) return true;
    return messageFields.some((field) => String(item[field] ?? "").toLowerCase().includes(keyword));
  });
}

function paginateLogPostRows(items, limit, offset, extra = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 2000));
  const safeOffset = Math.max(0, Number(offset) || 0);
  return {
    ...extra,
    total: items.length,
    limit: safeLimit,
    offset: safeOffset,
    items: items.slice(safeOffset, safeOffset + safeLimit),
  };
}

function parseOptionalDateMs(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePlaytimeRow(row, playerTimeRow = null) {
  const steamSeconds = Number(row?.steam_game_seconds ?? row?.steamGameSeconds ?? row?.steam_seconds ?? row?.steamSeconds ?? row?.game_seconds ?? row?.gameSeconds ?? 0);
  const serverSecondsValue = Number(playerTimeRow?.server_seconds ?? playerTimeRow?.serverSeconds ?? row?.server_seconds ?? row?.serverSeconds ?? 0);
  const warmupSecondsValue = Number(playerTimeRow?.warmup_seconds ?? playerTimeRow?.warmupSeconds ?? row?.warmup_seconds ?? row?.warmupSeconds ?? 0);
  const serverSeconds = Number.isFinite(serverSecondsValue) ? Math.max(0, Math.floor(serverSecondsValue)) : 0;
  const warmupSeconds = Number.isFinite(warmupSecondsValue) ? Math.max(0, Math.floor(warmupSecondsValue)) : 0;
  const overrideValue = row?.game_seconds_override ?? row?.gameSecondsOverride;
  const normalizedOverride = overrideValue == null || String(overrideValue).trim() === ""
    ? null
    : Number(overrideValue);
  const safeOverrideSeconds = normalizedOverride == null || !Number.isFinite(normalizedOverride)
    ? null
    : Math.max(0, Math.floor(normalizedOverride));
  const effectiveSeconds = Number(safeOverrideSeconds ?? row?.game_seconds ?? row?.gameSeconds ?? steamSeconds ?? 0);
  const safeSeconds = Number.isFinite(effectiveSeconds) ? effectiveSeconds : 0;
  const safeSteamSeconds = Number.isFinite(steamSeconds) ? steamSeconds : 0;
  return {
    steamID: String(row?.steam_id ?? row?.steamID ?? ""),
    appId: Number(row?.app_id ?? row?.appId ?? 393380),
    gameName: String(row?.game_name ?? row?.gameName ?? "Squad"),
    gameSeconds: safeSeconds,
    steamGameSeconds: safeSteamSeconds,
    gameSecondsOverride: safeOverrideSeconds,
    gameHours: Number((safeSeconds / 3600).toFixed(2)),
    steamGameHours: Number((safeSteamSeconds / 3600).toFixed(2)),
    serverSeconds,
    warmupSeconds,
    fetchedAt: Number(row?.fetched_at ?? row?.fetchedAt ?? 0) || null,
    lastSeenName: row?.last_seen_name ?? row?.lastSeenName ?? null,
    steam_avatar: row?.steam_avatar ?? row?.steamAvatar ?? playerTimeRow?.steam_avatar ?? playerTimeRow?.steamAvatar ?? null,
    steamAvatar: row?.steam_avatar ?? row?.steamAvatar ?? playerTimeRow?.steam_avatar ?? playerTimeRow?.steamAvatar ?? null,
  };
}

function cleanPlayerForClient(player) {
  if (!player) return player;
  const cleaned = { ...player };
  delete cleaned.raw;
  return cleaned;
}

function cleanPlayersForClient(players) {
  if (!players) return players;
  const cleaned = { ...players };
  delete cleaned.bySteamID;
  delete cleaned.byEOSID;
  delete cleaned.byPlayerID;
  delete cleaned.byName;
  if (Array.isArray(cleaned.active)) {
    cleaned.active = cleaned.active.map(cleanPlayerForClient);
  }
  if (Array.isArray(cleaned.recentlyDisconnected)) {
    cleaned.recentlyDisconnected = cleaned.recentlyDisconnected.map(cleanPlayerForClient);
  }
  return cleaned;
}

function cleanSquadsForClient(squads) {
  if (!squads) return squads;
  const cleaned = { ...squads };
  delete cleaned.byKey;
  delete cleaned.byTeamID;
  return cleaned;
}

function cleanSnapshotAllForClient(all) {
  if (!all) return all;
  return {
    ...all,
    players: cleanPlayersForClient(all.players),
    squads: cleanSquadsForClient(all.squads),
    match: all.match ? {
      ...all.match,
      players: cleanPlayersForClient(all.match.players),
      squads: cleanSquadsForClient(all.match.squads),
    } : all.match,
  };
}

function cleanCombatEventForClient(event) {
  if (!event) return event;
  const cleaned = { ...event };
  delete cleaned.raw;
  delete cleaned.rawEvent;
  if (cleaned.attacker) {
    cleaned.attacker = { ...cleaned.attacker };
    delete cleaned.attacker.raw;
  }
  if (cleaned.victim) {
    cleaned.victim = { ...cleaned.victim };
    delete cleaned.victim.raw;
  }
  return cleaned;
}

function cleanCombatEventsForClient(events) {
  if (!Array.isArray(events)) return [];
  return events.map(cleanCombatEventForClient);
}

function cleanCombatOverviewForClient(overview) {
  if (!overview) return overview;
  const cleaned = { ...overview };
  delete cleaned.events;
  delete cleaned.latest;
  delete cleaned.rawLatest;
  delete cleaned.processedLatest;
  return cleaned;
}

function cleanBattleLogEventForClient(event) {
  if (!event) return event;
  const cleaned = { ...event };
  delete cleaned.raw;
  delete cleaned.rawEvent;
  if (cleaned.player) {
    cleaned.player = { ...cleaned.player };
    delete cleaned.player.raw;
  }
  if (cleaned.counterparty) {
    cleaned.counterparty = { ...cleaned.counterparty };
    delete cleaned.counterparty.raw;
  }
  if (cleaned.attacker) {
    cleaned.attacker = { ...cleaned.attacker };
    delete cleaned.attacker.raw;
  }
  if (cleaned.victim) {
    cleaned.victim = { ...cleaned.victim };
    delete cleaned.victim.raw;
  }
  return cleaned;
}

function cleanBattleLogEventsForClient(events) {
  if (!Array.isArray(events)) return [];
  return events.map(cleanBattleLogEventForClient);
}

function cleanBattleLogOverviewForClient(overview) {
  if (!overview) return overview;
  const cleaned = { ...overview };
  if (Array.isArray(cleaned.latest)) {
    cleaned.latest = cleanBattleLogEventsForClient(cleaned.latest);
  }
  return cleaned;
}

function cleanBattleLogEventsResponseForClient(data) {
  if (!data) return data;
  return {
    ...data,
    events: cleanBattleLogEventsForClient(data.events),
    overview: cleanBattleLogOverviewForClient(data.overview),
  };
}

function cleanBattleLogPlayerResponseForClient(data) {
  if (!data) return data;
  return {
    ...data,
    events: cleanBattleLogEventsForClient(data.events),
    latest: cleanBattleLogEventsForClient(data.latest),
  };
}

function normalizeSquadName(name) {
  return String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function buildTrackingKey(record = {}) {
  return [
    String(record.serverId ?? "").trim(),
    String(record.matchId ?? "").trim(),
    record.teamId == null ? "" : String(record.teamId),
    record.squadId == null ? "" : String(record.squadId),
    normalizeSquadName(record.squadName),
  ].join("|");
}

function buildSquadNameTrackingRecords({ guard, stepwise, fair, ruleChain, lifecycle }) {
  const grouped = new Map();

  for (const item of Array.isArray(guard?.recent) ? guard.recent : []) {
    const status = String(item.status ?? "").trim();
    if (!["violation", "handled", "error", "population_skipped", "queued", "classification_missing", "audit_only"].includes(status)) continue;
    const key = buildTrackingKey({
      serverId: item.serverId ?? item.event?.serverId ?? "",
      matchId: item.matchId ?? item.event?.matchId ?? "",
      teamId: item.event?.teamId ?? null,
      squadId: item.event?.squadId ?? null,
      squadName: item.event?.squadName ?? "",
    });
    if (!grouped.has(key)) grouped.set(key, { squadName: [], stepwise: [], fair: [] });
    grouped.get(key).squadName.push({
      id: item.id,
      serverId: item.serverId ?? item.event?.serverId ?? "",
      matchId: item.matchId ?? item.event?.matchId ?? "",
      teamId: item.event?.teamId ?? null,
      squadId: item.event?.squadId ?? null,
      squadName: item.event?.squadName ?? "",
      creatorName: item.event?.creatorName ?? "",
      creatorSteamId: item.event?.creatorSteamId ?? item.event?.creatorSteamID ?? item.event?.steamId ?? item.event?.steamID ?? "",
      source: "squad_name_rule",
      stage: "squad_name",
      status,
      decisionLabel: status === "handled"
        ? "队名违规（已处置）"
        : status === "population_skipped"
          ? "队名违规（人数未达处置门槛）"
          : status === "queued"
            ? "队名违规（等待规则链）"
            : status === "error"
              ? "队名违规（处置失败）"
              : "队名违规",
      decisionTone: status === "handled" ? "danger" : (status === "error" ? "danger" : "warning"),
      reason: item.error ?? item.reason ?? "",
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      actions: Array.isArray(item.actions) ? item.actions.map((action) => action.type).filter(Boolean) : [],
      canWhitelist: true,
    });
  }

  for (const item of Array.isArray(stepwise?.recentRecords) ? stepwise.recentRecords : []) {
    if (item?.violation !== true) continue;
    const key = buildTrackingKey({
      serverId: item.serverId ?? "",
      matchId: item.matchId ?? "",
      teamId: item.teamId ?? null,
      squadId: item.squadId ?? null,
      squadName: item.squadName ?? "",
    });
    if (!grouped.has(key)) grouped.set(key, { squadName: [], stepwise: [], fair: [] });
    grouped.get(key).stepwise.push({
      id: item.id,
      serverId: item.serverId ?? "",
      matchId: item.matchId ?? "",
      teamId: item.teamId ?? null,
      squadId: item.squadId ?? null,
      squadName: item.squadName ?? "",
      creatorName: item.creatorName ?? item.leaderName ?? "",
      creatorSteamId: item.creatorSteamId ?? item.leaderSteamId ?? item.steamId ?? item.steamID ?? "",
      squadNature: item.squadNature ?? item.squadType ?? "",
      squadNatureLabel: item.squadNatureLabel ?? "",
      source: "tiered_squad_time",
      stage: "stepwise",
      status: "violation",
      decisionLabel: "阶梯式时长拒绝",
      decisionTone: "danger",
      reason: item.decisionReason ?? item.reason ?? "",
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      actions: Array.isArray(item.actions) ? item.actions.map((action) => action.type).filter(Boolean) : [],
      canWhitelist: false,
    });
  }

  for (const item of Array.isArray(fair?.recentRecords) ? fair.recentRecords : []) {
    const violation = item?.violation === true;
    const approved = item?.approved === true && !violation;
    if (!violation && !approved) continue;

    const key = buildTrackingKey({
      serverId: item.serverId ?? "",
      matchId: item.matchId ?? "",
      teamId: item.teamId ?? null,
      squadId: item.squadId ?? null,
      squadName: item.squadName ?? "",
    });
    if (!grouped.has(key)) grouped.set(key, { squadName: [], stepwise: [], fair: [] });
    grouped.get(key).fair.push({
      id: item.id,
      serverId: item.serverId ?? "",
      matchId: item.matchId ?? "",
      teamId: item.teamId ?? null,
      squadId: item.squadId ?? null,
      squadName: item.squadName ?? "",
      creatorName: item.creatorName ?? "",
      creatorSteamId: item.creatorSteamId ?? item.steamId ?? item.steamID ?? "",
      source: violation ? "fair_squad_creation" : "final_allowed",
      stage: violation ? "fair" : "final",
      status: violation ? "violation" : "allowed",
      decisionLabel: violation ? "公平建队拒绝" : "最终通过",
      decisionTone: violation ? "danger" : "ok",
      reason: Array.isArray(item.reasons) ? item.reasons.join(" ") : item.reason ?? "",
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      actions: Array.isArray(item.actions) ? item.actions.map((action) => action.type).filter(Boolean) : [],
      canWhitelist: false,
    });
  }

  return Array.from(grouped.values())
    .map((bucket) => selectTrackingRecord(bucket))
    .filter(Boolean)
    .sort((left, right) => {
      const rightMs = Date.parse(right.updatedAt ?? right.createdAt ?? "") || 0;
      const leftMs = Date.parse(left.updatedAt ?? left.createdAt ?? "") || 0;
      return rightMs - leftMs;
    })
    .slice(0, 300);
}

function selectTrackingRecord(bucket) {
  if (!bucket) return null;
  const latestSquadName = pickLatestRecord(bucket.squadName);
  if (latestSquadName) return latestSquadName;

  const latestStepwise = pickLatestRecord(bucket.stepwise);
  if (latestStepwise) return latestStepwise;

  return pickLatestRecord(bucket.fair);
}

function pickLatestRecord(records) {
  if (!Array.isArray(records) || records.length === 0) return null;
  let latest = records[0];
  let latestMs = Date.parse(latest.updatedAt ?? latest.createdAt ?? "") || 0;
  for (const record of records.slice(1)) {
    const currentMs = Date.parse(record.updatedAt ?? record.createdAt ?? "") || 0;
    if (currentMs > latestMs) {
      latest = record;
      latestMs = currentMs;
    }
  }
  return latest;
}
