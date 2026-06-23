import crypto from "node:crypto";

export function createPublicInterfaceModule({ config, logger, core, modules }) {
  const instance = new PublicInterface({ config, logger, core, modules });
  return {
    manifest: instance.manifest,
    apiName: instance.apiName,
    api: instance.api,
    async start() {
      return instance.start();
    },
    async stop() {
      return instance.stop();
    }
  };
}

class PublicInterface {
  constructor({ config, logger, core, modules }) {
    this.manifest = {
      id: "module.publicInterface",
      name: "Public Interface",
      description: "Provides a read-only public HTTP/WS API for external integration",
      version: "1.0.0",
    };
    this.apiName = "publicInterface";
    this.config = config;
    this.logger = logger;
    this.core = core;
    this.modules = modules;

    this.rateLimitMap = new Map();

    this.api = {
      getPathPrefix: () => this.getPathPrefix(),
      handleHttp: (ctx) => this.handleHttp(ctx),
      handleUpgrade: (ctx) => this.handleUpgrade(ctx),
      getPublicServerSnapshot: () => this.getPublicServerSnapshot(),
      getPublicServerSummary: () => this.getPublicServerSummary(),
      getPublicPlayersSnapshot: () => this.getPublicPlayersSnapshot(),
      getPublicSquadsSnapshot: () => this.getPublicSquadsSnapshot(),
      getPublicMatchSnapshot: () => this.getPublicMatchSnapshot(),
      getPublicTacticalSnapshot: () => this.getPublicTacticalSnapshot(),
      authorizeRequest: (req, requiredScope) => this.authorizeRequest(req, requiredScope),
      checkRateLimit: (ip) => this.checkRateLimit(ip),
    };
  }

  async start() {
    this.logger.info("Public interface module started.");
    
    // Periodically clean up rate limit map
    this.rateLimitCleaner = setInterval(() => {
      const now = Date.now();
      const cfg = this.getConfig();
      const windowMs = cfg.rateLimit?.windowMs ?? 60000;
      for (const [ip, data] of this.rateLimitMap.entries()) {
        if (now - data.resetTime >= windowMs) {
          this.rateLimitMap.delete(ip);
        }
      }
    }, 60000);
  }

  async stop() {
    if (this.rateLimitCleaner) {
      clearInterval(this.rateLimitCleaner);
      this.rateLimitCleaner = null;
    }
  }

  getConfig() {
    return this.config?.get?.("modules.publicInterface") ?? {
      enabled: false,
      pathPrefix: "/api/public/v1",
      wsPath: "/ws/public/v1",
      allowAnonymous: false,
      tokens: [],
      rateLimit: { windowMs: 60000, maxRequests: 120 },
      limits: { maxPlayers: 120, maxSquads: 60 },
      privacy: { includeSteamId: true, includeEosId: false, includeRawText: false },
      ws: { heartbeatMs: 25000, minPushIntervalMs: 500 }
    };
  }

  getPathPrefix() {
    return this.getConfig().pathPrefix ?? "/api/public/v1";
  }

  getWsPath() {
    return this.getConfig().wsPath ?? "/ws/public/v1";
  }

  checkRateLimit(ip) {
    const cfg = this.getConfig();
    const limit = cfg.rateLimit?.maxRequests ?? 120;
    const windowMs = cfg.rateLimit?.windowMs ?? 60000;
    const now = Date.now();

    if (!this.rateLimitMap.has(ip)) {
      this.rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
      return true;
    }

    const data = this.rateLimitMap.get(ip);
    if (now > data.resetTime) {
      data.count = 1;
      data.resetTime = now + windowMs;
      return true;
    }

    if (data.count >= limit) {
      return false;
    }

    data.count++;
    return true;
  }

  authorizeRequest(req, requiredScope) {
    const cfg = this.getConfig();

    if (requiredScope === null && cfg.allowAnonymous) {
      return true;
    }

    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return false;
    }

    const token = authHeader.substring(7).trim();
    if (!token) return false;

    const tokens = cfg.tokens ?? [];
    const matchedToken = tokens.find(t => t.token === token);
    
    if (!matchedToken) {
      return false;
    }

