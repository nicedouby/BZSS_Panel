// -*- coding: utf-8 -*-

import http from "node:http";
import { createReadStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";

const requestStorage = new AsyncLocalStorage();
import { handleSquadManagementRoutes } from "../modules/squad-management/routes.js";
import { handleTeamBalanceRoutes } from "../modules/team-balance/routes.js";
import { handleReserveSlotsRoutes } from "../modules/reserve-slots/routes.js";
import { handleWarmupReserveGrantRoutes } from "../modules/warmup-reserve-grant/routes.js";
import { handleBlackEdgePrivilegeRoutes } from "../modules/black-edge-privilege/routes.js";
import { handleAstrbotBridgeRoutes } from "../modules/astrbot-bridge/routes.js";
import { handleTacticalStateRoutes } from "../modules/tactical-state/routes.js";
import { handleTacticalStateV2Routes } from "../modules/tactical-state-v2/routes.js";
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
    this.server = null;
    this.jobs = new Map();
    this.jobCounter = 0;
    this.consoleConnections = new Set();
    this.chatConnections = new Set();
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
            combatCleanCount: this.modules.combatClean?.api?.getOverview?.()?.count ?? 0,
            combatCleanRejected: this.modules.combatClean?.api?.getOverview?.()?.rejected ?? 0,
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
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.getState?.() ?? null,
        });
      }

      if (url.pathname === "/api/plugins/team-kill-apology/enabled" && req.method === "PATCH") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        if (typeof body?.enabled !== "boolean") {
          return this.json(res, 400, { error: "InvalidBody", message: "enabled must be boolean" });
        }
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.setEnabled?.(body.enabled) ?? pluginApi.getState?.() ?? null,
        });
      }

      if (url.pathname === "/api/plugins/team-kill-apology/config" && req.method === "PATCH") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return this.json(res, 400, { error: "InvalidBody", message: "body must be object" });
        }
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.updateConfig?.(body) ?? pluginApi.getState?.() ?? null,
        });
      }

      if (url.pathname === "/api/plugins/team-kill-apology/reset" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.resetMatch?.("manual_web_reset") ?? pluginApi.getState?.() ?? null,
        });
      }

      return this.json(res, 405, {
        error: "MethodNotAllowed",
        message: "Unsupported TK apology API route.",
      });
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
      await Promise.all(steamIDs.map(async (steamID) => {
        try {
          const row = await this.modules.playtime.getBySteamID(steamID);
          if (row) items[steamID] = normalizePlaytimeRow(row);
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

    if (url.pathname === "/api/query/combat-clean" && req.method === "GET") {
      const serverId = url.searchParams.get("serverId") ?? "";
      return this.json(res, 200, {
        events: this.modules.combatClean?.getEvents?.({
          serverId,
          limit: url.searchParams.get("limit") ?? "100",
          offset: url.searchParams.get("offset") ?? "0",
          type: url.searchParams.get("type") ?? "all",
          search: url.searchParams.get("q") ?? "",
        }) ?? [],
        overview: this.modules.combatClean?.getOverview?.(serverId) ?? null,
      });
    }

    if (url.pathname === "/api/query/combat-manager" && req.method === "GET") {
      const serverId = url.searchParams.get("serverId") ?? "";
      const combatManager = this.modules.combatManager;
      if (!combatManager) {
        return this.json(res, 404, {
          error: "CombatManagerUnavailable",
          message: "Combat manager module is not loaded.",
        });
      }
      return this.json(res, 200, {
        events: cleanCombatEventsForClient(combatManager.getEvents?.({
          serverId,
          limit: url.searchParams.get("limit") ?? "100",
          offset: url.searchParams.get("offset") ?? "0",
          type: url.searchParams.get("type") ?? "all",
          search: url.searchParams.get("q") ?? "",
        }) ?? []),
        overview: cleanCombatOverviewForClient(combatManager.getOverview?.(serverId) ?? null),
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

    if (url.pathname === "/api/combat-manager/overview") {
      const combatManager = this.modules.combatManager;
      if (!combatManager) {
        return this.json(res, 404, {
          error: "CombatManagerUnavailable",
          message: "Combat manager module is not loaded.",
        });
      }
      return this.json(res, 200, cleanCombatOverviewForClient(combatManager.getOverview(url.searchParams.get("serverId") ?? "")));
    }

    if (url.pathname === "/api/combat-manager/events") {
      const combatManager = this.modules.combatManager;
      if (!combatManager) {
        return this.json(res, 404, {
          error: "CombatManagerUnavailable",
          message: "Combat manager module is not loaded.",
        });
      }
      return this.json(res, 200, {
        events: cleanCombatEventsForClient(combatManager.getEvents({
          type: url.searchParams.get("type") ?? "all",
          search: url.searchParams.get("search") ?? url.searchParams.get("q") ?? "",
          limit: url.searchParams.get("limit") ?? "300",
          offset: url.searchParams.get("offset") ?? "0",
          serverId: url.searchParams.get("serverId") ?? "",
          mode: url.searchParams.get("mode") ?? "",
          playerKey: url.searchParams.get("playerKey") ?? "",
        })),
        overview: cleanCombatOverviewForClient(combatManager.getOverview(url.searchParams.get("serverId") ?? "")),
      });
    }

    if (url.pathname === "/api/combat-manager/rates") {
      const combatManager = this.modules.combatManager;
      if (!combatManager) {
        return this.json(res, 404, {
          error: "CombatManagerUnavailable",
          message: "Combat manager module is not loaded.",
        });
      }
      return this.json(res, 200, {
        rates: combatManager.getRateHistory(url.searchParams.get("serverId") ?? "", Number(url.searchParams.get("window") ?? 30)),
      });
    }

    if (url.pathname === "/api/combat-manager/player-events" && req.method === "GET") {
      const combatManager = this.modules.combatManager;
      if (!combatManager) {
        return this.json(res, 404, {
          error: "CombatManagerUnavailable",
          message: "Combat manager module is not loaded.",
        });
      }
      return this.json(res, 200, {
        events: cleanCombatEventsForClient(combatManager.getPlayerEvents?.(url.searchParams.get("serverId") ?? "", {
          steam64ID: url.searchParams.get("steam64ID") ?? url.searchParams.get("steamID") ?? "",
          eosID: url.searchParams.get("eosID") ?? "",
          controllerID: url.searchParams.get("controllerID") ?? "",
          name: url.searchParams.get("name") ?? "",
          playerKey: url.searchParams.get("playerKey") ?? "",
        }, {
          limit: url.searchParams.get("limit") ?? "20",
          offset: url.searchParams.get("offset") ?? "0",
        }) ?? []),
        overview: cleanCombatOverviewForClient(combatManager.getOverview?.(url.searchParams.get("serverId") ?? "") ?? null),
      });
    }

    if (url.pathname === "/api/combat-manager/cache" && req.method === "GET") {
      const combatManager = this.modules.combatManager;
      if (!combatManager) {
        return this.json(res, 404, {
          error: "CombatManagerUnavailable",
          message: "Combat manager module is not loaded.",
        });
      }
      const serverId = url.searchParams.get("serverId") ?? "";
      const snapshot = await combatManager.ensureCacheSnapshot?.(serverId)
        ?? await combatManager.readCacheSnapshot?.(serverId);
      if (!snapshot) {
        return this.json(res, 404, {
          error: "CombatManagerCacheNotFound",
          message: "Combat manager cache file is not available yet.",
        });
      }
      return this.json(res, 200, { snapshot });
    }

    if (url.pathname === "/api/combat-manager/clear" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const combatManager = this.modules.combatManager;
      if (!combatManager) {
        return this.json(res, 404, {
          error: "CombatManagerUnavailable",
          message: "Combat manager module is not loaded.",
        });
      }
      const body = await this.readJsonBody(req);
      return this.json(res, 200, combatManager.clear(body.serverId ?? url.searchParams.get("serverId") ?? ""));
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

    if (url.pathname.startsWith("/api/combat-clean")) {
      const combatClean = this.modules.combatClean;
      if (!combatClean) {
        return this.json(res, 404, {
          error: "CombatCleanUnavailable",
          message: "Combat clean module is not loaded.",
        });
      }
      const serverId = url.searchParams.get("serverId") ?? "";

      if (url.pathname === "/api/combat-clean/events" && req.method === "GET") {
        return this.json(res, 200, {
          events: combatClean.getEvents({
            serverId,
            type: url.searchParams.get("type") ?? "all",
            search: url.searchParams.get("search") ?? "",
            limit: url.searchParams.get("limit") ?? "300",
            offset: url.searchParams.get("offset") ?? "0",
            playerKey: url.searchParams.get("playerKey") ?? "",
          }),
          overview: combatClean.getOverview(serverId),
        });
      }

      if (url.pathname === "/api/combat-clean/overview" && req.method === "GET") {
        return this.json(res, 200, combatClean.getOverview(serverId));
      }

      if (url.pathname === "/api/combat-clean/rates" && req.method === "GET") {
        const windowMinutes = Number(url.searchParams.get("window") ?? 30);
        return this.json(res, 200, {
          rates: combatClean.getRateHistory(serverId, windowMinutes),
        });
      }

      const cleanEventMatch = url.pathname.match(/^\/api\/combat-clean\/events\/(.+)$/);
      if (cleanEventMatch && req.method === "GET") {
        const record = combatClean.getEventById(decodeURIComponent(cleanEventMatch[1]));
        if (!record) return this.json(res, 404, { error: "CombatCleanEventNotFound" });
        return this.json(res, 200, { event: record });
      }

      if (url.pathname === "/api/combat-clean/player-events" && req.method === "GET") {
        return this.json(res, 200, {
          events: combatClean.getPlayerEvents(serverId, {
            steam64ID: url.searchParams.get("steam64ID") ?? url.searchParams.get("steamID") ?? "",
            eosID: url.searchParams.get("eosID") ?? "",
            controllerID: url.searchParams.get("controllerID") ?? "",
            name: url.searchParams.get("name") ?? "",
            playerKey: url.searchParams.get("playerKey") ?? "",
          }, {
            limit: url.searchParams.get("limit") ?? "20",
            offset: url.searchParams.get("offset") ?? "0",
          }),
          overview: combatClean.getOverview(serverId),
        });
      }

    if (url.pathname === "/api/combat-clean/clear" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const body = await this.readJsonBody(req);
      return this.json(res, 200, combatClean.clear(body.serverId ?? serverId));
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
            serverId: battleServerId/~9çKh‘éì¶»§q«^tÙ\™\’YHˆŠHÂˆÛÛœİİ]\ÈH\Ë˜ÛÜ™KÙX”İ]\ÏË™Ù]Û˜\ÚİËŠ
HÏÈßNÂˆ™]\›ˆİ]\ËœÙ\™\“˜[YHÏÈİ]\ËœÙ\™\Ë›˜[YHÏÈİš[™ÊÙ\™\’YÏÈˆŠNÂˆB‚ˆØ[•šY]Ğ]Y]
\Ù\ŠHÂˆ™]\›ˆ›ÛÛX[Šˆ\Ë˜ÛÜ™K˜]]X[˜YÙ\Ëš\Ñ]™\][™ÏËŠ\Ù\ŠBˆ\Ë˜ÛÜ™K˜]]X[˜YÙ\Ëš\Ô\›Z\ÜÚ[ÛËŠ\Ù\‹˜]Y]šY]ÈŠKˆ
NÂˆB‚ˆØ[“X[˜YÙTYÚ[œÊ\Ù\ŠHÂˆYˆ
\Ë˜ÛÜ™K˜]]X[˜YÙ\Ëš\Ñ]™\][™ÏËŠ\Ù\ŠJH™]\›ˆYNÂˆÛÛœİ\›Z\ÜÚ[ÛœÈH\Ù\Ëœ\›Z\ÜÚ[ÛœÈÏÈ\Ù\Ëœ\›Z\ÜÚ[ÛˆÏÈ×NÂˆYˆ
\œ˜^Kš\Ğ\œ˜^J\›Z\ÜÚ[ÛœÊJH™]\›ˆ\›Z\ÜÚ[ÛœËš[˜ÛY\ÊœYÚ[œË›X[˜YÙHŠNÂˆYˆ
\›Z\ÜÚ[ÛœÈ	‰ˆ\[Ùˆ\›Z\ÜÚ[ÛœÈOOH›Øš™XİŠH™]\›ˆ›ÛÛX[Š\›Z\ÜÚ[ÛœÖÈœYÚ[œË›X[˜YÙH—JNÂˆ™]\›ˆ˜[ÙNÂˆB‚ˆØ[“X[˜YÙTÙ][™ÜÕÛÛÊ\Ù\ŠHÂˆ™]\›ˆ›ÛÛX[Šˆ\Ë˜ÛÜ™K˜]]X[˜YÙ\Ëš\Ñ]™\][™ÏËŠ\Ù\ŠBˆ\Ë˜ÛÜ™K˜]]X[˜YÙ\Ëš\Ô\›Z\ÜÚ[ÛËŠ\Ù\‹œÙ][™ÜË›X[˜YÙHŠKˆ
NÂˆB‚ˆØ[•\ÙPœÜĞÛÜ™UÛÛ
\Ù\ŠHÂˆ™]\›ˆ›ÛÛX[Šˆ\Ë˜ÛÜ™K˜]]X[˜YÙ\Ëš\Ñ]™\][™ÏËŠ\Ù\ŠBˆ\Ë˜ÛÜ™K˜]]X[˜YÙ\Ëš\Ô\›Z\ÜÚ[ÛËŠ\Ù\‹˜œÜ×ØÛÜ™K\ÙHŠKˆ
NÂˆB‚ˆ\Ş[˜È[™PYZ[•\Ù\œĞ\J\›™\K™\Ë\Ù\ŠHÂˆYˆ
ˆ\›œ]˜[YHOOH‹Ø\KØYZ[‹İ\Ù\œÈ‚ˆ	‰ˆ]\›œ]˜[YKœİ\ÕÚ]
‹Ø\KØYZ[‹İ\Ù\œËÈŠBˆ	‰ˆ\›œ]˜[YHOOH‹Ø\KØYZ[‹Ü\›Z\ÜÚ[Û‹YÜ›İ\È‚ˆ	‰ˆ]\›œ]˜[YKœİ\ÕÚ]
‹Ø\KØYZ[‹Ü\›Z\ÜÚ[Û‹YÜ›İ\ËÈŠBˆ
HÂˆ™]\›ˆ˜[ÙNÂˆB‚ˆYˆ
]\Ëœ™\]Z\™Tİ\\YZ[Š\Ù\‹™\ÊJH™]\›ˆYNÂ‚ˆÛÛœİİÜ™HH\Ë˜ÛÜ™K˜]]X[˜YÙ\Ë\Ù\”İÜ™NÂˆYˆ
\İÜ™JHÂˆ\ËšœÛÛŠ™\ËLËÂˆ\œ›Üˆ]]\Ù\”İÜ™U[˜]˜Z[X›H‹ˆY\ÜØYÙNˆ]]\Ù\ˆİÜ™H\È[˜]˜Z[X›Kˆ‹ˆJNÂˆ™]\›ˆYNÂˆB‚ˆHÂˆYˆ
\›œ]˜[YHOOH‹Ø\KØYZ[‹Ü\›Z\ÜÚ[Û‹YÜ›İ\Èˆ	‰ˆ™\K›Y]ÙOOH‘ÑUŠHÂˆÛÛœİ][\ÈH\ËœÙ\šX[^™T\›Z\ÜÚ[Û‘Ü›İ\ÊİÜ™K›\İ\›Z\ÜÚ[Û‘Ü›İ\Ê
KİÜ™K›\İ\Ù\œÊ
JNÂˆ™]\›ˆ\ËšœÛÛŠ™\ËŒÂˆÚÎˆYKˆ][\ËˆJNÂˆB‚ˆYˆ
\›œ]˜[YHOOH‹Ø\KØYZ[‹Ü\›Z\ÜÚ[Û‹YÜ›İ\Èˆ	‰ˆ™\K›Y]ÙOOH”ÔÕŠHÂˆÛÛœİ›ÙHH]ØZ]\Ëœ™XYœÛÛ›ÙJ™\JNÂˆÛÛœİÜ™X]YH]ØZ]İÜ™K˜Ü™X]T\›Z\ÜÚ[Û‘Ü›İ\
Âˆ˜[YNˆ›ÙOË›˜[YKˆ[˜X›Yˆ›ÙOË™[˜X›YÏÈYKˆ\›Z\ÜÚ[ÛœÎˆ›ÙOËœ\›Z\ÜÚ[ÛœÈÏÈ×KˆJNÂˆ™]\›ˆ\ËšœÛÛŠ™\ËŒKÂˆÚÎˆYKˆÜ›İ\ˆ\ËœÙ\šX[^™T\›Z\ÜÚ[Û‘Ü›İ\
Ü™X]YİÜ™K›\İ\Ù\œÊ
JKˆJNÂˆB‚ˆÛÛœİ\›Z\ÜÚ[Û‘Ü›İ\X]ÚH\›œ]˜[YK›X]Ú
×—Ø\WØYZ[—Ü\›Z\ÜÚ[Û‹YÜ›İ\×Ê×‹×JÊIÊNÂˆYˆ
\›Z\ÜÚ[Û‘Ü›İ\X]Ú
HÂˆÛÛœİÜ›İ\YHXÛÙUT’PÛÛ\Û™[
\›Z\ÜÚ[Û‘Ü›İ\X]ÚÌWJNÂ‚ˆYˆ
™\K›Y]ÙOOH”UÒŠHÂˆÛÛœİ›ÙHH]ØZ]\Ëœ™XYœÛÛ›ÙJ™\JNÂˆÛÛœİ\]YH]ØZ]İÜ™K\]T\›Z\ÜÚ[Û‘Ü›İ\
Ü›İ\YÂˆ˜[YNˆ›ÙOË›˜[YKˆ[˜X›Yˆ›ÙOË™[˜X›Yˆ\›Z\ÜÚ[ÛœÎˆ›ÙOËœ\›Z\ÜÚ[ÛœËˆJNÂˆ™]\›ˆ\ËšœÛÛŠ™\ËŒÂˆÚÎˆYKˆÜ›İ\ˆ\ËœÙ\šX[^™T\›Z\ÜÚ[Û‘Ü›İ\
\]YİÜ™K›\İ\Ù\œÊ
JKˆJNÂˆB‚ˆYˆ
™\K›Y]ÙOOH‘SUHŠHÂˆÛÛœİ[]YH]ØZ]İÜ™K™[]T\›Z\ÜÚ[Û‘Ü›İ\
Ü›İ\Y
NÂˆ™]\›ˆ\ËšœÛÛŠ™\ËŒÂˆÚÎˆYKˆÜ›İ\ˆ\ËœÙ\šX[^™T\›Z\ÜÚ[Û‘Ü›İ\
[]YİÜ™K›\İ\Ù\œÊ
JKˆJNÂˆBˆB‚ˆYˆ
\›œ]˜[YHOOH‹Ø\KØYZ[‹İ\Ù\œÈˆ	‰ˆ™\K›Y]ÙOOH‘ÑUŠHÂˆÛÛœİ]˜]\“X\H]ØZ]\Ë™Ù]YZ[”İX[P]˜]\“X\
İÜ™K›\İ\Ù\œÊ
JNÂˆÛÛœİÜ›İ\ÈHİÜ™K›\İ\›Z\ÜÚ[Û‘Ü›İ\Ê
NÂˆÛÛœİ][\ÈHİÜ™K›\İ\Ù\œÊ
K›X\

][JHOˆ\ËœÙ\šX[^™PYZ[•\Ù\Š][K]˜]\“X\Ü›İ\ÊJNÂˆ™]\›ˆ\ËšœÛÛŠ™\ËŒÂˆÚÎˆYKˆ][\Ëˆİ]Îˆ\Ë˜Z[YZ[•\Ù\”İ]Ê][\ÊKˆ\›Z\ÜÚ[Û‘Ü›İ\Îˆ\ËœÙ\šX[^™T\›Z\ÜÚ[Û‘Ü›İ\ÊÜ›İ\ËİÜ™K›\İ\Ù\œÊ
JKˆJNÂˆB‚ˆYˆ
\›œ]˜[YHOOH‹Ø\KØYZ[‹İ\Ù\œÈˆ	‰ˆ™\K›Y]ÙOOH”ÔÕŠHÂˆÛÛœİ›ÙHH]ØZ]\Ëœ™XYœÛÛ›ÙJ™\JNÂˆÛÛœİ\Ù\›˜[YHHİš[™Ê›ÙOË\Ù\›˜[YHÏÈˆŠKš[J
NÂˆÛÛœİ\ÜİÛÜ™Hİš[™Ê›ÙOËœ\ÜİÛÜ™ÏÈˆŠNÂˆYˆ
]\Ù\›˜[YJHÂˆ™]\›ˆ\ËšœÛÛŠ™\ËÈ\œ›Üˆ’[˜[Y\Ù\›˜[YH‹Y\ÜØYÙNˆ•\Ù\›˜[YH\È™\]Z\™YˆˆJNÂˆBˆYˆ
\ÜİÛÜ™›[™İ
HÂˆ™]\›ˆ\ËšœÛÛŠ™\ËÈ\œ›Üˆ’[˜[Y\ÜİÛÜ™‹Y\ÜØYÙNˆ”\ÜİÛÜ™]\İ™H]X\İÚ\˜Xİ\œËˆˆJNÂˆB‚ˆÛÛœİİX[MH›Ü›X[^™PYZ[”İX[M›Ü”™\]Y\İ
›ÙOËœİX[M
NÂˆYˆ
İX[M
HİÜ™K˜\ÜÙ\İX[M]˜Z[X›JİX[M
NÂ‚ˆÛÛœİ\ÜİÛÜ™\ÚH]ØZ]\Ë˜ÛÜ™K˜]]X[˜YÙ\‹š\Ú\ÜİÛÜ™
\ÜİÛÜ™
NÂˆÛÛœİÜ™X]YH]ØZ]İÜ™K˜Ü™X]U\Ù\ŠÂˆ\Ù\›˜[YKˆ\ÜİÛÜ™\Úˆ›ÛNˆ›ÙOËœ›ÛHÏÈYZ[ˆ‹ˆ\Ü^S˜[YNˆ›ÙOË™\Ü^S˜[YHÏÈˆ‹ˆİX[MˆšY]Ù\•X[P]]ÔİØ\[˜X›Yˆ›ÙOËšY]Ù\•X[P]]ÔİØ\[˜X›Yˆ[˜X›Yˆ›ÙOË™[˜X›YÏÈYKˆ›İNˆ›ÙOË››İHÏÈˆ‹ˆ\›Z\ÜÚ[Û‘Ü›İ\Yˆ\Ë››Ü›X[^™T\›Z\ÜÚ[Û‘Ü›İ\Y›Ü”™\]Y\İ
İÜ™K›ÙOËœ\›Z\ÜÚ[Û‘Ü›İ\Y
KˆJNÂˆ™]\›ˆ\ËšœÛÛŠ™\ËŒKÂˆÚÎˆYKˆ\Ù\ˆ\ËœÙ\šX[^™PYZ[•\Ù\ŠÜ™X]Y]ØZ]\Ë™Ù]YZ[”İX[P]˜]\“X\
ØÜ™X]YJKİÜ™K›\İ\›Z\ÜÚ[Û‘Ü›İ\Ê
JKˆJNÂˆB‚ˆÛÛœİ™\Ù]X]ÚH\›œ]˜[YK›X]Ú
×—Ø\WØYZ[—İ\Ù\œ×Ê×‹×JÊWÜ™\Ù]\\ÜİÛÜ™	ÊNÂˆYˆ
™\Ù]X]Ú	‰ˆ™\K›Y]ÙOOH”ÔÕŠHÂˆÛÛœİ\Ù\’YHXÛÙUT’PÛÛ\Û™[
™\Ù]X]ÚÌWJNÂˆÛÛœİ›ÙHH]ØZ]\Ëœ™XYœÛÛ›ÙJ™\JNÂˆÛÛœİ\ÜİÛÜ™Hİš[™Ê›ÙOËœ\ÜİÛÜ™ÏÈˆŠNÂˆYˆ
\ÜİÛÜ™›[™İ
HÂˆ™]\›ˆ\ËšœÛÛŠ™\ËÈ\œ›Üˆ’[˜[Y\ÜİÛÜ™‹Y\ÜØYÙNˆ”\ÜİÛÜ™]\İ™H]X\İÚ\˜Xİ\œËˆˆJNÂˆB‚ˆÛÛœİ\ÜİÛÜ™\ÚH]ØZ]\Ë˜ÛÜ™K˜]]X[˜YÙ\‹š\Ú\ÜİÛÜ™
\ÜİÛÜ™
NÂˆÛÛœİ\]YH]ØZ]İÜ™K\]T\ÜİÛÜ™
\Ù\’Y\ÜİÛÜ™\Ú
NÂˆ™]\›ˆ\ËšœÛÛŠ™\ËŒÂˆÚÎˆYKˆ\Ù\ˆ\ËœÙ\šX[^™PYZ[•\Ù\Š\]Y]ØZ]\Ë™Ù]YZ[”İX[P]˜]\“X\
İ\]YJKİÜ™K›\İ\›Z\ÜÚ[Û‘Ü›İ\Ê
JKˆJNÂˆB‚ˆÛÛœİ\Ù\“X]ÚH\›œ]˜[YK›X]Ú
×—Ø\WØYZ[—İ\Ù\œ×Ê×‹×JÊIÊNÂˆYˆ
]\Ù\“X]Ú
HÂˆ™]\›ˆ\ËšœÛÛŠ™\ËÂˆ\œ›Üˆ\S›İ›İ[™‹ˆY\ÜØYÙNˆYZ[ˆ\Ù\ˆTH›İ]H›İ›İ[™ˆ‹ˆJNÂˆB‚ˆÛÛœİ\Ù\’YHXÛÙUT’PÛÛ\Û™[
\Ù\“X]ÚÌWJNÂ‚ˆYˆ
™\K›Y]ÙOOH”UÒŠHÂˆÛÛœİ\™Ù]HİÜ™Kœ™\]Z\™Q^\İ[™Õ\Ù\Š\Ù\’Y
NÂˆÛÛœİ›ÙHH]ØZ]\Ëœ™XYœÛÛ›ÙJ™\JNÂˆÛÛœİ™^[˜X›YH›ÙOË™[˜X›YOOH[™Yš[™YÈ\™Ù]™[˜X›Yˆ›ÛÛX[Š›ÙK™[˜X›Y
NÂˆÛÛœİ™^›ÛHH›ÙOËœ›ÛHOOH[™Yš[™YÈ\™Ù]œ›ÛHˆ›ÙKœ›ÛNÂˆYˆ
\™Ù]šYOOH\Ù\‹šY	‰ˆ\™Ù]™[˜X›Y	‰ˆ[™^[˜X›Y
HÂˆ™]\›ˆ\ËšœÛÛŠ™\ËÂˆ\œ›ÜˆØ[››İ\ØX›TÙ[ˆ‹ˆY\ÜØYÙNˆØ[››İ\ØX›HHİ\œ™[XØÛİ[ˆ‹ˆJNÂˆB‚ˆÛÛœİİX[MH›ÙOËœİX[MOOH[™Yš[™YÈ[™Yš[™Yˆ›Ü›X[^™PYZ[”İX[M›Ü”™\]Y\İ
›ÙKœİX[M
NÂˆÛÛœİ\]YH]ØZ]İÜ™K\]U\Ù\Š\Ù\’YÂˆ\Ü^S˜[YNˆ›ÙOË™\Ü^S˜[YKˆ›ÛNˆ™^›ÛKˆİX[MˆšY]Ù\•X[P]]ÔİØ\[˜X›Yˆ›ÙOËšY]Ù\•X[P]]ÔİØ\[˜X›Yˆ[˜X›Yˆ™^[˜X›Yˆ›İNˆ›ÙOË››İKˆ\›Z\ÜÚ[Û‘Ü›İ\Yˆ›ÙOËœ\›Z\ÜÚ[Û‘Ü›İ\YOOH[™Yš[™YˆÈ[™Yš[™Yˆˆ\Ë››Ü›X[^™T\›Z\ÜÚ[Û‘Ü›İ\Y›Ü”™\]Y\İ
İÜ™K›ÙOËœ\›Z\ÜÚ[Û‘Ü›İ\Y
KˆJNÂˆ™]\›ˆ\ËšœÛÛŠ™\ËŒÂˆÚÎˆYKˆ\Ù\ˆ\ËœÙ\šX[^™PYZ[•\Ù\Š\]Y]ØZ]\Ë™Ù]YZ[”İX[P]˜]\“X\
İ\]YJKİÜ™K›\İ\›Z\ÜÚ[Û‘Ü›İ\Ê
JKˆJNÂˆB‚ˆYˆ
™\K›Y]ÙOOH‘SUHŠHÂˆÛÛœİ\™Ù]HİÜ™Kœ™\]Z\™Q^\İ[™Õ\Ù\Š\Ù\’Y
NÂˆYˆ
\™Ù]šYOOH\Ù\‹šY
HÂˆ™]\›ˆ\ËšœÛÛŠ™\ËÂˆ\œ›ÜˆØ[››İ[]TÙ[ˆ‹ˆY\ÜØYÙNˆØ[››İ[]HHİ\œ™[XØÛİ[ˆ‹ˆJNÂˆB‚ˆÛÛœİ[]YH]ØZ]İÜ™K™[]U\Ù\Š\Ù\’Y
NÂˆ™]\›ˆ\ËšœÛÛŠ™\ËŒÂˆÚÎˆYKˆ\Ù\ˆ\ËœÙ\šX[^™PYZ[•\Ù\Š[]Y™]ÈX\

KİÜ™K›\İ\›Z\ÜÚ[Û‘Ü›İ\Ê
JKˆJNÂˆB‚ˆ™]\›ˆ\ËšœÛÛŠ™\ËKÂˆ\œ›Üˆ“Y]Ù›İ[İÙY‹ˆY\ÜØYÙNˆ•[œİ\ÜYYZ[ˆ\Ù\ˆTHY]Ùˆ‹ˆJNÂˆHØ]Ú
\œ›ÜŠHÂˆ™]\›ˆ\ËšœÛÛŠ™\Ë[X™\Š\œ›ÜËœİ]\ĞÛÙHÏÈL
KÂˆ\œ›Üˆİš[™Ê\œ›ÜË˜ÛÙHÏÈYZ[•\Ù\\Q\œ›ÜˆŠKˆY\ÜØYÙNˆİš[™Ê\œ›ÜË›Y\ÜØYÙHÏÈYZ[ˆ\Ù\ˆTH™\]Y\İ˜Z[YˆŠKˆJNÂˆBˆB‚ˆ\Ş[˜ÈÙ]YZ[”İX[P]˜]\“X\
\Ù\œÈH×JHÂˆÛÛœİİX[RQÈHË‹‹›™]ÈÙ]
ˆ
\œ˜^Kš\Ğ\œ˜^J\Ù\œÊHÈ\Ù\œÈˆ×JBˆ›X\

][JHOˆİš[™Ê][OËœİX[MÏÈˆŠKš[J
JBˆ™š[\Š
][JHOˆ×—ÌMßIË\İ
][JJKˆ
WNÂˆYˆ
\İX[RQË›[™İ
H™]\›ˆ™]ÈX\

NÂ‚ˆÛÛœİ\İ^Y\œĞTİX[RQÈH\Ë›[Ù[\Ëœ^Y\‘]X˜\ÙOË›\İ^Y\œĞTİX[RQÎÂˆYˆ
\[Ùˆ\İ^Y\œĞTİX[RQÈOOH™[˜İ[ÛˆŠH™]\›ˆ™]ÈX\

NÂ‚ˆHÂˆÛÛœİ›İÜÈH]ØZ]\İ^Y\œĞTİX[RQË˜Ø[
\Ë›[Ù[\Ëœ^Y\‘]X˜\ÙKİX[RQÊNÂˆÛÛœİX\H™]ÈX\

NÂˆ›Üˆ
ÛÛœİ›İÈÙˆ\œ˜^Kš\Ğ\œ˜^J›İÜÊHÈ›İÜÈˆ×JHÂˆÛÛœİİX[RQHİš[™Ê›İÏËœİX[WÚYÏÈ›İÏËœİX[RQÏÈ›İÏËœİX[MÏÈˆŠKš[J
NÂˆÛÛœİ]˜]\ˆHİš[™Ê›İÏËœİX[WØ]˜]\ˆÏÈ›İÏËœİX[P]˜]\ˆÏÈˆŠKš[J
NÂˆYˆ
İX[RQ	‰ˆ]˜]\ŠHX\œÙ]
İX[RQ]˜]\ŠNÂˆBˆ™]\›ˆX\ÂˆHØ]Ú
\œ›ÜŠHÂˆ\Ë›ÙÙÙ\ËØ\›ËŠ˜Z[YÈ™\ÛÛ™HYZ[ˆİX[H]˜]\œÎˆ	Ù\œ›Ü‹›Y\ÜØYÙ_X
NÂˆ™]\›ˆ™]ÈX\

NÂˆBˆB‚ˆÙ\šX[^™P]]Ù\ÜÚ[Û•\Ù\Š\Ù\ŠHÂˆYˆ
]\Ù\ŠH™]\›ˆ[Âˆ™]\›ˆÂˆYˆ\Ù\‹šYˆ\Ù\›˜[YNˆ\Ù\‹\Ù\›˜[YKˆ›ÛNˆ\Ù\‹œ›ÛKˆ\Ôİ\\YZ[ˆ\Ù\‹œ›ÛHOOH”İ\\YZ[ˆ‹ˆİX[Mˆ\Ù\‹œİX[MÏÈ[ˆšY]Ù\•X[P]]ÔİØ\[˜X›Yˆ\Ù\‹šY]Ù\•X[P]]ÔİØ\[˜X›YOOH˜[ÙKˆ\›Z\ÜÚ[ÛœÎˆ\œ˜^Kš\Ğ\œ˜^J\Ù\‹œ\›Z\ÜÚ[ÛœÊHÈË‹‹\Ù\‹œ\›Z\ÜÚ[Ûœ×Hˆ×KˆNÂˆBˆ\Ş[˜È[œšXÚ]]\Ù\•Ú]İX[P]˜]\Š\Ù\ŠHÂˆYˆ
]\Ù\ŠH™]\›ˆ[ÂˆÛÛœİİX[MHİš[™Ê\Ù\ËœİX[MÏÈˆŠKš[J
NÂˆYˆ
K×—ÌMßIË\İ
İX[M
JHÂˆ™]\›ˆÂˆ‹‹\Ù\‹ˆİX[P]˜]\ˆ[ˆNÂˆB‚ˆÛÛœİİX[P]˜]\ˆH]ØZ]\Ë™Ù]İX[P]˜]\TİX[M
İX[M
NÂˆ™]\›ˆÂˆ‹‹\Ù\‹ˆİX[P]˜]\‹ˆNÂˆB‚ˆ\Ş[˜ÈÙ]İX[P]˜]\TİX[M
İX[M
HÂˆÛÛœİ\İ^Y\œĞTİX[RQÈH\Ë›[Ù[\Ëœ^Y\‘]X˜\ÙOË›\İ^Y\œĞTİX[RQÎÂˆYˆ
\[Ùˆ\İ^Y\œĞTİX[RQÈOOH™[˜İ[ÛˆŠH™]\›ˆ[Â‚ˆHÂˆÛÛœİ›İÜÈH]ØZ]\İ^Y\œĞTİX[RQË˜Ø[
\Ë›[Ù[\Ëœ^Y\‘]X˜\ÙKÜİX[MJNÂˆÛÛœİš\œİH\œ˜^Kš\Ğ\œ˜^J›İÜÊHÈ›İÜÖÌHˆ[ÂˆÛÛœİ]˜]\ˆHİš[™Êš\œİËœİX[WØ]˜]\ˆÏÈš\œİËœİX[P]˜]\ˆÏÈˆŠKš[J
NÂˆ™]\›ˆ]˜]\ˆ[ÂˆHØ]Ú
\œ›ÜŠHÂˆ\Ë›ÙÙÙ\ËØ\›ËŠ˜Z[YÈ™\ÛÛ™HİX[H]˜]\ˆ›Üˆ]]\Ù\ˆ	Ù\œ›Ü‹›Y\ÜØYÙ_X
NÂˆ™]\›ˆ[ÂˆBˆB‚ˆÙ\šX[^™PYZ[•\Ù\Š\Ù\‹İX[P]˜]\“X\H™]ÈX\

JHÂˆÛÛœİÜ›İ\ÈH\™İ[Y[ÖÌ—HÏÈ×NÂˆÛÛœİÜ›İ\X\H™]ÈX\

\œ˜^Kš\Ğ\œ˜^JÜ›İ\ÊHÈÜ›İ\Èˆ×JK›X\

Ü›İ\
HOˆÙÜ›İ\šYÜ›İ\JJNÂˆÛÛœİ\›Z\ÜÚ[Û‘Ü›İ\H\Ù\‹œ\›Z\ÜÚ[Û‘Ü›İ\YÈÜ›İ\X\™Ù]
\Ù\‹œ\›Z\ÜÚ[Û‘Ü›İ\Y
Hˆ[ÂˆÛÛœİ\›Z\ÜÚ[ÛœÈH\Ù\‹œ›ÛHOOH”İ\\YZ[ˆ‚ˆÈÈŠˆ—Bˆˆ
\›Z\ÜÚ[Û‘Ü›İ\Ë™[˜X›YOOH˜[ÙHÈË‹‹Š\›Z\ÜÚ[Û‘Ü›İ\Ëœ\›Z\ÜÚ[ÛœÈÏÈ×JWHˆ×JNÂˆ™]\›ˆÂˆYˆ\Ù\‹šYˆ\Ù\›˜[YNˆ\Ù\‹\Ù\›˜[YKˆ\Ü^S˜[YNˆ\Ù\‹™\Ü^S˜[YHÏÈˆ‹ˆ›ÛNˆ\Ù\‹œ›ÛKˆİX[Mˆ\Ù\‹œİX[MÏÈ[ˆİX[P]˜]\ˆ\Ù\‹œİX[MÈ
İX[P]˜]\“X\™Ù]
\Ù\‹œİX[M
HÏÈ[
Hˆ[ˆšY]Ù\•X[P]]ÔİØ\[˜X›Yˆ\Ù\‹šY]Ù\•X[P]]ÔİØ\[˜X›YOOH˜[ÙKˆ[˜X›Yˆ\Ù\‹™[˜X›YOOH˜[ÙKˆ›İNˆ\Ù\‹››İHÏÈˆ‹ˆ\›Z\ÜÚ[Û‘Ü›İ\Yˆ\Ù\‹œ\›Z\ÜÚ[Û‘Ü›İ\YÏÈ[ˆ\›Z\ÜÚ[Û‘Ü›İ\˜[YNˆ\›Z\ÜÚ[Û‘Ü›İ\Ë›˜[YHÏÈˆ‹ˆ\›Z\ÜÚ[ÛœËˆÜ™X]Y]ˆ[X™\Š\Ù\‹˜Ü™X]Y]ÏÈ
Kˆ\]Y]ˆ[X™\Š\Ù\‹\]Y]ÏÈ
Kˆ\ÜİÛÜ™Ú[™ÙY]ˆ[X™\Š\Ù\‹œ\ÜİÛÜ™Ú[™ÙY]ÏÈ
KˆNÂˆB‚ˆÙ\šX[^™T\›Z\ÜÚ[Û‘Ü›İ\
Ü›İ\\Ù\œÈH×JHÂˆÛÛœİÛİ[H
\œ˜^Kš\Ğ\œ˜^J\Ù\œÊHÈ\Ù\œÈˆ×JK™š[\Š
\Ù\ŠHOˆ\Ù\‹œ\›Z\ÜÚ[Û‘Ü›İ\YOOHÜ›İ\šY
K›[™İÂˆ™]\›ˆÂˆYˆÜ›İ\šYˆ˜[YNˆÜ›İ\›˜[YKˆ[˜X›YˆÜ›İ\™[˜X›YOOH˜[ÙKˆ\›Z\ÜÚ[ÛœÎˆ\œ˜^Kš\Ğ\œ˜^JÜ›İ\œ\›Z\ÜÚ[ÛœÊHÈË‹‹™Ü›İ\œ\›Z\ÜÚ[Ûœ×Hˆ×Kˆ\ÜÚYÛ™Y\Ù\œÎˆÛİ[ˆÜ™X]Y]ˆ[X™\ŠÜ›İ\˜Ü™X]Y]ÏÈ
Kˆ\]Y]ˆ[X™\ŠÜ›İ\\]Y]ÏÈ
KˆNÂˆB‚ˆÙ\šX[^™T\›Z\ÜÚ[Û‘Ü›İ\ÊÜ›İ\ÈH×K\Ù\œÈH×JHÂˆ™]\›ˆ
\œ˜^Kš\Ğ\œ˜^JÜ›İ\ÊHÈÜ›İ\Èˆ×JK›X\

Ü›İ\
HOˆ\ËœÙ\šX[^™T\›Z\ÜÚ[Û‘Ü›İ\
Ü›İ\\Ù\œÊJNÂˆB‚ˆZ[YZ[•\Ù\”İ]Ê][\ÊHÂˆ™]\›ˆÂˆİ[ˆ][\Ë›[™İˆ[˜X›Yˆ][\Ë™š[\Š
][JHOˆ][K™[˜X›Y
K›[™İˆİ\\YZ[œÎˆ][\Ë™š[\Š
][JHOˆ][Kœ›ÛHOOH”İ\\YZ[ˆŠK›[™İˆİX[P›İ[™ˆ][\Ë™š[\Š
][JHOˆ›ÛÛX[Š][KœİX[M
JK›[™İˆNÂˆB‚ˆ›Ü›X[^™T\›Z\ÜÚ[Û‘Ü›İ\Y›Ü”™\]Y\İ
İÜ™K˜[YJHÂˆYˆ
˜[YHOOH[™Yš[™Y
H™]\›ˆ[™Yš[™YÂˆYˆ
˜[YHOOH[İš[™Ê˜[YHÏÈˆŠKš[J
HOOHˆŠH™]\›ˆ[ÂˆÛÛœİÜ›İ\YHİš[™Ê˜[YHÏÈˆŠKš[J
NÂˆÛÛœİÜ›İ\HİÜ™K™Ù]\›Z\ÜÚ[Û‘Ü›İ\RY
Ü›İ\Y
NÂˆYˆ
YÜ›İ\
HÂˆÛÛœİ\œ›ÜˆH™]È\œ›ÜŠ”\›Z\ÜÚ[ÛˆÜ›İ\›İ›İ[™ˆŠNÂˆ\œ›Ü‹œİ]\ĞÛÙHHÂˆ\œ›Ü‹˜ÛÙHH”\›Z\ÜÚ[Û‘Ü›İ\›İ›İ[™Âˆ›İÈ\œ›ÜÂˆBˆ™]\›ˆÜ›İ\YÂˆB‚ˆ™\]Z\™Tİ\\YZ[Š\Ù\‹™\ÊHÂˆYˆ
]\Ë˜ÛÜ™K˜]]X[˜YÙ\Ëš\Ñ]™\][™ÏËŠ\Ù\ŠJHÂˆ\ËšœÛÛŠ™\ËËÂˆ\œ›Üˆ‘›Ü˜šY[ˆ‹ˆY\ÜØYÙNˆ”İ\\YZ[ˆ›ÛH\È™\]Z\™Yˆ‹ˆJNÂˆ™]\›ˆ˜[ÙNÂˆBˆ™]\›ˆYNÂˆB‚ˆÙ]ÙÔÜİÛÛ™šYÔ]

HÂˆÛÛœİ\œÙ\ÛÛ™šYÈH\Ë˜ÛÜ™K˜ÛÛ™šYÏË™Ù]ËŠœ]Û“ÙÔ\œÙ\ˆ‹ßJHÏÈßNÂˆÛÛœİÛÜšÚ[™Ñ\™XİÜHH]œ™\ÛÛ™J›ØÙ\ÜË˜İÙ

Kİš[™Ê\œÙ\ÛÛ™šYËÛÜšÚ[™Ñ\™XİÜHÏÈ‹‹ÓÙÔÜİŠKš[J
JNÂˆ™]\›ˆ]œ™\ÛÛ™JÛÜšÚ[™Ñ\™XİÜKİš[™Ê\œÙ\ÛÛ™šYË˜ÛÛ™šYÔ]ÏÈ‹‹ØÛÛ™šYËšœÛÛˆŠKš[J
JNÂˆB‚ˆ\Ş[˜È™XYÙÔÜİÛÛ™šYÊ
HÂˆÛÛœİÛÛ™šYÔ]H\Ë™Ù]ÙÔÜİÛÛ™šYÔ]

NÂˆÛÛœİ^H]ØZ]œËœ™XYš[JÛÛ™šYÔ]]ŠNÂˆ™]\›ˆÂˆÛÛ™šYÔ]ˆÛÛ™šYÎˆ”ÓÓ‹œ\œÙJ^
KˆNÂˆB‚ˆ\Ş[˜ÈÙ]ÙÔÜİ˜]Óİ]]ÛÛ™šYÊ
HÂˆÛÛœİÈÛÛ™šYÔ]ÛÛ™šYÈHH]ØZ]\Ëœ™XYÙÔÜİÛÛ™šYÊ
NÂˆ™]\›ˆÂˆ[˜X›Yˆ›ÛÛX[ŠÛÛ™šYËœ˜]×ÛÙ×Ûİ]]Ë™[˜X›Y
KˆÛİ\˜ÙNˆİš[™ÊÛÛ™šYËœ˜]×ÛÙ×Ûİ]]ËœÛİ\˜ÙHÏÈ”Ü]XY›ÙÈŠKˆÛÛ™šYÔ]ˆNÂˆB‚ˆ\Ş[˜ÈÙ]ÙÔÜİ˜]Óİ]]ÛÛ™šYÊ[˜X›Y
HÂˆÛÛœİÈÛÛ™šYÔ]ÛÛ™šYÈHH]ØZ]\Ëœ™XYÙÔÜİÛÛ™šYÊ
NÂˆÛÛ™šYËœ˜]×ÛÙ×Ûİ]]HÂˆ‹‹ŠÛÛ™šYËœ˜]×ÛÙ×Ûİ]]ÏÈßJKˆ[˜X›Yˆ›ÛÛX[Š[˜X›Y
KˆÛİ\˜ÙNˆİš[™ÊÛÛ™šYËœ˜]×ÛÙ×Ûİ]]ËœÛİ\˜ÙHÏÈ”Ü]XY›ÙÈŠKˆNÂ‚ˆ]ØZ]œËÜš]Qš[JÛÛ™šYÔ]	Ò”ÓÓ‹œİš[™ÚYJÛÛ™šYË[Š_W˜]ŠNÂ‚ˆYˆ
\Ë˜ÛÜ™Kœ]Û“ÙÔ\œÙ\“X[˜YÙ\Ëœ™\İ\
HÂˆ]ØZ]\Ë˜ÛÜ™Kœ]Û“ÙÔ\œÙ\“X[˜YÙ\‹œ™\İ\

NÂˆB‚ˆ™]\›ˆÂˆÚÎˆYKˆ[˜X›Yˆ›ÛÛX[ŠÛÛ™šYËœ˜]×ÛÙ×Ûİ]]™[˜X›Y
KˆÛİ\˜ÙNˆİš[™ÊÛÛ™šYËœ˜]×ÛÙ×Ûİ]]œÛİ\˜ÙJKˆÛÛ™šYÔ]ˆ™\İ\Yˆ›ÛÛX[Š\Ë˜ÛÜ™Kœ]Û“ÙÔ\œÙ\“X[˜YÙ\Ëœ™\İ\
KˆNÂˆB‚ˆÙ]YÚ[\JYÚ[’Y
HÂˆ™]\›ˆ\Ë˜ÛÜ™KœYÚ[“X[˜YÙ\Ëš[œİ[˜Ù\ÂˆË™š[™

[œİ[˜ÙJHOˆ[œİ[˜ÙK›X[šY™\İËšYOOHYÚ[’Y
OË˜\HÏÈ[ÂˆB‚ˆÙ]ÙÔÜİÛÜšÚ[™Ñ\™XİÜJ
HÂˆÛÛœİ\œÙ\ÛÛ™šYÈH\Ë˜ÛÜ™K˜ÛÛ™šYÏË™Ù]ËŠœ]Û“ÙÔ\œÙ\ˆ‹ßJHÏÈßNÂˆ™]\›ˆ]œ™\ÛÛ™J›ØÙ\ÜË˜İÙ

Kİš[™Ê\œÙ\ÛÛ™šYËÛÜšÚ[™Ñ\™XİÜHÏÈ‹‹ÓÙÔÜİŠKš[J
JNÂˆB‚ˆ\Ş[˜ÈÙ]ÙÔÜİİ]J
HÂˆÛÛœİÛÜšÚ[™Ñ\™XİÜHH\Ë™Ù]ÙÔÜİÛÜšÚ[™Ñ\™XİÜJ
NÂˆÛÛœİİ]]\ˆH™\ÛÛ™SÙÔÜİİ]]\ŠÛÜšÚ[™Ñ\™XİÜJNÂˆÛÛœİYØXŞTİ]T]H]œ™\ÛÛ™Jİ]]\‹‹œİ]H‹Z[\‹\İ]KšœÛÛˆŠNÂˆÛÛœİŒ”İ]T]H]œ™\ÛÛ™Jİ]]\‹œİ]H‹œÛİ\˜ÙK\İ]KšœÛÛˆŠNÂˆÛÛœİYØXŞTİ]HH]ØZ]\Ëœ™XYœÛÛ‘š[TØY™JYØXŞTİ]T]ßJNÂˆÛÛœİÛİ\˜ÙTİ]HH]ØZ]\Ëœ™XYœÛÛ‘š[TØY™JŒ”İ]T]YØXŞTİ]JNÂˆÛÛœİZ[\”İ]HHÛİ\˜ÙTİ]NÂˆÛÛœİØ\İ]HH\Ë™Ù]ÙÔÜİØ\İ]J
NÂ‚ˆ™]\›ˆÂˆÛÜšÚ[™Ñ\™XİÜKˆİ]]\‹ˆZ[\”İ]KˆÛİ\˜ÙTİ]KˆØ\İ]KˆNÂˆB‚ˆÙ]ÙÔÜİØ\İ]J
HÂˆ™]\›ˆ\Ë˜ÛÜ™K›ÙÔÜİ[Ûš]ÜË™Ù]İ]OËŠ
HÏÈÂˆ\İÛİ\˜ÙTÙ\Nˆˆ\İ]™[Yˆˆ‹ˆ™XÙ[Ø\Îˆ×KˆNÂˆB‚ˆ\Ş[˜È]Y\SÙÔÜİ˜]Ğ\˜Ú]™JÈ]Kİ\[™K[Z]Ù™œÙ]JHÂˆÛÛœİ›Ü›X[^™Y]HH›Ü›X[^™SÙÔÜİ]J]JNÂˆÛÛœİÛÜšÚ[™Ñ\ˆH™\ÛÛ™SÙÔÜİİ]]\Š\Ë™Ù]ÙÔÜİÛÜšÚ[™Ñ\™XİÜJ
JNÂˆÛÛœİŒ‘š[T]H]œ™\ÛÛ™JÛÜšÚ[™Ñ\‹œ˜]È‹›Ü›X[^™Y]KœÙYÛY[LKšœÛÛ›ŠNÂˆÛÛœİYØXŞQš[T]H]œ™\ÛÛ™JÛÜšÚ[™Ñ\‹”˜]È‹›Ü›X[^™Y]K˜[šœÛÛ›ŠNÂˆÛÛœİš[T]H]ØZ]\Ëœ™\ÛÛ™Qš\œİ^\İ[™Ô]
İŒ‘š[T]YØXŞQš[T]JNÂˆÛÛœİ][\ÈH]ØZ]\Ëœ™XYœÛÛ›š[Jš[T]
NÂˆÛÛœİš[\™YHš[\“ÙÔÜİ›İÜÊ][\ËÂˆİ\ˆ[™ˆKˆ]™[šY[ˆˆ‹ˆ[YQšY[ˆœ™XY]‹ˆY\ÜØYÙQšY[ÎˆÈœ˜]Ó[™H‹œ˜]Ó[™R\Ú‹œÛİ\˜ÙT]—KˆJNÂˆ™]\›ˆYÚ[˜]SÙÔÜİ›İÜÊš[\™Y[Z]Ù™œÙ]Âˆ]Nˆ›Ü›X[^™Y]Kˆš[T]ˆJNÂˆB‚ˆ\Ş[˜È]Y\SÙÔÜİİXİ\™Y]™[ÊÈ]K]™[İ\[™K[Z]Ù™œÙ]JHÂˆÛÛœİ›Ü›X[^™Y]HH›Ü›X[^™SÙÔÜİ]J]JNÂˆÛÛœİÛÜšÚ[™Ñ\ˆH™\ÛÛ™SÙÔÜİİ]]\Š\Ë™Ù]ÙÔÜİÛÜšÚ[™Ñ\™XİÜJ
JNÂˆÛÛœİŒ‘š[T]H]œ™\ÛÛ™JÛÜšÚ[™Ñ\‹™]™[È‹›Ü›X[^™Y]K˜[šœÛÛ›ŠNÂˆÛÛœİYØXŞQš[T]H]œ™\ÛÛ™JÛÜšÚ[™Ñ\‹›Ü›X[^™Y]K[šœÛÛ›ŠNÂˆÛÛœİš[T]H]ØZ]\Ëœ™\ÛÛ™Qš\œİ^\İ[™Ô]
İŒ‘š[T]YØXŞQš[T]JNÂˆÛÛœİ][\ÈH]ØZ]\Ëœ™XYœÛÛ›š[Jš[T]
NÂˆÛÛœİš[\™YHš[\“ÙÔÜİ›İÜÊ][\ËÂˆİ\ˆ[™ˆKˆ]™[šY[ˆ‘]™[‹ˆ]™[˜[YNˆ]™[ˆ[YQšY[ˆ•[YH‹ˆY\ÜØYÙQšY[ÎˆÈ”˜]È‹‘]™[‹‘]™[Y‹”˜]Ó[™R\Ú‹”Ûİ\˜ÙTÙ\H‹”Ûİ\˜ÙSÙ™œÙ]‹”Ûİ\˜ÙS[ÙH—KˆJNÂˆ™]\›ˆYÚ[˜]SÙÔÜİ›İÜÊš[\™Y[Z]Ù™œÙ]Âˆ]Nˆ›Ü›X[^™Y]Kˆš[T]ˆJNÂˆB‚ˆ\Ş[˜È]Y\SÙÔÜİİ]›Ş
È]KÚ[™K[Z]Ù™œÙ]JHÂˆÛÛœİ›Ü›X[^™Y]HH›Ü›X[^™SÙÔÜİ]J]JNÂˆÛÛœİ\ˆH]œ™\ÛÛ™J™\ÛÛ™SÙÔÜİİ]]\Š\Ë™Ù]ÙÔÜİÛÜšÚ[™Ñ\™XİÜJ
JK›İ]›Ş‹›Ü›X[^™Y]JNÂˆÛÛœİ][\ÈH]ØZ]\Ëœ™XYœÛÛ›\™XİÜJ\ŠNÂˆÛÛœİš[\™YHš[\“ÙÔÜİ›İÜÊ][\ËÂˆKˆ]™[šY[ˆœİ]\È‹ˆ]™[˜[YNˆÚ[™ˆ[YQšY[ˆ[YH‹ˆY\ÜØYÙQšY[ÎˆÈ™]™[˜[YH‹™]™[Y‹œÛİ\˜ÙTÙ\H‹œÛİ\˜ÙS[ÙH‹™\œ›Üˆ—KˆJNÂˆ™]\›ˆYÚ[˜]SÙÔÜİ›İÜÊš[\™Y[Z]Ù™œÙ]Âˆ]Nˆ›Ü›X[^™Y]Kˆš[T]ˆ\‹ˆJNÂˆB‚ˆ\Ş[˜È]Y\SÙÔÜİØY™]JÈ]KÚ[™K[Z]Ù™œÙ]JHÂˆÛÛœİ›Ü›X[^™Y]HH›Ü›X[^™SÙÔÜİ]J]JNÂˆÛÛœİ\ˆH]œ™\ÛÛ™J™\ÛÛ™SÙÔÜİİ]]\Š\Ë™Ù]ÙÔÜİÛÜšÚ[™Ñ\™XİÜJ
JK˜]Y]‹›Ü›X[^™Y]JNÂˆÛÛœİ][\ÈH]ØZ]\Ëœ™XYœÛÛ›\™XİÜJ\ŠNÂˆÛÛœİš[\™YHš[\“ÙÔÜİ›İÜÊ][\ËÂˆKˆ]™[šY[ˆšÚ[™‹ˆ]™[˜[YNˆÚ[™ˆ[YQšY[ˆ[YH‹ˆY\ÜØYÙQšY[ÎˆÈšÚ[™‹œ™X\ÛÛˆ‹œÛİ\˜ÙS[ÙH‹›Y\ÜØYÙH‹™]™[˜[YH‹™]™[Y—KˆJNÂˆ™]\›ˆYÚ[˜]SÙÔÜİ›İÜÊš[\™Y[Z]Ù™œÙ]Âˆ]Nˆ›Ü›X[^™Y]Kˆš[T]ˆ\‹ˆJNÂˆB‚ˆ\Ş[˜ÈÜš]SÙÔÜİ]Y]™XÛÜ™
Ú[™^[ØYHßJHÂˆÛÛœİİ]]\ˆH™\ÛÛ™SÙÔÜİİ]]\Š\Ë™Ù]ÙÔÜİÛÜšÚ[™Ñ\™XİÜJ
JNÂˆÛÛœİ\ˆH]œ™\ÛÛ™Jİ]]\‹˜]Y]‹™]È]J
KÒTÓÔİš[™Ê
KœÛXÙJL
JNÂˆ]ØZ]œË›ZÙ\Š\‹È™Xİ\œÚ]™NˆYHJNÂˆÛÛœİš[T]H]œ™\ÛÛ™J\‹	ÚÚ[™KšœÛÛ›
NÂˆÛÛœİ™XÛÜ™HÂˆØÚ[XNˆ›ÙÜÜİ˜]Y]Œˆ‹ˆÚ[™ˆİš[™ÊÚ[™ÏÈ[šÛ›İÛˆŠKˆ[YNˆ™]È]J
KÒTÓÔİš[™Ê
Kˆ‹‹œ^[ØYˆNÂˆ]ØZ]œË˜\[™š[Jš[T]	Ò”ÓÓ‹œİš[™ÚYJ™XÛÜ™
_W˜]ŠNÂˆB‚ˆ\Ş[˜È™XYœÛÛ›š[Jš[T]
HÂˆHÂˆÛÛœİ^H]ØZ]œËœ™XYš[Jš[T]]ŠNÂˆ™]\›ˆ^ˆœÜ]
××‹ÊBˆ›X\

[™JHOˆ[™Kš[J
JBˆ™š[\Š›ÛÛX[ŠBˆ›X\

[™JHOˆÂˆHÂˆ™]\›ˆ”ÓÓ‹œ\œÙJ[™JNÂˆHØ]ÚÂˆ™]\›ˆ[ÂˆBˆJBˆ™š[\Š›ÛÛX[ŠNÂˆHØ]Ú
\œ›ÜŠHÂˆYˆ
\œ›ÜË˜ÛÙHOOH‘S“ÑS•ŠH™]\›ˆ×NÂˆ›İÈ\œ›ÜÂˆBˆB‚ˆ\Ş[˜È™XYœÛÛ›\™XİÜJ\”]
HÂˆHÂˆÛÛœİ[šY\ÈH]ØZ]œËœ™XY\Š\”]ÈÚ]š[U\\ÎˆYHJNÂˆÛÛœİš[\ÈH[šY\Âˆ™š[\Š
[JHOˆ[Kš\Ñš[J
H	‰ˆ[K›˜[YKÓİÙ\Ø\ÙJ
K™[™ÕÚ]
‹šœÛÛ›ŠJBˆ›X\

[JHOˆ]š›Ú[Š\”][K›˜[YJJBˆœÛÜ

YšYÚ
HOˆY›ØØ[PÛÛ\\™JšYÚ
JNÂˆÛÛœİ›İÜÈH×NÂˆ›Üˆ
ÛÛœİš[T]Ùˆš[\ÊHÂˆ›İÜËœ\Ú
‹‹˜]ØZ]\Ëœ™XYœÛÛ›š[Jš[T]
JNÂˆBˆ™]\›ˆ›İÜÎÂˆHØ]Ú
\œ›ÜŠHÂˆYˆ
\œ›ÜË˜ÛÙHOOH‘S“ÑS•ŠH™]\›ˆ×NÂˆ›İÈ\œ›ÜÂˆBˆB‚ˆ\Ş[˜È™\ÛÛ™Qš\œİ^\İ[™Ô]
]ÊHÂˆ›Üˆ
ÛÛœİš[T]Ùˆ]ÊHÂˆHÂˆ]ØZ]œË˜XØÙ\ÜÊš[T]
NÂˆ™]\›ˆš[T]ÂˆHØ]ÚßBˆBˆ™]\›ˆ]ÖÌHÏÈˆÂˆB‚ˆ\Ş[˜È™XYœÛÛ‘š[TØY™Jš[T]˜[˜XÚÊHÂˆHÂˆÛÛœİ^H]ØZ]œËœ™XYš[Jš[T]]ŠNÂˆ™]\›ˆ”ÓÓ‹œ\œÙJ^
NÂˆHØ]ÚÂˆ™]\›ˆ˜[˜XÚÎÂˆBˆBŸB‚™[˜İ[Ûˆ™\ÛÛ™SÙÔÜİİ]]\ŠÛÜšÚ[™Ñ\™XİÜJHÂˆÛÛœİ˜\ÙQ\™XİÜHH]œ™\ÛÛ™JÛÜšÚ[™Ñ\™XİÜJNÂˆÛÛœİØ[™Y]\ÈHÂˆ˜\ÙQ\™XİÜKˆ]œ™\ÛÛ™J˜\ÙQ\™XİÜK“ÙÔÜİŠKˆNÂ‚ˆ›Üˆ
ÛÛœİØ[™Y]HÙˆØ[™Y]\ÊHÂˆYˆ
ˆ^\İÔŞ[˜Ê]œ™\ÛÛ™JØ[™Y]K™]™[ÈŠJBˆ^\İÔŞ[˜Ê]œ™\ÛÛ™JØ[™Y]Kœ˜]ÈŠJBˆ^\İÔŞ[˜Ê]œ™\ÛÛ™JØ[™Y]K˜]Y]ŠJBˆ^\İÔŞ[˜Ê]œ™\ÛÛ™JØ[™Y]Kœİ]HŠJBˆ^\İÔŞ[˜Ê]œ™\ÛÛ™JØ[™Y]K‹œİ]HŠJBˆ
HÂˆ™]\›ˆØ[™Y]NÂˆBˆB‚ˆ™]\›ˆØ[™Y]\ÖÌNÂŸB‚™[˜İ[ÛˆÛÛ[\Jš[T]
HÂˆYˆ
š[T]™[™ÕÚ]
‹š[ŠJH™]\›ˆ^Ú[ÈÚ\œÙ]]]‹NÂˆYˆ
š[T]™[™ÕÚ]
‹˜ÜÜÈŠJH™]\›ˆ^ØÜÜÎÈÚ\œÙ]]]‹NÂˆYˆ
š[T]™[™ÕÚ]
‹šœÈŠJH™]\›ˆ^Ú˜]˜\ØÜš\ÈÚ\œÙ]]]‹NÂˆYˆ
š[T]™[™ÕÚ]
‹šœÛÛˆŠJH™]\›ˆ˜\XØ][Û‹ÚœÛÛÈÚ\œÙ]]]‹NÂˆYˆ
š[T]™[™ÕÚ]
‹œ™ÈŠJH™]\›ˆš[XYÙKÜ™ÈÂˆYˆ
š[T]™[™ÕÚ]
‹œİ™ÈŠJH™]\›ˆš[XYÙKÜİ™ÊŞ[ÂˆYˆ
š[T]™[™ÕÚ]
‹˜ÜİˆŠJH™]\›ˆ^ØÜİÈÚ\œÙ]]]‹NÂˆYˆ
š[T]™[™ÕÚ]
‹›YŠJH™]\›ˆ^ÛX\šÙİÛÈÚ\œÙ]]]‹NÂˆ™]\›ˆ˜\XØ][Û‹ÛØİ]\İ™X[HÂŸB‚™[˜İ[ÛˆØY™RXY\‘š[S˜[YJš[S˜[YJHÂˆ™]\›ˆ]˜˜\Ù[˜[YJİš[™Êš[S˜[YHÏÈ™İÛ›ØYŠJBˆœ™\XÙJÖ×—ŒWÑWKÙË—ÈŠBˆœ™\XÙJÖÈ—KÙË—ÈŠNÂŸB‚™[˜İ[ÛˆÜ™X]R\œ›ÜŠİ]\ĞÛÙKÛÙKY\ÜØYÙJHÂˆÛÛœİ\œ›ÜˆH™]È\œ›ÜŠY\ÜØYÙJNÂˆ\œ›Ü‹œİ]\ĞÛÙHHİ]\ĞÛÙNÂˆ\œ›Ü‹˜ÛÙHHÛÙNÂˆ™]\›ˆ\œ›ÜÂŸB‚™[˜İ[Ûˆİ]\Õ^
ÛÙJHÂˆİÚ]Ú
ÛÙJHÂˆØ\ÙH‚ˆ™]\›ˆ˜Y™\]Y\İÂˆØ\ÙHN‚ˆ™]\›ˆ•[˜]]Üš^™YÂˆØ\ÙHÎ‚ˆ™]\›ˆ‘›Ü˜šY[ˆÂˆØ\ÙH‚ˆ™]\›ˆ“›İ›İ[™ÂˆY˜][‚ˆ™]\›ˆ‘\œ›ÜˆÂˆBŸB‚™[˜İ[Ûˆ\œÙSÜ[Û˜[›ÛÛX[Š˜[YJHÂˆYˆ
˜[YHOH[İš[™Ê˜[YJKš[J
HOOHˆŠH™]\›ˆ[ÂˆÛÛœİ^Hİš[™Ê˜[YJKš[J
KÓİÙ\Ø\ÙJ
NÂˆYˆ
^OOHYHˆ^OOHŒHŠH™]\›ˆYNÂˆYˆ
^OOH™˜[ÙHˆ^OOHŒŠH™]\›ˆ˜[ÙNÂˆ™]\›ˆ[ÂŸB‚™[˜İ[Ûˆ›Ü›X[^™SÙÔÜİ]J˜[YJHÂˆÛÛœİ^Hİš[™Ê˜[YHÏÈˆŠKš[J
NÂˆYˆ
×—ÍKWÌŸKWÌŸIË\İ
^
JH™]\›ˆ^Âˆ™]\›ˆ™]È]J
KÒTÓÔİš[™Ê
KœÛXÙJL
NÂŸB‚™[˜İ[Ûˆš[\“ÙÔÜİ›İÜÊ][\ËÜ[ÛœÈHßJHÂˆÛÛœİİ\\ÈH\œÙSÜ[Û˜[]S\ÊÜ[ÛœËœİ\
NÂˆÛÛœİ[™\ÈH\œÙSÜ[Û˜[]S\ÊÜ[ÛœË™[™
NÂˆÛÛœİÙ^]ÛÜ™Hİš[™ÊÜ[ÛœËœHÏÈˆŠKš[J
KÓİÙ\Ø\ÙJ
NÂˆÛÛœİ]™[šY[Hİš[™ÊÜ[ÛœË™]™[šY[ÏÈˆŠKš[J
NÂˆÛÛœİ]™[˜[YHHİš[™ÊÜ[ÛœË™]™[˜[YHÏÈˆŠKš[J
NÂˆÛÛœİ[YQšY[Hİš[™ÊÜ[ÛœË[YQšY[ÏÈ•[YHŠKš[J
NÂˆÛÛœİY\ÜØYÙQšY[ÈH\œ˜^Kš\Ğ\œ˜^JÜ[ÛœË›Y\ÜØYÙQšY[ÊHÈÜ[ÛœË›Y\ÜØYÙQšY[Èˆ×NÂ‚ˆ™]\›ˆ
\œ˜^Kš\Ğ\œ˜^J][\ÊHÈ][\Èˆ×JK™š[\Š
][JHOˆÂˆYˆ
Z][H\[Ùˆ][HOOH›Øš™XİŠH™]\›ˆ˜[ÙNÂ‚ˆYˆ
]™[šY[	‰ˆ]™[˜[YJHÂˆYˆ
İš[™Ê][VÙ]™[šY[HÏÈˆŠKš[J
HOOH]™[˜[YJH™]\›ˆ˜[ÙNÂˆB‚ˆÛÛœİİ\œ™[\ÈH\œÙSÜ[Û˜[]S\Ê][Vİ[YQšY[JNÂˆYˆ
İ\\ÈOH[	‰ˆ
İ\œ™[\ÈOH[İ\œ™[\Èİ\\ÊJH™]\›ˆ˜[ÙNÂˆYˆ
[™\ÈOH[	‰ˆ
İ\œ™[\ÈOH[İ\œ™[\Èˆ[™\ÊJH™]\›ˆ˜[ÙNÂ‚ˆYˆ
ZÙ^]ÛÜ™
H™]\›ˆYNÂˆ™]\›ˆY\ÜØYÙQšY[ËœÛÛYJ
šY[
HOˆİš[™Ê][VÙšY[HÏÈˆŠKÓİÙ\Ø\ÙJ
Kš[˜ÛY\ÊÙ^]ÛÜ™
JNÂˆJNÂŸB‚™[˜İ[ÛˆYÚ[˜]SÙÔÜİ›İÜÊ][\Ë[Z]Ù™œÙ]^˜HHßJHÂˆÛÛœİØY™S[Z]HX]›X^
KX]›Z[Š[X™\Š[Z]
HŒŒ
JNÂˆÛÛœİØY™SÙ™œÙ]HX]›X^
[X™\ŠÙ™œÙ]
H
NÂˆ™]\›ˆÂˆ‹‹™^˜Kˆİ[ˆ][\Ë›[™İˆ[Z]ˆØY™S[Z]ˆÙ™œÙ]ˆØY™SÙ™œÙ]ˆ][\Îˆ][\ËœÛXÙJØY™SÙ™œÙ]ØY™SÙ™œÙ]
ÈØY™S[Z]
KˆNÂŸB‚™[˜İ[Ûˆ\œÙSÜ[Û˜[]S\Ê˜[YJHÂˆÛÛœİ^Hİš[™Ê˜[YHÏÈˆŠKš[J
NÂˆYˆ
]^
H™]\›ˆ[ÂˆÛÛœİ\œÙYH]Kœ\œÙJ^
NÂˆ™]\›ˆ[X™\‹š\Ñš[š]J\œÙY
HÈ\œÙYˆ[ÂŸB‚™[˜İ[Ûˆ›Ü›X[^™T^][YT›İÊ›İÊHÂˆÛÛœİİX[TÙXÛÛ™ÈH[X™\Š›İÏËœİX[WÙØ[YWÜÙXÛÛ™ÈÏÈ›İÏËœİX[QØ[YTÙXÛÛ™ÈÏÈ›İÏËœİX[WÜÙXÛÛ™ÈÏÈ›İÏËœİX[TÙXÛÛ™ÈÏÈ›İÏË™Ø[YWÜÙXÛÛ™ÈÏÈ›İÏË™Ø[YTÙXÛÛ™ÈÏÈ
NÂˆÛÛœİİ™\œšYU˜[YHH›İÏË™Ø[YWÜÙXÛÛ™×Ûİ™\œšYHÏÈ›İÏË™Ø[YTÙXÛÛ™Óİ™\œšYNÂˆÛÛœİ›Ü›X[^™Yİ™\œšYHHİ™\œšYU˜[YHOH[İš[™Êİ™\œšYU˜[YJKš[J
HOOHˆ‚ˆÈ[ˆˆ[X™\Šİ™\œšYU˜[YJNÂˆÛÛœİØY™Sİ™\œšYTÙXÛÛ™ÈH›Ü›X[^™Yİ™\œšYHOH[S[X™\‹š\Ñš[š]J›Ü›X[^™Yİ™\œšYJBˆÈ[ˆˆX]›X^
X]™›ÛÜŠ›Ü›X[^™Yİ™\œšYJJNÂˆÛÛœİY™™Xİ]™TÙXÛÛ™ÈH[X™\ŠØY™Sİ™\œšYTÙXÛÛ™ÈÏÈ›İÏË™Ø[YWÜÙXÛÛ™ÈÏÈ›İÏË™Ø[YTÙXÛÛ™ÈÏÈİX[TÙXÛÛ™ÈÏÈ
NÂˆÛÛœİØY™TÙXÛÛ™ÈH[X™\‹š\Ñš[š]JY™™Xİ]™TÙXÛÛ™ÊHÈY™™Xİ]™TÙXÛÛ™ÈˆÂˆÛÛœİØY™TİX[TÙXÛÛ™ÈH[X™\‹š\Ñš[š]JİX[TÙXÛÛ™ÊHÈİX[TÙXÛÛ™ÈˆÂˆ™]\›ˆÂˆİX[RQˆİš[™Ê›İÏËœİX[WÚYÏÈ›İÏËœİX[RQÏÈˆŠKˆ\Yˆ[X™\Š›İÏË˜\ÚYÏÈ›İÏË˜\YÏÈÎLÌÎ
KˆØ[YS˜[YNˆİš[™Ê›İÏË™Ø[YWÛ˜[YHÏÈ›İÏË™Ø[YS˜[YHÏÈ”Ü]XYŠKˆØ[YTÙXÛÛ™ÎˆØY™TÙXÛÛ™ËˆİX[QØ[YTÙXÛÛ™ÎˆØY™TİX[TÙXÛÛ™ËˆØ[YTÙXÛÛ™Óİ™\œšYNˆØY™Sİ™\œšYTÙXÛÛ™ËˆØ[YRİ\œÎˆ[X™\Š
ØY™TÙXÛÛ™ÈÈÍŒ
KÑš^Y
ŠJKˆİX[QØ[YRİ\œÎˆ[X™\Š
ØY™TİX[TÙXÛÛ™ÈÈÍŒ
KÑš^Y
ŠJKˆ™]ÚY]ˆ[X™\Š›İÏË™™]ÚYØ]ÏÈ›İÏË™™]ÚY]ÏÈ
H[ˆ\İÙY[“˜[YNˆ›İÏË›\İÜÙY[—Û˜[YHÏÈ›İÏË›\İÙY[“˜[YHÏÈ[ˆİX[WØ]˜]\ˆ›İÏËœİX[WØ]˜]\ˆÏÈ›İÏËœİX[P]˜]\ˆÏÈ[ˆİX[P]˜]\ˆ›İÏËœİX[WØ]˜]\ˆÏÈ›İÏËœİX[P]˜]\ˆÏÈ[ˆNÂŸB‚™[˜İ[ÛˆÛX[”^Y\‘›ÜÛY[
^Y\ŠHÂˆYˆ
\^Y\ŠH™]\›ˆ^Y\ÂˆÛÛœİÛX[™YHÈ‹‹œ^Y\ˆNÂˆ[]HÛX[™Yœ˜]ÎÂˆ™]\›ˆÛX[™YÂŸB‚™[˜İ[ÛˆÛX[”^Y\œÑ›ÜÛY[
^Y\œÊHÂˆYˆ
\^Y\œÊH™]\›ˆ^Y\œÎÂˆÛÛœİÛX[™YHÈ‹‹œ^Y\œÈNÂˆ[]HÛX[™Y˜TİX[RQÂˆ[]HÛX[™Y˜QSÔÒQÂˆ[]HÛX[™Y˜T^Y\’QÂˆ[]HÛX[™Y˜S˜[YNÂˆYˆ
\œ˜^Kš\Ğ\œ˜^JÛX[™Y˜Xİ]™JJHÂˆÛX[™Y˜Xİ]™HHÛX[™Y˜Xİ]™K›X\
ÛX[”^Y\‘›ÜÛY[
NÂˆBˆYˆ
\œ˜^Kš\Ğ\œ˜^JÛX[™Yœ™XÙ[Q\ØÛÛ›™XİY
JHÂˆÛX[™Yœ™XÙ[Q\ØÛÛ›™XİYHÛX[™Yœ™XÙ[Q\ØÛÛ›™XİY›X\
ÛX[”^Y\‘›ÜÛY[
NÂˆBˆ™]\›ˆÛX[™YÂŸB‚™[˜İ[ÛˆÛX[”Ü]XYÑ›ÜÛY[
Ü]XYÊHÂˆYˆ
\Ü]XYÊH™]\›ˆÜ]XYÎÂˆÛÛœİÛX[™YHÈ‹‹œÜ]XYÈNÂˆ[]HÛX[™Y˜RÙ^NÂˆ[]HÛX[™Y˜UX[RQÂˆ™]\›ˆÛX[™YÂŸB‚™[˜İ[ÛˆÛX[”Û˜\Úİ[›ÜÛY[
[
HÂˆYˆ
X[
H™]\›ˆ[Âˆ™]\›ˆÂˆ‹‹˜[ˆ^Y\œÎˆÛX[”^Y\œÑ›ÜÛY[
[œ^Y\œÊKˆÜ]XYÎˆÛX[”Ü]XYÑ›ÜÛY[
[œÜ]XYÊKˆX]Úˆ[›X]ÚÈÂˆ‹‹˜[›X]Úˆ^Y\œÎˆÛX[”^Y\œÑ›ÜÛY[
[›X]Úœ^Y\œÊKˆÜ]XYÎˆÛX[”Ü]XYÑ›ÜÛY[
[›X]ÚœÜ]XYÊKˆHˆ[›X]ÚˆNÂŸB‚™[˜İ[ÛˆÛX[ÛÛX˜]]™[›ÜÛY[
]™[
HÂˆYˆ
Y]™[
H™]\›ˆ]™[ÂˆÛÛœİÛX[™YHÈ‹‹™]™[NÂˆ[]HÛX[™Yœ˜]ÎÂˆ[]HÛX[™Yœ˜]Ñ]™[ÂˆYˆ
ÛX[™Y˜]XÚÙ\ŠHÂˆÛX[™Y˜]XÚÙ\ˆHÈ‹‹˜ÛX[™Y˜]XÚÙ\ˆNÂˆ[]HÛX[™Y˜]XÚÙ\‹œ˜]ÎÂˆBˆYˆ
ÛX[™YšXİ[JHÂˆÛX[™YšXİ[HHÈ‹‹˜ÛX[™YšXİ[HNÂˆ[]HÛX[™YšXİ[Kœ˜]ÎÂˆBˆ™]\›ˆÛX[™YÂŸB‚™[˜İ[ÛˆÛX[ÛÛX˜]]™[Ñ›ÜÛY[
]™[ÊHÂˆYˆ
P\œ˜^Kš\Ğ\œ˜^J]™[ÊJH™]\›ˆ×NÂˆ™]\›ˆ]™[Ë›X\
ÛX[ÛÛX˜]]™[›ÜÛY[
NÂŸB‚™[˜İ[ÛˆÛX[ÛÛX˜]İ™\šY]Ñ›ÜÛY[
İ™\šY]ÊHÂˆYˆ
[İ™\šY]ÊH™]\›ˆİ™\šY]ÎÂˆÛÛœİÛX[™YHÈ‹‹›İ™\šY]ÈNÂˆ[]HÛX[™Y™]™[ÎÂˆ[]HÛX[™Y›]\İÂˆ[]HÛX[™Yœ˜]Ó]\İÂˆ[]HÛX[™Yœ›ØÙ\ÜÙY]\İÂˆ™]\›ˆÛX[™YÂŸB‚™[˜İ[ÛˆÛX[˜]SÙÑ]™[›ÜÛY[
]™[
HÂˆYˆ
Y]™[
H™]\›ˆ]™[ÂˆÛÛœİÛX[™YHÈ‹‹™]™[NÂˆ[]HÛX[™Yœ˜]ÎÂˆ[]HÛX[™Yœ˜]Ñ]™[ÂˆYˆ
ÛX[™Yœ^Y\ŠHÂˆÛX[™Yœ^Y\ˆHÈ‹‹˜ÛX[™Yœ^Y\ˆNÂˆ[]HÛX[™Yœ^Y\‹œ˜]ÎÂˆBˆYˆ
ÛX[™Y˜Ûİ[\œ\JHÂˆÛX[™Y˜Ûİ[\œ\HHÈ‹‹˜ÛX[™Y˜Ûİ[\œ\HNÂˆ[]HÛX[™Y˜Ûİ[\œ\Kœ˜]ÎÂˆBˆYˆ
ÛX[™Y˜]XÚÙ\ŠHÂˆÛX[™Y˜]XÚÙ\ˆHÈ‹‹˜ÛX[™Y˜]XÚÙ\ˆNÂˆ[]HÛX[™Y˜]XÚÙ\‹œ˜]ÎÂˆBˆYˆ
ÛX[™YšXİ[JHÂˆÛX[™YšXİ[HHÈ‹‹˜ÛX[™YšXİ[HNÂˆ[]HÛX[™YšXİ[Kœ˜]ÎÂˆBˆ™]\›ˆÛX[™YÂŸB‚™[˜İ[ÛˆÛX[˜]SÙÑ]™[Ñ›ÜÛY[
]™[ÊHÂˆYˆ
P\œ˜^Kš\Ğ\œ˜^J]™[ÊJH™]\›ˆ×NÂˆ™]\›ˆ]™[Ë›X\
ÛX[˜]SÙÑ]™[›ÜÛY[
NÂŸB‚™[˜İ[ÛˆÛX[˜]SÙÓİ™\šY]Ñ›ÜÛY[
İ™\šY]ÊHÂˆYˆ
[İ™\šY]ÊH™]\›ˆİ™\šY]ÎÂˆÛÛœİÛX[™YHÈ‹‹›İ™\šY]ÈNÂˆYˆ
\œ˜^Kš\Ğ\œ˜^JÛX[™Y›]\İ
JHÂˆÛX[™Y›]\İHÛX[˜]SÙÑ]™[Ñ›ÜÛY[
ÛX[™Y›]\İ
NÂˆBˆ™]\›ˆÛX[™YÂŸB‚™[˜İ[ÛˆÛX[˜]SÙÑ]™[Ô™\ÜÛœÙQ›ÜÛY[
]JHÂˆYˆ
Y]JH™]\›ˆ]NÂˆ™]\›ˆÂˆ‹‹™]Kˆ]™[ÎˆÛX[˜]SÙÑ]™[Ñ›ÜÛY[
]K™]™[ÊKˆİ™\šY]ÎˆÛX[˜]SÙÓİ™\šY]Ñ›ÜÛY[
]K›İ™\šY]ÊKˆNÂŸB‚™[˜İ[ÛˆÛX[˜]SÙÔ^Y\”™\ÜÛœÙQ›ÜÛY[
]JHÂˆYˆ
Y]JH™]\›ˆ]NÂˆ™]\›ˆÂˆ‹‹™]Kˆ]™[ÎˆÛX[˜]SÙÑ]™[Ñ›ÜÛY[
]K™]™[ÊKˆ]\İˆÛX[˜]SÙÑ]™[Ñ›ÜÛY[
]K›]\İ
KˆNÂŸB‚™[˜İ[Ûˆ›Ü›X[^™TÜ]XY˜[YJ˜[YJHÂˆ™]\›ˆİš[™Ê˜[YHÏÈˆŠKš[J
Kœ™\XÙJ×ÊËÙËˆŠKÓİÙ\Ø\ÙJ
NÂŸB‚™[˜İ[ÛˆZ[˜XÚÚ[™ÒÙ^J™XÛÜ™HßJHÂˆ™]\›ˆÂˆİš[™Ê™XÛÜ™œÙ\™\’YÏÈˆŠKš[J
Kˆİš[™Ê™XÛÜ™›X]ÚYÏÈˆŠKš[J
Kˆ™XÛÜ™X[RYOH[Èˆˆˆİš[™Ê™XÛÜ™X[RY
Kˆ™XÛÜ™œÜ]XYYOH[Èˆˆˆİš[™Ê™XÛÜ™œÜ]XYY
Kˆ›Ü›X[^™TÜ]XY˜[YJ™XÛÜ™œÜ]XY˜[YJKˆKš›Ú[ŠŸŠNÂŸB‚™[˜İ[ÛˆZ[Ü]XY˜[YU˜XÚÚ[™Ô™XÛÜ™ÊÈİX\™İ\Ú\ÙK˜Z\‹[PÚZ[‹Y™XŞXÛHJHÂˆÛÛœİÜ›İ\YH™]ÈX\

NÂ‚ˆ›Üˆ
ÛÛœİ][HÙˆ\œ˜^Kš\Ğ\œ˜^JİX\™Ëœ™XÙ[
HÈİX\™œ™XÙ[ˆ×JHÂˆÛÛœİİ]\ÈHİš[™Ê][Kœİ]\ÈÏÈˆŠKš[J
NÂˆYˆ
İ]\ÈOOHš[Û][Ûˆˆ	‰ˆİ]\ÈOOHš[™Yˆ	‰ˆİ]\ÈOOH™\œ›ÜˆŠHÛÛ[YNÂˆÛÛœİÙ^HHZ[˜XÚÚ[™ÒÙ^JÂˆÙ\™\’Yˆ][KœÙ\™\’YÏÈ][K™]™[ËœÙ\™\’YÏÈˆ‹ˆX]ÚYˆ][K›X]ÚYÏÈ][K™]™[Ë›X]ÚYÏÈˆ‹ˆX[RYˆ][K™]™[ËX[RYÏÈ[ˆÜ]XYYˆ][K™]™[ËœÜ]XYYÏÈ[ˆÜ]XY˜[YNˆ][K™]™[ËœÜ]XY˜[YHÏÈˆ‹ˆJNÂˆYˆ
YÜ›İ\Yš\ÊÙ^JJHÜ›İ\YœÙ]
Ù^KÈÜ]XY˜[YNˆ×Kİ\Ú\ÙNˆ×K˜Z\ˆ×HJNÂˆÜ›İ\Y™Ù]
Ù^JKœÜ]XY˜[YKœ\Ú
ÂˆYˆ][KšYˆÙ\™\’Yˆ][KœÙ\™\’YÏÈ][K™]™[ËœÙ\™\’YÏÈˆ‹ˆX]ÚYˆ][K›X]ÚYÏÈ][K™]™[Ë›X]ÚYÏÈˆ‹ˆX[RYˆ][K™]™[ËX[RYÏÈ[ˆÜ]XYYˆ][K™]™[ËœÜ]XYYÏÈ[ˆÜ]XY˜[YNˆ][K™]™[ËœÜ]XY˜[YHÏÈˆ‹ˆÜ™X]Ü“˜[YNˆ][K™]™[Ë˜Ü™X]Ü“˜[YHÏÈˆ‹ˆÜ™X]Ü”İX[RYˆ][K™]™[Ë˜Ü™X]Ü”İX[RYÏÈ][K™]™[Ë˜Ü™X]Ü”İX[RQÏÈ][K™]™[ËœİX[RYÏÈ][K™]™[ËœİX[RQÏÈˆ‹ˆÛİ\˜ÙNˆœÜ]XYÛ˜[YWÜ[H‹ˆİYÙNˆœÜ]XYÛ˜[YH‹ˆİ]\Îˆš[Û][Ûˆ‹ˆXÚ\Ú[Û“X™[ˆºf'ùd#z/çz)á‹ˆXÚ\Ú[Û•Û™Nˆ™[™Ù\ˆ‹ˆ™X\ÛÛˆ][Kœ™X\ÛÛˆÏÈˆ‹ˆÜ™X]Y]ˆ][K˜Ü™X]Y]ˆ\]Y]ˆ][K\]Y]ˆXİ[ÛœÎˆ\œ˜^Kš\Ğ\œ˜^J][K˜Xİ[ÛœÊHÈ][K˜Xİ[ÛœË›X\

Xİ[ÛŠHOˆXİ[Û‹\JK™š[\Š›ÛÛX[ŠHˆ×KˆØ[•Ú][\İˆYKˆJNÂˆB‚ˆ›Üˆ
ÛÛœİ][HÙˆ\œ˜^Kš\Ğ\œ˜^Jİ\Ú\ÙOËœ™XÙ[™XÛÜ™ÊHÈİ\Ú\ÙKœ™XÙ[™XÛÜ™Èˆ×JHÂˆYˆ
][OËš[Û][ÛˆOOHYJHÛÛ[YNÂˆÛÛœİÙ^HHZ[˜XÚÚ[™ÒÙ^JÂˆÙ\™\’Yˆ][KœÙ\™\’YÏÈˆ‹ˆX]ÚYˆ][K›X]ÚYÏÈˆ‹ˆX[RYˆ][KX[RYÏÈ[ˆÜ]XYYˆ][KœÜ]XYYÏÈ[ˆÜ]XY˜[YNˆ][KœÜ]XY˜[YHÏÈˆ‹ˆJNÂˆYˆ
YÜ›İ\Yš\ÊÙ^JJHÜ›İ\YœÙ]
Ù^KÈÜ]XY˜[YNˆ×Kİ\Ú\ÙNˆ×K˜Z\ˆ×HJNÂˆÜ›İ\Y™Ù]
Ù^JKœİ\Ú\ÙKœ\Ú
ÂˆYˆ][KšYˆÙ\™\’Yˆ][KœÙ\™\’YÏÈˆ‹ˆX]ÚYˆ][K›X]ÚYÏÈˆ‹ˆX[RYˆ][KX[RYÏÈ[ˆÜ]XYYˆ][KœÜ]XYYÏÈ[ˆÜ]XY˜[YNˆ][KœÜ]XY˜[YHÏÈˆ‹ˆÜ™X]Ü“˜[YNˆ][K˜Ü™X]Ü“˜[YHÏÈ][K›XY\“˜[YHÏÈˆ‹ˆÜ™X]Ü”İX[RYˆ][K˜Ü™X]Ü”İX[RYÏÈ][K›XY\”İX[RYÏÈ][KœİX[RYÏÈ][KœİX[RQÏÈˆ‹ˆÜ]XY˜]\™Nˆ][KœÜ]XY˜]\™HÏÈ][KœÜ]XY\HÏÈˆ‹ˆÜ]XY˜]\™SX™[ˆ][KœÜ]XY˜]\™SX™[ÏÈˆ‹ˆÛİ\˜ÙNˆY\™YÜÜ]XYİ[YH‹ˆİYÙNˆœİ\Ú\ÙH‹ˆİ]\Îˆš[Û][Ûˆ‹ˆXÚ\Ú[Û“X™[ˆºf-¹¨«ùo#ù¥íºeoù¢ä¹îçH‹ˆXÚ\Ú[Û•Û™Nˆ™[™Ù\ˆ‹ˆ™X\ÛÛˆ][K™XÚ\Ú[Û”™X\ÛÛˆÏÈ][Kœ™X\ÛÛˆÏÈˆ‹ˆÜ™X]Y]ˆ][K˜Ü™X]Y]ˆ\]Y]ˆ][K\]Y]ˆXİ[ÛœÎˆ\œ˜^Kš\Ğ\œ˜^J][K˜Xİ[ÛœÊHÈ][K˜Xİ[ÛœË›X\

Xİ[ÛŠHOˆXİ[Û‹\JK™š[\Š›ÛÛX[ŠHˆ×KˆØ[•Ú][\İˆ˜[ÙKˆJNÂˆB‚ˆ›Üˆ
ÛÛœİ][HÙˆ\œ˜^Kš\Ğ\œ˜^J˜Z\Ëœ™XÙ[™XÛÜ™ÊHÈ˜Z\‹œ™XÙ[™XÛÜ™Èˆ×JHÂˆÛÛœİš[Û][ÛˆH][OËš[Û][ÛˆOOHYNÂˆÛÛœİ\›İ™YH][OË˜\›İ™YOOHYH	‰ˆ]š[Û][ÛÂˆYˆ
]š[Û][Ûˆ	‰ˆX\›İ™Y
HÛÛ[YNÂ‚ˆÛÛœİÙ^HHZ[˜XÚÚ[™ÒÙ^JÂˆÙ\™\’Yˆ][KœÙ\™\’YÏÈˆ‹ˆX]ÚYˆ][K›X]ÚYÏÈˆ‹ˆX[RYˆ][KX[RYÏÈ[ˆÜ]XYYˆ][KœÜ]XYYÏÈ[ˆÜ]XY˜[YNˆ][KœÜ]XY˜[YHÏÈˆ‹ˆJNÂˆYˆ
YÜ›İ\Yš\ÊÙ^JJHÜ›İ\YœÙ]
Ù^KÈÜ]XY˜[YNˆ×Kİ\Ú\ÙNˆ×K˜Z\ˆ×HJNÂˆÜ›İ\Y™Ù]
Ù^JK™˜Z\‹œ\Ú
ÂˆYˆ][KšYˆÙ\™\’Yˆ][KœÙ\™\’YÏÈˆ‹ˆX]ÚYˆ][K›X]ÚYÏÈˆ‹ˆX[RYˆ][KX[RYÏÈ[ˆÜ]XYYˆ][KœÜ]XYYÏÈ[ˆÜ]XY˜[YNˆ][KœÜ]XY˜[YHÏÈˆ‹ˆÜ™X]Ü“˜[YNˆ][K˜Ü™X]Ü“˜[YHÏÈˆ‹ˆÜ™X]Ü”İX[RYˆ][K˜Ü™X]Ü”İX[RYÏÈ][KœİX[RYÏÈ][KœİX[RQÏÈˆ‹ˆÛİ\˜ÙNˆš[Û][ÛˆÈ™˜Z\—ÜÜ]XYØÜ™X][Ûˆˆˆ™š[˜[Ø[İÙY‹ˆİYÙNˆš[Û][ÛˆÈ™˜Z\ˆˆˆ™š[˜[‹ˆİ]\Îˆš[Û][ÛˆÈš[Û][Ûˆˆˆ˜[İÙY‹ˆXÚ\Ú[Û“X™[ˆš[Û][ÛˆÈ¹ak9nlùnîºf'ù¢ä¹îçHˆˆ¹§ 9îâ:`&º/áÈ‹ˆXÚ\Ú[Û•Û™Nˆš[Û][ÛˆÈ™[™Ù\ˆˆˆ›ÚÈ‹ˆ™X\ÛÛˆ\œ˜^Kš\Ğ\œ˜^J][Kœ™X\ÛÛœÊHÈ][Kœ™X\ÛÛœËš›Ú[ŠˆŠHˆ][Kœ™X\ÛÛˆÏÈˆ‹ˆÜ™X]Y]ˆ][K˜Ü™X]Y]ˆ\]Y]ˆ][K\]Y]ˆXİ[ÛœÎˆ\œ˜^Kš\Ğ\œ˜^J][K˜Xİ[ÛœÊHÈ][K˜Xİ[ÛœË›X\

Xİ[ÛŠHOˆXİ[Û‹\JK™š[\Š›ÛÛX[ŠHˆ×KˆØ[•Ú][\İˆ˜[ÙKˆJNÂˆB‚ˆ™]\›ˆ\œ˜^K™œ›ÛJÜ›İ\Y˜[Y\Ê
JBˆ›X\

XÚÙ]
HOˆÙ[Xİ˜XÚÚ[™Ô™XÛÜ™
XÚÙ]
JBˆ™š[\Š›ÛÛX[ŠBˆœÛÜ

YšYÚ
HOˆÂˆÛÛœİšYÚ\ÈH]Kœ\œÙJšYÚ\]Y]ÏÈšYÚ˜Ü™X]Y]ÏÈˆŠHÂˆÛÛœİY\ÈH]Kœ\œÙJY\]Y]ÏÈY˜Ü™X]Y]ÏÈˆŠHÂˆ™]\›ˆšYÚ\ÈHY\ÎÂˆJBˆœÛXÙJÌ
NÂŸB‚™[˜İ[ÛˆÙ[Xİ˜XÚÚ[™Ô™XÛÜ™
XÚÙ]
HÂˆYˆ
XXÚÙ]
H™]\›ˆ[ÂˆÛÛœİ]\İÜ]XY˜[YHHXÚÓ]\İ™XÛÜ™
XÚÙ]œÜ]XY˜[YJNÂˆYˆ
]\İÜ]XY˜[YJH™]\›ˆ]\İÜ]XY˜[YNÂ‚ˆÛÛœİ]\İİ\Ú\ÙHHXÚÓ]\İ™XÛÜ™
XÚÙ]œİ\Ú\ÙJNÂˆYˆ
]\İİ\Ú\ÙJH™]\›ˆ]\İİ\Ú\ÙNÂ‚ˆ™]\›ˆXÚÓ]\İ™XÛÜ™
XÚÙ]™˜Z\ŠNÂŸB‚™[˜İ[ÛˆXÚÓ]\İ™XÛÜ™
™XÛÜ™ÊHÂˆYˆ
P\œ˜^Kš\Ğ\œ˜^J™XÛÜ™ÊH™XÛÜ™Ë›[™İOOH
H™]\›ˆ[Âˆ]]\İH™XÛÜ™ÖÌNÂˆ]]\İ\ÈH]Kœ\œÙJ]\İ\]Y]ÏÈ]\İ˜Ü™X]Y]ÏÈˆŠHÂˆ›Üˆ
ÛÛœİ™XÛÜ™Ùˆ™XÛÜ™ËœÛXÙJJJHÂˆÛÛœİİ\œ™[\ÈH]Kœ\œÙJ™XÛÜ™\]Y]ÏÈ™XÛÜ™˜Ü™X]Y]ÏÈˆŠHÂˆYˆ
İ\œ™[\Èˆ]\İ\ÊHÂˆ]\İH™XÛÜ™Âˆ]\İ\ÈHİ\œ™[\ÎÂˆBˆBˆ™]\›ˆ]\İÂŸB