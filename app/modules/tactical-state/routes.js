// -*- coding: utf-8 -*-

const STREAM_HEARTBEAT_MS = 20_000;

export async function handleTacticalStateRoutes({ modules, url, req, res, user, json }) {
  if (url.pathname.startsWith("/api/tactical-replay")) {
    return handleTacticalReplayPlayerRoutes({ modules, url, req, json });
  }
  if (!url.pathname.startsWith("/api/tactical-state")) return false;

  const tacticalState = modules.tacticalState;
  if (!tacticalState) {
    json(404, { error: "ModuleNotFound", message: "tacticalState module is not loaded." });
    return true;
  }

  if (url.pathname === "/api/tactical-state/snapshot" && req.method === "GET") {
    const snapshot = url.searchParams.get("compact") === "1"
      ? await tacticalState.getCompactSnapshot?.({ user })
      : await tacticalState.getSnapshot?.({ user });
    json(200, { ok: true, snapshot });
    return true;
  }

  if (url.pathname === "/api/tactical-state/players" && req.method === "GET") {
    const players = await tacticalState.getPlayers?.({ user });
    json(200, { ok: true, players });
    return true;
  }

  if (url.pathname === "/api/tactical-state/player-health" && req.method === "GET") {
    const players = await tacticalState.getPlayers?.({ user });
    const healthPlayers = (Array.isArray(players) ? players : []).map((player) => {
      const identity = player?.identity ?? {};
      const rawHealth = player?.telemetry?.health ?? player?.raw?.bzss?.soldierInfo?.health ?? null;
      const numericHealth = Number(rawHealth);
      return {
        name: String(identity.name ?? player?.name ?? "").trim(),
        playerID: identity.playerID ?? identity.playerId ?? null,
        steamID: String(identity.steamID ?? "").trim(),
        eosID: String(identity.eosID ?? "").trim(),
        health: Number.isFinite(numericHealth) ? numericHealth : null,
        stale: player?.telemetry?.stale === true,
        observedAt: player?.telemetry?.observedAt ?? null,
      };
    });
    json(200, { ok: true, players: healthPlayers });
    return true;
  }

  if (url.pathname === "/api/tactical-state/player" && req.method === "GET") {
    const identity = {
      steamID: url.searchParams.get("steamID") ?? url.searchParams.get("steamId") ?? url.searchParams.get("steam64") ?? "",
      eosID: url.searchParams.get("eosID") ?? url.searchParams.get("eosId") ?? "",
      playerID: url.searchParams.get("playerID") ?? url.searchParams.get("playerId") ?? "",
      name: url.searchParams.get("name") ?? "",
    };
    const player = await tacticalState.getPlayer?.(identity, { allowLooseName: true });
    json(200, { ok: true, player });
    return true;
  }

  if (url.pathname === "/api/tactical-state/stream" && req.method === "GET") {
    req.socket.setTimeout(0);
    req.socket.setKeepAlive(true);
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const connection = {
      blocked: false,
      needsResync: false,
      resyncing: false,
      closed: false,
    };

    const sendText = (text) => {
      if (connection.closed || !text) return true;
      const accepted = res.write(`data: ${text}\n\n`);
      if (!accepted) connection.blocked = true;
      return accepted;
    };

    const sendDelta = (text) => {
      if (connection.closed || !text) return;
      if (connection.blocked || connection.resyncing) {
        connection.needsResync = true;
        return;
      }
      sendText(text);
    };

    const sendLatestSnapshot = async () => {
      if (connection.closed || connection.resyncing) return;
      connection.resyncing = true;
      try {
        do {
          connection.needsResync = false;
          const latest = await tacticalState.getStreamSnapshot?.();
          if (connection.closed) return;
          if (connection.blocked) {
            connection.needsResync = true;
            return;
          }
          sendText(latest?.serialized ?? "");
        } while (connection.needsResync && !connection.blocked && !connection.closed);
      } finally {
        connection.resyncing = false;
      }
    };

    const onDrain = () => {
      connection.blocked = false;
      if (connection.needsResync) void sendLatestSnapshot();
    };
    res.on("drain", onDrain);

    const initial = await tacticalState.getStreamSnapshot?.();
    sendText(initial?.serialized ?? JSON.stringify(initial?.envelope ?? {
      ok: true, type: "tactical-state.snapshot", snapshot: await tacticalState.getSnapshot?.({ user }),
    }));

    const unsubscribe = tacticalState.subscribeStream?.((message) => {
      sendDelta(message?.serialized ?? "");
    });
    const heartbeatTimer = setInterval(() => {
      if (!connection.closed && !connection.blocked) res.write(": heartbeat\n\n");
    }, STREAM_HEARTBEAT_MS);
    heartbeatTimer.unref?.();

    const cleanup = () => {
      if (connection.closed) return;
      connection.closed = true;
      connection.needsResync = false;
      clearInterval(heartbeatTimer);
      res.off("drain", onDrain);
      unsubscribe?.();
      req.off("close", cleanup);
    };
    req.on("close", cleanup);
    return true;
  }

  return false;
}


async function handleTacticalReplayPlayerRoutes({ modules, url, req, json }) {
  const player = modules.tacticalReplayPlayer;
  if (!player) {
    json(404, { error: "ModuleNotFound", message: "tacticalReplayPlayer module is not loaded." });
    return true;
  }
  if (req.method !== "GET") {
    json(405, { error: "MethodNotAllowed", message: "Only GET is supported." });
    return true;
  }

  if (url.pathname === "/api/tactical-replay/status") {
    json(200, { ok: true, status: player.getStatus?.() ?? null });
    return true;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 3 && segments[2] === "sessions") {
    const limit = parsePositiveInteger(url.searchParams.get("limit"), 100, 1000);
    json(200, { ok: true, sessions: await player.listSessions?.({ limit }) ?? [] });
    return true;
  }

  if (segments.length < 4 || segments[2] !== "sessions") {
    json(404, { error: "ReplayRouteNotFound", message: "Unknown tactical replay route." });
    return true;
  }

  const sessionId = decodePathSegment(segments[3]);
  if (segments.length === 4) {
    const session = await player.getSession?.(sessionId);
    if (!session) {
      json(404, { error: "ReplaySessionNotFound", message: "Replay session was not found." });
      return true;
    }
    json(200, { ok: true, session });
    return true;
  }

  if (segments.length === 5 && segments[4] === "state") {
    const atMs = parseNonNegativeNumber(url.searchParams.get("at"), 0);
    const state = await player.readState?.(sessionId, { atMs });
    if (!state) {
      json(404, { error: "ReplaySessionNotFound", message: "Replay session was not found." });
      return true;
    }
    json(200, { ok: true, ...state });
    return true;
  }

  json(404, { error: "ReplayRouteNotFound", message: "Unknown tactical replay route." });
  return true;
}

function parsePositiveInteger(value, fallback, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(numeric)));
}

function parseNonNegativeNumber(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return numeric;
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(String(value ?? ""));
  } catch {
    return String(value ?? "");
  }
}
