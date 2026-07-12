// -*- coding: utf-8 -*-

export function compactSnapshot(snapshot) {
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

export function buildSnapshotDelta(previous, next) {
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

export function hasMeaningfulDelta(delta) {
  if (delta?.replace) return true;
  if ((delta?.players?.upsert?.length ?? 0) > 0) return true;
  if ((delta?.players?.remove?.length ?? 0) > 0) return true;
  return ["server", "match", "teams", "squadFollow", "assets", "diagnostics"]
    .some((field) => Object.prototype.hasOwnProperty.call(delta ?? {}, field));
}

export function playerKey(player) {
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