// -*- coding: utf-8 -*-

import http from "node:http";
import https from "node:https";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
const requestStorage = new AsyncLocalStorage();
import { handleSquadManagementRoutes } from "../modules/squad-management/routes.js";
import { handleTeamBalanceRoutes } from "../modules/team-balance/routes.js";
import { handleReserveSlotsRoutes } from "../modules/reserve-slots/routes.js";
import {
  applySecurityHeaders,
  isStateChangingMethod,
  resolveRequestProtocol,
  normalizeTransport,
  validateHost,
  validateOrigin,
} from "./web-security.js";
import { HttpsCertificateManager } from "./https-certificate-manager.js";
import {
  classifySquadName,
  getSquadNameClassifierRules,
  getSquadNameExactRuleConfig,
  updateSquadNameExactRuleConfig,
} from "./squad-name-classifier.js";
import {
  getAllPlugins,
  setPluginEnabled as updatePluginEnabled,
  updatePluginConfig as updatePluginManifestConfig,
} from "./plugins/plugin.service.js";

const MAX_JSON_BODY_BYTES = 1024 * 1024;

export class WebServer {
  constructor({ config, logger, core, modules }) {
    this.config = config;
    this.enabled = config.enabled ?? true;
    this.host = config.host ?? "127.0.0.1";
    this.port = Number(config.port ?? 8899);
    this.environment = String(config.environment ?? "development").trim().toLowerCase();
    this.useVueClient = Boolean(config.useVueClient);
    this.staticDirectory = path.resolve(
      process.cwd(),
      this.useVueClient ? "./web-client/dist" : (config.staticDirectory ?? "./web"),
    );
    this.transport = normalizeTransport(config.transport, config.https?.enabled);
    this.httpsConfig = config.https ?? {};
    this.enforceHttps = this.transport === "https" || config.enforceHttps === true;
    this.allowedHosts = Array.isArray(config.allowedHosts) ? config.allowedHosts : [];
    this.allowedOrigins = Array.isArray(config.allowedOrigins) ? config.allowedOrigins : [];
    this.securityConfig = config.security ?? {};
    this.timeoutConfig = config.timeouts ?? {};

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

    this.memoryHistory = [];
    this.maxMemoryHistoryPoints = 120;
    this.memoryInterval = null;
  }

