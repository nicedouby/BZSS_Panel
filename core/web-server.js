// -*- coding: utf-8 -*-

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Core: WebServer
 *
 * 负责：
 * - 静态文件服务 web/
 * - Web API
 *
 * 不负责：
 * - 业务判断
 * - RCON 操作
 * - 插件逻辑
 */
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
        this.logger.error(`Web request failed: ${error.stack ?? error}`);
        this.json(res, 500, { error: "InternalServerError" });
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
    if (url.pathname === "/api/web/pages") {
      return this.json(res, 200, {
        pages: this.core.webRegistry.getPages(),
      });
    }

    if (url.pathname === "/api/web/status") {
      return this.json(res, 200, this.core.webStatus.getSnapshot());
    }

    if (url.pathname === "/api/match/overview") {
      return this.json(res, 200, this.modules.matchState.getOverview());
    }

    if (url.pathname === "/api/console/lines") {
      return this.json(res, 200, {
        lines: this.modules.console.getLines(),
      });
    }

    if (url.pathname === "/api/player-database/list") {
      return this.json(res, 200, {
        players: this.modules.playerDatabase.listPlayers(),
      });
    }

    if (url.pathname === "/api/squads/list") {
      const serverId = url.searchParams.get("serverId") ?? this.core.webStatus.serverId;
      return this.json(res, 200, {
        squads: this.modules.squadState.getSquads(serverId),
      });
    }

    if (url.pathname === "/api/kills/recent") {
      const serverId = url.searchParams.get("serverId") ?? this.core.webStatus.serverId;
      return this.json(res, 200, {
        records: this.modules.killManage.getRecentKills(serverId, 100),
      });
    }

    return this.json(res, 404, { error: "ApiNotFound" });
  }

  async serveStatic(url, res) {
    let filePath = url.pathname === "/" ? "/index.html" : url.pathname;

    // 避免路径穿越。
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

  json(res, status, obj) {
    const data = JSON.stringify(obj, null, 2);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(data);
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
