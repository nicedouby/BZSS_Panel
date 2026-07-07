// -*- coding: utf-8 -*-

import http from "node:http";
import { cleanSnapshotAllForClient, cleanPlayersForClient, cleanSquadsForClient } from "../core/web-server.js";
import { WebServer } from "../core/web-server.js";
import {
  createHttpError,
  createJsonResponse,
  normalizeCoreControlConfig,
  parseRevisionQuery,
  readJsonRequestBody,
} from "./core-control-protocol.js";

export class CoreControlServer {
  constructor({ config, logger, core, modules }) {
    this.config = normalizeCoreControlConfig(config, process.env);
    this.logger = logger;
    this.core = core;
    this.modules = modules;
    this.server = null;
    this.consoleSubscribers = new Set();
    this.tacticalSubscribers = new Set();
    this.consoleUnsubscribe = null;
    this.tacticalUnsubscribe = null;
    this.internalProxyServer = new WebServer({
      config: {
        enabled: false,
      },
      logger: this.logger,
      core: this.core,
      modules: this.modules,
      coreClient: null,
    });
  }

  get baseUrl() {
    return `http://${this.config.host}:${this.config.port}`;
  }

  async start() {
    if (!this.config.enabled) return;
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        this.logger?.warn?.(`Core control request failed: ${error?.message ?? error}`, {
          operation: "coreControl.requestFailed",
          data: {
            path: req.url,
            code: error?.code ?? "InternalServerError",
            statusCode: error?.statusCode ?? 500,
          },
        });
        createJsonResponse(res, error?.statusCode ?? 500, {
          ok: false,
          error: error?.code ?? "InternalServerError",
          message: error?.message ?? "Internal server error.",
        });
      });
    });

    this.bindRealtimeSources();

    await new Promise((resolve) => {
      this.server.listen(this.config.port, this.config.host, resolve);
    });

    this.logger?.info?.(`CoreControlServer listening on ${this.baseUrl}`, {
      scope: "app",
      source: "coreControl",
    });
  }

  async stop() {
    if (typeof this.consoleUnsubscribe === "function") {
      this.consoleUnsubscribe();
      this.consoleUnsubscribe = null;
    }
    if (typeof this.tacticalUnsubscribe === "function") {
      this.tacticalUnsubscribe();
      this.tacticalUnsubscribe = null;
    }
    for (const client of this.consoleSubscribers) {
      try {
        client.end();
      } catch {}
    }
    this.consoleSubscribers.clear();
    for (const client of this.tacticalSubscribers) {
      try {
        client.end();
      } catch {}
    }
    this.tacticalSubscribers.clear();
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
  }

  bindRealtimeSources() {
    if (this.core.console?.subscribe) {
      this.consoleUnsubscribe = this.core.console.subscribe((entry) => {
        this.broadcastSse(this.consoleSubscribers, { type: "console", item: entry });
      });
    }
    if (this.modules.tacticalStateV2?.subscribe) {
      this.tacticalUnsubscribe = this.modules.tacticalStateV2.subscribe((payload) => {
        this.broadcastSse(this.tacticalSubscribers, payload);
      });
    }
  }

  async handleRequest(req, res) {
    const url = new URL(req.url, this.baseUrl);
    this.authorize(req);

    if (url.pathname === "/internal/health" && req.method === "GET") {
      return createJsonResponse(res, 200, this.buildHealthPayload());
    }

    if (url.pathname === "/internal/snapshot/all" && req.method === "GET") {
      const snapshot = cleanSnapshotAllForClient(this.core.runtimeState.getAll());
      const since = parseRevisionQuery(url.searchParams.get("since"));
      const delta = buildSnapshotDelta(snapshot, since);
      if (delta.notModified) {
        res.writeHead(204, { "Cache-Control": "no-store" });
        res.end();
        return;
      }
      return createJsonResponse(res, 200, delta);
    }

    if (url.pathname === "/internal/snapshot/server" && req.method === "GET") {
      return createJsonResponse(res, 200, this.core.runtimeState.getServer());
    }

    if (url.pathname === "/internal/snapshot/players" && req.method === "GET") {
      return createJsonResponse(res, 200, cleanPlayersForClient(this.core.runtimeState.getPlayers()));
    }

    if (url.pathname === "/internal/snapshot/squads" && req.method === "GET") {
      return createJsonResponse(res, 200, cleanSquadsForClient(this.core.runtimeState.getSquads()));
    }

    if (url.pathname === "/internal/tactical-state-v2/snapshot" && req.method === "GET") {
      const snapshot = await this.modules.tacticalStateV2?.getSnapshot?.() ?? null;
      return createJsonResponse(res, 200, { ok: true, snapshot });
    }

    if (url.pathname === "/internal/tactical-state-v2/stream" && req.method === "GET") {
      const snapshot = await this.modules.tacticalStateV2?.getSnapshot?.() ?? null;
      this.openSse(res, this.tacticalSubscribers, {
        type: "snapshot",
        revision: snapshot?.meta?.revision ?? 0,
        snapshot,
      });
      req.on("close", () => {
        this.tacticalSubscribers.delete(res);
      });
      return;
    }

    if (url.pathname === "/internal/console/recent" && req.method === "GET") {
      return createJsonResponse(res, 200, {
        items: this.core.console?.getRecent?.({
          limit: url.searchParams.get("limit") ?? "500",
          channel: url.searchParams.get("channel") ?? "",
          level: url.searchParams.get("level") ?? "",
          source: url.searchParams.get("source") ?? "",
          keyword: url.searchParams.get("keyword") ?? "",
        }) ?? [],
      });
    }

    if (url.pathname === "/internal/console/recent/stream" && req.method === "GET") {
      const items = this.core.console?.getRecent?.({
        limit: url.searchParams.get("limit") ?? "200",
      }) ?? [];
      this.openSse(res, this.consoleSubscribers, {
        type: "bootstrap",
        items,
      });
      req.on("close", () => {
        this.consoleSubscribers.delete(res);
      });
      return;
    }

    if (url.pathname === "/internal/rcon/status" && req.method === "GET") {
      return createJsonResponse(res, 200, this.core.rconManager?.getStatus?.() ?? {});
    }

    if (url.pathname === "/internal/rcon/dispatch" && req.method === "POST") {
      const body = await readJsonRequestBody(req);
      const command = String(body.command ?? "").trim();
      if (!command) {
        throw createHttpError(400, "MissingCommand", "command is required.");
      }
      const result = await this.executeConsoleRconCommand(command, {
        requestedBy: body.requestedBy ?? "coreControl",
        actor: body.actor ?? null,
        system: false,
      });
      return createJsonResponse(res, result?.success ? 200 : 400, result);
    }

    if (url.pathname === "/internal/server/warmup") {
      if (req.method === "GET") {
        return createJsonResponse(res, 200, this.core.webStatus?.getWarmupState?.() ?? null);
      }
      if (req.method === "POST") {
        const body = await readJsonRequestBody(req);
        if (typeof body.isWarmup !== "boolean") {
          throw createHttpError(400, "InvalidRequestBody", "isWarmup must be a boolean.");
        }
        const result = await this.core.webStatus?.setWarmup?.(body.isWarmup, {
          updatedBy: body.actor?.username ?? null,
        });
        return createJsonResponse(res, 200, result);
      }
    }

    if (url.pathname === "/internal/log-clock/set" && req.method === "POST") {
      const body = await readJsonRequestBody(req);
      const next = this.core.webStatus?.setLogClockSeconds?.(Number(body.seconds ?? body.value ?? 0), {
        reason: body.reason ?? "manual",
      }) ?? null;
      return createJsonResponse(res, 200, {
        ok: true,
        logClockSeconds: next,
      });
    }

    if (url.pathname === "/internal/log-clock/reset" && req.method === "POST") {
      const next = this.core.webStatus?.resetLogClock?.({
        reason: "manual",
      }) ?? null;
      return createJsonResponse(res, 200, {
        ok: true,
        logClockSeconds: next,
      });
    }

    if (url.pathname === "/internal/plugins" && req.method === "GET") {
      return this.proxyLegacyApi("/api/plugins", req, res);
    }

    if (url.pathname.startsWith("/internal/plugin-subscriptions")) {
      return this.proxyLegacyApi(url.pathname.replace("/internal", "/api"), req, res);
    }

    if (url.pathname.startsWith("/internal/plugins/")) {
      return this.proxyLegacyApi(url.pathname.replace("/internal", "/api"), req, res);
    }

    if (url.pathname === "/internal/weapon-collector/clear" && req.method === "POST") {
      return this.proxyLegacyApi("/api/weapon-collector/clear", req, res, url.search);
    }

    if (url.pathname.startsWith("/internal/tactical-map-replay/")) {
      return this.proxyLegacyApi(url.pathname.replace("/internal", "/api"), req, res, url.search);
    }

    if (url.pathname.startsWith("/internal/remote-telemetry/")) {
      return this.proxyLegacyApi(url.pathname.replace("/internal", "/api"), req, res, url.search);
    }

    if (url.pathname.startsWith("/internal/chat/")) {
      return this.proxyLegacyApi(url.pathname.replace("/internal", "/api"), req, res, url.search);
    }

    if (url.pathname.startsWith("/internal/combat-manager/")) {
      return this.proxyLegacyApi(url.pathname.replace("/internal", "/api"), req, res, url.search);
    }

    if (url.pathname.startsWith("/internal/combat-logs/")) {
      return this.proxyLegacyApi(url.pathname.replace("/internal", "/api"), req, res, url.search);
    }

    if (url.pathname.startsWith("/internal/battle-log/")) {
      return this.proxyLegacyApi(url.pathname.replace("/internal", "/api"), req, res, url.search);
    }

    if (url.pathname === "/internal/logpost/state" && req.method === "GET") {
      return this.proxyLegacyApi("/api/logpost/state", req, res);
    }

    if (url.pathname === "/internal/logpost/raw" && req.method === "GET") {
      return this.proxyLegacyApi("/api/logpost/raw", req, res, url.search);
    }

    if (url.pathname === "/internal/logpost/events" && req.method === "GET") {
      return this.proxyLegacyApi("/api/logpost/events", req, res, url.search);
    }

    if (url.pathname === "/internal/logpost/gaps" && req.method === "GET") {
      return this.proxyLegacyApi("/api/logpost/gaps", req, res);
    }

    if (url.pathname === "/internal/logpost/v2/outbox" && req.method === "GET") {
      return this.proxyLegacyApi("/api/logpost/v2/outbox", req, res, url.search);
    }

    if (url.pathname === "/internal/logpost/v2/safety" && req.method === "GET") {
      return this.proxyLegacyApi("/api/logpost/v2/safety", req, res, url.search);
    }

    if (url.pathname === "/internal/logpost/v2/replay" && req.method === "POST") {
      return this.proxyLegacyApi("/api/logpost/v2/replay", req, res);
    }

    if (url.pathname === "/internal/logpost/v2/checkpoint/repair" && req.method === "POST") {
      return this.proxyLegacyApi("/api/logpost/v2/checkpoint/repair", req, res);
    }

    throw createHttpError(404, "NotFound", "Internal route not found.");
  }

  async proxyLegacyApi(apiPath, req, res, search = "") {
    const proxiedReq = req;
    proxiedReq.url = `${apiPath}${search ?? ""}`;
    proxiedReq.headers = {
      ...(req.headers ?? {}),
      host: req.headers?.host ?? `${this.config.host}:${this.config.port}`,
    };

    const proxyRes = {
      writeHead: (statusCode, headers = {}) => {
        res.writeHead(statusCode, headers);
      },
      end: (body = "") => {
        res.end(body);
      },
      write: (chunk) => res.write(chunk),
    };

    const restoreAuth = this.attachInternalAuthContext();
    try {
      await this.internalProxyServer.handleRequest(proxiedReq, proxyRes);
    } finally {
      restoreAuth?.();
    }
  }

  attachInternalAuthContext() {
    if (!this.core.authManager) return () => {};
    const authManager = this.core.authManager;
    const original = {
      getUserFromRequest: authManager.getUserFromRequest,
      hasEverything: authManager.hasEverything,
      hasPermission: authManager.hasPermission,
    };
    authManager.getUserFromRequest = () => INTERNAL_SUPER_ADMIN_USER;
    authManager.hasEverything = () => true;
    authManager.hasPermission = () => true;
    return () => {
      authManager.getUserFromRequest = original.getUserFromRequest;
      authManager.hasEverything = original.hasEverything;
      authManager.hasPermission = original.hasPermission;
    };
  }

  authorize(req) {
    const expected = this.config.token;
    if (!expected) return;
    const actual = String(req.headers.authorization ?? "").trim();
    if (actual === `Bearer ${expected}`) return;
    throw createHttpError(401, "Unauthorized", "Missing or invalid bearer token.");
  }

  buildHealthPayload() {
    const memory = process.memoryUsage();
    const runtime = this.core.runtimeState?.getAll?.() ?? null;
    const rconStatus = this.core.rconManager?.getStatus?.() ?? {};
    const bzssSnapshot = this.modules.bzssCoreMonitor?.getState?.() ?? this.modules.bzssCoreMonitor?.getRawSnapshot?.() ?? {};
    const metrics = this.core.performanceMonitor?.getSnapshot?.() ?? {};
    return {
      ok: true,
      role: "core",
      uptimeMs: Math.floor(process.uptime() * 1000),
      eventLoopLagMs: Number(metrics.eventLoopLagMs ?? 0),
      memory: {
        rssMb: Math.round((memory.rss / 1024 / 1024) * 10) / 10,
        heapUsedMb: Math.round((memory.heapUsed / 1024 / 1024) * 10) / 10,
      },
      rcon: {
        connected: Boolean(rconStatus.connected),
        queueSize: Number(rconStatus.queueSize ?? 0),
        lastPlayersRefresh: rconStatus.lastPlayersRefresh ?? rconStatus.lastPlayersRefreshAt ?? "",
      },
      bzssCore: {
        status: bzssSnapshot.status ?? "unknown",
        revision: Number(bzssSnapshot.revision ?? 0),
        playerCount: Number(bzssSnapshot.playerCount ?? 0),
        lastUpdatedAt: bzssSnapshot.updatedAt ?? "",
      },
      revisions: runtime?.revisions ?? {},
    };
  }

  openSse(res, bucket, firstPayload) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    bucket.add(res);
    res.write(`data: ${JSON.stringify(firstPayload)}\n\n`);
  }

  broadcastSse(bucket, payload) {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of bucket) {
      try {
        res.write(data);
      } catch {
        bucket.delete(res);
      }
    }
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
      status: "failed",
    };
  }
}

const INTERNAL_SUPER_ADMIN_USER = {
  id: "__core_control__",
  username: "core-control",
  role: "SuperAdmin",
  isSuperAdmin: true,
};

function buildSnapshotDelta(snapshot, since = {}) {
  const revisions = snapshot?.revisions ?? {};
  const patch = {};
  const sections = ["server", "players", "squads", "rcon", "jobs"];
  let changed = false;

  for (const key of sections) {
    const nextRevision = Number(revisions[key] ?? 0);
    const prevRevision = Number(since[key] ?? -1);
    if (nextRevision !== prevRevision) {
      changed = true;
      patch[key] = snapshot?.[key] ?? null;
    } else {
      patch[key] = null;
    }
  }

  return {
    ok: true,
    notModified: !changed,
    revisions,
    patch,
    snapshot: changed ? snapshot : undefined,
  };
}