  async start() {
    if (!this.enabled) {
      this.logger.info("WebServer disabled.");
      return;
    }

    await this.warnIfStaticIndexMissing();
    const requestHandler = (req, res) => {
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
            message: statusCode >= 500 ? "Internal server error." : error.message,
          });
        });
      });
    };

    if (this.transport === "https") {
      const certificateManager = new HttpsCertificateManager({
        config: this.httpsConfig,
        logger: this.logger,
      });
      const tlsOptions = await certificateManager.loadTlsOptions();
      this.server = https.createServer(tlsOptions, requestHandler);
    } else {
      this.server = http.createServer(requestHandler);
    }

    this.server.on("upgrade", (req, socket, head) => {
      this.handleUpgrade(req, socket, head).catch((error) => {
        this.logger.warn(`WebSocket upgrade rejected: ${error?.message ?? error}`);
        try {
          socket.destroy();
        } catch {}
      });
    });

    this.server.headersTimeout = Number(this.timeoutConfig.headersTimeoutMs ?? 10_000);
    this.server.requestTimeout = Number(this.timeoutConfig.requestTimeoutMs ?? 30_000);
    this.server.keepAliveTimeout = Number(this.timeoutConfig.keepAliveTimeoutMs ?? 5_000);
    this.server.timeout = Number(this.timeoutConfig.socketTimeoutMs ?? 30_000);
    this.server.maxHeadersCount = 100;
    this.server.maxRequestsPerSocket = 1000;
    this.server.on("clientError", (error, socket) => {
      this.logger.warn(`HTTP client error: ${error?.code ?? error?.message ?? "unknown"}`);
      try {
        socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      } catch {}
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
        this.memoryHistory.push({
          timestamp: Date.now(),
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
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

    this.logger.info(`WebServer listening on ${this.transport}://${this.host}:${this.port}`);
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
    this.applyResponseSecurity(req, res);
    this.enforceRequestBoundary(req);
    const url = this.parseInternalUrl(req.url);

    if (url.pathname.startsWith("/api/")) {
      return this.handleApi(url, req, res);
    }

    return this.serveStatic(url, res);
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

  parseInternalUrl(rawUrl) {
    return new URL(rawUrl, "http://internal.invalid");
  }

  applyResponseSecurity(req, res) {
    if (typeof res.setHeader !== "function") return;
    applySecurityHeaders(req, res, this.securityConfig);
  }

  enforceRequestBoundary(req) {
    this.enforceHost(req);
    if (!this.isRequestSecure(req) && this.enforceHttps) {
      throw createHttpError(426, "UpgradeRequired", "HTTPS is required.");
    }
  }

  enforceHost(req) {
    if (!validateHost(req, this.allowedHosts)) {
      throw createHttpError(421, "MisdirectedRequest", "Host is not allowed.");
    }
  }

  requireAllowedOrigin(req) {
    if (!isStateChangingMethod(req?.method)) return;
    if (!this.allowedOrigins.length) return;
    if (!validateOrigin(req, this.allowedOrigins)) {
      throw createHttpError(403, "ForbiddenOrigin", "Origin is not allowed.");
    }
  }

  requireSecureRequest(req) {
    if (!this.isRequestSecure(req)) {
      throw createHttpError(426, "UpgradeRequired", "HTTPS is required.");
    }
  }

  isRequestSecure(req) {
    return resolveRequestProtocol(req) === "https";
  }

  async handleApi(url, req, res) {
    this.requireAllowedOrigin(req);

    if (url.pathname === "/api/health" && req.method === "GET") {
      return this.json(res, 200, { ok: true });
    }

    if (url.pathname === "/api/auth/session") {
      const user = this.core.authManager?.getUserFromRequest(req) ?? null;
      return this.json(res, 200, {
        authenticated: Boolean(user),
        user,
      });
    }

    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      this.requireSecureRequest(req);
      this.requireAllowedOrigin(req);
      const body = await this.readJsonBody(req);
      const result = await this.core.authManager.login({
        username: body.username,
        password: body.password,
        ip: this.getRequestIp(req),
      });

      if (!result.ok) {
        return this.json(res, 401, {
          ok: false,
          error: result.error ?? "InvalidCredentials",
          message: "Invalid username or password.",
        });
      }

      return this.json(res, 200, {
        ok: true,
        authenticated: true,
        user: result.user,
      }, {
        "Set-Cookie": result.cookie,
      });
    }

    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      this.requireSecureRequest(req);
      this.requireAllowedOrigin(req);
      const expiredCookie = this.core.authManager.logout(req);
      return this.json(res, 200, {
        ok: true,
        authenticated: false,
      }, {
        "Set-Cookie": expiredCookie,
        ...(this.isRequestSecure(req) ? { "Clear-Site-Data": "\"cache\", \"cookies\", \"storage\"" } : {}),
      });
    }

    const user = this.core.authManager?.getUserFromRequest(req);
    if (!user) {
      return this.json(res, 401, {
        error: "Unauthorized",
        message: "Authentication required.",
      });
    }

    if (url.pathname === "/api/squad-name/rules") {
      if (req.method === "GET") {
        const result = await getSquadNameExactRuleConfig(this.core.config);
        return this.json(res, 200, {
          ok: true,
          ...result,
        });
      }

      if (req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        const result = await updateSquadNameExactRuleConfig(this.core.config, body?.exactRules ?? body ?? {});
        return this.json(res, 200, {
          ok: true,
          ...result,
        });
      }

      return this.json(res, 405, {
        error: "MethodNotAllowed",
        message: "Only GET and POST are supported.",
      });
    }

    if (url.pathname === "/api/squad-name/classify") {
      if (req.method !== "GET" && req.method !== "POST") {
        return this.json(res, 405, {
          error: "MethodNotAllowed",
          message: "Only GET and POST are supported.",
        });
      }

      const body = req.method === "POST" ? await this.readJsonBody(req) : {};
      const name = req.method === "POST"
        ? body?.name ?? body?.squadName ?? body?.teamName ?? ""
        : url.searchParams.get("name") ?? url.searchParams.get("squadName") ?? url.searchParams.get("teamName") ?? "";

      if (!String(name ?? "").trim()) {
        return this.json(res, 400, {
          error: "MissingName",
          message: "Squad name is required.",
        });
      }

      const result = classifySquadName(name, {
        rules: getSquadNameClassifierRules(this.core.config),
      });
      return this.json(res, 200, {
        ok: true,
        ...result,
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

    if (url.pathname === "/api/settings/exposed") {
      const configManager = this.core.config;
      if (!configManager?.getExposedSettings) {
        return this.json(res, 503, {
          error: "SettingsUnavailable",
          message: "Settings manager is unavailable.",
        });
      }

      if (req.method === "GET") {
        return this.json(res, 200, configManager.getExposedSettings());
      }

      if (req.method === "PATCH") {
        if (!this.requireSuperAdmin(user, res)) return;
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
      if (!this.requireSuperAdmin(user, res)) return;
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
        },
      });
    }

    if (url.pathname === "/api/web/pages") {
      return this.json(res, 200, { pages: this.core.webRegistry.getPages(user) });
    }

    if (url.pathname === "/api/web/status") {
      return this.json(res, 200, this.core.webStatus.getSnapshot());
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
      return this.json(res, 200, this.core.runtimeState.getAll());
    }

    if (url.pathname === "/api/snapshot/server" && req.method === "GET") {
      return this.json(res, 200, this.core.runtimeState.getServer());
    }

    if (url.pathname === "/api/snapshot/players" && req.method === "GET") {
      return this.json(res, 200, this.core.runtimeState.getPlayers());
    }

    if (url.pathname === "/api/snapshot/squads" && req.method === "GET") {
      return this.json(res, 200, this.core.runtimeState.getSquads());
    }

    if (url.pathname === "/api/snapshot/match" && req.method === "GET") {
      return this.json(res, 200, this.core.runtimeState.getMatch());
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
        if (!this.requireSuperAdmin(user, res)) return;
        const body = await this.readJsonBody(req);
        return this.json(res, 200, await pluginSubscriptions.setSubscribed(body.id, body.subscribed));
      }

      if (url.pathname === "/api/plugin-subscriptions/toggle" && req.method === "POST") {
        if (!this.requireSuperAdmin(user, res)) return;
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
        serverId: body.serverId ?? url.searchParams.get("serverId") ?? this.core.webStatus.serverId,
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
        events: combatManager.getEvents?.({
          serverId,
          limit: url.searchParams.get("limit") ?? "100",
          offset: url.searchParams.get("offset") ?? "0",
          type: url.searchParams.get("type") ?? "all",
          search: url.searchParams.get("q") ?? "",
        }) ?? [],
        overview: combatManager.getOverview?.(serverId) ?? null,
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
      if (!this.requireSuperAdmin(user, res)) return;
      const body = await this.readJsonBody(req);
      const job = await this.modules.playtime.refreshOnline({
        serverId: body.serverId ?? url.searchParams.get("serverId") ?? this.core.webStatus.serverId,
        force: Boolean(body.force ?? url.searchParams.get("force") === "true"),
      });
      const waitMs = Number(body.waitMs ?? 0);
      const payload = waitMs > 0
        ? await this.modules.playtime.waitForJob(job.id, waitMs)
        : this.modules.playtime.getJob(job.id);
      return this.json(res, 202, payload);
    }

    if (url.pathname === "/api/playtime/players/refresh" && req.method === "POST") {
      if (!this.requireSuperAdmin(user, res)) return;
      const body = await this.readJsonBody(req);
      const job = await this.modules.playtime.refreshPlayer(body);
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
      return this.json(res, 200, this.getConsoleChannels({
        stream: url.searchParams.get("stream") ?? "modules",
      }));
    }

    if (url.pathname === "/api/console/lines") {
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
      const result = await this.executeConsoleRconCommand(body.command, {
        requestedBy: "web.console",
        actor: user,
        system: false,
      });
      return this.json(res, result?.code === "Forbidden" ? 403 : result?.success ? 200 : 400, result);
    }

    if (url.pathname === "/api/console/rcon" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const result = await this.executeConsoleRconCommand(body.command, {
        requestedBy: "web.console",
        actor: user,
        system: false,
      });
      return this.json(res, result?.code === "Forbidden" ? 403 : result?.success ? 200 : 400, result);
    }

    // Compatibility endpoint used by some Vue client builds.
    if (url.pathname === "/api/rcon-command" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const result = await this.executeConsoleRconCommand(body.command, {
        requestedBy: "web.console",
        actor: user,
        system: false,
      });
      return this.json(res, result?.code === "Forbidden" ? 403 : result?.success ? 200 : 400, result);
    }

    // Compatibility endpoint for tank-battle status panel.
    if (url.pathname === "/api/auto-tank-battle/status" && req.method === "GET") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, {
        enabled: false,
        settings: {
          mapSwitchCommands: [],
        },
        source: "compat",
      });
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
      return this.json(res, 200, combatManager.getOverview(url.searchParams.get("serverId") ?? ""));
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
        events: combatManager.getEvents({
          type: url.searchParams.get("type") ?? "all",
          search: url.searchParams.get("search") ?? url.searchParams.get("q") ?? "",
          limit: url.searchParams.get("limit") ?? "300",
          offset: url.searchParams.get("offset") ?? "0",
          serverId: url.searchParams.get("serverId") ?? "",
          mode: url.searchParams.get("mode") ?? "",
          playerKey: url.searchParams.get("playerKey") ?? "",
        }),
        overview: combatManager.getOverview(url.searchParams.get("serverId") ?? ""),
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
        events: combatManager.getPlayerEvents?.(url.searchParams.get("serverId") ?? "", {
          steam64ID: url.searchParams.get("steam64ID") ?? url.searchParams.get("steamID") ?? "",
          eosID: url.searchParams.get("eosID") ?? "",
          controllerID: url.searchParams.get("controllerID") ?? "",
          name: url.searchParams.get("name") ?? "",
          playerKey: url.searchParams.get("playerKey") ?? "",
        }, {
          limit: url.searchParams.get("limit") ?? "20",
          offset: url.searchParams.get("offset") ?? "0",
        }) ?? [],
        overview: combatManager.getOverview?.(url.searchParams.get("serverId") ?? "") ?? null,
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
        return this.json(res, 200, battleLog.getOverview?.(battleServerId));
      }

      if (url.pathname === "/api/battle-log/events" && req.method === "GET") {
        return this.json(res, 200, {
          events: battleLog.getEvents?.({
            serverId: battleServerId,
            type: url.searchParams.get("type") ?? "all",
            search: url.searchParams.get("search") ?? url.searchParams.get("q") ?? "",
            limit: url.searchParams.get("limit") ?? "300",
            offset: url.searchParams.get("offset") ?? "0",
            playerKey: url.searchParams.get("playerKey") ?? url.searchParams.get("player") ?? "",
          }) ?? [],
          overview: battleLog.getOverview?.(battleServerId) ?? null,
        });
      }

      if (url.pathname === "/api/battle-log/player" && req.method === "GET") {
        return this.json(res, 200, battleLog.getPlayerStats?.(battleServerId, {
          q: url.searchParams.get("q") ?? url.searchParams.get("search") ?? "",
          playerKey: url.searchParams.get("playerKey") ?? "",
          steam64ID: url.searchParams.get("steam64ID") ?? url.searchParams.get("steamID") ?? "",
          eosID: url.searchParams.get("eosID") ?? "",
          controllerID: url.searchParams.get("controllerID") ?? "",
          name: url.searchParams.get("name") ?? "",
        }));
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

    if (url.pathname.startsWith("/api/plugins/stepwise-squad-playtime-guard")) {
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

    if (url.pathname.startsWith("/api/plugins/lianban-kick")) {
      const pluginApi = this.getPluginApi("plugin.lianbanKick");
      if (!pluginApi) {
        return this.json(res, 404, {
          error: "LianbanKickUnavailable",
          message: "Lianban kick plugin is not loaded.",
        });
      }

      if (url.pathname === "/api/plugins/lianban-kick/state" && req.method === "GET") {
        return this.json(res, 200, {
          ok: true,
          data: pluginApi.getState?.() ?? null,
        });
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
        await this.modules.playerDatabase.syncOnline(url.searchParams.get("serverId") ?? this.core.webStatus.serverId),
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

    if (dbPlayerMatch && req.method === "DELETE") {
      if (!this.requireSuperAdmin(user, res)) return;
      return this.json(res, 200, await this.modules.playerDatabase.deletePlayer(dbPlayerMatch[1]));
    }

    if (url.pathname === "/api/squads/list") {
      const serverId = url.searchParams.get("serverId") ?? this.core.webStatus.serverId;
      const squadManagement = this.modules.squadManagement;
      return this.json(res, 200, {
        squads: squadManagement?.getSquads?.(serverId) ?? [],
      });
    }

    if (url.pathname === "/api/squad-lifecycle/current" && req.method === "GET") {
      const serverId = url.searchParams.get("serverId") ?? this.core.webStatus.serverId;
      const lifecycle = this.modules.squadLifecycle?.getCurrent?.(serverId);
      return this.json(res, 200, {
        current: lifecycle ?? {
          serverId,
          matchId: null,
          updatedAt: new Date().toISOString(),
          list: [],
          byKey: {},
        },
      });
    }

    if (url.pathname === "/api/kills/recent") {
      const serverId = url.searchParams.get("serverId") ?? this.core.webStatus.serverId;
      const records = this.modules.combatManager?.getEvents
        ? this.modules.combatManager.getEvents({
            serverId,
            type: url.searchParams.get("type") ?? "all",
            search: url.searchParams.get("search") ?? "",
            limit: url.searchParams.get("limit") ?? "100",
          })
        : this.modules.killManage?.getRecentKills?.(serverId, 100) ?? [];
      return this.json(res, 200, {
        records,
        viewer: {
          username: user.username,
          role: user.role,
          isSuperAdmin: this.core.authManager.hasEverything(user),
        },
      });
    }

    if (url.pathname === "/api/weapon-collector/stats" && req.method === "GET") {
      const pluginApi = this.getPluginApi("plugin.weaponCollector");
      if (!pluginApi) {
        return this.json(res, 404, { error: "WeaponCollectorNotLoaded" });
      }
      const serverId = url.searchParams.get("serverId") ?? this.core.webStatus.serverId;
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
        const result = await api.executeAction({
          ...body,
          actor: user,
          type: "remove_from_squad",
          source: body.source ?? "web.squadRemove",
          system: Boolean(body.system ?? false),
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
        const result = await api.warnPlayer({ ...body, actor: user, system: false });
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
        const result = await api.broadcastMessage({ ...body, actor: user, system: false });
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

    if (url.pathname === "/api/server-stats/history" && req.method === "GET") {
      const api = this.modules.serverStats;
      if (!api?.getHistory) {
        return this.json(res, 404, {
          error: "ServerStatsUnavailable",
          message: "Server stats module is not loaded.",
        });
      }

      return this.json(res, 200, await api.getHistory({
        serverId: url.searchParams.get("server_id") ?? url.searchParams.get("serverId") ?? this.core.webStatus.serverId,
        fromMs: url.searchParams.get("from_ms") ?? url.searchParams.get("fromMs"),
        toMs: url.searchParams.get("to_ms") ?? url.searchParams.get("toMs"),
        includeCurrent: (url.searchParams.get("include_current") ?? url.searchParams.get("includeCurrent")) === "1",
      }));
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
        serverId: url.searchParams.get("server_id") ?? url.searchParams.get("serverId") ?? this.core.webStatus.serverId,
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
          serverId: url.searchParams.get("server_id") ?? url.searchParams.get("serverId") ?? this.core.webStatus.serverId,
        }),
      });
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
      });
  }

  async getJob(jobId, { waitMs = 0 } = {}) {
    const localJob = this.jobs.get(String(jobId ?? ""));
    if (localJob) return { ...localJob };

    if (this.modules.playtime?.waitForJob && Number(waitMs) > 0) {
      return this.modules.playtime.waitForJob(jobId, waitMs);
    }
    return this.modules.playtime?.getJob?.(jobId) ?? null;
  }

  async serveStatic(url, res) {
    let filePath = url.pathname === "/" ? "/index.html" : url.pathname;

    filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
    const abs = path.join(this.staticDirectory, filePath);

    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) {
        return this.serveIndex(res);
      }

      const data = await fs.readFile(abs);
      res.writeHead(200, {
        "Content-Type": contentType(abs),
        "Cache-Control": "no-store",
      });
      res.end(data);
    } catch {
      return this.serveIndex(res);
    }
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
    const data = JSON.stringify(obj, null, 2);
    const durationMs = performance.now() - start;
    const sizeBytes = Buffer.byteLength(data);

    const performanceConfig = this.core?.config?.get?.("performance") ?? {};
    const largeJsonBytes = performanceConfig.largeJsonBytes ?? 262144;
    const slowJsonMs = performanceConfig.slowJsonMs ?? 50;

    if (sizeBytes > largeJsonBytes || durationMs > slowJsonMs) {
      const store = requestStorage.getStore();
      const urlStr = store?.req?.url ?? "unknown";
      this.logger?.warn(`[large-slow-json] url=${urlStr} sizeBytes=${sizeBytes} durationMs=${durationMs.toFixed(2)}ms`);
    }

    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    });
    res.end(data);
  }

  getRequestIp(req) {
    return req.socket?.remoteAddress ?? "";
  }

  async handleUpgrade(req, socket, head) {
    try {
      this.enforceHost(req);
      this.requireSecureRequest(req);
      this.requireAllowedOrigin(req);
    } catch (error) {
      return this.rejectUpgrade(socket, error.statusCode ?? 403, error.message);
    }

    const url = this.parseInternalUrl(req.url);
    const connectionKind = url.pathname === "/ws/console"
      ? "console"
      : url.pathname === "/ws/chat"
        ? "chat"
        : null;

    if (!connectionKind) {
      return this.rejectUpgrade(socket, 404, "Not Found");
    }

    const user = this.core.authManager?.getUserFromRequest(req);
    if (!user) {
      return this.rejectUpgrade(socket, 401, "Authentication required.");
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
    socket.write(Buffer.concat([header, body]));
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

  canManagePlugins(user) {
    if (this.core.authManager?.hasEverything?.(user)) return true;
    const permissions = user?.permissions ?? user?.permission ?? [];
    if (Array.isArray(permissions)) return permissions.includes("plugins.manage");
    if (permissions && typeof permissions === "object") return Boolean(permissions["plugins.manage"]);
    return false;
  }

  requireSuperAdmin(user, res) {
    if (!this.core.authManager?.hasEverything?.(user)) {
      this.json(res, 403, {
        error: "Forbidden",
        message: "SuperAdmin permission is required.",
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
    case 421:
      return "Misdirected Request";
    case 426:
      return "Upgrade Required";
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

function normalizePlaytimeRow(row) {
  const steamSeconds = Number(row?.steam_game_seconds ?? row?.steamGameSeconds ?? row?.steam_seconds ?? row?.steamSeconds ?? row?.game_seconds ?? row?.gameSeconds ?? 0);
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
    fetchedAt: Number(row?.fetched_at ?? row?.fetchedAt ?? 0) || null,
    lastSeenName: row?.last_seen_name ?? row?.lastSeenName ?? null,
    steam_avatar: row?.steam_avatar ?? row?.steamAvatar ?? null,
    steamAvatar: row?.steam_avatar ?? row?.steamAvatar ?? null,
  };
}
