// -*- coding: utf-8 -*-

const STREAM_MIN_INTERVAL_MS = 200;
const STREAM_HEARTBEAT_MS = 20_000;

export async function handleTacticalStateRoutes({
  modules,
  url,
  req,
  res,
  user,
  json,
}) {
  if (!url.pathname.startsWith("/api/tactical-state")) {
    return false;
  }

  const tacticalState = modules.tacticalState;
  if (!tacticalState) {
    json(404, {
      error: "ModuleNotFound",
      message: "tacticalState module is not loaded.",
    });
    return true;
  }

  if (url.pathname === "/api/tactical-state/snapshot" && req.method === "GET") {
    const snapshot = await tacticalState.getSnapshot?.({ user });
    json(200, {
      ok: true,
      snapshot: url.searchParams.get("compact") === "1"
        ? compactSnapshot(snapshot)
        : snapshot,
    });
    return true;
  }

  if (url.pathname === "/api/tactical-state/players" && req.method === "GET") {
    const players = await tacticalState.getPlayers?.({ user });
    json(200, {
      ok: true,
      players,
    });
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
    json(200, {
      ok: true,
      player,
    });
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

    let closed = false;
    let previousSnapshot = null;
    let pendingSnapshot = null;
    let flushTimer = null;
    let lastSentAt = 0;

    const writeEvent = (payload) => {
      if (closed || res.writableEnded) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      lastSentAt = Date.now();
    };

    const sendInitialSnapshot = (snapshot) => {
      const compact = compactSnapshot(snapshot);
      previousSnapshot = compact;
      writeEvent({
        ok: true,
        type: "tactical-state.snapshot",
        snapshot: compact,
      });
    };

    const flushDelta = () => {
      flushTimer = null;
      if (!pendingSnapshot || closed) return;
      const next = compactSnapshot(pendingSnapshot);
      pendingSnapshot = null;
      const delta = buildSnapshotDelta(previousSnapshot, next);
      previousSnapshot = next;
      if (!hasMeaningfulDelta(delta)) return;
      writeEvent({
        ok: true,
        type: "tactical-state.delta",
        revision: next?.meta?.revision ?? null,
        generatedAt: next?.meta?.generatedAt ?? "",
        delta,
      });
    };

    const scheduleSnapshot = (snapshot) => {
      pendingSnapshot = snapshot;
      if (flushTimer) return;
      const waitMs = Math.max(0, STREAM_MIN_INTERVAL_MS - (Date.now() - lastSentAt));
      flushTimer = setTimeout(flushDelta, waitMs);
    };

    const initialSnapshot = await tacticalState.getSnapshot?.({ user });
    sendInitialSnapshot(initialSnapshot);

    const unsubscribe = tacticalState.subscribe?.((snapshot) => {
      scheduleSnapshot(snapshot);
    });

    const heartbeatTimer = setInterval(() => {
      if (!closed && !res.writableEnded) res.write(": heartbeat\n\n");
    }, STREAM_HEARTBEAT_MS);

    req.on("close", () => {
      closed = true;
      if (flushTimer) clearTimeout(flushTimer);
      clearInterval(heartbeatTimer);
      if (typeof unsubscribe === "function") unsubscribe();
    });
    return true;
  }

  return false;
}

function compactSnapshot(snapshot) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  return {
    meta: cloneJson(source.meta ?? {}),
    server: cloneJson(source.server ?? {}),
    match: cloneJson(source.match ?? {}),
    teams: cloneJson(Array.isArray(source.teams) ? source.teams : []),
    players: (Array.isArray(source.players) ? source.players : []).map(compactPlayer),
    squadFollow: cloneJson(source.squadFollow ?? null),
    assets: cloneJson(source.assets ?? {}),
    diagnostics: compactDiagnostics(source.diagnostics),
  };
}

function compactPlayer(player) {
  const source = player && typeof player === "object" ? player : {};
  return {
    identity: cloneJson(source.identity ?? {}),
    presence: cloneJson(source.presence ?? {}),
    match: cloneJson(source.match ?? {}),
    telemetry: cloneJson(source.telemetry ?? {}),
    combat: cloneJson(source.combat ?? {}),
    vehicle: compactVehicle(source.vehicle),
    network: cloneJson(source.network ?? {}),
    profile: cloneJson(source.profile ?? {}),
    link: cloneJson(source.link ?? {}),
    freshness: compactFreshness(source.freshness),
  };
}

function compactVehicle(vehicle) {
  if (!vehicle || typeof vehicle !== "object") return {};
  const { raw: _raw, ...rest } = vehicle;
  return cloneJson(rest);
}

function compactFreshness(freshness) {
  if (!freshness || typeof freshness !== "object") return {};
  const { generatedAt: _generatedAt, ...rest } = freshness;
  return cloneJson(rest);
}

function compactDiagnostics(diagnostics) {
  if (!diagnostics || typeof diagnostics !== "object") return {};
  return {
    unlinkedRconPlayers: cloneJson(diagnostics.unlinkedRconPlayers ?? []),
    unlinkedBzssPlayers: cloneJson(diagnostics.unlinkedBzssPlayers ?? []),
    stalePlayers: cloneJson(diagnostics.stalePlayers ?? []),
    sourceErrors: cloneJson(diagnostics.sourceErrors ?? []),
  };
}

function buildSnapshotDelta(previous, next) {
  if (!previous) {
    return {
      replace: next,
      players: { upsert: [], remove: [] },
    };
  }

  const previousPlayers = new Map(
    (previous.players ?? []).map((player) => [playerKey(player), player]),
  );
  const nextPlayers = new Map(
    (next.players ?? []).map((player) => [playerKey(player), player]),
  );
  const upsert = [];
  const remove = [];

  for (const [key, player] of nextPlayers) {
    const before = previousPlayers.get(key);
    if (!before || stableJson(before) !== stableJson(player)) upsert.push(player);
  }
  for (const key of previousPlayers.keys()) {
    if (!nextPlayers.has(key)) remove.push(key);
  }

  const delta = {
    meta: next.meta,
    players: { upsert, remove },
  };

  for (const field of ["server", "match", "teams", "squadFollow", "assets", "diagnostics"]) {
    if (stableJson(previous[field]) !== stableJson(next[field])) {
      delta[field] = next[field];
    }
  }

  return delta;
}

function hasMeaningfulDelta(delta) {
  if (delta?.replace) return true;
  if ((delta?.players?.upsert?.length ?? 0) > 0) return true;
  if ((delta?.players?.remove?.length ?? 0) > 0) return true;
  return ["server", "match", "teams", "squadFollow", "assets", "diagnostics"]
    .some((field) => Object.prototype.hasOwnProperty.call(delta ?? {}, field));
}

function playerKey(player) {
  const identity = player?.identity ?? {};
  return String(
    identity.key
      ?? identity.steamID
      ?? identity.eosID
      ?? identity.controllerID
      ?? identity.playerID
      ?? identity.playerId
      ?? identity.name
      ?? "",
  );
}

function stableJson(value) {
  return JSON.stringify(value ?? null);
}

function cloneJson(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}
