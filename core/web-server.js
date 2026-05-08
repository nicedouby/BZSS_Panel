// -*- coding: utf-8 -*-

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

export class WebServer {
  constructor({ config, logger, core, modules }) {
    this.enabled = config.enabled ?? true;
    this.host = config.host ?? "127.0.0.1";
    this.port = Number(config.port ?? 7799);
    this.staticDirectory = path.resolve(process.cwd(), config.staticDirectory ?? "./web");

    this.logger = logger;
    this.core = core;
    this.modules = modules;
    this.server = null;
  }

  async start() {
    if (!this.enabled) {
      this.logger.info("WebServer disabled.");
      return;
    }

    this.server = http.createServer((req, res) => {
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

    await new Promise((resolve) => {
      this.server.listen(this.port, this.host, resolve);
    });

    this.logger.info(`WebServer listening on http://${this.host}:${this.port}`);
  }

  async stop() {
    if (!this.server) return;

    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
  }

  async handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      return this.handleApi(url, req, res);
    }

    return this.serveStatic(url, res);
  }

  async handleApi(url, req, res) {
    if (url.pathname === "/api/auth/session") {
      const user = this.core.authManager?.getUserFromRequest(req) ?? null;
      return this.json(res, 200, {
        authenticated: Boolean(user),
        user,
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
      const expiredCookie = this.core.authManager.logout(req);
      return this.json(res, 200, {
        ok: true,
        authenticated: false,
      }, {
        "Set-Cookie": expiredCookie,
      });
    }

    const user = this.core.authManager?.getUserFromRequest(req);
    if (!user) {
      return this.json(res, 401, {
        error: "Unauthorized",
        message: "Authentication required.",
      });
    }

    if (url.pathname === "/api/web/pages") {
      return this.json(res, 200, { pages: this.core.webRegistry.getPages() });
    }

    if (url.pathname === "/api/web/status") {
      return this.json(res, 200, this.core.webStatus.getSnapshot());
    }

    if (url.pathname.startsWith("/api/plugin-subscriptions")) {
      if (!this.canManagePlugins(user)) {
        return this.json(res, 403, {
          error: "Forbidden",
          message: "plugins.manage permission is required.",
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

    if (url.pathname === "/api/match/overview") {
      return this.json(res, 200, this.modules.matchState.getOverview());
    }

    if (url.pathname === "/api/console/channels") {
      return this.json(res, 200, { channels: this.modules.console.getChannels() });
    }

    if (url.pathname === "/api/console/lines") {
      return this.json(res, 200, {
        lines: this.modules.console.getLines({
          channel: url.searchParams.get("channel") ?? "all",
          afterSeq: url.searchParams.get("afterSeq") ?? "0",
          limit: url.searchParams.get("limit") ?? "300",
          q: url.searchParams.get("q") ?? "",
        }),
      });
    }

    if (url.pathname === "/api/console/rcon" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const result = await this.modules.console.executeRconCommand(body.command, {
        requestedBy: "web.console",
      });
      return this.json(res, 200, result);
    }

    if (url.pathname === "/api/rcon/status") {
      return this.json(res, 200, this.core.rconManager.getStatus());
    }

    if (url.pathname === "/api/rcon/refresh") {
      const type = url.searchParams.get("type") ?? "all";
      const result = {};

      if (type === "players" || type === "all") {
        result.players = await this.core.rconManager.refreshPlayers();
      }

      if (type === "squads" || type === "all") {
        result.squads = await this.core.rconManager.refreshSquads();
      }

      return this.json(res, 200, result);
    }

    if (url.pathname === "/api/combat/overview") {
      return this.json(res, 200, this.modules.combatState.getOverview());
    }

    if (url.pathname === "/api/combat/events") {
      return this.json(res, 200, {
        events: this.modules.combatState.getEvents({
          type: url.searchParams.get("type") ?? "all",
          search: url.searchParams.get("search") ?? "",
          limit: url.searchParams.get("limit") ?? "300",
        }),
        overview: this.modules.combatState.getOverview(),
      });
    }

    if (url.pathname === "/api/combat/clear" && req.method === "POST") {
      return this.json(res, 200, this.modules.combatState.clear());
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
      const detail = await this.modules.playerDatabase.getPlayerDetail(url.searchParams.get("id"));
      if (!detail) return this.json(res, 404, { error: "PlayerNotFound" });
      return this.json(res, 200, detail);
    }

    if (url.pathname === "/api/player-database/sync-online" && req.method === "POST") {
      return this.json(
        res,
        200,
        await this.modules.playerDatabase.syncOnline(url.searchParams.get("serverId") ?? this.core.webStatus.serverId),
      );
    }

    if (url.pathname === "/api/db/stats") {
      return this.json(res, 200, await this.modules.playerDatabase.getStats({
        top: url.searchParams.get("top") ?? "10",
        days: url.searchParams.get("days") ?? "14",
      }));
    }

    if (url.pathname === "/api/db/players") {
      const result = await this.modules.playerDatabase.listPlayers({
        query: url.searchParams.get("query") ?? "",
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
      const body = await this.readJsonBody(req);
      return this.json(res, 200, await this.modules.playerDatabase.setPermissionGroup(dbPermissionMatch[1], body.permissionGroup));
    }

    if (url.pathname === "/api/db/reset-kill-stats" && req.method === "POST") {
      return this.json(res, 200, await this.modules.playerDatabase.resetKillStats());
    }

    if (dbPlayerMatch && req.method === "DELETE") {
      return this.json(res, 200, await this.modules.playerDatabase.deletePlayer(dbPlayerMatch[1]));
    }

    if (url.pathname === "/api/squads/list") {
      const serverId = url.searchParams.get("serverId") ?? this.core.webStatus.serverId;
      return this.json(res, 200, { squads: this.modules.squadState.getSquads(serverId) });
    }

    if (url.pathname === "/api/squads/creation-order") {
      const serverId = url.searchParams.get("serverId") ?? this.core.webStatus.serverId;
      const sessionId = url.searchParams.get("sessionId");
      const records = sessionId
        ? this.modules.squadCreationOrder.getOrderBySession(serverId, sessionId)
        : this.modules.squadCreationOrder.getCurrentOrder(serverId);

      return this.json(res, 200, { serverId, sessionId: sessionId ?? null, records });
    }

    if (url.pathname === "/api/kills/recent") {
      const serverId = url.searchParams.get("serverId") ?? this.core.webStatus.serverId;
      const records = this.modules.combatState
        ? this.modules.combatState.getEvents({
            type: url.searchParams.get("type") ?? "all",
            search: url.searchParams.get("search") ?? "",
            limit: url.searchParams.get("limit") ?? "100",
          })
        : this.modules.killManage.getRecentKills(serverId, 100);
      return this.json(res, 200, {
        records,
        viewer: {
          username: user.username,
          role: user.role,
          isSuperAdmin: this.core.authManager.hasEverything(user),
        },
      });
    }

    return this.json(res, 404, { error: "ApiNotFound" });
  }

  async readJsonBody(req) {
    const chunks = [];

    for await (const chunk of req) {
      chunks.push(chunk);
      const total = chunks.reduce((sum, item) => sum + item.length, 0);
      if (total > 1024 * 1024) {
        throw new Error("Request body too large.");
      }
    }

    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (!text) return {};

    return JSON.parse(text);
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
      res.writeHead(200, { "Content-Type": contentType(abs) });
      res.end(data);
    } catch {
      return this.serveIndex(res);
    }
  }

  async serveIndex(res) {
    const indexPath = path.join(this.staticDirectory, "index.html");
    const data = await fs.readFile(indexPath);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  }

  json(res, status, obj, extraHeaders = {}) {
    const data = JSON.stringify(obj, null, 2);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    });
    res.end(data);
  }

  getRequestIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      return forwarded.split(",")[0].trim();
    }
    return req.socket?.remoteAddress ?? "";
  }

  canManagePlugins(user) {
    if (this.core.authManager?.hasEverything?.(user)) return true;
    const permissions = user?.permissions ?? user?.permission ?? [];
    if (Array.isArray(permissions)) return permissions.includes("plugins.manage");
    if (permissions && typeof permissions === "object") return Boolean(permissions["plugins.manage"]);
    return false;
  }
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}
