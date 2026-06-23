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
      getPublicPlayerSnapshot: (query) => this.getPublicPlayerSnapshot(query),
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

  getCurrentServerId() {
    return firstText([this.core.webStatus?.serverId, this.core.webStatus?.getSnapshot?.()?.serverId, "BZSS_Main"]);
  }

  getPlayerStateSnapshot(serverId = this.getCurrentServerId()) {
    const playerState = this.modules.playerState;
    if (!playerState) return null;

    if (typeof playerState.getState === "function") {
      const snapshot = playerState.getState(serverId);
      if (snapshot && Array.isArray(snapshot.players)) {
        return snapshot;
      }
    }

    const players = typeof playerState.getPlayerList === "function" ? playerState.getPlayerList(serverId) ?? [] : [];
    return { serverId, players, updatedAt: "" };
  }

  getMatchStateSnapshot(serverId = this.getCurrentServerId()) {
    const matchStateApi = this.modules.matchState;
    if (!matchStateApi) return null;

    if (typeof matchStateApi.getState === "function") {
      const snapshot = matchStateApi.getState(serverId);
      if (snapshot) return snapshot;
    }

    return typeof matchStateApi.getOverview === "function"
      ? matchStateApi.getOverview()?.matchState ?? null
      : null;
  }

  getCurrentPlayers(serverId = this.getCurrentServerId()) {
    const playerStateSnapshot = this.getPlayerStateSnapshot(serverId);
    const playerStatePlayers = Array.isArray(playerStateSnapshot?.players)
      ? playerStateSnapshot.players.filter((player) => player && typeof player === "object")
      : [];
    if (playerStatePlayers.length > 0) {
      return playerStatePlayers.map((player) => ({ ...player }));
    }

    const matchStateSnapshot = this.getMatchStateSnapshot(serverId);
    const matchStatePlayers = Array.isArray(matchStateSnapshot?.players?.list)
      ? matchStateSnapshot.players.list.filter((player) => player && typeof player === "object")
      : [];
    return matchStatePlayers.map((player) => ({ ...player }));
  }

  async getCurrentPlayerDatabaseRows(players = []) {
    const playerDatabase = this.modules.playerDatabase;
    if (!playerDatabase) return [];

    const steamIDs = [];
    const eosIDs = [];
    for (const player of Array.isArray(players) ? players : []) {
      const steamID = cleanIdentityValue(player?.steamID ?? player?.steam64ID ?? player?.steamId);
      const eosID = cleanIdentityValue(player?.eosID ?? player?.eosId);
      if (steamID) steamIDs.push(steamID);
      if (eosID) eosIDs.push(eosID);
    }

    if (!steamIDs.length && !eosIDs.length) return [];

    if (typeof playerDatabase.listPlayersByIdentities === "function") {
      return await playerDatabase.listPlayersByIdentities({ steamIDs, eosIDs }) ?? [];
    }

    if (typeof playerDatabase.listPlayersBySteamIDs === "function" && steamIDs.length) {
      return await playerDatabase.listPlayersBySteamIDs(steamIDs) ?? [];
    }

    return [];
  }

  getCurrentPlayerDatabaseIndex(rows = []) {
    const bySteamID = new Map();
    const byEOSID = new Map();

    for (const row of Array.isArray(rows) ? rows : []) {
      const steamID = cleanIdentityValue(row?.steam_id ?? row?.steamID ?? row?.steam64ID);
      const eosID = cleanIdentityValue(row?.eos_id ?? row?.eosID);
      const ip = cleanIdentityValue(row?.current_ip ?? row?.ip);
      if (steamID && ip) bySteamID.set(steamID, ip);
      if (eosID && ip) byEOSID.set(eosID, ip);
    }

    return { bySteamID, byEOSID };
  }

  getBzssPlayerIndex() {
    const players = this.modules.bzssCoreMonitor?.getPlayers?.() ?? [];
    return Array.isArray(players) ? players.map((player) => ({ ...player })) : [];
  }

  getBzssPlayerMatch(player, bzssPlayers = []) {
    if (!Array.isArray(bzssPlayers) || !bzssPlayers.length || !player) return null;

    const eosID = cleanIdentityValue(player?.eosID ?? player?.eosId);
    if (eosID) {
      const hit = bzssPlayers.find((item) => cleanIdentityValue(item?.playerGuid) === eosID);
      if (hit) return hit;
    }

    const name = normalizeName(player?.name ?? player?.playerName);
    if (name) {
      const direct = bzssPlayers.find((item) => normalizeName(item?.playerName) === name);
      if (direct) return direct;
      const partial = bzssPlayers.find((item) => normalizeName(item?.playerName).includes(name));
      if (partial) return partial;
    }

    return null;
  }

  serializePlayer(player, { bzssPlayer = null, ipIndex = null } = {}) {
    const current = player && typeof player === "object" ? player : {};
    const bzss = bzssPlayer && typeof bzssPlayer === "object" ? bzssPlayer : null;
    const name = firstText([current.name, current.playerName, bzss?.playerName]);
    const playerID = normalizePlayerId(current.playerID ?? current.playerId ?? bzss?.playerId);
    const steam64ID = firstText([current.steamID, current.steam64ID, current.steam64, current.steam_id]);
    const eosID = firstText([current.eosID, current.eosId, current.eos_id]);
    const ip = firstText([
      current.ip,
      current.current_ip,
      current.networkInfo?.ip,
      steam64ID ? ipIndex?.bySteamID?.get(steam64ID) : "",
      eosID ? ipIndex?.byEOSID?.get(eosID) : "",
    ]);
    const latency = firstFiniteNumber([current.latency, current.ping, current.networkInfo?.ping, bzss?.ping]);
    const ftIndex = firstFiniteNumber([current.ftIndex, bzss?.ftIndex]);
    const ftPosition = firstFiniteNumber([current.ftPosition, bzss?.ftPosition]);
    const health = firstFiniteNumber([current.health, current.soldierInfo?.health, bzss?.soldierInfo?.health]);
    const currentWeapon = firstText([
      current.currentWeapon,
      current.weaponClass,
      current.soldierInfo?.weaponClass,
      bzss?.soldierInfo?.weaponClass,
    ]);
    const ammoValues = Array.isArray(current.ammoValues) && current.ammoValues.length
      ? current.ammoValues.slice()
      : Array.isArray(current.soldierInfo?.ammoValues) && current.soldierInfo.ammoValues.length
        ? current.soldierInfo.ammoValues.slice()
        : Array.isArray(bzss?.soldierInfo?.ammoValues)
          ? bzss.soldierInfo.ammoValues.slice()
          : [];
    const position = normalizeVector(current.position ?? current.soldierInfo?.position ?? bzss?.soldierInfo?.position ?? current.vehicleInfo?.position);
    const rotation = normalizeVector(current.rotation ?? current.soldierInfo?.rotation ?? bzss?.soldierInfo?.rotation ?? current.vehicleInfo?.rotation);

    return {
      name,
      playerID,
      playerIdLabel: playerID ? `# ${playerID}` : "",
      steam64ID,
      eosID,
      ip,
      latency,
      isLeader: Boolean(current.isLeader),
      role: firstText([current.role, bzss?.soldierInfo?.soldierClass]),
      teamID: normalizePlayerId(current.teamID ?? current.teamId),
      squadID: normalizePlayerId(current.squadID ?? current.squadId),
      ftIndex,
      ftPosition,
      health,
      currentWeapon,
      ammoValues,
      position,
      rotation,
    };
  }

  normalizePlayerQuery(query = {}) {
    if (query == null) return null;
    if (typeof query === "string" || typeof query === "number") {
      const raw = String(query ?? "").trim();
      return raw ? { raw } : null;
    }
    if (typeof query !== "object") return null;

    const normalized = {
      raw: String(query.raw ?? query.query ?? query.player ?? query.name ?? query.playerID ?? query.playerId ?? query.steam64ID ?? query.steamID ?? query.eosID ?? "").trim(),
      playerID: normalizePlayerId(query.playerID ?? query.playerId),
      steam64ID: cleanIdentityValue(query.steam64ID ?? query.steamID ?? query.steamId),
      eosID: cleanIdentityValue(query.eosID ?? query.eosId),
      name: String(query.name ?? query.playerName ?? "").trim(),
    };

    if (!normalized.raw && !normalized.playerID && !normalized.steam64ID && !normalized.eosID && !normalized.name) {
      return null;
    }

    return normalized;
  }

  playerMatchesQuery(player, query) {
    if (!query) return false;
    const candidate = player && typeof player === "object" ? player : {};

    if (query.playerID && normalizePlayerId(candidate.playerID ?? candidate.playerId) !== query.playerID) return false;
    if (query.steam64ID && cleanIdentityValue(candidate.steamID ?? candidate.steam64ID ?? candidate.steamId) !== query.steam64ID) return false;
    if (query.eosID && cleanIdentityValue(candidate.eosID ?? candidate.eosId) !== query.eosID) return false;

    const candidateName = normalizeName(candidate.name ?? candidate.playerName);
    if (query.name) {
      const needle = normalizeName(query.name);
      if (!needle) return false;
      if (candidateName !== needle && !candidateName.includes(needle)) return false;
    } else if (query.raw && !query.playerID && !query.steam64ID && !query.eosID) {
      const needle = normalizeName(query.raw);
      if (!needle) return false;
      if (candidateName !== needle && !candidateName.includes(needle)) return false;
    }

    return true;
  }

  async getPublicPlayerSnapshot(query = null) {
    const serverId = this.getCurrentServerId();
    const normalizedQuery = this.normalizePlayerQuery(query);
    const players = this.getCurrentPlayers(serverId);
    const bzssPlayers = this.getBzssPlayerIndex();
    const databaseRows = await this.getCurrentPlayerDatabaseRows(players);
    const ipIndex = this.getCurrentPlayerDatabaseIndex(databaseRows);
    const selectedPlayers = normalizedQuery
      ? players.filter((player) => this.playerMatchesQuery(player, normalizedQuery))
      : players;
    const data = selectedPlayers.map((player) => this.serializePlayer(player, {
      bzssPlayer: this.getBzssPlayerMatch(player, bzssPlayers),
      ipIndex,
    }));
    const updatedAt = latestTimestamp([
      this.getPlayerStateSnapshot(serverId)?.updatedAt,
      this.getMatchStateSnapshot(serverId)?.updatedAt,
      this.modules.bzssCoreMonitor?.getState?.()?.updatedAt,
    ]);

    return {
      ok: true,
      serverId,
      revision: Number(Date.parse(updatedAt)) || Date.now(),
      updatedAt,
      query: normalizedQuery,
      matchedCount: data.length,
      players: data,
    };
  }

  async getPublicPlayersSnapshot(query = null) {
    const snapshot = await this.getPublicPlayerSnapshot(query);
    return snapshot.players;
  }

  getPublicSquadsSnapshot() {
    const matchState = this.getMatchStateSnapshot() ?? {};
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

      const data = await route.fetch();
      return json(200, this.createResponse(data));
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
      if (this.authorizeRequest(req, "players:read")) data.players = await this.getPublicPlayersSnapshot();
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

    const client = {
      socket,
      buffer: Buffer.alloc(0),
    };

    socket.on("data", (chunk) => {
      try {
        this.handleWsData(client, chunk);
      } catch (error) {
        this.logger?.warn?.(`Public WS data handling failed: ${error?.message ?? error}`);
      }
    });

    socket.on("close", () => {
      client.buffer = Buffer.alloc(0);
    });

    if (head && head.length) {
      try {
        this.handleWsData(client, head);
      } catch (error) {
        this.logger?.warn?.(`Public WS head handling failed: ${error?.message ?? error}`);
      }
    }

    return true;
  }

  handleWsData(client, chunk) {
    client.buffer = Buffer.concat([client.buffer, chunk]);

    while (client.buffer.length >= 2) {
      const firstByte = client.buffer[0];
      const secondByte = client.buffer[1];
      const opcode = firstByte & 0x0f;
      const masked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7f;
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

      let mask = null;
      if (masked) {
        if (client.buffer.length < offset + 4) return;
        mask = client.buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (client.buffer.length < offset + payloadLength) {
        return;
      }

      const payload = Buffer.from(client.buffer.subarray(offset, offset + payloadLength));
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
        this.sendWsFrame(client.socket, Buffer.alloc(0), 0xA);
        continue;
      }

      if (opcode !== 0x1) {
        continue;
      }

      let msg = null;
      try {
        msg = JSON.parse(payload.toString("utf8"));
      } catch {
        continue;
      }

      void this.handleWsMessage(client, msg).catch((error) => {
        this.logger?.warn?.(`Public WS message handling failed: ${error?.message ?? error}`);
      });
    }
  }

  async handleWsMessage(client, msg = {}) {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "subscribe") {
      const topics = Array.isArray(msg.topics) ? msg.topics : [];
      if (topics.includes("players")) {
        const snapshot = await this.getPublicPlayerSnapshot();
        this.sendWsFrame(client.socket, JSON.stringify({
          type: "snapshot",
          topic: "players",
          revision: snapshot.revision,
          updatedAt: snapshot.updatedAt,
          data: snapshot.players,
        }));
      }
      if (topics.includes("server")) {
        const snapshot = this.getPublicServerSnapshot();
        this.sendWsFrame(client.socket, JSON.stringify({
          type: "snapshot",
          topic: "server",
          revision: Date.now(),
          updatedAt: new Date().toISOString(),
          data: snapshot,
        }));
      }
      return;
    }

    if (msg.type === "players:list") {
      const snapshot = await this.getPublicPlayerSnapshot();
      this.sendWsFrame(client.socket, JSON.stringify({
        type: "players:list",
        ok: true,
        serverId: snapshot.serverId,
        revision: snapshot.revision,
        updatedAt: snapshot.updatedAt,
        matchedCount: snapshot.matchedCount,
        players: snapshot.players,
      }));
      return;
    }

    if (msg.type === "players:detail") {
      const query = this.normalizePlayerQuery(msg.query ?? msg.player ?? msg.identity ?? msg);
      if (!query) {
        this.sendWsFrame(client.socket, JSON.stringify({
          type: "players:detail",
          ok: false,
          error: "InvalidQuery",
          message: "Missing player query.",
          matchedCount: 0,
          players: [],
        }));
        return;
      }

      const snapshot = await this.getPublicPlayerSnapshot(query);
      this.sendWsFrame(client.socket, JSON.stringify({
        type: "players:detail",
        ok: true,
        serverId: snapshot.serverId,
        revision: snapshot.revision,
        updatedAt: snapshot.updatedAt,
        query: snapshot.query,
        matchedCount: snapshot.matchedCount,
        players: snapshot.players,
      }));
      return;
    }
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

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function cleanIdentityValue(value) {
  const text = String(value ?? "").trim();
  return text && text.toLowerCase() !== "invalid" && text !== "0" ? text : "";
}

function normalizePlayerId(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.replace(/^#\s*/, "").trim();
}

function normalizeVector(value) {
  if (!value || typeof value !== "object") return null;
  const x = firstFiniteNumber([value.x]);
  const y = firstFiniteNumber([value.y]);
  const z = firstFiniteNumber([value.z]);
  if (x == null && y == null && z == null) return null;
  return { x, y, z };
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