    if (!requiredScope) {
      return true;
    }

    if (Array.isArray(requiredScope)) {
      return requiredScope.every(scope => (matchedToken.scopes ?? []).includes(scope));
    }

    return (matchedToken.scopes ?? []).includes(requiredScope);
  }

  createResponse(data) {
    const serverId = this.core.webStatus?.serverId ?? "BZSS_Main";
    const revision = Date.now(); // Provide a simple revision
    return {
      ok: true,
      version: 1,
      serverId,
      revision,
      updatedAt: new Date().toISOString(),
      data
    };
  }

  createError(error, message) {
    const serverId = this.core.webStatus?.serverId ?? "BZSS_Main";
    return {
      ok: false,
      version: 1,
      serverId,
      revision: 0,
      updatedAt: new Date().toISOString(),
      error,
      message
    };
  }

  getPublicServerSummary() {
    const webStatus = this.core.webStatus?.getSnapshot?.() ?? {};
    const matchState = this.modules.matchState?.getState?.() ?? this.modules.matchState?.getOverview?.()?.matchState ?? {};
    const rconStatus = this.core.rconManager?.getStatus?.() ?? {};
    const serverStatus = matchState.serverStatus ?? {};
    const match = matchState.match ?? {};
    const players = Array.isArray(matchState.players?.list) ? matchState.players.list : [];

    const playerCount = firstFiniteNumber([
      webStatus.playerCount,
      serverStatus.playerCount,
      matchState.players?.count,
      players.length,
    ]);

    const queueCount = firstFiniteNumber([
      webStatus.queueCount,
      serverStatus.queueCount,
    ]);

    const tps = firstFiniteNumber([
      webStatus.tps,
      serverStatus.tps,
    ]);

    const rconTime = firstFiniteNumber([
      webStatus.playtime,
      serverStatus.playtime,
      match.playtime,
    ]);

    const currentMap = firstText([
      serverStatus.map,
      match.map,
      webStatus.map,
      webStatus.currentMap,
    ]);

    const currentLayer = firstText([
      serverStatus.layer,
      match.layer,
      webStatus.layer,
      webStatus.currentLayer,
    ]);

    const updatedAt = latestTimestamp([
      webStatus.updatedAt,
      matchState.updatedAt,
      rconStatus.lastPlayersRefresh,
      rconStatus.lastSquadsRefresh,
    ]);

    return {
      serverId: firstText([webStatus.serverId, this.core.webStatus?.serverId]),
      serverName: firstText([webStatus.serverName, this.core.webStatus?.serverName]),
      playerCount,
      queueCount,
      currentMap,
      currentLayer,
      tps,
      tpsStatus: firstKnownStatus([webStatus.tpsStatus, serverStatus.tpsStatus, "unknown"]),
      rconTime,
      updatedAt,
    };
  }

  getPublicServerSnapshot() {
    const snapshot = { ...(this.core.webStatus?.getSnapshot?.() ?? {}) };
    snapshot.summary = this.getPublicServerSummary();
    return snapshot;
  }

  maskPlayer(player) {
    const cfg = this.getConfig();
    const privacy = cfg.privacy ?? {};

    return {
      playerID: player.playerID,
      name: player.name,
      steamID: privacy.includeSteamId ? player.steamID : undefined,
      eosID: privacy.includeEosId ? player.eosID : undefined,
      teamID: player.teamID,
      squadID: player.squadID,
      role: player.role,
      isLeader: player.isLeader,
      state: player.state,
      lastSeenTime: player.lastSeenTime,
    };
  }

  getPublicPlayersSnapshot() {
    const matchState = this.modules.matchState?.getState?.() ?? {};
    const players = matchState.players?.list ?? [];
    return players.map(p => this.maskPlayer(p));
  }

  getPublicSquadsSnapshot() {
    const matchState = this.modules.matchState?.getState?.() ?? {};
    return matchState.squads?.list ?? [];
  }

  getPublicMatchSnapshot() {
    const overview = this.modules.matchState?.getOverview?.() ?? {};
    return overview.matchState ?? {};
  }

  getPublicTacticalSnapshot() {
    const tacticalPlayers = this.modules.bzssCoreMonitor?.getPlayers?.() ?? [];
    return tacticalPlayers.map(p => ({
      playerName: p.playerName,
      playerGuid: p.playerGuid,
      teamId: p.teamId,
      squadId: p.squadId,
      soldierInfo: p.soldierInfo ? {
        health: p.soldierInfo.health,
        soldierClass: p.soldierInfo.soldierClass,
        weaponClass: p.soldierInfo.weaponClass,
        position: p.soldierInfo.position,
        rotation: p.soldierInfo.rotation,
      } : null,
      vehicleInfo: p.vehicleInfo ? {
        vehicleType: p.vehicleInfo.vehicleType,
        health: p.vehicleInfo.health,
        maxHealth: p.vehicleInfo.maxHealth,
        position: p.vehicleInfo.position,
        rotation: p.vehicleInfo.rotation,
      } : null,
    }));
  }

  async handleHttp({ url, req, res, json, ip }) {
    const cfg = this.getConfig();
    if (!cfg.enabled) {
      return json(503, this.createError("ServiceUnavailable", "Public interface is disabled."));
    }

    if (!this.checkRateLimit(ip)) {
      return json(429, this.createError("TooManyRequests", "Rate limit exceeded."));
    }

    const pathPrefix = this.getPathPrefix();
    const endpoint = url.pathname.substring(pathPrefix.length);

    if (endpoint === "/health" || endpoint === "/health/") {
      if (!cfg.allowAnonymous && !this.authorizeRequest(req, null)) {
         // Only check if anonymous is allowed or if valid token is provided
         // But actually the spec says: "/health 可匿名，或只检查模块启用"
         // So if we just want to check if it's enabled, we return 200 directly.
      }
      return json(200, this.createResponse({ status: "ok" }));
    }

    const endpointMap = {
      "/server": { scope: "server:read", fetch: () => this.getPublicServerSnapshot() },
      "/players": { scope: "players:read", fetch: () => this.getPublicPlayersSnapshot() },
      "/squads": { scope: "squads:read", fetch: () => this.getPublicSquadsSnapshot() },
      "/match": { scope: "match:read", fetch: () => this.getPublicMatchSnapshot() },
      "/tactical": { scope: "tactical:read", fetch: () => this.getPublicTacticalSnapshot() },
    };

    // Remove trailing slash for exact matching
    const normalizedEndpoint = endpoint.replace(/\/$/, "");

    if (endpointMap[normalizedEndpoint]) {
      const route = endpointMap[normalizedEndpoint];
      
      const authHeader = req.headers["authorization"];
      if (!authHeader) {
        return json(401, this.createError("Unauthorized", "Missing token."));
      }
      
      if (!this.authorizeRequest(req, route.scope)) {
        if (!this.authorizeRequest(req, null)) {
            return json(401, this.createError("Unauthorized", "Invalid token."));
        }
        return json(403, this.createError("Forbidden", `Scope ${route.scope} required.`));
      }

      return json(200, this.createResponse(route.fetch()));
    }

    if (normalizedEndpoint === "/all") {
      const authHeader = req.headers["authorization"];
      if (!authHeader) {
        return json(401, this.createError("Unauthorized", "Missing token."));
      }

      if (!this.authorizeRequest(req, null)) {
         return json(401, this.createError("Unauthorized", "Invalid token."));
      }

      const data = {};
      
      if (this.authorizeRequest(req, "server:read")) data.server = this.getPublicServerSnapshot();
      if (this.authorizeRequest(req, "players:read")) data.players = this.getPublicPlayersSnapshot();
      if (this.authorizeRequest(req, "squads:read")) data.squads = this.getPublicSquadsSnapshot();
      if (this.authorizeRequest(req, "match:read")) data.match = this.getPublicMatchSnapshot();
      if (this.authorizeRequest(req, "tactical:read")) data.tactical = this.getPublicTacticalSnapshot();

      if (Object.keys(data).length === 0) {
        return json(403, this.createError("Forbidden", "Insufficient scopes for /all."));
      }

      return json(200, this.createResponse(data));
    }

    return json(404, this.createError("NotFound", "Endpoint not found."));
  }

  handleUpgrade({ req, socket, head }) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const wsPath = this.getWsPath();

    if (url.pathname !== wsPath && !url.pathname.startsWith(`${wsPath}/`)) {
      return false; // Let others handle it
    }

    const cfg = this.getConfig();
    if (!cfg.enabled) {
      this.rejectUpgrade(socket, 503, "Public interface is disabled.");
      return true;
    }

    const token = url.searchParams.get("token");
    if (!token && !cfg.allowAnonymous) {
      this.rejectUpgrade(socket, 401, "Missing token.");
      return true;
    }

    if (token) {
      req.headers["authorization"] = `Bearer ${token}`;
    }

    if (!this.authorizeRequest(req, "ws:read") && !cfg.allowAnonymous) {
      this.rejectUpgrade(socket, 403, "Forbidden or invalid token.");
      return true;
    }

    const acceptKey = crypto
      .createHash("sha1")
      .update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptKey}`,
        "",
        "",
      ].join("\r\n")
    );

    // Minimum implementation for WS connecting and parsing subscribe
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      // Simplified frame parsing for demonstration (in production use proper ws lib or same implementation as web-server)
      while (buffer.length >= 2) {
        const payloadLength = buffer[1] & 0x7f;
        let offset = 2;
        if (payloadLength === 126) offset += 2;
        else if (payloadLength === 127) offset += 8;
        
        const masked = (buffer[1] & 0x80) !== 0;
        if (masked) offset += 4;
        
        let actualPayloadLength = payloadLength;
        if (payloadLength === 126) actualPayloadLength = buffer.readUInt16BE(2);
        // We skip 127 for simplicity in this stub
        
        if (buffer.length < offset + actualPayloadLength) return;

        const payload = buffer.subarray(offset, offset + actualPayloadLength);
        let mask;
        if (masked) mask = buffer.subarray(offset - 4, offset);
        
        if (masked && mask) {
          for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        }

        try {
          const msg = JSON.parse(payload.toString("utf8"));
          if (msg.type === "subscribe") {
            const topics = msg.topics ?? [];
            if (topics.includes("players")) {
              const res = {
                type: "snapshot",
                topic: "players",
                revision: 1,
                data: this.getPublicPlayersSnapshot()
              };
              this.sendWsFrame(socket, JSON.stringify(res));
            }
            if (topics.includes("server")) {
              const res = {
                type: "snapshot",
                topic: "server",
                revision: 1,
                data: this.getPublicServerSnapshot()
              };
              this.sendWsFrame(socket, JSON.stringify(res));
            }
          }
        } catch {}

        buffer = buffer.subarray(offset + actualPayloadLength);
      }
    });

    return true;
  }

  sendWsFrame(socket, text) {
    const payload = Buffer.from(text, "utf8");
    const length = payload.length;
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
    header[0] = 0x81; // Text frame
    socket.write(Buffer.concat([header, payload]));
  }

  rejectUpgrade(socket, statusCode, message) {
    const body = Buffer.from(String(message ?? ""), "utf8");
    socket.end(
      Buffer.concat([
        Buffer.from(
          [
            `HTTP/1.1 ${statusCode} ${statusCode === 401 ? "Unauthorized" : statusCode === 403 ? "Forbidden" : "Service Unavailable"}`,
            "Connection: close",
            "Content-Type: text/plain; charset=utf-8",
            `Content-Length: ${body.length}`,
            "",
            "",
          ].join("\r\n"),
          "utf8"
        ),
        body,
      ])
    );
  }
}

function firstText(values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function firstKnownStatus(values) {
  let fallback = "unknown";
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (!text) continue;
    if (text.toLowerCase() === "unknown") {
      fallback = text;
      continue;
    }
    return text;
  }
  return fallback;
}

function firstFiniteNumber(values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function latestTimestamp(values) {
  let latestMs = Number.NEGATIVE_INFINITY;
  let latestText = "";

  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text) continue;
    const ms = Date.parse(text);
    if (!Number.isFinite(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latestText = new Date(ms).toISOString();
    }
  }

  return latestText || new Date().toISOString();
}

export default createPublicInterfaceModule;
